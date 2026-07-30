# Validation — does the Brain improve AI coding?

*Updated 2026-07-23.*

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
- ✅ **Generation-uplift benchmark — first read published (2026-07-23,
  below)**: +33.3pp test pass-rate (control 4/6, treatment 6/6, n=6, 0
  regressions). Positive, but n=6 is small and the task suite under-tests
  "well-known" utilities — see `packages/core/generation-uplift/RESULTS.md`
  for the full honest read, including where injection made no difference.
- ✅ **Suite 2 — corpus-dependent tasks, live-KRA injection (2026-07-28,
  below)**: +40pp (control 3/5, treatment 5/5, n=5, 0 regressions). More
  importantly it identifies *where* injection pays: the two flips were
  **locally arbitrary** conventions (a workspace subpath; a build-pipeline
  quirk), and all three ties were conventions that coincide with general good
  practice the base model already had. See
  `packages/core/generation-uplift/suite-2/RESULTS.md`.

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
- **Pool-depth follow-up (same day):** re-exporting at `BENCHMARK_POOL_SIZE=50`
  cut the skips from 6/30 to 2/32 — most "relevant id not in pool" cases are
  knowledge sitting at cosine ranks 21–50, below production's (then) top-20
  prefilter, not genuine recall misses (~6% at depth 50). KRA's lead holds at
  the deeper pool (0.3075 vs 0.2317; both absolutes drop as harder negatives
  enter, delta stays positive).
