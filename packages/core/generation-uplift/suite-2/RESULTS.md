# Suite 2 results — first read (2026-07-28)

Run against the pre-registration in `README.md` (committed `f62895b`, before any
arm was run). Task list, injection procedure and metric unchanged since.

## Headline

| | Convention applied (n=5) |
|---|---|
| Control (no injected knowledge) | 3/5 (60%) |
| Treatment (live-KRA injection) | **5/5 (100%)** |
| Paired difference | **+40pp, 0 regressions** |

## Per-task matrix

| # | Convention under test | Control | Treatment | |
|---|---|---|---|---|
| 1 | `export const dynamic = "force-dynamic"` on an env-reading server component | ❌ | ✅ | **flip** |
| 2 | `x-forwarded-host` / path-only `Location` instead of `req.url` | ✅ | ✅ | tie |
| 3 | Mount-gate `window.location` behind `useEffect` | ✅ | ✅ | tie |
| 4 | Import `formatRelative` from `@brain/core/format-relative` | ❌ | ✅ | **flip** |
| 5 | No baked numbers in i18n dictionary strings | ✅ | ✅ | tie |

## What actually separates a flip from a tie

This is the finding, and it is sharper than suite 1's aggregate number.

**The two flips are conventions that are locally arbitrary.** Neither is
derivable from general expertise:

- **Task 1** — `force-dynamic` is only required here because `deploy/Dockerfile`
  builds with dummy env vars, so Next.js pre-renders the page with empty values.
  A competent Next.js developer writing this page in the abstract has no reason to
  add the directive. The control output contained **no static-rendering opt-out of
  any kind** (checked for `dynamic`, `revalidate`, `fetchCache`, `unstable_noStore`)
  — this is the exact bug that shipped in v0.14.0 and needed two fix rounds.
- **Task 4** — `@brain/core/format-relative` is a workspace subpath. It cannot be
  guessed. The control arm hand-rolled its own `formatRelative(from, now, locale)`
  — a perfectly reasonable implementation, and precisely the divergence v0.15.0
  consolidated away after four local formatters drifted apart.

**The three ties are conventions that coincide with general good practice**, which
the base model already had:

- **Task 2** — the control arm reached for `x-forwarded-host` unprompted and even
  wrote a comment explaining that `request.url` yields `http://localhost:3000`
  inside a container. Standard reverse-proxy knowledge.
- **Task 3** — the control arm used `useState(null)` + `useEffect`, the textbook
  SSR-safe pattern.
- **Task 5** — the control arm used `{count}` placeholders and pluralisation keys
  without being told.

**So: injected knowledge paid off exactly where the convention is arbitrary — a
package path, a build-pipeline quirk — and tied everywhere the convention is
something a good engineer already does.** That is a more useful statement of what
this Brain is for than the aggregate percentage. It also predicts where future
capture effort has the highest return: local arbitrariness, not general craft.

Suite 1 saw the same shape for the same reason (its four ties were edge cases the
base model knew from training). Two independent suites now agree on the mechanism.

## Reading it honestly

- **n=5.** Indicative, not powered. No confidence interval is meaningful.
- **Grading is static.** Assertions are mechanical checks over the emitted source
  (directive present; import path; `window` read inside an effect; no digit inside
  a dictionary string) — no human or LLM judgement, but a **weaker instrument**
  than suite 1's executable tests, because these conventions govern code shape and
  have no runtime behaviour to assert without a full Next.js build. Pre-registered
  as such, not discovered afterwards.
- **Isolation was instruction-enforced, not sandboxed.** Per the pre-registration,
  every control pass was checked for contamination. No control output contains any
  repo-specific identifier (`BrainPlatform`, `External Brain`, `useTweaks`,
  `bp_tweaks`, `@brain/core`), and each agent used 1–2 tool calls, consistent with
  writing its single output file. **No task is reported void.** The residual risk
  is that contamination would inflate control and therefore *understate* the
  uplift reported here.
- **Same-session authorship.** The five rules were backfilled into the Brain on
  2026-07-28, the same day this suite ran. Mitigated by taking each rule verbatim
  from repo docs (`GUIDELINES §9/§10`, `AGENTS.md`) that long predate the suite —
  the conventions are not invented for the benchmark — but *selecting* which five
  to test is an author-bias surface, as is the fact that the same session both
  taught and tested them.
- **Retrieval was real, but the corpus was curated.** The treatment blocks are
  genuine live KRA output, including irrelevant items (task 4's block carried a
  `KnowledgeItemView` rule that has nothing to do with timestamps). But the five
  rules had been verified retrievable from a `projectName: "BrainPlatform"` session
  first, precisely to control for the scope-filter defect in
  `KNOWN_ISSUES §0p` / #174. **A run against the uncurated corpus would score
  lower** — roughly half of it is invisible to a project-scoped session until
  #174 is resolved. This number therefore describes the Brain *with its known
  retrieval defect controlled for*, not the Brain as a user experiences it today.

## Reproduction

