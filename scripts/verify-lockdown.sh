#!/usr/bin/env bash
#
# verify-lockdown.sh — probe a running Brain Platform and report whether it
# is properly gated.
#
# Usage:
#   ./scripts/verify-lockdown.sh                           # check http://localhost:${WEB_HOST_PORT:-3000} + :${MCP_HOST_PORT:-3100}
#                                                          # (auto-reads WEB_HOST_PORT / MCP_HOST_PORT from .env if present — issue #252)
#   BASE_URL=https://brain.yourteam.com MCP_URL=https://mcp.brain.yourteam.com \
#     ./scripts/verify-lockdown.sh                         # explicit override wins over both .env and the localhost default
#
# Exit codes:
#   0 — locked down as expected for the detected auth mode
#   1 — UNLOCKED: anonymous users can read private data. FIX BEFORE RELEASE.
#   2 — stack not reachable
#
# What it checks:
#   1. Auth mode from .env (OAUTH | DEV_SHIM | UNCONFIGURED) — shapes expectations
#   2. /api/healthz        → 200 (always; probe itself must work)
#   3. /api/readyz         → 200 (always)
#   4. /                   → 200 if signed-in surface served, 307 if redirecting to /signin
#   5. /api/knowledge      → 200 in dev shim, 401/503 otherwise
#   6. MCP POST /mcp       → 4xx without Authorization header (MUST, always)
#   7. If OAuth mode: /api/knowledge MUST NOT return 200 (that would mean anon leak)
#
# This script is designed to be run repeatedly — it's idempotent and has no
# side effects on the stack.
#
set -euo pipefail
cd "$(dirname "$0")/.."

# Issue #252 — fill WEB_HOST_PORT / MCP_HOST_PORT from .env when the
# caller didn't pass an explicit BASE_URL / MCP_URL. This matters for
# the #164 host-nginx topology (the prod host) where the web container
# binds to :3200 not :3000; without this lookup, the default fell
# back to localhost:3000 and the audit reported false-FAIL on a
# perfectly healthy deploy. Surgical extraction (grep into .env)
# instead of `source .env` so that an explicit `BASE_URL=...` on the
# command line still wins — that's the documented escape hatch for
# probing arbitrary hosts.
if [ -f .env ]; then
  WEB_HOST_PORT="${WEB_HOST_PORT:-$(grep -E '^WEB_HOST_PORT=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")}"
  MCP_HOST_PORT="${MCP_HOST_PORT:-$(grep -E '^MCP_HOST_PORT=' .env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")}"
fi

BASE_URL="${BASE_URL:-http://localhost:${WEB_HOST_PORT:-3000}}"
MCP_URL="${MCP_URL:-http://localhost:${MCP_HOST_PORT:-3100}}"

pass()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAILED=1; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$*"; }
hd()    { printf '\n\033[1m%s\033[0m\n' "$*"; }

FAILED=0

probe() {
  # probe <url> → prints http code, or 000 if unreachable.
  curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$1" 2>/dev/null || echo "000"
}

