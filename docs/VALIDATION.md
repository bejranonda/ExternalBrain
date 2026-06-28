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

## Proposed methodology (2026-06-28) — concrete and bias-resistant

Turning the three requirements above into a runnable design. Two benchmarks,
each engineered against the author-bias that sank the previous pair.

**1. Retrieval benchmark (`retrieval-benchmark.ts`, reinstated, fixture-driven).**
- *Fixture, not author-written.* Draw query prompts from real (anonymized)
  production session logs. Assign relevance labels from a held-out signal rather
  than opinion: the knowledge rows that were actually injected
  (`SessionKnowledgeApplication`) and then went on to a successful outcome
  (`successCount` bump). The platform's own usage telemetry is the blind labeler,
  so no one hand-labels the corpus they tuned.
- *Metric.* NDCG@5, KRA (`kra.ts` `WEIGHTS`) vs a raw-cosine baseline. An earlier
  ad-hoc run put KRA at 0.928 vs cosine 1.000; re-establish on the real fixture,
  and if KRA still trails cosine on clean queries that is the signal to retune
  `WEIGHTS` (see KNOWN_ISSUES, KRA-formula entry).

**2. Generation-uplift benchmark (`generation-uplift.ts`) — the claim that matters.**
The honest version does not use LLM-as-judge.
- *Tasks with ground truth.* A held-out set of coding tasks that ship with
  executable tests (a small internal suite, or a public set such as
  SWE-bench-lite), authored independently of the corpus.
- *Procedure.* Run the same agent on each task twice: once with Brain knowledge
  injected at session start, once without, holding model, prompt, and seed
  constant.
- *Metric (objective, no judge).* Test pass-rate with vs without the Brain.
  Report n, the paired difference, and a confidence interval. Optional secondary:
  blind human pairwise preference (the rater does not know which arm used the
  Brain) for tasks that lack tests.
- *Pre-register* the metric and task list before running; commit the raw outputs.

**Honesty guardrails.** Fixture and corpus authored independently; metric
pre-registered; results reported with n + effect size + CI, never a single
cherry-picked number; raw artifacts committed. Until this runs against a real
corpus, the "improves AI coding" claim stays explicitly unproven (the README and
HOW_IT_WORKS already say so).

**Where to start.** The retrieval benchmark is the cheap first number (a
telemetry-labeled fixture plus the existing KRA path). Generation uplift needs
the task suite and an agent harness; it is the larger build, but it is the claim
that actually backs the positioning.

### Fixture-export recipe (operator-runnable)

The retrieval fixture can be built from existing telemetry with no hand-labeling.
The session prompt lives in `Session.metadata->>'prompt'` (a JSON field, not a
column); the relevance label is the knowledge that was *injected* into sessions
that then *succeeded*:

```ts
// Operator runs against the live DB. Prompts are real user text — anonymize, or
// restrict to a non-client org, before publishing the fixture.
// NOTE: packages/core/scripts is outside the tsconfig `include`, so this is NOT
// typechecked by CI and has not been run — review before trusting it.
const apps = await db.sessionKnowledgeApplication.findMany({
  where: { role: "injected", session: { outcome: "success" } },
  select: { sessionId: true, knowledgeId: true,
            session: { select: { metadata: true } } },
});
const bySession = new Map<string, { query: string; relevant: string[] }>();
for (const a of apps) {
  const query = (a.session.metadata as { prompt?: string } | null)?.prompt?.trim();
  if (!query) continue;                         // no stored prompt -> unusable
  const row = bySession.get(a.sessionId) ?? { query, relevant: [] };
  row.relevant.push(a.knowledgeId);
  bySession.set(a.sessionId, row);
}
const fixture = [...bySession.values()];        // [{ query, relevant: [knowledgeId] }]
// anonymize each query, then write JSON.
```

Output shape: `[{ "query": "...", "relevant": ["<knowledgeId>", ...] }]`.

**Honesty caveats (these are why it's a first number, not the last word):**
- It is a *proxy* label, not ground truth. "Injected into a session that
  succeeded" approximates relevance, but a session can succeed despite an
  irrelevant injection. It is a **weak** label, better than author opinion (the
  bias that retired the old benchmarks), not perfect.
- It can only reward retrieving what the system already chose to inject, so it
  can't measure a *miss* (relevant knowledge the system never surfaced). A
  stronger fixture later adds blind human labels on a sample.
- Prompts contain real user text: anonymize or scope to a non-client org first.

## Invariants that survive the rewrite

- Retrieval changes (`packages/core/src/kra.ts`, embedding provider, KRA
  weights) must still be defensible. Until a benchmark exists, that
  defence is qualitative — code review, on-call observability, and any
  change to `WEIGHTS` should be deliberate and reviewed.
- Knowledge rows track real usage (`successCount`, `failureCount`,
  `usageCount`, `lastUsedAt`); `effectivenessScore = successCount /
  (successCount + failureCount)` returns -1 below 3 outcomes. This is
  the only live signal the platform has about what's working.
