#!/usr/bin/env bash
#
# feedback-digest.sh — weekly "what does prod actually need?" digest (#56 gap 4).
#
# Pulls together signals from across the platform into one markdown report
# so the operator + dev team have a single artefact to skim before the next
# planning round, instead of bouncing between GitHub, container logs, and
# the admin UI.
#
# Sources:
#   - GitHub: open issues (oldest first), open PRs, last 7d merged PRs
#   - Local container logs (web / mcp-server / worker): top error categories
#     by `BrainError.code` from the last 7 days of structured log lines
#   - Cost ledger: last 7d Oracle spend trend (if the DB is reachable)
#   - Auth-posture sanity: the result of verify-lockdown.sh
#
# Output: prints to stdout. Pipe to a file, or to `gh issue create` to
# capture as a tracking issue:
#
#   ./scripts/feedback-digest.sh > /tmp/digest.md
#   gh issue create --title "ops: weekly feedback digest $(date -u +%Y-%m-%d)" \
#                   --body-file /tmp/digest.md \
#                   --label digest
#
# Run from anywhere; cd's into the repo root automatically. Best-effort —
# missing sources just emit a "skipped, reason …" line instead of failing
# the whole script.

set -uo pipefail
cd "$(dirname "$0")/.."

WINDOW_DAYS="${WINDOW_DAYS:-7}"
SINCE=$(date -u -d "${WINDOW_DAYS} days ago" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
        date -u -v-${WINDOW_DAYS}d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || \
        echo "")

cat <<HEADER
# External Brain — feedback digest
Generated: $(date -u +"%Y-%m-%d %H:%M UTC")
Window: last ${WINDOW_DAYS} days (since ${SINCE:-unknown})
Host: $(hostname -s 2>/dev/null || echo unknown)
Git: $(git rev-parse --short HEAD 2>/dev/null || echo unknown) on $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)

HEADER

# -------- 1. GitHub: open issues (oldest first; if it's been open >2 weeks
# without a comment, it's probably stuck) --------
echo "## 1. Open issues"
echo
if command -v gh >/dev/null 2>&1; then
  gh issue list --state open --limit 30 \
    --json number,title,createdAt,updatedAt,author,labels \
    --jq 'sort_by(.createdAt) | .[] | "- #\(.number) — \(.title) — opened \(.createdAt[:10]) by @\(.author.login)\(if (.labels|length)>0 then " — labels: " + (.labels | map(.name) | join(",")) else "" end)"' \
    || echo "_gh issue list failed; check auth_"
else
  echo "_skipped — \`gh\` CLI not installed_"
fi
echo

# -------- 2. GitHub: open PRs --------
echo "## 2. Open PRs"
echo
if command -v gh >/dev/null 2>&1; then
  pr_count=$(gh pr list --state open --json number --jq 'length' 2>/dev/null || echo 0)
  if [ "$pr_count" = "0" ]; then
    echo "_None — clean inbox._"
  else
    gh pr list --state open --limit 30 \
      --json number,title,createdAt,headRefName,isDraft \
      --jq '.[] | "- #\(.number)\(if .isDraft then " (draft)" else "" end) — \(.title) — opened \(.createdAt[:10]) — \(.headRefName)"' \
      || echo "_gh pr list failed_"
  fi
else
  echo "_skipped — \`gh\` CLI not installed_"
fi
echo

# -------- 3. GitHub: recent merges (what shipped lately) --------
echo "## 3. Merged in the last ${WINDOW_DAYS} days"
echo
if command -v gh >/dev/null 2>&1 && [ -n "${SINCE:-}" ]; then
  gh pr list --state merged --search "merged:>=${SINCE:0:10}" --limit 50 \
    --json number,title,mergedAt,baseRefName \
    --jq '.[] | "- #\(.number) — \(.title) — merged \(.mergedAt[:10]) into \(.baseRefName)"' \
    || echo "_gh pr list (merged) failed_"
else
  echo "_skipped — \`gh\` CLI not installed or date util missing_"
fi
echo

# -------- 4. Container errors --------
echo "## 4. Top error categories from container logs"
echo
COMPOSE="docker compose -f deploy/docker-compose.yml --env-file .env"
if command -v docker >/dev/null 2>&1 && [ -f .env ]; then
  echo "Pulling structured-log error events from the last ${WINDOW_DAYS} days. Categories from \`BrainError.code\`."
  echo
  any_errors=0
  for svc in web mcp-server worker; do
    cnt=$($COMPOSE logs --since "${WINDOW_DAYS}d" --no-color "$svc" 2>/dev/null \
          | grep -oE '"code":"[^"]+"' \
          | sort | uniq -c | sort -rn | head -5)
    if [ -n "$cnt" ]; then
      any_errors=1
      echo "**$svc**:"
      echo '```'
      echo "$cnt"
      echo '```'
    fi
  done
  if [ "$any_errors" = "0" ]; then
    echo "_No \`BrainError.code\` events in the window. Either things are fine or the logger isn't being used (worth a sanity check)._"
  fi
else
  echo "_skipped — Docker / .env not available on this host_"
fi
echo

# -------- 5. Cost ledger --------
echo "## 5. Oracle cost trend"
echo
if command -v docker >/dev/null 2>&1 && [ -f .env ]; then
  cost_data=$($COMPOSE exec -T db psql -U "${POSTGRES_USER:-brain}" -d "${POSTGRES_DB:-brain}" -tA -c "
    SELECT date_trunc('day', \"createdAt\")::date AS day,
           COUNT(*) AS calls,
           ROUND(SUM(\"costUsd\")::numeric, 4) AS usd
    FROM \"OracleCostLedger\"
    WHERE \"createdAt\" >= NOW() - INTERVAL '${WINDOW_DAYS} days'
    GROUP BY 1 ORDER BY 1;
  " 2>/dev/null)
  if [ -n "$cost_data" ]; then
    echo '| Day | Calls | USD |'
    echo '|---|---|---|'
    echo "$cost_data" | awk -F'|' '{printf "| %s | %s | $%s |\n", $1, $2, $3}'
  else
    echo "_No OracleCostLedger rows in the window (or DB not reachable)._"
  fi
else
  echo "_skipped — Docker / .env not available_"
fi
echo

# -------- 6. Auth-posture sanity --------
echo "## 6. Lockdown audit"
echo
if [ -x ./scripts/verify-lockdown.sh ]; then
  if ./scripts/verify-lockdown.sh >/tmp/lockdown.txt 2>&1; then
    result=$(grep -E "^[[:space:]]*PASS|^[[:space:]]*FAIL" /tmp/lockdown.txt | head -1)
    echo "Result: \`${result:-unknown}\`"
  else
    echo "**FAIL** — \`scripts/verify-lockdown.sh\` exited non-zero. Triage immediately."
    echo
    echo '```'
    tail -20 /tmp/lockdown.txt
    echo '```'
  fi
  rm -f /tmp/lockdown.txt
else
  echo "_skipped — verify-lockdown.sh not executable_"
fi
echo

# -------- 7. What to do with this --------
cat <<FOOTER
## 7. What to do with this

- Triage open issues older than 14 days: close, label \`stale\`, or
  promote to \`bugfix/*\` per Workflow B.
- Look at error categories above — any new \`code\` values that didn't
  exist last week? File a bug or a hotfix issue (Workflows B/C).
- If cost-ledger jumped >20% week-on-week, investigate before adjusting
  \`MAX_ORACLE_COST_USD_PER_DAY\` upward.

FOOTER
