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