- **Pool widened to 50 in production (2026-07-23, [#146](https://github.com/bejranonda/ExternalBrain/issues/146)),
  after the Stage-3 gate passed** — `kra.ts`'s `CANDIDATE_POOL_SIZE` moved
  20 → 50 (output cap stays ≤10); `export-retrieval-fixture.ts`'s default
  `POOL_SIZE` now mirrors it. Re-measure the loop-health injected→used rate
  before/after per the issue's own methodology once enough post-widening
  sessions accrue.
- **Reading it honestly:** n is small and the labels are a weak proxy, so the
  *absolute* numbers are not the claim — the *delta* is. The production KRA
  weighting materially outranks raw cosine on real usage (+49% relative),
  which is the direction the weights exist to buy (closes the re-validation
  question in the `kra.ts` `WEIGHTS` history: on real data KRA no longer
  trails cosine — the seed-era 0.928-vs-1.000 reading did not survive contact
  with a real corpus). Re-run after material corpus growth; treat a delta
  collapse as the retune signal.

## First published run — generation uplift (2026-07-23)

Executed issue #126 after the Stage-3 gate passed (#149). Full design,
per-task results, and honesty caveats live in
`packages/core/generation-uplift/README.md` (pre-registration, committed
before any run) and `RESULTS.md` (the read). Summary:

| | Pass rate (n=6) |
|---|---|
| Control (no injected knowledge) | 4/6 (66.7%) |
| Treatment (Brain-injected knowledge) | 6/6 (100%) |
| Paired difference | **+33.3pp, 0 regressions** |

- **Positive, small-n, first read.** Two of six tasks flipped from fail to
  pass when a short "relevant knowledge" block was injected (a debounce
  utility gaining a `.cancel()` method; a byte-formatter throwing `RangeError`
  on negative input instead of returning a garbage string); the other four
  tied at 100% because the base model already handled those specific edge
  cases correctly from training, independent of injection.
- **Reading it honestly:** this validates the generation-uplift *mechanism*
  (does knowing a non-obvious convention up front change output) on generic,
  corpus-independent tasks — not an end-to-end replay of production's KRA
  retrieval, and not a statistically powered result at n=6. See
  `RESULTS.md`'s "Reading it honestly" section for the full caveats,
  including a grading-mechanics substitution (no local vitest available;
  `harness/grade.ts` re-implements the same assertions with `node:assert`).

## Second published run — suite 2, corpus-dependent + live KRA (2026-07-28)

Suite 1 measured the injection *mechanism*: generic utility tasks with a
hand-written injected block. Suite 2 changes both variables — tasks whose correct
answer is only derivable from BrainPlatform convention, and a treatment block
taken **verbatim from the live KRA path** rather than authored. That makes it a
test of retrieval and generation together. Pre-registration committed before any
run (`packages/core/generation-uplift/suite-2/README.md`).

| | Convention applied (n=5) |
|---|---|
| Control | 3/5 (60%) |
| **Treatment (live-KRA)** | **5/5 (100%)** |
| Paired difference | **+40pp, 0 regressions** |

- **The aggregate is not the interesting part.** The two flips were conventions
  that are *locally arbitrary* and cannot be derived from expertise: the
  `@brain/core/format-relative` subpath (control hand-rolled its own formatter —
  exactly the divergence v0.15.0 consolidated away), and `force-dynamic` on an
  env-reading server component (control emitted **no** static-rendering opt-out of
  any kind — the v0.14.0 bug verbatim). All three ties were conventions that
  coincide with general good practice: the control arm reached for
  `x-forwarded-host` unprompted, mount-gated its `window` read, and used `{count}`
  placeholders without being told.
- **So injection pays off where the convention is arbitrary, and ties where it is
  good craft.** That predicts where capture effort has the highest return — local
  arbitrariness (package paths, build-pipeline quirks, project decisions), not
  general engineering practice. Suite 1's ties had the same cause, so two
  independent suites now agree on the mechanism.
- **Second reading (2026-07-30, uncurated).** Re-run after #174 shipped, with
  **no curation** — the first honest measurement of the product as a user meets
  it. Treatment held at **5/5 lenient / 4/5 strict** against the carried-forward
  3/5 control. The formerly-invisible docs recipe now occupies a slot in *every*
  injected block, yet each task's own rule still ranked **#1**: the corpus
  widening bought recall **without measurable precision loss**, which was the
  open question. Task 5 is a genuine grading-judgment case (an ICU `one`-category
  key containing a literal `1`) — reported both ways rather than resolved after
  the fact; it is the static-grading weakness the pre-registration predicted.
- **Reading it honestly:** n=5; grading is static assertion over emitted source
  (weaker than suite 1's executable tests, pre-registered as such); isolation was
  instruction-enforced and every control pass was checked for contamination (none
  found — no repo identifiers in any control output). **Most important caveat:**
  the five rules were verified retrievable from a project-scoped session *before*
  the run, to control for the scope-filter defect in `KNOWN_ISSUES §0p` / #174.
  Roughly half the corpus is invisible to a project-scoped session until that is
  resolved, so **a run against the uncurated corpus would score lower.** This
  number describes the Brain with its known retrieval defect controlled for, not
  the Brain as a user experiences it today.

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
3. ~~**An objective (no-LLM-judge) generation-uplift read.**~~ **First read
   published (2026-07-23):** a pre-registered, six-task suite with executable
   tests (`packages/core/generation-uplift/`), test pass-rate control vs.
   Brain-injected, graded mechanically — see below. **Blind human pairwise
   scoring** (the doc's original optional-secondary path, for tasks that lack
   executable tests) remains undone; not needed while the test-based read is
   available, but would strengthen a future re-run on tasks that can't ship
   ground-truth tests.

The retrieval layer and the generation-uplift mechanism both now have a
published number. The **product claim** ("the Brain improves AI coding") has
one small-n indicative data point in its favor (below) — promising, not
proven; a larger and/or production-fixture-based re-run is the natural next
step, not a new requirement.

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

**2. Generation-uplift benchmark — the claim that matters.**
**First read published 2026-07-23** — implemented as a pre-registered task
suite + harness under `packages/core/generation-uplift/` (not a single
`generation-uplift.ts` script as originally sketched; see that directory's
`README.md` and `RESULTS.md` for the actual design and result). The honest
version does not use LLM-as-judge.
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
telemetry-labeled fixture plus the existing KRA path); the generation-uplift
task suite + harness (`packages/core/generation-uplift/`) is the larger build,
and it is the claim that actually backs the positioning — both now have a
first published number (above and below).

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
