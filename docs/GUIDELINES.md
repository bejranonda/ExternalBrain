# Development Guidelines

How we write code, structure changes, and ship safely in this repo.

> **Contributing a change?** Branch from `main`, open a PR — see [docs/CONTRIBUTING.md](./CONTRIBUTING.md). The PR conventions below apply.

---

## 1. Code style

- **TypeScript strict**, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Set in `tsconfig.base.json`; do not relax per-package.
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
3. Scope boundary — queries always filter by owner.
4. Embedding required — nightly backfill for stragglers.
5. Confidence/decay ranges — clamp, never trust caller.
6. Anti-principles need evidence.
7. Peer Card overrides KEA.
8. Autoskill requires user approval.
9. Audit log is append-only — no code path deletes AuditLog rows, not even GDPR erase.
10. No silent auth fall-through — `getCurrentUserId()` must 503 when no auth is configured.
11. Voucher claims are transactional (SELECT FOR UPDATE).
12. Retrieval scoring weights require a benchmark run before change.
13. Knowledge rows track actual usage — `usageCount`, `successCount`, `failureCount` must be bumped via the designated helpers, not direct SQL writes.

Additionally, the multi-tenant invariants from `KNOWLEDGE.md §12.17–§12.24` are authoritative — every Organization, Project, MCPToken, and Knowledge mutation must pass their guards.

Invariant violations are bugs, not features. Fix the violation; do not loosen the invariant.

---

## 4. Testing

