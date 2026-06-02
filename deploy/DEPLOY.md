# Deploy — test-server MVP

One flow, idempotent. Designed for a fresh Linux VM with Docker installed.

## 0. Prerequisites

- Docker Engine 24+ and Docker Compose v2.
- 2 GB RAM and ~4 GB disk for the full stack (postgres + 3 app containers).
- One embedding-provider key. Any one of these works (chain in `packages/core/src/embedding.ts`): `GOOGLE_GEMINI_API_KEY` (recommended — free tier, also serves as Oracle), `OPENAI_API_KEY`, or `EMBEDDING_API_KEY` (for an OpenAI-compatible gateway). `ANTHROPIC_API_KEY` is required for Oracle only if you want to keep `ORACLE_MODEL` on a Claude model — Gemini covers both jobs with a single key.

## 1. Bootstrap in one command

```bash
git clone <this-repo> brain-platform && cd brain-platform
cp .env.example .env
# Edit .env — at minimum one embedding key (GOOGLE_GEMINI_API_KEY recommended; OPENAI_API_KEY also works)
./scripts/deploy.sh
```

The script orchestrates, in order:

1. Preflight (env presence, docker compose v2).
2. `docker compose build` for `web`, `mcp-server`, `worker`, and the one-shot `bootstrap` container.
3. `docker compose up -d db` and wait on `pg_isready`.
4. `CREATE EXTENSION IF NOT EXISTS vector` in the platform DB.
5. `prisma migrate deploy` against the new DB.
6. Apply `packages/db/sql/session-fts-index.sql` (GIN expression indexes for the session search tool).
7. `pnpm --filter @brain/db seed` — creates a dev user, sample sessions, sample knowledge, sample autoskill proposals.
8. `pnpm --filter @brain/worker backfill:embeddings` — computes embeddings for every seeded knowledge row via the active provider (Gemini → OpenAI fallback chain). Skipped if none of `GOOGLE_GEMINI_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` / `EMBEDDING_API_KEY` is set.
9. `docker compose up -d web mcp-server worker`.

Re-running `./scripts/deploy.sh` is safe: Prisma skips applied migrations, the seed is idempotent on its unique constraints, and the backfill only touches rows with `embedding IS NULL`.

### Optional: TLS via Caddy on the dev stack

`deploy/docker-compose.yml` ships an opt-in `caddy` service behind the `tls` profile. Use it when the test server should answer at public hostnames over HTTPS instead of plain HTTP on `:3000` / `:3100`. Requires:

