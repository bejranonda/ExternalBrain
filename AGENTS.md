# Contributor & AI-agent guide

You are working in the **External Brain** repository — an MCP server + webapp
that captures knowledge from AI coding sessions and serves it back as typed
skills and a grounded Oracle. This file orients humans and AI assistants
(Claude Code, Gemini CLI, Cursor, Windsurf, Google Antigravity, GitHub Copilot,
etc.) before their first edit.

`CLAUDE.md` and `GEMINI.md` are symlinks to this file — edit `AGENTS.md` and
the changes propagate. Maintainers running a live deployment may also keep a
gitignored `CLAUDE.local.md` with environment-specific rules; if present, it
takes precedence for that checkout.

---

## What this repo is

A self-hostable platform with two faces:

- An **MCP server** any AI coding tool connects to (Bearer-authenticated). It
  injects relevant past knowledge before a task and records the outcome after.
- A **webapp** to browse captured Skills, ask the Oracle, and manage tokens.

A background worker runs the intelligence pipeline (extraction, decay,
embeddings). Everything ships as Docker Compose so a fork can run its own
instance on a single VM.

---

## Repo layout

```
apps/
  web/                   # Next.js webapp — dashboard, Oracle, Skills, settings
  mcp-server/            # MCP server (stdio + HTTP) — exposes the brain_* tools
  worker/                # pg-boss background jobs (extraction, decay, embeddings)
  sync-bridge/           # Optional CouchDB LiveSync for Obsidian
packages/
  core/                  # Intelligence layer (extraction, retrieval, Oracle)
  db/                    # Prisma schema + client
  types/                 # Cross-package TypeScript types
deploy/                  # docker-compose, Caddyfile, Dockerfile
scripts/                 # dev-up.sh / deploy.sh / reload.sh / verify-lockdown.sh
docs/                    # Documentation (see the index below)
REBUILD/                 # Phase-by-phase vibe-coding guide — start at REBUILD/00-START-HERE.md
```

**Package boundary rule:** `types → db → core → (mcp-server | web | worker)`.
Apps must not import from each other; share via a package. Violations fail CI.

---

## Contributing workflow (fork & PR)

This is a standard GitHub flow — fork it and build your own, or contribute back:

1. Fork the repo and branch from `main`: `feature/<slug>`, `bugfix/<slug>`,
   or `docs/<slug>`.
2. Make the change. Keep one logical change per PR.
3. Run the gates locally (below) and open a PR. CI re-runs them as the hard gate.
4. Write an honest test plan (see below).

Branch → PR → review is the whole flow. How you deploy your own fork is up to
you (single Docker Compose stack; see `docs/QUICKSTART.md`).

---

## Common commands

```bash
# Install + generate the Prisma client
pnpm install
pnpm --filter @brain/db exec prisma generate

# Workspace gates (what CI runs)
pnpm turbo run typecheck
pnpm turbo run test
pnpm turbo run build

# Run your own instance locally (Docker Compose; idempotent first-time bring-up)
cp .env.example .env      # fill in DATABASE_URL + one LLM provider key
./scripts/dev-up.sh       # local/dev: no TLS, seeds the demo fixture

# Public server deploy (Caddy + auto-TLS via the `edge` profile, real auth)
./scripts/deploy.sh

# Fast dev iteration against a running stack (rebuild one service)
./scripts/reload.sh web   # or: worker, mcp-server

# Auth-posture audit — run after any auth/MCP change
./scripts/verify-lockdown.sh
```

`reload.sh` is right for ~95% of dev iterations; use `dev-up.sh` when you've
changed the Prisma schema or seed.

---

## Hard rules

1. **Never commit real secrets.** Only `.env.example` (+ `.env.pilot.example`)
   are tracked. `.env`, `.env.local`, and every backup variant (`*.bak*`,
   `*.dump`) are gitignored. If a token, hash, or API key appears in your diff,
   stop and reset.
2. **MCP requires Bearer auth on every method, including `initialize`.** A 401
   without a Bearer is the correct gate, not a bug. The platform is
   secure-by-default: a freshly-deployed instance is intentionally locked until
   you pick an auth mode.
3. **Destructive DB operations need explicit authorization.** Prisma refuses
   `migrate reset --force` from an AI without the consent env var — don't work
   around it.
4. **Never bypass pre-commit hooks** (`--no-verify`). Fix the underlying issue.

---

## Style cheatsheet (full version in `docs/GUIDELINES.md`)

- TypeScript strict everywhere. No `any`, no `@ts-ignore` without a justification.
- Conventional Commits: `feat(scope): …`, `fix(scope): …`, `docs: …`, `chore: …`.
- Comments are rare — only for non-obvious **why** (workarounds, invariants).
  Never narrate **what** the code does.
- Prefer editing existing files over creating new ones.
- Validate only at system boundaries; trust internal calls with framework guarantees.

---

## Honest test plans

A PR's "Test plan" is a contract, not a wish-list:

