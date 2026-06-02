# Reverse-Engineering Hermes Agent: A Complete Blueprint for Self-Improving AI Agent Systems

**Purpose**: This document is a comprehensive, source-code-verified architectural specification. An AI agent or engineer with only this document can understand Hermes's core mechanisms — its learning loop, gateway architecture, terminal backends, credential pool, scheduling subsystem, skill system, and Honcho integration — and can either replicate them or lift individual techniques into another project.

**Source verification**: All information is derived from direct inspection of the `/root/hermes-agent/` source tree. Key files cited throughout: `run_agent.py`, `hermes_state.py`, `hermes_constants.py`, `agent/memory_manager.py`, `agent/memory_provider.py`, `agent/context_engine.py`, `agent/credential_pool.py`, `agent/smart_model_routing.py`, `agent/prompt_builder.py`, `agent/context_compressor.py`, `tools/delegate_tool.py`, `tools/skill_manager_tool.py`, `cron/jobs.py`, `cron/scheduler.py`, `gateway/run.py`, `gateway/platforms/`, `tools/environments/`, `acp_adapter/server.py`, `mcp_serve.py`, `toolsets.py`, `hermes_cli/main.py`, `hermes_cli/config.py`, `hermes_cli/skin_engine.py`, `plugins/memory/`, `plugins/context_engine/`.

---

## 1. The Core Problem Addressed

Standard LLM agents are **stateless tools**: they know nothing at session end, their working environment is ephemeral, and every hard-won approach is forgotten. Reconnecting from a phone while the agent runs on a cloud VM is impossible. Scheduled tasks need a separate cron system. Adding a new messaging platform means rewriting integrations.

Hermes Agent solves this with five interlocked capabilities:

1. **Persistent, platform-agnostic memory** — declarative (MEMORY.md / USER.md) and external (Honcho dialectic user model) with automatic periodic review.
2. **A closed learning loop** — after complex tasks, a background review agent inspects the conversation and either creates a new skill or patches an existing one; memory is also flushed at configurable intervals.
3. **Decoupled compute** — six terminal backends mean the agent's working environment can be local, Docker, SSH, Daytona, Singularity, or Modal; the conversation interface is independent of where the work runs.
4. **Multi-platform messaging gateway** — a single process serves Telegram, Discord, Slack, WhatsApp, Signal, Matrix, DingTalk, Feishu, WeCom, WeChat, Email, SMS, Home Assistant, Mattermost, and more.
5. **First-class scheduling** — native cron subsystem with human-readable intervals, cron expressions, one-shot timestamps, and multi-platform delivery.

---

## 2. Data Model / Key Types

### 2.1 Config (`~/.hermes/config.yaml`)

Loaded by `load_cli_config()` (CLI) or direct YAML (gateway). Key top-level keys:
```yaml
model:
  provider: "anthropic"          # or openrouter, openai, nvidia, etc.
  model: "claude-opus-4.6"
  cheap_model:                   # smart routing to a cheaper model for simple turns
    provider: "anthropic"
    model: "claude-haiku-4"
  routing:
    enabled: true
    min_message_length: 50       # don't route short messages

terminal:
  env: "local"                   # local | docker | ssh | daytona | singularity | modal

memory:
  nudge_interval: 10             # flush memory review every N turns
  provider: "honcho"             # or builtin, hindsight, mem0, supermemory, etc.

context:
  engine: "compressor"           # or "lcm" (plugin)

skills:
  creation_nudge_interval: 10    # trigger skill review after N tool-intensive turns

display:
  skin: "default"                # or ares, mono, slate, or custom YAML skin
```

Schema version is tracked by `_config_version` in `hermes_cli/config.py`; bumped to trigger migration for existing installs (currently version 5).

### 2.2 Session Store (`hermes_state.py` — `SessionDB`)

