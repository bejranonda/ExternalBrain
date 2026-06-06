#!/usr/bin/env bash
#
# Production deploy — bare VM with a public IP + DNS pointed at it.
#
# What makes this different from `./scripts/deploy.sh`:
#   - Adds Caddy sidecar for automatic TLS (Let's Encrypt ACME HTTP-01)
#   - Removes host-port bindings for web/mcp-server/db (Caddy fronts them)
#   - Requires NODE_ENV=production + populated AUTH_* env vars
#   - Waits for Caddy to pull the first certificate before reporting ready
#
# Re-run is idempotent. Safe to chain after a `git pull`.

set -euo pipefail
[ "${DEPLOY_DEBUG:-false}" = "true" ] && set -x

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
COMPOSE="docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml --env-file .env"

log()  { printf '\033[36m[deploy-prod]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[deploy-prod]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[deploy-prod]\033[0m %s\n' "$*" >&2; exit 1; }

# -------- 1. Preflight --------
[ -f deploy/docker-compose.yml ]      || die "deploy/docker-compose.yml missing — wrong cwd, or repo is corrupt."
[ -f deploy/docker-compose.prod.yml ] || die "deploy/docker-compose.prod.yml missing — required for production."
[ -f .env ] || die "Missing .env. See deploy/PRODUCTION.md §'Environment checklist'."

# Refuse to deploy from a dirty worktree — production deploys must come from
# a clean tracked commit so `git rev-parse HEAD` in logs is meaningful.
# Override (very rarely) with DEPLOY_ALLOW_DIRTY=true.
if [ "${DEPLOY_ALLOW_DIRTY:-false}" != "true" ] && ! git diff --quiet HEAD 2>/dev/null; then
  die "Uncommitted changes in worktree — refusing prod deploy. Commit or stash first, or set DEPLOY_ALLOW_DIRTY=true if you really mean it."
fi

ENV_PERMS=$(stat -c '%a' .env 2>/dev/null || stat -f '%Lp' .env 2>/dev/null || echo "")
if [ -n "$ENV_PERMS" ] && ! [[ "$ENV_PERMS" =~ ^6[04]0$ ]]; then
  warn ".env mode is $ENV_PERMS — recommend \`chmod 600 .env\` (it carries AUTH_SECRET + admin hash + OAuth secret)."
fi

FREE_GB=$(df -BG --output=avail . 2>/dev/null | tail -n1 | tr -dc '0-9' || echo "")
if [ -n "$FREE_GB" ] && [ "$FREE_GB" -lt 10 ]; then
  warn "Only ${FREE_GB}G free on this filesystem — prod builds typically need ~6G. Consider \`docker system prune -af\` if this trips."
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

# Auth preflight: the app supports two production auth modes (see
# .env.example "Mode A" / "Mode B"):
#   A) Credentials  — ADMIN_USERNAME + ADMIN_PASSWORD_HASH (phase-1 pilot default)
#   B) GitHub OAuth — AUTH_GITHUB_ID + AUTH_GITHUB_SECRET
# Either mode requires AUTH_SECRET. ALLOW_DEV_AUTH_IN_PRODUCTION=true
# is reserved for the dev-shim escape hatch (VPN-only deploys).
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
  warn "Running with the dev-auth shim in production because ALLOW_DEV_AUTH_IN_PRODUCTION=true. Only acceptable behind a VPN."
fi

