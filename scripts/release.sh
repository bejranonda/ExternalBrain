#!/usr/bin/env bash
# release.sh — thin wrapper around the GitHub Actions release workflow.
#
# Why this exists: the AI agent (Claude Code / Cursor / etc.) cannot
# merge to `main` directly per AGENTS.md hard rule #1, but it CAN
# dispatch a workflow via `gh workflow run`. This script makes that
# dispatch reproducible and surfaces the run URL so the operator (or
# the AI) can watch it.
#
# Usage:
#   ./scripts/release.sh v0.14.0
#   ./scripts/release.sh v0.14.0 289           # use a specific PR
#   ./scripts/release.sh v0.14.0 "" false      # skip drafting release notes
#
# One-time setup: see docs/RELEASE_AUTOMATION.md.

set -euo pipefail

VERSION="${1:?Usage: $0 <vX.Y.Z> [pr_number] [draft_release_notes:true|false]}"
PR_NUMBER="${2:-}"
DRAFT_NOTES="${3:-true}"

if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must match vX.Y.Z (got: $VERSION)" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install: https://cli.github.com/" >&2
  exit 1
fi

echo "→ Dispatching release workflow for $VERSION"
ARGS=( -f "version=$VERSION" -f "draft_release_notes=$DRAFT_NOTES" )
if [ -n "$PR_NUMBER" ]; then
  ARGS+=( -f "pr_number=$PR_NUMBER" )
fi
gh workflow run release.yml "${ARGS[@]}"

# `gh workflow run` returns before the run is created, so poll briefly
# for the new run ID. Cap at ~10s — if it's not visible by then, the
# dispatch silently failed (usually a missing RELEASE_PAT secret).
echo "→ Waiting for run ID…"
RUN_ID=""
for _ in 1 2 3 4 5; do
  sleep 2
  RUN_ID=$(gh run list --workflow=release.yml --limit 1 --json databaseId,status -q '.[0].databaseId // empty')
  [ -n "$RUN_ID" ] && break
done

if [ -z "$RUN_ID" ]; then
  echo "Could not resolve run ID. Check Actions tab manually." >&2
  exit 1
fi

URL=$(gh run view "$RUN_ID" --json url -q .url)
echo "→ Run: $URL"
echo "→ Watching (Ctrl-C to detach; the workflow keeps running):"
gh run watch "$RUN_ID" --exit-status
