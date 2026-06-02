# Validation — does the Brain improve AI coding?

*Updated 2026-05-08. **This doc is a placeholder.***

## Status

The previous validation methodology was structured around two benchmark
scripts (`packages/core/scripts/retrieval-benchmark.ts`,
`packages/core/scripts/generation-uplift.ts`) that ran against the dev
seed corpus (`packages/db/scripts/seed.ts` — the "Alex Chen" persona).

That seed and both benchmark scripts were removed on 2026-05-08 as part
of the "remove all fake data" sweep. The benchmarks were author-written
against the seed they were meant to validate (acknowledged bias —
documented in the previous version of this doc), so reinstating them
verbatim would not be honest evidence anyway.

## What needs to exist before this doc is rewritten

1. **A non-author-written retrieval fixture.** Either queries drawn from
   real production session logs with relevance labels assigned blind, or
   queries authored by someone who has not seen the corpus.
2. **A real Knowledge corpus** populated by actual user sessions, not a
   demo seed. The fixture and corpus must be authored independently.
3. **Blind human scoring** for the generation-uplift claim (Oracle with
   Brain vs. Oracle without). LLM-as-judge introduces author-bias and
   was retired alongside the benchmark scripts.

Until those exist, the product claim ("the Brain improves AI coding")
remains unproven by any published number in this repo.

## Invariants that survive the rewrite

- Retrieval changes (`packages/core/src/kra.ts`, embedding provider, KRA
  weights) must still be defensible. Until a benchmark exists, that
  defence is qualitative — code review, on-call observability, and any
  change to `WEIGHTS` should be deliberate and reviewed.
- Knowledge rows track real usage (`successCount`, `failureCount`,
  `usageCount`, `lastUsedAt`); `effectivenessScore = successCount /
  (successCount + failureCount)` returns -1 below 3 outcomes. This is
  the only live signal the platform has about what's working.