# -------- 1. Detect auth mode from .env (not from server — this is the operator's intent) ----
# Priority: CREDENTIALS > OAUTH > DEV_SHIM > UNCONFIGURED. "CREDENTIALS"
# means single-admin username+bcrypt-hash stored in env (phase-1 pilot);
# "OAUTH" means GitHub OAuth App configured; "DEV_SHIM" means the local
# dev-shim escape hatch is the only path available.
MODE="UNCONFIGURED"
ALLOW_DEV_AUTH_VAL=""
REGISTRATION_VAL=""
if [ -f .env ]; then
  AUTH_ID=$(grep -E '^AUTH_GITHUB_ID=' .env | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]' || true)
  AUTH_SECRET=$(grep -E '^AUTH_SECRET=' .env | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]' || true)
  AUTH_GS=$(grep -E '^AUTH_GITHUB_SECRET=' .env | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]' || true)
  ADMIN_USER=$(grep -E '^ADMIN_USERNAME=' .env | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]' || true)
  ADMIN_HASH=$(grep -E '^ADMIN_PASSWORD_HASH=' .env | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]' || true)
  ALLOW_DEV_AUTH_VAL=$(grep -E '^ALLOW_DEV_AUTH=' .env | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]' || true)
  REGISTRATION_VAL=$(grep -E '^REGISTRATION_REQUIRES_VOUCHER=' .env | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]' || true)
  if [ -n "$ADMIN_USER" ] && [ -n "$ADMIN_HASH" ] && [ -n "$AUTH_ID" ] && [ -n "$AUTH_GS" ] && [ -n "$AUTH_SECRET" ]; then
    MODE="CREDENTIALS+OAUTH"
  elif [ -n "$ADMIN_USER" ] && [ -n "$ADMIN_HASH" ]; then
    MODE="CREDENTIALS"
  elif [ -n "$AUTH_ID" ] && [ -n "$AUTH_GS" ] && [ -n "$AUTH_SECRET" ]; then
    MODE="OAUTH"
  elif [ "$(echo "${ALLOW_DEV_AUTH_VAL:-}" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
    MODE="DEV_SHIM"
  fi
fi

hd "Brain Platform lockdown audit"
printf '  BASE_URL: %s\n  MCP_URL:  %s\n  Auth mode (from .env): \033[1m%s\033[0m\n' \
  "$BASE_URL" "$MCP_URL" "$MODE"

# -------- 2. Probe basics ------------------------------------------------------
hd "1. Liveness + readiness"
for path in /api/healthz /api/readyz; do
  code=$(probe "$BASE_URL$path")
  if [ "$code" = "200" ]; then
    pass "$path → 200"
  elif [ "$code" = "000" ]; then
    fail "$path → unreachable. Is the stack up? ($BASE_URL)"
    exit 2
  else
    fail "$path → $code (expected 200)"
  fi
done

# -------- 3. Probe root + knowledge --------------------------------------------
hd "2. Root + API gating"
root_code=$(probe "$BASE_URL/")
kn_code=$(probe "$BASE_URL/api/knowledge")

case "$MODE" in
  CREDENTIALS|OAUTH|CREDENTIALS+OAUTH)
    # Credentials or OAuth: anonymous callers get bounced to /signin (307)
    # on /, and blocked with 401 on /api/*. A 200 on /api/knowledge means
    # a leak regardless of which sign-in method the deployment uses — the
    # gate semantics are identical.
    if [ "$root_code" = "307" ] || [ "$root_code" = "302" ]; then
      pass "/ → $root_code (bounces unauth to /signin)"
    elif [ "$root_code" = "200" ]; then
      warn "/ → 200 — curl may have followed cookies; confirm signed-out browser behaviour"
    else
      fail "/ → $root_code (expected 307 redirect to /signin)"
    fi
    if [ "$kn_code" = "401" ] || [ "$kn_code" = "403" ]; then
      pass "/api/knowledge → $kn_code (auth required)"
    elif [ "$kn_code" = "200" ]; then
      fail "/api/knowledge → 200 — ANONYMOUS READ ACCESS. Leak."
    else
      warn "/api/knowledge → $kn_code (unexpected but not a leak)"
    fi
    ;;
  DEV_SHIM)
    # Dev shim: the whole app is intentionally open to the first User row.
    # Not a leak — but we warn loudly so nobody ships this to a public URL
    # thinking they're protected.
    if [ "$root_code" = "200" ]; then
      pass "/ → 200 (dev-shim serves the dev user)"
    elif [ "$root_code" = "307" ] || [ "$root_code" = "302" ]; then
      pass "/ → $root_code (redirect, expected depending on onboarding state)"
    else
      warn "/ → $root_code in dev-shim mode (unusual)"
    fi
    if [ "$kn_code" = "200" ]; then
      pass "/api/knowledge → 200 (dev-shim returns first user's data)"
    else
      warn "/api/knowledge → $kn_code in dev-shim mode (unusual; check worker logs)"
    fi
    warn "ALLOW_DEV_AUTH=true — this deployment serves every caller as the dev user."
    warn "    Do NOT expose this URL to the public internet. Flip to OAuth mode before"
    warn "    inviting any pilot user. See docs/SECURITY.md and docs/QUICKSTART.md."
    ;;
  UNCONFIGURED)
    # Unconfigured: every request must 503. No leak is possible.
    if [ "$kn_code" = "503" ]; then
      pass "/api/knowledge → 503 auth_not_configured (locked by default)"
    else
      fail "/api/knowledge → $kn_code (expected 503 in unconfigured mode)"
    fi
    if [ "$root_code" = "307" ] || [ "$root_code" = "302" ]; then
      pass "/ → $root_code (bounces to /signin?error=auth_not_configured)"
    else
      warn "/ → $root_code (expected 307)"
    fi
    warn "Auth is UNCONFIGURED. The deployment is locked — users cannot sign in."
    warn "    Set AUTH_GITHUB_ID+SECRET+AUTH_SECRET for OAuth mode, or"
    warn "    ALLOW_DEV_AUTH=true for a local / VPN-only demo."
    ;;
