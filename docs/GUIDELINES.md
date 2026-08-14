# Development Guidelines

How we write code, structure changes, and ship safely in this repo.

> **Contributing a change?** Branch from `main`, open a PR — see [docs/CONTRIBUTING.md](./CONTRIBUTING.md). The PR conventions below apply.

---

## 1. Code style

- **TypeScript strict**, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Set in `tsconfig.base.json`; do not relax per-package.
  - `exactOptionalPropertyTypes` has a sharp edge worth knowing before it bites: `foo?: string` means *"absent, or a string"* — it **rejects an explicitly-passed `undefined`** (TS2375). Any optional prop whose value comes from a function rather than being conditionally spread needs `foo?: string | undefined`. This is the normal shape for a server component threading a resolved-or-undefined value into a client component: `<C mcpUrl={resolvePublicMcpUrl()} />`.
- **Node 20+**, ESM modules (`"type": "module"` everywhere).
- **Formatting**: Prettier defaults, 2-space indent, single quotes for JS/TS, trailing commas.
- **Naming**: `camelCase` for values, `PascalCase` for types/classes, `kebab-case` for file names, `SCREAMING_SNAKE` only for env vars.
- **No `any`, no `@ts-ignore`** without a comment explaining the reason.
- **Comments are rare.** Only for non-obvious WHY — workarounds, hidden invariants, surprising behavior. Never narrate WHAT the code does.

---

## 2. Package boundaries

```
types → db → core → (mcp-server | web | worker | sync-bridge)
```

Rules:

- `types` depends on nothing.
- `db` depends only on `types`.
- `core` depends on `types` + `db`. It must never import from `apps/*`.
- Apps depend on `core` + `db` + `types`. They must not import from each other; share logic via a new package.

Violations block CI.

---

## 3. Invariant enforcement

Every write path in `packages/core` or `packages/db` must uphold the invariants in `KNOWLEDGE.md §5`:

1. Knowledge immutability — no in-place edit of persisted rows.
2. Provenance — `sourceSessionIds` or `extractedBy` non-empty.
3. Scope boundary — queries always filter by owner. **Project reach and user reach are separate axes: widening the first must never widen the second.** `scope-filter.ts`'s cross-project disjunct carries its own `ownerUserId` predicate rather than leaning on an outer `AND`, because it sits inside an `OR` where an outer clause would not constrain the sibling arms (#174). Any new branch that broadens visibility repeats that predicate, and is opt-in per call site — `action-items.ts` and `meeting-extract.ts` both depend on the project edge holding. The opt-in governs the branches that *have* a boundary; with no `activeProjectId` there is nothing to enforce, so cross-project rows are admitted regardless (that branch has behaved this way since 2026-05-12).

**There are TWO generations of scope helper, and the V1 set has no cross-project reach.** `buildKnowledgeWhere` / `buildSessionWhere` / `buildProposalWhere` / `buildRawProjectFilter` predate Phase 4. Mind the two meanings of "scope": persisted `Knowledge.scope` (`user`/`project`/`global`) versus request `DataScope` (`project`/`all`). Under `DataScope: "all"` V1 returns everything the caller owns, so it does reach across projects; under `DataScope: "project"` it resolves on `ownerProjectId` alone and never consults `Knowledge.scope`, so it cannot filter to a project *while* admitting the caller's `user`-scoped rows from elsewhere — which is exactly what V2's opt-in adds. The V1 → V2 migration is **unfinished**, and finishing it is not simply better: **V2's `visibility: 'project'` arm carries no `ownerUserId` predicate** — that absence is exactly what makes Phase-4 org sharing work — so moving a *personal* surface (a rules export, a personal dashboard) to V2 would also start returning teammates' rows. Migrate a surface to V2 when you want org visibility there; add an owner-anchored opt-in to V1 when you only want the caller's own rows to reach further. `exporter.buildRulesBundle` took the second route (2026-08-01); the dashboard and graph deliberately keep the project-scoped view (KNOWN_ISSUES §0p). Before adding a call site, pick V2; before changing visibility behaviour, check which generation the surface you care about actually uses.

