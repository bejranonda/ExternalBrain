# Approach and Method

How we think about this product, why we made the architectural choices we did, and how we decide when we're stuck.

> **Process counterpart:** how we *ship* the decisions made here lives in [docs/CONTRIBUTING.md](./CONTRIBUTING.md) — a single-branch flow (`feature/bugfix/docs` branch → PR → `main` → deploy) on one self-hosted server. The earlier two-host / `develop`→`main` promotion model (documented in §5n below as history) was collapsed on 2026-06-06; `main` is now the only long-lived branch.

---

## 1. Philosophical stance

Three beliefs shape every decision in this repo.

### 1.1 Knowledge is procedural, not factual
A useful coding brain does not store "React was created by Facebook". It stores "when scaffolding a React form in this project, use react-hook-form + zod because you've been bitten by Formik's abandoned maintenance".

The shape of useful knowledge is `(trigger, rule, rationale)`. Everything downstream — ontology, extraction, retrieval — is optimized for this shape.

### 1.2 Retrieval matters more than storage
The ceiling on Brain quality is set by retrieval, not storage. A perfectly curated knowledge vault with keyword-only retrieval is a bad Brain. A mediocre vault with great semantic retrieval is a good Brain.

That's why pgvector is load-bearing from day 1 and why KRA scoring is a multi-factor formula, not just cosine similarity.

### 1.3 The flywheel must be measured or it didn't happen
Belief without measurement is vibes. SQS + knowledge health + NDCG@5 are shipped alongside v1, not after.

If we can't observe the flywheel, we can't tell when it stalls — and every research document warns that it *will* stall without explicit counter-engineering.

---

## 2. Method

### 2.1 Descriptive before prescriptive
The research progresses from "what exists" → "what's broken" → "what to build" → "how to code it". We honor that order. No design doc begins with "the system shall"; it begins with "today we see …".

### 2.2 Specific over general
A design doc that says "the system should handle multiple users" is worthless. A design doc that says "every ORM query filters by `ownerUserId` at the repository layer, and an integration test in every PR verifies no cross-tenant leak" is actionable.

Every abstract claim in this repo should be paired with a file path, a function name, or a metric.

### 2.3 Stolen ideas over invented ones
Hermes, Honcho, Obsidian, LiveSync have each solved pieces of this problem. We adopt their best ideas with attribution (see `BLUEPRINT.md §4`). We invent only where existing solutions don't fit.

This is conservative, and it is correct. The wrong place to be clever is in the substrate.

### 2.4 Dependency-acyclic packages
`types → db → core → apps`. A cycle in this graph is a bug. Cycles hide coupling that makes refactoring painful. See `GUIDELINES.md §2`.

### 2.5 Failure modes before features
Every new subsystem starts with "what goes wrong?" (`KNOWN_ISSUES.md`) and "what are the invariants?" (`KNOWLEDGE.md §5`). Only after those are written do we implement.

### 2.6 One list, N surfaces — never N lists
When a fact is true of N things, it lives in one place that all N derive from. Not a convention, not a checklist item: a single array the surfaces import.

This is the repo's most expensive recurring defect, not a theoretical concern. Five of eleven install snippets shipped a config shape no MCP client accepts (`KNOWN_ISSUES §0u`); four sibling pages hand-rolled a home link and the fifth forgot (`§0v`); two token tables stored raw secrets while a third in the same schema hashed correctly (`§0w`); two of three build scripts stamped the version and the most-used one didn't (`§0ab`). Every one looked correct in isolation. Per-item review structurally cannot find this class — the defect is the *gap between* items, and nothing in a single diff shows it.

Two disciplines follow:

**Move ownership, don't patch the instance.** Fixing the fifth page is a fix; putting the link in the shared layout is a *repair*. The next author then inherits correctness without knowing the rule exists. Client identity now lives in one `CLIENTS` registry in `@brain/core`, from which the wizard, the `/welcome` picker, both installers and the test sweep all derive.

**Write one test that ranges over all N.** Not N tests — the sweep is what finds the gap, because a hand-listed sweep only sweeps what someone remembered to add to it. All 12 clients × 3 OSes found a missing note; all ~24 routes found the missing home link; parsing `schema.prisma` found the raw-token columns. Two corollaries, both learned by getting them wrong: assert the sweep matched something (a detector that silently matches nothing passes every downstream assertion), and revert the fix to confirm the test actually fails.

### 2.6a Secure-by-default means the *default* is the locked state
A posture stated in four places and implemented in three is not a posture. `CLAUDE.md`, `auth.ts` and `.env.example` all promised that a fresh instance is locked until an auth mode is chosen; `docker-compose.yml` defaulted the dev-auth shim **on**, and compose is the surface that actually runs (`KNOWN_ISSUES §0ac`).

The rule: **the convenient default and the safe default are the same default, or the safe one wins.** A permissive default justified as "so a bare local `up` boots usable" trades a few seconds of a developer's setup against every forker who runs the documented quickstart on a public IP. That trade is never worth it, and it is invisible — an open instance produces no error, no warning, and no failing test. It simply answers as somebody.

Corollary for review: when reading a diff that adds a default, ask what the value is for someone who configured **nothing**, and whether any test asserts that case. If the answer is "it works out of the box", find out what "works" means.

### 2.6b Before writing a document, find out whether it already exists
Asked for a getting-started tutorial, the reflex is to write one. The repo already had 1,452 lines of them — eight files under `docs/tutorials/`, plus `USING_BRAIN`, `QUICKSTART`, `END_USER` and `CLIENTS` all covering parts of the same ground. A ninth would have made the problem worse.

The actual failure was not absence. It was **staleness** (no tutorial mentioned the `--client` flag that had shipped that morning) and **no single entry point** (four plausible places to start, none of them obviously first). So the work became: refresh the stale commands, write one short consolidated path, and link it from the top of each index — not author another parallel document.

The generalisable question when asked for documentation: *is the reader missing information, or missing a route to it?* Those have opposite fixes, and writing new prose for the second one is how a docs tree grows to the point where nobody can find anything. Applies to code too — a "missing" helper is often an existing one nobody could locate.

### 2.6c A documented contract nobody can satisfy is decoration
`packages/core/src/org.ts` opened with a design rule, stated as fact: *"Every function accepts a `db` client as the first argument so callers can supply a transaction client or a mock."* Nineteen functions, every one typed `db: PrismaClient`. Prisma's `TransactionClient` is `Omit<PrismaClient, ITXClientDenyList>`, so it is **not** structurally assignable to `PrismaClient` — passing one never type-checked, and in three years no caller had tried. The rule had been true as an intention and false as an interface since the day it was written.

Nothing catches this. The docstring reads as documentation of existing behaviour, so reviewers trust it; the types compile, so CI is silent; and the first person who needs the capability discovers it does not exist while mid-way through something else. `/api/onboard/claim` needed exactly it — the voucher burn and the token mint have to be one transaction — and the header promised the tools were already there.

The rule: **when a comment claims a capability, either a caller exercises it or the comment says "not yet".** Prose in a header is not enforced by anything, so it decays in the one direction that costs the reader most: toward optimism. Two cheap disciplines — write the narrowest true statement (here: name *which* functions take a transaction client, because only two do), and when adding a capability claim, add the caller that proves it in the same commit.

Related to but distinct from §2.6: that is one fact spread across N surfaces; this is one fact that was never true anywhere, restated confidently enough that everyone assumed it had been checked.

### 2.6d A design system already answers most of the question you're about to invent an answer to
`/` and `/start` shipped dense, monotone, with no header hierarchy — and the operator caught it by looking, not by reading the diff. The proximate fix was CSS. The actual cause was that `globals.css` already had a five-step type scale (`--text-xs/sm/base/lg/xl`, 12/14/16/20/24), a real accent color (`--accent`, used in `.btn-primary` and as a "this matters" tick on active nav items), and an established heading treatment on `/docs`'s own concept pages — and none of it got looked up. Instead: a one-off scale invented on the spot (11.5–16px), the same 13px `--ink-4` label applied to every heading regardless of importance, and zero color anywhere on the page.

One of the two resulting bugs was worse than a taste problem: `var(--bg-2)` was typed into two style objects on `/start` and is not a real token anywhere in the stylesheet. It didn't error — `var()` with an undefined custom property and no fallback just resolves to nothing, so the voucher input and the agent-prompt box rendered with **no background at all**, silently, for the life of the feature. Nothing catches this class of mistake: it type-checks (it's a string), it doesn't throw, and a screenshot only reveals it if someone is actually looking for a fill that isn't there.

The rule this generalizes to, stated the same way §2.3 states it for backend architecture: **when working inside an existing design system, look up the token before typing a value.** A hex code, a pixel size, or a `var(--name)` written from memory is a guess, and a guess that happens to compile is indistinguishable from a correct answer until someone looks at the rendered page. `grep -n "^\s*--" globals.css` before styling anything costs seconds; reconstructing why four public pages disagree costs a PR cycle each.

### 2.7 Depend on vendors' contracts, not on their internals
Roughly a third of the surface here is other people's config formats, and they move. Two failures inside one week: we invented a `transport: {type, url}` shape no client documents (`§0u`), and Google's Gemini CLI → Antigravity merge moved a config path we had hardcoded and pinned with a passing assertion (`§0z`).

The rule that falls out: **prefer the vendor's own verb to the vendor's file layout.** `claude mcp add`, `copilot mcp add` and `codex mcp add` are contracts their authors maintain across format changes; `~/.gemini/antigravity/mcp_config.json` was a fact that expired silently. Where no such verb exists — Cursor, Windsurf, Antigravity, Claude Desktop — we write the file ourselves and accept the maintenance debt knowingly, which means citing the vendor doc in a comment next to the shape and re-checking it whenever that product announces a merge, retirement or rename.

And treat a green test as evidence about **us**, never about them. No test in this repo can detect an external path changing; that is what a dated source link in the code comment is for.

---

## 3. Decision framework (when stuck)

In priority order:

1. **Check the research.** `research/knowledge/` has 17 documents and 7,900 lines. The answer is probably there.
2. **Check the reference systems.** If it's about session memory, check Honcho. Skills + extraction, check Hermes. Links + graph, check Obsidian. Sync, check LiveSync.
3. **Check the invariants.** If a proposed change violates `KNOWLEDGE.md §5`, it's wrong. Find a different path.
4. **Check the non-goals.** If what you're about to build is in `KNOWN_ISSUES.md §5`, stop.
5. **Ask the human.** The 7 open decisions in `BLUEPRINT.md §14` require a human. Don't assume.
6. **If still stuck, prefer the conservative choice.** Less scope, more observable, easier to reverse.

---

## 4. Heuristics for common choices

### 4.1 "Should this be a new knowledge type?"
Almost certainly no. Use `tags` or `scope` instead. See `GUIDELINES.md §11`.

One precedent for the exception (V2.0, 2026-07-07): `action_item` was added as
a type *value* — not a new entity, no migration — because it is a **non-rule**
(a task) that must be *excluded* from every rule surface (retrieval, KEA,
decay stats, injection metrics). A distinct value made the exclusion one
predicate; tags would have leaked tasks into semantic retrieval. The test
remains: if the new kind participates in rule semantics, use tags/scope; only
something that must be *carved out* of rule semantics earns a type value.

### 4.2 "Should this be in core or in an app?"
If two apps need it, it's in `core`. If one app needs it, it's in that app. If you're not sure, start in the app; move to `core` when a second app needs it.

### 4.3 "Should this be sync or async?"
Reads are sync (fast path). Writes that produce knowledge are async (worker + pg-boss). The client never waits for KEA.

### 4.4 "Should this be a hard filter or a soft score?"
Hard filters: scope, user ownership, decay > 0.3. Anything that leaks across these is a bug.
Soft scores: similarity, recency, context fit. These are the knobs we tune.

### 4.5 "Should this fail hard or fail soft?"
Retrieval failure never breaks a coding session. Extraction failure never breaks a completed session. Failure is silent, logged, and retried.

The only hard-fail paths: auth, scope enforcement, invariant violations.

### 4.6 "Should this be a new top-level route or a surface in the shell?"
The webapp is a client-side SPA mounted at `/` (`apps/web/app/page.tsx`). The eight surfaces (Dashboard, Oracle, Skills, Graph, Decisions, Autoskill, Sessions, Meetings) are **state**, not routes — they're selected through `ROUTES` in `apps/web/lib/brain/routes.ts` and reflected in the URL hash for deep links. A new surface means:
1. Add it to `ROUTES` and `KEY_MAP` in `routes.ts`.
2. Add its labels to the three language dictionaries in `lib/brain/i18n.ts`.
3. Add its component under `components/brain/` and register it in `components/brain/app.tsx`.
4. Walk the checklist in `docs/NAVIGATION.md §3` before merging.

Do **not** introduce a separate Next.js route for a surface that already lives in the shell — it fragments the keyboard, command palette, and breadcrumb logic. Detail pages (e.g. a single session view) are the exception and may be their own Next route, but they should still be reachable from the shell.

### 4.7 "Should this be deterministic or LLM-driven?"
Start deterministic (filter, rule, regex). Graduate to LLM when deterministic proves insufficient and evaluation confirms the LLM wins.

KEA extraction is LLM-driven because deterministic keyword matching was the bottleneck in the research's Path R analysis. Autoskill's **type** decision (`rules` / `knowledge` / `ignore`) graduated from keyword heuristics to an LLM classifier in **v1.10.0** (`packages/core/src/autoskill-classifier.ts`) once proposal-acceptance telemetry existed to ground it — but it ships behind `AUTOSKILL_LLM_CLASSIFIER` (default off) with an `AUTOSKILL_SHADOW` mode that logs heuristic-vs-LLM agreement first, so "graduate when evaluation confirms the LLM wins" is settled by *data*, not asserted. The cheap deterministic stages (score gate, dedup, the 4-question quality filter, the embedding skill short-circuit) stay as pre-filters and the keyword path is the fail-soft fallback. Few-shot is grounded in the user's own resolved proposals (applied/rejected), so the classifier personalises and self-corrects as they review.

---

## 5. Anti-patterns to avoid

| Pattern | Why it's wrong |
|---|---|
| Adding a feature "for future flexibility" | YAGNI. Feature flags for hypothetical needs are technical debt you haven't yet paid off. |
| Storing something "in case we need it later" | Obligation to migrate, GDPR-erase, and secure data you never use. |
| Edit-in-place on Knowledge rows | Violates immutability invariant. Use `parentKnowledgeId` versioning. |
| Auto-promotion across scopes | Personal → team → community is always explicit user action. |
| Ignoring SQS because it's "noisy early on" | Noisy metrics still reveal trends. Ship the metric. |
| Inventing a new MCP tool for every need | Compose existing tools. New tool = new contract = future deprecation pain. |
| Putting business logic in a route handler | Handlers are thin; logic lives in `@brain/core`. |
| Returning raw LLM output to users without parsing | Oracle returns `{answer, citations}`; parse citations, validate markers. |
| Logging full prompts / embeddings | Expensive, privacy-risky, and almost never useful. |
| Naming a regression test after the page you found the bug on | It passes forever while the sibling surface ships the same defect. Name it after the bug class. See §5q. |
| Citing a test file as evidence of coverage without checking it runs | 20 of 31 e2e specs were referenced by no workflow. Existing ≠ gating. |
| Opening a PR before verifying with the real tool (curl the endpoint, screenshot the page, `grep` the token list) | Two of four PRs in the 2026-08-09 onboarding/landing session existed only to fix something the prior PR shipped unverified — a config flag never wired into compose, a UI never opened in a browser. Each follow-up cost a full CI run plus a live prod container restart. "I'll verify after merging" turns one PR into two. |

---

## 5q. Fix the class, and let the test say so (2026-08-05)

Three separate findings this year reduce to one method failure, so it is worth
stating as method rather than as three bugs.

**The pattern.** A defect is found on one surface, fixed there, and guarded by a
test named after *that surface*. The test is green forever. The identical defect
on the surface next door is invisible to it.

- **The install-snippet URL defect** — an unreachable `${hostname}:3100/mcp` was fixed for `/welcome` and
  guarded by `welcome-public-urls.spec.ts`. It stayed live in the token install
  wizard and the onboarding modal — the two surfaces operators actually use for
  first-run setup — for months.
- **e2e wiring** — `authed-e2e.yml` documents, in a comment, that one spec "fell
  into NEITHER e2e workflow, so its tests had never actually run in CI despite
  existing in the repo." That was fixed for that one file. 20 of 31 specs are
  still in exactly that state.
- **The 2026-08-02 audit's eleven findings** were already this shape
  (`GUIDELINES §4`): hardening applied in one place, not carried across.

**The method.** Three moves, in order:

1. **Enumerate before you close.** `grep` the defective *pattern*, not the
   reported file. Cheap enough that there is no excuse: a single `grep -rn
   ':3100'` would have found all three surfaces at any point in the last year.
2. **Centralize the thing that was duplicated.** Per-surface copies of the same
   resolution logic are the *mechanism* by which a class-defect recurs. The fix
   was one module (`lib/brain/public-urls.ts`), not three patches.
3. **Write the test as an invariant over the repo, not an assertion about a
   page.** "No file hardcodes this port, except these known dev fallbacks" fails
   the moment a fourth surface appears. "This page is correct" never does.
   Prefer a source-level test that needs no DB or stack, so it actually runs.

**Corollary — prefer the guard that runs.** A perfect e2e assertion in a spec no
workflow invokes protects nothing. When choosing where to put a guard, weight
"does this execute on every PR" above "is this the most realistic simulation."

### Measure the typography, don't eyeball it

The same audit flagged Thai text as clipping at tight line-heights. Rather than
asserting it from a screenshot, the check was: render the real webfont in
headless Chromium and compare `TextMetrics.actualBoundingBoxAscent +
actualBoundingBoxDescent` to the computed line box. That produced a number
(6.8px of overlap at 32px/1.1), validated the proposed fix (−2.8px clearance at
1.4), **and corrected the audit** — sites at 1.35 that had been listed as
defects actually clear by 0.55px. A Latin control at the identical setting
confirmed the cause was the script, not the leading in general.

Generalizes: when a claim is about a measurable physical property, measure it.
The measurement is usually cheaper than the argument, and it is the only version
that can tell you that you were wrong.

---

## 5b. GUI-to-backend wiring method (Phase 0 pass, 2026-04)

When a surface group exists as GUI-over-mocks, the pattern for wiring it to the backend is:

**Audit.** Spawn one Explore subagent per surface group in parallel. Each produces a wiring matrix: `element → handler → endpoint → WIRED / STATIC / STUB / ORPHAN`. Record orphan elements, orphan routes, auth stubs, and hardcoded display values before touching any code.

**Build in priority waves.** Address the matrix output in dependency order:
1. Auth stubs — fix `getCurrentUserId()` everywhere before wiring data routes, or every subsequent hook inherits a bad user context.
2. Hooks first, then route, then component — define the data shape in `use-*.ts`, add the API route, then rewrite the component against the hook.
3. Counts / shell chrome before surface-level detail — live counts and scope selection unblock every surface that reads scoped data.
4. Defer schema-change work (new Prisma models, DB migrations) unless the migration is safe to run against a shared DB without approval.

**Fallback-to-seed discipline.** Every hook returns seed/mock data when the fetch fails or the server is unreachable. This keeps the design surface demo-able at all times without branching the codebase.

**State-splice writes.** All write routes return the updated view so the client can splice local state instead of refetching the whole list. Avoids stale-read races on slow connections.

**Verify.** After all waves, run `tsc --noEmit` across all workspace packages and `next build` for `apps/web`. Fix type errors before declaring the pass done. If the bundler (e.g. Turbopack) cannot resolve NodeNext `.js→.ts` imports across workspace packages, fall back to `--webpack` for the build check.

The Phase 0 audit flagged 40+ orphan elements, 2 orphan routes, 2 auth stubs, and 6 hardcoded BRAIN_DATA display values. Nine build waves cleared all of them across Dashboard, Oracle, Skills, Graph, Autoskill, and Sessions.

## 5n. Two Brains, two hosts — how the topology evolved (2026-04-24 → 2026-04-25)

