# Generation-uplift benchmark — results (2026-07-23)

Run against the pre-registered task suite in `README.md` (committed
2026-07-23 before this run — see git history for the pre-registration
commit). Raw agent outputs are committed under `tasks/<n>/{control,treatment}/solution.ts`;
grading harness is `harness/grade.ts`, run via `npx tsx grade.ts`.

## Headline number

| | Pass rate (n=6) |
|---|---|
| Control (no injected knowledge) | **4/6 (66.7%)** |
| Treatment (Brain-injected knowledge) | **6/6 (100%)** |
| Paired difference | **+2 tasks (+33.3pp)**, 0 regressions |

## Per-task result

| Task | Control | Treatment | Flipped by injection? |
|---|---|---|---|
| 1. debounce | FAIL — no `.cancel()` method | PASS | ✅ yes |
| 2. parseCsvLine | PASS | PASS | no (both handled `""` escaping) |
| 3. retryWithBackoff | PASS | PASS | no (both rejected with the original error) |
| 4. LRUCache | PASS | PASS | no (both refreshed recency on `get`) |
| 5. safeJsonParse | PASS | PASS | no (both guarded non-string input) |
| 6. formatBytes | FAIL — returned a string for negative input instead of throwing | PASS | ✅ yes |

Full per-assertion output is reproducible via `npx tsx harness/grade.ts` from
this directory; the JSON summary from the actual run is preserved below for
audit (copy of the run's stdout, unedited):

```
control:   4/6
treatment: 6/6
```

(1-debounce/control failed "exposes a cancel()..."; 6-format-bytes/control
failed "throws RangeError for negative input". All other 10 arm-runs passed
every assertion in their `test.spec.ts`. See each task's committed
`control/solution.ts` and `treatment/solution.ts` for the actual code that
produced these results.)

## Reading it honestly

- **Positive result, small n.** Treatment strictly dominates control on this
  run: 2 of 6 tasks flipped from fail to pass, 4 tied at pass, none regressed.
  n=6 is far too small for a confidence interval — this is a first indicative
  read, not proof, per the pre-registered honesty guardrails.
- **The 4 tied tasks are not evidence of "no effect"** — they show the base
  model (Claude, general-purpose subagent, `claude-sonnet-5`) already handles
  those specific edge cases (CSV escaped-quote convention, rejecting with the
  original error, LRU get-refreshes-recency, JSON.parse type-coercion
  awareness) correctly without prompting, likely because they're
  well-represented in training data for these common utility patterns. That
  means this task suite under-differentiates for "well-known" utilities and
  over-differentiates for genuinely idiosyncratic conventions (a `.cancel()`
  method, throwing `RangeError` instead of returning a garbage string) — which
  is arguably the more realistic picture of when a Brain actually helps: not
  on textbook algorithms, but on this-team's-specific, non-obvious
  conventions that don't show up in generic training data. A production
  fixture drawn from *actual* project-specific conventions (not generic
  utilities, to avoid corpus circularity) would likely show a larger uplift;
  this benchmark undersells that case by design (see Honesty caveats in
  `README.md`).
- **Deviation from the pre-registered design:** the vitest-based
  `test.spec.ts` files could not run through vitest directly (no local
  pnpm/vitest in this checkout, and the deployed worker container has `tsx`
  but not vitest either). `harness/grade.ts` re-implements the identical
  assertions from each `test.spec.ts` using `node:assert` and real short
  timers instead of vitest's fake-timer API. This is a grading-mechanics
  substitution, not a change to the task list or metric — anyone with a
  working pnpm/vitest install can re-run the original `test.spec.ts` files
  against the same committed `solution.ts` outputs to confirm.
- **Same caveats as `README.md`:** model/prompt held constant, seed was not
  (no seed control available in the agent harness used); task design and
  harness were both authored by the same session running the benchmark,
  mitigated by pre-registration + objective grading, not eliminated.

## Bottom line for `docs/VALIDATION.md`

First generation-uplift read: **positive** (+33.3pp, n=6, 0 regressions),
reported per the "publish whatever the number is" ethic. The product claim
("the Brain improves AI coding output") now has one indicative data point in
its favor rather than zero — still far from proven at this n, and the
mechanism-vs-production-replay caveat in `README.md` means this validates
that *knowing a non-obvious convention up front changes output*, not yet that
production's actual KRA retrieval reliably surfaces the right convention at
the right moment (that remains the retrieval benchmark's job, published
separately in `docs/VALIDATION.md`).
