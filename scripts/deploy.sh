#!/usr/bin/env bash
#
# Brain Platform — one-shot deploy for a fresh test server.
#
# Assumptions:
#   - Docker Engine + Docker Compose v2 available on PATH.
#   - A `.env` at repo root with at minimum DATABASE_URL and OPENAI_API_KEY
#     (ANTHROPIC_API_KEY optional but recommended for Oracle).
#
# Idempotent: safe to re-run. Skips steps that already completed.

set -euo pipefail
[ "${DEPLOY_DEBUG:-false}" = "true" ] && set -x

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
COMPOSE="docker compose -f deploy/docker-compose.yml --env-file .env"

log()  { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# -------- 1. Preflight --------
[ -f deploy/docker-compose.yml ] || die "deploy/docker-compose.yml missing — wrong cwd, or repo is corrupt."

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    die "Missing .env — run:  cp .env.example .env  and fill in OPENAI_API_KEY (+ optionally ANTHROPIC_API_KEY or ANTHROPIC_BASE_URL for Z.ai GLM)."
  fi
  die "Missing .env and .env.example — this doesn't look like a Brain Platform checkout."
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

: "${DATABASE_URL:?DATABASE_URL not set in .env}"
if [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  warn "No OPENAI_API_KEY or ANTHROPIC_API_KEY set — Oracle will fail; embeddings need OPENAI."
fi

# .env should be 600/640 — it carries AUTH_SECRET, ADMIN_PASSWORD_HASH, MCP token signing keys.
ENV_PERMS=$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env 2>/dev/null || echo "")
if [ -n "$ENV_PERMS" ] && ! [[ "$ENV_PERMS" =~ ^6[04]0$ ]]; then
  warn ".env mode is $ENV_PERMS — recommend \`chmod 600 .env\` (it carries AUTH_SECRET + admin hash)."
fi

# Disk-space preflight. Builds need ~6 GB of headroom; running out mid-build
# leaves a half-built layer cache and a confusing ENOSPC trail.
FREE_GB=$(df -BG --output=avail . 2>/dev/null | tail -n1 | tr -dc '0-9' || echo "")
if [ -n "$FREE_GB" ] && [ "$FREE_GB" -lt 10 ]; then
  warn "Only ${FREE_GB}G free on this filesystem — builds typically need ~6G. Consider \`docker system prune -af\` if this trips."
fi

if ! command -v docker >/dev/null 2>&1; then
  die "Docker Engine not found. On Ubuntu/Debian: \`curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker \$USER\` then re-login. (See docs/HZ_AGENT_MIGRATION.md for a fresh-host bring-up.)"
fi
if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose v2 required (saw v1 or none). On Ubuntu/Debian: \`sudo apt-get install -y docker-compose-plugin\`. (Some Hetzner images ship Compose v1 silently; v1 will fail mid-build.)"
fi
if ! docker info >/dev/null 2>&1; then
  die "Docker daemon not reachable. Start it (\`sudo systemctl start docker\`) or fix permissions — current user must be in the \`docker\` group."
fi

# -------- 2. Build images --------
# BuildKit + no default attestations — cuts incremental rebuilds from
# ~30 min to ~5 min on this monorepo by (a) activating the cache-mounts
# in deploy/Dockerfile and (b) skipping the SBOM + provenance manifest
# list that buildx otherwise attaches to every image (each skipped pass
# shaves ~20-30 s per stage and halves the image unpack time).
# Operators who need SBOMs for compliance unset the attestation flag.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
export BUILDX_NO_DEFAULT_ATTESTATIONS=1
# Stamp the build with the current git version so the web UI can show it
# (rail footer). `git describe` yields e.g. "v1.1.0" on a tag or
# "v1.1.0-3-gabc1234" a few commits later; "dev" if git is unavailable.
export APP_VERSION="${APP_VERSION:-$(git -C "$REPO_ROOT" describe --tags --always --dirty 2>/dev/null || echo dev)}"
log "Build version: $APP_VERSION"
# #56 gap 1 — snapshot live logs before any rebuild that could force-recreate
# containers. No-op on a fresh deploy (no running containers).
"$REPO_ROOT/scripts/save-deploy-logs.sh" || warn "log snapshot failed; continuing"

log "Building images (web · mcp-server · worker · bootstrap)..."
$COMPOSE build

# #212 — bootstrap image cache silently skips new migrations.
# Symptom (2/2 recurrence on prod): a freshly-pulled commit with a new
# migration dir gets baked into web/mcp/worker correctly, but the
# bootstrap image used for `prisma migrate deploy` carries the PREVIOUS
# migrations dir from its last build because Docker's layer cache hits
# on the `COPY packages ...` step. `migrate deploy` then reports "No
# pending migrations to apply" while the new migration sits unapplied
# on disk. Force-rebuild the bootstrap target without cache so its
# migrations directory always matches the working tree. Costs ~15-30s;
# safer than the alternative (operator hand-debugging a missing FK).
log "Rebuilding bootstrap (no-cache) to guarantee migrations dir is current..."
$COMPOSE build --no-cache bootstrap

# -------- 3. Database up and healthy --------
log "Starting Postgres..."
$COMPOSE up -d db
log "Waiting for Postgres to accept connections..."
for _ in $(seq 1 30); do
  if $COMPOSE exec -T db pg_isready -U "${POSTGRES_USER:-brain}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
$COMPOSE exec -T db pg_isready -U "${POSTGRES_USER:-brain}" >/dev/null 2>&1 \
  || die "Postgres failed to become ready in 30s."

# -------- 4. pgvector extension + schema + FTS indexes --------
log "Ensuring 'vector' extension..."
$COMPOSE exec -T db psql -U "${POSTGRES_USER:-brain}" -d "${POSTGRES_DB:-brain}" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

# pg-boss schema preflight (#88). Catches the v24 → v12 unauto-migratable
# state surfaced in #71 BEFORE the worker boots and crashloops. Detect-only:
# never drops on its own — surfaces a recovery command for the operator.
COMPOSE="$COMPOSE" POSTGRES_USER="${POSTGRES_USER:-brain}" POSTGRES_DB="${POSTGRES_DB:-brain}" \
  "$REPO_ROOT/scripts/pgboss-version-check.sh"

log "Applying Prisma migrations..."
$COMPOSE run --rm bootstrap \
  "pnpm --filter @brain/db exec prisma migrate deploy"

# Drift check: if someone hand-applied a migration on the host, `migrate deploy`
# happily skips it and the next promotion silently diverges. `migrate status`
# exits non-zero on drift; surface it loudly.
if ! $COMPOSE run --rm bootstrap \
  "pnpm --filter @brain/db exec prisma migrate status" >/dev/null 2>&1; then
  warn "Prisma migrate status reports drift — DB schema differs from migrations/. Run \`$COMPOSE run --rm bootstrap 'pnpm --filter @brain/db exec prisma migrate status'\` for details."
fi

log "Applying FTS GIN indexes..."
$COMPOSE exec -T db psql -U "${POSTGRES_USER:-brain}" -d "${POSTGRES_DB:-brain}" \
  < packages/db/sql/session-fts-index.sql >/dev/null

# #236 — seed local/dev DB with a deterministic fixture (1 admin user
# Alex, 1 org, 1 project, 6 sessions, 15 knowledge rows, 4 autoskill
# proposals). Idempotent via upsert; safe to re-run. Gated by
# SEED_ON_DEPLOY so prod can explicitly opt out (deploy-prod.sh sets it
# to false). Default `true` because this script is the *dev* deploy
# entrypoint and the e2e suite needs the fixture to actually pass.
if [ "${SEED_ON_DEPLOY:-true}" = "true" ]; then
  log "Seeding dev DB (set SEED_ON_DEPLOY=false to skip)..."
  $COMPOSE run --rm bootstrap \
    "pnpm --filter @brain/db exec prisma db seed" \
    || warn "seed failed; continuing (may leave e2e in a partial state)"
fi

# -------- 5. Embedding backfill --------
if [ -n "${GOOGLE_GEMINI_API_KEY:-}" ] || [ -n "${GEMINI_API_KEY:-}" ] || [ -n "${OPENAI_API_KEY:-}" ] || [ -n "${EMBEDDING_API_KEY:-}" ]; then
  log "Backfilling embeddings for any rows missing them..."
  $COMPOSE run --rm bootstrap \
    "pnpm --filter @brain/worker backfill:embeddings"
else
  warn "Skipping embedding backfill: no embedding key set (GOOGLE_GEMINI_API_KEY / OPENAI_API_KEY / EMBEDDING_API_KEY)."
fi

# -------- 6. Long-running services --------
log "Starting web · mcp-server · worker..."
$COMPOSE up -d web mcp-server worker

# -------- 7. Wait for web liveness then probe lockdown --------
log "Waiting for web liveness probe..."
for _ in $(seq 1 30); do
  if curl -sSf --max-time 2 "http://localhost:${WEB_HOST_PORT:-3000}/api/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
BASE_URL="http://localhost:${WEB_HOST_PORT:-3000}" \
MCP_URL="http://localhost:${MCP_HOST_PORT:-3100}" \
  "$REPO_ROOT/scripts/verify-lockdown.sh" || warn "Lockdown audit reported failures — review the output above before exposing this URL to anyone."

# -------- 8. Summary --------
log "Status:"
$COMPOSE ps
cat <<EOF

Brain Platform is up.

  Webapp         http://localhost:${WEB_HOST_PORT:-3000}
  MCP HTTP       http://localhost:${MCP_HOST_PORT:-3100}/mcp
  MCP health     http://localhost:${MCP_HOST_PORT:-3100}/health
  Postgres       localhost:${POSTGRES_HOST_PORT:-5432}

Auth mode: check the "Auth mode (from .env)" line in the audit above.
  - DEV_SHIM: local dev only — do NOT expose this URL publicly.
  - OAUTH:    pilot-ready — issue voucher codes at /admin/vouchers.
  - UNCONFIGURED: the app is locked until you pick one. See docs/SECURITY.md.

Tail logs:
  $COMPOSE logs -f web mcp-server worker

Tear down (keeps DB volume):
  $COMPOSE down

Tear down + wipe DB:
  $COMPOSE down -v
EOF