| Scope | Location | Expected |
|---|---|---|
| Unit (core) | `packages/core/src/__tests__` | pure-function coverage for scoring, exporter helpers, parsers, effectiveness, uplift, email; 450 total across all packages as of MVP complete |
| Unit (web) | `apps/web/lib/brain/__tests__` (Phase 1) | hook state machines (`useOracle`, `useKnowledge`), parsers (`parseSSE`), proxy (`check()`) |
| Integration | `packages/core/__tests__/integration` | session-to-knowledge, outcome-feedback-loop, retrieveScored round-trip |
| Benchmark | `packages/core/__tests__/benchmarks` | retrieval NDCG@5, KEA quality |
| E2E | `apps/web/e2e` | 24 specs (161 tests) covering every surface + tokens + onboarding + tweaks + i18n + a11y + responsive + streaming — run with `pnpm --filter @brain/web e2e` (dev stack must be up). |
| E2E fixture | `packages/db/prisma/seed.ts` (#236) | Deterministic seed produces 1 admin user (Alex) + 1 org + 1 project + 6 sessions + 16 knowledge rows + 4 autoskill proposals. Idempotent via upsert; safe to re-run. Wired in `prisma.config.ts#migrations.seed` (Prisma 7 location — NOT `package.json#prisma.seed`, which silently no-op's in v7). Counts are load-bearing — `skills.spec.ts` asserts ≥16, `sessions.spec.ts` asserts ≥6, `autoskill.spec.ts` asserts 4. |
| Visual regression | `apps/web/e2e/visual.spec.ts` (#235, scaffold) | 24 baselines: 6 surfaces × 2 viewports × 2 themes. Inert by default; gated on `PWUPDATE=1` (regenerate) or `RUN_VISUAL=1` (diff) so it doesn't flake every dev's `pnpm e2e`. Baseline PNGs land once Phase 2 (`data-volatile` masking attrs) and the e2e CI Option B (in-stack runner) are ready. |

Run `pnpm turbo run test` before every commit. A red test blocks merge. If you add a pure helper (parser, scorer, renderer), add at least one test in the same PR.

**Playwright top-5 smoke (v0.14.0).** The opt-in `e2e-please` harness wraps the deployed-brain Playwright suite (`apps/web/tests/e2e/`) and covers the top-5 user surfaces: sign-in, dashboard, oracle, sessions, skills. These are the screens whose breakage is the most visible to a first-time visitor and the hardest to catch with typecheck alone. UI/UX, auth-flow, and public-surface PRs should add the `e2e-please` label so this suite runs as a status check; pure refactors / doc-only PRs may skip it. See `docs/DEV_PLAYBOOK.md §3a` and `APPROACH.md §5ah` for the rationale.

**Validation discipline: exercise the artifact, not just the tests (2026-05-11).** "CI is green" is a necessary precondition, not sufficient evidence that a change does what it claims. For any PR whose value depends on runtime behavior — installers, deploy scripts, observability changes, schema migrations, anything that touches the data plane — run the actual artifact against the actual system before claiming completion. PR #202 (MCP observability + installer v2) shipped a bug in its own installer that all tests passed: the unit test used `JSON.parse`, the installer used a sed-regex that didn't handle JSON-escaped quotes, and the failure mode was an orphan Session — the very thing the PR was meant to detect. The bug surfaced only when the installer ran end-to-end and the DB counters were re-read. **Rule:** if your PR description says "ships a fix for X," your test plan must include exercising the deployed artifact and observing X actually fixed in the conditions it claims to fix. The audit-friendly read-only diagnostic script at `.dev/brain-learning-evidence.sh` is the canonical example of a "did X actually fix?" probe.

**ESM module-wrapper testing rule (2026-05-14).** When a module function (`runCrossExtractDaily`) wraps another module function (`extractFromCrossSessions`) defined in the same file, `vi.spyOn(mod, "wrappedFn")` does NOT intercept calls made by the wrapper — Node's ESM module resolution binds the wrapper's call site to the local function reference at load time, not to the namespace export. **Rule:** if your test needs to mock a function called from inside the same module's wrapper, use dependency injection — accept the inner function as an optional parameter of the wrapper, default it to the real implementation, and let tests pass a stub. `vi.mock(module)` is the alternative but it fully replaces the module, making the wrapper itself impossible to test. PR #219's `runCrossExtractDaily({ extract? })` is the canonical example.

**Env-var passthrough rule (2026-05-12).** Setting a variable in `.env` proves only that the file contains the value. It says nothing about whether any specific container reads it. PR #206 spent significant time on a misdiagnosis because `KEA_MODEL` was correctly set in `.env` but the worker service's `environment:` block in `deploy/docker-compose.yml` didn't pass it through — the worker silently ran with the in-code default. **Rule:** any env var that gates runtime behavior must (a) appear under the relevant service's `environment:` block in `deploy/docker-compose.yml` with a `${VAR:-default}` form, (b) be verifiable from inside the container with `docker compose exec <service> printenv | grep <VAR>`, and (c) carry a one-line comment near its compose entry explaining what it controls — so the next operator who adds a new var or renames an old one doesn't have to trace the chain through code. Worker queues + LLM provider routing are the highest-stakes example.

**Major-version config-location rule (2026-05-17).** When a dependency bumps a major version, re-read its config-resolution rules — config locations move silently. PR #246 wired `prisma db seed` via `package.json#prisma.seed` (correct for Prisma 5/6) and shipped CI-green. The first deploy printed `⚠️ No seed command configured` and continued because Prisma 7 reads `seed` from `prisma.config.ts#migrations.seed`; the package.json location is deprecated and silently no-op'd. Hotfix in PR #250. **Rule:** when bumping a major version, grep the codebase for every file that names the dependency, then exercise each code path against a real runtime — not against unit tests, which never see the deprecated-location warning. Common silent-deprecation locations: `package.json` "extras" fields (eslint, prettier, jest, prisma), `tsconfig.json` `extends`, `.babelrc`, `next.config.*`. Prisma 7's additional gotcha: `new PrismaClient()` without an explicit driver adapter throws — any standalone script (seeds, one-off backfills) must construct `PrismaPg` first, matching the runtime singleton in `packages/db/src/index.ts`.

**Vocabulary discipline (2026-05-20).** One concept = one word, used consistently across nav, headings, captions, tooltips, error messages, and docs. The canonical glossary lives at `/docs/concepts/vocabulary` (also published in the webapp's docs index under "Start here"). The five user-facing words are **Brain · Skill · Session · Oracle · Proposal**; the advanced acronyms (**KEA / KRA / MCP / SQS**) appear only in tooltips and runbook prose. Anywhere a different word appears for the same concept — "knowledge" for skill, "Autoskill" for proposal, "Teach" without an object — that's drift to fix. The newcomer-eye walk now has three questions: (1) does this state actually move anything visible? (2) does any visible label leak an internal identifier? (3) is the same concept named the same way everywhere? — see `docs/APPROACH.md §5ag` for the rationale.

**Newcomer-eye walk-through rule (2026-05-19).** After every UX-affecting change, walk every routed surface — including the auth-flow surfaces (`/signin`, `/forgot-password`, `/reset-password`) and the empty-state variants of each authenticated screen — as a first-time visitor with no AI background. Ask of every chip, badge, breadcrumb, tooltip, model identifier, slug, short id, and queue name: **"what does this mean to someone who's never used this app before?"**  Fix anything you'd ask that question about. The 30-iteration sweep (PRs #254 / #255 / #256, 2026-05-17 → 2026-05-19) found ~30 issues in 3 passes; pass 3 caught the auth-flow surfaces that passes 1 and 2 never opened. **Rule:** declaring a UX pass "done" after one round leaves the entry surfaces broken for the visitor who matters most: the one who hasn't logged in yet. Internal identifiers leaking through (model id, slug, short id, env-var names in error copy, raw queue names) are the second-most-common newcomer-eye finding; the first is decorative state that updates client-side but doesn't move any visible thing. Validate each iteration with a string-presence probe (e.g. `curl /signin | grep -c "sonnet 4.6"` should return `0` after iter 6) — typecheck alone never asserts user-facing copy.

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
- **Audit your audit.** A security script that reports PASS must probe the actual attack surface, not a proxy for it. `scripts/verify-lockdown.sh` originally sent MCP requests without `Accept: application/json, text/event-stream` and got back 406 — reporting `fail-closed` when the server was actually rejecting at content negotiation, before auth could run. A real MCP client sends the Accept header and gets 200 + `serverInfo` on unauth'd `initialize`. Rule: if your security audit script reports PASS, open a browser / real client and try the thing manually at least once before you believe the green light. Every lockdown probe should exercise the shape a live attacker or real client uses.
- **Auth-mode divergence is always a misconfiguration, never a feature.** `ALLOW_DEV_AUTH=true` with OAuth envs set but empty-valued (`AUTH_GITHUB_ID=""`) silently activates dev-shim mode — the app serves the first User row to every anonymous caller. See `docs/KNOWLEDGE.md §12.14` for the full truth table and `docs/SECURITY.md §"declared-but-empty OAuth env trap"` for the diagnostic recipe. If you touch `apps/web/auth.ts`, consider adding a boot-time refusal for this combination rather than making the operator figure it out from the `/api/me` probe.
- **Credentials mode is the phase-1 pilot default.** One admin account, username + `ADMIN_PASSWORD_HASH` (bcryptjs, cost 12) in `.env`. `pnpm hash-admin-password '<plaintext>'` generates the hash; the script refuses passwords shorter than 12 chars. The runtime verifier (`apps/web/lib/brain/admin-credentials.ts`) is constant-time on username and runs bcrypt against a dummy hash on wrong-username attempts to avoid timing side-channels. GitHub OAuth coexists cleanly — both providers can be active at once (`CREDENTIALS+OAUTH` mode). If you need to add a second admin, provision a second `User` row with `role='admin'` via the admin UI after OAuth is enabled; credentials mode is intentionally one-operator-one-account.
- **Scope-filter queries at the repository level**, not the handler level. A handler that forgets to pass `ownerUserId` should still get an empty result.
- **Any new Knowledge/Session-style listing must apply the project filter.** Call `getActiveProject(userId)` to resolve the active project, then pass the result to `buildKnowledgeWhereV2` / `buildSessionWhere` / `buildProposalWhere` from `@brain/core/scope-filter`. `buildKnowledgeWhereV2` is the V2 helper that understands the three visibility states (`private`/`project`/`org`) and accepts `accessibleProjectIds` for org-level sharing — use it for any Knowledge filter added after Phase 4. A listing that omits the filter is a data-leak bug. For raw pgvector SQL paths (kra.ts, oracle.ts) use `buildRawProjectFilterV2` instead — it returns `{ sql, params }` for appending to the existing query. See `docs/KNOWLEDGE.md §12.19` and `§12.22` for the normative rules and `packages/core/src/scope-filter.ts` for the implementation.
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

**MCP surface-area principle — read + safe-write, not destructive (v0.14.0, PR #285).** The MCP tool surface is for operations a coding agent should be able to perform autonomously *during a session*: reading knowledge/skills/sessions, recording outcomes, creating projects, starting sessions, teaching new rules. Destructive operations — deleting a project, renaming an organisation, moving sessions between projects, inviting/removing teammates, rotating an admin password, revoking another user's token — stay in the webapp behind an explicit human click. The line is: **if undoing the operation requires looking at an audit log, it doesn't belong in MCP.** A new tool proposal that crosses this line needs an explicit decision in the PR description; the default answer is "build it in the webapp instead." This keeps the agent's blast radius bounded to operations whose mistakes are recoverable through ordinary use.

---

## 10. Frontend / design system

The webapp is a client-side SPA at `/` with six stateful surfaces. Design tokens, layout rules, and responsive breakpoints live in **`apps/web/app/globals.css`** and are sourced from the handoff bundle at `research/design/` (External Brain design via Claude Design).

Rules when touching frontend:

- **Design tokens are not Tailwind utilities.** Use CSS variables (`--accent`, `--ink`, `--bg-elev-*`, `--k-*`, `--font-mono`) defined in `globals.css`. Tailwind 4 remains available for hypothetical new code but the Brain surfaces do not use it.
- **State-based navigation, not route-based.** See `APPROACH.md §4.6` and `docs/NAVIGATION.md`. A new surface edits `routes.ts` + i18n + `components/brain/app.tsx` — never a sibling folder under `app/`.
- **Every Brain component is a client component.** They read `BRAIN_DATA` today; when wired to the API, prefer React Server Components for the data-fetching parent and keep interactive children as clients.
- **i18n first, English authoritative — three languages (EN/TH/DE).** Every user-visible string routes through `useT()` / `translate()`. Add keys to all three dictionaries in the same commit. EN is authoritative; TH and DE are full translations, not scaffolds. AI-generated translations are acceptable as a starting point for new keys but must be flagged in `docs/KNOWN_ISSUES.md` (under the i18n section) so a native speaker can sweep them later. Do not hard-code user strings. Use beginner-friendly terminology (e.g. "Rule of thumb" instead of "Heuristic", "Metadata" instead of "Frontmatter") to ensure accessibility for non-technical users. *(History: TH and DE were briefly deleted in v0.13 as a simplification, then restored in v0.14 after user feedback — the operator base actually spans those languages. The lesson is in `APPROACH.md §5al`.)*
- **Translation strings must never embed dynamic numbers, counts, or sample values.** Mock placeholder text like `"0 items retrieved · 2 cited"` is the bug pattern from PR #95 — the literal `2` shipped to all three languages and rendered even when the real count was 0. Counts go in either (a) format-string substitutions (`"{n} cited"` interpolated at render time) or (b) a separate trailing key wrapped in a conditional render (`{count > 0 && <> · {count} {t("oracle.citedInline")}</>}`). When you write a translation string, ask: "if a future reader sees this number in this dictionary entry, is there any way it stays correct as data changes?" If the answer is no, it doesn't belong in the dictionary.
- **Persisted UI state uses the `bp_*` localStorage prefix.** Current keys: `bp_tweaks`, `bp_route`. Prevents collisions with other apps on the same origin.
- **Zero-error nav.** Any change that touches the shell, keyboard handler, or palette must pass the checklist in `docs/NAVIGATION.md §3` before merge.
- **Font loading via `next/font`**, not `<link>`. See `apps/web/app/layout.tsx` — adding a font family means adding the loader and the CSS variable.
- **Pre-hydrate theme script.** The inline `<script>` in `app/layout.tsx` reads `bp_tweaks` and applies theme/accent/density/lang before React mounts. Do not remove it; removing it causes a visible flash of default theme.
- **Server-component env vars need `force-dynamic`.** `deploy/Dockerfile` builds with dummy env vars (see "Dummy env so env validation at top-level doesn't crash the build" in the builder stage). Any `app/**/page.tsx`, `app/**/layout.tsx`, or `app/**/route.ts` that reads `process.env.X` at module/server-component scope **must** add `export const dynamic = "force-dynamic"` — otherwise Next.js statically pre-renders the page during the Docker build with empty values and the deployed container's real `process.env` is never re-read. `NEXT_PUBLIC_*` vars are exempt (they're inlined at build time on purpose). This is the #293 lesson — v0.14.0 shipped `/welcome` with a server-injected `BRAIN_MCP_PUBLIC_HOSTNAME` that produced an empty URL in prod for exactly this reason; v0.14.2 fixed it by adding `force-dynamic`. When you write a new page that reads deploy env, add the directive at the top before you forget. The class-of-bug audit lives at [`docs/GUIDELINES.md §10`](./GUIDELINES.md#10-frontend--design-system).
- **Public URLs come from `req.headers['x-forwarded-host']`, not `req.url`.** Inside the Docker container, `req.url` resolves to the internal upstream (e.g. `http://0.0.0.0:3000`), not the public hostname. Constructions like `new URL("/foo", req.url)` will emit `https://0.0.0.0:3000/foo` in Location headers — wrong for any client behind nginx/Caddy. Either (a) use a path-only Location header (RFC 7231 §7.1.2 permits relative refs, browsers resolve against the request URL), or (b) read `x-forwarded-host` + `x-forwarded-proto` from `headers()` if you genuinely need the absolute form. The PR #303 → #307 favicon redirect is the worked example.
- **Mount-gate every client-only global reachable from render (`#418` class).** Reading `window` / `navigator` / `localStorage` / `Date.now()` / `Math.random()` *during render* (incl. `useMemo` and `useState(initFn)`) makes the server's HTML differ from the client's first render → React `#418`. The rule: initialize state to an SSR-safe default and read the real value in `useEffect` after mount (the pattern `useRoute` / `useProjectScope` / `useTweaks` use). Repeat offenders found: `ShowEverythingFold` localStorage (#fixed 06-05), `useEnvLabel` hostname + `/welcome` snippet `window.location` (#fixed 06-07). Before merging shell/dashboard/first-run changes, run `grep -n "typeof window\|typeof navigator"` over the touched files and confirm each hit is inside an effect or handler, not a render path. A component that only ever mounts *after* a client interaction (e.g. a modal opened on click) is exempt — it never hydrates.
- **Relative time goes through `@brain/core/format-relative` — never hand-roll.** v0.15.0 consolidated four divergent local formatters (oracle/graph/connection-status each rendered "2 days ago" differently) onto the canonical `formatRelative(iso)` → `just now / Nm / Nh / Nd / Mmm D`. Import via the subpath `@brain/core/format-relative` (it's split out specifically so it doesn't pull `@sentry/node` into the browser bundle). Keep the hydration-safe wrapper pattern (`<RelativeTime>` / `<RelativeText>` render the absolute date on SSR + first paint, swap to relative in `useEffect`) — `formatRelative` reads `Date.now()`, so rendering it directly causes hydration mismatches (audit FE5, #103).
- **User-facing copy is plain English; internal metric names stay in code/docs/DB (Phase R.5).** Surfaces show "Quality" / "Answer relevance" / "Brain"; the code/schema/docs keep `SQS` / `NDCG@5` / `KEA`. The normative mapping lives in `docs/KNOWLEDGE.md`. When adding a new metric, give it a plain-English label and keep the precise name in a `title=` tooltip, not the visible text.

---

## 10a. Design principles (when to show what)

The webapp is a dense knowledge tool, not a marketing surface. These principles govern *what appears on screen and when* — code-style rules are in §1, design tokens in §10. Full rationale + examples live in [`docs/DESIGN_PRINCIPLES.md`](./DESIGN_PRINCIPLES.md); this section is the terse normative version.

- **Progressive disclosure.** Default to the smallest useful surface. Power lives one click, one hover, or one expand away — never on the default canvas. The session-card → per-session value drill-down (#263) plus its dashboard wiring + project-level companion (#266) are the reference pattern: the row stays terse; the depth is opt-in.
- **Earned surface area.** A panel, tab, or card only ships once the data to populate it exists. Empty dashboards train users to ignore the UI. If a feature has no data on day one, gate it behind a real precondition (`hasSessions`, `hasKnowledge`, `hasProject`) and show nothing until the precondition is met — not a placeholder. `ProjectsList` (#266) is the canonical implementation: returns `null` at 0 projects, one compact row at 1, full list at ≥2.
- **Quiet by default, loud on demand.** Background work (KEA, cross-extract, decay) is continuous. The UI whispers it through small status surfaces (last-extracted timestamp, count badges) and only escalates to a banner or modal when the user must act. No toast for routine success. The "Right now" section was demoted below user-facing surfaces in #266 for this reason.
- **One principle per disagreement.** When two contributors disagree on a UI call, the resolution is "which of the three above does this serve?" — not taste. If none of them apply, the change is probably scope creep.

Casual shorthand for these three together: **"deceptively simple"** — the surface looks light, the depth is real.

**v0.14.0 validated these at scale.** The dashboard + every destination page (Skills, Sessions, Oracle, Graph, Autoskill, Settings) were re-walked under the three principles in a single coordinated sweep. Empty states were re-gated (panels return `null` until they have data, never placeholder copy); detail panes consolidated under the per-session / per-project drill-down pattern from #263/#266; the "Right now" system-chatter band sits below user-facing content on every surface that has both. The principles are no longer aspirational — they are what the production surfaces look like, and any new surface should match. See `APPROACH.md §5aj` for the subagent-driven dispatch pattern used to land the sweep.

---

## 11. Adding a new knowledge type

Do not. The 5-category ontology is deliberate and research-backed. If a new category is truly needed:

1. Propose in a PR that amends `docs/KNOWLEDGE.md §2` and `research/knowledge/08-knowledge-ontology.md`.
2. Discuss with reviewers before writing code.
3. Migration: backfill existing knowledge; update KEA prompt; update KRA formula; update formatter.

A new type is a cross-cutting change — expect 15+ files touched.

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

**Rate limiting (`apps/web/proxy.ts`)**
Next 16 renamed `middleware.ts` → `proxy.ts`. One `proxy` runs for every `/api/*` request and enforces sliding windows keyed by client IP. Adding a new endpoint class: (a) add a `classify()` branch with a distinct name; (b) either reuse an existing `RATE_LIMIT_*` env or add one to `.env.example`; (c) verify the `x-ratelimit-*` headers in a local curl before merging. Store selection is automatic: Redis when `REDIS_URL` is set, in-memory otherwise — both implement the async `Store` interface in `packages/core/src/rate-limit.ts`. Keep `check()` signature stable across stores.

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

## 13. References

- `docs/BLUEPRINT.md` — the product.
- `docs/APPROACH.md` — philosophy and decision framework.
- `docs/KNOWLEDGE.md` — ontology and lifecycle (normative).
- `docs/KNOWN_ISSUES.md` — what to watch out for.
- `docs/NAVIGATION.md` — frontend navigation surfaces and zero-error checklist.
- `research/knowledge/README.md` — 7,900 lines of prior analysis.
- [`Architecture diagram`](./assets/illustrations/architecture.png) — visual: 3-layer system architecture for new contributors.
- [`AI Application diagram`](./assets/illustrations/ai_application.png) — visual: where LLMs and embeddings are used.
- [`Process Logic diagram`](./assets/illustrations/process_logic.png) — visual: end-to-end session lifecycle.
- [`Skill Development diagram`](./assets/illustrations/skill_development.png) — visual: how the platform develops and evaluates skills.
- [`Knowledge Algorithm diagram`](./assets/illustrations/knowledge_algorithm.png) — visual: algorithm governing knowledge lifecycle and refinement.