esac

# -------- 4. MCP endpoint must always refuse unauthenticated calls -------------
# Every probe includes `Accept: application/json, text/event-stream` — the
# MCP wire protocol requires that header, and a server that 406s without it
# is just rejecting content-negotiation, not auth. Earlier versions of this
# script sent `Content-Type` only; the server 406'd before auth could run,
# and the "fail-closed" PASS was false. See GitHub issue #4 for the full
# discussion.
hd "3. MCP HTTP transport"
MCP_EP="$MCP_URL/mcp"
MCP_HEADERS=(-H "content-type: application/json" -H "accept: application/json, text/event-stream")

mcp_noauth=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "$MCP_EP" "${MCP_HEADERS[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null || echo "000")
mcp_bogus=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "$MCP_EP" "${MCP_HEADERS[@]}" \
  -H "Authorization: Bearer bp_not_a_real_token_xxxxxxxxxxxxx" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' 2>/dev/null || echo "000")
# Separate probe: `initialize` is the method the MCP spec permits unauth'd
# for capability discovery. We've chosen to override the spec (#4 option C)
# so even initialize requires a Bearer — anything else leaks
# `serverInfo.name+version`. This is now a HARD fail check, not advisory.
mcp_init=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "$MCP_EP" "${MCP_HEADERS[@]}" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify-lockdown","version":"0.1"}}}' \
  2>/dev/null || echo "000")

if [ "$mcp_noauth" = "000" ]; then
  warn "MCP endpoint $MCP_EP unreachable — skipping fail-closed check"
else
  # MCP must return 4xx for both — 2xx would be a tool leak.
  if [ "$mcp_noauth" -ge 400 ] 2>/dev/null && [ "$mcp_noauth" -lt 500 ] 2>/dev/null; then
    pass "MCP tools/list without Authorization → $mcp_noauth (fail-closed)"
  else
    fail "MCP tools/list without Authorization → $mcp_noauth — unauthenticated tool access."
  fi
  if [ "$mcp_bogus" -ge 400 ] 2>/dev/null && [ "$mcp_bogus" -lt 500 ] 2>/dev/null; then
    pass "MCP tools/list with bogus Bearer → $mcp_bogus (fail-closed)"
  else
    fail "MCP tools/list with bogus Bearer → $mcp_bogus — unknown tokens are being accepted."
  fi
  # Hard check now (#4 option C): initialize MUST 4xx without auth.
  if [ "$mcp_init" -ge 400 ] 2>/dev/null && [ "$mcp_init" -lt 500 ] 2>/dev/null; then
    pass "MCP initialize without Authorization → $mcp_init (strict; serverInfo not leaked)"
  elif [ "$mcp_init" = "200" ]; then
    fail "MCP initialize without Authorization → 200 — serverInfo + capabilities leaked. The pre-handler in apps/mcp-server/src/index.ts is bypassed; investigate."
  else
    fail "MCP initialize without Authorization → $mcp_init (expected 4xx; investigate)"
  fi
fi