SQLite WAL-mode database at `~/.hermes/state.db`. Schema version 6:
```sql
sessions(id, source, user_id, model, model_config, system_prompt,
         parent_session_id, started_at, ended_at, end_reason,
         message_count, tool_call_count, input_tokens, output_tokens,
         cache_read_tokens, cache_write_tokens, reasoning_tokens,
         billing_provider, billing_base_url, billing_mode,
         estimated_cost_usd, actual_cost_usd, cost_status, title)

messages(id, session_id, role, content, tool_call_id, tool_calls, tool_name,
         timestamp, token_count, finish_reason, reasoning, reasoning_details,
         codex_reasoning_items)

-- FTS5 virtual table for cross-session full-text search
messages_fts USING fts5(content, content=messages, content_rowid=id)
```

Triggers keep `messages_fts` in sync. The `session_search` tool surfaces this to the agent as a native skill. `parent_session_id` chains sessions split by context compression. `source` tags sessions by platform (`cli`, `telegram`, `discord`, etc.).

Write contention: WAL mode + app-level retry with random jitter (15 retries, 20–150 ms backoff). Checkpoint every 50 writes (verified from `hermes_state.py`).

### 2.3 Skill Format

Skills live in `~/.hermes/skills/` (user-created), bundled in `/root/hermes-agent/skills/` (Nous Research), and `~/.hermes/skills/hub/` (community installs from agentskills.io). A skill is a directory with at minimum a `SKILL.md`:

```
my-skill/
├── SKILL.md          # Markdown with YAML frontmatter — the skill payload
├── references/       # Static reference files
├── templates/        # Output templates
├── scripts/          # Bash / Python scripts the skill invokes
└── assets/           # Images, configs, etc.
```

`SKILL.md` frontmatter (verified from `agent/skill_utils.py`):
```yaml
---
name: obsidian
description: Read, search, and create notes in the Obsidian vault.
platform: linux           # optional: restrict to OS
conditions:               # optional: only activate when env var set
  - env: OBSIDIAN_VAULT_PATH
metadata:
  hermes:
    config:               # config values the skill needs injected at load time
      - key: VAULT
        env: OBSIDIAN_VAULT_PATH
        default: ~/Documents/Obsidian Vault
---
```

Skills are **procedural memory** — `SKILL.md` body is executable documentation: shell commands, API call patterns, gotchas. The agent injects skill content as a user message (not system prompt) to preserve Anthropic prefix caching (verified from `agent/skill_commands.py`).

### 2.4 Cron Job Record (`cron/jobs.py`)

Stored in `~/.hermes/cron/jobs.json`. Job dict shape:
```python
{
  "id": "uuid",
  "name": "Nightly bug fix",
  "prompt": "Pull the top bug, attempt a fix, open a draft PR.",
  "schedule": {
    "kind": "cron",            # "once" | "interval" | "cron"
    "expr": "0 2 * * *",       # for kind=cron
    "minutes": 30,             # for kind=interval
    "run_at": "2026-04-19T...", # for kind=once
    "display": "0 2 * * *"
  },
  "skills": ["github", "devops"],   # list of skill slugs to load
  "skill": "github",                # legacy single-skill field (kept for back-compat)
  "deliver": "telegram",            # delivery platform
  "last_run": "2026-04-18T02:00Z",
  "next_run": "2026-04-19T02:00Z",
  "created_at": "2026-04-10T...",
}
```

Output saved to `~/.hermes/cron/output/{job_id}/{timestamp}.md` (verified from `cron/jobs.py`).

### 2.5 Memory Files

- `~/.hermes/MEMORY.md` — free-form declarative memory. Agent writes to it via `memory` tool.
- `~/.hermes/USER.md` — user profile facts. Agent extracts from conversation.
- External via plugin: Honcho peer cards + conclusions (see §9).

### 2.6 Gateway Message Types

