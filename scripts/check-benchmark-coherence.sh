#!/usr/bin/env bash
#
# Benchmark/doc coherence gate.
#
# GUIDELINES §3 invariant 12: the retrieval tuning constants — `kra.ts`'s
# `WEIGHTS` and `CANDIDATE_POOL_SIZE` — require a benchmark run before change,
# with before/after recorded in `docs/VALIDATION.md` in the same PR. Until now
# that coupling was operator discipline only: `docs/ROADMAP.md` listed a "CI
# benchmark-doc coherence gate" among shipped deliverables, and no such gate
# existed (found 2026-07-28). This is it.
#
# Deliberately narrow. It compares the constants' VALUES either side of the
# merge base, not whether `kra.ts` was touched — a file-level check would fire
# on any unrelated edit to that file (the #174 scope-filter work changed
# `kra.ts` without touching a single weight) and a gate that cries wolf gets
# switched off. Comment rewrites, refactors and import changes are invisible to
# it; a retune is not.
#
# Verified against real history: silent across v2.4.0..v2.5.0, fires across
# v2.2.0..v2.3.0 (the #146 pool 20 -> 50 widening, which did record its numbers).
#
# Usage:  scripts/check-benchmark-coherence.sh [base-ref]     (default origin/main)
set -euo pipefail

BASE="${1:-origin/main}"
KRA="packages/core/src/kra.ts"
VALIDATION="docs/VALIDATION.md"

if ! git rev-parse -q --verify "$BASE" >/dev/null 2>&1; then
  echo "check-benchmark-coherence: base ref '$BASE' not found — skipping." >&2
  exit 0
fi

# The tuning surface, reduced to just its numbers: the `WEIGHTS` body plus the
# CANDIDATE_POOL_SIZE literal. Everything else in the file is ignored.
tuning_values() {
  local ref="$1"
  git show "$ref:$KRA" 2>/dev/null \
    | sed -n '/^const WEIGHTS = {/,/^} as const;/p; /^export const CANDIDATE_POOL_SIZE/p' \
    | grep -oE '[0-9]+\.[0-9]+|[0-9]+' \
    | tr '\n' ' '
}

before="$(tuning_values "$BASE")"
after="$(tuning_values HEAD)"

if [ "$before" = "$after" ]; then
  echo "check-benchmark-coherence: retrieval tuning constants unchanged — ok."
  exit 0
fi

if git diff --name-only "$BASE"...HEAD | grep -qx "$VALIDATION"; then
  echo "check-benchmark-coherence: tuning changed and $VALIDATION updated — ok."
  echo "  before: $before"
  echo "  after:  $after"
  exit 0
fi

cat >&2 <<EOF
::error file=$KRA::retrieval tuning changed without updating $VALIDATION

  before: $before
  after:  $after

GUIDELINES §3 invariant 12 — a change to kra.ts's WEIGHTS or
CANDIDATE_POOL_SIZE needs a benchmark run recorded in the same PR:

  1. Export a fixture (BENCHMARK_USER_ID-scoped on any multi-user host, so no
     other account's prompts leave the DB):
       packages/core/scripts/export-retrieval-fixture.ts
  2. Run it:
       pnpm --filter @brain/core run benchmark:retrieval fixture.json
  3. Record before/after in $VALIDATION.

The bar is the DELTA vs the cosine baseline on the current fixture, not an
absolute score — absolutes are fixture-dependent.
EOF
exit 1
