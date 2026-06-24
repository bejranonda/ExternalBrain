# Autoskill LLM classifier — design spec

**Date:** 2026-06-24
**Status:** Draft for review
**Scope:** `packages/core` (autoskill + a new shared LLM seam) + env config. **No DB migration.**
**Author/agent session:** strategic-review → autoskill classifier

---

## 1. Problem

`packages/core/src/autoskill.ts` turns post-session signals (corrections, repeats,
approvals) into improvement proposals through a six-stage funnel:

```
detectSignals → scoreSignals → resolveConflicts → passesQualityFilter → routeSignal → proposeChange
```

Every stage except **`routeSignal`** is deterministic and exact (scoring, dedup,
the 4-question quality filter). `routeSignal` is the one stage that makes a
*semantic* judgment — "is this signal a project convention destined for the rules
export, a durable atomic *knowledge* rule, or noise to ignore?" — and today it
makes that judgment with **keyword regexes** (`isProjectConvention` /
`isSessionBehavior`, `autoskill.ts:475`) plus a hard `score >= 5` threshold before
anything can become atomic knowledge.

Consequences of the regex classifier:
- It cannot judge *durability*, so it must be conservative — only `score >= 5`
  signals reach the `knowledge` target, and genuinely durable score-3/4 rules are
  under-captured.
- It does not learn the **user's** taste — the same regex fires for every user,
  ignoring which proposals this user has historically accepted or rejected.

This is the highest-leverage quality lever in the capture pipeline: the product's
whole pitch is *typed* skills + grounded knowledge, and the typing is currently
keyword-matched.

## 2. Goals / non-goals

**Goals**
- Replace the *type decision* in `routeSignal` (rules / knowledge / ignore) with an
  LLM classifier that can judge durability and is grounded in the user's own data.
- **Extract more, safely:** bias toward capture (rare `ignore`), and let
  well-justified sub-`score-5` signals reach `knowledge` — without lowering
  precision.
- **Feed the classifier as much *relevant* user-derived knowledge as a budget
  allows**, so it learns the user's taxonomy and accept/reject taste.
- Ship behaviour-neutral by default; stay inside the autonomous-CD no-migration
  carve-out.

**Non-goals**
- Not touching scoring, conflict resolution, the quality filter, the embedding-based
  skill short-circuit, or the `proposeChange` writer. (Surgical scope.)
- Not auto-applying proposals — they remain `pending` for human review.
- No schema change. No new Prisma model.

## 3. Locked decisions (from brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Classifier scope | **Surgical** — LLM decides only `rules \| knowledge \| ignore`, and only for signals that already passed `score >= 3` and did **not** match an existing skill. |
| D2 | Few-shot source | **Hybrid, user-weighted** — static gold examples (floor) + as much *relevant* user-derived data as a token budget allows. |
| D3 | Rollout | **Feature flag, default off** (`AUTOSKILL_LLM_CLASSIFIER`). Heuristic stays the live path; classifier runs in **shadow** and logs agreement while off. |
| D4 | Code structure | **Extract** a shared `packages/core/src/llm.ts` seam (provider routing out of `kea.ts`, re-exported), reused by the classifier. |
| D5 | Disposition | **Bias to capture** — `ignore` is the rare verdict; widen the `knowledge` path beyond `score >= 5`; quality filter stays the recall floor. |
| D6 | Fail-soft | Any classifier error / timeout / invalid output → fall back to the **existing heuristic** for that signal. A signal is **never dropped**. |

## 4. Architecture

### 4.1 New shared LLM seam — `packages/core/src/llm.ts` (D4)

Move the provider-routing helpers currently private to `kea.ts`
(`useAnthropicSdk`, `callAnthropic`, `callOpenAI`, `callDashScope` and their model
resolution) into a new `llm.ts`. Re-export from / re-import into `kea.ts` so its
behaviour is unchanged. The classifier imports the same seam — **one** copy of the
GLM / `ANTHROPIC_BASE_URL` / DashScope routing, not two.

- Blast radius: `kea.ts` import lines change (mechanical). Covered by existing
  `kea` unit tests, which already mock the call helpers.