Gateway session state in `gateway/session.py`; dispatch in `gateway/run.py`. An agent session in the gateway is keyed by `(platform, channel_id)`. The session cache caps at 128 agents with 1-hour idle TTL eviction (verified from `gateway/run.py`). Platform adapters translate native events to `(user_id, channel_id, text, attachments)` and call the shared `GatewayRunner.handle_message()` method.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           HERMES AGENT SYSTEM                               │
├──────────────┬──────────────────────────────┬────────────────────────────── ┤
│  TUI / CLI   │      Messaging Gateway        │   ACP Server (Editor Bridge) │
│  (cli.py     │      (gateway/run.py)          │   (acp_adapter/server.py)   │
│   ui-tui/)   │      Platforms:               │   VS Code / Zed / JetBrains  │
│              │      Telegram, Discord,        │   agent-client-protocol      │
│  prompt_    │      Slack, WhatsApp, Signal,  │                              │
│  toolkit     │      Matrix, DingTalk, Feishu, │   MCP Server                 │
│  + Ink (TSX) │      WeCom, WeChat, Email, SMS,│   (mcp_serve.py)            │
│  + JSON-RPC  │      Mattermost, Home Asst,   │   conversations_list,        │
│  bridge      │      Webhook, QQBot, BBubbles │   messages_send, events_poll │
├──────────────┴──────────────────────────────┴───────────────────────────────┤
│                              AIAgent (run_agent.py)                          │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │MemoryManager│  │ContextEngine │  │PromptBuilder   │  │SmartRouting    │  │
│  │(builtin +  │  │(Compressor or│  │(system prompt, │  │(cheap vs.strong│  │
│  │ 1 external)│  │ plugin)      │  │ context files, │  │ model per turn)│  │
│  └────────────┘  └──────────────┘  │ skill index)   │  └────────────────┘  │
│                                    └────────────────┘                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      Tool Registry (tools/registry.py)                │  │
│  │  web_search, web_extract, terminal, process, read_file, write_file,   │  │
│  │  patch, search_files, vision_analyze, image_generate, skills_list,    │  │
│  │  skill_view, skill_manage, browser_*, text_to_speech, todo, memory,   │  │
│  │  session_search, clarify, execute_code, delegate_task, cronjob,       │  │
│  │  send_message, ha_* (Home Assistant), mcp_* (MCP client, ~1050 lines) │  │
│  └──────────────────────────────────────────────────────────────────────-┘  │
├──────────────────────────────────────────────────────────────────────────── ┤
│              Terminal Backends (tools/environments/)                         │
│  local.py │ docker.py │ ssh.py │ daytona.py │ singularity.py │ modal.py     │
├──────────────────────────────────────────────────────────────────────────── ┤
│                    Credential Pool (agent/credential_pool.py)                │
│  fill_first | round_robin | random | least_used — per-provider pools        │
│  OAuth token refresh, API key rotation, 429/402 cooldown (1hr TTL)          │
├──────────────────────────────────────────────────────────────────────────── ┤
│    Cron Scheduler (cron/)         │  Session DB (hermes_state.py)           │
│    tick() every 60 s (gateway)    │  SQLite WAL + FTS5, ~/.hermes/state.db  │
├──────────────────────────────────────────────────────────────────────────── ┤
│    Memory Plugins (plugins/memory/)                                          │
│    builtin | honcho | hindsight | mem0 | supermemory | openviking |          │
│    byterover | holographic | retaindb                                        │
├──────────────────────────────────────────────────────────────────────────── ┤
│    Context Engine Plugins (plugins/context_engine/)                          │
│    compressor (default) | lcm (optional plugin)                              │
└──────────────────────────────────────────────────────────────────────────── ┘
```

### 3.1 TUI

Two implementations:
- **Classic (prompt_toolkit)**: `cli.py` + `HermesCLI`, output via Rich panels. Active by default.
- **Ink TUI (TypeScript)**: `ui-tui/` activated by `--tui` or `HERMES_TUI=1`. TypeScript/Ink owns the screen; Python owns sessions, tools, model calls. Bridge: newline-delimited JSON-RPC over stdio. Python side in `tui_gateway/server.py`.

Skin engine (`hermes_cli/skin_engine.py`) provides data-driven theming — skins are pure YAML data. Built-in: `default`, `ares`, `mono`, `slate`. Users drop custom YAML into `~/.hermes/skins/<name>.yaml`.

### 3.2 Gateway

`GatewayRunner` in `gateway/run.py` starts all configured platform adapters as async tasks. Each platform adapter in `gateway/platforms/` extends `BasePlatform` and translates native events to the shared dispatch path. Voice memos are transcribed (STT). Session state is an LRU cache of `AIAgent` instances (128 max, 1-hour TTL). Slash commands are handled before agent dispatch; a `COMMAND_REGISTRY` in `hermes_cli/commands.py` is the single source of truth — CLI help, Telegram BotCommand menus, Slack subcommand routing, and autocomplete all derive from it automatically.

### 3.3 Terminal Backends

All in `tools/environments/`. Each exposes a common interface: `run_command(cmd)`, `write_file(path, content)`, `read_file(path)`. The active backend is set by `terminal.env` in config.

| Backend | Key feature | Use case |
|---|---|---|
| `local.py` | Direct subprocess | Developer laptop |
| `docker.py` | Containerised sandbox | Isolation + repeatability |
| `ssh.py` | Remote shell via Paramiko | VPS / cloud VM |
| `daytona.py` | Serverless dev environment | Hibernation between sessions |
| `singularity.py` | HPC container runtime | GPU clusters |
| `modal.py` / `managed_modal.py` | Serverless Python | Cheap idle cost |

Daytona and Modal are the "costs nearly nothing when idle" backends mentioned in the README — the agent's environment hibernates and wakes on demand.

### 3.4 Model Routing

`agent/smart_model_routing.py` implements a conservative cheap-vs-strong router. If `routing.enabled` is true and the message has no signs of complex work (no URLs, no keywords from `_COMPLEX_KEYWORDS`: debug, implement, refactor, terminal, docker, delegate, cron, etc.), the turn is routed to `cheap_model`. If the message mentions any of those keywords or is long, the primary (strong) model is used. The routing decision is per-turn and transparent to the user.

The credential pool (`agent/credential_pool.py`) supports multiple API keys per provider with four selection strategies: `fill_first`, `round_robin`, `random`, `least_used`. Exhausted credentials (429 or 402) enter a 1-hour cooldown. OAuth tokens are auto-refreshed with CODEX skew compensation.

### 3.5 Context Engine

Abstract base `agent/context_engine.py`. Default implementation: `agent/context_compressor.py`. Plugin implementations in `plugins/context_engine/`. Active engine selected by `context.engine` config key. The compressor fires when prompt tokens exceed `threshold_percent` (75%) of the model's context window. It summarizes the middle of the conversation using an auxiliary (cheap) LLM, preserving the head and a token-budget tail. Summary is prefixed with a "handoff framing" message to prevent the model from re-attempting resolved tasks.

---

## 4. The Learning Loop

This is Hermes's **distinctive claim**: the agent improves with use rather than resetting to a blank slate each session.

### 4.1 Memory Nudge

Every `memory.nudge_interval` user turns (default: 10), a background review agent is spawned. This is a full `AIAgent` fork using `_spawn_background_review()` in `run_agent.py`. The review agent receives the full conversation snapshot and a structured prompt:

```
"Review the conversation above and consider saving to memory if appropriate.
Focus on: Has the user revealed things about themselves — their persona, desires,
preferences, or personal details worth remembering? Has the user expressed
expectations about how you should behave, their work style?"
```

If something stands out, it writes to `MEMORY.md` / `USER.md` via the `memory` tool. The review agent never produces user-visible output and never modifies the main conversation history (verified from `run_agent.py` lines 2448–2490).

### 4.2 Skill Creation / Improvement Nudge

Every `skills.creation_nudge_interval` tool-intensive turns (default: 10 tool-calling iterations), a skill review is triggered alongside or instead of the memory review:

```
"Review the conversation above and consider saving or updating a skill if appropriate.
Focus on: was a non-trivial approach used to complete a task that required trial and
error, or changing course due to experiential findings along the way? If a relevant
skill already exists, update it. Otherwise, create a new skill if reusable."
```

The background review agent uses `skill_manage` (create/edit/patch) to write or update `SKILL.md` files under `~/.hermes/skills/`. New skills are security-scanned by `tools/skills_guard.py` before being committed (same scrutiny as community hub installs).

Skill improvement in use: When a skill is invoked and the approach requires correction, the next nudge cycle detects the change and patches the skill. Skills **self-improve from lived experience**.

### 4.3 FTS5 Session Search

`session_search` tool (backed by `messages_fts` FTS5 table in `hermes_state.py`) gives the agent cross-session recall. It can query "what approach did we use for the Kubernetes deployment last week?" and retrieve relevant message excerpts from past sessions. Combined with the `title_generator.py` auto-titling, sessions become searchable by subject matter.

### 4.4 Honcho Integration

The `honcho` memory plugin (`plugins/memory/honcho/__init__.py`) exposes four tools to the agent:
- `honcho_profile` — read/write peer cards (hard-coded facts about the user or AI)
- `honcho_search` — semantic search over stored context (fast, no LLM synthesis)
- `honcho_context` — retrieve session context window (messages + summary + representation)
- `honcho_reasoning` (implied by README) — dialectic Q&A against the user model

Hermes manages Honcho config in `~/.hermes/honcho.json` (profile-scoped). The `hermes honcho` subcommand (`hermes_cli/main.py`) handles setup, peer naming, reasoning level, token budgets, session-directory mapping, and mode selection (`hybrid` | `honcho` | `local`). Memory mode `hybrid` uses both builtin MEMORY.md and Honcho; `honcho` uses Honcho only; `local` uses only MEMORY.md.

---

## 5. Subagent / Delegation Protocol

`tools/delegate_tool.py` spawns child `AIAgent` instances for parallel workstreams.

**What the child gets:**
- Fresh conversation (no parent history)
- Own `task_id` (own terminal session, file ops cache)
- Restricted toolset (configurable, always strips `DELEGATE_BLOCKED_TOOLS`)
- Focused system prompt built from the delegated goal + context

**Blocked tools for children** (verified from `delegate_tool.py`):
```python
DELEGATE_BLOCKED_TOOLS = frozenset([
    "delegate_task",   # no recursive delegation beyond depth 2
    "clarify",         # no user interaction from child
    "memory",          # no writes to shared MEMORY.md
    "send_message",    # no cross-platform side effects
    "execute_code",    # children use terminal not code sandbox
])
```

**Max depth**: 2 (parent → child → grandchild rejected). Max concurrent children: default 3, configurable via `delegation.max_concurrent_children` in config or `DELEGATION_MAX_CONCURRENT_CHILDREN` env var.

The parent's context sees only: the delegation call and a summary result. Child intermediate tool calls and reasoning are invisible to the parent, keeping the parent context lean. Results are returned as a JSON string.

`_run_single_child()` saves and restores `_last_resolved_tool_names` (process-global) around each child run to prevent cross-contamination.

---

## 6. Cron / Scheduling Subsystem

`cron/jobs.py` stores jobs in `~/.hermes/cron/jobs.json`. `cron/scheduler.py` provides `tick()` called every 60 seconds from the gateway's background thread.

**Schedule kinds** (verified from `cron/jobs.py`):
```python
# "once" — run_at ISO timestamp
"30m"                → once in 30 minutes (runs_at = now + 30m)
"2026-04-19T14:00"   → once at absolute timestamp