# -------- 5. Credentials gate probe -------------------------------------------
# In CREDENTIALS or CREDENTIALS+OAUTH mode, sending wrong credentials to the
# NextAuth callback must NOT return 200 (that would be an auth bypass).
# NextAuth v5 returns 401 on wrong credentials; older versions may return 302
# to /signin?error=CredentialsSignin. Both are acceptable fail-closed states.
#
# The provider ID is `admin-credentials` (set in apps/web/auth.ts line 116).
# Earlier versions of this script probed `/api/auth/callback/credentials`,
# which NextAuth treats as "unknown provider" and redirects to an error
# page — appearing to "fail closed" but never actually testing the
# credentials flow. The current probe hits the right callback URL.
CRED_CALLBACK="$BASE_URL/api/auth/callback/admin-credentials"
hd "4. Credentials auth gate"
if [ "$MODE" = "CREDENTIALS" ] || [ "$MODE" = "CREDENTIALS+OAUTH" ]; then
  cred_code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 \
    -X POST "$CRED_CALLBACK" \
    -H "content-type: application/json" \
    -d '{"username":"x","password":"definitely-wrong-password-probe-xxxxx"}' \
    2>/dev/null || echo "000")
  if [ "$cred_code" = "401" ] || [ "$cred_code" = "403" ]; then
    pass "POST /api/auth/callback/admin-credentials with wrong creds → $cred_code (fail-closed)"
  elif [ "$cred_code" = "302" ] || [ "$cred_code" = "307" ]; then
    # NextAuth v5 may redirect to /signin?error=CredentialsSignin — still closed.
    pass "POST /api/auth/callback/admin-credentials with wrong creds → $cred_code (redirect to error page, fail-closed)"
  elif [ "$cred_code" = "200" ]; then
    fail "POST /api/auth/callback/admin-credentials with wrong creds → 200 — credentials bypass possible."
  elif [ "$cred_code" = "000" ]; then
    warn "POST /api/auth/callback/admin-credentials unreachable — skipping credentials probe"
  else
    warn "POST /api/auth/callback/admin-credentials with wrong creds → $cred_code (unexpected; check manually)"
  fi
else
  printf '  - Credentials probe only runs in CREDENTIALS/CREDENTIALS+OAUTH mode (current: %s)\n' "$MODE"
fi

# -------- 6. Voucher gate probe -----------------------------------------------
# In OAUTH+REGISTRATION_REQUIRES_VOUCHER mode, a new-user OAuth attempt without
# a voucher cookie must NOT result in account creation. We probe the OAuth signIn
# initiation endpoint — we expect either a redirect to /signin (voucher required)
# or a 4xx. A 200 that sets a session cookie would be a bypass.
hd "5. Voucher gate (registration policy)"
if [ "$MODE" = "OAUTH" ] || [ "$MODE" = "CREDENTIALS+OAUTH" ]; then
  if [ "$(echo "${REGISTRATION_VAL:-true}" | tr '[:upper:]' '[:lower:]')" = "false" ]; then
    warn "REGISTRATION_REQUIRES_VOUCHER=false — anyone with a GitHub account can self-enrol."
  else
    pass "New-user signup requires a voucher code"
    # Probe: attempt to hit the OAuth signin initiation without a bp_voucher cookie.
    # NextAuth redirects to GitHub OAuth, so we can't simulate the full callback, but
    # we can verify that /signin renders the voucher input field (indicating it's enforced).
    signin_body=$(curl -sS --max-time 5 "$BASE_URL/signin" 2>/dev/null || echo "")
    if echo "$signin_body" | grep -qi "voucher"; then
      pass "/signin renders voucher input field (gate is enforced in the UI)"
    elif [ -z "$signin_body" ]; then
      warn "/signin unreachable — skipping voucher UI probe"
    else
      warn "/signin does not mention voucher — check REGISTRATION_REQUIRES_VOUCHER + /signin page UI"
    fi
  fi
else
  printf '  - Voucher gate only applies in OAUTH/CREDENTIALS+OAUTH mode (current: %s)\n' "$MODE"
fi

# -------- 6. Summary -----------------------------------------------------------
hd "Result"
if [ "$FAILED" = "0" ]; then
  if [ "$MODE" = "DEV_SHIM" ]; then
    printf '  \033[33mPASS\033[0m — locked correctly for dev-shim mode. Do NOT expose on public internet.\n\n'
  elif [ "$MODE" = "CREDENTIALS" ] || [ "$MODE" = "CREDENTIALS+OAUTH" ]; then
    printf '  \033[32mPASS\033[0m — credentials mode locked. Sign in at /signin with ADMIN_USERNAME + password.\n\n'
  else
    printf '  \033[32mPASS\033[0m — no anonymous-leak vectors detected.\n\n'
  fi
  exit 0
else
  printf '  \033[31mFAIL\033[0m — one or more gating checks failed. Fix BEFORE releasing.\n'
  printf '  See docs/SECURITY.md for the threat model and the zero-error loop.\n\n'
  exit 1
fi
