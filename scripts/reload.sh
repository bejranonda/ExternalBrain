#!/usr/bin/env bash
#
# reload.sh — fast per-service rebuild for tight dev iteration.
#
# Usage:
#   ./scripts/reload.sh                 # rebuild + recreate web (default)
#   ./scripts/reload.sh web             # same, explicit
#   ./scripts/reload.sh worker          # rebuild worker after editing apps/worker
#   ./scripts/reload.sh mcp-server      # rebuild mcp-server after editing apps/mcp-server
#   ./scripts/reload.sh web mcp-server  # multiple services at once
#
# What it does:
#   1. `docker compose build <services>`
#   2. `docker compose up -d --force-recreate <services>`
#   3. Waits for /api/healthz if web is in the list
#   4. Runs verify-lockdown.sh if web was reloaded (sanity check that the
#      change didn't open a leak)
#
# When to use this instead of `./scripts/deploy.sh`:
#   - You edited TypeScript in apps/* or packages/* — this avoids the DB
#     wait and migration step (~30-60s saved).
#   - You changed .env — you still need --force-recreate to pick up new
#     env values, which `reload.sh` does.
#
# When to use `./scripts/deploy.sh` instead:
#   - You edited packages/db/prisma/schema.prisma (needs migrations).
#   - You're on a fresh machine with no volumes yet.
#
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
COMPOSE="docker compose -f deploy/docker-compose.yml --env-file .env"

# Issue #252 — load .env so WEB_HOST_PORT / MCP_HOST_PORT (and any other
# host-port overrides used by the #164 host-nginx topology) are available
# to the bash variables below. Compose already reads .env via --env-file
# for container env, but the shell expansions at lines 70+ and the
# verify-lockdown.sh invocation at line 76 run in *this* process and
# need the values in the shell, not just in the container. Without this
# the audit chains with BASE_URL=http://localhost:3000 and reports
# false-FAIL on any host where the web service binds to a different
# port (like the server host which binds to :3200). `set -a` matches the
# pattern used by deploy.sh / backup-restore.sh.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

log()  { printf '\033[36m[reload]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[reload]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[reload]\033[0m %s\n' "$*" >&2; exit 1; }

SERVICES=("$@")
if [ "${#SERVICES[@]}" -eq 0 ]; then
  SERVICES=("web")
fi

# Validate each service name against compose config so typos fail fast.
VALID=$($COMPOSE config --services 2>/dev/null | tr '\n' ' ' || true)
for svc in "${SERVICES[@]}"; do
  if ! echo " $VALID " | grep -q " $svc "; then
    die "Unknown service '$svc'. Known: $VALID"
  fi
done

log "Rebuilding: ${SERVICES[*]}"
$COMPOSE build "${SERVICES[@]}"

# #56 gap 1 — snapshot the live container logs BEFORE force-recreate destroys
# them. Failure here is non-fatal (e.g. container already gone, or no .env
# yet on a fresh box) — the deploy continues either way.
"$REPO_ROOT/scripts/save-deploy-logs.sh" "${SERVICES[@]}" || warn "log snapshot failed; continuing"

log "Recreating: ${SERVICES[*]}"
$COMPOSE up -d --force-recreate "${SERVICES[@]}"

WEB_RELOADED=0
for svc in "${SERVICES[@]}"; do
  if [ "$svc" = "web" ]; then WEB_RELOADED=1; fi
done

if [ "$WEB_RELOADED" = "1" ]; then
  log "Waiting for web liveness..."
  for _ in $(seq 1 30); do
    if curl -sSf --max-time 2 "http://localhost:${WEB_HOST_PORT:-3000}/api/healthz" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  log "Re-running lockdown audit..."
  BASE_URL="http://localhost:${WEB_HOST_PORT:-3000}" \
  MCP_URL="http://localhost:${MCP_HOST_PORT:-3100}" \
    "$REPO_ROOT/scripts/verify-lockdown.sh" \
    || warn "Lockdown audit reported issues — review above."
fi

log "Done."