# "interval" — recurring with fixed gap
"every 30m"          → every 30 minutes
"every 2h"           → every 2 hours

# "cron" — standard 5-field cron expression (requires croniter)
"0 9 * * *"          → every day at 09:00
```

A job can specify `skills` (list of skill slugs to load before executing), `deliver` (platform name — telegram, discord, slack, etc.), and an arbitrary `prompt`. The scheduler spawns a fresh `AIAgent` for each job run. Output is saved as Markdown to `~/.hermes/cron/output/{job_id}/{timestamp}.md`.

Delivery targets support home channels: `TELEGRAM_HOME_CHANNEL`, `DISCORD_HOME_CHANNEL`, etc. (verified from `cron/scheduler.py`). File-based lock (`~/.hermes/cron/.tick.lock`) prevents overlapping tick runs.

---

## 7. Tool / Plugin System

### 7.1 Tool Registry (`tools/registry.py`)

All tools call `registry.register()` at import time. No manual import list — any `tools/*.py` with a `registry.register()` call is auto-discovered. Each registration supplies:
```python
registry.register(
    name="example_tool",
    toolset="example",
    schema={"name": ..., "description": ..., "parameters": {...}},
    handler=lambda args, **kw: ...,     # must return JSON string
    check_fn=check_requirements,        # returns bool — gates availability
    requires_env=["EXAMPLE_API_KEY"],
)
```

### 7.2 Toolsets (`toolsets.py`)

`_HERMES_CORE_TOOLS` lists the default enabled tools for all platforms. `TOOLSETS` dict groups tools into named sets for scenario-based activation (`web`, `search`, `files`, `browser`, `research`, `coding`, `full_stack`, etc.). Tools can be enabled/disabled per-platform via `hermes tools`.

### 7.3 MCP Client (`tools/mcp_tool.py`, ~1050 lines)

Hermes is an MCP **client** — it can connect to any external MCP server and expose its tools as first-class Hermes tools. Config via `hermes mcp` or `~/.hermes/mcp_servers.json`.

### 7.4 MCP Server (`mcp_serve.py`)

Hermes is also an MCP **server** — `hermes mcp serve` starts a stdio MCP server exposing 10 tools: `conversations_list`, `conversation_get`, `messages_read`, `attachments_fetch`, `events_poll`, `events_wait`, `messages_send`, `permissions_list_open`, `permissions_respond`, `channels_list`. Allows any MCP-capable editor (Claude Code, Cursor, Codex) to send messages through Hermes's gateway.

### 7.5 ACP Adapter (`acp_adapter/server.py`)

`hermes acp` runs Hermes as an ACP server (Agent Client Protocol, used by VS Code, Zed, JetBrains). Exposes `AgentCapabilities` including session fork, list, resume, model switching, MCP server pass-through, and streaming tool progress events.

### 7.6 agentskills.io Compatibility

Skills in the bundled `skills/` directory follow the SKILL.md + frontmatter format that is the open standard for the agentskills.io Skills Hub. `hermes_cli/skills_hub.py` implements hub search, install, and browser. Community skills go to `~/.hermes/skills/hub/`. Security scanning in `tools/skills_guard.py` runs on all hub-sourced installs.

---

## 8. DIKW-T Mapping

Hermes is the **stage-promotion engine** for the Cloud Knowledge Platform's DIKW-T pyramid. Every component in Hermes maps to a distinct stage.

| DIKW-T stage | CKP folder | Hermes component | Mechanism |
|---|---|---|---|
| **Data** | `inbox/` | File watcher trigger | A raw file arrives in `inbox/`. The watcher enqueues it for Hermes processing. No Hermes capability involved yet — Data is pre-Hermes. |
| **Information** | `notes/` | Hermes invocation input | The CKP backend calls `hermes-agent process --input <file> --output-dir knowledge/ --project <slug>`. Hermes reads the Information-stage file and reasons over it. |
| **Knowledge** | `knowledge/` | `AIAgent.run_conversation()` output | Hermes writes synthesised, evergreen Markdown to `knowledge/`. This is the primary subprocess contract (`backend/app/hermes.py`). The agent uses `write_file`, `patch`, or `skill_manage` tools to produce structured output. |
| **Wisdom + Time** | `wisdom/` + Git log | Skill system + session memory | A "wisdom mode" Hermes invocation reads `knowledge/` + `git log` diffs, then writes comparative analysis to `wisdom/`. The agent's session search (FTS5) and skill memory accumulate the platform's **T** (temporal) dimension across invocations. |
| **Cross-session T** | Git history (all folders) | `hermes_state.py` session chain | `parent_session_id` chains in the session DB mirror Git's commit chain. Cross-session FTS5 search (`session_search` tool) is the agent-side analogue of `git log --grep`. |

**Learning loop as DIKW-T promoter:**

The background skill review (§4.2) is Hermes's endogenous Wisdom production: proven approaches become skills, skills become part of the system prompt, the system prompt shapes future Knowledge outputs. The loop is:

```
inbox/ (Data) ──► Hermes process ──► knowledge/ (Knowledge)
                          │
             [nudge: skill review]
                          │
                          ▼
              ~/.hermes/skills/ (Wisdom about how to produce Knowledge)
```

Honcho's dialectic user model maps onto the DIKW-T pyramid at the Information → Knowledge boundary: Conclusions (atomic facts extracted from conversation) are Information; the Representation (synthesised user profile) is Knowledge; the Dream consolidation pass is a micro-Wisdom event within a single user's model.

| Honcho concept | DIKW-T analog | Hermes plugin surface |
|---|---|---|
| Message | Data | `honcho_context` prefetch |
| Conclusion | Information | Auto-extracted by Honcho workers |
| Representation | Knowledge | `honcho_profile` read |
| Dream consolidation | Wisdom | Triggered by Honcho SDK in background |

---

## 9. Recommended Tech Stack for Replication

| Layer | Technology | Purpose |
|---|---|---|
| Core agent loop | Python 3.11+, `openai` SDK (OpenAI-compatible) | `run_agent.py` pattern: while loop, tool dispatch, OpenAI message format |
| Session store | SQLite WAL + FTS5 | Cross-session recall, cost tracking, context chains |
| CLI / TUI | `prompt_toolkit` (classic) or Ink/TSX + JSON-RPC (modern) | Interactive terminal with autocomplete |
| Gateway | `asyncio`, platform SDKs (python-telegram-bot, discord.py, slack_sdk) | Multi-platform message dispatch |
| Memory | Flat Markdown (MEMORY.md) + Honcho SDK for dialectic modeling | Declarative + semantic memory |
| Skills | SKILL.md YAML frontmatter + Markdown body | Procedural memory store |
| Scheduling | `croniter`, SQLite jobs table, file lock | Recurring & one-shot tasks |
| Terminal backends | `subprocess` (local), `docker` SDK, `paramiko` (SSH), Modal SDK | Pluggable compute |
| Credential pool | Python `dataclass` + `threading.Lock`, cooldown dict | Multi-key failover |
| Context engine | Token counting + LLM-based summarization | Context window management |
| MCP client | `mcp` Python SDK | Tool extension via MCP protocol |
| Security | Pattern-matching scanner for skills (`skills_guard.py`) | Prevent prompt injection via skills |
| Config | YAML (`config.yaml`) + dotenv (`.env`) | Separation of settings and secrets |

---

## 10. Implementation Priorities (Build Order)

### Phase 1: Core Agent Loop (Week 1–2)
- `AIAgent` class with OpenAI-compatible client, `run_conversation()` loop
- Tool registry with `registry.register()` autodiscovery
- Basic tool set: `terminal` (local subprocess only), `read_file`, `write_file`, `web_search`
- SQLite session store (no FTS5 yet) for conversation persistence

### Phase 2: Memory + Skills (Week 3–4)
- MEMORY.md / USER.md read/write tools
- Skill loading from SKILL.md files (frontmatter + body)
- Periodic memory nudge (background review agent, N-turn trigger)
- FTS5 index on messages for `session_search` tool

### Phase 3: Gateway (Week 5–6)
- `GatewayRunner` with Telegram adapter (simplest to test)
- LRU session cache (platform + channel_id keyed)
- Shared slash command registry across CLI and gateway
- Add Discord, Slack adapters following same base

### Phase 4: Scheduling + Delegation (Week 7–8)
- Cron jobs storage, `parse_schedule()`, scheduler `tick()`
- `delegate_task` tool with depth limit and blocked tool list
- Multi-platform delivery for cron output

### Phase 5: Advanced (Week 9+)
- Smart model routing (cheap vs. strong)
- Credential pool with failover strategies
- Additional terminal backends (Docker, SSH, Modal)
- Honcho memory plugin integration
- MCP client and MCP server
- ACP adapter for editor integration
- Skill improvement loop (background skill review)
- Context engine plugin interface

---

## 11. Critical Design Patterns

### Pattern 1: Registry-at-Import with Auto-Discovery
Tool registration via `registry.register()` at module-level means adding a new tool requires exactly two file changes: create `tools/your_tool.py` and add the name to `toolsets.py`. The registry handles dispatch, schema collection, availability checking, and error wrapping automatically. No manual import lists to maintain.

### Pattern 2: Background Review Agents (Fork-and-Forget)
Memory and skill reviews are done by forking a full `AIAgent` instance in a daemon thread after each conversation turn. The fork receives the conversation snapshot + a structured review prompt. It writes directly to shared stores. It produces no user-visible output and never modifies the main history. This pattern decouples learning from the hot path — the user sees no latency from memory maintenance.

### Pattern 3: Session Prompt Caching Discipline
The system prompt is built once per session and never rebuilt mid-conversation (only after context compression events). Skill content is injected as a **user message** (not system prompt) to preserve the Anthropic prefix cache. Config changes, tool additions, and memory reloads all wait for the next session. Any deviation causes a cache miss with dramatically higher costs. This is enforced as a documented policy in `AGENTS.md`.

### Pattern 4: Profile-Scoped State
`HERMES_HOME` env var (set before any module import by `_apply_profile_override()` in `hermes_cli/main.py`) determines the root of all state. Every path is computed via `get_hermes_home()` from `hermes_constants.py`. This gives complete multi-instance isolation: different agents, different users, different credentials, all co-existing on the same machine. Rule: never hardcode `~/.hermes`.

### Pattern 5: Provider-Agnostic OpenAI Surface
The agent loop uses the `openai` Python SDK against any OpenAI-compatible base URL. Provider selection (Anthropic, OpenRouter, NIM, etc.) is a config key, not code. New providers require zero code changes — just `base_url` + `api_key` in `.env`. This is why Hermes can run on "200+ models" without provider-specific adapters.

### Pattern 6: Shallow Slash Command Registry
`COMMAND_REGISTRY` in `hermes_cli/commands.py` is a list of `CommandDef` objects. Every surface that needs slash commands (CLI autocomplete, gateway help, Telegram menus, Slack routing) derives from this single source. Adding a new command in one place automatically propagates to all surfaces. The `gateway_config_gate` field allows conditional availability without branching.

### Pattern 7: File Lock for Scheduler Exclusion
The cron scheduler uses a file-based lock (`~/.hermes/cron/.tick.lock`) so that multiple gateway processes (e.g., CLI + gateway running simultaneously) cannot overlap tick runs. This is the correct solution for multi-process Python without a shared in-process scheduler — no Redis, no separate cron daemon required.

---

## 12. External Links & References

### Hermes Agent
- Repository: https://github.com/NousResearch/hermes-agent
- Documentation: https://hermes-agent.nousresearch.com/docs/
- Skills Hub: https://agentskills.io
- Discord: https://discord.gg/NousResearch
- License: MIT

### Integrations
- Honcho (dialectic user modeling): https://github.com/plastic-labs/honcho
- OpenRouter (multi-provider): https://openrouter.ai
- Daytona (serverless dev env): https://daytona.io
- Modal (serverless Python): https://modal.com
- MCP Protocol: https://modelcontextprotocol.io
- ACP Protocol: https://github.com/i-am-bee/agent-client-protocol

### Our Platform
- Architecture: `docs/architecture.md`
- DIKW-T Spec: `docs/dikw-t.md`
- Hermes Contract: `docs/hermes-contract.md`
- Hermes Bridge: `backend/app/hermes.py`
- Honcho Blueprint: `reference/honcho/platform_blueprint.md`
