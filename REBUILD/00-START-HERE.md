# External Brain — Rebuild Guide

> You are rebuilding **External Brain** from scratch in a new repo using AI-assisted
> (vibe) coding. This folder is your complete construction manual. Read this file first,
> then work through the numbered phase files in order — one at a time, one checkpoint at
> a time.

---

## What you are building

**External Brain** is a self-hostable **MCP (Model Context Protocol) server + web app**
that gives AI coding tools long-term memory. The core feedback loop:

```
AI tool ──MCP──▶ Brain Server ──▶ Postgres + pgvector
                  ├─ inject relevant past knowledge (before you code)
                  ├─ record session + outcome (after you code)
                  ├─ extract durable typed knowledge (background worker)
                  └─ answer questions via grounded Oracle (cited)
```

It is **not** another coding tool — it is the memory substrate that makes whatever tool
you already use smarter over time.

---

## How to use these files

1. **Open a new, empty git repo** on the target machine.
2. **Copy this entire `REBUILD/` folder** into the repo root.
3. **Hand your AI agent one phase file at a time.** Use the "Agent prompt" block at the
   top of each file — copy it verbatim and let the agent build. Do not paste the whole
   guide at once; the system must be built in order.
4. **Run the checkpoint** at the bottom of each phase before moving on. The checkpoint is
   the contract: do not skip it.
5. **When the checkpoint passes,** hand the agent the next phase file.

Each phase produces working, testable code. By Phase 6 you have a running production
stack.

---

## Phase map

| File | Phase | What gets built | Gate to move on |
|------|-------|-----------------|-----------------|
| `01-foundation.md` | 1 | Monorepo · `@brain/types` · `@brain/db` | `prisma migrate deploy` + seed green |
| `02-core-intelligence.md` | 2 | `@brain/core` (KRA · KEA · Oracle · decay · embeddings) | Unit tests pass |
| `03-mcp-server.md` | 3 | `apps/mcp-server` (Bearer auth, 12 tools, resources) | Auth invariant passes end-to-end |
| `04-worker.md` | 4 | `apps/worker` (pg-boss, 9 jobs, embeddings backfill) | Session close → KEA extract drains |
| `05-web-app.md` | 5 | `apps/web` (NextAuth, dashboard, Oracle, Skills, Settings) | Sign in → token → Oracle → Skills |
| `06-deploy-ci.md` | 6 | Docker Compose · Dockerfile · scripts · CI | `dev-up.sh` PASS + lockdown audit PASS |
| `07-env-catalog.md` | ref | Complete `.env` reference | (reference, read any time) |
| `08-acceptance-criteria.md` | final | Full definition of done + sign-off checklist | All 9 criteria green |

---

## Non-negotiable rules — carry these through every phase

These invariants override any default AI behavior. If the agent violates one, stop and
correct it before continuing.

### 1. Package boundary (architectural)
```
@brain/types  →  @brain/db  →  @brain/core  →  apps/mcp-server
                                              →  apps/web
                                              →  apps/worker
```
Apps **never** import from each other. All shared intelligence lives in `@brain/core`.
CI enforces this; violations fail the build.

### 2. MCP Bearer auth on every method, including `initialize`
A `POST /mcp` without a valid `Bearer bp_…` token **must** return `401`. This includes
the `initialize` handshake. A 401 here is the correct secure default, not a bug.
The MCP spec allows unauthenticated discovery — this project deliberately overrides that.

### 3. Secure-by-default
With no auth mode configured, every web route returns `503 auth_not_configured`. The
operator must pick a mode (Credentials, GitHub OAuth, Dev shim) to unlock the instance.
A freshly cloned + started instance that serves content without configuration is a bug.

### 4. Multi-tenant scoping on every query
Every `Knowledge`, `Session`, `Skill`, and `Project` read/write filters by
`ownerUserId` (and `projectId`/`organizationId` where relevant). Cross-tenant data
leakage is the cardinal sin. Write the isolation test in Phase 1; run it in Phase 2+.

### 5. TypeScript strict everywhere
No `any`. No `@ts-ignore` without an explicit justification comment. Comments explain
*why* (workarounds, invariants) never *what* (the code already says that).

### 6. Never commit secrets
Only `.env.example` is tracked. `.env`, `.env.local`, and all backup variants are
gitignored. If a token or hash appears in a diff, stop and reset.

### 7. `decision`-tagged knowledge never decays
Knowledge rows with the tag `decision` are permanent project memory — exempt from the
decay job. They can only be retired by explicit supersession (`supersedesKnowledgeId`).

### 8. `embedding` column is always `vector(1536)` — never change the dimension
The schema locks `EMBEDDING_DIMENSIONS=1536`. Changing this requires a full re-embed +
migration. The worker backfills NULL embeddings asynchronously; never block on it.

---

## Tech stack summary

| Concern | Choice |
|---------|--------|
| Runtime | Node 20 LTS · TypeScript strict |
| Monorepo | pnpm workspaces (`pnpm@9.15.0`) + Turborepo |
| Web | Next.js (App Router, `output: "standalone"`) · React 19 · Tailwind v4 |
| Auth | NextAuth v5 (JWT) + `@auth/prisma-adapter` + `bcryptjs` |
| Database | PostgreSQL 16 + **pgvector** extension |
| ORM | Prisma 7 + `@prisma/adapter-pg` driver adapter |
| Background jobs | **pg-boss** v12 (no Redis for jobs) |
| Protocol | `@modelcontextprotocol/sdk` (stdio + Streamable HTTP) |
| Validation | `zod` v4 (at system boundaries only) |
| Tests | Vitest (unit) · Playwright chromium-only (e2e) |
| Deploy | Docker Compose · Caddy auto-TLS (edge profile) |

---

## Repo layout (final)

```
apps/
  web/           Next.js webapp — dashboard, Oracle, Skills, settings, admin
  mcp-server/    MCP server — Bearer auth + 12 brain_* tools + 4 resources
  worker/        pg-boss background jobs — extraction, decay, embeddings
packages/
  core/          Intelligence layer — KRA, KEA, Oracle, decay, cost, snippets
  db/            Prisma schema + singleton client + raw-SQL helpers
  types/         Shared TypeScript types — zero runtime deps
deploy/          docker-compose.yml · Dockerfile · Caddyfile
scripts/         dev-up.sh · deploy.sh · reload.sh · verify-lockdown.sh · smoke.sh
docs/            Documentation
REBUILD/         ← you are here
```

Root files: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`,
`.env.example`, `AGENTS.md` (with `CLAUDE.md`/`GEMINI.md` symlinks), `LICENSE` (MIT).

---

## Start now

Open `01-foundation.md` and follow the "Agent prompt" block at the top.
