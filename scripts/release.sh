#!/usr/bin/env bash
# release.sh — tag main and draft a GitHub release.
#
# Single-branch model: no develop→main promotion, no RELEASE_PAT. The repo
# ships from `main`; a release is just an annotated tag on main plus a GitHub
# Release with auto-generated notes. The web UI's version label reads
# `git describe --tags` at build time, so a tag created here shows up in the
# rail footer on the next deploy.
#
# Usage:
#   ./scripts/release.sh v1.3.0            # draft release (review, then publish)
#   ./scripts/release.sh v1.3.0 --publish  # publish immediately
set -euo pipefail

VERSION="${1:?Usage: $0 <vX.Y.Z> [--publish]}"
PUBLISH="${2:-}"

if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must match vX.Y.Z (got: $VERSION)" >&2
  exit 1
fi
command -v gh >/dev/null 2>&1 || { echo "gh CLI not found. Install: https://cli.github.com/" >&2; exit 1; }

git fetch origin main
if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
  echo "Not on main (on: $(git rev-parse --abbrev-ref HEAD)). Switch to main first." >&2
  exit 1
fi
if ! git diff --quiet HEAD; then
  echo "Worktree is dirty — commit or stash before releasing." >&2
  exit 1
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Local main is not in sync with origin/main — pull/push first." >&2
  exit 1
fi
if git rev-parse "$VERSION" >/dev/null 2>&1; then
  echo "Tag $VERSION already exists. Bump the version or delete the tag first." >&2
  exit 1
fi

echo "→ Tagging $VERSION at $(git rev-parse --short HEAD)"
git tag -a "$VERSION" -m "Release $VERSION"
git push origin "$VERSION"

if [ "$PUBLISH" = "--publish" ]; then
  gh release create "$VERSION" --target main --title "$VERSION" --generate-notes
  echo "→ Published release $VERSION"
else
  gh release create "$VERSION" --target main --title "$VERSION" --generate-notes --draft
  echo "→ Draft release $VERSION created. Review the notes, then publish from the URL above."
fi