- **Two** public DNS A records resolving to this host (gray-cloud / DNS-only is fine — Caddy needs port 80 reachable for the Let's Encrypt HTTP-01 challenge):
  - `BRAIN_PUBLIC_HOSTNAME` (the webapp), e.g. `brain-dev.example.com`
  - `BRAIN_MCP_PUBLIC_HOSTNAME` (the MCP HTTP transport), e.g. `mcp.brain-dev.example.com`
- Ports 80 + 443 open on the host firewall.
- In `.env`:
  - `BRAIN_PUBLIC_HOSTNAME="brain-dev.example.com"`
  - `BRAIN_MCP_PUBLIC_HOSTNAME="mcp.brain-dev.example.com"`
  - `CADDY_EMAIL="ops@example.com"`
  - `AUTH_URL="https://brain-dev.example.com"` — see the warning in `.env.example`; NextAuth uses this to build the post-sign-in redirect, and `trustHost: true` does NOT override an explicit `AUTH_URL`.

```bash
docker compose -f deploy/docker-compose.yml --env-file .env --profile tls up -d caddy
```

Caddy pulls Let's Encrypt certs for both hostnames on first request (logs `certificate obtained successfully` per identifier) and reverse-proxies to the `web` and `mcp-server` containers. The MCP container's `:3100` host port stays bound for direct-IP smoke tests; **production clients (Claude Code on another host, etc.) must use the HTTPS hostname** — sending a Bearer token over plain HTTP across the public internet leaks it to anyone on the path. Wiring it via `mcp.brain-dev.example.com/mcp` keeps the token inside TLS end-to-end.

### Build speed (measured 2026-04-24 on the legacy host)

`next build --webpack` is the tall pole — single-threaded static-page generation + trace collection over 28 API routes and 6 client surfaces. Webpack is intentional (see GUIDELINES §10 on the NodeNext + Turbopack gap). The actual numbers, verified by a back-to-back measurement on the legacy host:

| Scenario | Wall time | Webpack compile |
|---|---|---|
| First-ever build (no Docker layer cache, no BuildKit cache) | **~20–30 min** | ~15–20 min |
| Warm Docker layer cache, cold `.next/cache` | **3 min 9 s** | 112 s |
| Warm Docker layer cache, hot `.next/cache` (1-line source change) | **2 min 29 s** | **40 s** |

The cache mounts shave 40 s off a warm-warm rebuild and 64% off the webpack step itself; their biggest contribution is actually on a server that *has* been rebooted or pruned — they prevent the 30 min cold path from recurring. Two mitigations ship in the repo:

1. **BuildKit cache mounts** in `deploy/Dockerfile` for the pnpm store (`/pnpm/store`), webpack's module cache (`/repo/apps/web/.next/cache`), and the swc/next-babel intermediates (`/repo/node_modules/.cache`). These persist across `docker system prune --filter=until=<ttl>` as long as the BuildKit builder isn't wiped with it. An incremental rebuild after a code change in `packages/core` or `apps/web` recompiles only the changed webpack modules.
2. **`BUILDX_NO_DEFAULT_ATTESTATIONS=1`** set by both `scripts/deploy.sh` and `scripts/deploy-prod.sh` — skips the SBOM + provenance manifest list that buildx attaches by default. Verified present/absent: the commit that landed the flag removed ~20–30 s per stage of `exporting attestation manifest` + `exporting manifest list` work (visible in the original 32-min deploy log but gone from subsequent runs). If your compliance regime requires SBOMs on images, unset this variable before running the deploy script.

Cache mounts are BuildKit-only. The deploy scripts force `DOCKER_BUILDKIT=1` + `COMPOSE_DOCKER_CLI_BUILD=1`; a manual `docker compose build` inherits the same defaults on Docker 23+. If you're on an older Docker, `export DOCKER_BUILDKIT=1` before the build command.

To see cache hit/miss, run the build with `docker compose build --progress=plain` and look for `CACHED` prefixes on the `RUN --mount=type=cache,...` lines. With `.next/cache` hot, you'll see webpack log something like `✓ Compiled successfully in 40s` instead of the cold-path `in 112s`. If you see the full 112 s or longer on a supposedly warm server, the BuildKit builder has likely been wiped — run `docker buildx inspect default` to confirm the builder still exists.

## 2. What you get

| Service | URL / port | Purpose |
|---|---|---|
| Webapp | `http://<host>:3000` | Dashboard, Oracle, Skills, Graph, Autoskill, Sessions — six surfaces, live data |
| MCP Streamable HTTP | `http://<host>:3100/mcp` | Any MCP-compatible client (Claude Code, Cursor, Windsurf) — `Authorization: Bearer <MCP token>` |
| MCP health probe | `http://<host>:3100/health` | `{ok: true, transport: "http"}` when running |
| Postgres | `<host>:5432` | `psql` for manual inspection; not needed for day-to-day |

Logs are structured JSON — every container line carries `level`, `time`, `service`, and (for HTTP/job traffic) `requestId`. Tail with:

```bash
docker compose -f deploy/docker-compose.yml logs -f web mcp-server worker
```

## 3. Environment variables (.env)

Minimum viable:

```bash
DATABASE_URL="postgresql://brain:brain@db:5432/brain"
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="sk-ant-..."        # or switch ORACLE_MODEL to gpt-4o
ORACLE_MODEL="claude-sonnet-4-6"      # or "gpt-4o"
EMBEDDING_MODEL="text-embedding-3-small"
MAX_ORACLE_COST_USD_PER_DAY="10"
```

Host-port overrides (optional):

```bash
WEB_HOST_PORT=3000
MCP_HOST_PORT=3100
POSTGRES_HOST_PORT=5432
POSTGRES_USER=brain
POSTGRES_PASSWORD=brain
POSTGRES_DB=brain
```

All other `RATE_LIMIT_*`, `LOG_LEVEL`, and feature flags carry sensible defaults (see `.env.example`).

## 4. Lifecycle

Tear down keeping the DB volume:
```bash
docker compose -f deploy/docker-compose.yml down
```

Full reset (wipes knowledge, sessions, everything):
```bash
docker compose -f deploy/docker-compose.yml down -v
```

Re-bootstrap after a pull:
```bash
git pull && ./scripts/deploy.sh
```

## 5. Post-deploy smoke test

```bash
# Webapp reachable
curl -f http://localhost:3000/api/me                  # should 200 with {userId: ...}
curl -f http://localhost:3000/api/dashboard           # should 200

# MCP health
curl -f http://localhost:3100/health                  # {"ok":true,"transport":"http"}

# Oracle (if ANTHROPIC_API_KEY set)
curl -N -XPOST http://localhost:3000/api/oracle/stream \
  -H 'content-type: application/json' \
  -d '{"question":"What do I know about React forms?","reasoningLevel":"low"}'
# Stream of `event: delta` frames, then `event: final`, then `event: done`.
```

## 6. Known limits of the MVP deploy

- **Dev auth shim.** `DEV_USER_ID` (or the first `User` row) is the authenticated user for every API call. Do not expose this deploy to the public internet — anyone who can reach `/api/*` has full access to that user's Brain. For shared-access testing with colleagues, put it behind a VPN, an OAuth2 proxy (Cloudflare Access, oauth2-proxy), or a basic-auth reverse proxy.
- **In-memory rate-limit store.** The bucket map resets when the `web` container restarts; it does not share state across replicas. Fine for a single test server, not for production.
- **No TLS.** Put this behind a reverse proxy (Caddy, nginx, Traefik) that terminates HTTPS.
- **No backup job.** The `brain_db` volume is the source of truth; back it up with `docker compose exec db pg_dump ...` if the test data matters.

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `prisma migrate deploy` hangs | pgvector not installed on the DB image | Ensure the DB service uses `pgvector/pgvector:pg16` (compose default). |
| Webapp boot fails with `Invalid environment` | zod env validation tripped | Check `.env` against `.env.example`; `DATABASE_URL` must be a `postgres://` or `postgresql://` URL. |
| Oracle returns `cost_cap_exceeded` (429) | Daily cap hit for this user | Bump `MAX_ORACLE_COST_USD_PER_DAY` or wait for UTC rollover. |
| Oracle returns `404 status code (no body)` | `EMBEDDING_BASE_URL` points at a chat-only DashScope subdomain (`coding-intl.dashscope.aliyuncs.com`) — no `/embeddings` route | Switch to `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` and a general-purpose 百炼 (Model Studio) `sk-…` key. |
| Oracle / KRA returns `401 invalid access token` from DashScope | Token is scoped to a specific product (e.g. Claude-Code Qwen3 routing) and not valid for `/v1/embeddings` | Generate a fresh API key in `bailian.console.aliyun.com` under "API Keys". Claude-Code-style tokens and general keys look identical but have different scopes. |
| Oracle works but retrieval returns empty | Knowledge rows have no embeddings yet | `./scripts/deploy.sh` skips the backfill when no embedding key is set (`GOOGLE_GEMINI_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` / `EMBEDDING_API_KEY` all empty). Run `docker compose -f deploy/docker-compose.yml --env-file .env run --rm bootstrap "pnpm --filter @brain/worker backfill:embeddings"` after one is in. |
| Embeddings backfill logs zero rows | Seed already ran + all rows already embedded | Expected on re-deploy; no action. |
| Backfill keeps hitting `api.openai.com` despite `EMBEDDING_BASE_URL` set | **Stale bootstrap image.** `docker compose build` skips services behind a `profiles:` list. | `docker compose -f deploy/docker-compose.yml --env-file .env --profile bootstrap build --no-cache bootstrap`. `scripts/deploy.sh` does this correctly; if you hand-built, repeat with the `--profile` flag. |
| MCP HTTP `401 Missing BRAIN_MCP_TOKEN` | Client didn't send Bearer token | Generate a token at `/settings/tokens` and pass `Authorization: Bearer <token>`. |
| MCP / worker container restart-loops with `Cannot find module '/app/node_modules/.bin/tsx'` | pnpm hoists transitive binaries only to `.pnpm/node_modules/.bin/tsx` | Confirm the `CMD` uses the absolute path `["/app/node_modules/.pnpm/node_modules/.bin/tsx", "src/index.ts"]` plus `WORKDIR /app/apps/<name>`. Recent Dockerfile already does this. |
| `web` starts but every API route returns `500 internal` | Prisma engine binary missing in the standalone bundle | Verify `COPY --from=builder /repo/packages/db/src/generated ./apps/web/src/generated` in the web stage of `deploy/Dockerfile`. |

### Provider ecology cheat-sheets

All three combos below have been tested end-to-end on 2026-04-22 against the Alex-persona seed. Swap between them by editing `.env` — no code change required.

**A. Gemini embeddings + Z.ai GLM chat** (recommended — Gemini's free tier covers the demo):

```
ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic"            # Oracle
ANTHROPIC_API_KEY="<z.ai key>"
ORACLE_MODEL="glm-5.1"                                          # or "glm-4.5"

EMBEDDING_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
GOOGLE_GEMINI_API_KEY="<gemini key from aistudio.google.com>"  # auto-picked up by embed()
EMBEDDING_MODEL="gemini-embedding-001"
EMBEDDING_DIMENSIONS="1536"                                     # allowed: 128-3072
```

**B. DashScope Qwen3 embeddings + Z.ai GLM chat** (paid, both providers Chinese-hosted):

```
ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic"
ANTHROPIC_API_KEY="<z.ai key>"
ORACLE_MODEL="glm-5.1"

EMBEDDING_BASE_URL="https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
EMBEDDING_API_KEY="<dashscope sk-… key from bailian.console.aliyun.com>"
EMBEDDING_MODEL="text-embedding-v4"
EMBEDDING_DIMENSIONS="1536"
```

**C. OpenAI all-in** (baseline, no base-URL overrides):

```
OPENAI_API_KEY="sk-..."
EMBEDDING_MODEL="text-embedding-3-small"
EMBEDDING_DIMENSIONS="1536"
ORACLE_MODEL="claude-sonnet-4-6"
ANTHROPIC_API_KEY="sk-ant-..."
```

**Two provider gotchas worth keeping in mind:**

1. **Z.ai has no embedding API.** `paas/v4` and `coding-intl` subdomains serve chat only — do not point `EMBEDDING_BASE_URL` at Z.ai.
2. **DashScope issues two kinds of tokens that look identical.** A key obtained via the Claude-Code integration flow (routed through `coding-intl.dashscope.aliyuncs.com`) works only for chat; for embeddings you need a general-purpose `sk-…` key from the 百炼 Model Studio console. Symptom of the wrong one: `401 invalid access token` from every DashScope endpoint.
