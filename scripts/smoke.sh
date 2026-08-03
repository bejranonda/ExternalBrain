#!/usr/bin/env bash
#
# Post-deploy smoke test — run after `./scripts/deploy.sh` reports up.
# Also invoked automatically by deploy.sh as its final step.
#
# Two tiers:
#
#   Public (always runs, no auth):
#     1. Webapp /api/healthz returns 200
#     2. MCP /health returns ok=true
#
#   Authenticated (only if BRAIN_MCP_TOKEN is set):
#     3. MCP Streamable-HTTP session lifecycle: initialize →
#        notifications/initialized → tools/list returns the brain tool
#        catalog. This is the regression gate for PR #15 (stateful
#        sessions); a regression here would manifest as
#        `-32000 "Bad Request: Server not initialized"` on tools/list.
#     4. DELETE /mcp closes the session cleanly.
#
# At first-deploy time the operator hasn't issued a token yet, so the
# auth tier gracefully no-ops with a hint. Re-run with a token in hand
# once `/settings/tokens` produces one.
#
# Usage:
#   BRAIN_PUBLIC_HOSTNAME=brain.example.com \
#   BRAIN_MCP_PUBLIC_HOSTNAME=mcp.brain.example.com \
#   BRAIN_MCP_TOKEN=bp_...           # optional; enables auth tier \
#     ./scripts/smoke.sh
#
# Sourcing .env picks up BRAIN_PUBLIC_HOSTNAME / BRAIN_MCP_PUBLIC_HOSTNAME
# automatically.

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ] && [ -z "${BRAIN_PUBLIC_HOSTNAME:-}" ]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

: "${BRAIN_PUBLIC_HOSTNAME:?Set in .env or pass on the command line}"
: "${BRAIN_MCP_PUBLIC_HOSTNAME:?Set in .env or pass on the command line}"

ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
log()  { printf '\033[36m──\033[0m %s\n' "$*"; }

WEB="https://${BRAIN_PUBLIC_HOSTNAME}"
MCP="https://${BRAIN_MCP_PUBLIC_HOSTNAME}"

# ── Container health ─────────────────────────────────────────────────────
#
# Nothing else in the repo ever asserted this, and the HTTP checks below
# cannot substitute: the worker has no HTTP surface, so a worker that is
# running-but-broken passes every other check here.
#
# That is not hypothetical. v2.8.0 shipped a worker healthcheck that failed
# on EVERY interval (`node -e "require('pg')…"` → Cannot find module 'pg',
# because pnpm's isolated node_modules doesn't expose a transitive dep to the
# app dir). Deploy reported success, smoke passed, and the container sat
# heading for `unhealthy` until it was found by hand with `docker inspect`.
# A permanently-unhealthy container is worse than no healthcheck: it teaches
# operators to ignore health status.
#
# Deliberately "nothing is unhealthy" rather than "everything is healthy":
# `caddy` defines no healthcheck, and a gate that fails on services which
# never declared one would cry wolf on every run — and a gate that cries
# wolf gets switched off, which is how you end up with no gate at all.
log "container health"
if command -v docker >/dev/null 2>&1 && docker compose -f deploy/docker-compose.yml --env-file .env ps -q >/dev/null 2>&1; then
  UNHEALTHY=""
  STARTING=""
  for cid in $(docker compose -f deploy/docker-compose.yml --env-file .env ps -q 2>/dev/null); do
    name=$(docker inspect --format '{{.Name}}' "$cid" 2>/dev/null | sed 's#^/##')
    # `.State.Health` is absent when the service declares no healthcheck —
    # `{{if}}` keeps that case as the empty string rather than "<no value>".
    state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null || true)
    case "$state" in
      unhealthy) UNHEALTHY="$UNHEALTHY $name" ;;
      starting)  STARTING="$STARTING $name" ;;
    esac
  done
  if [ -n "$UNHEALTHY" ]; then
    printf '\033[31m✗\033[0m unhealthy container(s):%s\n' "$UNHEALTHY" >&2
    for n in $UNHEALTHY; do
      printf '   ── last probe output for %s ──\n' "$n" >&2
      docker inspect --format '{{range .State.Health.Log}}{{.Output}}{{end}}' "$n" 2>/dev/null | tail -5 >&2 || true
    done
    fail "container health check failed — see probe output above"
  fi
  # `starting` is normal briefly after a deploy; report it without failing,
  # since smoke runs immediately and start_period is up to 40s.
  [ -n "$STARTING" ] && printf '\033[33m⚠\033[0m  still starting (not a failure this soon after deploy):%s\n' "$STARTING" >&2
  ok "no unhealthy containers"
