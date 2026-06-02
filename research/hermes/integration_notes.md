# Hermes Agent: Integration Notes

How the Cloud Knowledge Platform currently invokes Hermes, how the real Hermes Agent CLI differs from our stub contract, and what a full-fat integration would look like.

Cross-references: `docs/hermes-contract.md` (our contract spec), `backend/app/hermes.py` (our bridge), `docs/dikw-t.md` (stage definitions), `reference/hermes/platform_blueprint.md` (Hermes internals).

---

## 1. Current Contract (What We Invoke Today)

Defined in `docs/hermes-contract.md`, implemented in `backend/app/hermes.py`:

```bash
<CKP_HERMES_BIN> process \
  --input   /abs/path/to/vault/inbox/<source>.md \
  --output-dir /abs/path/to/vault/knowledge/ \
  --project <slug>
```

Our bridge (`backend/app/hermes.py`):
- Runs in a thread pool (2 workers)
- Retries up to 3× with exponential backoff (2s, 4s, 8s)
- 120s timeout per file (overridable via `CKP_HERMES_TIMEOUT`)
- Detects new `.md` files written to `knowledge/` by diffing before/after
- Emits SSE events on every state change (`queued → running → ok/failed`)
- Accepts any binary on `CKP_HERMES_BIN` — stub passthrough or real Hermes Agent

---

## 2. Does the Real Hermes CLI Have a `process` Subcommand?

**No.** The real Hermes Agent CLI (`hermes_cli/main.py`) does not expose a `process` subcommand. The actual CLI surface is:

```bash
hermes                     # Interactive chat (default)
hermes chat                # Interactive chat
hermes gateway             # Run messaging gateway
hermes setup               # Setup wizard
hermes model               # Choose LLM provider/model
hermes tools               # Configure tools
hermes config set          # Set config values
hermes cron                # Manage cron jobs
hermes honcho              # Manage Honcho integration
hermes sessions browse     # Session picker
hermes acp                 # ACP server for editor integration
hermes mcp serve           # MCP server
hermes doctor              # Diagnose issues
hermes update              # Update Hermes
```

There is no `hermes process` subcommand. Our `docs/hermes-contract.md` defines a **custom CLI surface** that was designed for this platform's subprocess contract — it is not part of the upstream Hermes Agent binary.

---

## 3. Mapping: Our Contract vs. Real Hermes CLI

| Our contract | Real Hermes equivalent | Notes |
|---|---|---|
| `hermes-agent process --input X --output-dir Y --project Z` | No direct equivalent | Would need a wrapper script or custom entry point |
| Single file in, zero or more files out | Hermes's `run_conversation()` can write files via `write_file` tool | Needs a specific prompt directing output to `--output-dir` |
| Exit 0 = success, non-zero = failure | Hermes exits 0 by default; non-zero on unhandled exception | The contract exit semantics can be approximated |
| stdout/stderr for logging | `hermes_logging.py` + Python `logging` module | Logging level controlled by `HERMES_LOG_LEVEL` |
| 120s timeout | No built-in per-invocation timeout; `--max-iterations` caps tool calls | Need external `timeout(1)` or `subprocess.run(timeout=...)` |
| Idempotent: re-running same input is no-op or overwrites | Hermes will re-process — whether it overwrites depends on the prompt | Build idempotence into the prompt |

---

## 4. Minimum Integration Path

### Option A: Keep Our Stub Contract, Write a Wrapper Script (Recommended Near-Term)

Create a script `hermes-agent` (or whatever `CKP_HERMES_BIN` points to) that:

1. Parses `process --input X --output-dir Y --project Z`
2. Constructs a task prompt for the real Hermes Agent
3. Invokes `hermes chat` (or the Python API directly) with that prompt
4. Exits 0/non-zero based on success

Minimal wrapper skeleton:
```bash
#!/usr/bin/env bash
set -euo pipefail
INPUT="" OUT="" PROJECT=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --input) INPUT="$2"; shift 2;;
    --output-dir) OUT="$2"; shift 2;;
    --project) PROJECT="$2"; shift 2;;
    process) shift;;
    *) shift;;
  esac
done

PROMPT="You are a knowledge synthesis agent. Read the file at '${INPUT}' and
produce one or more evergreen knowledge documents in the directory '${OUT}'.
Project: ${PROJECT}. Each output file should be a .md file with YAML frontmatter
(title, tags, source) and synthesised content. Do not echo the input — extract
insights, patterns, and actionable knowledge."

python -c "
import sys
sys.path.insert(0, '/path/to/hermes-agent')
from run_agent import AIAgent
agent = AIAgent(quiet_mode=True, skip_context_files=True, skip_memory=True)
result = agent.chat('''${PROMPT}''')
" || exit 1
```

This keeps `backend/app/hermes.py` unchanged and decouples the platform from Hermes internals.

### Option B: Import the Python API Directly

`backend/app/hermes.py` can import and call `AIAgent` without subprocess:

