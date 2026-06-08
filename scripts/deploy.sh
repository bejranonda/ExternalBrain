#!/usr/bin/env bash
#
# External Brain — deploy to the single self-hosted server.
#
# One server, one Compose file. Brings up the full stack with TLS (Caddy),
# Redis, and nightly backups via the `edge` profile, runs migrations + FTS,
# waits for the first certificate, then runs the lockdown audit + smoke.
#
#   - Caddy sidecar for automatic TLS (Let's Encrypt ACME HTTP-01)
#   - Host-port bindings stay loopback-only; Caddy fronts the public traffic
#   - Requires real auth (AUTH_* / ADMIN_*) — the dev-auth shim is refused
#   - Waits for Caddy to pull the first certificate before reporting ready
#
# Re-run is idempotent. Safe to chain after a `git pull` / `git checkout <tag>`.
#
# For local development you don't need this script — just:
#   docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
# (the `edge` services stay off, so no TLS/redis/backup locally).

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
[ -f .env ] || die "Missing .env. See deploy/PRODUCTION.md §'Environment checklist'."

# Refuse to deploy from a dirty worktree — deploys must come from a clean
# tracked commit so `git rev-parse HEAD` in logs is meaningful.
# Override (rarely) with DEPLOY_ALLOW_DIRTY=true.
if [ "${DEPLOY_ALLOW_DIRTY:-false}" != "true" ] && ! git diff --quiet HEAD 2>/dev/null; then
  die "Uncommitted changes in worktree — refusing deploy. Commit or stash first, or set DEPLOY_ALLOW_DIRTY=true if you really mean it."
fi

ENV_PERMS=$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env 2>/dev/null || echo "")
if [ -n "$ENV_PERMS" ] && ! [[ "$ENV_PERMS" =~ ^6[04]0$ ]]; then
  warn ".env mode is $ENV_PERMS — recommend \`chmod 600 .env\` (it carries AUTH_SECRET + admin hash + OAuth secret)."
fi

FREE_GB=$(df -BG --output=avail . 2>/dev/null | tail -n1 | tr -dc '0-9' || echo "")
if [ -n "$FREE_GB" ] && [ "$FREE_GB" -lt 10 ]; then
  warn "Only ${FREE_GB}G free on this filesystem — builds typically need ~6G. Consider \`docker system prune -af\` if this trips."
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

: "${DATABASE_URL:?DATABASE_URL not set}"
: "${BRAIN_PUBLIC_HOSTNAME:?BRAIN_PUBLIC_HOSTNAME not set — DNS hostname for the webapp}"
: "${BRAIN_MCP_PUBLIC_HOSTNAME:?BRAIN_MCP_PUBLIC_HOSTNAME not set — DNS hostname for the MCP server}"
: "${CADDY_EMAIL:?CADDY_EMAIL not set — required for ACME registration}"

if [ "${NODE_ENV:-}" != "production" ]; then
  warn "NODE_ENV is not 'production'. Consider setting it in .env."
fi

# Auth preflight: two production auth modes (see .env.example "Mode A"/"Mode B"):
#   A) Credentials  — ADMIN_USERNAME + ADMIN_PASSWORD_HASH (phase-1 pilot default)
#   B) GitHub OAuth — AUTH_GITHUB_ID + AUTH_GITHUB_SECRET
# Either mode requires AUTH_SECRET. ALLOW_DEV_AUTH_IN_PRODUCTION=true is the
# dev-shim escape hatch (VPN-only deploys).
HAS_OAUTH=0
HAS_CREDENTIALS=0
[ -n "${AUTH_GITHUB_ID:-}" ] && [ -n "${AUTH_GITHUB_SECRET:-}" ] && HAS_OAUTH=1
[ -n "${ADMIN_USERNAME:-}" ] && [ -n "${ADMIN_PASSWORD_HASH:-}" ] && HAS_CREDENTIALS=1

if [ -z "${AUTH_SECRET:-}" ] && [ "${ALLOW_DEV_AUTH_IN_PRODUCTION:-false}" != "true" ]; then
  die "AUTH_SECRET not set — required for both auth modes. Generate one with: openssl rand -base64 32"
fi