> **Canonical topology diagram, token model, and consequences for ops live in [`docs/ARCHITECTURE.md §"Deployment topology"`](./ARCHITECTURE.md#deployment-topology).** This section captures *how we got there* and the lessons about symmetry drift and stale prompts — the facts themselves are one-sourced above.

On 2026-04-24 I spent half a wave documenting a false symmetry. "Two-environment workflow" sounded clean: `main`→prod, `develop`→dev, two Brains, parallel stacks, same code, different tokens. The prompts I inherited (all three `*_CLAUDE_PROMPT.md` files, later deleted in commit `5f3f660`) reinforced that mental model.

The actual setup at that time was asymmetric:

- **the legacy host (`203.0.113.30`, branch `develop`)** was THE Brain. Stack deployed, Postgres live, MCP serving, webapp reachable, issues tokens. *(On 2026-05-08 the dev Brain relocated to **the dev host (`203.0.113.10`)**; DNS `brain-dev.example.com` unchanged.)*
- **the prod host (`203.0.113.20`, branch `main`)** was a coding-work VM. Repo cloned as reference; Brain containers NOT built. Its job was to run Claude Code against the legacy host's Brain.

On **2026-04-25** the "candidate future" in the original docs became today: the prod host was promoted to production Brain. The two-Brain topology that was documented as aspirational is now real. The dev Brain (`https://brain-dev.example.com`) ran on the legacy host until 2026-05-08, when it was relocated to the dev host (`203.0.113.10`); the prod host is the prod Brain (`https://brain.example.com`). `docs/AUTOBAHN_BOT_PROMPT.md` — written for the coding-work-VM role — was deleted. Stale docs deleted, per commit `5f3f660`: fewer-but-correct prompts beat many misaligned ones.

**Three lessons from the 2026-04-24 wave that still apply:**

1. **Symmetry is a story the author projects onto the repo.** Documents like CONTRIBUTING.md and the host-specific prompts read cleanly when both sides of a dichotomy have parallel duties. That cleanliness is seductive and often wrong. Ask whether the thing you're documenting is "A and B, peers" or "A, which B consumes." Get that right before writing the docs.

2. **Verify what's actually deployed, not what the prompts assume.** The (now-deleted) DEV and PROD prompts both checked for a shared-secret `MCP_BEARER_TOKEN` in `.env`. No such variable exists in our deployment — we use per-user `MCPToken` rows via `/settings/tokens`. Both assumptions shipped untested. The first-use audit on the actual hosts caught them; future prompts (if any) should be paired with a "run on real hosts before merging" gate.

3. **Self-contained prompts still beat tribal knowledge — they just need to match the territory.** The *form* of the prompts (paste-and-run, `hostname -I` first-line guard, pause-before-write) is genuinely good. The *content* of two of them was wrong. Fix the content; keep the form.

---

## 5m. Measure the thesis end-to-end, not just the easy half (2026-04-24)

For three weeks the retrieval benchmark read as "the thesis is proven." NDCG@5 = 1.000 on a 20-query fixture — what more could you want? Phase M5 (generation-uplift first run) was the reminder that retrieval-is-right does not imply generation-is-better. The retrieval path is the cheapest half to measure; the product claim lives in the other half.

**Retrieval proves the Brain finds the right knowledge. Generation uplift proves that knowledge changes the output.** Those are separate measurements and you cannot substitute one for the other. Our retrieval benchmark at 1.000 bought us permission to build on top, but it didn't prove *anything* about whether the Oracle is more helpful with Brain than without. That confused me for a week before I admitted it out loud in the self-audit.

The first uplift run produced a stark qualitative signal (with Brain → cites user rules; without Brain → refuses) but a human still has to blind-score the pairs on a 0-3 rubric before the claim is empirically defensible. That's future work — and it must happen before Phase 6 (Brain Gateway) gets any engineering time, because the gateway's value is entirely downstream of the uplift being real at scale.

**Rule:** for any claim of the form "X improves Y," there are at least two benchmarks — "does X do its job?" and "does Y measurably move?". Shipping only the first and calling it evidence of the second is a common failure mode and I fell into it. The retrieval benchmark is not a generation-uplift benchmark. Ship both or ship neither.

**Corollary:** adversarial cases save you from the "clean paraphrase" trap. The original 20-query fixture was author-written from the triggerText — it's a paraphrase-detection benchmark, not a real-user benchmark. Adding 15 adversarial queries (typos, telegraphic, multi-topic, no-match) confirmed the good news (semantic retrieval is typo-robust) and surfaced a distinct no-match regime that NDCG mechanically scores 0 on and therefore doesn't measure well. The honest report separates regimes rather than averaging them.

**Uplift v2 closes the manual-scoring gap from Phase M.** The first uplift run (Phase M, 2026-04-25) produced a stark qualitative signal but required a human grader to score answer pairs — making the number non-reproducible and non-automatable. Generation uplift v2 adds an automated LLM-judge step (randomised A/B assignment + citation-marker stripping to preserve blindness), a 52-question fixture, per-category breakdown, and a trend-tracking summary file. The out-of-domain sanity check (10 questions the corpus cannot answer) guards against judge bias. See `docs/VALIDATION.md §"Generation uplift v2"` for the full methodology.

**Core Value B: Knowledge effectiveness signal closes the feedback loop on knowledge usage.** For most of the project, `successCount`, `failureCount`, and `usageCount` on every `Knowledge` row existed as schema columns but were never reliably updated. The result: the Brain accumulated rules but had no signal about which ones were paying off. Phase B closes that loop. `usageCount` + `lastUsedAt` are now bumped whenever a Knowledge row is cited in an Oracle answer. `successCount` / `failureCount` are bumped when a session outcome is reported — both via the explicit `knowledgeUsed` list in `brain_report_session_outcome` and via `SessionKnowledgeApplication` rows. The `effectivenessScore` pure function (`successCount / (successCount + failureCount)`, -1 sentinel for < 3 outcomes) powers a per-rule badge in the Skills UI and a "Most useful rules" card on the dashboard. The decay job flags rules with `score < 0.3 + ≥5 outcomes + no recent usage` with a `"flagged:low-effectiveness"` tag for operator review. No destructive auto-deletion. The design principle: surface the signal honestly (small N → show "Untested" rather than a misleading %) and never shame the user — a low-effectiveness rule is an *opportunity to refine*, not a mistake.

---

## 5l. Close your own gaps before anyone else finds them (2026-04-23, later)

A self-audit at the end of a wave found five outstanding issues — some I had explicitly documented as "Phase 6" but kept deferring, some I hadn't called out honestly. The lesson wasn't "we need more process", it was "the gap between recognising a known issue and closing it costs trust every day it sits open". Shipped all five in one pass: KRA formula fix (known-wrong since the first benchmark, 0.928 → 1.000 NDCG@5), signout rewrite (user reported it, took a day to close), voucher brute-force limit (in KNOWN_ISSUES for a week), pre-commit hook (sat as a "should have done from day one" since Phase 1), nav-smoke script (existed only as a mental checklist).

**Rule:** when you catch yourself saying "I'll fix that in the next phase" about something with a < 1-day implementation cost, fix it now instead. Deferring is the right call for genuinely big work (the Brain Gateway, generation-uplift full human-scored run). It's the wrong call for 15-line fixes that have sat in KNOWN_ISSUES long enough to become embarrassing.

**A second related lesson from N2 (KRA re-tune):** the benchmark that surfaced the regression had been green for three days. Green-according-to-the-gate does not mean green-according-to-the-truth. We shipped a gate that said "NDCG@5 ≥ 0.4 is a pass" and celebrated 0.928 — without asking "but cosine-only hit 1.000; why are we 7 % lower?". A gate that rewards passing its own threshold without comparing against a stronger baseline is not a gate, it's a vanity metric. Every new gate should answer: *what's the strongest-reasonable baseline, and what's our margin above it?*

---

## 5k. Fail-closed by default (2026-04-23)

Before this week, an unconfigured External Brain deployment silently fell through to the dev shim and served everyone as the first User row. That was deliberate at the time — it kept `./scripts/deploy.sh` working on a colleague's laptop without them first registering a GitHub OAuth app. The cost of that convenience, once a VM was exposed on the public internet, was that any scanning IP could read the seeded Alex persona's Knowledge. The user noticed in the screenshots from the pilot VM. That convenience had to go.

The discipline: **when the security-critical config is missing, refuse the request. Do not silently substitute a working-but-unsafe default.** `getCurrentUserId()` now throws `auth_not_configured` (503) instead of returning "the first user" when both OAuth and the explicit dev-shim opt-in are absent. The operator's mistake becomes "the app doesn't work" — visible in the first curl, impossible to miss — instead of "the app works for anyone who finds it."

Three corollaries that generalised:

1. **Explicit opt-ins beat silent defaults.** The dev shim still exists; it just requires `ALLOW_DEV_AUTH=true` written in an env file. That typing friction is intentional. Every deployment that has it either is a local dev machine (where "anyone can reach the app" is fine) or is a deliberate VPN-only demo (where the operator owns the risk). No deployment has it by accident.

2. **Chicken-and-egg escape hatches must be named.** The voucher gate refuses new-user registration without a valid code. But the first admin has no one to issue them a code — that's the chicken-and-egg. Solution: `ADMIN_EMAILS` env bypasses the voucher check for operator-listed emails, but only on their own first sign-in. Called out in code + docs as the only bypass. If you find an un-named escape hatch in someone's security design, suspect the whole design.

3. **Audit the audit.** Every voucher mutation writes an AuditLog row. The audit is append-only by contract — even the GDPR erase path keeps audit records. That means a disgruntled admin who issues themselves vouchers, demotes a peer, or disables someone else's code leaves a permanent trail. The admin UI `/admin/audit` is not a debug tool; it is a tripwire for operator compromise.

The zero-error release loop (docs/SECURITY.md) exists because auth changes have a nasty habit of breaking unrelated paths. A typecheck pass is not enough. An E2E pass is not enough. Every single route has to be proven-guarded, and the unauth lockdown has to be probed with curl, and the whole loop has to re-run on every fix. This is the cost of multi-tenant trust.

---

## 5j. Measure the thesis before you build on it (2026-04-23)

For most of this project, the thesis — *semantic retrieval of session-extracted knowledge improves AI coding output* — was a stated premise, not a measured fact. We shipped six surfaces, three production waves, two full E2E suites, a hosted release, and a docs tree on top of that premise. That's normal early-stage product work. It's also a latent risk: everything above an unproven thesis is infrastructure over nothing.

**The cheapest thing that proves the thesis is a retrieval benchmark. Run it early, re-run it on every change.** Twenty hand-labelled queries, a fixture of 16 seeded Knowledge rows, four retrieval strategies (production + three baselines), three metrics (NDCG@5, Recall@10, MRR). One morning's work. It answers the question "does this system do the basic thing it claims?" concretely enough that the answer changes what you build next.

**Numbers worth having are often surprising.** Our first benchmark result was the same shape we'd hoped for (0.928 NDCG@5, well above the 0.5 gate) but contained a finding we did not expect: the multi-factor scoring formula that we treated as the intellectual heart of KRA is *hurting* top-5 quality versus raw cosine on clean queries. The formula was chosen a priori from research, not tuned from data — and our data says the weights are wrong. Without the benchmark we would never have found that; we'd have built autoskill and teams and the Brain Gateway on top of a scoring formula that quietly demoted the right answers.

**Baselines matter more than the headline number.** NDCG@5 = 0.928 sounds great in isolation. It's only decisive when you see recency-only = 0.154 and random = 0.263 next to it — that's a ~4–6× lift, and that's the product claim made concrete. A benchmark that reports only the system under test is a celebration, not a measurement. Always ship the "no brain" comparison.

**Validation is a living doc, not a launch.** `docs/VALIDATION.md` exists so every future KRA / KEA / embedding change is measured against the same fixture, with the numbers updated in place. Passing once is cheap; staying passed across a year of changes is what actually earns the thesis.

**Phase-5 sequencing is deliberate.** We chose to validate before building the Brain Gateway (Phase 6). That's not caution; it's arithmetic — the gateway's value depends entirely on KEA + KRA being worth capturing traffic for. Phase 5 is the cheap de-risking pass that tells us whether Phase 6 is infrastructure over a flywheel or infrastructure over a story.

---

## 5i. Density-by-default is a bug (2026-04-22)

A first-mount surface that auto-opens every pane it *could* show is denser than any user wants on first contact. The three-column Skills/Graph/Oracle layouts all did this: auto-select an item, auto-populate the inspector, fill three columns of dense content before the user had clicked anything. The fix is progressive disclosure — show the scaffolding (filters + list, or the canvas), let the user reach for detail. Hidden state is not the same as missing state; it's state that hasn't been paid for yet.

**Signs the default-opens bias is back:** placeholder copy inside a right-hand pane ("Ask a question to see retrieval.", "Click a node to inspect."), visible-but-empty chrome, auto-selected fallbacks (`selected ?? nodes[0]`), useEffects that pre-warm selection state. All of those are density smells — the component is trying to be helpful and ending up loud.

**The fix is structural, not cosmetic.** `display: none` on an empty pane still eats a column in the grid template; the pane must not render at all. Collapse `gridTemplateColumns` accordingly so the remaining columns get the reclaimed width. Tests that assumed auto-select (e.g. "all three columns render") need to click an item before asserting on the detail pane — the assertion still works, the test just reflects reality.

**Escape + X + click-outside are three valid close affordances.** Pick two: a visible X button in the header (discoverable) and Escape (keyboard-efficient). Click-outside overlaps with row-click on list-detail layouts and causes surprise dismissals.

**Graph canvas is its own density problem.** Text labels collide in SVG at high node counts; truncate aggressively (42 chars is enough for eyeballing, full text lives in the inspector `<title>` and the right pane). Long KEA rules + any test-authored titles cross the visual-readability threshold fast.

---

## 5h. E2E-authoring method (2026-04-22, latest)

After Waves 1/2/3 shipped, we expanded Playwright from 3 smoke specs to 16 specs covering all six surfaces + tokens + onboarding + tweaks + i18n + a11y + responsive + streaming. A few things became sharp:

**Write the spec, then find the real bug.** Four of the earliest E2E failures were live bugs that unit tests didn't catch: the onboarding modal auto-opened during the `useCounts` pre-fetch window (covering every click in every spec); `pnpm --filter @brain/db prisma migrate deploy` silently no-op'd in pnpm 9 (production deploys never migrated); the Next 16 proxy runtime override was a build error (the proxy wasn't rate-limiting anything); and the in-memory proxy rate-limit saturated under burst test load, silently dropping hooks into BRAIN_DATA mock mode (PATCHes against mock IDs returned 404, looking like test bugs for product reasons). E2E is the first place we exercise the "stack as shipped." If you write the spec expecting the happy path and get a failure, it's rarely the spec's fault.

**Gate everything on a real readiness signal, not a timeout.** The onboarding race surfaced because the modal keyed off `knowledgeCount === 0`, which is transiently true during the first fetch. The fix was adding `ready` prop gated on `liveCounts.loaded` — not `setTimeout(..., 500)`. Every UI that "usually works but flaps in tests" has a similar missing-readiness-gate somewhere. Same pattern for the responsive skills test (`.skills-filters` / `.skills-list` only render when `items.length > 0`, so the test has to wait for `/api/knowledge` before asserting) and the nav keyboard test (global `keydown` listener attaches inside `useEffect`, so the first press has to retry via `toPass()` until hydration commits).

**Skip-on-infra, not retry-on-infra.** When a test fails for an infrastructure reason the product owner shouldn't debug — rate-limit 429, exhausted seed data, unreachable LLM — skip the test with a specific reason string rather than retrying or weakening the assertion. A `skipIfMockMode()` helper that reads the "API unreachable" banner and bails beats a `test.slow()` + retry loop because the next human who reads the output learns the *cause*, not just the fix. Retries hide the signal; skip-with-reason preserves it.

**Run serial against a shared stack. Accept the cost.** The alternative (per-test database reset) is expensive, and the signal-to-noise favor of running against a realistic shared state is high. `workers: 1, fullyParallel: false` — this is a deliberate choice, not a Playwright-defaults oversight. The trade-off: serial suites consume seed rows (the reject test removes proposals), so tests must be idempotent or skip-with-reason when seed is exhausted.

**Config-location is load-bearing.** Playwright resolves config from the runner's CWD. `apps/web/e2e/playwright.config.ts` is never discovered; `apps/web/playwright.config.ts` with `testDir: "./e2e"` is. Whenever a test tool "doesn't find" something, suspect the path resolver before the config contents.

**The final target is 100% green — but "skipped for a reason" is green.** Final suite state: 98 passed / 0 failed / 6 skipped. Every skip has a reason string visible in the test output, and each reason points to a documented infra constraint (mock-mode rate-limit fallback, exhausted seed after prior resolve runs). That's a useful test run — not a hidden failure. A suite with 104 green and flaky retries is worse than a suite with 98 green and explicit skips, because the first lies about what it proved.

---

## 5g. Production-waves method (2026-04-22, latest)

"Make the platform production-ready" is too coarse to act on. Split into three waves with sharp gates, and commit each one independently.

**Wave 1 — safe to expose.** A VM on the public internet needs: TLS (auto, so you don't touch it), liveness + readiness probes (so the orchestrator knows when to route), a DNS-preflight in the deploy script (so you fail fast instead of debugging ACME), and a refusal to run the dev-auth shim in `NODE_ENV=production` unless an explicit VPN-only escape hatch is set. Everything in Wave 1 is about *not being embarrassing* the first time someone scans the IP.

**Wave 2 — durable.** Now the goal is "survives one bad thing at a time". Rate-limit per cluster, not per replica (Redis adapter behind the same async `Store` interface so in-memory dev stays frictionless). Structured errors leave the box (Sentry, lazy-loaded so the dep is zero-cost when unused). Nightly DB dumps land on disk. Next 16 proxy rewrite — async + always-Node — so cold starts don't crash on the first rate-limit check. Note: Wave 2 is not "multi-region HA"; that's Phase Z material. Wave 2 is "one replica, one region, 99% expected uptime."

**Wave 3 — regulated.** Admin role + per-action audit + GDPR erase are not nice-to-haves; they're regulatory table stakes for any deploy that ingests user-identifiable knowledge. The audit log is append-only by contract (nobody deletes, even the admin); the erase path retains audit rows by design. Secret redaction is recursive with a depth cap — shallow redaction misses nested payloads, unbounded redaction DoSes itself on cyclic objects.

**The waves are sequential, and you feel the order.** Wave 2 without Wave 1 is "durably serving dev-auth to the whole internet". Wave 3 without Wave 2 is "auditing the minute before the rate-limit ran out of memory". Each wave unlocks the next — don't front-load admin features onto a stack that can't survive the first traffic spike.

**Commit per wave, not per feature.** `feat(prod): Wave 1 — safe to expose` is reviewable. "Add Caddy" + "add healthz" + "add readyz" + "add token TTL" + "refuse dev shim" as five separate PRs forces the reviewer to hold the wave's intent across all of them. The wave is the unit of meaningful change.

**Docs land with the code.** STATUS gets the milestone table row; KNOWN_ISSUES gets the newly-unblocked entries struck through and new ones documented as they show up; GUIDELINES gets the new patterns (redaction depth, audit action union, dev-shim refusal); RUNBOOK gets the new recovery playbooks (restore from backup, revoke a token, erase a user). A wave without a doc commit is a wave the next person doesn't know exists.

---

## 5f. Phase-Y provider-agnostic method (2026-04-22, later)

After Phase V landed a stable deploy, the first live-loop test immediately exposed that our embedding provider choice mattered much more than the docs suggested. The approach we used for swapping embedding providers ended up generalizing well.

**One env var, three tested combos, zero code deltas.** `EMBEDDING_BASE_URL` is the hinge. Gemini, DashScope Qwen3, and OpenAI all reached working retrieval during Phase Y by flipping that one variable plus the associated key + model name. The OpenAI SDK's base-URL override is what makes this cheap; every OpenAI-compatible embedding endpoint we've tried — Gemini's `/v1beta/openai/embeddings`, DashScope's `/compatible-mode/v1/embeddings`, OpenAI's native `/v1/embeddings` — speaks the same wire shape.

**The key-fallback chain names providers explicitly.** `EMBEDDING_API_KEY → GOOGLE_GEMINI_API_KEY → OPENAI_API_KEY → ANTHROPIC_API_KEY`. When a user provisions a single named key (e.g. `GOOGLE_GEMINI_API_KEY` from AI Studio), we pick it up without them re-declaring it under a generic name. This is the difference between a "configurable" system and a "works out of the box" one. Adding a new named provider is one line.

**Dimensions is the one non-flexible dependency.** Our pgvector column is `vector(1536)`; every new provider has to either default to that or accept a `dimensions` request parameter that we honor. Providers that ignore the parameter silently return wrong-length vectors and pgvector inserts fail — loud at the DB layer, silent at the retrieval layer. Check the provider's docs for `dimensions` support before adding it to `.env.example`.

**Pre-existing bugs surface only under real traffic.** The `SELECT *` → `vector` deserialization crash in `kra.ts::fetchCandidates` had been in the codebase for the entire project. It was invisible because no row had ever had an embedding populated until Phase Y's first successful backfill. The lesson: integration tests that exercise the full data shape, not just smoke tests that check HTTP status, catch these. We'll add retrieval-with-embeddings to the core test suite in the next wave.

**Honest about what's tested vs. what's plumbed.** Gemini + DashScope + OpenAI are tested combinations. Claims that "any OpenAI-compatible endpoint works" hold to the extent that the provider matches the three known tests; a new provider should be verified with `scripts/test-embedding-loop.sh` (runs four checks: direct embedding call, `/api/knowledge/retrieve`, `/api/oracle/stream`, and null-embedding backfill) before being promoted to recommended.

---

## 5e. Phase-V deploy-validation method (2026-04-22)

Between a working local dev loop and "the container actually starts on a fresh machine" lies twelve failed Docker builds. The method we used to converge:

**Run it. Read the exact error. Fix that error only.** Not "this whole class of errors" — just the one in front of you. Twelve builds each resolved one specific thing: pnpm's hardlinked Prisma stubs, Next's page-data Prisma init, OpenSSL binary mismatch, `tsx` hoist path, cross-package tsc resolution, Buildkit missing-`public/` checksum, stale bootstrap profile image. Bundling fixes would have obscured which change broke what.

**Test with the actual credentials you'll ship with.** I wasted three build cycles debugging why `embedding-3` was "Unknown Model" before realising the user's token was scoped to chat-only on a different subdomain. The API that rejects your key reveals its shape through the error message — read it first, don't re-guess model codes.

**The stack has load-bearing details at every layer.** Before Phase V I would have called Prisma "just an ORM," pnpm "just a package manager," and Docker "just a runtime." They're not. Each has opinions — pnpm about store mutability, Prisma about engine paths, Next about page-data eagerness, OpenSSL version-matched binaries. A deploy pipeline that ignores any one of those opinions produces opaque failures where the stack trace blames the wrong layer.

**Document each trap the day you fall into it.** KNOWN_ISSUES.md §"Resolved / newly documented 2026-04-22" lists every landmine. Without that log the next deploy on the next machine relearns everything. The index is worth the five lines of prose each row takes.

**Tools that escape their workspace pay for it.** `pnpm exec tsx` assumes a workspace package.json exists at CWD; copying only the app dir into the runtime image breaks that assumption. The fix (absolute path to the hoisted binary) is uglier than the standard invocation but explicit — the right trade under Docker, where "convenient in dev" is usually the source of the next failure.

**Test the happy path after every fix, not before the last one.** Each of twelve builds ran the full smoke test (not just "does the image build"). 15/15 GUI routes + MCP HTTP + token lifecycle passed long before Oracle did. If we had waited for Oracle to work to declare progress, we'd have learned nothing about the six unrelated bugs in the stack beneath it.

---

## 5d. Phase-T MVP-demo method (2026-04-21)

When the platform is technically sound but no colleague has tried it yet, the gap is almost never more capability. It's **the shortest loop from install to feel**. The Phase-T wave pivoted from hardening to demo readiness with these principles:

**Optimize the first ten minutes.** A colleague on first contact spends their attention on: can I sign in? where do I get credentials? is there anything to look at? Onboarding, MCP-token creation, and a narrative seed all landed in one wave precisely because each is worthless without the other two.

**Dual-mode auth over maximal auth.** NextAuth v5 ships alongside the dev shim, not instead of it. Set three env vars → GitHub OAuth. Leave them empty → dev single-user. Same binary, both paths work. Lets the colleague pull the repo and `./scripts/dev-up.sh` without first registering a GitHub OAuth app.

**Narrative seed over random seed.** 8 knowledge items with made-up triggers don't sell the loop. 15 items built around "Alex shipped a Stripe checkout over three weeks" shows that KEA output looks plausible for a real engineer. The graph edges between items matter — a related_to link from `stripe-webhook-raw-body` to `stripe-idempotency` is the demo; two disconnected rows is not.

**Ship the honest limits alongside the feature.** The deploy doc's "Known limits of the MVP deploy" section is load-bearing: dev-auth shim open to anyone on the host, in-memory rate limit, no TLS. Colleagues will find these in 30 seconds; telling them first buys trust.

**Provider-neutral where cheap.** `ANTHROPIC_BASE_URL` lets Oracle run against any Anthropic-compatible provider (Z.ai GLM, Bedrock, Vertex) with one env var and zero new code paths. The Z.ai integration is a deploy-time decision, not a code change.

---

## 5c. Phase-1 hardening method (2026-04-21)

When the wiring is green but KNOWN_ISSUES is still heavy, the approach is:

**Read KNOWN_ISSUES as a prioritized queue, not a footnote.** Every entry is a promise to future-self. Pick the ones that are unblocked (no schema migration, no external decision) and batch them into a single wave.

**One commit per wave, not per item.** A wave is a coherent story — "streaming everywhere we wait on a model" or "policy layer on /api/*". Commits that bundle an SSE endpoint, its consumer hook, and the state-machine changes together are easier to review than six tiny PRs that require the reviewer to hold the whole system in their head.

**Write the escape valve before the new path.** When upgrading session search to FTS, keep the ILIKE fallback so pre-migration DBs still work. When adding an HTTP transport, keep stdio as default. When enforcing immutability, make the fork path the happy case. Every hardening change that *removes* a capability from the caller's contract needs a migration ramp.

**Self-audit after every wave.** After declaring "done", list five ways the wave is still wrong. Fix the cheapest two immediately; add the other three to KNOWN_ISSUES with a concrete next step. Honesty is cheaper than rediscovery.

**Doc-then-commit, not commit-then-doc.** STATUS / KNOWN_ISSUES / ROADMAP / the surface-specific doc (e.g. NAVIGATION) update in the same commit as the code. If a follow-up doc commit is needed, the first commit was lying about what "done" looks like.

---

## 6. Cadence

| Activity | Frequency |
|---|---|
| Retrieval benchmark run | before any KRA change, weekly in CI |
| KEA quality spot-check (50 sessions) | weekly |
| SQS trend review | weekly |
| Knowledge health snapshot | weekly (automated) |
| Invariant audit | monthly, or before any cross-cutting refactor |
| Research re-read | quarterly — the docs evolve, so does our understanding |

---

## 5p. AI-readable logs (2026-04-24)

An AI agent is eventually going to read our production logs without access to this repo. Optimize for that reader from day one. Three properties, in order of leverage:

**1. Stable codes beat prose.** Every error log line carries `err.code` (machine-readable, SCREAMING_SNAKE_CASE) and `err.category` (one of 10 fixed buckets). Prose messages drift and get translated; codes don't. An agent scanning a 10-million-line log pipeline filters on `err.code=EMBEDDING_ALL_PROVIDERS_FAILED` in microseconds; it can't filter on *"All embedding providers failed."* without false positives. `BrainError` enforces the shape at the type system level so a contributor can't throw a free-form string at a boundary even if they want to.

**2. The fix hint lives in the log.** `err.remediation` is a short, imperative sentence pointing the reader at the exact next step ("set GOOGLE_GEMINI_API_KEY in .env", "dedupe before insert", "check provider quotas"). That field does two jobs: it trains future agents on what "fixable" looks like here, and it lets an incident responder skip the read-the-code-to-find-the-cause loop. The remediation is not the error message — the error message describes *what* happened; the remediation describes *what to do*.

**3. Correlate with one stamp.** `requestId` flows via AsyncLocalStorage through every nested `log.*()` inside a `withRequest(...)` scope, and the request helper echoes it as `x-request-id` on the HTTP response. An agent that sees a failure can pull the exact line set — auth rejection → DB query → embedding fallback → final throw — by grepping one id. No tracing product required. When the platform does adopt one, `requestId` is the join key.

**Why this matters for the platform specifically.** We're a tool used *by* AI agents. Our failure modes will be read back *by* AI agents more than by humans. Optimizing logs for human pattern-recognition (colors, ASCII art, truncated stacks) penalizes our primary debugger. The JSON shape we emit — `{level, time, service, requestId, op, durMs, outcome, err:{code, category, message, remediation, retryable, stackHead, cause}}` — is the human-adjacent, AI-first compromise.

**Secrets are a first-class concern in this channel.** `redactFields()` scrubs recursively with a depth cap (bounded work on cyclic objects), matches keys case-insensitively, and is applied by `captureError`, the Sentry `beforeSend`, and the audit-log writer. A secret can still escape through a string message — a contributor who writes `throw new Error(\`bad token ${token}\`)` has defeated the contract. The fix is not more redaction; the fix is review discipline (plus: `log.error({err})` always beats `log.error(\`${err.message}\`)`).

---

## 5s. Ship the simplest auth that lets the pilot run (2026-04-24, credentials mode)

The phase-1 pilot hit a real wall: the operator wanted to demo the Brain on a public IP, the existing sign-in required a GitHub OAuth App (with DNS + callback-URL configuration), and the fallback dev-shim was silently serving Alex to every anonymous caller. The textbook answer — "set up GitHub OAuth properly" — would have been a 2-hour detour before the operator could prove the Brain works for them.

The shipped answer was a NextAuth Credentials provider with a single admin account in `.env`. 200 lines of new code, one new dependency (`bcryptjs`), no new infrastructure. `/signin` renders a username + password form; the bcrypt verifier is constant-time and cost-12 rate-limited at the CPU layer; rotation is a `.env` edit plus a restart. GitHub OAuth stays wired and coexists — when the pilot expands to multiple users, the OAuth button appears next to the credentials form with no code change.

Three disciplines:

**1. The auth decision has a shape the pilot can explain.** "One operator, one account, one box" is an honest description of phase 1. The feature matches the scope. A per-user RBAC system with invites + password resets + MFA is a richer feature — and it would have delayed the demo by weeks. Ship the honest shape.

**2. Provider coexistence is cheap. Exclusivity is expensive.** NextAuth's `providers` array takes a list. Both Credentials (configured on ADMIN_*) and GitHub (configured on AUTH_GITHUB_*) register independently. Re-enabling GitHub later is an env edit, not a code change. Avoid "remove the old path to add the new path" when you can "add the new path next to the old one."

**3. A bootstrap password printed to stdout once is not a crisis.** The deploy script generated a 20-char random password, hashed it (bcrypt cost 12), wrote the hash to `.env.local`, and printed the plaintext once. The operator has to save it or they can't sign in — which is exactly the right forcing function. Rotation via `pnpm hash-admin-password '<new>'` is a one-line change.

Anti-pattern avoided: storing the plaintext password in `.env`. The hash is marginal work for the operator (one CLI call) and materially better for leak scenarios (offline brute-force at ~5/sec/core vs "whoever opens the file has the password").

---

## 5r. Audit your audit (2026-04-24, lockdown script false-PASS)

`scripts/verify-lockdown.sh` existed *specifically* so every deploy would get an automated "is this thing gated?" answer. It reported PASS on the legacy host for weeks. A direct `curl` against the MCP endpoint, sent via a parallel build on a second host and triggering the legacy host improvements pass, returned HTTP 200 with `serverInfo` on an unauthenticated `initialize` call. Both statements were true simultaneously.

The reason: the script was sending the probe WITHOUT `Accept: application/json, text/event-stream`, and the MCP server was rejecting the request at content negotiation (406) **before auth could run**. The script was testing content negotiation, not auth. PASS was a lie told by accident.

Three disciplines follow:

**1. A security-test script is code that needs code review.** Treat the audit the same way you'd treat the feature it audits. `verify-lockdown.sh` sends a probe, checks an HTTP code, reports PASS/FAIL — three steps, any of which can be wrong. The probe's request shape matters as much as the target behaviour. Review the probe against the spec of what it's trying to audit.

**2. PASS from one tool is one data point, not proof.** The remediation here wasn't "trust the script more"; it was "add a second probe using the real-client shape, and report BOTH honestly." Two probes that agree is a higher-confidence PASS than one that's overly strict. Every lockdown check worth running is worth running in at least two shapes.

**3. The lie compounds.** Because `verify-lockdown.sh` was called at the end of every `./scripts/deploy.sh`, every deploy banner said "locked correctly" — so every operator looked at the green check and moved on. The fix included emitting an advisory WARN on the `initialize` leak (even though it's spec-permitted), because a silent PASS on a spec-permitted-but-policy-undecided behavior is how "we meant to check that" rots into "nobody remembers what that check did."

**Related discipline (same session): The "declared-but-empty config" trap.** `.env.local` on the same host had `AUTH_GITHUB_ID=""` with `ALLOW_DEV_AUTH=true`. The operator saw the key name in the file and thought OAuth was configured; the runtime saw an empty string, took the dev-shim path, and served Alex-seeded knowledge to every anonymous caller. A config check that only verifies "key is present" is a false-PASS generator too — it must also verify "key has a non-empty value AND no conflicting toggle is active." This is the same lesson in a different skin: an audit that checks a proxy for the property instead of the property itself is worse than no audit, because it manufactures confidence.

---

## 5q. Measure before you claim (2026-04-24, deploy-speedup validation)

A commit shipped "incremental docker rebuilds drop from ~30 min to ~5 min" as the headline claim of a cache-mount change. After the change landed, a direct back-to-back measurement on the legacy host found the real number: **3 min 9 s → 2 min 29 s** for warm-to-warm, with webpack compile dropping 112 s → 40 s (a real 64% win on the tall pole). The 30-min baseline was accurate — for the *first-ever* build on a cold machine with no BuildKit builder, which was the exact state when the user ran `./scripts/deploy.sh` the first time. But for any subsequent run, the Docker layer cache was already doing most of the work the commit message credited to BuildKit mounts.

Three disciplines follow:

**1. The original claim wasn't *wrong*; it was *ambiguous*.** "30 → 5 min" conflates three distinct scenarios — cold-cold (first build ever), warm-cold (hot layers, cold BuildKit mount), warm-warm (incremental). The fix is always to state which scenario you're measuring, every time. Measurement tables in docs beat adjectives.

**2. Run the experiment you'd want a reader to be able to run.** The validation was a back-to-back `docker buildx build --target web` with a one-line no-op source change between runs. That's scriptable; it's reproducible; it's the same command the operator would type. A "benchmark" that needs custom tooling gets skipped; a command already in the operator's muscle memory doesn't.

**3. Update the doc in the next commit, not the next release.** The "30 → 5 min" prose now lives immutably in the commit message for `abd0caa`. `deploy/DEPLOY.md §"Build speed"` was updated in the very next commit with the measured table. A reader browsing docs sees the corrected number; a reader running `git log -p` sees the history and the correction. Neither is misled.

**Methodology artifact.** When this kind of validation surprises us, both the measurement and the measurement process go in STATUS/GUIDELINES/KNOWN_ISSUES — not just the new number. Next time webpack is the bottleneck, the next contributor finds the measurement pattern and the honest table together. That pattern compounds into lower future debugging cost; a one-line "we measured it" note does not.

---

## 5t. Hostnames must match user-facing URLs — the AUTH_URL and action-gate trap (2026-04-25)

When the dev Brain (then the legacy host) got its public hostname (`brain-dev.example.com`), the Brain started serving correctly over HTTPS — but sign-in redirected users to `http://localhost:3000` after authentication. The cause: `.env.example` shipped `AUTH_URL="http://localhost:3000"` as the default, and operators who copied it to a remote VM had `trustHost: true` set in `apps/web/auth.ts`. That option sounds like it should handle arbitrary hosts. It doesn't override an explicit `AUTH_URL`. The app happily authenticates and then sends the callback to localhost.

**Rule: every identity env that embeds an origin (`AUTH_URL`, OAuth callback URLs, `NEXTAUTH_URL`) must be set to the exact origin users hit.** There is no "infer it at runtime" escape hatch that works correctly across local dev, bare-IP test, and TLS-domain prod. The operator must set it. The doc must say so loudly at the point of definition — a comment three lines away is not enough. `.env.example` now has an inline warning next to `AUTH_URL` listing the three real choices.

The same principle applies to action-gates in deploy scripts. `scripts/deploy.sh` step 5 originally gated the embedding-backfill call on `OPENAI_API_KEY` only. The runtime embedding chain in `packages/core/src/embedding.ts` had supported Gemini as the preferred provider for months. The gate and the chain were out of sync. Result: operators with a Gemini-only `.env` saw `Skipping embedding backfill: OPENAI_API_KEY unset` and had to run a manual bootstrap step to get their seeded Knowledge embedded. The gate was checking a historical default, not the current capability.

**Corollary: action-gates in deploy scripts must enumerate the same set of keys the runtime chain supports.** A gate that checks only `OPENAI_API_KEY` when the chain also accepts `GOOGLE_GEMINI_API_KEY` is the "configurable but doesn't work out of the box" trap (see §5f) applied to operations instead of providers. Every time the runtime chain gains a new key, update the gate in the same PR.

Both issues share a root: the deploy-time configuration (env defaults, action-gates) had not been kept in sync with the runtime behavior. Hostname handling drifted from the `AUTH_URL` doc; the embedding gate drifted from the key-resolution chain. The fix in both cases is the same: the surface that the operator touches (`.env.example`, deploy script) must reflect the surface that the runtime uses, updated in the same PR.

---

## 5u. Migration paths over hard cutovers (2026-04-26, token rotation)

Configuration changes that affect long-lived sessions — auth tokens, signed cookies, MCP transport credentials — cannot be swapped atomically from the client's perspective. The only safe instantaneous swap is "accept downtime while you update every client." In practice, downtime is not acceptable for an MCP tool that an AI agent may be using mid-session. The correct pattern is an **overlap window**: a period during which both the old and the new credential authenticate, giving clients time to migrate.

This is not a new idea. The AUTH_URL gotcha (`§5t`) is a negative example: `AUTH_URL` embedded a hard-coded origin that the operator had to set exactly right before the first sign-in, with no overlap — a misconfiguration produced an instant breakage, not a degraded state the operator could discover and correct incrementally. The embedding-key gate parity fix (deploy-script action-gate out of sync with the runtime key chain) is a structural version of the same problem: the gate checked `OPENAI_API_KEY`, but the chain had already been extended to prefer `GOOGLE_GEMINI_API_KEY`. There was no "both work" window — either the operator knew to set the right key, or the deploy silently skipped backfill.

Token rotation is the concrete realization of the overlap principle. `POST /api/tokens/:id/rotate` mints a fresh token and schedules the old one for deferred revocation after a configurable grace window (0 h to 7 d). During the window both tokens authenticate. The auth gate enforces the window boundary instantly when it expires (`scheduledRevokeAt <= NOW()` check in `apps/mcp-server/src/auth.ts`); the worker tick is a cleanup backstop. This design means: the operator can rotate a token, push the new value to `~/.claude/mcp.json`, verify the new token works, and only then watch the old one expire — rather than facing an irreversible cutover where a misconfigured client is immediately locked out.

**Rule:** when designing any change that affects long-lived session credentials or transport configuration, first ask whether an overlap window is cheap to provide. If it is, provide it. The cost of implementing a grace period is usually one nullable timestamp column and a modified auth check — less than an hour of engineering. The cost of not having it is every client that was mid-session at cutover time, plus the support round-trip to figure out why connections dropped.

---

## 5al. The delete-then-restore cycle — aggressive simplification, then listen (2026-05-25 → 2026-05-26, i18n TH/DE restored)

§5ai codified validate-then-aggregate: ship the smallest viable surface,
observe the signal, then decide whether the larger surface earns its
keep. The i18n cycle is the same discipline applied in reverse — start
from the larger surface, simplify aggressively, and be ready to restore
when the simplification turns out to have removed something real.

In v0.13 the TH and DE dictionaries were deleted. The argument was
honest: most of the strings were stale or AI-generated, no native
speaker had ever swept them, the EN authoritative dictionary was
drifting faster than the others could keep up, and the operator base
on record was English-reading. Simplifying to one language reduced
review surface, removed the "is this translation still current?"
ambient cost, and let every new UI string ship without a three-key
dance.

In v0.14 the languages were restored. The trigger was user feedback —
the actual operator base spans TH and DE, and the deletion broke the
"my Brain talks to me in my language" property that those operators
silently relied on. The restoration kept the simplification's *honest*
parts: AI-generated translations are explicitly flagged in
`KNOWN_ISSUES.md` as "AI-generated, awaiting native sweep" rather
than pretending to be reviewed; new keys ship in all three dictionaries
in the same PR but the agent that drafts TH/DE values does not claim
review.

**Three lessons compound:**

1. **Aggressive simplification is a legitimate move even when it
   turns out to be wrong.** The alternative — never simplifying,
   carrying complexity forever because *somebody* might want it —
   is worse. The cost of the i18n deletion was a single re-import
   PR plus a documented "AI-generated" flag; the value was a clear
   audit of what the dictionaries actually contained.

2. **Reversing a simplification is not the same as admitting it was
   wrong.** The restored state is materially better than the
   pre-deletion state: dictionaries are now honestly labeled
   (`AI-generated`), the review-debt is tracked in KNOWN_ISSUES
   instead of being invisible, and the per-key contract (counts
   in substitutions, never literals — see §5y) survived the round
   trip. Simplify → observe → restore-with-improvements is a valid
   loop. Stubborn defence of either pole is not.

3. **User-reality beats author-reality.** I genuinely believed,
   from the data I had, that EN-only was the right call. The data
   was incomplete — operator language preference isn't logged, so
   "no signal" looked like "no need." The user knew their own
   operator base better than the metrics did. **Default to listening
   when user-reality and author-reality disagree about *what users
   need*; the user usually wins.** (Author-reality wins on
   *how to build it* — that's where taste and architecture live.)

**Rule:** when you simplify aggressively, ship the simplification
with an explicit "if this turns out to be wrong, the reversal looks
like X" note in the PR or docs. The cost of pre-thinking the reversal
is small; the cost of treating every simplification as irreversible
is months of stubbornness when the signal arrives.

---

## 5at. Translate before you decorate — finishing the i18n surface at `/docs` (2026-06-21, #59)

`/docs` was the last unauth surface without the locale picker. The
naive "fix" is obvious: drop `<LocalePicker>` into the docs layout and
close the issue. That is exactly the **class-1 "decorative state"
anti-pattern** from §5af — a control that visibly does nothing. The
docs *body* (`docs-content.ts`) was EN-only, so a picker there would
switch the chrome language while nine pages of prose stayed English.
The issue's own ordering encoded the rule: **(1) translate the
content, then (2) add the picker.** Shipping (2) before (1) doesn't
half-solve the issue — it manufactures the bug the issue exists to
prevent.

Three method points compounded:

1. **The honest first answer was "not yet."** On the first pass the
   right call was to *leave the issue open* with a triage comment
   explaining the block, rather than fake-close it with a picker over
   English text. An open issue that says why beats a green checkmark
   over a dead button. Only when the operator explicitly accepted
   AI-translations-with-native-followup did (1) become actionable.

2. **Long-form content wants a different i18n shape than UI strings.**
   The dictionary (`useT()` / `translate()`) is right for short labels;
   it's wrong for multi-paragraph prose. Docs translate as **parallel
   `DocPage` data** (`DOCS_TH` / `DOCS_DE`) resolved by
   `getDoc(lang, slug)` with a **per-slug EN fallback** — so a missing
   or retracted translation degrades to English, never a 404 or a raw
   key. The fallback also *is* the reversal plan (§5al's rule): delete
   a localized page and it silently reverts to EN.

3. **Server-cookie i18n and a client picker disagree about *when*.**
   The rest of the app resolves locale server-side from the `bp_lang`
   cookie, but `setLang` deliberately does **not** `router.refresh()`
   (that would re-run every dashboard fetch). A server-rendered docs
   body would therefore ignore the picker until a reload. The fix was
   to render the docs body as **client components** (`useLang()`): they
   still SSR in the cookie locale via `LangProvider`, but the picker
   re-renders them in place. Match the rendering strategy to the
   interaction you promised — instant switch ⇒ client read of the same
   context the picker writes.

The AI-translated TH/DE prose is flagged in `KNOWN_ISSUES.md` for a
native sweep — same discipline as every other machine-translated block
(§5al): ship it usable, mark it provisional, make the reversal cheap.

---

## 5au-2. Complete native-speaker sweep across document pages & i18n dictionaries (2026-08-09)

Machine-translated copy gets basic keys onto screens, but marketing, concept pages, and contextual UI text require native polish.
Machine translations introduced subtle errors (e.g., translating "last 12 sessions" as "12 สัปดาห์" [12 weeks], using generic Siri-like terms like "ผู้ช่วยอัจฉริยะ" instead of product term "Oracle", or transliterating jargon like "ฟลายวีล" instead of "สุขภาพของสมอง" [Brain health]).

A comprehensive native-speaker pass was performed across `/`, `/start`, `/docs`, `i18n-dict.ts`, and `docs-content.ts`:
1. **Product Terminology Alignment**: Enforced consistent terminology across English, Thai, and German (keeping "Brain", "Oracle", "Skill", "Session", "Proposal" intact and clear).
2. **Contextual Accuracy & Smoothness**: Rewrote awkward literal machine translations into clear, natural, professional developer Thai language.
3. **Docs & Guidelines Synchronization**: Closed the open i18n native-sweep debt items in `docs/KNOWN_ISSUES.md` and updated repository docs accordingly.

---

## 5av. Positioning pivot: from passive memory to self-improving compounding AI intelligence (2026-08-09)

The initial hero headline ("Your AI coding sessions forget everything. This one doesn't.") suffered from commoditization bias. Memory features are now commonplace across AI coding tools (Claude Code, Cursor, ChatGPT memory, Mem0). Pitching passive memory or a generic "second brain" sells storage rather than outcome.

Developers want **AI agents that get 10× smarter, faster, and more aligned over time**.

The positioning was systematically updated across the web app hero sections (`i18n-dict.ts` in EN, TH, DE), `README.md`, and core documentation:
1. **From Passive Storage to Active Extraction**: Highlight that External Brain automatically mines finished sessions to extract structured rules, recipes, anti-patterns, and project decisions.
2. **Self-Improving Flywheel**: Emphasize how Autoskill, decay scores, and execution feedback continuously refine rules — high-payoff rules reinforce while unused ones decay away.
3. **Cross-Tool Compounding Intelligence**: Emphasize that when one agent or engineer solves a bug, every AI tool (Claude Code, Cursor, Windsurf) and teammate inherits the intelligence instantly via MCP.

---

## 5au. Audit before you build; review live where it's free (2026-06-22 → 06-23, v1.9.0/v1.9.1, orientation layer)

A request to "add onboarding, a glossary, tooltips, and example agent
prompts" reads like a from-scratch build. It wasn't: the app already
shipped a five-step first-run modal, the `/welcome` flow, an
`EmptyBrainCallout`, a full localized `/docs` concept system, and
nav-item tooltips. **The first move on any "add X" request to a mature
surface is to inventory what already exists** — the honest gaps here were
narrow: two concept pages (`graph`, `decisions`) whose nav-surface
`HelpPopover` "Read more" links were already pointing at pages that
*didn't exist yet* (dead links shipped earlier), an agent-prompt
cheat-sheet (the one genuinely missing piece — what to *type* to the
agent, mapped to each `brain_*` verb), and a single inline tooltip on the
Skills type filter. Building "onboarding" from zero would have rebuilt
working, tested, deployed UX.

Four method points compounded:

1. **Live anon review caught what CI couldn't.** `/docs` is a public
   surface, so it can be browser-reviewed on the live host *without* a
   throwaway account. That live pass caught a grammar bug — "so knowledge
   *files* under the right project" (a noun where a verb belonged) — that
   typecheck and the Playwright e2e both passed green. The split that
   makes this honest: **public surfaces get a real live browser pass;
   auth-gated surfaces (the dashboard card, the SQS tooltip) get a
   throwaway-account operator checklist**, not a faked signed-in pass.
2. **"Tooltip everything" is an unbounded goal — name it and bound it.**
   The follow-up sweep, on inspection, had almost no targets: connection
   status, scope, confidence, and effectiveness already carried `title=`
   tips or `HelpPopover`s. Adding `InfoDot`s there would have *duplicated*
   existing help and violated quiet-by-default. The audit added exactly
   one inline tooltip (the dashboard `Quality`/SQS number, the lone jargon
   with no explanation). Restraint was the correct output.
3. **One bounded review→fix→re-verify cycle, not an open loop.** "Iterate
   till the review is good" has no exit condition. The committed loop was:
   one build → one structured first-time-user review → fix what it finds →
   re-verify the fix live. The review found one defect; it was fixed and
   re-confirmed live. Done is a state, not a vibe.
4. **Bundling build + validate + release pulls extra deploys; tag first.**
   Because the version label is baked at build time from `git describe`,
   doing the work and *then* deciding to release meant three webpack
   builds (feature, copy-fix, version-label). The cheaper order is the one
   §5aq already implies: settle the change, then **tag before
   `deploy.sh`** so a single build ships a clean label.

---

## 5ak. The AI proposes, the human prioritizes (2026-05-25, ROADMAP-2026-05-25.md)

After the v0.14.0 UI revision landed (Phase R.3), the agent wrote
`docs/ROADMAP-2026-05-25.md` unprompted — an opinionated draft of
what the next 8-12 weeks of platform work should look like, with
ranked priorities, explicit non-goals, and a "things I might be
wrong about" section that invited disagreement. The user read it,
asked clarifying questions, made one structural change, and merged
it. It is now the working roadmap.

This is a pattern worth naming. The agent has a unique vantage:
across a session it sees every PR, every issue, every doc edit,
every benchmark result, every place the user paused or pushed
back. That vantage makes the agent well-positioned to *draft* a
roadmap. The user has a vantage the agent doesn't: the unspoken
constraints (which contributors are available, which pilot is
about to close, which feature has been quietly demanded by a
funder), the strategic horizon, and the willingness to spend the
political capital that some prioritizations cost. That vantage
makes the user the *correct* prioritizer.

**The shape that worked:**

- **The agent writes opinionated, not neutral.** A roadmap that
  says "we could do A or B or C" is useless — it's a list. A
  roadmap that says "I'd do A first because of X, then B because
  A unblocks it, and skip C because I think it's a trap for
  reason Y" is a starting point. The user can disagree with any
  bullet and the disagreement is productive.
- **The agent flags its own uncertainty.** A "things I might be
  wrong about" section at the bottom names the load-bearing
  assumptions (e.g. "I am assuming the pilot lands in June; if
  it slips to August, swap items 3 and 5"). The user can correct
  the assumption rather than the conclusion.
- **The user prioritizes with full authority, no debate-club.**
  Merging the roadmap is not endorsement of every bullet — it's
  endorsement of "this is the working draft we steer against."
  Subsequent changes happen by amending the roadmap, not by
  re-arguing the original.

**Rule:** when the agent has accumulated enough context to have
an opinion on direction — typically after a multi-PR sweep or a
release — it is appropriate (encouraged) for the agent to write
that opinion as a roadmap draft, explicitly inviting the user to
override. The agent does not get to *set* priorities; it gets to
*propose* them. Distinguishing those two cleanly is what makes
this collaboration mode work without either side overreaching.

---

## 5aj. Subagent-driven development at scale (2026-05-25, v0.14.0 UI revision)

The v0.14.0 UI revision applied `docs/DESIGN_PRINCIPLES.md` across
the dashboard plus six destination pages in a single coordinated
sweep. The execution model was parallel-subagent dispatch with
strict file-ownership boundaries: one subagent per surface, each
owning a disjoint set of files, dispatched in waves so that
within a wave no two subagents could possibly touch the same
file. ~14 subagent dispatches landed across two days with zero
merge conflicts.

The pattern that made it work — and the limits where it doesn't:

**When to dispatch parallel subagents.**

- **Independent file boundaries are provable.** Each subagent's
  file-ownership list is enumerated explicitly and verified to
  not overlap with any other in-flight subagent. The boundary
  is the contract: a subagent that strays outside it is a bug,
  not a creative liberty.
- **The change is locally scoped.** "Apply principle X to surface
  Y" parallelizes well because the principle is shared but the
  surface is owned. "Refactor the type system across all
  packages" does not, because the type changes propagate.
- **The shape of "done" is checkable per-surface.** A subagent
  finishes when its surface satisfies the principle; another
  subagent finishes when *its* surface satisfies the principle.
  No subagent needs to wait for another to declare completion.

**When not to dispatch parallel subagents.**

- **Cross-cutting refactors** (type-system changes, schema
  migrations, dependency bumps) where the right answer in one
  file constrains the right answer in another. Sequential is
  faster than coordinating mid-flight.
- **Decisions that need taste.** "What should this empty state
  *say*?" benefits from one author holding the whole product
  voice. Parallel subagents tend to produce locally-correct,
  globally-inconsistent copy — the vocabulary discipline from
  §5ag breaks down across dispatches.
- **Anything that touches shared state mid-flight.** Migrations,
  seed changes, lockfile updates, shared component edits —
  serialize these or risk one subagent's work invalidating
  another's.

**The mechanics that prevented merge conflicts:**

1. **One feature branch per cascade, multiple subagents commit
   to it.** Each subagent owns its files but commits to the
   same branch; the lack of overlap means the commits stack
   cleanly without rebase pain.
2. **A coordinator agent partitions the work upfront** — names
   each subagent, its file list, its scope of authority — and
   then dispatches in parallel. Subagents do not negotiate
   boundaries with each other; the coordinator owns the
   partition.
3. **`git status --short` is the post-completion contract.**
   Every subagent's last act is to verify it only touched
   files in its declared scope. A surprise file in `git status`
   is a defect, regardless of whether the change is good.

**Rule:** for any sweep that touches ≥4 surfaces with the same
principle applied locally, prefer parallel-subagent dispatch over
sequential execution. The coordination cost (writing the partition
upfront, naming the boundaries) is a fixed ~15 min; the wall-clock
saving scales with the number of surfaces. For anything cross-cutting,
do not dispatch in parallel — the merge cost will exceed the
parallelism gain. The doc cascade landing alongside this section is
a smaller example of the same pattern: README, KNOWLEDGE, KNOWN_ISSUES,
HOW_IT_WORKS, MCP_TOOLS, STATUS, GUIDELINES, APPROACH each owned by
exactly one subagent, no two subagents writing to the same file.

---

## 5ai. The validate-then-aggregate cycle closed (2026-05-24, an early PR)

§5ah's corollary said: ship the per-session view first, observe whether
it gets opened, then decide if the project-level aggregate earns its
keep. An early PR shipped the per-session view on 2026-05-23. By 2026-05-24
the signal was clear enough — the user explicitly asked for the
project-level companion in-session ("I expect to see the list of
projects and sessions easily; when I click, I want to see what brain
gains and what I got") — and an early PR landed it.

The shape that survived:

- **Same component contract on both axes.** `SessionDetailPanel` and
  `ProjectDetailPanel` are two-column "what helped you / what you
  taught the brain" panels with the same color accents, the same row
  layout, the same "+N more" truncation. A user who learned to read
  one reads the other without re-onboarding.
- **One endpoint pattern, two granularities.** `GET /api/sessions/:id`
  returns raw application rows; `GET /api/projects/:id` returns the
  same shape aggregated by `(knowledge.id, role)` with a `hitCount`
  + `lastAppliedAt` per row. No new index, no new database load
  pattern — the project version is just a fan-out over the session
  index that was already hot.
- **Earned surface area gating the aggregate.** `ProjectsList` returns
  `null` for zero projects, a one-row treatment for exactly one, and
  the full clickable list for ≥2. Single-project users don't see a
  list of one; zero-project users don't see a list placeholder.

The principle worth keeping past this PR: **an aggregate earns the
right to ship by virtue of its underlying signal landing first, not
by virtue of being plausibly useful.** It's cheap to build an
aggregate; the cost is the second surface to maintain when the first
turned out to be unused. The order matters: per-session first, then
per-project after the per-session view's signal is real. Reversing
that order is how you ship two surfaces and observe neither.

A small but load-bearing UI re-order also landed: the "Right now"
section (`LiveExtraction` + `PendingProposals`) moved *below* the
new Projects and Recent work sections on the dashboard. System
chatter is secondary to user value — see `docs/DESIGN_PRINCIPLES.md
§3` (quiet by default).

---

## 5ah. AI-self-validatable PRs — the `e2e-please` loop (2026-05-23)

The newcomer-eye sweeps (v0.12.2 → v0.12.4) shipped 50+ UX iterations
across six PRs. Every one of them landed green via CI typecheck/test/
build/fresh-DB migrate. The catch: the harness running the AI had no
`pnpm` and no browser, so for every UI-only change the loop reduced to
*edit → commit → CI passes types → merge*. The deploy + e2e half of
"review, test, debug, improve" was unreachable; UI defects whose only
symptom is "renders wrong" couldn't surface until after merge.

The fix is small and structural, not behavioral. Two changes together
close the gap:

1. **The `e2e-please` label on `.github/workflows/e2e-deployed.yml`.**
   Workflow gains a `pull_request` trigger gated on the label via an
   `if:` expression. Default PR cadence is unchanged (label absent →
   job short-circuits), but any UI-touching PR can opt itself in by
   adding the label, and the deployed-brain Playwright suite runs as
   a status check alongside CI. The label is safe for any author —
   no operator permission needed.

2. **The "honest test plans" norm in `AGENTS.md`.** A PR description's
   "Test plan" section is a contract, not a wish-list. Checks the
   author actually performed get ✅ with specifics ("CI passed
   typecheck/test/build/fresh-DB migrate"); checks the reviewer
   should perform get ⬜ unchecked with "(agent could not run
   locally)". Pre-norm, agent PRs had bullet lists that *read* like
   performed checks but were actually wish-lists — the reader
   couldn't tell which without re-running everything.

The first run of the new label on an early PR found a real bug:
`e2e/security.spec.ts` had hardcoded `http://localhost:3100/mcp`
in two MCP-unauth tests, which silently failed against the deployed
dev brain for an unknown number of weeks before the label-triggered
run made it visible. Exactly the failure class the change was
designed to surface.

**Rule:** for UI/UX, auth-flow, or any public-surface change, add
the `e2e-please` label on PR open. Skip the label for pure refactors,
doc-only edits, or work fully covered by unit tests. Don't claim
"verified" in a PR body without either a CI artifact, a screenshot,
or an explicit "(agent could not run locally)" caveat.

**Corollary: validate-before-aggregate.** The same session that
shipped this loop change also added a per-session value drill-down
(`GET /api/sessions/:id` + `SessionDetailPanel`, an early PR). A
project-level value summary card on the Dashboard was deliberately
deferred — the cost of building it is low, but the cost of building
*and then realizing the per-session view isn't getting opened* is
two surfaces to maintain instead of one. Aggregates only earn their
keep after the individual signal is proven; until then, the smaller
surface is the validation instrument.

---

## 5ag. Vocabulary drift is the third newcomer-eye finding class (2026-05-20)

After §5af codified the first two patterns (decorative state, leaked
identifiers), a fourth round (iter 31-40, an early PR) found the third:
**the same concept named differently across surfaces.**

Examples this round caught:
- "Skills" (route, page heading, dashboard card) but "knowledge"
  (loading state, graph empty title) for the same thing
- "Autoskill" (route nav label) but "Skill proposals" (page heading)
  for the same surface
- "Teach" (topbar button) — opaque verb without object; what does it
  teach what?
- "Oracle" (brand-style route name) without a tagline saying it's a
  Q&A surface

The fix in each case was a *naming* change, not a code change. But
the discipline that produced the issue list is the same: walk every
surface as a first-time visitor and ask "did this word appear
somewhere else meaning something different, or the same thing
spelled differently?"

**The output of this round was a permanent /docs/concepts/vocabulary
page** that locks the five user-facing terms (Brain, Skill, Session,
Oracle, Proposal) and explains the advanced acronyms (KEA, KRA, MCP,
SQS) operators occasionally see. New devs and new users have one
glossary to read before touching the UI; copywriters have one source
of truth for which word to use where.

**Rule:** the third question for the newcomer-eye walk is "what
word do I use for this concept across the whole app?". One concept
→ one word, used consistently across nav, headings, captions,
tooltips, error messages, and docs. The platform glossary in
`/docs/concepts/vocabulary` is the locked reference; anywhere a
different word appears, that's drift to fix.

---

## 5af. The newcomer-eye discipline — three iteration loops, 30 fixes (2026-05-17 → 2026-05-19)

A 30-iteration sweep across early PRs demonstrated that
"the team can use this app" is not the same evaluator as "a first-time
visitor with no AI background can understand this app." Each iteration
re-read one surface as if landing cold and asked of every chip,
caption, badge, breadcrumb, and tooltip: **"what does this mean?"**

The two patterns that repeated:

**Pattern A — decorative state that doesn't move anything.** The
sidebar Scopes section (iter 1) was the canonical example: clicking
Personal/Team/Community updated client-side state but no surface
consumed it. To a first-time user the clicks looked dead. The fix
isn't to wire the state into something — it's to remove the
decoration. Decorative UI that *looks* interactive but isn't is worse
than no UI at all because it teaches the visitor "clicking things in
this app does nothing."

**Pattern B — internal identifiers leaking through.** "sonnet 4.6 ·
medium" (iter 6), "personal-x7tdwb000001/brain-platform" (iter 7),
"session s_6cp3" (iter 12), "ingest_queue · 0 pending" (iter 6),
"ADMIN_USERNAME + ADMIN_PASSWORD_HASH" in the auth error (iter 26) —
the same class of bug repeated five times across two passes. Every
internal field (model id, slug, short id, queue name, env var) that
ships through to a label is a place the newcomer has to translate
themselves. The discipline: when a chip is about to render an
internal value, write a humanizer (`clientLabel()`, friendly org +
project name, "Up to date" instead of "0 pending") *or* hide the
chip entirely.

**Three lessons compound:**

**Walk each surface cold.** Don't open the screen because you're
about to fix something on it — open it because you're a first-time
visitor and report what you don't understand. The 30 issues weren't
buried bugs; they were on every surface, every visit, and would have
been caught the first time anyone unfamiliar walked the app.

**Validate via probes, not just typecheck.** Iter 6 changed
`oracle.model` from "sonnet 4.6 · medium" to "Powered by Claude".
The typecheck passes either way. The validation that the new label
shipped was a `curl signin | grep -c "sonnet 4.6"` returning `0`.
Every iteration of this sweep paired the code change with a probe
that asserts the *user-facing* change, not just the source-code
change.

**Three-pass cadence.** The first pass (an early PR) caught the obvious
broken-looking issues. The second pass (an early PR) caught redundancy and
ambiguity that needed the first pass landed before it became
visible. The third pass (an early PR) caught the entry-points —
sign-in, forgot-password, tokens settings — that the first two
passes never opened because they assumed an already-logged-in user.
**Each pass surfaces issues the previous one couldn't see**;
declaring a UX pass "done" after one round leaves the entry
surfaces broken for the visitor who matters most: the newcomer
who hasn't logged in yet.

**Rule:** after every UX-affecting change, walk every routed
surface — including the auth-flow surfaces and the empty states —
as a first-time visitor with no AI background. Fix anything you'd
ask "what does this mean?" about. Repeat until your only
remaining question is the question the surface is actually trying
to answer.

---

## 5ae. Major-version config drift is invisible to unit tests (2026-05-17, Prisma 7 seed silent no-op)

The 2026-05-17 sprint shipped an early PR — a deterministic seed fixture for the e2e suite. Every CI check passed: `pnpm install --frozen-lockfile`, `prisma generate`, `turbo typecheck`, `@brain/core test`, `fresh-DB migrate · FTS`. All four gates green. The seed code itself was reviewed against the schema field-by-field. The PR merged to develop, then the dev brain auto-deployed.

On the first real run, `scripts/deploy.sh` printed:

```
[deploy] Seeding dev DB (set SEED_ON_DEPLOY=false to skip)...
⚠️ No seed command configured
To seed your database, add a seed property to the migrations section in your Prisma config file.
      seed: 'bun ./prisma/seed.ts',
```

And exited 0 because of the trailing `|| warn`. Zero rows landed. Counting `seed_%` in the DB gave the definitive signal — all six tables read `0` — and that's how the bug was caught. Without that probe, the playwright suite would have failed against an empty DB and the blame would have looked like "the seed has bugs," when in fact the seed never ran at all.

Three independent issues stacked:

1. **Config-file deprecation, silently no-op'd.** Prisma 6 → 7 moved `seed` from `package.json#prisma.seed` to `prisma.config.ts#migrations.seed`. The old location is deprecated; `prisma db seed` prints a warning and exits 0. There is no error, no test failure, no CI signal. The only proof of working is "rows present in the DB after the command."
2. **Adapter requirement, surfaces only at runtime.** `new PrismaClient()` without an adapter throws in v7. The seed worked locally during development because the test code overlaid a partially-set up bootstrap image; against a clean image, it crashed on import.
3. **Trailing `|| warn` swallowed the failure.** The deploy.sh wrapper was defensive ("seed failed; continuing") for the right reason — a missing seed shouldn't block the deploy — but it also hid the bug. The same pattern appears elsewhere in deploy.sh and is intentional; the answer is not to remove the `|| warn` but to **probe the result** with a separate counter check.

**Three lessons compound:**

**Major-version config locations move silently.** When bumping a dependency's major version, grep the codebase for every file that names the dependency and exercise each code path against a real runtime. Unit tests never see the deprecated-location warning because they don't invoke the dependency's CLI. The Prisma 7 docs document this clearly; no test we wrote would have surfaced it.

**Defensive `|| warn` patterns require counter-probes.** Any deploy step that swallows failures with `|| warn` to keep the pipeline forward-rolling must be paired with a downstream counter check that fails noisily if the swallowed step actually mattered. For the seed, the right probe is `count(*) WHERE id LIKE 'seed_%'` — sub-second, deterministic, no dependence on any test framework. This is now part of `KNOWN_ISSUES.md`'s deploy-hazards section.

**The validation chain is: did the artifact *do its job*, not did the script *exit 0*.** an early PR's tests all passed. The PR's own CI all passed. The deploy script exited 0. The artifact (a populated seed) was not produced. "CI green + deploy clean" is necessary but not sufficient evidence — the only sufficient evidence is observing the change's intended downstream effect. Re-articulates §5m and §5q from a fresh angle: the validation discipline is universal, not just relevant to KEA pipelines or migration drift.

**Rule:** every PR that ships a deploy-time side effect (seed, backfill, schema reset, embedding refresh, audit-row write) must include a downstream counter probe in its test plan — a one-line SQL or grep that returns YES/NO and runs in under a second. If the probe is hard to write, the side effect is probably too implicit.

**Round-2 validation (same day, 2026-05-17).** With the hotfix in an early PR staged on the bugfix branch but not yet merged, the loop re-ran `scripts/deploy.sh` against the live dev brain to test the *other* half of the rule: data already persisted from the earlier manual seed (16 knowledge rows, all embedded) survived a full image rebuild + container recreate cleanly. The deploy step printed the same `⚠️ No seed command configured` warning (expected, since develop doesn't have the seed command yet) and exited 0. Lockdown audit PASSED. All 12 auth-free + auth-gated probes returned the expected status codes. Worker / mcp-server / web logs showed zero error-level lines. This validated that the *DB volume* is the right place for fixture persistence between deploys — re-running deploy.sh is a `pgvector`-safe operation and the seed step is genuinely idempotent (the broken state of the seed step on this run was a no-op, not a destructive one). The seed step's `|| warn` is exactly the right defensive posture — it failed safely. The downstream counter probe is what made the failure *visible*.

---

## 5ad. The platform applied to itself — recursive validation (2026-05-14, cross-session KEA scheduled + scope-filter fix)

The full External Brain loop closed end-to-end on 2026-05-13: a real client (the iteration session itself) retrieved 5 brain rules at session start, applied 3 of them to shape an actual feature implementation (the GitHub-webhook fixture session), closed with `knowledgeUsed = [3 IDs]`, and watched `Knowledge.successCount` bump from 0 to 2 on each applied rule. Then on 2026-05-14, the next session retrieved the same rules (now ranked higher because of the successCount bump) and used them to build the daily cross-session KEA schedule — the very piece of infrastructure that produced the rules. The brain extracted patterns from its own development, then guided its own further development.

Three lessons compound out of this:

1. **The strongest demonstration of a learning platform is to apply it to itself.** Most "AI memory" demos show retrieval against synthetic queries on synthetic data. This iteration produced 5 real cross-session rules from observing my actual coding work, then watched those rules shape a downstream PR's design. Without the brain's "every new feature must include an end-to-end smoke test" rule, an early PR would have shipped with unit tests only; the rule caused me to add 3 integration tests + a manually-enqueued pg-boss job that I watched the worker process. Without the "instrument the invisible" rule, the cron's skip-on-no-new-sessions path would have been silent; the rule caused me to emit `op="kea.cross.skip"` with an explicit reason. These are non-obvious design choices that the brain made obvious.

2. **The retrieval gap was load-bearing in a way unit tests couldn't surface.** an early PR fixed a bug where `brain_retrieve_knowledge` without an explicit `projectId` returned an empty bundle. Every unit test of the scope-filter passed before the fix because each test set `activeProjectId` explicitly. The bug lived in the realistic-user-flow path that nothing in the test matrix exercised. The brain itself surfaced the rule that would have prevented this — **"end-to-end smoke test that exercises the real integration path"** — but only AFTER the bug had shipped, watched four iterations, and finally been triggered by a user-shaped retrieval call (mine) that didn't pass `projectId`. The lesson: even with the right rule in the brain, you still need the rule to actually FIRE at the right moment. Retrieval coverage is itself a form of test coverage.

3. **Dependency injection beats `vi.spyOn` for testing module wrappers in ESM.** an early PR's smoke test initially used `vi.spyOn(kea, "extractFromCrossSessions")` to stub the LLM call inside `runCrossExtractDaily`. It didn't intercept — Node's ESM module resolution binds intra-module references at load time, so the wrapper's call site reads the local function, not the namespace export. The cleanest fix is to pass the inner function as an optional parameter (`runCrossExtractDaily({ extract? })`). Production callers leave it undefined; tests pass a stub. This pattern is small, type-safe, and avoids `vi.mock`'s full-module-replacement footgun (which would make the wrapper itself impossible to test).

**Rule for future iterations:** when you ship a feature that depends on a retrievable Knowledge row, exercise the retrieval path with the inputs the realistic user would pass — including the empty / default / "no context" cases that the documentation example glosses over. Persistent counters (`Knowledge.successCount`, `SessionKnowledgeApplication`) are the load-bearing diagnostic; they fail noisily when the loop breaks, where unit tests stay green because they each provide their own context.

---

## 5ac. Nested bug chains and persistent measurement (2026-05-12, KEA pipeline diagnostic loop)

After §5ab unblocked the data plane (sessions get captured, close calls fire), the next layer of the iteration revealed a different failure mode: three completely independent bugs stacked on top of each other in the KEA pipeline. Each was invisible until the one above it was fixed.

1. **P2025 retry-storm.** The integration test in `session-lifecycle.test.ts` cleaned up its synthetic Session in `afterAll` — but `brain_report_session_outcome` had already enqueued a `kea.extract` job. The worker hit `findUniqueOrThrow` for a deleted row → P2025 → pg-boss retried 3× → job parked as `failed`. From the worker logs it looked like "KEA is broken." The actual problem was a race between test teardown and the worker's pickup loop.
2. **Misleading SDK error.** Once P2025 was tolerated, the next session failed with the OpenAI SDK throwing `Missing credentials. Please pass apiKey... or set OPENAI_API_KEY`. But the actual missing env was `DASHSCOPE_API_KEY` — `callDashScope` passes `apiKey: undefined`, the SDK mentions OPENAI_API_KEY only as its fallback default. An operator chasing the error message would have set the wrong env var.
3. **`.env` not reaching the container.** With the SDK guard in place and `KEA_MODEL=claude-haiku-4-5` set in `.env`, the worker *still* reported `KEA_MODEL=qwen3-coder` in its error logs. Cause: `deploy/docker-compose.yml`'s worker service `environment` block didn't pass `KEA_MODEL` through. Every probe of "is the env right?" against `.env` returned the right answer; the container had the wrong value because `docker-compose` never forwarded it.

Two lessons compound from this:

**Each layer's symptom looks like the layer's own problem, but is actually a leak from the layer below.** "The retry-storm makes KEA unreliable" → "the SDK is misconfigured" → "the env var never reached the container." Three independent issues, three independent fixes. The discipline that broke the chain wasn't debugging skill — it was re-reading the same persistent counter (`./.dev/brain-learning-evidence.sh`) after every fix and asking "did `knowledge_by_kea` move?" When the answer stayed `0`, the next bug below got investigated. When the answer finally became `1`, the chain was complete.

**`.env` is necessary but not sufficient for "the value reached the process."** A variable being set in `.env` proves only that the file has the value. Verification requires `docker compose exec <service> printenv | grep <VAR>` for every service that should see it, AND a separate check that the code path actually reads the right variable. This is now codified in `RUNBOOK.md §"Why is knowledge_by_kea stuck at 0?"` step 2.

**Rule:** for any data-plane pipeline whose output is a measurable counter, the regression net is "did the counter move after my fix?" — not "did the unit test pass" or "did the smoke test show no errors." Persistent counters are the antidote to optimistic local fixes; they fail noisily when something deeper is wrong.

---

## 5ab. Auth gate working ≠ pipeline learning — log shapes must distinguish failure modes (2026-05-11, MCP observability + installer v2)

A quiet diagnostic against `brain-dev.example.com` after a release: 184 successful `mcp.session.open` events over 7 days at exactly 900-second cadence, zero tool calls, zero session closes, zero Knowledge rows. Tokens authenticated; nothing past the auth gate ever fired. The dashboard's "tokens connected" surface was green and accurate. The dashboard's "is this brain learning?" surface didn't exist, so the failure was invisible until someone went looking.

Three lessons:

1. **Logs that don't distinguish failure shapes are observability theater.** Tool calls were already logging as `op="mcp.tool"`, but `tools/list` calls logged nothing. A histogram of `op` values showed "184 opens, 0 anything-else" — which read as "auth gate is the only thing running," but was actually "184 sessions opened and never went past list-discovery." Adding `op="mcp.tools.list"` made the failure mode visible. Adding `op="mcp.session.orphan"` (close path + a 5-min sweeper) made it a first-class metric.

2. **The artifact has to be exercised in the conditions it claims to fix.** an early PR's first run created an orphan Session (the very failure mode the PR was designed to detect), because a regex extracting `sessionId` from `brain_start_session`'s response didn't handle JSON-string-of-JSON quoting. "CI is green and the unit test passes" was true. "The shipped installer creates a closed Session when run against the live stack" was false. The bug surfaced only because we re-ran the audit script against the DB after running the v2 installer end-to-end and noticed `sessions_reported_outcome_last_30d` was still 0. Always run the artifact against the system it's about to ship to; treat "tests passed" as a necessary precondition, not sufficient evidence.

3. **Installer success criterion must be behavioral, not structural.** The pre-v2 installer ended with `claude mcp list | grep brain` — which proves the local config row exists but nothing about whether the bearer reaches a tool over the user's network. The v2 installer ends with an actual JSON-RPC round-trip (`initialize` + `tools/call brain_get_user_style`) plus a `start_session → log_event → report_session_outcome` "install-ping" that lands a real Session row with `endedAt` set, giving KEA its first input. The dashboard can now distinguish a real install from a stale heartbeat without anyone reading logs.

**Rule for future pipelines:** for any system whose "auth path" is much shorter than its "actually works" path, ship log lines AND smoke-test artifacts that distinguish the two. The cost is small (a few log lines, one or two curl calls in the installer); the cost of NOT shipping them is months of "the platform is up, nothing's wrong" reports while no user does any real work.

---

## 5v. Generate the install command, don't write installation docs (2026-04-26, onboarding wizard)

Documentation that says "edit this file at this path" is only correct until the tool changes. The `~/.claude/mcp.json` trap is the canonical example: two operators in 24 hours followed our own docs, edited the path that looks right, and couldn't connect — because Claude Code doesn't read that file. The docs were accurate when written; they drifted against reality without anyone noticing.

The platform's answer is to generate the exact command the operator needs, parameterized by their actual deployment: their Brain URL, their bearer token, their client, their OS. The post-mint wizard at `/settings/tokens` does this client-side — it knows the deployment URL (from `process.env.NEXT_PUBLIC_APP_URL`), the raw token (from the mint response, shown once), the client and OS the operator selects, and it renders the exact `claude mcp add` invocation or JSON block they need to paste. No translation from doc abstraction to local path required.

The cross-platform challenge makes this more valuable, not less. The correct config file path differs between Claude Code (`~/.claude.json`), Cursor (`~/.cursor/mcp.json` or `<repo>/.cursor/mcp.json`), Windsurf (`~/.codeium/windsurf/mcp_config.json`), Google Antigravity (`~/.gemini/config/mcp_config.json`, shared by its IDE and CLI), GitHub Copilot (`.vscode/mcp.json`, per-IDE `mcp.json`, or `~/.copilot/mcp-config.json`), and Claude Desktop (platform-specific). The shell syntax for a one-liner differs between bash and PowerShell. The wizard handles that asymmetry once, centrally, so each operator gets the right command for their environment without reading a compatibility matrix. The installers (`/api/onboard.sh`, `/api/onboard.ps1`) apply the same principle at the script level: the operator runs one command; the script handles the path, the `claude mcp add` invocation, and the SKILL.md download for their OS. (v1.7.0 extended the wizard to Antigravity + every Copilot surface — see §5ar.)

**Rule:** any time the platform wants to tell an operator "edit this file at path X," consider whether the platform can instead generate the exact edit or the exact command. Docs that describe the abstract shape are a maintenance liability; generated commands that encode the concrete reality at the moment of use are self-updating.

---

## 5y. Translation strings are not safe places for placeholder demo text (2026-05-05, oracle i18n hotfix)

PR #95 hotfix. The Oracle "retrieved" header read `0 items retrieved · 2 cited` even when there were 0 citations. Root cause: all three i18n variants of `oracle.retrieved` (en/de/th) literally contained `· 2 cited` as placeholder text from an early prototype. The number was a string literal, not a substitution. Three problems compounded:

1. **The number rotted invisibly.** Once a translation key ships in three languages, no one re-reads them looking for stale demo data. The translator workflow assumes the text describes a stable concept, not a dynamic count.
2. **It looked correct to the eye in dev.** The seed data has citations, so `· 2 cited` matched the screen often enough to never get flagged in review.
3. **The fix wasn't a translation tweak — it was a structural change.** The right fix added `oracle.citedInline` as a separate key and wrapped the count in a conditional render. Translation strings now contain only the noun ("cited"), the number comes from props.

**Principle: translation strings must never embed dynamic numbers, counts, or sample values.** Counts go in either (a) format-string substitutions (`"{n} cited"` interpolated at render time) or (b) a separate trailing key wrapped in a conditional render. When you write a translation string, ask: "if a future reader sees this number in this dictionary entry, is there any way it stays correct as data changes?" If the answer is no, it doesn't belong in the dictionary. Codified in `GUIDELINES.md §10`.

**Generalisation: any frozen-at-write-time value living in a translation file is a regression hazard.** This includes URLs ("see /skills"), version numbers ("v1.0 of …"), feature names that may rename, and currency symbols when the locale doesn't enforce them. Translation files are append-only by review convention; they're a worst-case place for anything that drifts.

---

## 5z. Operator-facing daily-workflow doc is a separate genre from wiring docs (2026-05-05, USING_BRAIN landed)

`CLIENTS.md` answers "how do I wire Claude Code to a Brain?" `USING_BRAIN.md` answers "I wired it — now what?" Those are different questions and they want different documents. Conflating them produces a 30-page CLIENTS.md that nobody reads, or a vague QUICKSTART that skips the trigger phrases. The split:

- **CLIENTS.md** = config snippets, paths, headers. Per-tool wiring matrix. The thing you read once when setting up.
- **USING_BRAIN.md** = trigger phrases, narrated session transcripts, debug recipes, operator habits. The thing you re-read after the first week when knowledge isn't accumulating and you're wondering why.
- **HOW_IT_WORKS.md** = the platform's mental model end-to-end. The thing you read when explaining the product to a new teammate.

Each layer reuses the layer below it but doesn't duplicate it. USING_BRAIN can say "see CLIENTS.md for the per-tool snippets" and assume you've read it. The risk of conflation is real: every product I've worked on has a "getting started" doc that grew 5× because someone kept appending operator tips. Resist; split the doc instead.

The tip-of-the-spear lesson: the single biggest factor in whether a Brain compounds is whether the operator **closes sessions explicitly** ("that worked" / "ship it"). Without `brain_report_session_outcome`, KEA never fires. That fact is operational, not architectural — it doesn't belong in BLUEPRINT or ARCHITECTURE; it belongs in the daily-workflow doc, where someone reading "why isn't my Brain learning?" will actually find it.

---

## 5x. Wipe-and-replay over migrate when no real users yet (2026-05-04, prisma + pg-boss bumps)

Today's pg-boss 10 → 12 + the prisma 5 → 7 attempt + the migration-collation rename (#66) all hit the same wall: a partially-applied schema that no upstream migration tool can recover from automatically.

- pg-boss 12.18.2 ships migrations starting at v25 → v26, but the dev DB had pg-boss 10's `version = 24` row. There is no v24 → v25 path in v12. The worker crashed `boss.start()` on every restart for ~30 minutes until we dropped the schema (#71).
- Prisma 7 moved `datasource.url` out of `schema.prisma` AND requires an adapter at runtime. Two breaking changes in one bump that no Prisma migration tool can detect.
- The collation-sort rename (#66) renamed four migration directories. Existing DBs had `_prisma_migrations` rows pointing at the old names; on `migrate deploy` Prisma sees them as missing migrations.

In each case, the only clean recovery was `DROP SCHEMA … CASCADE` (or `prisma migrate reset`) followed by re-apply. The migration-tool authors don't ship the migration paths because their assumption is "your DB is at the version we expect." When the assumption breaks, only the operator can choose between (a) hand-write a custom migration, (b) wipe and replay, or (c) stay on the old version.

**Principle: while the platform has no real users, wipe-and-replay is the right default for any data-plane major bump.** Hand-written migrations are a tax we don't have to pay yet. The operator action is small (`DROP SCHEMA … CASCADE`, then redeploy), the data loss is acceptable (only seed + dev test rows), and the resulting schema is provably consistent with the new version's expectations.

This approach has a clear expiry date: **the day the first real pilot user signs in, wipe-and-replay becomes destructive.** From that day forward every data-plane major bump must come with a hand-written migration that operators run before the version bump deploys. The principle in §5n ("migration paths over hard cutovers") then takes over; today's principle is the pre-pilot exception.

**Rule:** call out wipe-and-replay explicitly in the PR description for any data-plane major bump while we're pre-pilot. Once a `pilot` label appears on `User` rows or the operator says "we have real users now," update the rule and bias to hand-written migrations.

**Operator gate:** Prisma 5+ refuses `migrate reset --force` from an AI agent without `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` set to the user's exact consent message. AGENTS.md hard rule #7 codifies this. The full pre-deploy runbook is in `docs/RUNBOOK.md §"Pre-deploy schema check"` — read it before touching the data plane.

---

## 7. What "done" looks like

A task is done when:

1. Code lands with tests (unit + integration where relevant).
2. Docs updated if contract changed (`MCP_TOOLS.md`, `REST_API.md`, `KNOWLEDGE.md` invariants).
3. Invariants still hold — no new violation introduced.
4. Metrics observed — SQS and retrieval NDCG not regressed on benchmark.
5. Risk noted — either in PR description or in `KNOWN_ISSUES.md` if structural.
6. Rollback path exists — feature flag, env variable, or trivial revert.

"Shipped" is not "deployed". Shipped = all six above.

---

## 8. Mental model you can hand to a collaborator in 60 seconds

> External Brain is an MCP server + webapp. External AI tools call it before generating code (to retrieve knowledge) and after (to report outcomes). The platform extracts atomic rules from sessions, retrieves them by semantic meaning with a multi-factor score, evolves them over time (decay, consolidate, obsolesce), and lets users query them in natural language via the Oracle. Knowledge lives in three scopes — personal, team, community — with strict boundaries. The system's own intelligence improves through internal wisdom skills and autoskill proposals. We measure SQS + NDCG + knowledge health from day 1 because unmeasured flywheels stall.

If a new contributor can't repeat that 60-second summary after reading `BLUEPRINT.md` + `APPROACH.md`, the docs have failed. Fix the docs.

---

## 9. Visual aids

The following diagrams provide a quick visual companion to the text above:

- [`User Flow diagram`](./assets/illustrations/user_flow.png) — how AI tools connect via MCP and produce Skills & Rules.
- [`Architecture diagram`](./assets/illustrations/architecture.png) — the 3-layer block diagram (§2.4 dependency graph visualized).
- [`AI Application diagram`](./assets/illustrations/ai_application.png) — where LLMs and embeddings are applied (§4.7 deterministic-vs-LLM boundary).
- [`Process Logic diagram`](./assets/illustrations/process_logic.png) — end-to-end session sequence (§4.3 sync-vs-async boundary).
- [`Vibe-Coding Improvement diagram`](./assets/illustrations/vibe_coding_improvement.png) — how External Brain augments AI output with precise context.
- [`Knowledge Algorithm diagram`](./assets/illustrations/knowledge_algorithm.png) — sequential lifecycle of logging, extracting, and consolidating knowledge.

Source files (Mermaid `.md`) are co-located with the PNGs in `docs/assets/illustrations/`.

---

## 5w. Closing the feedback loop end-to-end — five signals at every time scale (2026-04-29, MVP complete)

The product thesis is "the Brain improves vibe-coding quality and performance." The thesis is now observable at five distinct time scales, not just at one.

**The five signals.**

1. **Per-answer (Oracle groundedness header).** The groundedness header (`🧠 Grounded on N rules · M sessions · strong/moderate/weak/none`) renders while the answer is still streaming — computed from the retrieval bundle before the LLM call, emitted as a `meta` SSE event. The user sees the Brain's contribution every time they ask a question, not just when they run a benchmark. Absent Brain context surfaces as `⚠️ No relevant memories — [Teach a rule]`: the empty state is not a dead end; it is a teaching prompt.

2. **Per-citation ("Why this answer" panel).** Each citation card in the collapsed `Sources used by the Brain (N) ▾` toggle shows a type chip, an effectiveness badge (same ✓/~/✗/—/○ visual as the Skills tab), the `WHEN: <triggerText>` pattern that triggered the rule, and a last-used relative time. The user can open a citation and understand not just *what* the Brain cited but *why that specific rule* and *what its track record is*. The enrichment is populated by `mapCitations` from fields already in the retrieval bundle — no extra DB queries.

3. **Per-rule (effectiveness badge on the Skills tab).** Every row in the Skills browser carries an effectiveness badge derived from `successCount / (successCount + failureCount)`. A rule with ≥5 outcomes and a score below 0.40 shows red. A rule with fewer than 3 outcomes shows "Untested" — the system does not penalise new rules. The "Most useful rules" dashboard card surfaces the top 5 by score (≥5 outcomes). The user knows which rules are paying off before they finish reading the answer.

4. **Per-Brain (effectiveness-aware decay + KRA neutral floor).** Effectiveness counters now drive the Brain's self-tuning, not just badge display. Low-effectiveness rules (score < 0.3 with ≥5 outcomes) decay 2× faster (half-life 90 → 45 days). High-effectiveness rules decay half as fast (90 → 180 days). Brand-new rules use a neutral 0.5 floor in KRA scoring — they wait for evidence rather than ranking below tested-poor rules. The Brain progressively promotes what works and retires what doesn't, without any explicit operator action.

5. **Per-deployment (Generation Uplift v2 + live thumbs feedback).** The automated LLM-judge benchmark (52 questions: 32 in-domain, 10 partial, 10 out-of-domain) measures Oracle answer quality with-Brain vs. without-Brain. Results land in `benchmarks/uplift-summary.jsonl`; the admin dashboard shows the headline uplift delta, win rate, trend sparkline, and a bias warning when the out-of-domain delta exceeds 0.3 (the judge is rating on general intelligence, not Brain contribution). The live thumbs feedback loop closes the loop: a thumbs up/down on an Oracle answer immediately bumps `successCount`/`failureCount` on each cited Knowledge row, wiring the user's in-the-moment reaction into the same counters that drive badge display, KRA ranking, and decay.

**Why five signals instead of one.** A pilot customer who dismisses the value has to dispute all five signals simultaneously. A single benchmark score can be explained away ("maybe the LLM got better"). An effectiveness badge that stayed green for weeks while the user clicked thumbs up is harder to dismiss. The compounding effect is structural: thumbs feedback bumps counters → counters drive effectiveness badge → badge builds trust in the rule → rule continues to be cited → counter climbs further → decay slows → the rule survives longer and ranks higher. Each signal individually is useful. Together they make the thesis undeniable to a user who has been using the Brain for more than a few days.

**The principle that follows.** For any future Brain-improvement feature, the question is not "does the benchmark improve?" but "where in the five time scales does the user see it?" A signal that is only measurable in CI is a half-shipped feature. See `docs/GUIDELINES.md §7c` for the enforcement rule.

---

## 6. Visible value: per-answer Brain contribution (2026-04-28)

Benchmarks prove the Brain works. Users don't read benchmarks.

The original Oracle shipped `confidence: "high"|"medium"|"low"` — a single word at the bottom of the answer telling the LLM's self-rating. That tells the user nothing about whether the Brain was involved at all. A confident general-knowledge answer and a confident grounded answer look identical. The user has no reason to trust the Brain over their own memory.

**Principle: the Brain's contribution must be visible at the answer level, not only in aggregate metrics.**

The implementation has three parts:

1. **Groundedness (not confidence).** `groundedness` reflects how much Brain context was available *before* the LLM call. It is computed from the retrieval bundle — `strong` (≥ 6 knowledge rows), `moderate` (3-5 rows or knowledge + sessions mix), `weak` (1-2 rows or only sessions), `none` (empty bundle). It is *not* the LLM's stated confidence in its own answer — that concept already has `confidence`. The two fields serve different masters: `groundedness` answers "did the Brain contribute?"; `confidence` answers "how certain is the LLM?".

2. **The `meta` SSE event.** The streaming path emits a `meta` event right after retrieval and before the first `delta`. The frontend receives groundedness + retrievedCounts while the answer is still streaming, so the header pill renders immediately rather than waiting for the full answer. This is intentional: the user sees "Grounded on N rules · M sessions" while the text arrives, not after.

3. **The empty-Brain honest signal.** When `groundedness === "none"`, two things happen: (a) the system prompt is overridden to explicitly tell the LLM it has no Brain context ("make it clear this is NOT grounded in their specific work"), and (b) the frontend shows an `⚠️` banner with a "Teach a rule" button that opens the Teach modal pre-filled with the question text. The LLM nudge reduces citation fabrication; the UI affordance turns the empty-state into a growth moment.

**Why this matters for the flywheel:** a user who never notices the Brain's contribution has no reason to keep the Brain populated. Visible contribution creates the feedback loop where the user cares about knowledge quality because they can see it pay off on every question. The `none` state that shows "Teach a rule" is the flywheel's entry point for users with sparse Brains — the moment of felt absence is exactly when they're most motivated to add something.

**Phase extension — "Why this answer" per-citation reasoning panel (2026-04-25):** The groundedness header tells the user *how* grounded the answer is. The per-rule effectiveness badge (Skills tab) tells the user *which* rules pay off over time. The citation panel now ties both signals together at the moment of each Oracle answer. Each citation card in the "Sources used by the Brain" panel is enriched with:

- For knowledge citations: type chip (color-coded recipe/reflex/rule of thumb/principle/anti-principle), effectiveness badge (reused from Skills tab — same ✓/~/✗/—/○ visual), last-used relative time, and a dim `WHEN: <triggerText>` line showing exactly what context pattern triggered the rule.
- For session citations: project name, session age, outcome indicator (✓ success / ✗ failure / ? unknown), and client type (claude_code / cursor / etc.).

The enrichment is populated by `mapCitations` in `oracle.ts` without extra DB queries — it reads the fields (`successCount`, `failureCount`, `usageCount`, `lastUsedAt`, `clientType`, `project.name`) that are already present in the retrieval bundle. `effectivenessScore()` from `@brain/core/knowledge-stats` is reused — no reimplementation. The `EffectivenessBadge` component is extracted from `skills.tsx` to `effectiveness-badge.tsx` so both surfaces share the same visual. The net result: the user can open a citation card and immediately understand not just *what* the Brain cited, but *why that rule* (its trigger pattern, its track record) and *why that session* (its context and outcome).

## 5aa. First-time-user review loop on an isolated stack (2026-06-07)

A "does it actually work for someone with no background?" pass found three real bugs (two `#418` hydration mismatches + a `/docs` prefetch abort) and one shipped-broken feature (version footer stuck on `dev`) that unit tests and CI never caught — because they only manifest in the *rendered, hydrated* browser, not in `tsc`/`vitest`. The repeatable method:

1. **Match the stack to the test's blast radius.** *Write/destructive* testing — the full e2e suite, signup/teach flows, anything that creates or deletes rows — must NOT hit a live server that holds real client data; stand up an isolated stack (`docker compose -p brain-review`, own DB volume, non-default ports, dev-auth, no real keys) so the production `deploy` project is never touched. *Read-only* first-run review, though, can run **against the live server via a disposable, non-admin account** (2026-06-17 refinement): the platform's per-user scope isolation means that account sees only its own *empty* Brain — no real-client exposure, and no isolated stack to stand up or maintain (keeping the project lean). Never open `/admin` or another user's data; if real client data ever appears, stop and don't capture it.
2. **Drive a real browser, capture the real signals.** Playwright (`~/playwright-validate`) over every surface, recording `console.error` + `pageerror` + failed requests per page. Zero of those is the bar — not "it looks fine."
3. **Debug hydration with evidence, not minified args.** React's prod `#418` only says "HTML" or "text". To find the node: diff the **JS-off** DOM (pure SSR) against the **JS-on** DOM (hydrated), stripping attributes + React's `<!-- -->` text-boundary markers. To test a *data-race* hypothesis, **delay the API** with a route intercept and check whether the error survives — it isolates "fast fetch beat hydration" from "stable render-time mismatch."
4. **Resist pattern-match fixes.** A fourth candidate (`useState(detectOs)` in the token wizard) looked identical to the real bugs, but the wizard only mounts *after* a client interaction → never hydrates → not a bug. Reverted. The iron law (no fix without a confirmed root cause) applies even when the pattern looks obvious.

Lesson: a browser-driven first-run review is a distinct test genre from CI; budget it before calling a UI "done," and keep the isolated-stack + DOM-diff + delay-fetch tools around — they pay for themselves the first time.

## 5ab. Validate the *restored* artifact on a fresh clone, not on provenance (2026-06-07)

When the single-server merge made `deploy.sh` server-only, the documented newcomer quickstart silently broke; the fix resurrected the old dev flow as `dev-up.sh`. It was tempting to ship that on **provenance** alone — "it's the battle-tested pre-#26 script, so it works." That reasoning is exactly the trap §5aa warns about: the script is the same, but the *environment around it* changed (the merged compose, profiles, the new `bootstrap` gating). So the honest close-out was to **`git clone` the repo fresh, `cp .env.example .env`, and actually run `./scripts/dev-up.sh`** under an isolated compose project — which proved the script + the new compose integrate (build → migrate → seed → serve, `readyz` 200, MCP 401-gated, lockdown PASS).

Two compounding lessons: (1) "restored from a known-good version" is provenance, not verification — re-run it in the *current* environment. (2) The doc sweep that introduced `dev-up.sh` (PR #29) was itself incomplete — it converted README/QUICKSTART/AGENTS but missed HOW_IT_WORKS/SECURITY/ARCHITECTURE/GUIDELINES/APPROACH, because the first pass grepped only the obvious entry-point docs. A name-grep over **every** tracked doc, run as a deliberate follow-up, is what closed the gap. When you introduce a new command name, grep all docs for both the **new** name (are the pointers right?) and the **old/changed** one (did any local-context reference get left behind?).

## 5am. The review found what the gate didn't — so the review became the gate (2026-06-08, v1.3.0 → v1.3.1)

The v1.3.0 finalize pass closed three long-open items (locale on unauth surfaces #3, labels-by-default rail #4, the anon-e2e CI gate #1) and renamed the product to **External Brain** everywhere. Three method lessons compounded:

1. **A "fixed" bug can still be live if the deploy is stale.** Production showed the React `#418` the team thought was fixed — because the running container predated the fix on `main` by two days. The diagnosis wasn't a code hunt; it was reading the container's age against the fix commit's date. *Green on `main` ≠ live.* The structural fix is deploy automation (or at minimum a "main is ahead of prod" alarm); until then, a redeploy is the first thing to try when prod contradicts the code.

2. **Don't trust a green automated-review check you didn't read.** CodeRabbit was rate-limited / out of credits on all eight PRs, yet its status check still showed green — a non-review masquerading as a review. An independent reviewer (a code-reviewer subagent over the whole session diff) then caught a real **High** regression that had shipped: the #33 fix (skip the anon `/welcome` dashboard poll to silence a console 401) also removed the only code path that rendered the logged-out "Sign in" CTA, leaving a dead-end "Waiting…". Silencing an error can delete a needed branch — when a fix *removes* a request/state transition, check what downstream rendering keyed on that transition.

3. **A review discipline that keeps finding the same class of bug should become a gate.** The newcomer-eye review (§5aa) has repeatedly found anon-surface bugs that signed-in tests miss. v1.3.0 codified it: the `onboarding-e2e` workflow runs the anonymous Playwright specs as a **required, path-gated** check (#1) — it does real work only when an onboarding/unauth surface changes and is a fast green no-op otherwise, so it's safe to require on every PR. The manual review still matters (it caught #44 *after* CI was green), but the recurring, automatable slice of it now blocks merges instead of relying on a human remembering to look.

Lesson: treat a recurring manual-review finding as a TODO to automate; treat a green check from an unavailable tool as no check at all; and treat "prod disagrees with the code" as a deploy question before a code question.

## 5an. Build the harness, let the harness find the bugs (2026-06-09 → 2026-06-10, v1.4.0 close-capture + authed CI tier)

The v1.4.x cycle shipped two things that look like infrastructure but earned their keep as *bug-finders* before they were even merged.

**Close-capture inverted the extraction model.** Per-session KEA mined thin summaries at ~17% yield; cross-session KEA (§ KNOWLEDGE.md §7) compensated but at a day's latency. The structural insight: the agent already holds the full session in *its own* context — so ask it to distill `(trigger, rule, rationale)` at the one call every client reliably makes (`brain_report_session_outcome`), and demote KEA from miner to judge. Three design rules made it safe: capture never blocks the close (per-item validation, drops counted); the judge can lower but never raise confidence (clamped ≤ 0.95); and the existing quality filter + dedup + `close_capture` tag keep precision and measurability unchanged. Validated on production the same day — and recursively: the cycle's own lessons were submitted through the feature they describe.

**The authed CI tier took 12 iterations to go green, and every red run was information.** It surfaced, in order: spec args are regexes against *absolute* paths (the "anchored" `^e2e/` fix matched zero tests); vocabulary-drifted specs (asserting "autoskill" where the rail says "Proposals" — the locked-glossary discipline of §5ag now enforced from the *test* side); a double-toggle bug introduced by a too-broad expander regex (the fold keeps its label when open); a **real product defect** — the demo's "Download skills bundle" produced a 0-byte file because no seed row carried the `rules-export` tag the exporter filters on; and finally the root cause behind all the "different test fails each run" noise: the app's own per-IP rate limiter returning **429** under the single-IP test burst, found not by theorizing but by reading the Playwright trace's `.network` log. Method lessons that generalize:

1. **Intermittent + different-victim-each-run ⇒ suspect a shared resource, not the tests.** Rate windows, connection pools, per-IP gates. No timeout increase fixes a tripped limiter.
2. **Artifacts over logs.** The report's `data/*.md` (error context + page snapshot) and the trace's `.network` entries answered in minutes what run-log greps had obscured for hours.
3. **A failing gate that keeps finding real defects is doing its job — finish it, don't shelve it.** The tier caught spec rot, a demo-breaking bug, and a latent ops trap (silent trigger-less workflows, #54) before its first green run. It was promoted to a required check the moment it proved stable.
4. **Watchdogs must be validated by firing them.** The prod-drift workflow merged dead (invalid YAML → GitHub registered it trigger-less); only a manual dispatch attempt exposed it. It has since detected real drift, opened its issue, and closed it after redeploy — the full lifecycle exercised, not assumed.

## 5ao. The read side mirrors the write side — inject-at-open closes the flywheel (2026-06-11 → 2026-06-12, v1.5.0, #64 / #66 / #68)

Close-capture (§5an) fixed the *write* half of the loop by moving elicitation to
the one call every client reliably makes. A week of production telemetry showed
the *read* half had the same disease: `brain_retrieve_knowledge` existed,
worked, and was essentially never called by agents — knowledge flowed in and
sat unread. The fix is the same move, mirrored: **don't ask the agent to
remember to retrieve; run retrieval at the reliable touchpoint on its behalf.**
`brain_start_session(prompt)` now executes the KRA query in the same
round-trip and returns `relevantKnowledge { knowledgeIds, injection }`, records
the injection as a `SessionKnowledgeApplication`, and the existing
close-report step credits success/failure back to the injected rows. The
symmetric principle: *every reliable touchpoint should both give and take* —
open injects, close elicits (#66's ask-back `hint` nags a learning-less close,
strongest exactly when knowledge is about to evaporate: after a failure).

Method lessons that generalize:

1. **When a metric reads exactly 0%, suspect the instrument before the
   system.** The first diagnosis ("0% of knowledge ever retrieved") summed
   fields the API doesn't serialize (`usageCount`/`successCount` vs the view's
   `uses`/`success`) — the real baseline was 57% via Oracle citations. The
   *narrower* finding (agent sessions never retrieve) survived correction and
   was the one that mattered. Exact-zero readings are more often a
   wrong-field, wrong-filter, or wrong-name artifact than a true dead system.
2. **A loop can be wired and still starved.** The injection→feedback circuit
   (`recordInjection` → report step 3b) had been implemented for weeks; it
   had simply never been fed because nothing upstream called retrieve. Before
   building new plumbing, check whether the existing plumbing has zero inflow.
3. **Behavioral rules belong in the protocol surface, not the docs.** The
   MCP server's `instructions` field and AGENTS.md (#68) now carry the
   open-inject → apply → close-with-`knowledgeUsed` contract, because agents
   read tool descriptions and house rules — they do not read HOW_IT_WORKS.md.
4. **Validate compounding, not just function.** The proof wasn't "injection
   returns rows" — it was a live session whose injected lessons were the exact
   429/trace lessons taught days earlier, then closing with `knowledgeUsed`
   and watching the rows' success rate update to 100%.

## 5ap. Open a door, don't lower a wall — self-service onboarding (2026-06-17)

The ask was "let new users register and create their own org." The naive read
is a feature toggle: flip registration open. On a **secure-by-default,
multi-tenant** platform holding real client data, that framing is the trap —
"open registration" is a *posture change*, not a feature. The method that kept
it safe:

1. **Validate the problem against the code before building.** The reported
   "`/settings/org` hard-blocks zero-org users" turned out to be a *latent
   edge case*, not the common path: `ensurePersonalOrg` gives every user an
   owner org on sign-in, so the "Admins only" dead-end only fires when that
   bootstrap was skipped (dev-shim) or **silently swallowed** (the sign-in
   `try/catch` logs and continues). The real, always-present gap was the one
   underneath: no way to create an org at all, and a dead-end instead of a
   recovery path. The fix turns the dead-end *into* the entry point — the
   zero-org branch now offers "Create your first organization," solving the
   edge case and the feature in one move.

2. **Reuse the existing gate; don't invent a new one.** Registration was
   already governed by `REGISTRATION_REQUIRES_VOUCHER` for the OAuth path. The
   email+password path rides the **same flag** rather than adding a parallel
   `ALLOW_OPEN_REGISTRATION` knob — one decision, one place to reason about,
   and the platform's "compose existing primitives over new entities" bias
   honored. Default `true` keeps a fresh deploy closed; the operator opts in.

3. **Ordering is a security control.** The review caught that returning
   `email_taken` before validating the voucher turns the endpoint into an
   account-enumeration oracle for *anonymous* callers. The fix is pure
   ordering: validate the voucher first, so only a valid-voucher holder (rate-
   limited) can observe email status. Same lesson as the credentials-timing
   flatten (SECURITY.md): *what you reveal, and in what order, is part of the
   threat model.*

4. **Keep the expensive thing out of the lock.** bcrypt (cost 12, ~200ms) must
   be hashed *before* the DB transaction on both registration paths — holding a
   row lock for 200ms under concurrent signup is how you exhaust a connection
   pool. The voucher path already did this; the review found the open path
   didn't, and it was made to match.

5. **Honest validation under a deploy you don't control.** This checkout can't
   run the app (no pnpm/Node 18) and deploys are operator-gated, so "test on
   live" is not available pre-merge. The honest close-out is: unit-test the
   pure core (`createOrg` — owner membership, default project, global-unique
   slug, name validation), hand-trace the route + server-action flow with
   file:line evidence, lean on CI for typecheck/test/build, and hand the
   operator a deploy + throwaway-account E2E checklist rather than claim a
   browser pass that never happened.

**Coda (post-merge, 2026-06-18):** the operator ran the exact checklist on live using a clean throwaway account. The full new-user journey passed: register → sign-in → `/api/me` returns the new user (not admin) → `/api/orgs` shows *only* the auto-provisioned personal org (tenant isolation: no admin or other-tenant orgs visible) → `POST /api/orgs` creates a second org as owner → re-list confirms. All three product claims (registration, org creation, tenant isolation) were proven live. The "hand the operator a checklist" close-out transferred cleanly into a real E2E validation.

---

## 5aq. The migration carve-out is the safety boundary for autonomous deploy (2026-06-18)

Operator decision recorded this session: the AI may autonomously merge a PR into `main` and run `./scripts/deploy.sh` when (a) all required CI checks are green and (b) the diff contains no Prisma migration. Understanding *why that line* rather than some other is what makes the policy principled.

**A code-only deploy is low-risk and reversible.** If the deployed code breaks something, `git revert` + redeploy undoes it in minutes. Postgres schema is unchanged; no data is at risk. CI green means typecheck, tests, and build passed; the diff went through PR review.

**A migration deploy is qualitatively different.** `prisma migrate deploy` modifies the production DB schema irreversibly — column drops, NOT NULL additions, and enum changes cannot be undone by `git revert`. A migration that passes the dev fixture may still fail against prod data. The failure mode is "DB partially migrated; application in inconsistent state; operator must intervene manually." That requires a human in the loop.

**The policy in three rules:**
1. No Prisma migration in diff (`packages/db/prisma/migrations/` unchanged) + CI green → AI may autonomously merge and deploy.
2. Prisma migration present in diff → STOP. Ask the operator. Do not merge, do not run `deploy.sh`.
3. SSH and destructive DB ops (`migrate reset --force`, volume surgery) are always hard-blocked regardless.

**Why "migration present" beats "migration is safe" as the check:** the detection is `git diff HEAD...origin/main -- packages/db/prisma/migrations/ | wc -l` — it's binary and reliable. "Safe migration" requires knowing prod data shape, concurrency, and acceptable downtime — a human judgment call. The binary check produces a stable boundary; the safety check does not.

Recorded in `CLAUDE.local.md` (gitignored, operator-local). Brain decision id `cmqjpwfwy00000nnzyajiaj1d`.

---

## 5ar. One transport, many dialects — a wrong-shaped MCP config fails silently (2026-06-19, v1.7.0, PR #80)

v1.7.0 added Google Antigravity and every GitHub Copilot surface (VS Code, JetBrains/Visual Studio/Eclipse/Xcode, the `copilot` CLI; the cloud coding agent documented-only) to the install wizard. The Brain side needed nothing — it already exposes one remote streamable-HTTP MCP endpoint authed by a static `Authorization: Bearer` header. The whole feature was emitting the *right JSON shape per client*.

**The transport is standard; the config dialects are not.** Every client speaks the same wire protocol, yet keys the same server four different ways: Antigravity wants `mcpServers` + `serverUrl` (a `url` key is dropped); Copilot VS Code wants `servers` + `headers`; the Copilot JetBrains family wants `servers` + `requestInit.headers` (a top-level `headers` is dropped); the Copilot CLI wants `mcpServers` + `headers`. The failure mode is the worst kind — **silent**: paste a plausible-but-wrong shape and the client simply shows no Brain, no error. That's exactly why the wizard generates the shape rather than asking the user to adapt a generic example (the §5v principle, now load-bearing across five clients). Each generator is a pure function with a unit test pinning its one distinguishing key, so the dialect differences can't silently regress.

**The cheap-correct extension came from a schema decision made long ago.** Widening telemetry so the new clients self-identify on the dashboard touched `SessionClientType`, two enums in `start-session.ts`, and one switch — and required **no migration**, because `clientType` was modeled as a `String` column, not a Prisma enum. That single choice is what kept the change inside the autonomous-CD no-migration carve-out (§5aq) and let it ship merge-to-prod without a human gate. A "type" column stored as a constrained string trades DB-level validation for no-migration extensibility; when the set of values is open-ended and append-only (which clients exist), that trade is usually right.

**Two client-side caveats worth documenting, not fixing.** Both Antigravity and Copilot have shipped bugs where a `401` triggers OAuth discovery instead of sending the configured static header. The Brain advertises no OAuth metadata and sends the static bearer on every request, so the supported path works — but the symptom (a client probing `/.well-known/oauth-*`) looks like a server bug and isn't. And the Copilot cloud coding agent can't reach a private Brain at all: it runs in GitHub's cloud, so it needs an internet-reachable host and a repo-secret token. Naming these in `KNOWN_ISSUES §0g` up front is cheaper than fielding them as bug reports later.

**Rule:** when integrating a standard protocol across many clients, assume the *envelope* diverges even when the *protocol* doesn't — generate the envelope, pin each variant with a test, and document the silent-fail shapes. Brain knowledge ids: `cmqkoc9n5000n0nnzo11szfjy` (config matrix), `cmqkoc55h000m0nnzog1a1wcr` (wizard-extension recipe), `cmqkochmn000o0nnz2vyln0ck` (supported-clients decision).

---

## 5as. A monolith is a bad brief — structured phase files for vibe-coding reconstruction (2026-06-20)

The original `RECREATE_EXTERNAL_BRAIN.md` was a correct but unusable artifact: a
13-section, 770-line document covering everything from pgvector to CI in one read. An AI
agent handed that file produces shallow output because it can't hold the schema, the auth
model, the scoring formula, and the Dockerfile in working context simultaneously. A human
rebuilder faces the same problem — they can't checkpoint and verify in the middle of a
1,000-line spec.

**The split exposed the real problem: a brief optimized for comprehensiveness is
optimized for the author, not the builder.** The author wants to capture everything.
The builder wants to know *what to build next* and *when they're done with this piece*.
Those are different documents.

`REBUILD/` replaces the monolith with nine files, one per phase plus a reference and a
sign-off checklist. Each phase file:

1. Opens with a **copy-paste agent prompt** — the exact text to hand the AI to start
   that phase. No paraphrasing required; the builder doesn't need to extract the task
   from prose.
2. Contains **complete, self-sufficient specs** for that phase — all models, all
   invariants, all algorithms, all config shapes. A builder can read phase 3 without
   re-reading phases 1–2.
3. Closes with a **runnable checkpoint** — shell commands and a pass-criteria checkbox
   list. The checkpoint is a contract: if it passes, the phase is done. If it fails,
   the phase is not done regardless of whether the code "looks right".

**The phase boundary is the gate.** The most common failure mode in a multi-session
vibe-coding rebuild is drift: the agent builds phase N while phase N-1 has a latent
defect, and the defect compounds through N+1 and N+2 before surfacing. A checkpoint
that must pass before the next phase starts prevents this. "The checkpoint is
annoying to run" is a symptom that the checkpoint is doing its job.

**What the phases cover and why this order:**

| Phase | What | Why this order |
|-------|------|----------------|
| 1 — Foundation | Monorepo + types + DB | Everything downstream imports these; the schema must be correct before any logic runs |
| 2 — Core | Intelligence layer | Three runtimes share one implementation; core must compile before any app touches it |
| 3 — MCP server | Gateway + auth | Auth invariants are easiest to verify in isolation; the loop closes later |
| 4 — Worker | Background jobs | Can't verify the loop closes without a worker draining the queue |
| 5 — Web | UI + NextAuth | Last because it depends on all packages and can be partially tested without a worker |
| 6 — Deploy + CI | Docker Compose + scripts + GitHub Actions | Infrastructure wraps everything; test it when everything else is green |

**The two mandatory tests that must never be skipped** (§5ar):
- `antigravity` snippet emits `serverUrl`, not `url`
- `githubCopilotJetbrains` snippet puts auth in `requestInit.headers`, not `headers`

These are silent-failure traps pinned as unit tests in `REBUILD/02-core-intelligence.md
§2.16`. Any rebuild that skips them will produce a "works on my machine" install wizard
that silently breaks for Antigravity and JetBrains users.

**Rule:** when producing a reconstruction brief for a complex system, split it by
build-phase and checkpoint, not by document section. A phase is a unit of verifiable
progress; a section is a unit of narrative. They are not the same thing.

---

## 5av. Ship the code, gate the spend; and validate the right way (2026-06-24, v1.10.x, autoskill LLM classifier)

Graduating `routeSignal`'s type decision from keyword heuristics to an LLM
classifier (§4.7) produced four method lessons worth keeping:

1. **A default-off flag must be cost-neutral, not just behaviour-neutral.** The
   classifier's shadow/observability mode (`AUTOSKILL_SHADOW`) was almost shipped
   on-by-default "to gather agreement data." That would have spent tokens on every
   session the moment it deployed — contradicting the "inert until you flip a flag"
   promise. Making shadow a *separate opt-in* env (default off) means the default
   deploy makes **zero** extra LLM calls. A flag isn't off if its observability arm
   is on.

2. **Separate the code deploy from the flag flip.** Autonomous CI/CD covers
   shipping code; it does **not** cover a runtime decision to start spending tokens.
   Bundling `AUTOSKILL_SHADOW=true` into the deploy was (correctly) denied by the
   safety harness. The clean shape: deploy the code autonomously on green CI, then
   enable the cost-incurring flag as a separate, explicitly-authorized step.

3. **An env var the code reads is invisible until the container forwards it.** The
   classifier read `process.env.AUTOSKILL_*` and `.env.example` documented them, but
   the worker's explicit `environment:` allowlist in `docker-compose.yml` didn't list
   them — so the feature was un-toggleable in prod and nobody would have known until
   they tried to turn it on. Codified as the §3.14 env-passthrough invariant. The
   same class already had a scar (`KEA_MODEL`); the lesson didn't generalize until it
   bit twice.

4. **Validate a fact the way it's actually retrieved.** A project decision taught via
   `brain_teach_knowledge` (`scope:project`) looked "missing" when re-queried through
   a context-free `brain_ask_oracle` — which returns only user/global scope. The teach
   was correct; the *test* was wrong. Project-scoped knowledge surfaces through the
   project-bound `brain_start_session` inject path by design (so decisions reach
   teammates on that project, not a user's unrelated work). Burned an 11-minute
   embedding-cron wait chasing a non-bug before checking the scope contract. When a
   read "fails," confirm you queried it on the path it's meant to be read from.

---

## 5aw. Concede the obvious, lead with the real gap — repositioning when the category moves (2026-06-27)

The README's original pitch led with "AI coding tools are stateless — every session starts from zero." A year ago that was true and it landed. It isn't true anymore: Claude Code, Cursor, Copilot, and ChatGPT all ship memory now. Leading with a pain the audience knows is solved doesn't just fall flat — it signals you're a step behind the field, and a knowledgeable reader stops reading.

The fix wasn't a louder hook. It was finding the pain that's *still* real once you concede the obvious one:

1. **Concede what's true.** Open by granting it ("yes, AI tools have memory now"). That earns the credibility for the next sentence to land.
2. **Find the structural gap, not the feature gap.** Built-in memory is **siloed — per tool, per project, and per person**, a **black box**, and **vendor-locked**. Those aren't features a vendor ships next quarter — they're consequences of *where the memory lives*. A structural differentiator (cross-tool, cross-project, cross-team, inspectable, self-hosted, owned, and **self-improving via autoskill**) doesn't evaporate when the incumbents add a feature. The cross-project/cross-team reuse (user/project/team/org scopes) is the enterprise problem the platform was built for; and the self-improvement (autoskill proposing skills from your sessions, reinforcing what pays off) is arguably the strongest card, because storage is common but a memory that gets better on its own is not.
3. **Tie it to a claim you can defend.** "Shared, inspectable, yours" is verifiable from the architecture. "Measurably better output" is not yet (see `VALIDATION.md`) — so the positioning rests on the structural claims and the efficacy claim stays a roadmap item, not a headline.

Codified as a project decision (do-not-use the stateless framing), in `GUIDELINES.md` (problem-framing discipline), and across `README.md` §Why + FAQ and `HOW_IT_WORKS.md`. The general lesson: when the category shifts under you, re-anchor on what's structurally true and hard to copy — don't shout the old pain louder. One surface in this set hides in plain sight: the **GitHub repo About + topics** are set via `gh repo edit`, not committed, so they drift silently if you forget — keep them in lockstep with the README hook (codified in `GUIDELINES.md` problem-framing discipline).

---

## 5ax. Discoverability is a maintained surface (2026-06-27)

Good positioning only compounds if people find it, so the pass that sharpened the pitch also tuned discoverability: a keyword-rich README H1 + first paragraph, a GitHub About + 20 topics leading with the high-intent terms (`MCP server`, `self-hosted`, `AI coding memory`, `Claude Code`, `Cursor`, `enterprise`), descriptive image alt text, and link-in-first-comment for shared posts. Two lessons. (1) The GitHub About + topics are the easy-to-miss surface because they live in `gh`, not the repo (§5aw). (2) Optimise for the searcher who has *outgrown* built-in memory: they search "shared / self-hosted / enterprise AI memory", not "AI memory". Don't keyword-stuff — a stuffed sentence reads as machine-written, which undercuts the very positioning it is trying to rank. Codified in `GUIDELINES.md` (SEO / discoverability discipline).

## 5ay. A benchmark you documented is not a benchmark you can run; a reference a reader can't resolve is not evidence (2026-07-02, v1.11.0)

An outside review asked the plain question: *the central claim is that KRA-weighted retrieval beats raw cosine — where's the number?* The honest answer was uncomfortable. `VALIDATION.md` described a benchmark methodology in detail, `evaluation.ts` even carried an `ndcg()` helper — but nothing called it. The metric existed as prose and a dead function; there was no harness, no fixture, no published figure. The old numbers everyone half-remembered (NDCG@5 1.000, the 0.928 KRA regression) came from a demo seed that was deleted in the 2026-05-08 "remove fake data" sweep, so they were never evidence for the shipped formula in the first place.

**Two lessons, both about the gap between claiming and proving.**

(1) **If a doc describes a benchmark, ship the runnable harness in the same breath — and make it reuse the production code path, not a copy.** The fix was a pure NDCG@5 harness (`retrieval-benchmark.ts`) that re-ranks a fixture pool by the *exact* `kra.ts` `scoreItem` production uses, versus a cosine baseline. Reusing `scoreItem` (exported, with an injectable `now` for determinism) is the load-bearing choice: a re-implemented formula would silently drift from production the moment `WEIGHTS` change, and the benchmark would then prove nothing about the shipped ranking. The harness is CI-tested; the actual number still needs an operator export against a real corpus (tracked, not faked — the README stays "unproven until measured"). Shipping the *mechanism* honestly is progress; pretending the *number* exists would have been the opposite.

(2) **Docs that cite `PR #NNN` from a private prior history are citing evidence a public reader cannot open.** The same review found ~90 such references across nine public docs — numbers above the public repo's PR ceiling, left over from the pre-open-source history. For a project whose whole ethos is a "deliberately honest catalog," an unresolvable citation quietly spends the credibility the docs are trying to build. Scrubbed to dated descriptions ("an early PR"), and — the durable part — enforced by `scripts/check-doc-refs.sh` as a CI gate so it can't regress. A discipline you can't lint is a discipline you'll relearn.

## 5az. A green health check is not a working backup — the failure that hid for three weeks (2026-07-02, v1.11.1)

Chasing an unrelated thread, a `docker compose ps` showed `deploy-backup-1` as `Up (unhealthy)`. `KNOWN_ISSUES` already had an entry for it — with a confident, *wrong* diagnosis: it blamed the rclone off-host sidecar and asserted "on-host `pg_dump` backups continue running normally." One `docker logs` demolished both halves. `deploy-backup-1` *is* the on-host `pg_dump` service, and it had exited 1 **every night for three weeks**: the backup image was still `postgres-backup-local:15` after the database was upgraded to `pgvector/pgvector:pg16`, and `pg_dump` refuses to dump a newer-major server. There were no backups, on a host with real data.

This is the sharpest instance yet of a recurring lesson (§N2: *green-according-to-the-gate is not green-according-to-the-truth*). The failure was invisible three ways: it ran at 3am, it wrote its error only to a container log no one tailed, and its health signal had been *explained away in writing* rather than checked. **Rules banked:** (1) a plausible root cause written into `KNOWN_ISSUES` without a log line behind it is a liability, not documentation — it stops the next person from looking. (2) Cross-service version couplings that only bite at runtime (backup-image major vs db major) belong in the invariants list, because CI can't see them (`GUIDELINES.md §3 invariant 15`). (3) The real fix isn't just the image bump — it's making silence loud: the follow-up is to have `backup-status` alert when the last successful dump ages out, so the next silent failure announces itself instead of waiting for someone to run `ps`.

## 5ba. The flywheel repair — when the product's own author was its weakest user (2026-07-02 → 2026-07-06, v1.12.0–v1.13.2)

A frank self-review ("what should we improve so users get more from the Brain?") turned into the most consequential diagnosis of the project. Grilling the operator produced a brutal answer: **all four stages of the knowledge loop felt weak** — injected knowledge rarely helped, good lessons weren't captured, nothing crossed projects, and there was no way to tell if any of it worked. Interrogating the live Brain (not the code) found the causal chain behind all four:

1. **Capture loses on the enforcement gradient.** File memory (CLAUDE.md-adjacent notes, hook-driven session summaries) is written at the moment of insight and *enforced by the harness*; Brain capture was requested by house rules — etiquette. In agent systems, information flows to whichever store is hook-enforced at write time. The author's own best lessons were landing in markdown files, not his product.
2. **One repo, three project identities.** Free-text `projectName` matching was case-insensitive-with-trim only, so "Brain Platform" (May), "BrainPlatform" (June), and "External Brain" (June) had silently become three projects. Project-scoped retrieval can't see a sibling identity: knowledge was *filed* but *unfindable*, for ~7 weeks, on the platform whose pitch is cross-project reuse.
3. **A starved, fragmented corpus made injection feel useless** — retrieval quality cannot outrun corpus quality; injected rules carried `effectiveness: -1, outcomes: 0`.
4. **No health surface existed to make any of this visible.** The Oracle, asked "how is my Brain doing," retrieved zero sessions and suggested SQL.

The repair shipped as a staged program with a **feature freeze** on everything that isn't the loop (the freeze is the part that hurts; it is also the part that worked). Stage 1 (v1.12.0): aggressive `normalizeProjectName` matching so drift can't spawn duplicates; an operator-gated, fixture-validated SQL merge that consolidated the three identities (14 knowledge rows, 6 sessions rehomed); Brain-first capture made *hook-enforced* on the author's harness; file memories backfilled as provenance-tagged knowledge. Stage 2 (v1.13.x): a **loop-health panel** (sessions closed-with-learnings, injection→used rate via the new `used_reported` application role, validation coverage, duplicate-identity detector) so starvation can never be invisible again — and the first honest retrieval number (§5bb). Stage 3 is deliberately *gated on the panel's own metrics* (≥60% closed-with-learnings, ≥40% injection→used over a rolling 2 weeks), not on enthusiasm.

**Lessons banked.** (1) *Dogfood diagnosis beats feature ideation*: the "what should we improve" question was answered by `brain_list_projects` and one Oracle query, not by brainstorming. (2) *Etiquette-based protocols lose to hook-based ones* — if a memory product wants primacy, its capture must sit on the law side of the enforcement gradient; this is a harness-integration problem, not a retrieval-algorithm problem. (3) *Identity matching on free text must be aggressively normalized from day one*; every free-text matcher accretes duplicates at exactly the rate agents rephrase things. (4) *A system that measures its users must also measure itself* — the health panel is the permanent answer to "iteration-without-using," the operator-side twin of the iteration-without-user-testing antipattern.

## 5bb. The first real number, and the denial that was a free code review (2026-07-05 → 2026-07-06, v1.13.1–v1.13.2)

Running the retrieval benchmark against the live corpus required three things the plan didn't anticipate.

**A safety classifier's objection was substantively correct — so the fix was code, not authorization.** The fixture export queried `SessionKnowledgeApplication` across *all users*; on this host that would have pulled other accounts' real prompts into a local file. The agent's harness refused the run — repeatedly, through several authorization attempts — until the actual hazard was removed: a `BENCHMARK_USER_ID` scope (15 lines, PR #141) so only the operator's own sessions leave the DB. The scoped run then passed without protest. The durable rule: **when a denial names a concrete hazard rather than a permission class, treat it as a free code review — fix the hazard instead of hunting for consent.** The fix also improved the product for every future multi-user operator, which authorization never would have.

**A benchmark number is only as trustworthy as its plumbing.** The first export produced valid-looking JSON, exit code 0 — truncated at exactly 64 KiB by `docker compose exec -T` stdout. Only a JSON-integrity check caught it (`Unterminated string at char 65091`). Rule: validate the integrity of any piped export; for large payloads write inside the container and `docker compose cp` out.

**The result (VALIDATION.md, 2026-07-06): KRA NDCG@5 0.4514 vs cosine 0.3036 — +0.1478.** Three things about reading it honestly. (1) The seed-era finding ("KRA trails cosine, 0.928 vs 1.000") **did not reproduce on real data** — the tie-breaker factors help on a lived-in corpus exactly where they hurt on a synthetic one; conclusions tuned against seeds should be re-litigated the moment real telemetry exists. (2) The regression bar was reframed from an absolute ("NDCG below 0.9") to the **delta vs cosine on the current fixture** — absolutes are fixture-dependent and the old threshold was calibrated to a fixture where cosine scored a perfect 1.0. (3) The claim discipline held: the retrieval number validates the *ranking layer*; README/HOW_IT_WORKS/VALIDATION still say the end-to-end "improves AI coding output" claim is unproven until the generation-uplift benchmark (#126) runs. Publishing a good number and *not* overclaiming with it is the whole point of the honesty posture. *(Update 2026-07-23: #126 has since run — see `docs/VALIDATION.md` for the first generation-uplift read. This paragraph is left as written to record what was true on 2026-07-06.)*

## 5bc. Close the loop's loose ends: artifact alarms, honest watchdogs, one-variable measurements (2026-07-06 → 2026-07-07, v1.14.0)

Three small shipments with one shared theme — instruments that tell the truth cheaply.

**Alarm on the artifact, not the process.** The v1.11.1 retro (§5az) ended with a promised follow-up: make backup silence loud. v1.14.0 ships it, and the design choice matters more than the code: the alarm stats the *newest dump file's age* against `BACKUP_DUMP_MAX_AGE`, ignoring every process-level signal — container health, cron exit codes, service uptime — because all of those were green or unseen while pg_dump failed for three weeks. An existing-but-empty dumps directory counts as the failure state, not as "unconfigured": a wired-up job that has never produced output *is* the silent failure. Codified as `GUIDELINES §3` invariant 16. The web container already ro-mounted the backups volume, so the whole alarm is a filesystem stat — no new plumbing, no new service.

**A watchdog that cries over docs trains you to ignore it.** The prod-drift watchdog opened an issue over drift that was entirely documentation commits (#140) — GitHub serves those from the repo, so nothing merged was missing from production. v1.14.0 exempts docs-only drift (`docs/`, `REBUILD/`, root `*.md`). The general rule: every false positive a watchdog emits spends the trust its true positives depend on; scoping the alarm *is* maintaining the alarm. (Dispatching the edited workflow once after merge doubles as the registration check against the #54 trigger-less-YAML trap.)

**Classify a miss before diagnosing it — one variable at a time.** The published benchmark run skipped 6 of 30 cases ("relevant id not in pool"), which could read as an embeddings problem. One env-var re-run (`BENCHMARK_POOL_SIZE=50`) classified it: skips fell to 2/32, so most misses are knowledge at cosine ranks 21–50 — below production's top-20 prefilter — not absent from retrieval. KRA's lead holds at depth 50 (absolutes drop as harder negatives enter; compare deltas across pool sizes, never absolutes). The production lever (widen the pool) is deliberately parked as #146 until the Stage-3 gate: the freeze distinguishes *measuring* (always allowed) from *tuning* (earned).

**A gate without a baseline invites motivated reading.** Stage 3's criteria (≥60% closed-with-learnings, ≥40% injection→used, rolling 2 weeks) get their first honest reading 2026-07-17 ([issue #149](https://github.com/bejranonda/ExternalBrain/issues/149)). The baseline was recorded now — honest-window 75%/75% at n=4, with the caveat that pre-v1.13.0 sessions can't carry the used signal — so July's number lands against a fixed reference instead of a vibe. One scheduling honesty note banked along the way: the harness's in-session cron cannot survive to a date ten days out, and a reminder that *looks* automated but silently evaporates is worse than a visible one — the durable instruments here are the issue tracker plus session memory.

## 5bd. A written plan is a review surface in its own right (2026-07-13 → 2026-07-17, meeting-transcript-upload)

The meeting-transcript-upload spec+plan PR (#165) carried complete draft
code for every task, not just prose — so it went through CodeRabbit review
as a *document*, before Task 1 had written a single line of implementation.
It found four real bugs sitting in the plan's own code sketches: a
supersede path checking ownership but not project, a silent-failure mode
where a rejected teach call could leave the review UI with no visible
error, an assignee email trusted from client dropdown state with no
server-side re-check, and a React list keyed on array index. All four got
folded into the plan and shipped correct from Task 1 onward — none needed a
second review pass to (re-)discover them once code existed (see
`KNOWN_ISSUES.md §0o` for the issue-log framing of the same pass).

The lesson generalizes past this one PR: **when a plan document includes
draft code, review the plan like you'd review the diff.** The cost of a
finding is lowest before any code exists to hold it in place; a plan that
only gets prose-reviewed (architecture, sequencing, scope) while its
embedded code sketches go unreviewed until "the real PR" is deferring the
cheap half of the review to the point where it's expensive. Worth
deliberately requesting this class of review on future plan documents that
carry inline implementation, not leaving it to whichever reviewer happens
to read the code blocks in passing.

## 5be. Passing your own gate is the easy part; the honest reading is the work (2026-07-21 → 2026-07-23, v2.3.0, Stage 3)

Stage 3 of the flywheel-repair program was criteria-gated on the loop-health
panel: ≥60% of sessions closed-with-learnings AND ≥40% injection→used over a
rolling two weeks. The gate came due 2026-07-17 and then sat unread for four
days — the first lesson is banal and worth stating anyway: **a gate with a due
date and no owner is a gate that doesn't fire.** The issue tracker held it, but
nothing pulled it.

**Recompute the window relative to today, not to the due date.** Read on
2026-07-21, the rolling 14 days (07-07 → 07-21) fell *entirely* after the
v1.13.0 instrumentation went live — a cleaner window than the due-date reading
would have produced, since that one would still have straddled the
pre-instrumentation period. Being late accidentally improved the evidence. The
numbers: 16 opened / 16 closed / 10 with learnings (62.5%) and 16 injected / 12
used (75%). Both clear. But the mid-window preview on 07-10 had read 87% — so
the honest framing is "passing, with a thinner margin than the preview
suggested," not "comfortably passing."

**Report the split, not just the aggregate.** Per-project, the 16 closed
sessions were 11 from BrainPlatform's own construction work (10 with learnings,
91%), 4 from a V2 dry-run fixture project (learning-less by design), 1 stray in
`Default` — and *zero* from the three external repos where the Brain-first
protocol had been installed on 07-07. So the headline 10-of-16 (62.5%) is
really 10-of-11 on the platform's own dogfooding, pulled toward the bar by 5
sessions that were never going to teach anything. That's not nothing — it's real usage — but it is
emphatically not the "does this help on an independent workload" evidence the
gate was meant to produce. The reading was published with that caveat leading,
and the go/no-go was escalated rather than auto-proceeded: **a metric clearing a
threshold is not the same as a decision, especially when the next step
(shrinking file memory) removes a safety net.** The operator chose to proceed on
platform-only evidence; that choice is now recorded as a decision with its
justification, so a future session doesn't re-litigate it or mistake it for an
automatic consequence of the number.

**The mirror was aspirational.** Stage 3's first action was shrinking
`MEMORY.md` to a bootstrap stub, on the premise that the Brain was already
primary and file memory merely mirrored it. Auditing each entry against the
Brain before deleting the index found that premise was partly false: several
entries that *looked* like settled, load-bearing guardrails — "never commit real
client names," "the dev deployment holds real client data," "single-server,
single-main" — returned *not enough context* from the Oracle. They had been
written to file memory and never taught. Shrinking first and verifying later
would have silently destroyed live safety rails. The rule: **before collapsing a
mirror into its source, verify the source actually contains what the mirror
claims.** The gaps were backfilled, then the stub was written.

**Design the control arm so it can actually fail.** The generation-uplift
benchmark (#126) pits an agent with injected knowledge against the same agent
without it, graded by executable tests. Drafting the six tasks, one was caught
before any run: `safeJsonParse`'s edge case had been framed as "must never
throw," which a plain try/catch already satisfies for every input — the control
arm would have passed trivially and produced a meaningless tie. Reframed to
"non-string input must return the fallback without attempting to parse" (which
exploits `JSON.parse`'s surprising string-coercion), the naive implementation
genuinely fails. **Hand-run the naive implementation through every assertion
before trusting a benchmark's negative arm**; a task where the control can't
lose measures nothing.

**A positive result still gets its non-effects published.** Treatment 6/6 vs
control 4/6 — +33.3pp, zero regressions, n=6. Two tasks flipped; four tied at
100% because the base model already knew those conventions from training. The
tempting write-up reports the delta. The honest one reports that **four of six
tasks showed no effect at all**, and says why that's the more informative half:
this suite under-differentiates on textbook utilities and over-differentiates on
idiosyncratic house conventions — which is a fair picture of when a Brain
actually earns its keep, and simultaneously an argument that n=6 on generic
tasks undersells the production case. Both halves are in
`packages/core/generation-uplift/RESULTS.md`. Pre-registering the task list and
metric in a commit *before* the first run is what makes that claim checkable
rather than assertable; so is committing all twelve raw agent outputs.

**Deviations get disclosed, not smoothed over.** The pre-registered tests were
written for vitest; no vitest was installable in the checkout (Node 18, no
pnpm) and the deployed worker container had `tsx` but not vitest either. Rather
than quietly restate the result, the substitution — a `node:assert` harness
re-implementing the identical assertions, real timers instead of fake ones — is
documented as a deviation in both `README.md` and `RESULTS.md`, with the
original spec files committed so anyone with a working toolchain can re-grade
the same outputs. A benchmark's credibility lives in its disclosed deltas from
its own protocol.

---

## 5bf. Framing is load-bearing: three defects that hid behind their own descriptions (2026-07-28 → 2026-07-31, v2.3.1 → v2.5.1)

Three separate defects shipped in this arc. None of them was hard to fix. All
three were hard to *see*, and for the same reason: each was already written
down, in language that made it sound smaller than it was. The through-line is
that **a defect's recorded description is itself a piece of code that can be
wrong**, and a wrong one is worse than no entry at all — it converts an open
question into a settled one.

**1. "A soft cap on LLM cost" was an application-level auth-limit bypass.**
`KNOWN_ISSUES §0o`
carried `rateLimitCheck`'s non-atomic get-then-set as *deferred*, framed as a
cost-cap nicety. Both halves were wrong. The bucket advanced by **one per burst
regardless of burst size** — every concurrent caller read the same pre-increment
count — so a caller who simply kept requests in flight was never limited,
repeatably. And the helper guards the **auth surface**: voucher redemption (the
invite-code gate on a self-service Brain), register, forgot-password. Measured
against a real Redis in a throwaway container, 50 concurrent clients moved the
old counter to **2**, not 50.

*Scoped honestly:* this was a bypass of the **application** limiter, not of every
control. `deploy/Caddyfile` rate-limits `/api/*` at the edge to 10 events per IP
per second, ordered before `reverse_proxy`, so an attacker was never wholly
unbounded. But the edge limit is three-plus orders of magnitude looser than the
control it was masking — 10/second against a voucher gate intended to allow
10/**hour** — and being per-IP it does nothing against a distributed caller. So
the finding stands; "unbounded" did not, and the distinction is exactly the kind
this section is about. (Caught in review of this very write-up.)

The mis-framing wasn't carelessness — it was
written by someone looking at the one endpoint their PR touched, where "cost cap"
is a fair description. Hence the rule that came out of it: *enumerate the call
sites before you write the deferral rationale.*

**2. The Brain could not see half of its own corpus, and the metric said zero.**
Building a second generation-uplift suite whose treatment arm draws from the
**live** retrieval path — rather than a hand-written block — turned up a null on
the first probe. Chasing it: `scope: "user"` rows (the `brain_teach_knowledge`
default) carry the `ownerProjectId` of whatever session wrote them, and
the production filter (`buildRawProjectFilterV2`) resolves visibility from
`Knowledge.visibility` plus `ownerProjectId` and never consults `scope`, so those
rows matched no branch outside their writing project. **117 rows repo-wide** were
`scope='user'` with a non-null `ownerProjectId` — the affected set. Separately, and
not a partition of that 117: the corpus split roughly evenly across a catch-all
`Default` project (101 active rows) and the real one (100), which is what made the
starvation so large in practice. Fixing it moved a `Brain Platform` session's reach
from 104 to 141 visible rows. The
best-matching item in the entire corpus — 0.9009 similarity, exact trigger match,
eleven successful uses — ranked **first** unscoped and was **absent** from the
project-scoped session path. Meanwhile the duplicate-project detector reported
zero, because it looks for *normalized name collisions* and `Brain Platform` vs
`Default` will never collide. **An instrument that can only see one failure shape
reports health during a different one.**

**3. A watchdog and a standing rule that guaranteed each other's failure.** The
`prod-drift` workflow files an issue when the deployed tag differs from `main`'s.
The standing rule says don't redeploy for changes that touch nothing app-served.
Following the second reliably trips the first. The workflow *did* carry a
docs-only carve-out, but `.env.example` and the `generation-uplift/` benchmark
artifacts survived its filter — so the carve-out existed and didn't cover the
case it was written for.

### What generalises

**Read the whole helper, including the branches your case doesn't hit.** #174
looked like an open design question, and it was reported as one. It wasn't: the
no-active-project branch of `scope-filter.ts` already carried the exact fix,
added 2026-05-12 after "5/5 retrieval misses traced to this branch." The
active-project branches never got it. The project had decided; the decision had
been applied to one branch out of three. Escalating a settled question costs the
operator's attention and risks re-litigating reasoning that was already done.

**Green tests do not detect a boundary no test asserts.** The first version of
the #174 fix widened the shared filter for every caller, and the suite stayed
green. The caller audit — not the tests — found that `action-items.ts` treats the
project edge as the isolation line for tasks, and `meeting-extract.ts`'s
supersession search is deliberately project-wide but *not* owner-scoped. Both
boundaries lived only in prose comments. The fix became opt-in per call site,
which is what `GUIDELINES §7` already asked for: give cross-scope behaviour an
explicit path rather than quietly changing a shared function.

**Widening recall is not free, and the pass rate won't tell you.** After the fix,
the formerly-invisible item appeared in **all five** injected blocks regardless of
topic — real dilution. It cost nothing measurable, because each task's own rule
still ranked first. Both facts are invisible in the aggregate score; you only see
them by diffing what actually got injected.

**Publish the correction as loudly as the claim.** The first write-up of #174
named the wrong mechanism — it cited the V1 filter and asserted that
`Knowledge.visibility` does *not* govern retrieval, when production uses the V2
helper and visibility is exactly what governs it. The symptom was real; the cause
was not. Corrected in place, in the issue and in `KNOWN_ISSUES §0p`, and flagged
as a correction rather than quietly rewritten — a repo whose differentiator is
honest self-reporting cannot make stale *pessimism* an exception to that.

**The fix is part of the system too — review it like one.** Reviewing the #174
fix a day after shipping it turned up three further gaps: the Prisma and raw
scope helpers had come to *disagree* about the no-active-project case (a
divergence the fix itself introduced, and the same inconsistency class review had
already flagged one layer down); the fix had added an
unreachable branch (no caller passed the new flag); and — unrelated to #174, just
never looked at —
that helper silently dropped the user's own `visibility: 'project'` rows under
`?scope=all` with no org context, contradicting its own documented contract. The
generalisable part: **when two functions express one policy on two surfaces,
assert them against each other in the same test.** Testing each alone cannot see a
gap that lives between them, and "both are individually correct" is exactly how
that gap survives review.

**Check coverage before you add to something — and check it everywhere.** The
first version of this section claimed the helper had *zero* coverage. It didn't:
`grep -c` was run against one test file, and a second file covered it in 22
places. CI found the error by failing one of those tests. The correct habit is
`grep -rc <fnName> <test dir>` across the whole directory, and the correct lesson
is smaller but sharper than the one first written: **a coverage claim from a
single-file grep is not a coverage claim.** Reaching for the more dramatic version
of a finding is its own failure mode — the same one this section opens with.

**"It works in production" is evidence about the happy path only.** The Redis
rate-limit adapter had no tests and could not have any — every branch sat behind
the `client.eval` call inside `apps/web`, which needs workspace resolution to
run. It was easy to leave: it was small, fail-safe, and demonstrably clean under
live traffic. That comfort was exactly inverted. The untested branches were the
*failure* branches — malformed reply, `PTTL` of −1/−2, Redis unreachable — and
those never execute while things are healthy. Healthy traffic is not evidence
about them; it is the absence of evidence about them. The fix was not clever:
extract the pure decision into `packages/core` beside the contract it satisfies
and leave only the `eval` in the app, which is the seam pattern `GUIDELINES §4`
had already prescribed for LLM calls. The repo knew the answer; nobody had
applied it here.

**Extraction is a diagnostic, not just a refactor.** Moving that logic somewhere
it could be read on its own immediately exposed a hole invisible while it was
welded to the client: the parse accepted any numeric count, though `INCR` on a
counter this module owns cannot return below 1 — and a zero or negative count
from a foreign write would have made `check()` compute `ok` forever, granting
unlimited requests through the limiter guarding voucher redemption and password
reset. Nothing about the refactor was *intended* to find that. Code you cannot
test is usually also code you cannot see.

**A retraction applied in one place is not a retraction.** When review corrected
"unbounded auth bypass" to *application-level* bypass (Caddy caps `/api/*` at 10
req/s/IP at the edge), the correction landed in this file — and the identical
wording survived in `KNOWN_ISSUES §0o` and `GUIDELINES §"Rate limiting"` for two
more days, until an audit went looking. Corrections need the same
grep-the-whole-tree discipline as the claims they replace; a partial retraction
leaves the wrong version in the places a reader is most likely to hit first.

**A gate that cries wolf gets switched off — so design for the negative case
first.** The benchmark-doc coherence gate exists to stop a `kra.ts` retune
landing with stale published numbers. The obvious implementation — fail if
`kra.ts` changed without `VALIDATION.md` — would have blocked this very arc's
issue #174 work, which edited that file without moving a single weight. It compares
constant *values* across the merge base instead, so refactors and comment
rewrites are invisible to it. Both outcomes need a test, and the repo has both: a value change to `WEIGHTS`
without a `VALIDATION.md` update **must fail** (verified by simulating a
`0.7 → 0.65` retune), and a refactor-only change **must pass** (verified across
`v2.4.0..v2.5.0`, a real PR that edited `kra.ts` and moved nothing). The one
that shaped the design was the second, because a contributor who trips a gate
they consider wrong does not fix their PR — they campaign to delete the gate.

**Every new never-shipped path re-opens the drift hole.** Adding that gate's
script would itself have opened a false `prod-drift` issue the next morning:
`scripts/` was not in the not-app-served exclusion set, so a release containing
nothing the container runs looked like un-deployed work. Same failure the
exclusion set was built to prevent, one release later. The lesson is not "add
`scripts/`" — it is that an exclusion list is a *liability that accrues*: every
new top-level path is a chance to re-open it, and the only reliable check is
asking the running containers what they actually contain rather than reading the
Dockerfile and inferring.

**Four overclaims, one pattern.** "Unbounded auth bypass" (Caddy bounded it),
"zero test coverage" (22 tests in a sibling file), the #174 root-cause mechanism
(wrong helper named), and "V1 has no cross-project reach *at all*" (it does,
under `DataScope: "all"` — the gap is the project-scoped path). Each underlying
finding was real; each superlative was not. The tell is the same every time: the
absolute arrives before the verification, because it is the version that makes
the finding sound worth reporting. Worth naming as a habit rather than four
separate slips — and worth noting that review caught all four, which is an
argument for review rather than for trying harder.

**Independent review is not optional when the bot didn't read the diff.** Six PRs
in this arc came back with a green CodeRabbit check; four of them had **zero**
inline comments, which the repo already knows means a rate-limited bot rather
than a clean bill of health. Reviewing those four by hand turned up the finding
this section closes with: the pre-Phase-4 V1 scope helpers never got #174's
cross-project reach, and three surfaces still call them — so
`buildRulesBundle` exports a rule set that disagrees with the one the Brain
serves. Nothing in CI would ever have said so, because nothing in CI knows the
two should agree.

**A measurement that doesn't reach the component that acts on it hasn't landed.**
Both uplift suites concluded the same thing — injected knowledge changes output
where a convention is locally arbitrary, and ties on general craft — and that
conclusion sat in `VALIDATION.md` for days while KEA carried on extracting craft.
Sampling the live corpus put a number on it: of the 18 most recent extractions,
**3 hand-classified as locally arbitrary and 15 as general craft** — a judgement
call, which is why `VALIDATION.md` publishes the raw rule texts so a reader can
disagree with the split. The finding was published,
agreed, quoted back in session injections, and had changed nothing about what the
system stored. The fix was a prompt edit, not a ranking change — the corollary of
"injecting craft ties" is "extracting craft is wasted capture effort", and that
corollary lives in `kea.ts`, not `kra.ts`. Worth asking of any published result:
*which component would have to change if this is true, and did it?*

**Twice the recommendation was wrong, not the execution.** Asked to finish the
V1→V2 scope migration I had myself proposed, checking first showed V2's
`visibility: 'project'` arm carries no `ownerUserId` predicate — that absence is
exactly what makes org sharing work — so migrating a *personal* surface would
have started returning teammates' rules inside a change labelled "finish the
migration". And the pre-registration for the KEA change used three different
units for one metric (rules, extractions, sessions), which would have let the
threshold be chosen after seeing results — the precise failure pre-registration
exists to prevent, occurring inside the pre-registration. Both were caught by
verifying before acting, neither by being more careful while acting. Advice given
at a distance from the evidence is a hypothesis, including your own from an hour
ago.

**"Latent-correct" is an honourable outcome; claiming it is user-visible is not.**
The exporter fix genuinely widened its query from 146 to 183 rows, matching what
retrieval serves. Measuring it after deploy showed `buildRulesBundle` also filters
`tags: { has: "rules-export" }` and **zero rows carry that tag for any user**, so
the bundle is empty regardless and nothing observable changed. The PR had
described a live symptom. Fixing a real latent defect is worth doing and worth
saying plainly — but a fix to one clause can be masked entirely by another filter
downstream, and only measuring the whole query tells you which you have. That
measurement also surfaced the larger fact: the export surface returns nothing for
everyone, because its only production writer is autoskill *approval* and no
proposal has been approved.

**And the benchmark result worth keeping** is not the headline percentage
(+33.3pp then +40pp, both small-n) but the shape underneath it, which two
independent suites now agree on: injected knowledge changes the output where the
convention is **locally arbitrary** — a workspace subpath, a build-pipeline
quirk — and ties wherever it coincides with general good practice a strong model
already applies. That is a directly actionable capture strategy, and a much more
defensible claim than the number.

---

## 5bg. The sibling problem — a four-pass audit that found one bug eleven times (2026-08-02, v2.8.0)

A structured pre-release audit ran four passes over the codebase — onboarding
and DX, MCP + multi-tenancy security, worker and DB reliability, deployment and
i18n — each written up in [`docs/pre-release/`](./pre-release/). The headline
result was reassuring and unsurprising: **zero CRITICAL findings**, no
cross-tenant leak, no auth bypass, no secret exposure. The interesting result
was the shape of what it *did* find.

### What generalises

**Eleven findings, one pattern: hardening that never reached its siblings.**
The clipboard was correctly guarded in four call sites and unguarded in three.
The 429-retry lesson was learned in `embedding.ts` and never carried to
`llm.ts` — the seam every KEA, autoskill and meeting-extract call goes through.
Token project-scope was enforced on all five write tools and none of the four
read tools. `captureError` wrapped four worker handlers and not the other five.
Rate limiting covered `/api/*` and not `/mcp`. Every one had a working
implementation sitting a few files away.

This is a good problem — the fix is always cheap — but it is invisible to the
process that created it. Each original fix was correct, reviewed, and merged.
Nothing in a PR review asks *"which sibling call sites did this just make
inconsistent?"*, so the answer was never written down. It is now a standing
question in [`GUIDELINES §4`](./GUIDELINES.md#4-testing). The generalisation
beyond this repo: **a defect class is a property of a codebase, not of a line.
Fixing the reported instance is roughly a fifth of the work**, and the other
four fifths are a `grep` away.

**A test that can pass for two reasons verifies neither.** The sharpest finding
was not a vulnerability but a test. `security.spec.ts` asserted that
`tools/list` with a bogus Bearer returned `>= 400`. It was green for years. It
was green because a session-less `tools/list` is rejected by the MCP SDK with
"Server not initialized" — the bearer was never consulted, and **the assertion
would have stayed green with authentication removed entirely.** Sending
`initialize` with the same junk token returned `200`, a live session, and the
full tool catalogue.

The failure mode is specific and worth naming: a negative assertion (`it
failed`) on an outcome with multiple causes proves only that *one* of them
fired. It reads in review as coverage, which makes it worse than no test — a
missing test invites scrutiny, a passing one closes the question. The rule that
came out of it: assert the exact status, assert the absence of the thing that
would leak, probe the method that actually reaches the check, and confirm the
test goes red when you break the control.

**Structural checks beat inventories, because the inventory is only as good as
whoever wrote it.** The i18n gap was reported as "four missing keys" after a
`grep`-based extraction. That was wrong twice over. The extraction was flat, so
nested sections collapsed and *nine* keys under `decisions` — the entire section,
absent from both non-English locales — hid behind identically-named keys
elsewhere. A corrected nested diff found those nine. Then the fix itself, a
recursive `DeepStrings` type lock added to *prevent future* drift, immediately
found a tenth that both diffs had missed: `oracle.tagline`, on one of the most
viewed surfaces in the app.

Three attempts by a careful reader, three different answers; the type checker
got it right on the first run and will keep getting it right. Where a rule can
be expressed structurally — a type, a lint, a CI gate — expressing it as a
checklist item is a decision to re-derive it by hand forever. And the reason
this particular gap survived so long is worth holding onto: `translate()` falls
back to English, so the failure rendered as *slightly wrong* rather than
visibly broken. **Graceful degradation is a bug-preservation mechanism.** It is
still right to degrade gracefully; it is also why the detection has to be
structural, because the symptom will never be loud enough to prompt a look.

**The best finding came from tightening an assertion, not from reading code.**
Changing `expect(status).toBeGreaterThanOrEqual(400)` to `expect(status).toBe(401)`
turned a silent pass into a red build — and the red build revealed something the
static audit had missed entirely: the two "MCP HTTP transport refuses…" tests
were resolving their endpoint as `E2E_BASE_URL ?? localhost:3100`, and the CI job
sets `E2E_BASE_URL` to the **web** origin while booting only the web app. Both
tests had been POSTing to `/mcp` on Next.js and accepting its 404. They had never
contacted the MCP server at all.

That is a strictly worse defect than the one I filed (a test probing the wrong
*method*), and no amount of further reading would have surfaced it — I had
correctly identified that the assertion was too loose without noticing it was
also pointed at the wrong process. The lesson is procedural: **when you suspect a
test is vacuous, the cheapest proof is to tighten it and watch what happens.**
A test that was truly covering its control goes green; one that wasn't tells you
why in the failure output. In this repo the same suite had already been added in
2026-07 because its specs "had never actually run in CI" — the second-order
version of the same problem, one layer down.

**Say what the audit got wrong, in the audit.** Two Pass-4 findings were
overstated: `.env.example` was called misleading when most of its dead keys were
already annotated `# aspirational` — I had read the key names and not the comment
column — and the i18n count was less than half the real number. Both carry
in-place `CORRECTION` blocks in the reports rather than quiet edits. An audit is
a document whose entire value is that a reader can trust its claims without
re-deriving them; silently improving one's own findings destroys exactly that,
and the same argument already applies to `§5bf`'s retraction and the #174
correction in `KNOWN_ISSUES §0p`.

**Read the dependency's types before assuming its API.** The graceful-shutdown
handler shipped with `boss.stop({ wait: true })`, an option carried over from an
older pg-boss. CI caught it as a typecheck error. Unpacking the published
package showed `StopOptions` is `{ close?, graceful?, timeout? }` — and, more
usefully, that `stop()` *already performs the bounded drain itself*: it polls
`hasPendingCleanups()` up to `timeout`, then runs `failWip()` and closes the
pool. The hand-rolled bail timer wrapped around it, which called `process.exit(0)`
on expiry, was therefore not merely redundant but actively harmful — it would
have skipped exactly the cleanup the handler existed to perform. **The correct
implementation was simpler than the guess**, which is the usual shape of this
mistake: writing defensive scaffolding around a library because you didn't read
what it already guarantees.

**A verdict is more useful than a list.** Four passes produced ~2,400 lines and
several dozen findings, which on its own would have been a backlog rather than a
decision. Sorting them into *five release blockers*, a ship-with bucket, and an
accept bucket — with the two deferred HIGHs carrying explicit containment ("do
not describe project-scoped tokens as an isolation boundary until this lands") —
is what turned the audit into something that could be acted on in a day. The
finding count is the input; the GO/NO-GO is the deliverable.

---

## 5bh. Two halves of one promise — org sharing that neither read nor wrote (2026-08-03, v2.10.0)

`AGENTS.md` had told every agent, for months, that *"Decisions are shared
project memory: a teammate's next `brain_start_session` surfaces them."* It was
false. Making it true took fixing two independent things, and the interesting
part is that fixing either one alone would have left the sentence exactly as
false while looking like the job was done.

**The read half** was the one the audit found: nothing on the MCP path ever
populated `accessibleProjectIds`, so retrieval fell to its empty-list branch
and — behind the `ownerUserId` pin — returned only the caller's own rows.
Phase-4 org visibility worked in the webapp, which is the surface people use
least.

**The write half** only surfaced while building the fix, and would have made
the whole exercise pointless: `brain_teach_knowledge` never set `visibility`,
so it defaulted to `'project'` — which the owner gate deliberately does *not*
share across users. Every "decision" ever captured over MCP was project-private
to its author. Retrieval could have been perfect and still returned nothing,
because there was nothing marked shareable to return.

### What generalises

**A documented behaviour with two mechanisms has two ways to be false, and one
of them will not show up in the component you're fixing.** The read path was
where the symptom lived and where the audit looked. The write path was upstream,
had no symptom of its own, and was only visible once you asked "what
*visibility* do the rows we're trying to share actually have?" The habit worth
keeping: when restoring a promised behaviour, trace the full round trip —
producer through storage through consumer — and check what each end assumes the
other did.

**Widen a security boundary by adding a bounded disjunct, never by relaxing the
pin.** The obvious implementation was to drop the `ownerUserId` filter and let
`buildRawProjectFilterV2` decide, since it already has an org arm. That would
have been a real cross-tenant leak: the filter's `visibility='project'` arm
deliberately carries *no* owner predicate, and nothing on the retrieval path
verifies that a client-supplied `projectId` belongs to a project the caller can
reach. The pin was the only thing making that arm safe. What shipped instead
keeps the pin and ORs one narrowly-bounded clause beside it — `visibility='org'`
only, in a membership-verified project list computed server-side. With an empty
list the emitted SQL is byte-identical to the previous form, so every caller
that doesn't opt in is *provably* unaffected rather than argued to be.

**Verify a security boundary by running it, not by reading it.** The unit tests
assert the SQL's shape; they cannot tell you what Postgres does with it. The
check that actually settled it was a throwaway `pgvector` container with six
rows spanning three users and two orgs, executing the *exact* generated
statement. The result table is the artifact worth keeping: own rows ✅,
teammate's `org` row ✅, teammate's `project` row ❌, teammate's `private` row
❌, another org's `org` row ❌. That is a claim a reviewer can check in a minute;
"I read the predicate carefully" is not.

**The fix reproduced the bug it was fixing, and the review caught it.** The
first draft inlined the new owner gate at both `kra.ts` and `oracle.ts` — two
copies of one security predicate, which is precisely the sibling-drift pattern
this whole audit arc was about (`§5bg`). It was extracted into `buildOwnerGate`
before landing. Knowing a failure mode by name does not stop you writing it; the
value of naming it is that you recognise it a few minutes later instead of a few
months later.

---

## 5bi. Two decisions worth writing down, one of which was to build nothing (2026-08-03, v2.10.1)

### Declining a schema change is a result, not an absence of one

The open question after the audit was whether `Skill` should gain an
`ownerProjectId` so project-scoped tokens could confine skill reads the way
they now confine knowledge reads. The answer is no, and the argument that
settles it is not about cost:

**There is no correct backfill.** A skill is distilled from work that may span
several projects, so every existing row would have to be either NULLed — which
silently hides every existing skill from scoped tokens — or assigned a project
arbitrarily, which is fabricating data to satisfy a schema. When a migration's
backfill has no truthful value, that is usually the schema telling you the
column doesn't belong on that table.

The second reason is directional: `Knowledge` is atomic and project-bound, but
a Skill is a *portable recipe* — `BLUEPRINT §11.2` plans to sell them as packs
and the exporter writes them into `.claude/skills/` and `.cursor/rules/`.
Partitioning a thing designed to travel between projects works against its own
roadmap. `Skill` already has `scope` and `ownerTeamId`; the absence of a
project axis is a statement, not an oversight.

And when the underlying worry is real but the proposed mechanism is wrong, name
the right mechanism rather than shipping the wrong one: if a contractor's token
must not read skills, that is a **token capability** (`read:knowledge` without
`read:skills`) — one column, no backfill, and it generalises to every surface
added later.

### Put the gate where the artifact is

The other question was where to catch a broken healthcheck. The instinctive
answer is CI — boot the compose stack on every PR. The better answer was the
deploy.

A healthcheck describes a *running container*. CI would boot a reconstruction
of one, cost minutes on every PR, and duplicate what `deploy.sh` already does;
its only marginal benefit is catching the fault before *merge* rather than
before *traffic*. With autonomous-deploy-on-green, before-traffic is the
boundary that actually protects the instance. So the assertion went into
`smoke.sh`, fifteen lines, running against the artifact that was actually
shipped.

Two details did more work than the check itself:

- **"Nothing is unhealthy", not "everything is healthy."** `caddy` declares no
  healthcheck. A gate that failed on services which never declared one would
  cry wolf on every run — and a gate that cries wolf gets switched off, which
  is how you end up with no gate at all. Tolerating the undeclared case is what
  makes the gate survivable.
- **Print the probe output on failure.** The original bug was undiagnosable
  from the deploy log; it took a manual `docker inspect`. A gate that tells you
  *that* something failed, without telling you *why*, only relocates the work.

Both were verified in both directions — passing against the live stack, and
failing against a container deliberately broken with the *same* `require('pg')`
probe that caused the original incident. A gate that has only ever passed has
not been tested; it has been observed.

---

## 5bj. The surface found the bug in the first five minutes (2026-08-04, v2.11.0)

The dead-letter queue and its admin tile were built to close an audit finding:
a job that exhausted its retries moved to `failed` in `pgboss.job` and nothing
ever read it. Routine work, closing a known gap.

Validating the new endpoint's SQL against the live database returned a row:

```
kea.cross_extract | failed | 1
```

Following it produced a defect nobody had reported and nothing had detected:
`kea.cross_extract` had failed **eight nights running, from 2026-07-28**, on
`model=glm-5.1 routes to DashScope but DASHSCOPE_API_KEY is unset`. Cross-session
extraction — a daily job — had simply not happened for over a week, while every
health check, smoke test and lockdown audit reported green.

The cause was the pattern this whole audit arc keeps finding. `oracle.ts`
decided provider with a predicate that treats `ANTHROPIC_BASE_URL` as "a
gateway fronts everything, pass provider-native model names through verbatim".
`llm.ts` had its own rule that sent `glm-*` to DashScope and never consulted
the gateway. Same model string, two dispatchers, opposite destinations — so the
Oracle worked and everything behind `callLLMText` died.

### What generalises

**Observability finds bugs on the way in, not just later.** The value of a
status surface is usually argued in the future tense — *when* something breaks,
you'll see it. This one paid for itself before it shipped, because building it
required looking at data nobody had looked at. If you are adding a monitor and
its first real query returns something you cannot explain, you have already
found the thing the monitor was for.

**"No alert fired" is not evidence when nothing was listening.** Eight failures
produced eight `captureError` calls that went nowhere useful, and eight rows in
a table with no reader. The system was not quiet because it was healthy; it was
quiet because silence was the only sound it could make. Distinguishing those two
states is the entire job of a health surface — and until one exists, "we'd have
noticed" is a belief, not a fact.

**A defect class does not stop at the fourth instance.** The audit found one
rule implemented twice in four places — clipboard hardening, 429 retry, token
scope, `captureError`. This is the fifth: provider routing. Each was a correct
fix applied to one site and not its sibling, and each survived because nothing
in review asks *which other place implements this same rule?* Four instances
felt like a finding; five suggests the question belongs in the PR template, not
in a document someone reads once.

**Cheap fixes hide expensive bugs.** The dead-letter queue was rated MEDIUM and
deferred twice as "worth doing whole, not half". It was, in the end, thirty
lines — and the thing it exposed had been costing a daily job for eight days.
The cost of a monitor is visible up front; the cost of not having one is
invisible by construction, which is exactly why it loses the prioritisation
argument every time.

---

## 5bk. Three mistakes on thirty lines — verifying the nearest signal instead of the property (2026-08-04, v2.11.0 → v2.11.2)

The dead-letter queue was the smallest item on the list: route three queues to
a terminal inbox, add an admin tile. It took three attempts, and every failure
passed the check that was supposed to catch it.

**Attempt 1 — `expireInSeconds` where `retentionSeconds` was meant.**
pg-boss asserts a 24-hour ceiling on expiry, so `createQueue` threw before any
handler registered and the worker crash-looped **in production**. Every
background job was down until the hotfix. I had opened the type definitions and
confirmed the option existed — three lines above the one I wanted — without
reading what it meant.

**Attempt 2 — the health gate waved the crash-loop through.** The
container-health check added the day before warned on `starting` and passed. At
smoke time the crash-looping worker was inside its 40 s `start_period`, so the
deploy printed an amber note and reported green.

**Attempt 3 — the feature installed successfully and did nothing.**
`createQueue` is a no-op on an existing queue; it does not reconcile options. On
any brain that has run before — every real one — `deadLetter` silently never
attached. The `dlq` row appeared, `dead_letter` stayed NULL on all three source
queues, and every signal said success.

### What generalises

**Verify the property, not the nearest signal.** Each failure had a check
sitting one layer short of the thing that mattered:

| I verified | I should have verified |
|---|---|
| the option exists | what the option *means* |
| smoke is green | the worker is *healthy* |
| the `dlq` row exists | jobs *route* to it |

The nearest signal is always cheaper to obtain, always correlates with success,
and is exactly what a defect can satisfy while the real property is false. The
tell is that the check can pass in a world where the feature doesn't work — if
you can describe that world, the check is the wrong one.

**A gate that tolerates "not yet known" is worst precisely when it matters.**
`starting` is a third state between healthy and unhealthy, and treating it as
"probably fine" means reporting green during the window a fresh deploy is most
likely to be broken. It now waits for the state to resolve and fails if it never
does. Unknown must resolve to failure in a gate, or it is not a gate — a lesson
this same check needed **twice in two days**, having previously shipped a
healthcheck that could never pass.

**Speed is where verification discipline goes to die.** Every one of these was
caught by the discipline this same audit arc had been insisting on for a day —
read the installed types, query the database, don't trust the checkmark. They
happened anyway because the item was small and the session was long, and small
items are where you stop doing the thing you know to do. The audit's own
findings were produced by patience; its regressions were produced by pace.

**Publish the count.** Three corrections on thirty lines is a bad ratio and
belongs in the record at full strength. A changelog that shows only the final
working state teaches nothing, and the next person to add a queue option will
reach for `expireInSeconds` for exactly the same reason I did.

---

## 5bl. The same test, applied twice, gave opposite answers (2026-08-04, v2.12.0)

Two schema questions arrived a day apart. Should `Skill` gain an
`ownerProjectId` so scoped tokens could confine skill reads? Should `MCPToken`
gain a `capabilities` column so a token could be limited to knowledge without
skills?

Both are "add a column to a live table". The first was declined and the second
built, on one criterion: **does the new column have a truthful value for every
row that already exists?**

For `Skill.ownerProjectId` it does not. A skill is distilled from work spanning
several projects, so every existing row would be either NULLed — silently
hiding every existing skill from scoped tokens — or assigned a project
arbitrarily, which is inventing data to satisfy a schema.

For `MCPToken.capabilities` it does, and exactly: `[]`, meaning unrestricted.
Every token keeps precisely the authority it had. Nothing is guessed, nothing
changes on deploy, and the migration is provably behaviour-preserving rather
than argued to be.

### What generalises

**"What is the honest value for existing rows?" is the cheapest schema test
there is.** When the answer is a shrug, the column usually belongs somewhere
else, or the concept belongs on a different table. It costs one question and
routinely saves a migration that cannot be rolled back cleanly.

**Design the default so the common case needs no decision.** Empty-equals-
unrestricted means an operator minting an ordinary token ticks nothing and gets
what they always got; only the deliberately-narrow case involves any thought.
A default that requires a choice is a default that will be chosen wrongly under
time pressure.

**Allow-list, not deny-list, for anything that will grow.** Both were
implementable. A deny-list would silently grant every capability added later to
every token someone had already restricted — the failure arriving months after
the decision, in a release note nobody connects to it. An allow-list fails
closed as the surface expands, so the worst case is a token that does too
little and says so.

**Restrict what is worth restricting, and say why the rest isn't.** The
session-lifecycle tools carry no capability check. A token that cannot open a
session is not a restricted token, it is a confusing spelling of "revoked", and
offering that switch would produce credentials whose failure mode is a support
ticket. Writing that reasoning next to the exemption is what stops someone
"completing" the feature later.

## 5bm. The mechanisms nobody watches (2026-08-05, v2.13.0 prod redeploy)

A routine redeploy — pull `main`, apply two additive migrations, rebuild three
services. The code half was uneventful: 678 unit tests green, typecheck 9/9,
build 6/6, lockdown audit PASS, zero errors in any container log. Every gate
this project has built for itself passed on the first attempt.

Then the smoke test failed on TLS, and pulling that thread found two
production defects that had been live for **months**, both invisible to every
one of those gates:

1. **Nightly backups had never written a single file.** The `backup` service
   carried `profiles: ["edge"]`. Only `deploy.sh` passes `--profile edge`, and
   the nginx-fronted host cannot run `deploy.sh` — its Caddy sidecar collides
   with the nginx already bound to :443. So on the host that actually holds
   user data, the backup container had never started. Independently, its image
   was pinned `postgres-backup-local:15` against a `pgvector:pg16` server, and
   `pg_dump` refuses to dump a newer server — it would have failed silently
   even if it had started.
2. **A renewed certificate was never served.** `mcp.brain.autobahn.bot` had
   been serving a cert that expired 11 days earlier, breaking every MCP client
   with `HTTP 000`. The renewal machinery was fine; `certbot renew` printed
   "Congratulations, all renewals succeeded". But nginx re-reads certificate
   files only on reload, and no certbot deploy hook existed — so it kept
   serving the expired cert out of memory, indefinitely, while the new one sat
   correctly on disk.

The order matters. Finding (2) is what made anyone look at (1), and (1) was
discovered at the worst possible moment: immediately after the operator had
asked to wipe the database and rebuild from scratch. The wipe was declined for
policy reasons, and only then did checking the backup volume reveal there was
nothing to restore from. Had the policy gate not held, the data would have
been unrecoverable — not because anyone skipped backups, but because everyone
believed backups were running.

### What generalises

**An automated mechanism is not verified until you have inspected its output.**
Not its status, not its exit code, not its own log line claiming success. The
backup container was `Up (healthy)` for two months with an empty volume.
Certbot's success banner was *true* — it did renew the certificate — and
completely disconnected from whether any client could establish TLS. Both are
the "nearest signal" failure (§5bk) applied to scheduled work, where it is
worst: nobody is watching, so the gap between signal and property can persist
for months instead of minutes. Check the artifact and its freshness — count
rows inside the dump, read the certificate off the wire.

**Opt-in durability is not durability.** The profile gate was defensible in
isolation: backups were introduced alongside the Caddy deployment path, so
attaching them to `edge` was locally reasonable. But a backup you must
remember to enable is indistinguishable from no backup right up until the
restore, and the operator who most needs it is the one who never learned the
flag exists. Coupling was the specific error — backups are orthogonal to who
terminates TLS — but the general rule is that anything protecting against data
loss defaults **on**, and the exotic deployment opts *out*.

**A fix that requires a second fix to take effect is not a fix.** The `:15` →
`:16` image bump shipped in v2.13.0 and was correct. It also changed nothing,
because the service it corrected still never started. Two independent causes
with one shared symptom — an empty volume — and either alone was sufficient.
When a defect has more than one cause, fixing the one you found first produces
a changelog entry, a closed ticket, and an unchanged system. Ask what *else*
would have to be true for the symptom to clear.

**Prefer failure modes that announce themselves.** Every defect in this pass
was silent: no unhealthy container, no non-zero exit, nothing in a log anyone
reads. The platform already treats this as its most expensive bug class
(README §"Operating a Brain"), and the response has been to build surfaces
that look — `/api/admin/backup-status` alarms on dump age precisely because a
previous backup failure hid for three weeks (§5az). That surface existed here
and would have caught this, had the service ever run to produce a first dump
to age. **A freshness alarm cannot fire on a thing that has never existed
once**; monitor for absence, not only staleness.

## 5bn. The verification that measured the wrong system (2026-08-06)

The immediate sequel to §5bm, and its sharper form. Having just spent a
session on mechanisms that report success while producing nothing, the agent
recorded the lessons into the Brain — the product's own dogfood — and verified
the loop properly: teach five rules and record one decision, reopen a session,
confirm retrieval injected them, close with `SQS 88`. All six calls returned a
real knowledge id. The round-trip was genuine.

It ran entirely against the **dev** Brain. The operator had re-onboarded the
MCP token to prod mid-session, but Claude Code binds its MCP configuration at
session start, so the open client kept using the connection it already had.
`~/.claude.json` said prod; the live socket said dev. Nothing errored at any
point, and the agent reported the loop "verified end-to-end" — which was true
of a system nobody was asking about.

It surfaced only on the next day's restart, when `brain_get_user_style`
returned **0 reflexes** where it had returned ~30. That number was the whole
signal, and it is one an agent is strongly disposed to wave through: the call
succeeded, an empty list is not an error, and "no knowledge yet" is a
perfectly ordinary state for a fresh instance. Querying the prod database for
the six ids settled it — 0 rows.

### What generalises

**A round-trip test proves the loop is closed; it says nothing about which
loop.** §5bm's rule was *inspect the output artifact, not the status*. This is
that rule applied to the verification itself: the artifact was inspected, it
existed, it was correct — in the wrong database. When a check can pass against
the wrong target, **the target is part of what you are checking**. Resolve
identity (URL, hostname, connection string) and assert the artifact exists
*there*, rather than asserting that a call returned an id.

**Empty is a question, not a pass.** Zero rows, zero reflexes, an empty list —
never errors, always consistent with "you are querying a different system than
you think". The instinct to treat a non-error response as confirmation is what
would have kept this hidden indefinitely; the discipline is to ask *which
instance answered* before drawing any conclusion about the data.

**Config-on-disk is not connection-in-use.** Any long-lived client that reads
configuration once — MCP clients, connection pools, a shell that has already
exported its environment — will keep using what it bound at start. Rewriting
the file is not repointing the client. The installer already printed "Restart
Claude Code first", but as a note about tool visibility, so it read as
convenience rather than *"until you do, your writes go elsewhere."* Guidance
that describes the remedy without naming the consequence gets skipped exactly
when it matters.

**The diagnosis needed access the affected user doesn't have.** The only
conclusive check was a `SELECT` against the Postgres container — unavailable
to a self-hoster on a managed host, and to every non-admin user, i.e. to
precisely the people this fails for. A failure diagnosable only from the
server is undiagnosable where it occurs. That gap is filed as open in
`KNOWN_ISSUES §0t` rather than quietly closed: a `brain_whoami` returning the
resolved instance, token identity and owned-knowledge count would reduce it to
one call, and not building it yet is a choice worth stating.

**Recovery was a decision, not a repair.** The stranded rules were left on dev
and prod restarted clean, recorded as a `decision`-tagged project rule so a
later session doesn't read the asymmetry as damage and try to reconcile two
divergent stores. Choosing which history to keep is cheaper than merging both,
and writing down *that you chose* is what stops the question being reopened.

## 5bo. A test can be right about the code and wrong about the world (2026-08-07)

The operator's message was five words: *"gemini cli change to antigravity cli
already."* Following it up found more than a rename to apply.

Google retired Gemini CLI for consumer accounts on 2026-06-18 — seven weeks
earlier — folding it into a new Go-based Antigravity CLI. Enterprise access
continues on the old name, which is exactly the kind of detail that makes
"just rename the label" the wrong fix. The merge also moved the MCP config
file: the Antigravity IDE and the new CLI now share one path,
`~/.gemini/config/mcp_config.json`. The installer had been emitting
`~/.gemini/antigravity/mcp_config.json` — correct in v1.7.0 when written,
silently wrong for the six weeks since.

The JSON shape it generated was not the problem. `mcpServers` → `serverUrl` +
`headers` was re-verified against Google's current docs and is still exactly
right. So the failure mode was specific and quiet: a user pasted a
syntactically perfect config into a directory the client had stopped reading.
No error. No failed connection to debug. Just nothing, ever, with no reason
offered.

### What generalises

**Every bug this week up to this one was reachable by a sweep across surfaces
this repo controls** — all 11 install-client shapes (`§0u`), all ~24 routes
(`§0v`), all 3 token models (`§0w`), every caller of an email predicate
(`§0y`). Each had the same fix: write one test that ranges over every N,
because per-item review cannot see "one of N disagrees with the rest."

This one breaks that pattern, and it matters to say so plainly: **there is no
sweep for a fact about a system you do not control.** The failing assertion
here was `configPath.win32.toContain("antigravity")` — which the *dead* path
also satisfied, so it kept passing precisely because it was pinned to the
value that went stale. A test can be perfectly correct about what the code
does and simultaneously wrong about whether that's still the right thing to
do, and no amount of internal rigor closes that gap. The vendor's docs are the
only source of truth for a vendor's own file path.

**The tell, and the only defense available:** any hardcoded fact about an
external product — a config path, a field name, a provider's base URL, a
CLI's supported flags — is a claim with a shelf life the codebase cannot see
expiring. The practical response isn't more internal testing; it's treating a
vendor's rename, merger, retirement, or API-version bump as a trigger to
re-open the docs and re-check anything pinned against it. That habit doesn't
show up as a green check. It has to be a habit.

**Kept the retired option rather than deleting it, once the reason was found.**
Consumer Gemini CLI access ended; enterprise access did not. Deleting the
`geminiCli` snippet outright would have silently stranded whichever pilot
users are still on the enterprise path — a decision nobody had actually made,
arrived at by tidiness. Relabelling it "legacy" and pointing its note at the
successor served both populations; removing it would have served neither and
looked, from the commit, like the more thorough fix.

## 5bp. A page fixed three times had one bug the whole time (2026-08-09)

`/welcome` took three separate fixes in one session: a raw i18n key on
screen, a tool list stale against the client registry, a landing-page link
that (correctly, at the time) pointed at it as the install flow. Each fix
was reviewed, correct, and shipped. None of them was the actual problem.

The actual problem surfaced only when the operator asked a different kind of
question — not "is this fix right" but "does this page still need to exist
in this shape, given `/start` and the quick-start tutorial now exist too."
The answer was no: `/welcome`'s tool-picker and install command had migrated
to better homes weeks earlier, and every subsequent "fix" was polishing
content that should have been deleted, not repaired.

**The generalisable tell:** a page needing its second unrelated small fix in
one sitting is a specific, checkable signal — not proof, but reason enough to
stop and ask the structural question before shipping fix number two. A diff
review answers "is this change correct" by construction; it cannot answer
"should this content exist here at all," because that question is about
everything the diff *doesn't* touch. The two questions need to be asked
separately, and only the second one catches this class.

This is `§5q`'s discipline ("enumerate before you close") aimed at pages
instead of bug patterns: once the structural fix is decided, it does not
stop at the one file that prompted the question. Grepping `href="/welcome"`
across `apps/web` — rather than trusting memory of who might link there —
found three more callers still treating it as an install flow, including
`landing.tsx`, itself patched to point at `/welcome` in an *earlier commit
the same day*. That is not a contradiction to paper over; it is what
"content moved" looks like from the outside; a link is correct until the
page underneath it changes shape, and nothing announces when that happens.

Full instance: `KNOWLEDGE.md §12.34`. Mechanical rule from it:
`GUIDELINES.md`, "removing or narrowing a page's job."

## 5bq. A green build proves the file exists, not that clicking it works (2026-08-10)

Every relative link in `docs/tutorials/*.md` — every "Where next" table,
every "See Tutorial N" cross-reference, in every language — had 404'd in
the deployed app since tutorial rendering shipped. `pnpm turbo run build`
passed the whole time; so did the `doc refs (no phantom PRs)` CI check,
which greps prose for phantom PR numbers, not whether a relative link
resolves to a real route. The defect was found by clicking through the
live site, tutorial by tutorial, in response to a one-line user report
("link shortcuts should be clickable") — not by any automated gate, and
not by re-reading the diff of the PR that introduced tutorial rendering,
which had already merged clean weeks earlier.

**The generalisable gap:** a build/typecheck/test pass proves the code is
internally consistent — the markdown parses, the component renders, the
route responds 200. None of those checks simulate a reader actually
following a link, which is the one thing a documentation page exists to
survive. The same session's design-consistency fix (`KNOWLEDGE.md §12.35`'s
sibling, tutorial/concept pages not matching the redesigned landing shell)
has the identical shape: nothing in the type system or test suite encodes
"this page should look like the rest of the product," so a page can be
100% green and still be wrong in the one dimension nothing was checking.

**What actually caught both:** the same discipline as `§5t`/`§5af`'s
newcomer-eye sweeps, applied here as "click every link this page renders"
and "screenshot this page next to the one it's supposed to match" — manual,
slow, and the only method that exercises the property that was actually
broken. Where the fix generalizes (a source format serving two renderers,
a heading component two pages should share) it was extracted into typed,
tested code (`resolve-doc-link.ts`, `SectionHeading`) so the next instance
of the same class doesn't require another manual click-through to find.