Task prompts, injected blocks (verbatim) and both arms' emitted files are the
inputs; the grading assertions are in the per-task table above. Live KRA output is
not reproducible over time — the corpus changes, decay and usage counts move
rankings — so the retrieved blocks are recorded here rather than regenerated.

---

# Second reading — uncurated corpus, post-#174 (2026-07-30)

The first reading carried one caveat above all others: the five rules were
**verified retrievable before the run**, to control for the scope-filter defect
that hid roughly half the corpus from a project-scoped session. That control was
necessary then — without it a null could not distinguish "the knowledge didn't
help" from "the knowledge wasn't visible" — but it meant the number described the
Brain with a known defect controlled for, not the Brain as a user meets it.

**#174 is now fixed and deployed (v2.5.0).** Corpus reach for a `Brain Platform`
session went 104 → 141 rows. So this re-run needs no curation: it is the first
honest measurement of the product as it actually behaves.

Same pre-registered task list, same prompts, same metric — a re-run, not a redesign.

## What changed in the injected blocks

Every one of the five treatment blocks now carries `cmqpqemoh…` — the
docs-content recipe that was invisible before the fix — occupying one of five
slots **regardless of topic relevance**. It is high-confidence with a long usage
record, so it now competes globally. That is the dilution risk of widening
recall, and it is exactly what this re-run was for.

**It did not cost anything measurable.** Each task's own rule still ranked **#1**
in its block. The widened corpus added a competitor without displacing the
relevant rule.

## Result

| | Convention applied (n=5) |
|---|---|
| Control (unchanged, not re-run — see below) | 3/5 |
| Treatment, curated corpus (2026-07-28) | 5/5 |
| **Treatment, uncurated corpus (2026-07-30)** | **5/5 lenient · 4/5 strict** |

| # | Convention | Curated | Uncurated |
|---|---|---|---|
| 1 | `force-dynamic` | ✅ | ✅ |
| 2 | `x-forwarded-host` | ✅ | ✅ |
| 3 | mount-gate `window` | ✅ | ✅ |
| 4 | `@brain/core/format-relative` | ✅ | ✅ |
| 5 | no baked numbers in i18n strings | ✅ | ⚠️ see below |

### Task 5 is a genuine grading-judgment case — reported, not resolved away

The uncurated run emitted:

```ts
'oracle.status.retrieved':     '{count} items retrieved',
'oracle.status.retrieved.one': '1 item retrieved',
```

The pre-registered assertion is mechanical — *no digit inside a dictionary
string*. Line 2 has one, so **strictly this fails**. But the convention's stated
rationale is *"if a future reader sees this number, is there any way it stays
correct as data changes?"* — and for an ICU `one`-category key the answer is yes:
it is only ever used when the count is exactly 1. By intent it passes.

Reported both ways rather than picked, because picking after seeing the output is
precisely what pre-registration exists to prevent. **This is the static-grading
weakness pre-registered in `README.md` caveat 1 actually manifesting** — a
predicted failure mode, not a surprise. The curated run happened to emit `{n}`
even in the singular and so dodged it.

### Why control was not re-run

The control arm receives **no injection**, so a retrieval-layer change cannot
affect it — re-running would only add model nondeterminism to the comparison.
The 3/5 figure is carried forward from the pre-registered first run. The
limitation to note: treatment and control were therefore sampled at different
times, so run-to-run model variance is not controlled. At n=5 that is a real
caveat, not a formality.

## What this reading actually establishes

1. **The #174 fix bought recall without measurable precision loss** on this
   suite. That was the open question, and it is the useful result — widening a
   corpus can degrade top-k injection, and here it did not.
2. **The first reading's headline number survives decurating.** +40pp (lenient)
   or +20pp (strict) against the carried-forward control.
3. It remains n=5, statically graded, with the arms sampled at different times.
   Two readings agreeing is worth more than either alone, but neither is powered.

### Independent confirmation of the strict grade, and one thing it surfaced

CodeRabbit reviewed the uncurated artifacts on PR #178 and — reading the file
cold, without the pre-registration in front of it — flagged
`'oracle.status.retrieved.one': '1 item retrieved'` as violating "no count ever
lives inside a dictionary string". That is an **independent arrival at the strict
reading**, which is worth more than my own grade agreeing with itself. It does not
settle the question (the ICU `one`-category argument still stands), but it does
mean the strict reading is the one a reviewer reaches unprompted.

It also surfaced a difference the pre-registered assertion does not cover: the
**curated** run returned an `oracle.status.empty` key before building any segment
when `retrievedCount === 0`; the **uncurated** run dropped that early return and
renders `"0 items retrieved"` instead. This is a genuine qualitative regression
between the two runs. It is **outside the pre-registered metric** (which asks only
about baked numbers), so it does **not** change the 5/5 or 4/5 score — recorded
here rather than folded into the number, because moving the goalposts after seeing
the output is the exact failure pre-registration exists to prevent.

Both artifacts were left **unmodified**. They are evidence of what the run
produced; editing them to satisfy a review would falsify the experiment. See
`tasks/README.md`.