```python
# In _run() replace subprocess.run(...) with:
import sys
sys.path.insert(0, settings.hermes_source_dir)  # new config key
from run_agent import AIAgent

agent = AIAgent(
    quiet_mode=True,
    skip_context_files=True,
    skip_memory=False,          # keep memory for cross-file learning
    max_iterations=40,
)
prompt = (
    f"Read {src} and write synthesised knowledge documents to {knowledge_dir}. "
    f"Project: {slug}. Each output file must be a .md file with frontmatter."
)
result = agent.chat(prompt)
```

**Tradeoff**: Tighter coupling (Hermes package must be importable from the CKP venv), but no subprocess overhead and cleaner error propagation. The `AIAgent.chat()` return is the final response string — check it for error markers.

### Option C: Adopt Hermes's `hermes chat` CLI with a Prompt File

```bash
echo "Read ${INPUT}, write knowledge outputs to ${OUT}, project ${PROJECT}." \
  | timeout ${CKP_HERMES_TIMEOUT:-120} hermes chat --quiet --no-memory
```

Not the cleanest integration but requires no wrapper scripts if `hermes` is on PATH.

---

## 5. Wisdom-Mode Integration

The DIKW-T spec (`docs/dikw-t.md`) defines a "wisdom mode" where Hermes reads `knowledge/` + Git history and writes `wisdom/`. This maps directly to Hermes's existing capabilities:

**Wisdom invocation (proposed):**
```bash
hermes-agent wisdom \
  --knowledge-dir /path/to/vault/knowledge \
  --git-dir       /path/to/vault/.git \
  --output-dir    /path/to/vault/wisdom \
  --project       <slug>
```

Under the hood, a wisdom-mode prompt would:
1. Use `session_search` tool to retrieve past Hermes outputs for this project
2. Use `terminal` tool to run `git log --oneline -- knowledge/` and `git diff` between versions
3. Synthesise comparative analysis: "We used to do X (commit A), switched to Y (commit B) after ..."
4. Write Markdown to `wisdom/` via `write_file` tool

**Hermes's learning loop as Wisdom producer**: The skill improvement mechanism (§4.2 of the blueprint) is already a form of Wisdom production — proven approaches become persistent skills. The skill store (`~/.hermes/skills/`) functions as the agent's `wisdom/` layer. A full integration would:
- Mirror agent-created skills back to the vault's `wisdom/agent-skills/` directory
- Tag each skill file with the Git commit that motivated its creation

**Honcho as Wisdom accelerator**: When Honcho's Dream consolidation (`honcho.schedule_dream()`) runs after a significant Hermes session, it consolidates Conclusions about the project into a higher-level Representation. That Representation can be written to `wisdom/user-model.md` by the Honcho memory plugin's `on_session_end()` hook — giving the wisdom folder a user-facing layer alongside the knowledge evolution layer.

---

## 6. Auth / Credential Considerations

| Concern | Current (stub) | Full Hermes integration |
|---|---|---|
| LLM API key | Not needed (stub doesn't call LLMs) | `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` in `~/.hermes/.env` or `CKP_HERMES_BIN`'s environment |
| Hermes config dir | N/A | `HERMES_HOME` env var — set to an isolated path per CKP deployment to avoid colliding with a developer's personal Hermes install |
| Per-project isolation | N/A | Use Hermes profiles: `hermes -p <project-slug> chat ...` — each project gets its own `~/.hermes/profiles/<slug>/` with separate memory, skills, and session history |
| Gateway token conflicts | N/A | Gateway platform tokens are scoped per profile via `acquire_scoped_lock()` — no conflicts if profiles are used per project |
| Memory leakage across projects | N/A | `skip_memory=True` in subprocess mode prevents cross-project contamination; or use separate profiles |
| Skill contamination | N/A | Skills installed per profile are isolated; bundled skills are read-only and shared |

**Recommended credential setup for CKP-managed Hermes:**
```bash
export HERMES_HOME=/opt/ckp/hermes-data/profiles/${PROJECT_SLUG}
export ANTHROPIC_API_KEY=${CKP_LLM_KEY}
hermes-agent-wrapper process --input ... --output-dir ... --project ...
```

This gives each project a hermetically isolated Hermes instance with its own memory and skill store, at the cost of some disk space per profile.

---

## 7. Migration Checklist

Moving from stub contract to real Hermes Agent:

- [ ] Install Hermes Agent: `pip install hermes-agent` or clone + `setup-hermes.sh`
- [ ] Set `CKP_HERMES_BIN` to point to the wrapper script or `hermes` binary
- [ ] Set `HERMES_HOME` to a CKP-managed path (not `~/.hermes`)
- [ ] Configure `~/.hermes/config.yaml` with LLM provider and model
- [ ] Write the wrapper script that accepts `process --input --output-dir --project`
- [ ] Verify idempotence: running the same input twice should overwrite the same output file (enforce in the prompt)
- [ ] Test the SSE event flow: `backend/app/hermes.py` emits events on job state; the dashboard should still see `queued → running → ok`
- [ ] (Optional) Implement wisdom mode: separate `hermes-agent wisdom` wrapper + `wisdom/` output dir in `backend/app/hermes.py`
- [ ] (Optional) Enable Honcho integration: `hermes honcho setup` per project profile
