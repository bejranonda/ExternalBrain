# Generation-uplift benchmark (#126)

Answers the claim `docs/VALIDATION.md` still marks unproven: does Brain-injected
knowledge improve an agent's actual coding output, not just retrieval ranking?
No LLM-as-judge — the metric is executable-test pass rate.

## Pre-registration (written before any run — this file's first commit is the
## pre-registration timestamp; do not edit the task list or metric after runs
## start, per the honesty guardrails in `docs/VALIDATION.md` §2)

**Design.** Six small, self-contained TypeScript utility tasks, independent of
the BrainPlatform corpus (generic utilities, not this repo's business logic —
avoids the circularity of testing the Brain using knowledge this same session
taught it). Each task ships a hidden test file the agent never sees; only the
task prompt (requirements + function signature) is shown. Each task also has
one or more non-obvious edge cases that a reasonable implementation could
plausibly miss — those are exactly what the "Brain-injected knowledge" block
calls out for the treatment arm, modeling what real retrieved knowledge is
supposed to contribute (surfacing a non-obvious convention/invariant, not
solving the task outright).

**Procedure.** For each task, run the same agent twice in an isolated scratch
directory (no access to this repo, so it cannot discover real Brain content):
- **Control arm:** task prompt only.
- **Treatment arm:** task prompt + a short "Relevant knowledge from your
  Brain" block (see each task's `injected-knowledge.md`).

Same model both arms (`claude-sonnet-5` general-purpose agent, fixed to
control cost and hold "model" constant across ~12 runs). Same task prompt
text both arms (only the injected-knowledge block differs — this is the one
deliberate variable). Seed/temperature are not controllable through the agent
harness available in this session; this is a known limitation, noted rather
than hidden (see Honesty caveats below).

**Grading.** Each arm's single output file is graded by the task's hidden
`test.spec.ts` (vitest, run standalone — outside this package's own test
include glob, see `../vitest.config.ts`). Pass = all cases in the spec pass.
No partial credit, no human/LLM judgment call.

**Metric (pre-registered).** Test pass-rate, control vs. treatment, n=6 per
arm. Report the paired difference (treatment pass − control pass, per task)
and the raw pass/fail matrix. Given n=6, no CI is statistically meaningful;
this is reported as a small-n indicative first read, not a confidence
interval, consistent with the retrieval benchmark's own "n is small" caveat.

## Task list (pre-registered)

| # | Task | Non-obvious edge case the injected knowledge calls out |
|---|---|---|
| 1 | `debounce(fn, wait)` | debounced functions in this codebase expose `.cancel()` |
| 2 | `parseCsvLine(line)` | `""` inside a quoted field is an escaped literal quote |
| 3 | `retryWithBackoff(fn, opts)` | reject with the *original* error, not a wrapper |
| 4 | `LRUCache<K,V>` | `get` must refresh recency, not just read |
| 5 | `safeJsonParse(input, fallback)` | must never throw, incl. non-string input |
| 6 | `formatBytes(bytes)` | negative input throws `RangeError`, not a garbage string |

See `tasks/<n>-*/prompt.md`, `tasks/<n>-*/injected-knowledge.md`, and
`tasks/<n>-*/test.spec.ts` for the exact text run.

## Honesty caveats (read before trusting the number)

- **n=6 is tiny.** This is a first indicative read, not a validated benchmark.
  Treat a result either direction as a starting point, not a claim.
- **Task design is by the same author running the harness** (a structural
  bias this benchmark cannot fully escape solo) — mitigated by: (a) generic,
  corpus-independent tasks rather than BrainPlatform-specific ones, (b)
  pre-registering the task list and metric in this commit before running,
  (c) objective test-based grading (no LLM judge, no post-hoc rubric), (d)
  committing to report the result whichever way it falls, matching
  `docs/VALIDATION.md`'s existing "publish whatever the number is" ethic.
- **Model/prompt held constant; seed is not.** The agent harness available in
  this session (Claude Code's `Agent` tool) does not expose a fixed seed —
  a genuine limitation vs. the ideal design in `docs/VALIDATION.md` §2.
- **Injected knowledge is authored, not retrieved.** This benchmark tests
  "does knowing the non-obvious edge case up front change the outcome",
  which is the mechanism the Brain relies on — but it is not literally the
  production KRA retrieval path (that is what the *retrieval* benchmark
  already validates separately). Treat this as testing the generation-uplift
  *mechanism*, not an end-to-end production replay.
