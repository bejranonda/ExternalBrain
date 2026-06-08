# Quickstart — from zero to a running Brain in 15 minutes

Goal of this guide: get External Brain running on a laptop or a fresh VM, wire it into Claude Code (or Cursor / Windsurf), and see your first AI coding session captured end-to-end. Copy-paste steps, no guessing.

> **Need the short version?** Skip to the [five-command happy path](#five-command-happy-path).

---

## 0. What you need

- Docker Engine 24+ with Compose v2 (`docker --version && docker compose version`).
- ~4 GB free RAM, ~2 GB disk.
- One LLM provider key. Any one of these is enough to demo retrieval + Oracle:
  - `GOOGLE_GEMINI_API_KEY` — free tier works (AI Studio). Recommended for first-time setup.
  - `OPENAI_API_KEY`
  - `ANTHROPIC_API_KEY` — or a Z.ai / GLM key via `ANTHROPIC_BASE_URL`.
- (Optional) A GitHub OAuth app if you want real auth instead of the single-user dev shim. Skip for now; the dev shim works for evaluation.

No Node / pnpm / Postgres install required — Docker runs everything.

---

## Five-command happy path

```bash
# 1. Clone
git clone https://github.com/bejranonda/ExternalBrain.git external-brain
cd external-brain

# 2. Configure
cp .env.example .env
# Open .env, fill in GOOGLE_GEMINI_API_KEY (or OPENAI_API_KEY, or ANTHROPIC_API_KEY).
# Defaults for everything else work for a local demo.

# 3. Bring the stack up (local/dev — no TLS, dev-friendly defaults)
./scripts/dev-up.sh

# 4. Open the webapp
open http://localhost:3000   # macOS; Linux: xdg-open; Windows: start

# 5. Create an MCP token in the UI — see §4 below.
```

If `dev-up.sh` says "External Brain is up" and `curl -sSf http://localhost:3000/api/healthz` returns `{"ok":true}`, you're running. Go to §4 to wire a coding tool.

---

## 1. What `scripts/dev-up.sh` does, in order

(For a public **server** deployment — Caddy + auto-TLS, real auth enforced,
nightly backups — use `./scripts/deploy.sh` instead; see
[DEPLOY_CHECKLIST.md](./DEPLOY_CHECKLIST.md).)

So you know what to look for if it fails mid-way:

1. Sanity-checks `.env` and `docker compose version`.
2. Builds four images: `web`, `mcp-server`, `worker`, `bootstrap`.
3. Starts Postgres (`pgvector/pgvector:pg16`) and waits for `pg_isready`.
4. Ensures the `vector` extension, applies Prisma migrations, applies FTS GIN indexes.
5. Runs the embedding backfill (needs an LLM provider key configured).
6. Starts `web` (port 3000), `mcp-server` (port 3100), `worker` (background).
7. Prints a status summary.

The script is idempotent — re-run it any time. If it fails on step 6 (backfill) because no key is configured, that's a warning, not a hard stop; the rest of the stack still comes up and you can configure the key later.

---

## 2. `.env` — the shortest version that works

`.env.example` has every variable with comments. For a first demo, the lines that actually matter:

```bash
# Mandatory — the compose stack provides its own Postgres at this URL.
DATABASE_URL="postgresql://brain:brain@db:5432/brain"

# Pick ONE embedding + chat provider. Gemini is free-tier friendly.
GOOGLE_GEMINI_API_KEY="AIza…"
EMBEDDING_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai/"
EMBEDDING_MODEL="gemini-embedding-001"
EMBEDDING_DIMENSIONS="1536"

# Oracle (chat) — simplest path: Gemini via OpenAI-compat endpoint.
ORACLE_MODEL="gemini-2.0-flash-exp"

# Auth mode — pick ONE (see docs/SECURITY.md for details):
#   A) Local dev / single-tenant demo:
ALLOW_DEV_AUTH="true"
#   B) Pilot / production (uncomment all three, leave ALLOW_DEV_AUTH=false):
# AUTH_GITHUB_ID="…"; AUTH_GITHUB_SECRET="…"; AUTH_SECRET="…"  # openssl rand -base64 32
# ADMIN_EMAILS="you@yourteam.com"
```

Without either `ALLOW_DEV_AUTH=true` or the three `AUTH_*` vars, every request returns 503 `auth_not_configured`. This is the secure-by-default lockdown — a freshly-deployed VM is intentionally unreachable until you pick a mode.

Every other variable (rate limits, cost caps, public hostname) has sensible defaults in `.env.example` and can stay empty for a local demo.

Alternative provider combinations are documented in `.env.example`'s three "Option A / B / C" blocks (Gemini, DashScope Qwen3, OpenAI). Swap by uncommenting one block.

---

## 3. Verify the stack is alive

One curl per service:

```bash
curl -sSf http://localhost:3000/api/healthz      # webapp liveness
curl -sSf http://localhost:3000/api/readyz       # webapp + DB readiness
curl -sSf http://localhost:3100/health           # MCP server
```

All three return `{"ok":true}` when healthy. If `/api/readyz` fails with a DB error, the migrations or FTS indexes didn't apply — run `./scripts/dev-up.sh` again; it's idempotent.

Open the webapp at http://localhost:3000. The first-run Onboarding modal walks you through token setup — you can follow its steps or use §4 below.

---

## 4. Create an MCP token (one time)

This is the credential your AI coding tool will use to read + write your Brain.

**In the webapp:**
1. Click the user avatar (bottom-left) → **MCP tokens**. Or go directly to http://localhost:3000/settings/tokens.
2. Type a name (e.g. `laptop`), click **Create**.
3. **Copy the raw token immediately.** It is shown exactly once — leaving the page loses it. It starts with `bp_…`.

The token is a 90-day credential by default. You can create more (one per machine) and revoke any of them without affecting the others.

---

## 5. Wire it into your AI coding tool

### Claude Code

Edit `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "brain": {
      "transport": {
        "type": "http",
        "url": "http://localhost:3100/mcp"
      },
      "headers": { "Authorization": "Bearer <PASTE_TOKEN_HERE>" }
    }
  }
}
```

Restart Claude Code. In a new session, type `/mcp` — you should see `brain` listed with a green check.

### Cursor

Editor settings → MCP → add server. Same shape as above. Cursor uses its own UI form; fill in URL `http://localhost:3100/mcp` and header `Authorization: Bearer <token>`.

### Windsurf

Open `~/.codeium/windsurf/mcp_config.json` and add the same `brain` block as the Claude Code example.

### Others (any OpenAI/Anthropic-compatible agent)

The MCP protocol is standard. Point your MCP client at `http://localhost:3100/mcp` with `Authorization: Bearer <token>`. Full details in [docs/CLIENTS.md](./CLIENTS.md).

---

## 6. Prove it works — first session in 60 seconds

### a) Ask the Oracle

In the webapp, click **Oracle** in the left rail. Ask:

> What framework do I use for React forms?

You should see a streaming markdown answer with inline citation chips `[^K1]` linking to Knowledge rows in the right-side retrieval inspector. (The first time you ask a question, the inspector appears; before that the main column spans full width — this is the progressive-disclosure behaviour from the 2026-04-22 UX pass.)

### b) Capture a session from Claude Code

In Claude Code, start any coding task. The Brain MCP server will:
- Pre-inject relevant Knowledge (via `brain_retrieve_knowledge`) before the model generates.
- Receive a session outcome report when the task completes (via `brain_report_session_outcome`).

Every session you complete grows the Knowledge corpus. Refresh the webapp's Skills surface to see it accumulate.

---

## 7. Troubleshooting

| Symptom | Diagnosis | Fix |
|---|---|---|
| `curl` to `/api/healthz` returns a 503 or connection-refused | Web container is still booting or crashed | `docker compose -f deploy/docker-compose.yml logs -f web` |
| `/api/readyz` says `db not ready` | Postgres is up but migrations haven't applied | Re-run `./scripts/dev-up.sh` (idempotent) |
| Onboarding modal shows forever after reload | `bp_onboarded` flag didn't persist; LocalStorage disabled | Click **Skip** in the modal; it sets the flag explicitly |
| Oracle returns 500 / streams nothing | No LLM provider key set, or cost cap tripped | Check `.env` has one of `GOOGLE_GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`; check `docker compose logs web` for the exact error |
| Retrieval returns empty | Embeddings weren't backfilled (worker missing a key, or worker is dead) | `docker compose logs worker` — if you see the queue creation on start, manually run: `docker compose --profile bootstrap run --rm bootstrap "pnpm --filter @brain/worker backfill:embeddings"` |
| Claude Code shows `brain` as red/disconnected under `/mcp` | Token wrong, Claude Code can't reach `:3100`, or token revoked | `curl -H "Authorization: Bearer <token>" http://localhost:3100/mcp` should return a 200 with a session id. If not, re-issue the token (§4). |

For deeper operational issues (restore from backup, rotate secrets, admin actions): [`docs/KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

---

## 7b. After you edit code — which script to run

Short rules:

- **Edited TypeScript in `apps/*` or `packages/core/*`** → `./scripts/reload.sh web` (or `worker` / `mcp-server`).
- **Edited the Prisma schema** → `./scripts/dev-up.sh` (it runs `prisma migrate deploy` for you).
- **Edited `.env` only** → `./scripts/reload.sh web` (force-recreate is what picks up env changes).
- **Unsure / anything else** → `./scripts/dev-up.sh`. Idempotent. Always safe.

`reload.sh` takes 10–20 s per service. `dev-up.sh` takes 30–60 s but handles everything. Full decision table in [README.md § "Which script to run when"](../README.md#which-script-to-run-when).

Every script ends by calling `./scripts/verify-lockdown.sh`, so auth regressions surface immediately — not three days into a pilot.

## 8. Going further

- **Production deploy** (public IP, TLS, admin surface): [`deploy/PRODUCTION.md`](../deploy/PRODUCTION.md). Adds Caddy sidecar with Let's Encrypt, refuses the dev shim, enforces token TTL.
- **Real GitHub OAuth** (not just the dev shim): set `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_SECRET` in `.env` — the stack auto-switches to NextAuth v5 when all three are present.
- **Provider ecology**: [`.env.example`](../.env.example) has three tested combos (Gemini / Qwen3 / OpenAI). Swap by flipping `EMBEDDING_BASE_URL` + key + model; no code change.
- **Admin surface**: promote your user row to `role='admin'` (requires a DB update), then `/api/admin/*` exposes users, tokens, audit log, cost ledger, GDPR erase.
- **Rules export**: Skills surface → "Download rules bundle" produces a per-tool bundle (`.claude/`, `.cursor/rules/`, `AGENTS.md`, etc.) from your Knowledge rows tagged `rules-export`.

---

## What you should feel after 15 minutes

One AI coding tool, one token, one Postgres with your growing knowledge. Every session gets pre-injected context; every completed session grows the corpus; the Oracle answers questions about your own patterns with citations to the sources.

If that didn't happen, [open an issue](https://github.com/bejranonda/ExternalBrain/issues) with a `docker compose ps` output and the offending log tail. The stack is small enough that almost every failure mode has one clear root cause.
