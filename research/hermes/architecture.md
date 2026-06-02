# Hermes Agent: Architecture Overview

Read `platform_blueprint.md` first. This document is the conceptual summary: components, data flows, key abstractions. Intended as a quick orientation, not a build guide.

**Source**: `/root/hermes-agent/` (verified against `AGENTS.md`, `run_agent.py`, `gateway/run.py`, `hermes_state.py`, `cron/`, `tools/`, `plugins/`).

---

## Component Map

```
┌──────────────────────── Entry Points ──────────────────────────┐
│  hermes           → cli.py → HermesCLI (prompt_toolkit)        │
│  hermes --tui     → ui-tui/ Node (Ink/TSX) ←JSON-RPC→ tui_gateway/│
│  hermes gateway   → gateway/run.py → GatewayRunner (asyncio)   │
│  hermes acp       → acp_adapter/server.py (ACP protocol)       │
│  hermes mcp serve → mcp_serve.py (stdio MCP server)            │
└────────────────────────────────────────────────────────────────┘
               │              │
               ▼              ▼
         AIAgent          GatewayRunner
         (run_agent.py)   (manages LRU cache of AIAgents,
                           one per [platform, channel_id])
               │
    ┌──────────┼──────────┐
    │          │          │
    ▼          ▼          ▼
MemoryManager  ContextEngine  ToolRegistry
(builtin +     (compressor    (auto-discovered
 1 external    or plugin)      tools/*.py)
 plugin)
    │                          │
    ▼                          ▼
MEMORY.md              tools/environments/
USER.md                (local|docker|ssh|
plugins/memory/        daytona|singularity|modal)
(honcho, mem0, etc.)
```

---

## Data Flow: A Single Conversation Turn

```
1. User input arrives (CLI keypress or gateway platform event)
2. GatewayRunner.handle_message() → retrieve or create AIAgent for session
3. AIAgent._build_system_prompt() [cached; rebuilt only after compression]
   → load SOUL.md / AGENTS.md / context files
   → inject skill index (available skills listed)
   → prepend memory block (MEMORY.md + USER.md + MemoryManager.prefetch_all())
4. SmartRouting: cheap model or primary model?
5. CredentialPool: select API key (fill_first / round_robin / random / least_used)
6. POST to OpenAI-compatible endpoint
7. Response has tool_calls?
   YES → handle_function_call() → append tool_result → loop back to step 6
   NO  → final text response; session saved to SessionDB
8. Post-turn:
   a. MemoryManager.sync_all(user_msg, assistant_response)
   b. _turns_since_memory += 1; if >= nudge_interval → _spawn_background_review()
   c. _tool_call_count += 1; if >= skill_nudge_interval → schedule skill review
   d. Context engine: should_compress()? → compress() if yes
```

---

## Key Abstractions

### AIAgent (`run_agent.py`)

The central object. One per CLI session; the gateway maintains an LRU cache of them. Constructed once per session; **not** reconstructed per message (the gateway passes `conversation_history` to maintain state across messages).

Public interface:
```python
agent.chat(message: str) -> str                          # simple
agent.run_conversation(user_message, system_message,     # full
    conversation_history, task_id) -> dict
```

Max iterations per turn: 90 (configurable). Messages follow OpenAI format. Reasoning content stored in `assistant_msg["reasoning"]`.

### MemoryProvider (`agent/memory_provider.py`)

Abstract base class. Lifecycle:
```
initialize() → system_prompt_block() → prefetch(query) → sync_turn(user, asst)
             → get_tool_schemas() → handle_tool_call() → shutdown()
```

Optional hooks: `on_session_end()`, `on_pre_compress()`, `on_memory_write()`, `on_delegation()`.

One builtin provider (always present, not removable) + at most one external plugin. Enforced by `MemoryManager`.

### ContextEngine (`agent/context_engine.py`)

Abstract base class. Pluggable. Default: `ContextCompressor`. Fires at 75% of model context window. Compression algorithm:
1. Prune old tool results to placeholder text (cheap pre-pass)
2. Summarize middle turns via auxiliary LLM (scaled budget: 20% of compressed content, max 12K tokens)
3. Prefix summary with "handoff framing" to prevent re-execution of already-completed work
4. Protect first 3 messages and a token-budget tail unchanged

### Skills

Skills are directories with SKILL.md (YAML frontmatter + Markdown body). Injected as user messages (not system prompt). Three sources:
1. Bundled: `/root/hermes-agent/skills/`
2. Community hub: `~/.hermes/skills/hub/`
3. Agent-created: `~/.hermes/skills/`

Skills are scanned for prompt injection at creation/install time (`tools/skills_guard.py`).

---

## Storage Layout

```
~/.hermes/
├── config.yaml          # Settings (model, terminal, memory, skills, display)
├── .env                 # API keys and secrets (0600 perms)
├── state.db             # SQLite: sessions + messages + FTS5 index
├── MEMORY.md            # Declarative memory (agent-written)
├── USER.md              # User profile facts (agent-written)
├── honcho.json          # Honcho workspace/peer config (if honcho plugin active)
├── skills/              # User-created and agent-created skills
├── cron/
│   ├── jobs.json        # Cron job definitions
│   ├── output/          # Per-job output: {job_id}/{timestamp}.md
│   └── .tick.lock       # File lock for scheduler exclusion
├── profiles/            # Multi-instance profiles (each has own HERMES_HOME)
└── skins/               # Custom YAML skin themes
```

---

## Multi-Platform Gateway Flow

```
Platform event (Telegram msg, Discord DM, Slack app mention, ...)
        │
        ▼
PlatformAdapter.handle_event()    # e.g. telegram.py
  → normalize to (user_id, channel_id, text, attachments)
        │
        ▼
GatewayRunner.handle_message()
  → is it a slash command? → dispatch via COMMAND_REGISTRY
  → else → retrieve AIAgent from LRU cache (or create new)
        │
        ▼
AIAgent.run_conversation()        # same as CLI path
        │
        ▼
GatewayRunner.send_response()
  → PlatformAdapter.send(text)    # Telegram message, Discord reply, etc.
```

Voice memos: transcribed by STT before entering the standard text path. Attachments: passed as image/file content blocks to the LLM.

---

## Cron Tick Flow

```
gateway/run.py background thread → cron/scheduler.tick() every 60s
  → acquire ~/.hermes/cron/.tick.lock
  → cron/jobs.get_due_jobs()
  → for each due job:
      spawn AIAgent with job.prompt + skill loading
      capture output → save to cron/output/{id}/{ts}.md
      deliver via job.deliver platform
      mark_job_run() + advance_next_run()
  → release lock
```

---

## Profile Isolation

`HERMES_HOME` env var is intercepted by `_apply_profile_override()` in `hermes_cli/main.py` **before any module import**. All 119+ references to `get_hermes_home()` in the codebase resolve to the active profile's directory. Profiles are stored under `~/.hermes/profiles/<name>/`. Each profile has its own `config.yaml`, `.env`, `state.db`, `MEMORY.md`, skills, cron jobs, and gateway tokens.

---

## Process Model Summary

| Entry point | Process count | Key threads |
|---|---|---|
| `hermes` (CLI) | 1 Python | Main thread (prompt_toolkit loop) + daemon threads (background reviews, cron if enabled) |
| `hermes --tui` | 2 (Node + Python) | Node: UI; Python: agent + tools + sessions |
| `hermes gateway` | 1 Python | Main asyncio loop + cron tick thread + background review threads |
| Subagent (delegate_task) | Thread in parent process | ThreadPoolExecutor, max 3 concurrent |
