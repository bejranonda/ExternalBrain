# Generation-uplift suite 2 — corpus-dependent, live-KRA injection

Follow-up to suite 1 (`../README.md`, issue #126). Suite 1 answered *does knowing
a non-obvious convention up front change output?* using generic utility tasks and
a **hand-written** injected block. It found +33.3pp (control 4/6 → treatment 6/6),
but four of six tasks tied because the base model already knew the edge case from
training — the suite was corpus-*independent* by design, to avoid testing the
Brain with knowledge the same session had taught it.

This suite changes the two things that made suite 1 a mechanism test rather than a
product test.

## Pre-registration

**Written and committed before any run. This file's first commit is the
pre-registration timestamp. Do not edit the task list, the injection procedure, or
the metric after runs start** — per the honesty guardrails in
`docs/VALIDATION.md §2` and the precedent set by suite 1.

### What changes from suite 1

| | Suite 1 | Suite 2 |
|---|---|---|
| Task knowledge | corpus-independent (generic utilities) | **corpus-dependent** — only derivable from BrainPlatform convention |
| Treatment block | hand-written `injected-knowledge.md` | **live KRA output**, captured verbatim |
| What it measures | the injection mechanism | **retrieval + generation together** (the product) |
| Grading | runtime tests (`node:assert`) | **static assertions over emitted source** (see caveat) |

### Design

Five tasks. Each asks for a small, self-contained file of the kind this repo
actually contains. Each has exactly one **non-obvious BrainPlatform convention**
that a competent TypeScript/Next.js developer would plausibly get wrong, because
the idiomatic general answer differs from this repo's required answer.

Only the task prompt is shown. Two measures keep the control arm from discovering
the convention by other means:

1. **Prompts are framed generically** — they describe the artifact wanted
   ("a Next.js server component that reads an env var and renders it") and never
   name this repo, its files, or its conventions. A control agent has no cue that
   a project-specific rule exists, so no reason to go looking for one.
2. **File reading is forbidden in the prompt**, and each arm writes its single
   output file to a scratch directory outside the repo.

**Enforcement caveat, stated up front.** Measure 2 is an *instruction*, not a
sandbox: the agent harness available here runs with a working directory inside
this repository, so a determined agent could read `docs/GUIDELINES.md` and find
the answer. Suite 1 described its arms as running with "no access to this repo";
that was also instruction-enforced, and it mattered less there because suite 1's
tasks were generic utilities whose answers are not written down here. For a
corpus-*dependent* suite the risk is real and asymmetric: it would inflate the
**control** arm and therefore **understate** uplift. Any control-arm pass is
consequently checked against its transcript for evidence of file reads, and a
task whose control arm read repo files is reported as **void**, not as a tie.

### Procedure

For each task, run the same agent twice:

- **Control arm:** task prompt only.
- **Treatment arm:** task prompt + the knowledge block returned by
  `brain_start_session({ prompt: <the task's retrieval query>, projectName:
  "BrainPlatform" })`, pasted verbatim under a "Relevant knowledge from your
  Brain" heading.

The treatment block is **not authored** — whatever KRA returns is what the agent
gets, including irrelevant items. If KRA returns nothing useful for a task, that
task is expected to tie, and that tie is a real result about retrieval, not a
flaw in the harness.

Same model both arms. Same task prompt text both arms; the injected block is the
single deliberate variable. Seed/temperature are not controllable through the
available agent harness — a known limitation, recorded rather than hidden.

### Confound control (why these five tasks)

`KNOWN_ISSUES §0p` documents that `scope: "user"` knowledge is invisible outside
its capture project (117 rows; issue #174). Every rule below was **taught into the
canonical `Brain Platform` project on 2026-07-28 and verified retrievable** from a
`projectName: "BrainPlatform"` session before this file was written. Without that
control, a null result could not distinguish "the knowledge didn't help" from
"the knowledge wasn't visible" — which is exactly the ambiguity that makes an
uncontrolled live-KRA benchmark unpublishable.

### Task list (pre-registered)

| # | Task | Required convention | The plausible wrong answer |
|---|---|---|---|
| 1 | `app/status/page.tsx` — server component rendering `process.env.BRAIN_PUBLIC_HOSTNAME` | `export const dynamic = "force-dynamic"` | omit it; Docker build bakes the empty value |
| 2 | route handler redirecting `/old` → `/new` absolutely | path-only `Location`, or `x-forwarded-host` + `x-forwarded-proto` | `new URL("/new", req.url)` → emits `0.0.0.0:3000` |
| 3 | client component displaying the current hostname | SSR-safe default, real read in `useEffect` | read `window.location` in render / `useMemo` / `useState(init)` → React #418 |
| 4 | session card rendering a relative timestamp | import `formatRelative` from `@brain/core/format-relative` + hydration-safe wrapper | hand-roll a "N days ago" helper |
| 5 | i18n dictionary entry for a retrieved/cited count | format-string substitution or conditional trailing key | bake a sample count (`"0 items retrieved · 2 cited"`) into the string |

### Metric (pre-registered)

Per-task binary pass/fail on the convention assertion, control vs treatment,
n=5 per arm. Report the paired difference and the full pass/fail matrix,
including which tasks tied and why. At n=5 no confidence interval is meaningful;
this is reported as a small-n indicative read, consistent with suite 1 and with
the retrieval benchmark's own "n is small" caveat.

**Pre-committed reporting rule:** the result is published either way, including a
null or a negative. A tie is reported as a tie, and the retrieved block that
produced it is included verbatim in `RESULTS.md` so a reader can judge whether
retrieval or generation was at fault.

### Honesty caveats (read before trusting any number)

1. **Grading is static, not runtime.** These conventions govern code *shape*
   (a directive is present, a read sits inside an effect, an import comes from a
   specific subpath) — there is no runtime behaviour to assert without booting
   Next.js and a Docker build. Assertions are mechanical regex/AST checks over the
   emitted file, so there is still no human or LLM judgement in the loop, but this
   is a **weaker instrument** than suite 1's executable tests. Stated here rather
   than discovered later.
2. **The author of the tasks also authored the backfilled knowledge** (2026-07-28,
   same session). Mitigated by taking the rules verbatim from pre-existing repo
   docs (`GUIDELINES §9/§10`, `AGENTS.md`) that long predate this suite — the
   conventions are not invented for the benchmark — but the *selection* of which
   five to test is mine, and selection is a bias surface.
3. **n=5.** Indicative, not powered.
4. **Live KRA output is not reproducible over time.** The corpus changes; decay
   and usage counts move rankings. Each run's retrieved block is committed to
   `RESULTS.md` so the read is auditable even though it is not re-runnable to the
   same input.