- ✅ Checks **you actually performed** — be specific ("CI passed typecheck/test/
  build", "ran the modal and confirmed the placeholder renders").
- ⬜ Checks **a reviewer should perform** — list as unchecked boxes.

If you couldn't run a check, say so ("relying on CI"). Aspirational test plans
look identical to real ones in review; the cost of honesty is low, the cost of
false confidence is a shipped regression.

---

## Working with the Brain (agents)

If a Brain MCP connection is available in your session, the memory loop is a
**house rule**, not a suggestion — it's how this project compounds knowledge
across sessions (and it's the product's own dogfood):

1. **Open**: `brain_start_session(prompt: …)` at the start of each task.
   Phrase the prompt as *technology + repo + task shape* ("debug intermittent
   Playwright e2e failure in CI for the External Brain webapp") — it doubles
   as the retrieval query; "fix bug" retrieves nothing useful.
2. **Apply**: the response carries `relevantKnowledge` — rules this Brain
   already learned that match the task. Read them before working; they are
   frequently the answer (the 429-rate-limit lesson arrived this way on its
   first live run).
3. **Resume-shaped tasks**: ask `brain_ask_oracle` ("what did we decide about
   X?") before re-deriving decisions; use `brain_find_skill` when you need a
   full recipe rather than atomic rules.
4. **Close**: `brain_report_session_outcome` with `learnings` (0–5 distilled
   `{trigger, rule, rationale}` items — ESPECIALLY user corrections and
   rejected approaches) and `knowledgeUsed` (the injected IDs you actually
   applied). This feeds confidence scoring; without it the Brain can't tell
   which rules pay off. If the close response returns a `hint`, act on it
   (`brain_teach_knowledge` for a correction that would otherwise evaporate).
5. **Capture decisions**: when the user states a project decision or status
   change ("we'll use X", "deprecate Y", "Z owns auth"), record it immediately
   with `brain_teach_knowledge` as a decision — `scope: "project"`, the rejected
   alternative in `instead`, `"decision"` in `tags`, and (if it reverses a prior
   decision) that decision's id in `supersedesKnowledgeId`. Decisions are shared
   project memory: a teammate's next `brain_start_session` surfaces them, and
   they are exempt from decay (a stated fact, retired only by supersession).
   **Mechanically (v2.10.0):** a `scope: "project"` teach tagged `decision` is
   written `visibility: "org"`, and MCP retrieval now carries org scope — so an
   org teammate's session-open injection really does include it. Both halves
   were needed, and until then this paragraph described behaviour that did not
   happen: retrieval never passed `accessibleProjectIds` over MCP, and the write
   side left `visibility` at its project-only default. Rules **not** tagged
   `decision` stay visible to you alone.
6. **Meeting & document protocols (V2.0)**: when handed a meeting transcript
   or asked to draft/harvest standard project documents or a status report,
   follow the matching protocol in [`docs/protocols/`](./docs/protocols/) —
   [`meeting-miner`](./docs/protocols/meeting-miner.md) (transcript →
   decisions + owned action items + open questions),
   [`doc-harvest`](./docs/protocols/doc-harvest.md) /
   [`doc-draft`](./docs/protocols/doc-draft.md) (document templates as
   recipes), [`report-draft`](./docs/protocols/report-draft.md) (on-demand
   status report; never scheduled, never pushed).

Why this matters: rules with registered usage survive decay and rise in
retrieval; unclosed sessions teach nothing. The loop's two halves were each
built because agents skipped the optional version — don't be the reason a
third elicitation fix is needed.

---

## Where to read what

| File | Read when |
|---|---|
| [`docs/QUICKSTART.md`](./docs/QUICKSTART.md) | Running your own instance from zero |
| [`docs/HOW_IT_WORKS.md`](./docs/HOW_IT_WORKS.md) | End-to-end mental model (token → session → extraction → Oracle) |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Cross-package change, system design |
| [`docs/KNOWLEDGE.md`](./docs/KNOWLEDGE.md) | The knowledge model — ontology, lifecycle, invariants (normative) |
| [`docs/MCP_TOOLS.md`](./docs/MCP_TOOLS.md) | Touching the MCP tool surface |
| [`docs/REST_API.md`](./docs/REST_API.md) | Adding/changing a REST endpoint |
| [`docs/SECURITY.md`](./docs/SECURITY.md) | Anything touching auth, tokens, MCP gating |
| [`docs/GUIDELINES.md`](./docs/GUIDELINES.md) | Code style, package boundaries, testing standards |
| [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) | Opening a PR, code conventions |
| [`docs/CICD.md`](./docs/CICD.md) | CI checks + the two deploy scripts (forker-facing) |
| [`docs/KNOWN_ISSUES.md`](./docs/KNOWN_ISSUES.md) | Before filing a bug — check tracked risks |
| [`REBUILD/00-START-HERE.md`](./REBUILD/00-START-HERE.md) | Rebuilding from scratch on a new machine (vibe-coding guide) |

---

## When you're stuck

1. Check [`docs/KNOWN_ISSUES.md`](./docs/KNOWN_ISSUES.md) for the symptom.
2. Check open issues + PRs (`gh issue list`, `gh pr list`).
3. Check `git log --grep=<keyword>` for prior fixes.
4. If still stuck, ask before guessing.
