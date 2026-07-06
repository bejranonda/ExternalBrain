# Validation — does the Brain improve AI coding?

*Updated 2026-07-06.*

## Status

- ✅ **Harness shipped** — `packages/core/src/retrieval-benchmark.ts` ranks a
  candidate pool by the production KRA score (`kra.ts` `scoreItem`, reused
  directly, not re-implemented) vs a raw-cosine baseline and reports mean
  NDCG@5. Covered by `src/__tests__/retrieval-benchmark.test.ts`.
- ✅ **Fixture export shipped** — `scripts/export-retrieval-fixture.ts` turns
  live telemetry into a fixture with no hand-labeling
  (`BENCHMARK_USER_ID`-scoped on multi-user hosts so no other account's
  prompts leave the DB).
- ✅ **First retrieval number published (2026-07-06, below)** — KRA beats the
  raw-cosine baseline by +0.148 NDCG@5 on a real, telemetry-labeled corpus.
- ⬜ **Generation-uplift benchmark** — the claim that actually matters
  ("the Brain improves AI coding *output*") — is still a design (below), not
  code. **That product claim remains unproven**; the retrieval number below
  validates the ranking layer, not end-to-end uplift.

## First published run — retrieval NDCG@5 (2026-07-06)

Run against the live corpus at v1.13.1, after the duplicate-project merge
(KNOWN_ISSUES §0j) unified the fragmented project identities.

| | NDCG@5 |
|---|---|
| Cosine baseline | 0.3036 |
| **KRA (production ranking)** | **0.4514** |
| Delta (KRA − cosine) | **+0.1478** |

- **Fixture:** 30 cases from 30 real sessions (operator-scoped via
  `BENCHMARK_USER_ID`; no client data touched), candidate pools of 20 from the
  production `candidatesForPrompt` path; 24 cases scored, 6 skipped (no
  relevant id in pool). Fixture NOT committed — it contains real session
  prompts; only this summary is published.
- **Label:** the weak proxy described under the methodology — knowledge
  injected into a session that subsequently succeeded. Nobody hand-labeled
  anything.
- **Reading it honestly:** n is small and the labels are a weak proxy, so the
  *absolute* numbers are not the claim — the *delta* is. The production KRA
  weighting materially outranks raw cosine on real usage (+49% relative),
  which is the direction the weights exist to buy (closes the re-validation
  question in the `kra.ts` `WEIGHTS` history: on real data KRA no longer
  trails cosine — the seed-era 0.928-vs-1.000 reading did not survive contact
  with a real corpus). Re-run after material corpus growth; treat a delta
  collapse as the retune signal.

### The earlier attempt, and why the label changed

A previous pair of scripts ran against the dev seed corpus
(`packages/db/scripts/seed.ts` — the "Alex Chen" persona) and were removed on
2026-05-08 in the "remove all fake data" sweep. They were author-written
against the seed they were meant to validate (acknowledged bias), so
reinstating them verbatim would not have been honest evidence. The harness
shipped now fixes the *mechanism* — it re-ranks a real, telemetry-labeled pool
— but the honesty of any number it produces still depends on the fixture being
exported from a real corpus, not a seed.

## What needs to exist before this doc is rewritten

1. ~~**A non-author-written retrieval fixture.**~~ **Exists (2026-07-06):**
   queries drawn from real production session logs, relevance labeled blind
   by the platform's own usage telemetry (see the published run above).
2. ~~**A real Knowledge corpus** populated by actual user sessions.~~
   **Exists:** the published run used the live corpus (post-merge, v1.13.1),
   authored independently of the fixture queries.
3. **Blind human scoring** for the generation-uplift claim (Oracle with
   Brain vs. Oracle without). LLM-as-judge introduces author-bias and
   was retired alongside the benchmark scripts. **Still open.**

The retrieval layer now has a published number. The **product claim**
("the Brain improves AI coding") still hinges on requirement 3 — the
generation-uplift benchmark — and remains unproven until that runs.

## Proposed methodology (2026-06-28) — concrete and bias-resistant

Turning the three requirements above into a runnable design. Two benchmarks,
each engineered against the author-bias that sank the previous pair.

**1. Retrieval benchmark — shipped (`packages/core/src/retrieval-benchmark.ts`).**
- *Fixture, not author-written.* Query prompts are drawn from real (anonymized)
  production session logs. Relevance labels come from a held-out signal rather
  than opinion: the knowledge rows that were actually injected
  (`SessionKnowledgeApplication`, `role: "injected"`) into a session that then
  succeeded (`session.outcome = "success"`). The platform's own usage telemetry
  is the blind labeler, so no one hand-labels the corpus they tuned. This is a
  *weak proxy* label — see caveats under the export recipe.
- *Metric.* Mean NDCG@5, the production KRA ranking (`kra.ts` `scoreItem`, reused
  by the harness so the two never drift) vs a raw-cosine baseline. An earlier
  ad-hoc run on the retired hand-labelled seed put KRA at 0.928 vs cosine 1.000
  (also recorded in the `kra.ts` `WEIGHTS` history); that number predates this
  harness and does not count as evidence. **Re-established on a real fixture
  (2026-07-06, published above): KRA 0.4514 vs cosine 0.3036 — KRA leads.**
  If a future re-run shows KRA trailing cosine again, that is the signal to
  retune `WEIGHTS` (see KNOWN_ISSUES, KRA-formula entry).

*Running it (two steps — export needs the live DB, the run is offline):*

```bash
# 1. Operator, against the live DB. Prompts are real user text: anonymize the
#    output, or scope the query to a non-client org, before publishing.
# On a multi-user live host, ALWAYS scope to your own user id so no other
# account's prompts (client data) leave the DB:
BENCHMARK_USER_ID=<your user id> \
  pnpm --filter @brain/core exec tsx scripts/export-retrieval-fixture.ts > fixture.json

# 2. Offline, no DB. Re-ranks each case by cosine and by KRA, prints NDCG@5.
pnpm --filter @brain/core run benchmark:retrieval fixture.json
```

The harness math is unit-tested and typechecked in CI; the two `scripts/` files
are entrypoints outside the tsconfig `include`, so they are *not* typechecked —
review before trusting, as the header comment on each says.

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

This is now shipped as `scripts/export-retrieval-fixture.ts` (run it as shown
above); the snippet below is the illustrative core of what it does. The shipped
script additionally captures each query's real candidate pool
(`kra.ts` `candidatesForPrompt`) so the offline harness re-ranks the exact set
production would have ranked.

The fixture is built from existing telemetry with no hand-labeling. The session
prompt lives in `Session.metadata->>'prompt'` (a JSON field, not a column); the
relevance label is the knowledge that was *injected* into sessions that then
*succeeded*:

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
