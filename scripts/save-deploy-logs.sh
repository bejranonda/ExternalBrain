#!/usr/bin/env bash
#
# save-deploy-logs.sh — snapshot live container logs to a host directory
# BEFORE any reload / deploy that would force-recreate containers (#56 gap 1).
#
# Why this exists:
#   Docker's `logging:` driver bounds the in-container log buffer (10 MB × 5
#   per-service after the docker-compose change), but force-recreate
#   destroys the previous container's log file. This script snapshots the
#   logs first so a post-incident `grep` always has the preceding evidence.
#
# Output: logs/snapshots/<UTC-ISO-timestamp>/<service>.log + a manifest.txt
# noting the head SHA and the operator's name. Directory is gitignored.
#
# Usage:
#   ./scripts/save-deploy-logs.sh                  # snapshot all running services
#   ./scripts/save-deploy-logs.sh web mcp-server   # subset
#
# Idempotent: never destructive. Safe to call from any deploy / reload path.

set -euo pipefail
cd "$(dirname "$0")/.."

# UTC ISO-8601 with safe-for-fs separators (no colons).
TS=$(date -u +"%Y%m%dT%H%M%SZ")
DEST="logs/snapshots/$TS"
mkdir -p "$DEST"

# Choose services. Default: every container Compose knows about that's
# currently running.
COMPOSE="docker compose -f deploy/docker-compose.yml --env-file .env"
if [ "$#" -gt 0 ]; then
  SERVICES=("$@")
else
  # Snapshot every container that's currently up; skip ones that aren't.
  mapfile -t SERVICES < <(
    $COMPOSE ps --status running --services 2>/dev/null || true
  )
fi

if [ "${#SERVICES[@]}" -eq 0 ]; then
  printf '\033[33m[save-logs]\033[0m no running services to snapshot\n' >&2
  rmdir "$DEST" 2>/dev/null || true
  exit 0
fi

printf '\033[36m[save-logs]\033[0m snapshotting %s → %s\n' "${SERVICES[*]}" "$DEST"

# Manifest first — annotates what state the snapshot was taken at.
{
  echo "snapshot_taken_utc=$TS"
  echo "git_head=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "git_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  echo "operator=${USER:-unknown}@$(hostname -s 2>/dev/null || echo unknown)"
  echo "services=${SERVICES[*]}"
} > "$DEST/manifest.txt"

# Per-service log dump. `--timestamps` makes lines greppable by ISO time.
# Use --no-color so ANSI codes don't pollute the file. Cap at the last
# 50 000 lines per service so a chatty container doesn't produce a huge
# snapshot — that's ~6 hours of typical traffic.
for svc in "${SERVICES[@]}"; do
  out="$DEST/${svc}.log"
  if $COMPOSE logs --timestamps --no-color --tail 50000 "$svc" > "$out" 2>&1; then
    bytes=$(stat -c %s "$out" 2>/dev/null || stat -f %z "$out" 2>/dev/null || echo "?")
    printf '  \033[32m✓\033[0m %s (%s bytes)\n' "$svc" "$bytes"
  else
    printf '  \033[33m!\033[0m %s — log capture failed; container may already be gone\n' "$svc"
  fi
done

# Compress aggressively to keep the host dir small. zstd is fast + tight;
# fall back to gzip if zstd isn't on PATH.
if command -v zstd >/dev/null 2>&1; then
  for f in "$DEST"/*.log; do [ -f "$f" ] && zstd -q --rm "$f"; done
elif command -v gzip >/dev/null 2>&1; then
  for f in "$DEST"/*.log; do [ -f "$f" ] && gzip "$f"; done
fi

printf '\033[36m[save-logs]\033[0m snapshot complete: %s\n' "$DEST"

# Retention cap — keep the 20 most recent snapshots, prune older ones so
# logs/snapshots/ doesn't grow without bound on long-lived hosts.
if [ -d logs/snapshots ]; then
  # shellcheck disable=SC2012
  ls -1t logs/snapshots 2>/dev/null \
    | tail -n +21 \
    | while read -r old; do
        [ -n "$old" ] && rm -rf "logs/snapshots/$old"
      done
fi