# Secondary check — the Phase-S lockdown guard. Even with auth configured, if
# ALLOW_DEV_AUTH is also on, the app accepts anonymous requests as the dev
# user. Refuse the combination on a production deploy.
if [ "$(echo "${ALLOW_DEV_AUTH:-false}" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
  die "ALLOW_DEV_AUTH=true is refused on a production deploy. Unset it in .env. (Dev-shim alongside real auth is a configuration error — see docs/SECURITY.md §'Auth modes'.)"
fi

# Admin-promotion list. ADMIN_EMAILS (plural, comma-separated) is the
# canonical key — same string used for OAuth admin promotion AND for the
# Mode-A credentials admin's email column (#39). The legacy singular
# ADMIN_EMAIL is still promoted to ADMIN_EMAILS at script-load time so
# existing operators stay unblocked, but new deployments should set
# ADMIN_EMAILS only.
if [ -z "${ADMIN_EMAILS:-}" ] && [ -n "${ADMIN_EMAIL:-}" ]; then
  warn "ADMIN_EMAIL='${ADMIN_EMAIL}' is set without ADMIN_EMAILS — using it, but ADMIN_EMAIL is deprecated (#39). Rename to ADMIN_EMAILS in .env to silence this and prepare for ADMIN_EMAIL removal."
  export ADMIN_EMAILS="${ADMIN_EMAIL}"
elif [ -z "${ADMIN_EMAILS:-}" ]; then
  warn "ADMIN_EMAILS empty — the first pilot signer has no admin. Either set this now or plan to UPDATE \"User\" SET role='admin' manually after sign-in."
fi

if [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${GOOGLE_GEMINI_API_KEY:-}" ] && [ -z "${EMBEDDING_API_KEY:-}" ]; then
  warn "No embedding key set (OPENAI_API_KEY / GOOGLE_GEMINI_API_KEY / EMBEDDING_API_KEY all empty). Oracle + KRA will fail until a key is available."
fi

if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose v2 required."
fi

# -------- 2. Build --------
# BuildKit + no default attestations — see scripts/deploy.sh for the full
# rationale. Cuts incremental prod rebuilds from ~30 min to ~5 min by
# activating the cache mounts in deploy/Dockerfile and skipping the
# SBOM + provenance manifest list. Unset BUILDX_NO_DEFAULT_ATTESTATIONS
# if your compliance regime requires SBOMs attached to images.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
export BUILDX_NO_DEFAULT_ATTESTATIONS=1
# Stamp the build with the current git version for the web UI (rail footer).
# On prod this is normally a clean tag checkout (e.g. "v1.1.0"); "dev" if git
# is unavailable. See scripts/deploy.sh for the full rationale.
export APP_VERSION="${APP_VERSION:-$(git -C "$REPO_ROOT" describe --tags --always --dirty 2>/dev/null || echo dev)}"
log "Build version: $APP_VERSION"

# #56 gap 1 — snapshot live logs before any rebuild that could force-recreate
# containers. Critical on prod: if a deploy goes wrong, the previous logs
# survive in logs/snapshots/<timestamp>/ for triage. No-op on a fresh deploy.
"$REPO_ROOT/scripts/save-deploy-logs.sh" || warn "log snapshot failed; continuing"

log "Building images (web · mcp-server · worker · bootstrap · caddy)..."
$COMPOSE --profile bootstrap build

# #212 — bootstrap image cache silently skips new migrations on prod (2/2
# recurrence). web/mcp/worker get the new migration dir but bootstrap's
# layer cache hits on the `COPY packages` step, so it carries the previous
# migrations and `migrate deploy` reports "No pending migrations to apply"
# while the new migration sits unapplied. Force-rebuild bootstrap with
# --no-cache so its migrations dir always matches the working tree. Costs
# ~15-30s extra; cheap compared to a partial-migration debug session.
log "Rebuilding bootstrap (no-cache) to guarantee migrations dir is current..."
$COMPOSE --profile bootstrap build --no-cache bootstrap

# -------- 3. DB up + schema + FTS --------
log "Starting Postgres..."
$COMPOSE up -d db
for _ in $(seq 1 30); do
  if $COMPOSE exec -T db pg_isready -U "${POSTGRES_USER:-brain}" >/dev/null 2>&1; then break; fi
  sleep 1
done

log "Ensuring 'vector' extension..."
$COMPOSE exec -T db psql -U "${POSTGRES_USER:-brain}" -d "${POSTGRES_DB:-brain}" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

log "Applying Prisma migrations..."
$COMPOSE run --rm bootstrap "pnpm --filter @brain/db exec prisma migrate deploy"

# #236 — production NEVER seeds. Explicitly export SEED_ON_DEPLOY=false
# to override the default in case scripts/deploy.sh's logic ever leaks
# in via a refactor or import. This is the audit-friendly explicit form
# of "we definitely do not want fixture data on prod."
export SEED_ON_DEPLOY=false

if ! $COMPOSE run --rm bootstrap \
  "pnpm --filter @brain/db exec prisma migrate status" >/dev/null 2>&1; then
  warn "Prisma migrate status reports drift — DB schema differs from migrations/. Investigate before proceeding."
fi

log "Applying FTS GIN indexes..."
$COMPOSE exec -T db psql -U "${POSTGRES_USER:-brain}" -d "${POSTGRES_DB:-brain}" \
  < packages/db/sql/session-fts-index.sql >/dev/null

# Optional: backfill any missing embeddings.
if [ -n "${EMBEDDING_API_KEY:-}${GOOGLE_GEMINI_API_KEY:-}${OPENAI_API_KEY:-}" ]; then
  log "Backfilling embeddings..."
  $COMPOSE run --rm bootstrap "pnpm --filter @brain/worker backfill:embeddings"
fi

# -------- 4. Long-running services + Caddy --------
log "Starting web · mcp-server · worker · caddy..."
$COMPOSE up -d web mcp-server worker caddy

# -------- 5. Wait for TLS --------
log "Waiting for Caddy to pull certificates (first boot can take ~60s)..."
for _ in $(seq 1 60); do
  if curl -sSf --max-time 3 "https://${BRAIN_PUBLIC_HOSTNAME}/api/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! curl -sSf --max-time 3 "https://${BRAIN_PUBLIC_HOSTNAME}/api/healthz" >/dev/null 2>&1; then
  warn "HTTPS on https://${BRAIN_PUBLIC_HOSTNAME}/ not reachable after 120s. Recent caddy logs:"
  $COMPOSE logs caddy --tail=50 >&2 || true
  die "Caddy did not obtain a certificate in time. Check DNS (must point to this VM), 80/443 firewall rules, and CADDY_EMAIL validity. Re-run once the cause is fixed."
fi

log "Running lockdown audit against the public endpoints..."
BASE_URL="https://${BRAIN_PUBLIC_HOSTNAME}" \
MCP_URL="https://${BRAIN_MCP_PUBLIC_HOSTNAME}" \
  "$REPO_ROOT/scripts/verify-lockdown.sh" || die "Lockdown audit FAILED — production deploy refused. Fix the flagged issues and re-run; see docs/SECURITY.md §'Zero-error iteration loop'."

# -------- 6. End-to-end smoke --------
# Verifies what the lockdown audit can't: webapp/MCP healthz reachable
# AND (if a token is supplied) the full Streamable-HTTP session lifecycle.
# Tokens aren't typically available at first-deploy time, so the auth
# tier no-ops with a hint when BRAIN_MCP_TOKEN is unset. Skip via
# DEPLOY_SKIP_SMOKE=true if you're iterating and the smoke is already known
# good (e.g. re-running after a no-op env tweak).
if [ "${DEPLOY_SKIP_SMOKE:-false}" = "true" ]; then
  warn "Skipping post-deploy smoke (DEPLOY_SKIP_SMOKE=true). Run scripts/smoke-prod.sh manually."
else
  log "Running end-to-end smoke..."
  "$REPO_ROOT/scripts/smoke-prod.sh" \
    || die "Smoke checks FAILED — services are up but not behaving correctly. See output above; rerun scripts/smoke-prod.sh manually after fixing."
fi

cat <<EOF

Brain Platform (production) is up.

  Webapp         https://${BRAIN_PUBLIC_HOSTNAME}/
  MCP HTTP       https://${BRAIN_MCP_PUBLIC_HOSTNAME}/mcp
  MCP health     https://${BRAIN_MCP_PUBLIC_HOSTNAME}/health

Tail logs:
  $COMPOSE logs -f web mcp-server worker caddy

Tear down (keeps DB + Caddy cert cache):
  $COMPOSE down
EOF