else
  printf '\033[33m⚠\033[0m  docker/compose not reachable from here — skipping container health.\n' >&2
fi

log "webapp healthz"
curl -fsS --max-time 5 "$WEB/api/healthz" >/dev/null || fail "$WEB/api/healthz unreachable"
ok "$WEB/api/healthz"

log "mcp health"
HEALTH=$(curl -fsS --max-time 5 "$MCP/health") || fail "$MCP/health unreachable"
echo "$HEALTH" | grep -q '"ok":true' || fail "MCP /health did not report ok=true: $HEALTH"
ok "$MCP/health → $HEALTH"

if [ -z "${BRAIN_MCP_TOKEN:-}" ]; then
  echo
  printf '\033[33m⚠\033[0m  BRAIN_MCP_TOKEN not set — skipping the authenticated MCP session tier.\n' >&2
  printf '   Issue a token at %s/settings/tokens and re-run to verify the\n' "$WEB" >&2
  printf '   Streamable-HTTP session lifecycle (PR #15 regression gate).\n' >&2
  echo
  ok "Public smoke checks passed."
  exit 0
fi

log "mcp initialize"
HDR=$(curl -fsS -D - -o /dev/null --max-time 8 -X POST "$MCP/mcp" \
  -H "Authorization: Bearer $BRAIN_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-prod","version":"0"}}}')
SID=$(echo "$HDR" | awk -F': ' 'tolower($1)=="mcp-session-id"{gsub(/\r/,"",$2);print $2}')
[ -n "$SID" ] || fail "Server returned no Mcp-Session-Id — auth or transport misconfigured"
ok "session=$SID"

log "mcp notifications/initialized"
curl -fsS --max-time 8 -X POST "$MCP/mcp" \
  -H "Authorization: Bearer $BRAIN_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' >/dev/null \
  || fail "notifications/initialized rejected — session not retained (PR #15 regression?)"
ok "session retained across requests"

log "mcp tools/list"
TOOLS=$(curl -fsS --max-time 8 -X POST "$MCP/mcp" \
  -H "Authorization: Bearer $BRAIN_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')

if echo "$TOOLS" | grep -q '"Server not initialized"'; then
  fail "tools/list returned 'Server not initialized' — stateful-session fix regressed (see PR #15)"
fi

NAMES=$(echo "$TOOLS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(' '.join(t['name'] for t in d.get('result',{}).get('tools',[])))" 2>/dev/null || true)
[ -n "$NAMES" ] || fail "tools/list returned no tools. Raw response: $TOOLS"
echo "$NAMES" | grep -q brain_start_session     || fail "brain_start_session missing from tools/list"
echo "$NAMES" | grep -q brain_retrieve_knowledge || fail "brain_retrieve_knowledge missing from tools/list"
ok "tools: $NAMES"

log "cleanup"
curl -fsS --max-time 5 -X DELETE "$MCP/mcp" \
  -H "Authorization: Bearer $BRAIN_MCP_TOKEN" \
  -H "Mcp-Session-Id: $SID" >/dev/null || true
ok "session closed"

echo
ok "All smoke checks (public + authenticated) passed."