- The seam exposes a single `callLLM(prompt, { model, systemPrompt, signal })`
  that internally dispatches by model/base-URL, matching the existing logic.

### 4.2 New classifier — `packages/core/src/autoskill-classifier.ts`

```
classifySignals(
  signals: ScoredSignal[],          // survivors: score>=3, no skill match
  ctx: { userId: string; embeddings: EmbeddingCache },
): Promise<Map<number, Verdict>>   // keyed by the signal's index in the input batch
```

- **One batched LLM call per session** (cross-signal context, cheaper than
  per-signal). Cap at `AUTOSKILL_CLASSIFY_MAX` (default 12); overflow signals route
  via the heuristic, logged.
- **Zero survivors → no call** (no added cost on quiet sessions).
- **Output contract (zod-validated):**
  `Verdict = { target: "rules" | "knowledge" | "ignore"; confidence: "high" | "medium"; reasoning: string }`,
  keyed by **batch index** (`ScoredSignal` has no stable id; the LLM is asked to
  echo back each signal's index). Any missing/malformed entry → heuristic fallback
  for that signal only (D6).
- **Model:** `AUTOSKILL_MODEL ?? KEA_MODEL ?? <default>`, via the §4.1 seam.

### 4.3 Few-shot assembly — `assembleFewShot(signals, userId)` (D2, "feed from user")

Returns a prompt block built from, in priority order:

1. **Static gold (always):** 6–8 hand-curated examples — one per target class plus
   the hard edge cases (durable-but-low-score → `knowledge`; generic encouragement →
   `ignore`; project convention → `rules`). This is the cold-start floor and the
   regression anchor in tests.
2. **User-derived, ranked, budgeted ("as much as we can, bounded"):**
   - **Resolved proposals** — recent `AutoskillProposal` rows for the user with
     `status IN ('applied','rejected')`, rendered as positive/negative exemplars
     ("user accepted this as a *{target}*" / "user rejected this"). Purest signal of
     the user's taste.
   - **Nearest existing Knowledge** — top-K of the user's own `Knowledge` rows by
     cosine similarity to the batch (reusing the `EmbeddingCache` already built in
     `runForSession`). Shows the user's established taxonomy so new classifications
     align with what they've endorsed.
   - Ranked by recency (proposals) + cosine relevance (knowledge); filled up to
     `AUTOSKILL_FEWSHOT_TOKEN_BUDGET` (default ~1500 tok).
   - **v1 implementation note:** the first ship ranks user examples by **recency
     only** (cheap `findMany`, no vector query — validatable without a live
     pgvector index). Cosine relevance over the user's nearest Knowledge is a
     fast-follow once the recency baseline is observed in shadow.

**Fail-soft (hard requirement):** any query error, or a new user with zero history,
yields the static gold block alone. Few-shot assembly **never blocks or fails** a
classification.

### 4.4 Integration in `runForSession` / `routeSignal`

- **Unchanged:** the `score < 3` drop and the `findRelatedSkill` skill
  short-circuit (embedding-based, already good); the per-target `patch`/`diff`/
  `reasoning` builders.
- **Batch once:** after conflict resolution + quality filter, before the
  `routeSignal` loop, call `classifySignals(survivors, ctx)` once and pass the
  resulting `Map` into `routeSignal`.
- **`routeSignal` target decision becomes flag-gated:**
  - **Flag off (default):** heuristic decides `target` exactly as today.
    **Shadow is opt-in** (`AUTOSKILL_SHADOW`, default off) — *improvement over the
    original design, which defaulted shadow on.* With both off, the default deploy
    makes **zero extra LLM calls** (cost-neutral, not just behaviour-neutral).
    With `AUTOSKILL_SHADOW=true`, the classifier verdict is computed and logged as
    `autoskill.classify.shadow { index, kind, heuristic, llm, agree }` — free
    agreement-rate data, still **no behaviour change**.
  - **Flag on:** the verdict drives `target`. `ignore` → no proposal. `rules` /
    `knowledge` → existing builders. **Widened knowledge path (D5):** the LLM may
    return `knowledge` for a sub-`score-5` signal; the `score >= 5` shortcut remains
    only as a heuristic-path / fallback rule.
  - **Any error path (D6):** the signal's heuristic result is used. Never dropped.

### 4.5 The recall floor (the bound on D5)

`passesQualityFilter` (specific / actionable / durable / non-generic) stays
**before** the classifier. "Extract / feed as much as we can" means *everything that
clears that bar* — not everything. The filter is cheap and conservative; it is what
keeps "bias to capture" from flooding the queue. Safety net: proposals are `pending`
(auto-apply default off), so erring toward capture only surfaces more *candidates*,
and each accept/reject feeds §4.3's pool — the bias self-corrects.

## 5. Config (env, no migration)

| Env | Default | Purpose |
|-----|---------|---------|
| `AUTOSKILL_LLM_CLASSIFIER` | `false` | Master flag. On = classifier drives `target` (implies shadow). |
| `AUTOSKILL_SHADOW` | `false` | Opt-in: classify + log agreement without acting. Both flags off = zero LLM calls. |
| `AUTOSKILL_MODEL` | `KEA_MODEL` fallback | Model for the classifier call. |
| `AUTOSKILL_CLASSIFY_MAX` | `12` | Max signals per batched call; overflow → heuristic. |
| `AUTOSKILL_FEWSHOT_TOKEN_BUDGET` | `1500` | Token ceiling for user-derived few-shot. |

## 6. Testing (keyless CI — mock the LLM seam, as `kea` tests do)

- **`classifySignals`**: each gold example routes to its expected target; malformed
  / partial LLM output falls back per-signal; empty input makes **no** call;
  over-cap input routes the overflow via heuristic.
- **`assembleFewShot`**: tolerates zero proposals and zero knowledge (gold-only);
  respects the token budget; ranks user examples by recency/relevance; a thrown DB
  query degrades to gold-only without raising.
- **`routeSignal`**: flag-off logs agreement and returns the **heuristic** target
  unchanged; flag-on returns the **LLM** target; the widened path promotes a
  durable score-3 signal to `knowledge` under flag-on; the error path returns the
  heuristic result.
- **`llm.ts`**: provider dispatch parity with the pre-extraction `kea.ts` behaviour
  (a characterization test so the move is provably behaviour-preserving).

**Honest test plan**
- ✅ CI: `turbo run typecheck test build` green (rely on CI; this checkout can't run
  the gates — Node 18, no pnpm).
- ⬜ Operator: after deploy (flag still off), watch `autoskill.classify.shadow`
  agreement on a handful of real sessions; flip `AUTOSKILL_LLM_CLASSIFIER=true` and
  validate proposal quality on the operator's own / a throwaway session before
  trusting it on real client sessions.

## 7. Rollout / deploy

- **No Prisma migration** (`AutoskillProposal.target` and `.status` are already
  `String`) → **autonomous-CD eligible** per CLAUDE.local.md rule 2.
- Ships **behaviour-neutral** (flag default off). Deploy is safe; the improvement
  goes live only when the operator flips the flag after reading the shadow
  agreement-rate.
- Single PR: `feat(autoskill): LLM signal classifier behind AUTOSKILL_LLM_CLASSIFIER`.

## 8. Risks / open questions

- **Shadow cost** — running the classifier purely to log agreement spends tokens.
  Resolved by making shadow **opt-in** (`AUTOSKILL_SHADOW`, default off): the default
  deploy makes no extra calls; the operator turns shadow on deliberately to gather
  agreement data, or flips the flag straight to on.
- **Few-shot leakage across scope** — must only pull the *acting user's* proposals /
  knowledge (respect `ownerUserId`); reuse the existing scope filter, never a global
  query. (Cross-tenant tests already guard this surface.)
- **Prompt drift vs. the gold set** — the gold examples are the contract; if the
  three class definitions are reworded, the gold test must be updated in lockstep.
- **Latency** — one extra LLM call per non-quiet session in the worker job; latency
  is tolerable off the request path, but the call must carry a timeout and fail-soft.
