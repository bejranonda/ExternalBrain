#!/usr/bin/env bash
#
# nav-smoke.sh — visit every in-app navigable surface, confirm 2xx/3xx.
#
# Catches the class of regressions that pass typecheck but blow up at
# runtime: missing components, uncaught server errors, broken redirects,
# routes that 500 on empty state. The list is intentionally HARD-CODED — a
# new nav surface means an explicit addition here.
#
# Usage:
#   ./scripts/nav-smoke.sh                         # local dev stack
#   BASE_URL=https://brain.example.com ./scripts/nav-smoke.sh
#
# Exit codes: 0 all reachable / 1 at least one surface 5xx'd.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
FAIL=0

probe() {
  local path="$1"
  local code
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$BASE_URL$path" 2>/dev/null || echo "000")
  if [ "$code" -ge 500 ] 2>/dev/null || [ "$code" = "000" ]; then
    printf '  \033[31m✗\033[0m %-30s → %s\n' "$path" "$code"
    FAIL=1
  else
    printf '  \033[32m✓\033[0m %-30s → %s\n' "$path" "$code"
  fi
}

printf '\n\033[1mExternal Brain nav smoke\033[0m (%s)\n\n' "$BASE_URL"

printf '\033[1mShell surfaces\033[0m (hash routes served by /)\n'
probe "/"
probe "/#dashboard"
probe "/#oracle"
probe "/#skills"
probe "/#graph"
probe "/#autoskill"
probe "/#sessions"

printf '\n\033[1mAuth + account\033[0m\n'
probe "/signin"
probe "/signout"
probe "/settings/tokens"

printf '\n\033[1mAdmin\033[0m (200 for admin, redirect for others)\n'
probe "/admin"
probe "/admin/vouchers"
probe "/admin/users"
probe "/admin/audit"

printf '\n\033[1mAPI probes\033[0m\n'
probe "/api/healthz"
probe "/api/readyz"
probe "/api/me"
# gated routes — 401/403/503 are expected successes for this smoke;
# only 5xx is a regression.
probe "/api/knowledge"
probe "/api/sessions"
probe "/api/dashboard"
probe "/api/graph"
probe "/api/autoskill/proposals"
probe "/api/export/rules"
probe "/api/admin/vouchers"
probe "/api/admin/users"
probe "/api/admin/audit-log"

if [ "$FAIL" = "0" ]; then
  printf '\n\033[32mPASS\033[0m — every nav surface reachable (no 5xx).\n\n'
  exit 0
else
  printf '\n\033[31mFAIL\033[0m — at least one surface returned 5xx or was unreachable.\n'
  printf 'Inspect: docker compose -f deploy/docker-compose.yml --env-file .env logs web | tail -50\n\n'
  exit 1
fi
