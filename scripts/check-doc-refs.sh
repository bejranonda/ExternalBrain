#!/usr/bin/env bash
#
# Guard against phantom PR/issue references in public docs.
#
# Fails if any file under docs/ (excluding docs/internal/**) cites a
# "PR #NNN" or a "(#NNN)" whose number exceeds the current public PR
# ceiling — i.e. a reference from the pre-open-source private history that a
# reader of the public repo cannot resolve. This is the regression net for
# the scrub in PR #125 (see docs issue: "Add a CI ref-lint …").
#
# Allow-listed by construction:
#   - CSS hex colors (#666, #f0f0f0) — not anchored by "PR " or "(#".
#   - External refs ("copilot-cli #3100") — the "…cli #NNN" token is stripped.
#   - Any number <= the ceiling — real, resolvable references.
#
# Ceiling: the highest PR number. In CI, `gh` is authenticated via
# GITHUB_TOKEN; locally, pass DOC_REF_CEILING=<n> (no gh needed).
set -euo pipefail

ceiling="${DOC_REF_CEILING:-}"
if [ -z "$ceiling" ] && command -v gh >/dev/null 2>&1; then
  ceiling="$(gh pr list --state all --limit 1 --json number -q '.[0].number' 2>/dev/null || echo 0)"
fi
: "${ceiling:=0}"

if [ "$ceiling" -eq 0 ]; then
  echo "check-doc-refs: cannot determine PR ceiling (no gh, no DOC_REF_CEILING) — skipping." >&2
  exit 0
fi

fail=0
while IFS= read -r hit; do
  file="${hit%%:*}"; rest="${hit#*:}"
  lineno="${rest%%:*}"; text="${rest#*:}"
  # Strip external "…cli #NNN" tokens so a line can mix external + local refs.
  clean="$(printf '%s' "$text" | sed -E 's/[A-Za-z]*-?cli #[0-9]+//g')"
  # Pull numbers only from the two citation forms: "PR #NNN" and "(#NNN".
  nums="$(printf '%s\n' "$clean" \
    | grep -oE '(PRs? #|\(#)[0-9]+([ ]*[/,][ ]*#[0-9]+)*' \
    | grep -oE '[0-9]+' || true)"
  for n in $nums; do
    if [ "$n" -gt "$ceiling" ]; then
      echo "::error file=$file,line=$lineno::phantom reference #$n exceeds public PR ceiling #$ceiling — private-history ref not resolvable in this repo"
      fail=1
    fi
  done
done < <(grep -rnE '(PRs? #[0-9]+|\(#[0-9]+)' docs --include='*.md' 2>/dev/null \
          | grep -v 'docs/internal/')

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "Phantom references found. Replace with 'an early PR' / 'early PRs' + a date," >&2
  echo "or a real (<=#$ceiling) reference. See PR #125 for the convention." >&2
  exit 1
fi

echo "check-doc-refs: no phantom references in public docs (ceiling #$ceiling)."