**`buildKnowledgeWhereV2` and `buildRawProjectFilterV2` are one policy on two query surfaces — change them together.** They back the same visibility rule for Prisma listings and raw pgvector queries respectively, so any divergence makes a caller's results depend on which code path they happened to hit. Two such divergences were found in the 2026-07-31 review (the no-`activeProjectId` case, and `scope: "all"` without an org context) — the tests now assert the two helpers against each other in the same case rather than checking each alone, because a per-function test cannot see a gap that lives between them.
4. Embedding required — nightly backfill for stragglers.
5. Confidence/decay ranges — clamp, never trust caller.
6. Anti-principles need evidence.
7. Peer Card overrides KEA.
8. Autoskill requires user approval.
9. Audit log is append-only — no code path deletes AuditLog rows, not even GDPR erase.
10. No silent auth fall-through — `getCurrentUserId()` must 503 when no auth is configured.
11. Voucher claims are transactional (SELECT FOR UPDATE).
12. Retrieval tuning constants — the scoring weights (`kra.ts` `WEIGHTS`) **and the candidate-pool depth (`kra.ts` `CANDIDATE_POOL_SIZE`)** — require a benchmark run before change — export a fixture (**`BENCHMARK_USER_ID`-scoped on any multi-user host so no other account's prompts leave the DB**) and run `pnpm --filter @brain/core run benchmark:retrieval fixture.json` (NDCG@5, KRA vs cosine); record before/after in `docs/VALIDATION.md` in the same PR. **Enforced since 2026-08-01** by the `benchmark-coherence` CI job (`scripts/check-benchmark-coherence.sh`), which compares the constants' values against the merge base and fails a PR that retunes without recording — it no longer relies on remembering. **The regression bar is the delta vs the cosine baseline on the current fixture, not an absolute score** — absolutes are fixture-dependent (first real-corpus run 2026-07-06: KRA 0.4514 vs cosine 0.3036; the retired seed fixture had cosine at 1.0). `CANDIDATE_POOL_SIZE` is exported and imported by `scripts/export-retrieval-fixture.ts` rather than duplicated — a benchmark whose pool depth silently differs from production's measures the wrong system (widened 20 → 50 in v2.3.0, #146).
13. Knowledge rows track actual usage — `usageCount`, `successCount`, `failureCount` must be bumped via the designated helpers, not direct SQL writes.
14. **Env-var passthrough.** A new `process.env.*` read in `apps/worker`, `apps/web`, or `apps/mcp-server` MUST also be added to that service's explicit `environment:` allowlist in `deploy/docker-compose.yml` (e.g. `VAR: ${VAR:-default}`). The services use an allowlist, not `env_file`, so an unlisted var set in `.env` is **silently ignored** at runtime — the v1.10.0 autoskill classifier shipped un-toggleable in prod this way (fixed v1.10.2). Same trap as the `KEA_MODEL` passthrough note already in the compose file.
15. **Backup image major must match the db major.** The `backup` service (`prodrigestivill/postgres-backup-local:<major>`) and the `db` service (`pgvector/pgvector:pg<major>`) in `deploy/docker-compose.yml` must share a PostgreSQL major — `pg_dump` refuses to dump a newer-major server, and it fails **silently at 3am**, not in CI. Bump both together. Every nightly backup was failing this way for ~3 weeks after a pg16 upgrade left the backup tag at `:15` (fixed v1.11.1).
16. **Alarm on the artifact, not the process.** A monitor for a periodic job (backups, crons) must check the freshness of the job's *output* (e.g. newest `/data/backups/last/*.sql.gz` mtime vs `BACKUP_DUMP_MAX_AGE`), not the process's health signals — container healthchecks and green gates hid a total pg_dump failure for three weeks (v1.11.1). An existing-but-empty output directory is the failure state, not "unconfigured".
17. **Piped-export integrity.** `docker compose exec -T` truncates stdout at 64 KiB with exit code 0 — a piped export can be silently cut mid-JSON. For payloads that can exceed that, write to a file inside the container and `docker compose cp` it out; either way, validate integrity (parse the JSON, check expected counts) before trusting any piped export. Found the hard way on the first fixture export (2026-07-06).

Additionally, the multi-tenant invariants from `KNOWLEDGE.md §12.17–§12.24` are authoritative — every Organization, Project, MCPToken, and Knowledge mutation must pass their guards.

Invariant violations are bugs, not features. Fix the violation; do not loosen the invariant.

---

## 4. Testing

| Scope | Location | Expected |
|---|---|---|
| Unit (core) | `packages/core/src/__tests__` | pure-function coverage for scoring, exporter helpers, parsers, effectiveness, uplift, email; 450 total across all packages as of MVP complete |
| Unit (web) | `apps/web/lib/brain/__tests__` (Phase 1, planned) — **first real coverage landed 2026-07-14 at `apps/web/app/api/**/*.test.ts`** (route Handler tests, `vitest.config.ts`) | hook state machines (`useOracle`, `useKnowledge`), parsers (`parseSSE`), proxy (`check()`) — planned; what actually shipped first is Route Handler tests (`GET`/`POST`/`PATCH` functions called directly, no HTTP server), see the auth-mocking note below |
| Integration | `packages/core/__tests__/integration` | session-to-knowledge, outcome-feedback-loop, retrieveScored round-trip |
| Benchmark — retrieval (harness + unit) | `packages/core/src/retrieval-benchmark.ts`, `packages/core/src/__tests__/retrieval-benchmark.test.ts` | pure NDCG@5 harness (KRA vs cosine) reusing `kra.ts` `scoreItem`; the run/export entrypoints live in `packages/core/scripts/` (outside the CI tsconfig — not typechecked). See `docs/VALIDATION.md`. |
| Benchmark — generation uplift | `packages/core/generation-uplift/` (`README.md` = pre-registration, `tasks/`, `harness/grade.ts`, `RESULTS.md`) | Control-vs-Brain-injected agent runs graded by executable tests; **deliberately outside `src/`** so neither the package `tsconfig` (`include: src/**/*`) nor vitest (`src/**/__tests__/**/*.test.ts`) picks it up — it is an operator-run artifact, not a CI gate. Re-run with `npx tsx harness/grade.ts`. **Pre-register the task list + metric in a commit before the first run**, commit the raw agent outputs, and publish the result whichever way it falls (v2.3.0 first read: +33.3pp, n=6). |
| E2E | `apps/web/e2e` | 28 specs covering every surface + tokens + onboarding + tweaks + i18n + docs-i18n + a11y + responsive + mobile-overflow + streaming. Run the full suite locally with `pnpm --filter @brain/web e2e` (dev stack must be up). The **anonymous subset** (`welcome-public-urls`, `docs-i18n`, `healthz`) runs automatically in CI via the `onboarding-e2e` gate whenever an onboarding/unauth surface changes — see [CICD.md](./CICD.md). `security.spec.ts` joined `authed-e2e`'s file list (2026-07-10) — its "negative path" tests force their own clean `storageState` via `test.use()` since the project default is pre-authenticated. **Lesson (2026-07-10): a spec file existing in the repo, even with prior passing history, does not mean it runs in CI — every workflow here passes an explicit file list to `playwright test`, not a directory glob. Before writing "new e2e regression test" in a commit/PR, `grep` the `.github/workflows/*.yml` file lists to confirm the file is actually on one — the CI job passing is not itself evidence.** |
| E2E fixture | `packages/db/prisma/seed.ts` (an early PR) | Deterministic seed produces 1 admin user (Alex) + 1 org + 1 project + 6 sessions + 16 knowledge rows + 4 autoskill proposals. Idempotent via upsert; safe to re-run. Wired in `prisma.config.ts#migrations.seed` (Prisma 7 location — NOT `package.json#prisma.seed`, which silently no-op's in v7). Counts are load-bearing — `skills.spec.ts` asserts ≥16, `sessions.spec.ts` asserts ≥6, `autoskill.spec.ts` asserts 4. |
| Visual regression | `apps/web/e2e/visual.spec.ts` (an early PR, scaffold) | 24 baselines: 6 surfaces × 2 viewports × 2 themes. Inert by default; gated on `PWUPDATE=1` (regenerate) or `RUN_VISUAL=1` (diff) so it doesn't flake every dev's `pnpm e2e`. Baseline PNGs land once Phase 2 (`data-volatile` masking attrs) and the e2e CI Option B (in-stack runner) are ready. |

Run `pnpm turbo run test` before every commit. A red test blocks merge. If you add a pure helper (parser, scorer, renderer), add at least one test in the same PR.

**Adding or touching a monitor/watchdog? Verify what it reads, not just that it fires.** Dispatching it and watching it open an issue proves the plumbing (schedule registered, HTTP works, comparison runs) — it proves nothing about whether the input is the right input. The `prod-drift` watchdog passed that firing test and still polled the **dev** host for months, so the alarm titled "production is behind main" had never read production (`KNOWN_ISSUES §0al`). The check is one line and belongs in the same PR: read the value the monitor reports, independently query the system you believe it watches, and confirm they describe the same thing. Beware the specific trap that hid this one — a monitor pointed at the wrong target often still emits *plausible* alarms, and a plausible alarm agreeing with something you already believe is the weakest possible evidence that it is wired correctly. Where the target is a secret, emit a non-secret discriminator in the alert body so a reader can tell which system was measured without repo-admin access.

**Adding a new CI gate? Pick the strictest threshold that is clean *today*, and write the tightening condition into the workflow comment.** A gate's entire value is what its red state means. Wiring one at a threshold you cannot currently satisfy — `pnpm audit --audit-level high` here, red on ~70 pre-existing transitive findings with no fixes available — makes every future true positive indistinguishable from the standing noise, and people learn to scroll past it. That is strictly worse than no gate, because the repo now *looks* covered. The dependency-audit job ships as `--prod --audit-level critical` (currently exits 0) with "raise the bar to `high` once that tier is genuinely clean" stated in `ci.yml`, so the temporary scope cannot quietly become permanent. **Then prove it can fail before merging** — run it against a known-bad input (for the audit gate: the pre-CVE-patch lockfile → exit 1, three critical) as well as the current tree. A gate never observed failing is indistinguishable from one that cannot fail; see `§0q`, where two "MCP transport refuses…" tests were green for their whole existence while POSTing to a server that had no such route. Rationale: `APPROACH.md §5bv`.

**Route Handler unit tests must mock `@/auth` and `next/headers` globally, not per-file (2026-07-17/18).** `apps/web/auth.ts` calls `NextAuth(config)` at module scope; under vitest's plain Node ESM resolution (no Next.js bundler in the loop), next-auth@5's internals import `next/server`, which fails to resolve outside Next's own runtime — any test that transitively imports `@/lib/brain/auth` fails at **module load**, 0 tests collected, not a logic failure. Separately, `next/headers`'s `cookies()` relies on Next's request-scoped `AsyncLocalStorage`, which doesn't exist when a Route Handler is invoked directly as a plain function (as every test here does) — it throws "called outside a request scope," surfacing as a 500 where 200 was expected, once the module-load issue above is fixed and the test actually runs. Both are fixed once, globally, in `apps/web/vitest.setup.ts` (wired via `vitest.config.ts`'s `test.setupFiles`): `vi.mock("@/auth", ...)` short-circuits the whole export surface one layer below `@/lib/brain/auth` (which stays real/testable — tests still `vi.spyOn(authLib, "getCurrentUserId")`), and `vi.mock("next/headers", async (importOriginal) => ({ ...await importOriginal(), cookies: vi.fn(async () => ({ get: () => undefined })) }))` preserves every other export. This was discovered late — the branch that added `apps/web`'s first unit tests wasn't pushed for ~30 hours after landing, so neither failure had a real CI signal until a final pre-merge review forced the push. Any future `apps/web/app/api/**/*.test.ts` file gets both fixes for free from the shared setup file; do not re-mock either module per-file.

**Changing a KEA or Oracle prompt is a measurable change — pre-register it.** `kea.ts`'s `SYSTEM_PROMPT` decides what enters the corpus for every future session, and prompts have no typecheck and no unit test that would catch a regression in judgement. Treat one like a retrieval-tuning change: record the current behaviour, state the predicted effect and the metric *before* shipping, and publish the read either way. The 2026-08-01 narrowing toward locally-arbitrary conventions is the worked example (`docs/VALIDATION.md`) — baseline measured from the last 18 extracted *rules* (the canonical unit — `kea.ts` emits 0–3 findings per session, so rules, extractions and sessions are three different cohorts and the metric has to name one), prediction, threshold and stopping rule committed in the same PR as the prompt edit. Note the read arrives later: KEA only runs on real closed sessions, so there is no fixture that yields representative output.

**Testing LLM-backed units (keyless CI).** Don't mock the provider SDK. Extract the *pure cores* (prompt build / response parse / decide) and test those directly; pass the LLM call itself as an injectable seam (`deps.call`, mirroring `ExtractOpts.judge`) so a test supplies canned output. The autoskill classifier (`autoskill-classifier.ts`) + its `llm-dispatch` test are the canonical example — every branch (parse, verdict→routed, flag/shadow, fail-soft fallback, empty-input no-call) runs in CI without an API key, because provider dispatch lives behind the shared `packages/core/src/llm.ts` `callLLMText` seam.

**Anonymous-surface CI gate (v1.3.0, #1).** The `onboarding-e2e` workflow
(`.github/workflows/onboarding-e2e.yml`) builds + boots the app and runs the
anonymous Playwright specs whenever a PR touches an onboarding/unauth surface
(`apps/web/app/{welcome,signin,forgot-password,reset-password,accept-invite}`,
`layout.tsx`, the locale/install code). It's a **required check** on `main`, and
a fast green no-op on PRs that don't touch those paths — so it's opt-out by
path, not opt-in by label. This closed the gap where three user-visible bugs
once shipped past CI because the suite only asserted signed-in behaviour. See
[CICD.md](./CICD.md).

**Authed-surface CI tier (2026-06-09, required since 2026-06-10).** The
`authed-e2e` workflow (`.github/workflows/authed-e2e.yml`) boots the app in
credentials mode with the seeded fixture (the env-admin maps onto seeded Alex
via `ADMIN_EMAILS=alex@brain.local`), signs in once via `e2e/auth.setup.ts`,
and runs the signed-in suite — dashboard, sessions, skills, nav, plus a 375px
mobile-overflow regression net (`mobile-overflow.spec.ts`, #67: asserts no
horizontal scroll on the three main surfaces) — chromium
only with `--retries=1`, path-gated on `apps/web/** + packages/{core,db}/**`.
It is a **required check** on `main`. Excluded by design: oracle/streaming (no
LLM key in CI), signout (destroys the shared auth state), visual/responsive
(baseline flake).

**Rate-limit rule for in-stack test suites (2026-06-10, #52).** Any suite that
drives the booted app from a single IP must raise
`RATE_LIMIT_MCP_PER_MINUTE` in the app's env: the production default (200/min,
`apps/web/proxy.ts`) trips under a test burst, `/api/*` starts returning 429,
and surfaces render their error/empty branches — which presents as
*intermittent, different-test-each-run* failures that no timeout increase can
fix. The 12-iteration authed-tier rollout burned days on timing theories before
the Playwright **trace `.network` log** showed the 429s. Corollary debugging
rule: for CI Playwright failures, download the report artifact and read
`data/*.md` (error context + page snapshot) and the trace zip's `.network`
entries — run-log greps drown in app log noise.

**Playwright top-5 smoke (v0.14.0).** A separate deployed-brain Playwright suite
(`apps/web/tests/e2e/`) covers the top-5 *authenticated* surfaces against a
LIVE brain: sign-in, dashboard, oracle, sessions, skills. It needs an auth
cookie + a target host and is run on demand (e.g. post-deploy validation). See
`APPROACH.md §5ah` for the rationale.

**Validation discipline: exercise the artifact, not just the tests (2026-05-11).** "CI is green" is a necessary precondition, not sufficient evidence that a change does what it claims. For any PR whose value depends on runtime behavior — installers, deploy scripts, observability changes, schema migrations, anything that touches the data plane — run the actual artifact against the actual system before claiming completion. An early PR (MCP observability + installer v2) shipped a bug in its own installer that all tests passed: the unit test used `JSON.parse`, the installer used a sed-regex that didn't handle JSON-escaped quotes, and the failure mode was an orphan Session — the very thing the PR was meant to detect. The bug surfaced only when the installer ran end-to-end and the DB counters were re-read. **Rule:** if your PR description says "ships a fix for X," your test plan must include exercising the deployed artifact and observing X actually fixed in the conditions it claims to fix. The audit-friendly read-only diagnostic script at `.dev/brain-learning-evidence.sh` is the canonical example of a "did X actually fix?" probe.

**ESM module-wrapper testing rule (2026-05-14).** When a module function (`runCrossExtractDaily`) wraps another module function (`extractFromCrossSessions`) defined in the same file, `vi.spyOn(mod, "wrappedFn")` does NOT intercept calls made by the wrapper — Node's ESM module resolution binds the wrapper's call site to the local function reference at load time, not to the namespace export. **Rule:** if your test needs to mock a function called from inside the same module's wrapper, use dependency injection — accept the inner function as an optional parameter of the wrapper, default it to the real implementation, and let tests pass a stub. `vi.mock(module)` is the alternative but it fully replaces the module, making the wrapper itself impossible to test. An early PR's `runCrossExtractDaily({ extract? })` is the canonical example.

**Env-var passthrough rule (2026-05-12).** Setting a variable in `.env` proves only that the file contains the value. It says nothing about whether any specific container reads it. An early PR spent significant time on a misdiagnosis because `KEA_MODEL` was correctly set in `.env` but the worker service's `environment:` block in `deploy/docker-compose.yml` didn't pass it through — the worker silently ran with the in-code default. **Rule:** any env var that gates runtime behavior must (a) appear under the relevant service's `environment:` block in `deploy/docker-compose.yml` with a `${VAR:-default}` form, (b) be verifiable from inside the container with `docker compose exec <service> printenv | grep <VAR>`, and (c) carry a one-line comment near its compose entry explaining what it controls — so the next operator who adds a new var or renames an old one doesn't have to trace the chain through code. Worker queues + LLM provider routing are the highest-stakes example.

**Major-version config-location rule (2026-05-17).** When a dependency bumps a major version, re-read its config-resolution rules — config locations move silently. An early PR wired `prisma db seed` via `package.json#prisma.seed` (correct for Prisma 5/6) and shipped CI-green. The first deploy printed `⚠️ No seed command configured` and continued because Prisma 7 reads `seed` from `prisma.config.ts#migrations.seed`; the package.json location is deprecated and silently no-op'd. Hotfix in an early PR. **Rule:** when bumping a major version, grep the codebase for every file that names the dependency, then exercise each code path against a real runtime — not against unit tests, which never see the deprecated-location warning. Common silent-deprecation locations: `package.json` "extras" fields (eslint, prettier, jest, prisma), `tsconfig.json` `extends`, `.babelrc`, `next.config.*`. Prisma 7's additional gotcha: `new PrismaClient()` without an explicit driver adapter throws — any standalone script (seeds, one-off backfills) must construct `PrismaPg` first, matching the runtime singleton in `packages/db/src/index.ts`.

**Vocabulary discipline (2026-05-20).** One concept = one word, used consistently across nav, headings, captions, tooltips, error messages, and docs. The canonical glossary lives at `/docs/concepts/vocabulary` (also published in the webapp's docs index under "Start here"). The five user-facing words are **Brain · Skill · Session · Oracle · Proposal**; the advanced acronyms (**KEA / KRA / MCP / SQS**) appear only in tooltips and runbook prose. Anywhere a different word appears for the same concept — "knowledge" for skill, "Autoskill" for proposal, "Teach" without an object — that's drift to fix. The newcomer-eye walk now has three questions: (1) does this state actually move anything visible? (2) does any visible label leak an internal identifier? (3) is the same concept named the same way everywhere? — see `docs/APPROACH.md §5ag` for the rationale.

**Problem-framing discipline (2026-06-27).** When writing user-facing copy, the README, or docs, do **not** frame the problem as "AI coding tools are stateless / they forget everything / every session starts from zero." Modern tools (Claude Code, Cursor, Copilot, ChatGPT) ship memory now, so that hook is inaccurate and a knowledgeable reader bounces off it. Frame the real, differentiated pain: built-in AI memory is **siloed — per tool, per project, and per person** (it doesn't carry between Claude Code/Cursor/Copilot, across repos, or to teammates), a **black box** (you can't inspect, correct, or curate it), and **vendor-locked / not yours**. Position External Brain as the one **shared, inspectable, self-hosted** knowledge layer across every MCP tool, project, and team that you own — with user/project/team/org scopes it's built for **enterprise knowledge reuse** (a skill learned once becomes the team's). It also **self-improves**: autoskill proposes new skills from sessions, reinforces the rules that pay off, and lets weak ones decay, so each project gets better on its own without anyone hand-writing rules. Use it *alongside* a tool's built-in memory, not instead of it. **Positioning copy lives across several surfaces — update ALL of them, not just one:** the README **hook** (H1 + lede), README **§Why** + the "Why not just use the memory built into Claude Code or Cursor?" **FAQ**, the `HOW_IT_WORKS.md` thesis, and — easy to forget, because it isn't a repo file — the **GitHub repo About + topics**, set via `gh repo edit --description "…" --add-topic … --remove-topic …`. The rationale is `docs/APPROACH.md §5aw`.

**SEO / discoverability discipline (2026-06-27).** Discoverability is a maintained surface, not an afterthought. Keep the high-intent search terms in the most-weighted places: the README **H1** + first paragraph, the **GitHub About** description, and the **topics** (GitHub caps these at 20). Terms that matter: *MCP server, self-hosted, AI coding memory, Claude Code, Cursor, open source, enterprise, RAG*. Every image needs descriptive **alt text** (it is indexed). Optimise for the searcher who has *outgrown* built-in memory — they search "shared / self-hosted / enterprise AI memory", not "AI memory". Do **not** keyword-stuff: dense-but-natural beats a wall of terms, and a stuffed sentence reads as machine-written, which undercuts the positioning. See the problem-framing discipline above for the core copy surfaces; image alt text and link-in-first-comment are additional SEO-specific surfaces. Rationale in `docs/APPROACH.md §5ax`.

**Reference-honesty discipline (2026-07-02).** Public docs must not cite a `PR #NNN` / `(#NNN)` from the pre-open-source private history — a number above the public repo's PR ceiling is evidence a reader **cannot resolve**, which quietly undercuts the "honest catalog" ethos. When narrating history, use a date and a description ("an early PR", "early PRs") rather than an unverifiable number, or a real (≤ ceiling) reference. This is enforced: `scripts/check-doc-refs.sh` runs as the `doc-refs` CI job and fails the build on any phantom reference (CSS hex, external `…cli #NNN`, and `docs/internal/**` are allow-listed). Rationale in `docs/APPROACH.md §5ay`.

**Newcomer-eye walk-through rule (2026-05-19).** After every UX-affecting change, walk every routed surface — including the auth-flow surfaces (`/signin`, `/forgot-password`, `/reset-password`) and the empty-state variants of each authenticated screen — as a first-time visitor with no AI background. Ask of every chip, badge, breadcrumb, tooltip, model identifier, slug, short id, and queue name: **"what does this mean to someone who's never used this app before?"**  Fix anything you'd ask that question about. The 30-iteration sweep (early PRs, 2026-05-17 → 2026-05-19) found ~30 issues in 3 passes; pass 3 caught the auth-flow surfaces that passes 1 and 2 never opened. **Rule:** declaring a UX pass "done" after one round leaves the entry surfaces broken for the visitor who matters most: the one who hasn't logged in yet. Internal identifiers leaking through (model id, slug, short id, env-var names in error copy, raw queue names) are the second-most-common newcomer-eye finding; the first is decorative state that updates client-side but doesn't move any visible thing. Validate each iteration with a string-presence probe (e.g. `curl /signin | grep -c "sonnet 4.6"` should return `0` after iter 6) — typecheck alone never asserts user-facing copy.

**Documentation pedagogy discipline (2026-08-12).** When documenting setup commands that require user-specific tokens or URLs, **never** present a raw placeholder block (e.g., `curl ... 'bp_<your-token>'`) without an explicit dummy warning. Users copy these verbatim and fail with `401 Unauthorized`. Always wrap dummy commands in a `> [!WARNING]` block and label the code block as `# EXAMPLE ONLY`. Additionally, when explaining AI interactions, **use real-life session transcripts** (actual successful interactions) instead of abstract generic examples. Transcripts show exactly how the tools react in practice and build immediate trust.

**Pre-commit hook — activate once per clone.**

```bash
git config core.hooksPath .githooks
```

The hook runs typecheck + `@brain/core` unit tests on non-doc commits (doc-only commits skip). Skip with `git commit --no-verify` only for emergency hotfixes.

**Adding a new navigation surface (route, hash, admin page)?**

Every new top-level URL or shell hash-route must land in the same PR as:
1. The route/component itself (`apps/web/app/...` or `apps/web/components/brain/...`).
2. An entry in `scripts/nav-smoke.sh` so the curl smoke covers it.
3. An E2E spec under `apps/web/e2e/` — at minimum "page renders, no 5xx."
4. If it's auth-gated: a check in `scripts/verify-lockdown.sh` only if the gating behaviour differs from the generic `/api/*` pattern.

The nav-smoke list is intentionally hard-coded (not route-discovered) so a new surface cannot slip through silently.

### A failing assertion must be able to fail for exactly one reason

An assertion that only checks *that* something failed verifies nothing if the
outcome has two possible causes. Before trusting a negative test as coverage,
ask what else could produce the same result.

The worked example (found in the 2026-08-02 pre-release audit, `KNOWN_ISSUES
§0q`): `security.spec.ts` sent `tools/list` with a bogus Bearer and asserted
`status >= 400`. It was green — from the MCP SDK's *"Server not initialized"*
check, because the request carried no `Mcp-Session-Id`. The bearer was never
consulted. **The test would have stayed green with authentication removed
entirely**, while reading in review as proof the boundary held. Sending
`initialize` with the same junk token returned `200`, a session id, and the full
tool catalogue.

So, for any test guarding a security boundary:

- Assert the **specific** status (`toBe(401)`), not a range.
- Assert the **absence of the thing that would leak** (`not.toContain("serverInfo")`,
  no `mcp-session-id` header) — a status code alone doesn't prove nothing escaped.
- Exercise the method that actually reaches the check. Probe the code path, not
  a neighbour of it.
- Sanity-check by breaking the control locally and confirming the test goes red.
  If it stays green, it was never testing the control.
- **Verify the test can reach its target at all.** Give a test that talks to a
  second service its own base-URL variable with **no fallback**, and `test.skip()`
  loudly when it is unset. A default that silently resolves to a different
  process is the worst case: the request succeeds, returns *something*, and a
  range assertion accepts it.

The second half of that rule has its own worked example, found the same day and
worse than the first. `security.spec.ts` resolved its MCP endpoint as
`E2E_BASE_URL ?? "http://localhost:3100"`. The `authed surfaces e2e` job sets
`E2E_BASE_URL=http://localhost:3000` and boots only the web app — so both
"MCP HTTP transport refuses…" tests POSTed to `/mcp` on **Next.js**, got its
404, and their `status >= 400` assertion passed. Two named security tests had
never once contacted the MCP server. The job now builds and boots
`@brain/mcp-server`, waits on `/health`, and fails if it doesn't come up.

### Verify the property, not the nearest signal

Every check has a cheaper neighbour that correlates with it. The neighbour is
what a defect satisfies while the real property is false.

| Nearest signal | The property |
|---|---|
| the option exists in the type | what the option *means* |
| the deploy smoke is green | the container is *healthy* |
| the row exists in the table | the thing the row enables *happens* |
| the test passed | the test *could have failed* for this reason |
| the backup service is `Up` | a dump *exists*, and contains your rows |
| `certbot renew` said "success" | the new cert is what the server *serves* |
| the scheduled job is configured | it *ran*, and produced output |

The tell: **if you can describe a world where the check passes and the feature
does not work, it is the wrong check.** For anything with a database or a
container behind it, the acceptance criterion is usually a query, not a
checkmark — `SELECT name, dead_letter FROM pgboss.queue` rather than "deploy
succeeded".

Related, and learned the hard way twice: **a gate must resolve "unknown" to
failure.** A container in `starting`, a skipped test, an unreachable endpoint —
tolerating any of these means reporting green during precisely the window when
something is most likely broken. See `KNOWN_ISSUES §0q` for both occasions.

The bottom three rows are the 2026-08-05 additions (`KNOWN_ISSUES §0s`), and
they sharpen the rule for anything that runs **unattended**: a backup service
had been `Up` and healthy for months while its volume was empty, and a
`certbot renew` that printed "Congratulations, all renewals succeeded" left
nginx serving the expired certificate it still held in memory. Both reported
success continuously; neither produced anything.

> **An automated mechanism is not verified until you have inspected its
> output.** Not its status, not its exit code, not its log line claiming
> success — the artifact it was supposed to produce.

For scheduled work, the acceptance criterion is the artifact and its *freshness*:
`ls` the dump and count rows in it; read the certificate off the wire with
`openssl s_client` rather than off disk. This matters most exactly where
attention is lowest — the mechanisms nobody watches are the ones that fail
silently for months, and the cost is only ever discovered at the moment you
needed them to have worked.

### Code you generate must be executed, not just parsed

A static check verifies the layer you wrote. When that layer *emits* another
language, it says nothing about the layer you emitted.

The installers (`apps/web/lib/brain/installer-templates.ts`) are the worst
case in this repo: a TypeScript template literal emits bash, and that bash
embeds Python in a heredoc. Two escaping bugs shipped through every static
gate — `\n` and `\"` written for Python were consumed by TypeScript first, so
the emitted Python had a real newline inside a string literal and a stray
unescaped quote. Both are `SyntaxError` at run time.

What passed anyway:

| Check | Why it passed |
|---|---|
| `tsc` | a valid TypeScript string is a valid TypeScript string |
| the unit sweep | it asserted the *bash* was well-formed, which it was |
| `bash -n` | **to bash, a quoted heredoc is data** — it never parses the contents |

`bash -n` is the interesting one, because it looks exactly like the check that
should have caught this. It is worth keeping — it catches slips in the bash
layer — but it must not be mistaken for coverage of what the bash *contains*.

So: **for any generated artifact, one test must run it and assert the result.**
`installer-clients.test.ts` executes the generated installer against a sandbox
`HOME` with a stubbed `curl` (so the network step can't run, and can't spend 15s
per client timing out), then asserts the config file it produced — entry
present and byte-identical to what the UI shows, sibling servers preserved,
backup written, no placeholder left behind. Cheap, hermetic, and the only check
that could have failed.

### Offering a control implies responding to it

A page that renders a language picker, a theme toggle, a sort selector or a
filter is making a promise. The promise is not "this control exists" — it is
"this page responds to it". Those are different properties, and only the first
one is visible when you read the page.

Five of the six surfaces rendering `<LocalePicker />` translated nothing
(`KNOWN_ISSUES §0af`). Each looked fine in isolation: the picker was really
there, the dictionary was really populated, the provider really worked — and it
demonstrably worked on `/welcome`, which is what made the rest invisible. The
gap was between *offering* the control and *responding* to it, and no per-page
review can see a gap.

So when a control is added to N surfaces, the test ranges over all N and
asserts the **response**, not the presence:

```ts
// Wrong: asserts the control exists — true of every broken page.
expect(src).toContain("<LocalePicker");

// Right: asserts the page's copy varies with the thing the control sets.
expect(translatesSomewhere(src)).toBe(true);
```

Two things that pass for this and are worth stealing:

- **Accept any mechanism that achieves the property.** The first version of
  that check required `useT()` and failed the docs pages, which translate
  through `useLang()` + `getDocsChrome(lang)` — a different and equally working
  route. Requiring one implementation is asserting the nearest signal again.
- **Reject a locale that is a copy of English.** "Every key exists" passes
  happily when a translation file was duplicated and never translated. Assert
  that most values *differ* from the base locale.

### A gate that probes a running system cannot see an unconfigured one

`verify-lockdown.sh` is the designated auth-posture audit, and it passed on
production every single time while `docker-compose.yml` shipped defaults that
made a fresh `docker compose up` serve every anonymous request as the first
`User` row (`KNOWN_ISSUES §0ac`).

It passed *correctly*. It probes a **running instance**, and any instance
configured enough to be probed has already had a human set the values in
`.env`. The defect lived only in the gap between the template and an
**unconfigured** deploy — a state no running instance can exhibit, and
therefore a state no runtime probe can test.

The generalisation, and it covers `§0a` too: **every check that inspects a
live system is inspecting a system somebody already rescued.** Whatever the
operator had to fix by hand to make the probe possible is exactly what the
probe can never test.

So for anything with a default — compose interpolation, a config template, a
CLI flag — assert the **resolved answer for the unconfigured case**, not the
template text and not the running value:

```ts
// Resolve the compose file against a deliberately minimal env file and read
// what a forker actually gets, not what the file appears to say.
docker compose -f deploy/docker-compose.yml --env-file <3-line-env> config
```

And where two files must agree on that default (`.env.example` vs compose),
pin them to each other in the same test, or they will drift the moment one is
edited.

### Identify the target as part of the check

One level up from the above, and the sequel that produced it (`KNOWN_ISSUES
§0t`): a round-trip test proves the loop is closed, but says nothing about
**which** loop. An agent wrote six knowledge rows over MCP, verified
teach → retrieve → inject → close, saw every call return a real id, and
reported the loop "verified end-to-end" — against the wrong Brain. The client
had bound its config at session start and was still talking to the previous
instance; the config file on disk said something else.

> **When a check can pass against the wrong target, the target is part of what
> you are checking.**

Two habits that catch it:

- **Assert identity, not just success.** Before trusting a write, resolve where
  it went (`~/.claude.json`'s URL, the hostname, the connection string) and
  confirm the artifact exists *there* — `select id from "Knowledge" where
  id = '<returned id>'`, not "the call returned an id".
- **Treat an empty result as a question, not a pass.** Zero rows, zero
  reflexes, an empty list — none of these are errors, and all of them are
  consistent with "you are querying the wrong system". `brain_get_user_style`
  returned ~30 reflexes one day and 0 the next with a perfectly healthy
  connection both times. Ask *which instance answered* before concluding
  anything about the data.

This generalises past MCP to any environment-shaped work: a migration applied
to the wrong database, a deploy verified against the wrong host, a test run
against a stale container. The check was real; the subject was not.

### A passing test can be pinned to a fact that stopped being true

The inverse of the sibling problem, and harder to catch by construction. Every
example above (`§0u`, `§0v`, `§0w`) was *our* rule applied inconsistently
across our own surfaces — reachable by a sweep over the code we control. This
one isn't: an install snippet emitted `~/.gemini/antigravity/mcp_config.json`
for Google Antigravity, correct the day it was written. Then Google folded
Gemini CLI into Antigravity and moved the file to
`~/.gemini/config/mcp_config.json` (`KNOWN_ISSUES §0z`). The snippet's JSON
*shape* was still exactly right — the config was syntactically perfect and
sat in a directory nothing would ever read. No error. Nothing to diagnose.

The test asserting the old path kept passing throughout, **because it was
pinned to the value that went stale.** That is not a bug in the test's logic;
a unit test cannot know that a vendor moved a file six weeks after it was
written. It only knows what it was told to assert.

> **A passing test that pins an external fact — a file path, a config key
> name, a provider's endpoint, another product's behaviour — is evidence
> about your code, not about the world it assumes.**

No sweep-over-N-surfaces habit fixes this one; the surface in question isn't
in this repository. What is available, and cheap: when a tool this project
integrates with announces a rename, merger, retirement, or API change, that
is the trigger to re-read its current docs and re-verify anything hardcoded
against it — a `git blame` on the constant plus "is this still true?" costs a
few minutes and is the only check that exists for this class.

### One rule, one implementation — and put the question in the PR

The audit arc that produced most of this section found the same defect class
**five** times: a rule implemented correctly in one place and not in its
sibling. Clipboard hardening (4 sites of 7), 429 retry (`embedding.ts` but not
`llm.ts`), token project-scope (all writes, no reads), `captureError` (4
handlers of 9), and finally provider routing — where `oracle.ts` and `llm.ts`
sent the same model string to different providers, killing a nightly job for
eight days while the Oracle looked healthy.

Two habits, in order of usefulness:

1. **Extract the rule before you write it twice.** Every one of these was
   cheaper to share than to duplicate — `buildOwnerGate`, `useAnthropicSdk`,
   `resolveReadProjectId` are each a dozen lines that now cannot drift.
2. **Ask the question in review, not in a doc.** *"Which other place implements
   this same rule?"* costs one `grep` and is the only step that reliably
   catches this. A guideline nobody re-reads does not.

### Writing a Docker healthcheck? It runs in the container, not in your shell

Two rules, both learned by shipping the mistake (v2.8.0, `KNOWN_ISSUES §0q`):

- **Never resolve a module in a probe.** `node -e "require('pg')…"` fails with
  `Cannot find module 'pg'` under pnpm's isolated `node_modules` — a transitive
  dependency is not resolvable from the app directory even when the app itself
  depends on it. Have the service expose a liveness endpoint and probe it with
  Node's built-in `fetch`, which needs nothing from `node_modules` at all. That
  removes the resolution question instead of working around it.
- **Make the probe assert the dependency that matters.** `boss.getQueue()`
  round-trips to the queue schema, so green means "this process can still
  reach its queue" rather than "the event loop is alive". `restart:
  unless-stopped` already covers the process *exiting*; the healthcheck exists
  for the case where it doesn't.

And the reason both of those went unnoticed: **no CI gate exercises compose
healthchecks**, and `smoke.sh`'s HTTP checks can't stand in for one — the
worker has no HTTP surface, so a running-but-broken worker passed everything.
Smoke now fails on any `unhealthy` container. A permanently-unhealthy container
is worse than no healthcheck, because it teaches operators to ignore health
status.

### Fixing a defect? Enumerate its siblings before you close the PR

The 2026-08-02 audit found eleven separate issues that were **one pattern**:
hardening applied in one place and not carried across to the call sites next to
it.

| Hardened | Not hardened |
|---|---|
| clipboard guarded in `token-install-wizard`, `skills` ×2, `agent-prompts-card` | `oracle.tsx`, `settings/org` |
| 429 retry + classifier in `embedding.ts` | `llm.ts` — the seam every KEA/autoskill call uses |
| token project-scope on all 5 write tools | all 4 read tools + all 4 resources |
| `captureError` on 4 worker handlers | the other 5 |
| rate limiting on `/api/*` | `/mcp` |

Every one of these had a correct implementation sitting a few files away, so the
fix was cheap — but only for someone who looked. Auditing just the reported site
finds roughly a fifth of the actual defect.

**Therefore:** when you fix something that belongs to a *class* (error handling,
auth checks, browser-API guards, retries, scope filters, rate limits),
`grep` for the other call sites in the same class and state in the PR
description either that you fixed them or why they don't need it. "Which
siblings did this just make inconsistent?" is a standing review question.

#### The regression test must be named after the bug, not the page

This rule already existed when the install-snippet URL defect broke it — twice.
That `${hostname}:3100/mcp` bug was fixed for `/welcome` and guarded by
`e2e/welcome-public-urls.spec.ts`. Because the spec named a **page**, it
proved nothing about `/settings/tokens` or the onboarding modal, which
rendered the same value the same wrong way and stayed broken for months. The
2026-08-05 audit found both (`KNOWN_ISSUES §0r`).

A test that encodes "this page is correct" is worth far less than one that
encodes "no page does the wrong thing." Prefer the second shape:

```ts
// Weak: passes forever while a sibling surface ships the same defect.
test("/welcome snippet has no :3100", …)

// Strong: a NEW file introducing the pattern fails immediately.
const ALLOWED_TO_MENTION_PORT = new Set([...]);
const offenders = walk(WEB_ROOT)
  .filter(f => readFileSync(f, "utf8").includes(":3100"))
  .filter(rel => !ALLOWED_TO_MENTION_PORT.has(rel));
expect(offenders).toEqual([]);
```

See `apps/web/lib/brain/public-urls.test.ts`. Source-level invariant tests
belong under `apps/web/lib/**` — that glob is in `vitest.config.ts` and needs
neither a DOM nor a database, so unlike the `app/api/**` tests it runs in CI
unconditionally.

**And check the test actually runs.** Both e2e workflows enumerate specs by
name; 20 of 31 currently run in neither (`KNOWN_ISSUES §0r`). Before citing a
spec as coverage:

```bash
grep -rhoE 'e2e/[a-z0-9-]+\.spec\.ts' .github/workflows/*.yml | sort -u
```

Also check *which* job: `welcome-public-urls.spec.ts` runs in the **anon**
onboarding job, so an authed assertion added there fails with
`auth_not_configured`.

---

## 5. Commit hygiene

- **Single-purpose commits.** A commit changes one thing.
- **Conventional-ish messages**: `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `chore: ...`. Not strict Conventional Commits; readability > tooling.
- **Mention the layer**: `feat(core/kea): …`, `fix(mcp-server/tools): …`.
- **Do not commit secrets.** `.env*` files are gitignored; double-check `git status` before push.
- **Do not commit `node_modules`, `dist`, `.next`, `.turbo`** — gitignored.
- **No `--no-verify`.** Fix the hook failure, don't bypass it.

**Branch model.** Standard GitHub flow: branch from `main` (`feature/<slug>`,
`bugfix/<slug>`, `docs/<slug>`), open a PR, merge after green CI. `main` is the
only long-lived branch — no `develop`, no promotion flow. Never push directly to
a protected branch. Deploy a single Docker Compose stack: `./scripts/dev-up.sh` for local, or
`./scripts/deploy.sh` for the server (TLS via the `edge` profile); both auto-run
`scripts/verify-lockdown.sh` + `scripts/smoke.sh`. Contributor-facing rules in
[`docs/CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## 6. Pull requests

**Batch related work into one PR.** Commits stay small and single-purpose;
the PR is the review unit and should carry a coherent batch of them. Each PR
costs a full CI cycle (~3 min typecheck·test·build, ~4 min authed e2e, plus
CodeRabbit), and the gates run per *push*, not per *commit* — so a PR-per-fix
habit buys no extra safety and serializes an hour of waiting into a long
session. Feedback on an open PR is another commit on that PR. Split only for
something that must ship alone (a security patch) or that you want revertable
on its own. Full rationale: `AGENTS.md` → *One PR, many commits*.

Every PR must:

1. Link to the relevant doc section or research file.
2. Include tests for new behavior.
3. Pass `pnpm turbo run lint typecheck test`.
4. Note any invariant it touches in the description.
5. Include a "Risk" section for anything beyond a trivial change: what could regress, how to roll back.
6. **Honest test plans.** The PR's "Test plan" / "Validated" section is a contract, not a wish-list. Checks the author actually performed get ✅ with specifics ("CI passed typecheck/test/build/fresh-DB migrate"; "ran the modal locally and confirmed the new placeholder renders"). Checks a reviewer should perform get ⬜ unchecked with a clear "(reviewer to verify)" or "(agent could not run locally)" note. Never write a list of unchecked boxes labelled as if they were performed — see `AGENTS.md` *PR descriptions: honest test plans* for the full rule and the failure mode it exists to prevent.

Reviewer checklist:
- [ ] Invariants from `KNOWLEDGE.md §5` preserved.
- [ ] No new cross-package import that violates the dependency graph.
- [ ] No new env var without a corresponding `.env.example` entry.
- [ ] No new Prisma model without consideration of multi-tenancy and soft-delete.
- [ ] Test plan distinguishes ✅ performed checks from ⬜ reviewer-to-verify.

---

## 7. Security

- **Every MCP tool handler authenticates first.** The `AuthContext` parameter is not optional.
- **Every REST handler authenticates first.** NextAuth session or API token; unauthenticated requests return 401.
- **Every top-level authed route directory needs its own `layout.tsx` auth guard — do not rely on a sibling route's guard, and do not assume "it fetches authed data" is protection enough.** A client component that 401s on its own fetches still returns HTTP 200 for the page itself; the browser renders the full page shell — inputs, buttons, "Create" — around the failed fetch. Found 2026-07-10: `/settings/*` had no guard (unlike `/admin/layout.tsx` and the main app shell's `page.tsx`, both of which redirect anonymous visitors server-side), so an anonymous visitor saw a fully-functional-*looking* token form with the literal string `HTTP 401` rendered where content should be.
  **When adding one, copy the *nearest matching access model*, not the nearest file.** `admin/layout.tsx`'s bare `if (!anySignInConfigured()) redirect(...)` is deliberately strict — it intentionally locks out dev-shim (`ALLOW_DEV_AUTH=true`) deployments, because single-user dev-shim has no per-role admin surface to gate. Copying that gate onto `/settings` (first attempt, same day) silently locked dev-shim users out of `/settings/tokens` — their only path to create an MCP token — even though dev-shim resolves a real user fine everywhere else. The right template for any *non-admin* authed route is `app/page.tsx`'s three-way gate: `anySignInConfigured() ? require a real session : devAuthAllowed() ? pass through : redirect("/signin?error=auth_not_configured")`. Ask "does this route need to exclude dev-shim specifically, or just anonymous visitors?" before choosing which existing guard to model.
- **Audit your audit.** A security script that reports PASS must probe the actual attack surface, not a proxy for it. `scripts/verify-lockdown.sh` originally sent MCP requests without `Accept: application/json, text/event-stream` and got back 406 — reporting `fail-closed` when the server was actually rejecting at content negotiation, before auth could run. A real MCP client sends the Accept header and gets 200 + `serverInfo` on unauth'd `initialize`. Rule: if your security audit script reports PASS, open a browser / real client and try the thing manually at least once before you believe the green light. Every lockdown probe should exercise the shape a live attacker or real client uses.
- **Auth-mode divergence is always a misconfiguration, never a feature.** `ALLOW_DEV_AUTH=true` with OAuth envs set but empty-valued (`AUTH_GITHUB_ID=""`) silently activates dev-shim mode — the app serves the first User row to every anonymous caller. See `docs/KNOWLEDGE.md §12.14` for the full truth table and `docs/SECURITY.md §"declared-but-empty OAuth env trap"` for the diagnostic recipe. If you touch `apps/web/auth.ts`, consider adding a boot-time refusal for this combination rather than making the operator figure it out from the `/api/me` probe.
- **Credentials mode is the phase-1 pilot default.** One admin account, username + `ADMIN_PASSWORD_HASH` (bcryptjs, cost 12) in `.env`. `pnpm hash-admin-password '<plaintext>'` generates the hash; the script refuses passwords shorter than 12 chars. The runtime verifier (`apps/web/lib/brain/admin-credentials.ts`) is constant-time on username and runs bcrypt against a dummy hash on wrong-username attempts to avoid timing side-channels. GitHub OAuth coexists cleanly — both providers can be active at once (`CREDENTIALS+OAUTH` mode). If you need to add a second admin, provision a second `User` row with `role='admin'` via the admin UI after OAuth is enabled; credentials mode is intentionally one-operator-one-account.
- **Scope-filter queries at the repository level**, not the handler level. A handler that forgets to pass `ownerUserId` should still get an empty result.
- **Any new Knowledge/Session-style listing must apply the project filter.** Call `getActiveProject(userId)` to resolve the active project, then pass the result to `buildKnowledgeWhereV2` / `buildSessionWhere` / `buildProposalWhere` from `@brain/core/scope-filter`. `buildKnowledgeWhereV2` is the V2 helper that understands the three visibility states (`private`/`project`/`org`) and accepts `accessibleProjectIds` for org-level sharing — use it for any Knowledge filter added after Phase 4. A listing that omits the filter is a data-leak bug. For raw pgvector SQL paths (kra.ts, oracle.ts) use `buildRawProjectFilterV2` instead — it returns `{ sql, params }` for appending to the existing query. See `docs/KNOWLEDGE.md §12.19` and `§12.22` for the normative rules and `packages/core/src/scope-filter.ts` for the implementation.
- **Most retrieval is owner-scoped by default (`ownerUserId = caller`) — a query that widens deliberately must say so at the call site.** `action-items.ts` was the first exception: task lookups are project-bounded, not owner-scoped, because an assignee is rarely the item's creator (the project boundary is the isolation line, per its file-header comment). `findSupersessionCandidates` (`packages/core/src/meeting-extract.ts`) is the second: it searches project-wide for a decision an extracted one might replace, because the decision being reversed may have been taught by any project member, not just the person reviewing this extraction. Both document the "why" inline; do not add a third project-wide exception without the same justification.
- **Anonymous endpoints: validate the gate before revealing existence.** On an unauthenticated endpoint, order your checks so a caller who can't pass the gate learns nothing about what exists behind it. `POST /api/auth/register` validates the voucher *before* the email-exists check — otherwise an anonymous caller (no voucher) could read `email_taken` vs `voucher_required` and enumerate accounts. The `forgot-password` route does the same thing more strongly (always 200). Same family as the constant-time credentials verifier: *what you reveal, and in what order, is part of the threat model.* Pair every anonymous endpoint with a per-IP rate limit (`rateLimitCheck` + `getRateLimitStore`).
- **Never hand-parse a boolean env var. Use `envFlag(name, default)` from `@brain/core/env`.** A local comparison is case-sensitive, rejects `1`/`yes`/`on`, and — the part that bites — turns a *typo* in a default-true flag into a silent opt-out: under the old regex, `REGISTRATION_REQUIRES_VOUCHER=falsch` failed the truthy test, evaluated `false`, and opened public signup. `envFlag` falls back to the declared default for anything unrecognised, so a misspelling fails in whichever direction is safe for that flag. Before the consolidation this codebase had four parsers for one concept, and `ALLOW_RESET_LINK_IN_LOGS` had two of them at once — `boolish(false)` in the env schema and a case-sensitive raw comparison at the line that actually decided whether a password-reset link reaches the logs. Guarded by `packages/core/src/__tests__/env-flag.test.ts`, which sweeps every app + core source file. The only justified raw comparisons are `NODE_ENV` (bundlers statically replace it; wrapping it defeats dead-code elimination), `SKIP_DB_INIT` (inside `@brain/db`, which must not import core), and non-boolean selectors like `EMAIL_PROVIDER`.
- **An anonymous endpoint that vends a credential needs its own master switch, and the switch defaults off.** Rate limits bound abuse; they do not make the capability optional. `POST /api/onboard/claim` exchanges a voucher for a live MCP token with no session behind it, so it is gated on `AGENTIC_ONBOARDING`, parsed by `envFlag` (accepts `1|true|yes|on`, case-insensitive; **anything unrecognised keeps the default, which is off**). Reusing an existing knob would have been tempting (`REGISTRATION_REQUIRES_VOUCHER` is *right there*), but it answers a different question: "may strangers create accounts" is not "may strangers mint tokens". They are genuinely independent — `/api/onboard/claim` validates the voucher itself and never consults the registration gate, so open browser signup does not imply headless token issuance, nor the reverse. When a new capability changes what a *leaked* existing secret is worth — here, the voucher stops being an account stub and becomes bearer-equivalent — that is the signal it needs its own switch and its own paragraph in `docs/SECURITY.md`.
- **A token minted without a human present must be narrower than one minted with a human present.** The bootstrap token gets 14 days against the hand-minted 90, and omits `oracle` — the one capability that spends money on the operator's provider account. The general rule: when nobody clicked a button, assume the request might be an attacker with a forwarded code, and grant the smallest credential that still completes the user's job. State the narrowing in the response (`notes`) so a scoped token doesn't read to the user as a broken product.
- **Hash bcrypt outside DB transactions.** bcrypt at cost 12 is ~200ms by design. Never call `bcrypt.hash`/`createUserCredential` *inside* a `db.$transaction` — it holds a row/connection lock for the full hash. Pre-compute the hash, then pass it into the transactional write (see `claimVoucher({ passwordHash })` and `POST /api/auth/register`).
- **Org-management endpoints require `requireOrgMember`.** Any endpoint that reads or mutates org members, projects, invites, or org-scoped settings must call `requireOrgMember(db, orgId, userId, minRole?)` from `@brain/core/org` before executing. This throws `BrainError{code:"FORBIDDEN_ORG"}` for non-members and enforces the role matrix (owner ≥ admin ≥ member). Do not implement role checks inline in route handlers.
- **Platform-admin endpoints require `requireAdmin`.** Any endpoint under `/api/admin/*` must call `requireAdmin(userId)` from `apps/web/lib/brain/admin-auth.ts`. This checks `User.role === "admin"` and throws 403 otherwise. Do not gate these with `requireOrgMember` — they are platform-level, not org-level.
- **Never log tokens, passwords, or full embeddings.** The `redactFields()` helper in `@brain/core/logger` walks up to depth 4 and scrubs any key matching (case-insensitive) `password | token | apikey | api_key | authorization | cookie | secret | set-cookie | x-api-key | openai_api_key | anthropic_api_key | google_gemini_api_key | brain_mcp_token | database_url`. `captureError` applies it to its `fields` argument automatically; if you hand-build a log payload, call `redactFields()` yourself or prefer attaching the raw `err` and letting the pino serializer handle shape.
- **Content sanitization before injection into LLMs.** `brain_retrieve_knowledge` output is user-generated content; treat it as untrusted. Strip known prompt-injection patterns.

---

## 7c. Core-value features must be visible to the user

**For any new feature that measures or improves Brain quality, surface the value to the user. Don't bury it in benchmarks.**

A feature that captures a useful signal but never shows it to the user is a missed flywheel turn. The user needs to see the Brain working — both to trust it and to know how to improve it.

The existing signals establish the standard:

- **Groundedness header** — per-answer: renders while the answer streams, not after. The user sees `🧠 Grounded on N rules · M sessions · strong` before the model finishes.
- **"Why this answer" panel** — per-citation: type chip, effectiveness badge, `WHEN:` trigger line, last-used time. Not a debug view — the default collapsed toggle makes it a first-class answer surface.
- **Effectiveness badge** on every Skills row — per-rule: ✓ green / ~ yellow / ✗ red / — Untested / ○ Unused. The user can sort and filter by this; it is not buried in a detail pane.
- **Thumbs feedback loop** — live: clicking thumbs up/down on an Oracle answer immediately bumps the effectiveness counters on the cited rules. The user gets instant confirmation that their signal is wired to the Brain.

Every new Brain-improvement feature must answer: **"How does a user know this is working?"** If the answer is "they can check the benchmark results", the feature is incomplete. Add a widget, a badge, a header, or an indicator that makes the value observable during normal use — not just in CI.

---

## 7b. Logging & observability (AI-readable contract)

Every error that leaves the box must be readable by a future agent — human or AI — with no access to the current conversation. The contract is narrow and worth memorizing:

1. **Throw a `BrainError` at any API boundary you own.** `@brain/core` exports it; construct with `{code, category, message, remediation?, retryable?, status?, fields?, cause?}`. Use a `SCREAMING_SNAKE_CASE` code that a future reader can grep for (`EMBEDDING_NO_PROVIDER`, `ORACLE_CAP_EXCEEDED`, `DB_UNIQUE_VIOLATION`). Use one of the 10 fixed categories: `auth | db | http | llm | embedding | validation | rate-limit | external | config | internal`. Remediation is a *hint the reader can act on*, not a restatement of the message.

2. **Never swallow an error at a boundary.** The canonical shape at a `catch` site is:
   ```ts
   try { ... }
   catch (err) {
     await captureError(log, err, { op: "verb.noun", ...otherFields }, "human-readable-msg");
     throw err; // or map to an HTTP envelope
   }
   ```
   `captureError` emits the structured line AND forwards to Sentry when `SENTRY_DSN` is set. Use `withTimer(log, "verb.noun", fn)` for anything worth a dashboard graph — it emits exactly one `ok`/`error` line with `durMs` and re-throws on failure.

3. **Wrap the request edge with the request helper.** Next.js routes → `withApi("verb.noun", handler)` from `apps/web/lib/brain/log.ts`. MCP tool handlers → the dispatch in `apps/mcp-server/src/index.ts` already wraps every `CallToolRequest` with `withRequest(shortId(), ...)`. Worker job handlers → the `boss.work(...)` callbacks in `apps/worker/src/index.ts` already wrap with `withRequest("job-${id}", ...)` and `captureError`. Never skip the wrapper: it's what connects the failure line to the `requestId` echoed in the `x-request-id` response header.

4. **Pick `op` names by verb-noun.** `oracle.ask`, `knowledge.create`, `embedding.call`, `kea.extract`, `mcp.tool`, `rate-limit.redis`. This is the primary group-by column in any future log-dashboard query. Keep them stable; renaming an `op` is a breaking change to observability.

5. **Outcome tag per boundary.** Every timed/error line carries `outcome: "ok" | "error" | "timeout"`. Error lines additionally carry the serialized `err` (category/code/remediation/stackHead). A request is never mid-air by the time its log line is emitted — the pino call is the last thing before the function returns or throws.

6. **Secret hygiene: logger, errors, and envelopes all redact.** `BrainError.fields`, `captureError.fields`, and the Sentry `beforeSend` hook all pass through `redactFields`. A token can still leak if you stringify it into a `message` — don't do that. If the field name is semantic (`fooToken`) the redactor catches it; if you invent a new name for a secret, add it to `REDACT_KEYS` in `packages/core/src/logger.ts` in the same PR.

7. **Requests are correlatable end-to-end.** `withRequest` uses AsyncLocalStorage so every nested `log.*()` automatically inherits `requestId`. The request helper echoes that id in `x-request-id` on the response. When a user pastes an error back to an AI agent, the agent can grep the production log by that id and see every line the request produced — no bespoke tracing infra required.

An error log line you will see in prod:
```json
{"level":"error","time":"…","service":"web","requestId":"abc12345","op":"oracle.ask",
 "route":"/api/oracle","method":"POST","status":502,"durMs":812,"outcome":"error",
 "err":{"name":"BrainError","code":"EMBEDDING_ALL_PROVIDERS_FAILED","category":"embedding",
        "message":"All embedding providers failed.","retryable":true,
        "remediation":"Check provider API keys and quotas. Logs show which provider failed and why.",
        "stackHead":["Module.tryChain (packages/core/src/embedding.ts:119:9)", "…"]}}
```
Everything the agent needs to continue — stable `code`, actionable `remediation`, exact throw site — is in that single line.

---

## 8. Performance budgets

| Path | Budget | Breach action |
|---|---|---|
| `brain_retrieve_knowledge` (p50) | < 300 ms | investigate pgvector index |
| `brain_retrieve_knowledge` (p99) | < 1 s | page |
| `brain_report_session_outcome` | < 500 ms (enqueue only) | never block on KEA |
| `brain_ask_oracle` (first token) | < 1.5 s | investigate model latency |
| `brain_log_event` | < 100 ms | investigate DB write path |

KEA extraction runs in the worker with 3-second budget, enforced.

---

## 9. Adding a new MCP tool

1. Create `apps/mcp-server/src/tools/<name>.ts` exporting a `ToolDef`.
2. Validate input with a zod schema.
3. Call out to `@brain/core` functions; do not inline logic in the handler.
4. Register in `apps/mcp-server/src/tools/index.ts`.
5. Document in `docs/MCP_TOOLS.md`.
6. Add a schema test that parses valid + invalid input.

**MCP surface-area principle — read + safe-write, not destructive (v0.14.0, an early PR).** The MCP tool surface is for operations a coding agent should be able to perform autonomously *during a session*: reading knowledge/skills/sessions, recording outcomes, creating projects, starting sessions, teaching new rules. Destructive operations — deleting a project, renaming an organisation, moving sessions between projects, inviting/removing teammates, rotating an admin password, revoking another user's token — stay in the webapp behind an explicit human click. The line is: **if undoing the operation requires looking at an audit log, it doesn't belong in MCP.** A new tool proposal that crosses this line needs an explicit decision in the PR description; the default answer is "build it in the webapp instead." This keeps the agent's blast radius bounded to operations whose mistakes are recoverable through ordinary use.

---

## 10. Frontend / design system

The webapp is a client-side SPA at `/` with six stateful surfaces. Design tokens, layout rules, and responsive breakpoints live in **`apps/web/app/globals.css`** and are sourced from the handoff bundle at `research/design/` (External Brain design via Claude Design).

Rules when touching frontend:

- **Design tokens are not Tailwind utilities.** Use CSS variables (`--accent`, `--ink`, `--bg-elev-*`, `--k-*`, `--font-mono`) defined in `globals.css`. Tailwind 4 remains available for hypothetical new code but the Brain surfaces do not use it.
- **`grep` the token before you type it.** `var(--bg-2)` shipped on `/start` (v2.15.0) — not a real property anywhere in `globals.css`. It didn't error: an undefined custom property with no fallback resolves to nothing, so the two elements using it silently rendered with no background fill at all. This bug class is invisible to typecheck, to a `git diff`, and to anyone who doesn't happen to be looking for a missing fill on that specific element. Before writing `var(--name)`, `grep -n "^\s*--name:" apps/web/app/globals.css` and confirm it exists — a color/size value typed from memory is a guess wearing the syntax of a fact. See `APPROACH.md §2.6d`.
- **The `--ink-4` small-caps label is a caption, not a heading.** It's correct for a genuine kicker-over-a-headline (the "EXTERNAL BRAIN" line above `/`'s H1) or a data caption in a dense panel — wrong as the *only* heading style on a persuasion page. `/` and `/start` originally gave every section the identical 13px `--ink-4` treatment regardless of whether it was the cornerstone content or a footnote, which reads as "nothing here is more important than anything else" — the opposite of what a landing page needs. Real section headings on those two pages now use 20px/600/full-contrast `--ink` (matching `/docs`'s own concept-page headings) with a small `--accent` tick, borrowed from the "this matters" idiom `.rail-item.active::before` already uses elsewhere in the shell.
- **A heading/card/table treatment introduced on one page belongs in a shared component, not copy-pasted inline styles.** `SectionHeading` (the accent-tick `h2`) shipped inline inside `landing.tsx` first, then had to be re-derived by eye for `/docs`'s tutorial and concept pages before it was extracted to `components/brain/section-heading.tsx` and imported by all three. A visual idiom that exists in exactly one file's inline `style={}` is invisible to every other page that should reuse it — extract to a shared component in the same PR that introduces the idiom, not after a second page is caught not matching it (`KNOWLEDGE.md §12.35`).
- **Rewriting a tutorial section re-opens every docs defect whose fix lived in that section's wording — run the three greps before you commit.** A rewrite replaces text without any signal that the text was load-bearing on code behaviour, so a v2.15.0 rewrite of `00-quick-start` silently reverted three fixes from the previous week (`KNOWN_ISSUES.md §0ak`). After editing any `docs/tutorials/*.md`, run these **scoped to `docs/tutorials/`** — pointing them at all of `docs/` produces permanent false positives, because `KNOWN_ISSUES.md` and `APPROACH.md` quote the bad patterns while documenting them:

  ```bash
  # 1. Host placeholder must be the literal `<your-brain>` in EVERY language —
  #    withResolvedHost() string-matches it, so a localized variant (<dein-brain>,
  #    <brain-ของคุณ>) is never substituted and ships raw to the reader.
  grep -rn 'dein-brain\|brain-ของคุณ\|ihr-brain' docs/tutorials/

  # 2. An in-app destination mentioned in prose should be a link, not inline code.
  #    Covers hash routes (/#oracle, /#skills) and placeholder-host URLs
  #    (`https://<your-brain>/start`), both of which a naive `/[a-z]` regex misses.
  grep -Pn '(?<!\]\()(?<!\[)`(https://<your-brain>)?/[a-zA-Z#][^`]*`' docs/tutorials/
  ```

  Then (3): if you changed a worked example / session transcript, grep its distinctive phrase repo-wide — copies exist in sibling tutorials *and* in the same file's own reference tables, so editing one produces a silent contradiction rather than a merge conflict.
- **Renaming or rewording a markdown heading breaks every `#anchor` link that points at it, and nothing checks this.** GitHub (and most renderers) derive a heading's anchor slug from its exact text — reword `## Shortcut — have a voucher code?` to `## Have a voucher code? Let your AI do it` and `#shortcut--have-a-voucher-code` silently stops resolving. `resolve-doc-link.test.ts` verifies route rewriting, `doc refs (no phantom PRs)` CI checks PR numbers in prose — neither checks that a `#fragment` still matches a real heading. After renaming a heading, `grep -rn "filename.md#"` across `docs/` and fix every hit (`KNOWN_ISSUES.md §0ah`).
- **A relative markdown link only works for one of its two readers unless the renderer translates it.** `docs/tutorials/*.md` is read by GitHub's file viewer (where `./01-getting-started.md` is correct) and by the in-app renderer, which serves the same tutorial with no `.md` suffix and no per-language route — every cross-tutorial link 404'd in the app until `resolve-doc-link.ts` added a render-time rewrite. Do not "fix" this by changing the link syntax in the `.md` source; that breaks GitHub instead. If you add a new doc surface that reuses existing markdown, route its links through (or extend) `resolve-doc-link.ts` rather than hand-writing a third link convention (`KNOWLEDGE.md §12.35`).
- **State-based navigation, not route-based.** See `APPROACH.md §4.6` and `docs/NAVIGATION.md`. A new surface edits `routes.ts` + i18n + `components/brain/app.tsx` — never a sibling folder under `app/`.
- **Every Brain component is a client component.** They read `BRAIN_DATA` today; when wired to the API, prefer React Server Components for the data-fetching parent and keep interactive children as clients.
- **i18n first, English authoritative — three languages (EN/TH/DE).** Every user-visible string routes through `useT()` / `translate()`. Add keys to all three dictionaries in the same commit. EN is authoritative; TH and DE are full translations, not scaffolds. AI-generated translations are acceptable as a starting point for new keys but must be flagged in `docs/KNOWN_ISSUES.md` (under the i18n section) so a native speaker can sweep them later. Do not hard-code user strings. Use beginner-friendly terminology (e.g. "Rule of thumb" instead of "Heuristic", "Metadata" instead of "Frontmatter") to ensure accessibility for non-technical users. *(History: TH and DE were briefly deleted in v0.13 as a simplification, then restored in v0.14 after user feedback — the operator base actually spans those languages. The lesson is in `APPROACH.md §5al`.)*
- **Long-form docs content is the one exception to the `useT()` rule — translate it as parallel data, not dictionary keys.** The in-app `/docs` prose lives in `apps/web/lib/brain/docs-content.ts` as structured `DocPage` objects (title/summary/sections/bullets), not short UI strings. Translate it via the parallel `DOCS_TH` / `DOCS_DE` records and resolve with `getDoc(lang, slug)`, which **falls back to the EN page per-slug** so a missing translation degrades to English, never a 404 or a raw key. Short docs *chrome* (index title, section group headings, "Related concepts", etc.) lives in `DOCS_CHROME` via `getDocsChrome(lang)`. The `/docs` pages are **client components** (`useLang()`) so the unauth `<LocalePicker>` switches the whole surface in place with no reload; they still SSR in the cookie-resolved locale via `LangProvider`. New concept pages add a slug to all three records in the same PR; AI-translated TH/DE prose for *new* pages should still be flagged in `docs/KNOWN_ISSUES.md` for review (the original #59 batch was operator-reviewed & accepted 2026-06-22; v1.9.0 added `using-from-your-agent` / `graph` / `decisions`, flagged for the next sweep). **Two couplings to keep:** (1) a new page must also be added to the `DOCS_SECTIONS` index array — a page absent from it exists at its URL but never appears on `/docs`; (2) any nav-surface `HelpPopover` `docHref` must point at a slug that actually exists. `graph` and `decisions` shipped with `HelpPopover` "Read more" links pointing at concept pages that didn't exist yet (dead links) — author the doc and wire the `docHref` in the same change. For text the user types to an English-speaking agent (the agent-prompt `callout`s on `using-from-your-agent`), keep the source **English in every locale** — translate only the surrounding instructional prose.
- **Two help primitives — page-level `HelpPopover` vs inline `InfoDot`.** `HelpPopover` (`help-popover.tsx`) is the "what is this *surface*?" popover in a route header (What / What you do here / Related + a `docHref`). `InfoDot` (`info-dot.tsx`) is a term-level "?" placed next to a single word (a badge, a column header) that tooltips a one-line definition and optionally links to a concept page. Reach for `InfoDot` **only** when a term has no existing explanation — most surfaces already carry `title=` tips or a `HelpPopover`, so a blanket tooltip sweep duplicates them and adds clutter (violates §10a "quiet by default"). The genuine gaps closed in v1.9.0 were the Skills *type* filter and the dashboard `PulseLine` *Quality* (SQS) number.
- **Translation strings must never embed dynamic numbers, counts, or sample values.** Mock placeholder text like `"0 items retrieved · 2 cited"` is the bug pattern from PR #95 — the literal `2` shipped to all three languages and rendered even when the real count was 0. Counts go in either (a) format-string substitutions (`"{n} cited"` interpolated at render time) or (b) a separate trailing key wrapped in a conditional render (`{count > 0 && <> · {count} {t("oracle.citedInline")}</>}`). When you write a translation string, ask: "if a future reader sees this number in this dictionary entry, is there any way it stays correct as data changes?" If the answer is no, it doesn't belong in the dictionary.
- **Persisted UI state uses the `bp_*` localStorage prefix.** Current keys: `bp_tweaks`, `bp_route`. Prevents collisions with other apps on the same origin.
- **Zero-error nav.** Any change that touches the shell, keyboard handler, or palette must pass the checklist in `docs/NAVIGATION.md §3` before merge.
- **Font loading via `next/font`**, not `<link>`. See `apps/web/app/layout.tsx` — adding a font family means adding the loader and the CSS variable.
- **Pre-hydrate theme script.** The inline `<script>` in `app/layout.tsx` reads `bp_tweaks` and applies theme/accent/density/lang before React mounts. Do not remove it; removing it causes a visible flash of default theme.
- **The default theme lives in three places and they must move together.** `tweaks.ts::DEFAULT_TWEAKS.theme`, `layout.tsx`'s SSR `<html data-theme>`, and the pre-hydrate script's `t.theme || '<default>'` fallback. Changing one without the other two reintroduces the flash-of-wrong-theme the pre-hydrate script exists to prevent — a visitor briefly sees the SSR default, then gets yanked to the pre-hydrate script's default a frame later, and the two must agree or that yank is visible. First-visit default is light as of v2.15.0 (`KNOWLEDGE.md §12.33`); this governs only visitors with no stored `bp_tweaks` — the `<Tweaks>` theme buttons write a full state object to `localStorage` unconditionally and are never gated by this constant.
- **`<Tweaks>` (the theme/accent/density toggle) is mounted only in the authenticated shell (`components/brain/app.tsx`).** The five anonymous surfaces sharing `<LocalePicker>` — `/`, `/start`, `/signin`, `/welcome`, `/docs` — have a language switcher but no theme control. If you add a theme toggle to any anonymous page, it does not exist as a reusable component yet; the language picker's fixed-position pattern in `locale-picker.tsx` is the template to follow, not `<Tweaks>` itself (that component assumes an app-shell layout).
- **Server-component env vars need `force-dynamic`.** `deploy/Dockerfile` builds with dummy env vars (see "Dummy env so env validation at top-level doesn't crash the build" in the builder stage). Any `app/**/page.tsx`, `app/**/layout.tsx`, or `app/**/route.ts` that reads `process.env.X` at module/server-component scope **must** add `export const dynamic = "force-dynamic"` — otherwise Next.js statically pre-renders the page during the Docker build with empty values and the deployed container's real `process.env` is never re-read. `NEXT_PUBLIC_*` vars are exempt (they're inlined at build time on purpose). This is the earlier lesson — v0.14.0 shipped `/welcome` with a server-injected `BRAIN_MCP_PUBLIC_HOSTNAME` that produced an empty URL in prod for exactly this reason; v0.14.2 fixed it by adding `force-dynamic`. When you write a new page that reads deploy env, add the directive at the top before you forget. The class-of-bug audit lives at [`docs/GUIDELINES.md §10`](./GUIDELINES.md#10-frontend--design-system).
- **Public URLs come from `req.headers['x-forwarded-host']`, not `req.url`.** Inside the Docker container, `req.url` resolves to the internal upstream (e.g. `http://0.0.0.0:3000`), not the public hostname. Constructions like `new URL("/foo", req.url)` will emit `https://0.0.0.0:3000/foo` in Location headers — wrong for any client behind nginx/Caddy. Either (a) use a path-only Location header (RFC 7231 §7.1.2 permits relative refs, browsers resolve against the request URL), or (b) read `x-forwarded-host` + `x-forwarded-proto` from `headers()` if you genuinely need the absolute form. The favicon redirect is the worked example.
- **Mount-gate every client-only global reachable from render (`#418` class).** Reading `window` / `navigator` / `localStorage` / `Date.now()` / `Math.random()` *during render* (incl. `useMemo` and `useState(initFn)`) makes the server's HTML differ from the client's first render → React `#418`. The rule: initialize state to an SSR-safe default and read the real value in `useEffect` after mount (the pattern `useRoute` / `useProjectScope` / `useTweaks` use). Repeat offenders found: `ShowEverythingFold` localStorage (#fixed 06-05), `useEnvLabel` hostname + `/welcome` snippet `window.location` (#fixed 06-07). Before merging shell/dashboard/first-run changes, run `grep -n "typeof window\|typeof navigator"` over the touched files and confirm each hit is inside an effect or handler, not a render path. A component that only ever mounts *after* a client interaction (e.g. a modal opened on click) is exempt — it never hydrates.
- **Relative time goes through `@brain/core/format-relative` — never hand-roll.** v0.15.0 consolidated four divergent local formatters (oracle/graph/connection-status each rendered "2 days ago" differently) onto the canonical `formatRelative(iso)` → `just now / Nm / Nh / Nd / Mmm D`. Import via the subpath `@brain/core/format-relative` (it's split out specifically so it doesn't pull `@sentry/node` into the browser bundle). Keep the hydration-safe wrapper pattern (`<RelativeTime>` / `<RelativeText>` render the absolute date on SSR + first paint, swap to relative in `useEffect`) — `formatRelative` reads `Date.now()`, so rendering it directly causes hydration mismatches (audit FE5, #103).
- **User-facing copy is plain English; internal metric names stay in code/docs/DB (Phase R.5).** Surfaces show "Quality" / "Answer relevance" / "Brain"; the code/schema/docs keep `SQS` / `NDCG@5` / `KEA`. The normative mapping lives in `docs/KNOWLEDGE.md`. When adding a new metric, give it a plain-English label and keep the precise name in a `title=` tooltip, not the visible text.
- **Removing or narrowing a page's job means grepping for every `href` that points at it, not recalling who might link there.** When `/welcome`'s tool-picker was removed (v2.15.0), three unrelated surfaces still pointed at it as an install flow — `landing.tsx`'s "Quick start" card, the empty-Brain dashboard callout's primary CTA, and `/start`'s guided-tour link — found only by `grep -rn 'href="/welcome"'` across `apps/web`, not by remembering. A link that used to be correct doesn't announce that it stopped being correct; nothing fails loudly when a target page's content changes shape underneath it. Run the grep before merging any change that removes content a page was previously known for.
- **Server-resolved public URLs come from `lib/brain/public-urls.ts` — never from `window.location`.** Any surface rendering a copy-pasteable config snippet (MCP endpoint, install command, `mcp.json`) must take the URL as a prop from a server component that calls `resolvePublicMcpUrl()` / `resolvePublicWebUrl()`, plus `export const dynamic = "force-dynamic"`. A `${window.location.hostname}:3100` guess is correct only for local dev: behind Caddy the MCP server is its own vhost on :443 and that port is closed. A `"use client"` page **cannot** read the deploy env at all — if a page needs one of these values, that is the signal to split it into a server wrapper plus a client body (`app/settings/tokens/page.tsx` + `tokens-client.tsx` is the reference). This defect shipped three times across three surfaces (KNOWN_ISSUES §0c, §0r); the guard is `lib/brain/public-urls.test.ts`.

### Accessibility (WCAG 2.1 AA is the floor)

The 2026-08-05 audit (`KNOWN_ISSUES §0r`) found the design tokens already pass contrast comfortably — worst case `--ink-4` on `--bg-elev-3` is 5.11:1 against a 4.5 requirement. The failures were all in behaviour, not palette:

- **A reset and its restore must name the same elements.** `input, textarea { outline: 0 }` paired with a `:focus-visible` rule listing only `input` left every textarea with no focus indicator (2.4.7). When you add an element to a reset, add it to the restore in the same edit.
- **Never rely on colour alone for links.** The global `a { color: inherit; text-decoration: none }` is right for nav chrome and wrong for prose. Inline links use `p a:not([class])` / `li a:not([class])`, which underline and take `--accent-text` (1.4.1).
- **No single-character keyboard shortcuts on a global listener.** WCAG **2.1.4 is Level A** and requires them to be turn-off-able, remappable, or *active only on focus*. A `window` keydown handler guarded only against text-entry elements still misfires when a link or button holds focus. If a surface genuinely needs accelerators, scope the listener to the focused container. This is distinct from — and must not be traded against — standard keyboard operability (Tab/Enter/Esc, visible focus rings), which is mandatory.
- **Destructive actions announce their outcome.** A bulk mutation that reports "N rows deleted" visually only gives a screen-reader user no confirmation it happened (4.1.3). Wrap the result in `aria-live`; `role="status"` for success and undo offers, `role="alert"` only for genuinely interruptive failures.
- **Icon-only controls and placeholder-labelled inputs need an accessible name.** A `placeholder` is not a label — it disappears on input and several screen readers skip it. Add `aria-label`.
- **Use the design tokens for state colours.** Hardcoded hex bypasses theming *and* the contrast work: `white` on `#e05252` measured 3.82:1 on the reset-knowledge button. `--bg` on `--bad` is 8.36:1.
- **Honour `prefers-reduced-motion`.** `globals.css` carries a global reduce block; any new looping animation is covered by it automatically — don't defeat it with a more specific `!important`.
- **Thai needs vertical headroom.** `html[lang="th"]` sets `line-height: 1.4` on headings and `1.75` on body text, with `!important` because the tight Latin-tuned values are inline styles. Thai stacks an upper vowel plus a tone mark above the baseline; a 32px/1.1 line box overlaps by 6.8px where the Latin control does not collide at all. Measure with `TextMetrics.actualBoundingBoxAscent + actualBoundingBoxDescent` against the computed line box rather than eyeballing a screenshot.

---

## 10a. Design principles (when to show what)

The webapp is a dense knowledge tool, not a marketing surface. These principles govern *what appears on screen and when* — code-style rules are in §1, design tokens in §10. Full rationale + examples live in [`docs/DESIGN_PRINCIPLES.md`](./DESIGN_PRINCIPLES.md); this section is the terse normative version.

- **Progressive disclosure.** Default to the smallest useful surface. Power lives one click, one hover, or one expand away — never on the default canvas. The session-card → per-session value drill-down (an early PR) plus its dashboard wiring + project-level companion (an early PR) are the reference pattern: the row stays terse; the depth is opt-in.
- **Earned surface area.** A panel, tab, or card only ships once the data to populate it exists. Empty dashboards train users to ignore the UI. If a feature has no data on day one, gate it behind a real precondition (`hasSessions`, `hasKnowledge`, `hasProject`) and show nothing until the precondition is met — not a placeholder. `ProjectsList` (an early PR) is the canonical implementation: returns `null` at 0 projects, one compact row at 1, full list at ≥2.
- **Quiet by default, loud on demand.** Background work (KEA, cross-extract, decay) is continuous. The UI whispers it through small status surfaces (last-extracted timestamp, count badges) and only escalates to a banner or modal when the user must act. No toast for routine success. The "Right now" section was demoted below user-facing surfaces in an early PR for this reason.
- **One principle per disagreement.** When two contributors disagree on a UI call, the resolution is "which of the three above does this serve?" — not taste. If none of them apply, the change is probably scope creep.

Casual shorthand for these three together: **"deceptively simple"** — the surface looks light, the depth is real.

**v0.14.0 validated these at scale.** The dashboard + every destination page (Skills, Sessions, Oracle, Graph, Autoskill, Settings) were re-walked under the three principles in a single coordinated sweep. Empty states were re-gated (panels return `null` until they have data, never placeholder copy); detail panes consolidated under the per-session / per-project drill-down pattern from earlier PRs; the "Right now" system-chatter band sits below user-facing content on every surface that has both. The principles are no longer aspirational — they are what the production surfaces look like, and any new surface should match. See `APPROACH.md §5aj` for the subagent-driven dispatch pattern used to land the sweep.

---

## 11. Adding a new knowledge type

Do not. The 5-category **rule** ontology is deliberate and research-backed. If a new category is truly needed:

1. Propose in a PR that amends `docs/KNOWLEDGE.md §2` and `research/knowledge/08-knowledge-ontology.md`.
2. Discuss with reviewers before writing code.
3. Migration: backfill existing knowledge; update KEA prompt; update KRA formula; update formatter.

A new type is a cross-cutting change — expect 15+ files touched.

**The one shipped exception (V2.0, 2026-07-07): non-rule type values.**
`action_item` (meeting to-dos / open questions) was added as a type *value* on
the existing string column — no entity, no migration — precisely because it is
NOT a rule and must be excluded from rule semantics. If you ever add another
non-rule value, its mandatory sweep is the inverse of step 3: **exclude** it
from KRA semantic retrieval and the Oracle's semantic context (share
`RULE_TYPES_PREDICATE` in `kra.ts`), keep it out of the KEA/learnings enums,
never record its injections as `SessionKnowledgeApplication` rows
(loop-health metric purity), **and block it from the visibility-travel paths
— promote, fork-to-project, and any org-scoped serving query** (the
2026-07-10 security review found `action_item` rows could be org-promoted and
leak meeting content into every project's Oracle; for non-rules the isolation
line is the project, full stop). Surfacing must be deterministic (tag/field
match), never embedding-scored. See `docs/KNOWLEDGE.md §2` and the spec
`docs/superpowers/specs/2026-07-07-brain-v2-meeting-doc-intelligence-design.md`.

---

## 12. Working with AI assistance

This repo is explicitly designed to be extended with AI assistance. When doing so:

- Give the AI `docs/BLUEPRINT.md` and the relevant `docs/*.md` files as context, not the full codebase.
- Prefer small, reviewable diffs. An AI-generated 1000-line change is a review failure, not a productivity win.
- Always have the AI run tests before declaring a task complete.
- If the AI proposes violating an invariant, reject the proposal and restart.

This is the same spirit the platform is built to serve: AI + persistent knowledge + human oversight.

---

## 14. GUI ↔ Backend wiring

Conventions established during the wiring pass (2026-04). Follow them on every new route or hook.

**Hook fallback (use-\*.ts)**
Every `lib/brain/use-*.ts` hook must: (a) fetch with `cache: "no-store"`; (b) on failure set `loadState = "mock"` and return seed data from `BRAIN_DATA`; (c) expose the error message so the surface can render a "seed" chip. Reference: `use-knowledge.ts`, `use-sessions.ts`, `use-autoskill.ts`.

**View-model indirection**
API routes return view types from `lib/brain/views.ts` (`KnowledgeItemView`, `ProposalView`, `SessionView`, …), never raw Prisma models. Mapper functions (`toKnowledgeItemView`, `toProposalView`, `toSessionView`) are the schema→GUI contract — update the mappers when the Prisma schema changes, not the components.

**Auth on every route**
Every API route that touches `@brain/db` must call `getCurrentUserId()` from `@/lib/brain/auth` first, wrap the handler body in try/catch, and return `authErrorResponse(err)` on failure. Scope checks (`row.ownerUserId !== userId`) return 403 before any mutation.

**Zod schemas for write bodies**
Every POST/PATCH/DELETE body must pass through a zod parse before use. Pattern: `const body = bodySchema.parse(await req.json())`. `ZodError` is caught and returned as 400 via `authErrorResponse`.

**Client write paths return the fresh view**
PATCH/POST endpoints return the updated view (`{ item: toKnowledgeItemView(row) }`) so the client can splice it into state without a separate refetch. See `use-knowledge.ts` update/fork for the pattern.

**exactOptionalPropertyTypes**
`tsconfig` has `exactOptionalPropertyTypes: true`. Never explicitly assign `undefined` to optional fields; omit the key from the object literal. For Prisma `data` objects, build a `Record<string, unknown>` and conditionally insert keys.

**Next.js webpack (not turbopack)**
`next build` runs with the `--webpack` flag (already in `apps/web/package.json`) until Turbopack supports `extensionAlias` for NodeNext `.js→.ts` resolution across workspace packages. The webpack config in `apps/web/next.config.ts` sets `resolve.extensionAlias`; do not remove it.

**Polling cadence**
`useCounts` polls every 30 s; `useLiveExtraction` polls every 15 s. Do not add further polling surfaces without a SWR/SSE strategy — revisit before scaling.

**Streaming surfaces (SSE)**
Long-running endpoints that the user is waiting on (Oracle answers, future KEA spot-checks) stream Server-Sent Events. Contract: one route per streamed capability, Content-Type `text/event-stream`, `event: <kind>` + `data: <json>` pairs, a terminal `event: done`. Frontend consumers parse with a minimal `parseSSE(body: ReadableStream)` generator — do not pull in `EventSource` since we POST. See `apps/web/app/api/oracle/stream/route.ts` and `apps/web/lib/brain/use-oracle.ts` for the canonical shape. All new stream producers must forward `req.signal` into the underlying LLM SDK (cost/correctness).

**Writing a CI gate that blocks a PR.** Gate on the *values* that matter, not on whether a file was touched, and validate against real repository history in both directions before shipping it. `scripts/check-benchmark-coherence.sh` is the worked example: it compares `kra.ts`'s `WEIGHTS` and `CANDIDATE_POOL_SIZE` across the merge base, so comment rewrites and refactors are invisible to it while a retune is not — a file-level check would have blocked the #174 scope work, which edited `kra.ts` without moving a single weight. **A gate that cries wolf gets switched off, which is worse than no gate**, so the negative test (a real historical PR it must stay silent on) matters more than the positive one. Resolve the merge base once and use it for every comparison in the script; mixing a branch tip with a three-dot diff makes the gate's answer depend on how far `main` has moved.

**Rate limiting (`apps/web/proxy.ts`)**
Next 16 renamed `middleware.ts` → `proxy.ts`. One `proxy` runs for every `/api/*` request and enforces **fixed** windows keyed by client IP — `check()` opens a fresh bucket once `resetAt` passes, it does not slide. That matters for reasoning about burst behaviour: a caller can spend a full allowance at the very end of one window and another immediately at the start of the next, so the true worst case across a boundary is ~2× `max`. Size auth limits with that in mind. Adding a new endpoint class: (a) add a `classify()` branch with a distinct name; (b) either reuse an existing `RATE_LIMIT_*` env or add one to `.env.example`; (c) verify the `x-ratelimit-*` headers in a local curl before merging. Store selection is automatic: Redis when `REDIS_URL` is set, in-memory otherwise — both implement the async `Store` interface in `packages/core/src/rate-limit.ts`.

**The `Store` contract is one atomic `increment(key, windowMs, now)` — do not reintroduce a get-then-set pair.** It used to be `{get, set}`, and that could not be composed safely: concurrent callers all read the same pre-increment count, so a burst advanced the bucket by **one regardless of its size** and a caller who kept requests in flight was never limited at all. Measured against a real Redis, 50 concurrent clients moved the old counter to **2**. That is an unbounded bypass **of the application limiter** — `deploy/Caddyfile` still capped `/api/*` at 10 events per IP per second at the edge, which is three-plus orders of magnitude looser than the control it was masking and per-IP besides. The limiter guards the **auth surface** — voucher redemption (the invite-code gate), register, forgot-password — not just the LLM-cost caps. In-memory does its read-modify-write with no `await` between read and write and copies the bucket out; Redis runs `INCR` + conditional `PEXPIRE` + `PTTL` as one Lua script. A new store must be atomic by construction, and Redis errors degrade to the per-process limiter rather than letting a request through uncounted.

**The Redis adapter's decision logic lives in `@brain/core`, not in `apps/web`.** `redisWindowMs()` and `bucketFromRedisReply()` sit beside the `Store` contract so they can be unit-tested without a client — the same seam pattern §4 prescribes for LLM calls. `apps/web/lib/brain/rate-limit-store.ts` keeps only the `client.eval` call and the fallback wiring. Keep it that way, because the branches that matter (malformed reply, impossible count, `PTTL` of −1/−2, Redis unreachable) fire *only* when Redis misbehaves — healthy production traffic is no evidence at all that they are correct. `bucketFromRedisReply` returns `null` for a reply `INCR` could not have produced, including a count below 1: trusting such a count would make `check()` compute `ok` forever and grant unlimited requests, so a corrupted key falls back instead.

**Know what that degradation costs.** Falling back to per-process state is the right call over returning 500s, but on a multi-replica deployment it means each replica counts independently — a caller spreading requests across N replicas gets roughly N× the intended allowance for as long as Redis is unreachable. On the single-replica reference instance the fallback is exact; anyone running multiple replicas should alarm on the `"redis error — falling back to in-memory rate limiter"` log line (emitted at most once a minute) and treat a sustained outage as a reason to shed auth traffic, not just to keep serving.

**Set `REDIS_URL` on any server deploy.** Compose only passes the value through (`REDIS_URL: ${REDIS_URL:-}`); it does not supply it. Without it the limiter is correct on a single replica but its state resets on every deploy or `reload.sh web`, silently clearing daily caps such as `RATE_LIMIT_MEETING_EXTRACT_PER_DAY`. Confirm it took by grepping the web logs for `"redis ready"`.

**Production auth enforcement**
`apps/web/lib/brain/auth.ts` calls `refuseDevShimInProduction()` before falling through to the dev shim. When `NODE_ENV=production`, the shim throws `AuthError(500)` unless `ALLOW_DEV_AUTH_IN_PRODUCTION=true` is set explicitly (intended for VPN-only deploys). Never relax this — it's the final guard against shipping a deploy that serves every visitor as the first User row.

**Audit log + secret redaction**
Mutating admin-surface-visible actions go through `writeAudit({actorUserId, action, targetType, targetId, payload, ip, userAgent})` from `@brain/core/audit`. Payloads are redacted with a recursive 4-deep key-pattern match against `token|secret|password|apiKey|authorization`. New audit actions: add the string literal to the `Action` union in `packages/core/src/audit.ts`; there is no schema migration required because the column is free-form text. Already wired: knowledge create/patch/delete/fork + token create/revoke/rotate.

**Cost-cap alerts**
`packages/core/src/cost.ts` emits a warn log at 80% and an error log (+ Sentry `captureError`) at 100% of `MAX_ORACLE_COST_USD_PER_DAY`. Dedup is in-process, keyed `${userId}:${day}` — so each process alerts once per user per UTC day. Multi-replica deploys will alert `N × (users × 2)` times per day in the worst case; that's accepted as cheaper than a shared dedup table.

**Knowledge edits fork, not patch**
Never send `ruleText` / `triggerText` / `rationale` in a PATCH body — the server returns `409 immutable_field` (KNOWLEDGE.md §5.1). For semantic edits, POST to `/api/knowledge/[id]` with `{ action: "fork", overrides: { ruleText } }`. The UI already does this via `useKnowledge.fork`.

**Auth is dual-mode; never silent-fallthrough**
`lib/brain/auth.ts` resolves `getCurrentUserId()` in one of two mutually exclusive modes. If `authEnabled()` (the three `AUTH_GITHUB_*` + `AUTH_SECRET` envs set), the JWT session is the only accepted identity and a missing session throws `AuthError("not_signed_in", 401)` — we never fall through to the dev shim when OAuth is configured. This is load-bearing: a silent fallthrough would expose the dev user's data to unauthenticated requests. Don't soften this check.

**MCP tokens are per-user, hashed, revocation-first**
When issuing a token, point the operator at `/settings/tokens` and let the wizard generate the install command — don't paste raw bearer values into chat or tickets. The wizard interpolates the token client-side and never sends it back over the wire.

`/api/tokens POST` returns the raw value exactly once; it is never retrievable again. Every `brain_*` call re-verifies `revokedAt IS NULL AND (scheduledRevokeAt IS NULL OR scheduledRevokeAt > NOW())` on the token — revocation is immediate across the fleet with no cache warmup. When adding a new tenant-scoped MCP capability, filter by `auth.userId` at the query layer, not the handler layer — same rule as the REST endpoints (NAVIGATION.md §12.3).

If you suspect a token may have been seen by someone unintended, use `POST /api/tokens/:id/rotate` with `{ graceHours: 0 }` — this is the fast-revoke path. The old token is rejected at the next auth check (within seconds) while the new token is immediately usable. Use `DELETE /api/tokens/:id` only when you know the token was compromised and have the new token already configured — hard revoke is instant and has no grace window. The audit log records `token.rotate` and `token.revoke` actions with `{ oldTokenId, newTokenId, graceHours }` / `{ tokenId }` respectively; the raw token value is never logged.

**Provider routing via `ANTHROPIC_BASE_URL`**
`packages/core/src/oracle.ts` uses the Anthropic SDK whenever `model.startsWith("claude")` OR `ANTHROPIC_BASE_URL` is set. When routing to an Anthropic-compatible provider (Z.ai GLM, Bedrock, Vertex), pass the provider's own model name (e.g. `glm-5.1`) in `ORACLE_MODEL` — don't rename it to look Claude-ish. Add the price row in `packages/core/src/cost.ts` so cost-cap accounting works.

**Embedding routing via `EMBEDDING_BASE_URL` (provider-agnostic by design)**
`packages/core/src/embedding.ts` uses the OpenAI SDK pointed at whatever `EMBEDDING_BASE_URL` resolves to; falls back to OpenAI's default URL when unset. Key resolution order: `EMBEDDING_API_KEY → GOOGLE_GEMINI_API_KEY → OPENAI_API_KEY → ANTHROPIC_API_KEY`. The `dimensions` request parameter is always sent — choose a provider/model combo where that parameter is honored (OpenAI `text-embedding-3-*`, DashScope `text-embedding-v3` / `v4`, Google `gemini-embedding-001`). Providers that ignore it and return their native dimension produce vectors of the wrong length and insert failures on the pgvector column.

**Adding a new embedding provider** (Gemini is today's recommendation; Qwen3 and others are supported by the same plumbing): (a) add the provider's OpenAI-compatible base URL to the three-option block in `.env.example`, (b) if the provider uses a distinctly-named key env var (`GOOGLE_GEMINI_API_KEY`, `AZURE_OPENAI_KEY`, etc.), extend the `getClient()` fallback chain in `embedding.ts`, (c) confirm the provider honors the `dimensions` parameter, (d) document pricing in `packages/core/src/cost.ts` if chat models from the same provider are also used. No other code changes needed. If your target provider doesn't expose an embedding endpoint at all (Z.ai GLM is chat-only), document it in `.env.example` and do NOT silently fall back to OpenAI.

**Adding a new MCP client to the install wizard** (v1.7.0 added Antigravity + GitHub Copilot this way): (a) add a pure generator to `packages/core/src/install-snippets.ts` that returns the `InstallSnippet` shape — do **not** reuse the `brainMcpEntry` helper, which emits `transport:{type,url}` that most clients reject; each client keys its remote server differently (Antigravity `serverUrl`, VS Code `servers`+`headers`, JetBrains family `servers`+`requestInit.headers`, Copilot CLI `mcpServers`). (b) Register it in `apps/web/components/brain/token-install-wizard.tsx` in the **three** places that must stay in sync — the `ClientId` union, the `CLIENT_OPTIONS` array, and the `snippetFns` Record (the `Record<ClientId,…>` is total, so a missing key fails typecheck). (c) Add a unit case in `packages/core/src/__tests__/install-snippets.test.ts` pinning the distinguishing detail (`serverUrl` vs `url`, `requestInit.headers` vs `headers`) and that the body parses as JSON. (d) Document it in `docs/CLIENTS.md`. Optional telemetry: widen `SessionClientType` (`packages/types`), the zod `.enum` **and** the JSON-schema `enum` array in `start-session.ts`, and the dashboard `clientLabel` switch — this is **migration-free** because `clientType` is a `String` column (`schema.prisma`), not a Prisma enum, so the change stays inside the autonomous-CD no-migration carve-out.

**Dockerfile / deploy patterns (Phase V, 2026-04-22)**
- Compose services hidden behind a `profiles:` list are **not** rebuilt by the default `docker compose build`. If you add a `profile`, also teach the caller to pass `--profile <name> build` — otherwise edits to the base image ship stale into one-shot jobs like `bootstrap`. `scripts/deploy.sh` does this correctly; custom flows must mirror it.
- Workspace apps should run from `src/` via `tsx` in the final image, not from `dist/node`. Cross-package TypeScript resolution diverges too much between the host's cached `tsc` and a fresh Docker `tsc` run to rely on compiled artifacts; lean on the same `tsx` invocation used for `dev`. See the `worker` and `mcp-server` Dockerfile stages for the pattern (`WORKDIR /app/apps/<app>` + absolute `node_modules/.pnpm/node_modules/.bin/tsx` path).
- Next.js page-data collection imports every route server-side at build time. If a module's top-level runs any side-effectful init (Prisma client, logger sinks, etc.), gate it with a build-time `SKIP_DB_INIT=1` or similar and use a throwing Proxy as the stub. Runtime containers never set the flag.
- Prisma's client output belongs **outside** `node_modules` in a pnpm workspace. Set `generator client { output = "../src/generated/client" }` in `schema.prisma`; import from there. The `.pnpm` store's hardlinked files are read-only from the generator's perspective and silently emit stubs otherwise.
- Always install `openssl` + `ca-certificates` in every Debian-slim stage that hosts Prisma. Prisma's engine-detection picks the wrong binary without `libssl.so.3` present.

**BuildKit cache mounts (2026-04-24, measured)**
- The `next build` step gets two `RUN --mount=type=cache,…,sharing=locked` mounts: `/repo/apps/web/.next/cache` (webpack module graph) and `/repo/node_modules/.cache` (swc + next-babel intermediates). `pnpm install` similarly mounts `/pnpm/store`, with `PNPM_STORE_DIR=/pnpm/store` exported in the base stage so pnpm actually places its content store there. `sharing=locked` prevents races between parallel stage builds hitting the same cache dir.
- `scripts/deploy.sh` and `scripts/dev-up.sh` export `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 BUILDX_NO_DEFAULT_ATTESTATIONS=1` immediately before `$COMPOSE build`. Without the first two, the cache-mount syntax is silently ignored on older engines; without the third, buildx attaches a provenance + SBOM manifest list that adds ~20–30 s per stage and doubles image-unpack time.
- Measured warm-warm incremental rebuild of the `web` stage = **2 min 29 s** (webpack compile 40 s). Warm Docker + cold `.next/cache` = 3 min 9 s (webpack 112 s). First-ever build on a pruned machine still costs 20–30 min; the mount prevents recurrence, not first occurrence. Don't downgrade the claim — measure before re-tuning. `deploy/DEPLOY.md §"Build speed"` has the canonical numbers.
- If webpack suddenly takes 100+ s on what should be a warm build, suspect a wiped BuildKit builder: `docker buildx inspect default` and look for `Status: stopped` or a different builder name.
- **Never** add `cache: true` or `inline-cache` flags blindly; they interact badly with `sharing=locked`. Test with `docker compose build --progress=plain` and confirm both `RUN --mount=type=cache,...` lines appear verbatim in the output.
- Webpack is intentional for now (NodeNext + Turbopack `extensionAlias` gap). When Turbopack adds `extensionAlias`, drop `bundler: "webpack"` from `next.config.ts` and the cache mount on `.next/cache` becomes obsolete.

**Modal mount pattern**
Top-level modals (Tweaks, Teach, Notifications, UserMenu) are mounted in `app.tsx` with `open` boolean props and return `null` when closed. They share the `.cmdk-scrim` class for the backdrop. `Escape` closes all modals.

**Progressive disclosure on detail panes**
Three-column surfaces (Skills, Graph, Oracle) hide the rightmost column on first mount. The grid template flips from `"<fixed> 1fr <detail>"` to `"<fixed> 1fr"` when no selection is active, and the detail `<section>` / `<aside>` is wrapped in `{selected && (...)}` so it doesn't render at all. Every detail pane carries: (a) a click-to-open affordance in the list column, (b) an `X` icon-button close control in the header, (c) a `useEffect` that binds `Escape` to `setSelectedId(null)` while a selection is active. Do NOT restore auto-select-first-item effects — first-visit should be uncluttered.

**Graph canvas density**
Node labels truncate at 42 chars on the canvas (full label kept in `<title>` + inspector). Long KEA rules + any e2e-authored test titles otherwise overlap into a wall of unreadable text. Whenever you add a new canvas visualisation, plan for label length BEFORE shipping — a density cap is cheaper than a retrofit.

**pg-boss v10+ queue registration**
Every queue must be created with `boss.createQueue(name)` immediately after `boss.start()` and before any `schedule(name, ...)` or `work(name, ...)` call. Pre-v10 pg-boss auto-created queues on first schedule; v10 enforces the FK (`pgboss.schedule_name_fkey`) and crashes with `Queue X not found`. `createQueue` is idempotent — call it for every known queue on every boot. Missing this check will crash-loop your worker silently (only visible in `docker logs worker`).

**Test-created rows must not leak across runs**
Any E2E test that inserts into the shared DB (fork, create, teach flows) MUST include a cleanup in `afterAll` that deletes the authored rows. Without it, every run pollutes the seed — Graph labels wear out first because of density, but it also inflates list counts and retrieval scores silently. The fork-on-edit test's `"MODIFIED: This is a test edit from Playwright e2e suite."` marker is the canonical pattern — author deliberately-unique strings so cleanup selectors are trivially correct.

**Zero-error navigation iteration — the continuous loop**

A navigation regression (a surface 500s on mount, a redirect loops, a hash route loses focus) is the class of bug that passes typecheck and still ships broken. The process that prevents this is deliberately small so it actually runs every iteration. Define it as:

1. **Change lands** (code edit, schema migration, route rename, env flip).
2. **Reload the affected service** — `./scripts/reload.sh web` for anything UI-facing, `./scripts/dev-up.sh` (local) / `./scripts/deploy.sh` (server) for schema changes.
3. **Nav smoke** — `./scripts/nav-smoke.sh` curls every shell hash-route, every auth route, every admin route, every API probe. 0 = all 2xx/3xx, 1 = at least one surface 5xx'd. Takes <10s.
4. **Lockdown audit** — `./scripts/verify-lockdown.sh` confirms no accidental un-gating. Runs automatically at the end of `reload.sh web` and both deploy scripts.
5. **If either script fails:** fix, go back to step 2. Do NOT commit with a failing smoke or audit — a green CI is not a substitute for a green `./scripts/nav-smoke.sh` because nav-smoke hits the real running stack, not a mocked one.
6. **If both pass:** commit. Pre-commit hook re-runs typecheck + unit tests; CI re-runs the full build + E2E (112 specs). Any red step restarts the loop.

**Stop-condition for the loop:** three consecutive green passes through steps 2–4 on an untouched tree. A single green pass can be luck; three consecutive passes means the change is actually stable.

Adding a new nav surface means editing `scripts/nav-smoke.sh` in the same PR — the list is intentionally hard-coded so a new surface can't hide from the smoke.

**Security zero-error loop before any release**
Run `docs/SECURITY.md §"Zero-error iteration loop"` end-to-end before tagging a release. Eight steps: typecheck, unit tests, auth-guard audit on every API route, unauth lockdown probe, full E2E, security spec specifically, MCP bearer fail-closed, audit-log spot-check. Every failed step re-starts the whole loop — auth regressions cascade. The audit one-liner to catch new routes that forget the guard:
```bash
find apps/web/app/api -name route.ts | while read f; do
  grep -qE "getCurrentUserId|requireAdmin|handlers|authErrorResponse" "$f" \
    || echo "$f" | grep -qE "(healthz|readyz|auth/\[)" \
    || echo "NEEDS AUTH REVIEW: $f"
done
```
Expected output: empty. Run before every PR merge that adds a new route.

**Auth mode matrix is explicit, never silent**
Three modes: OAuth (`AUTH_GITHUB_*` + `AUTH_SECRET`), dev shim (`ALLOW_DEV_AUTH=true`), unconfigured (neither — returns 503). Never silent fall-through between modes. The secure-by-default `auth_not_configured` response is load-bearing: a freshly-deployed VM that the operator hasn't configured must NOT serve anyone's data. See `apps/web/lib/brain/auth.ts::getCurrentUserId` for the three-branch dispatch.

**Voucher claims are transactional, never lazy**
`claimVoucher()` locks the `VoucherCode` row with `SELECT … FOR UPDATE` inside a transaction so two concurrent claims on the last seat of a multi-use code cannot both succeed. Never short-circuit this with a cached check → update flow; the race is real when an org-wide code has a low seat count.

**E2E patterns (2026-04-22)**
- `playwright.config.ts` lives at the app root (`apps/web/playwright.config.ts`), not nested under `e2e/`. Playwright resolves config from the runner's CWD; the nested path is never discovered.
- Run chromium-only and serial — the suite shares a live Postgres + MCP stack, and parallel workers corrupt fixtures. `workers: 1`, `fullyParallel: false`.
- Do NOT enable Playwright's `webServer` block. The caller is expected to have the stack running (`pnpm turbo run dev` or `./scripts/deploy.sh`). This keeps tests out of the build graph.
- **Dodge the onboarding modal globally** via `playwright.config.ts` `use.storageState` with `{ origin, localStorage: [{ name: "bp_onboarded", value: "true" }] }`. The `onboarding.spec.ts` overrides with `test.use({ storageState: undefined })` for its own cases. This is cheaper than each spec re-running `addInitScript`.
- **Register `page.waitForResponse(...)` BEFORE `page.goto(...)`** whenever a test depends on a hook's fetched state. The response can land before Playwright's listener attaches if registered after navigation — hooks then appear to be in "loading" or "mock" mode when the test body runs. Pattern: `const resp = page.waitForResponse(...).catch(() => null); await page.goto(...); await resp;`.
- **Skip-on-infra, not retry-on-infra.** When a test fails because rate-limit kicked in (hook fell back to BRAIN_DATA mock IDs that don't exist in DB) or seed was consumed by a prior test, call `test.skip(true, "<specific reason>")` rather than weakening the assertion. The `skipIfMockMode(page)` helper in `autoskill.spec.ts` is the canonical example — it reads the "API unreachable" banner text and bails. Skips are green-with-reason; fake retries hide the signal.
- **Serial suites consume seed.** Reject/apply tests mutate rows; after enough runs, the seed is exhausted. Every test that depends on a seed row must handle `count === 0` explicitly with `test.skip` — do not let the test cascade-fail and drag `describe.configure({ mode: "serial" })` siblings down with it.
- **Retry-until-hydrated for keyboard tests.** Global `keydown` listeners attach inside `useEffect`, which commits after the first paint. The first keypress in a fresh page can race hydration. Wrap the first press in `expect(async () => { await press; await expectURL; }).toPass({ timeout: 5_000 })`.
- Prefer `role=` + i18n-agnostic selectors where practical, but accept that some panels (e.g. Tweaks after a language switch) expose `aria-label` strings that change. Positional selectors (`.tweak-seg button.first()`) are acceptable when documented. Avoid regex selectors that match shell chrome (`/apply/i` matched the "Auto-apply HIGH" toggle — scope to `.panel button` for proposal-level buttons).
- Next 16 `proxy.ts` CANNOT declare a runtime — `export const config = { runtime: "nodejs" }` fails the build with "Route segment config is not allowed in Proxy file". Keep only the `matcher` key.
- **In-memory rate-limit saturates under burst E2E load.** 16 specs × ~5 API calls each in a 5-minute window can exceed `RATE_LIMIT_MCP_PER_MINUTE=200`. The proper fix is a shared Redis store (Wave 2 ships one; set `REDIS_URL` in the E2E deploy). The test-side fix is `skipIfMockMode()` — see above.

---

## 12b. Rebuilding from scratch (`REBUILD/`)

The `REBUILD/` folder at the repo root is the canonical resource for anyone
porting External Brain to a new machine using AI-assisted (vibe) coding.

```
REBUILD/
  00-START-HERE.md          — master index, rules, phase map
  01-foundation.md          — monorepo + @brain/types + @brain/db (full schema + seed)
  02-core-intelligence.md   — @brain/core (KRA · KEA · Oracle · decay · snippets)
  03-mcp-server.md          — apps/mcp-server (Bearer auth · 12 tools · 4 resources)
  04-worker.md              — apps/worker (pg-boss · 9 jobs · embeddings backfill)
  05-web-app.md             — apps/web (NextAuth · dashboard · Oracle · Skills · Admin)
  06-deploy-ci.md           — Docker Compose · Dockerfile · scripts · CI workflows
  07-env-catalog.md         — complete .env reference
  08-acceptance-criteria.md — 9-point definition of done + sign-off checklist
```

**Each file:**
- Opens with a copy-paste agent prompt block — hand it verbatim to the AI
- Contains complete specs for that phase (data models, algorithms, invariants)
- Closes with a runnable checkpoint the builder must pass before the next phase

**When to update `REBUILD/`:** any change to the schema, the MCP tool surface, the
auth model, the install-snippet shapes, or the deployment topology should be mirrored
in the relevant REBUILD phase file so the rebuild guide stays current with the
running system.

**Two mandatory unit tests that REBUILD/02 pins (never skip these):**
```typescript
// antigravity: serverUrl (not url)
// githubCopilotJetbrains: requestInit.headers (not headers)
```
Both are silent-failure traps — wrong key, zero error, no connection. See
`REBUILD/02-core-intelligence.md §2.16` and `docs/KNOWN_ISSUES.md §0h`.

---

## 12c. Agent-facing instruction templates (`skill-template.ts`, `agent.md`)

`BRAIN_SKILL_TEMPLATE` and `BRAIN_BOOTSTRAP_TEMPLATE` in
`apps/web/lib/brain/skill-template.ts` aren't documentation — they're
instructions an AI agent reads and then relays to a human, or acts on
directly. A bug in them doesn't surface as a broken page; it surfaces as a
correct-looking agent doing the wrong thing, or telling the user the wrong
thing, which is far quieter than a 404 and has no CI coverage
(`anon onboarding e2e` exercises the shell-installer path, not the
agent-conversation bootstrap path these templates drive — see
`KNOWN_ISSUES.md §0ai`).

- **Don't hardcode a value the template already has as a parameter one step
  earlier.** `BRAIN_BOOTSTRAP_TEMPLATE` asks the agent to declare its client
  (`claude-code` / `cursor` / `windsurf` / `antigravity` / …) in step 2, then
  hardcoded a Claude-Code-only verification command in step 4 — invisible if
  you only test the template from inside Claude Code, wrong for every other
  client. When a template branches on a value it already collected, use it;
  don't re-derive or assume it.
- **Order instructions by which side effects are irreversible, not by
  narrative convenience.** An instruction sequence that ends by telling the
  agent to relay "restart now" / "close this" / "end the session" must put
  that step *last* — anything told to the user after it is something they
  will never read, because the channel delivering it is gone. Write the
  steps in the order you'd explain them out loud, then re-check: does an
  earlier step destroy the channel the later steps depend on? If yes,
  reorder before shipping, not after a user reports losing the password-
  reset link because they restarted their editor on step 1 of 3.
- **Test these by literally being the agent.** Read the template's own
  instructions and follow them exactly, in order, as if you were the one
  restarting your tool the moment you're told to — not as a reviewer
  checking each step's content is individually correct. The two checks
  above catch different things; neither is visible from the other's
  vantage point.

---

## 13. References

- `docs/BLUEPRINT.md` — the product.
- `docs/APPROACH.md` — philosophy and decision framework.
- `docs/KNOWLEDGE.md` — ontology and lifecycle (normative).
- `docs/KNOWN_ISSUES.md` — what to watch out for.
- `docs/NAVIGATION.md` — frontend navigation surfaces and zero-error checklist.
- `REBUILD/00-START-HERE.md` — vibe-coding rebuild guide.
- `research/knowledge/README.md` — 7,900 lines of prior analysis.
- [`Architecture diagram`](./assets/illustrations/architecture.png) — visual: 3-layer system architecture for new contributors.
- [`AI Application diagram`](./assets/illustrations/ai_application.png) — visual: where LLMs and embeddings are used.
- [`Process Logic diagram`](./assets/illustrations/process_logic.png) — visual: end-to-end session lifecycle.
- [`Skill Development diagram`](./assets/illustrations/skill_development.png) — visual: how the platform develops and evaluates skills.
- [`Knowledge Algorithm diagram`](./assets/illustrations/knowledge_algorithm.png) — visual: algorithm governing knowledge lifecycle and refinement.