if [ "$HAS_OAUTH" = 0 ] && [ "$HAS_CREDENTIALS" = 0 ]; then
  if [ "${ALLOW_DEV_AUTH_IN_PRODUCTION:-false}" != "true" ]; then
    die "No production auth configured. Pick one:
  Mode A (Credentials):  set ADMIN_USERNAME and ADMIN_PASSWORD_HASH in .env (run: pnpm hash-admin-password '<plaintext>')
  Mode B (GitHub OAuth): set AUTH_GITHUB_ID and AUTH_GITHUB_SECRET in .env
  Escape hatch:          set ALLOW_DEV_AUTH_IN_PRODUCTION=true (VPN-only deploys; uses the dev-auth shim)"
  fi
  warn "Running with the dev-auth shim because ALLOW_DEV_AUTH_IN_PRODUCTION=true. Only acceptable behind a VPN."
fi

# Phase-S lockdown guard: even with auth configured, ALLOW_DEV_AUTH=true makes
# the app accept anonymous requests as the dev user. Refuse the combination.
if [ "$(echo "${ALLOW_DEV_AUTH:-false}" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
  die "ALLOW_DEV_AUTH=true is refused on a server deploy. Unset it in .env. (Dev-shim alongside real auth is a configuration error — see docs/SECURITY.md §'Auth modes'.)"
fi

# Admin-promotion list. ADMIN_EMAILS (plural) is canonical; legacy singular
# ADMIN_EMAIL is promoted to it at script-load time (#39).
if [ -z "${ADMIN_EMAILS:-}" ] && [ -n "${ADMIN_EMAIL:-}" ]; then
  warn "ADMIN_EMAIL='${ADMIN_EMAIL}' is set without ADMIN_EMAILS — using it, but ADMIN_EMAIL is deprecated (#39). Rename to ADMIN_EMAILS in .env."
  export ADMIN_EMAILS="${ADMIN_EMAIL}"
elif [ -z "${ADMIN_EMAILS:-}" ]; then
  warn "ADMIN_EMAILS empty — the first signer has no admin. Set it now or plan to UPDATE \"User\" SET role='admin' manually after sign-in."
fi

if [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${GOOGLE_GEMINI_API_KEY:-}" ] && [ -z "${EMBEDDING_API_KEY:-}" ]; then
  warn "No embedding key set (OPENAI_API_KEY / GOOGLE_GEMINI_API_KEY / EMBEDDING_API_KEY all empty). Oracle + KRA will fail until a key is available."
fi

if ! command -v docker >/dev/null 2>&1; then
  die "Docker Engine not found. On Ubuntu/Debian: \`curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker \$USER\` then re-login."
fi
if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose v2 required (saw v1 or none). On Ubuntu/Debian: \`sudo apt-get install -y docker-compose-plugin\`."
fi
if ! docker info >/dev/null 2>&1; then
  die "Docker daemon not reachable. Start it (\`sudo systemctl start docker\`) or add your user to the \`docker\` group."
fi

# -------- 2. Build --------
# BuildKit + no default attestations — cuts incremental rebuilds from ~30 min
# to ~5 min via the cache-mounts in deploy/Dockerfile and by skipping the
# SBOM + provenance manifest. Unset BUILDX_NO_DEFAULT_ATTESTATIONS for SBOMs.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
export BUILDX_NO_DEFAULT_ATTESTATIONS=1
# Stamp the build with the current git version for the web UI (rail footer).
# `git describe` → "v1.2.0" on a tag, "v1.2.0-3-gabc1234" a few commits later,
# or "dev" if git is unavailable.
export APP_VERSION="${APP_VERSION:-$(git -C "$REPO_ROOT" describe --tags --always --dirty 2>/dev/null || echo dev)}"
log "Build version: $APP_VERSION"

# #56 gap 1 — snapshot live logs before any rebuild that could force-recreate
# containers. No-op on a fresh deploy (no running containers).
"$REPO_ROOT/scripts/save-deploy-logs.sh" || warn "log snapshot failed; continuing"

log "Building images (web · mcp-server · worker · caddy)..."
$COMPOSE --profile edge build

# #212 — bootstrap image cache silently skips new migrations: web/mcp/worker
# get the new migration dir, but bootstrap's layer cache hits on `COPY
# packages` and carries the previous migrations → `migrate deploy` reports
# "No pending migrations" while the new one sits unapplied. Force-rebuild
# bootstrap without cache so its migrations dir always matches the tree.
log "Rebuilding bootstrap (no-cache) to guarantee migrations dir is current..."
$COMPOSE --profile bootstrap build --no-cache bootstrap

# -------- 3. Database up + schema + FTS --------
log "Starting Postgres..."
$COMPOSE up -d db
for _ in $(seq 1 30); do
  if $COMPOSE exec -T db pg_isready -U "${POSTGRES_USER:-brain}" >/dev/null 2>&1; then break; fi
  sleep 1
done
$COMPOSE exec -T db pg_isready -U "${POSTGRES_USER:-brain}" >/dev/null 2>&1 \
  || die "Postgres failed to become ready in 30s."

log "Ensuring 'vector' extension..."
$COMPOSE exec -T db psql -U "${POSTGRES_USER:-brain}" -d "${POSTGRES_DB:-brain}" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

# pg-boss schema preflight (#88) — detect the v24→v12 unauto-migratable state
# (#71) BEFORE the worker boots and crashloops. Detect-only.
COMPOSE="$COMPOSE" POSTGRES_USER="${POSTGRES_USER:-brain}" POSTGRES_DB="${POSTGRES_DB:-brain}" \
  "$REPO_ROOT/scripts/pgboss-version-check.sh"

log "Applying Prisma migrations..."
$COMPOSE run --rm bootstrap "pnpm --filter @brain/db exec prisma migrate deploy"

# The server never seeds fixture data.
export SEED_ON_DEPLOY=false

if ! $COMPOSE run --rm bootstrap \
  "pnpm --filter @brain/db exec prisma migrate status" >/dev/null 2>&1; then
  warn "Prisma migrate status reports drift — DB schema differs from migrations/. Investigate before proceeding."
fi

log "Applying FTS GIN indexes..."
$COMPOSE exec -T db psql -U "${POSTGRES_USER:-brain}" -d "${POSTGRES_DB:-brain}" \
  < packages/db/sql/session-fts-index.sql >/dev/null

if [ -n "${EMBEDDING_API_KEY:-}${GOOGLE_GEMINI_API_KEY:-}${OPENAI_API_KEY:-}" ]; then
  log "Backfilling embeddings for any rows missing them..."
  $COMPOSE run --rm bootstrap "pnpm --filter @brain/worker backfill:embeddings"
else
  warn "Skipping embedding backfill: no embedding key set."
fi

# -------- 4. Long-running services + edge (Caddy/Redis/backup) --------
log "Starting web · mcp-server · worker · caddy · redis · backup..."
$COMPOSE --profile edge up -d

# -------- 5. Wait for TLS --------
log "Waiting for Caddy to pull certificates (first boot can take ~60s)..."
for _ in $(seq 1 60); do
  if curl -sSf --max-time 3 "https://${BRAIN_PUBLIC_HOSTNAME}/api/healthz" >/dev/null 2>&1; then break; fi
  sleep 2
done

if ! curl -sSf --max-time 3 "https://${BRAIN_PUBLIC_HOSTNAME}/api/healthz" >/dev/null 2>&1; then
  warn "HTTPS on https://${BRAIN_PUBLIC_HOSTNAME}/ not reachable after 120s. Recent caddy logs:"
  $COMPOSE logs caddy --tail=50 >&2 || true
  die "Caddy did not obtain a certificate in time. Check DNS (must point to this host), 80/443 firewall rules, and CADDY_EMAIL validity. Re-run once fixed."
fi

log "Running lockdown audit against the public endpoints..."
BASE_URL="https://${BRAIN_PUBLIC_HOSTNAME}" \
MCP_URL="https://${BRAIN_MCP_PUBLIC_HOSTNAME}" \
  "$REPO_ROOT/scripts/verify-lockdown.sh" || die "Lockdown audit FAILED — deploy refused. Fix the flagged issues and re-run; see docs/SECURITY.md §'Zero-error iteration loop'."

# -------- 6. End-to-end smoke --------
if [ "${DEPLOY_SKIP_SMOKE:-false}" = "true" ]; then
  warn "Skipping post-deploy smoke (DEPLOY_SKIP_SMOKE=true). Run scripts/smoke.sh manually."
else
  log "Running end-to-end smoke..."
  "$REPO_ROOT/scripts/smoke.sh" \
    || die "Smoke checks FAILED — services are up but not behaving correctly. See output above; rerun scripts/smoke.sh after fixing."
fi

cat <<EOF

External Brain is up.

  Webapp         https://${BRAIN_PUBLIC_HOSTNAME}/
  MCP HTTP       https://${BRAIN_MCP_PUBLIC_HOSTNAME}/mcp
  MCP health     https://${BRAIN_MCP_PUBLIC_HOSTNAME}/health

Tail logs:
  $COMPOSE logs -f web mcp-server worker caddy

Tear down (keeps DB + Caddy cert cache):
  $COMPOSE down
EOF
