# Known Issues, Risks, and Limitations

A deliberately honest catalog. These are failure modes the system is either currently exposed to, or structurally vulnerable to. Cross-referenced to the research body where relevant.

## How to file a new issue

- **Found a bug?** Open a GitHub issue with reproducer steps, branch
  `bugfix/<slug>` off `main`, and open a PR.
- **Want a new capability?** Open a GitHub issue, branch `feature/<slug>` off
  `main`, and open a PR. Don't catalog it here — that's what GitHub issues are for.

This file tracks risks and structural limitations the system is *known to live
with*. Fresh bugs go into GitHub issues, not here, until they graduate into a
deferred risk.

---

## 0a. Self-hosting hazards (fresh-host bring-up)

Traps seen bringing the stack up on a fresh VM, captured so you avoid them:

- **Docker Compose v1 silently installed on some Hetzner Ubuntu images.**
  `scripts/deploy.sh` now fails preflight with an install hint instead of
  exploding at `$COMPOSE build`. Fix: install the `docker-compose-plugin`
  package (Compose v2) before running deploy.
- **Cloudflare DNS propagation lag.** Caddy's HTTP-01 challenge fails until
  the new A record propagates to Let's Encrypt's resolvers. If `caddy` logs
  show `no IP addresses found` for ~10 minutes after the DNS change, that's
  propagation, not a code bug. Wait, then `docker compose restart caddy`.
- **Old backup snapshots are not portable across hosts.** Knowledge
  rows have embeddings tied to the host's pgvector index; restoring an old
  dump on the new host requires `REINDEX INDEX` on the pgvector indexes if
  the index versions disagree. Greenfield deploy + re-import via the seed
  + per-token re-issue path is simpler than a `pg_restore`.
- **Newcomer-eye walk-through catches issues code review can't.** The
  40-iteration UX sweep (2026-05-17 → 2026-05-20, PRs #254 / #255 /
  #256 / #257) uncovered ~40 user-facing issues across all 5 routed
  surfaces + the auth flow that the team had been blind to. **Three
  finding classes** emerged across the four passes: (1) **decorative
  state** — chips that updated client-side state but moved nothing
  visible; (2) **leaked internal identifiers** in user-visible labels
  ("sonnet 4.6 · medium", "personal-x7tdwb000001" slugs, env-var
  names in error copy, raw queue names); (3) **vocabulary drift** —
  the same concept named differently across surfaces ("knowledge" vs
  "Skills", "Autoskill" vs "Skill proposals", opaque "Teach" verb).
  Discipline: after every UX change, walk every surface as a
  first-time visitor with no background and ask of every label three
  questions — did my click move anything visible? does this leak an
  internal id? is this the same word used elsewhere for the same
  thing? Four passes (entry surfaces, redundancy, polish, cohesion)
  caught successively-finer issues — single-round reviews leave the
  entry-surface issues invisible. The locked glossary at
  `/docs/concepts/vocabulary` (in `apps/web/lib/brain/docs-content.ts`)
  is the regression net for class (3). See `docs/APPROACH.md §5af`
  (classes 1+2) and `§5ag` (class 3) for the full rationale.
- **Prisma 7 moved `seed` config out of `package.json`.** Surfaced 2026-05-17
  via PR #246 → hotfix PR #250. In Prisma ≤ 6 the seed wires through a
  `package.json` `"prisma": { "seed": "..." }` block; Prisma 7 deprecated
  that location and reads `seed` from `prisma.config.ts` under
  `migrations: { seed: "..." }`. The deprecated location is a **silent
  no-op** — `prisma db seed` prints `⚠️ No seed command configured` and
  exits 0. **Also**: `new PrismaClient()` without an adapter throws in v7;
  any seed script must construct `PrismaPg` first (see
  `packages/db/prisma/seed.ts` for the canonical pattern). Validation
  discipline: re-read the deploy log for `[deploy] Seeding dev DB...`
  followed by the seed's own `[seed] done — ...` line before claiming the
  seed wired up. Counting `seed_%` rows in the DB is the definitive check.

---

## 0b. v0.14.0 cascade (2026-05-26)

Three low-severity items surfaced by the v0.14.0 release (MCP project-management
tools + i18n restore). None block pilot; all are documented here so the next
operator who hits the symptom finds the explanation without re-investigating.

| Issue | Where | Fix by |
|---|---|---|
| **AI-translated TH / DE strings unreviewed by native speakers.** `oracle.empty_hint` and `app.ingest_ok_zero` in `apps/web/lib/brain/i18n.ts` are AI-generated translations from PR #286 (i18n restore after the brief EN-only cycle). They read naturally but a native-speaker proofread would be welcome before real users hit them in production. Same class of risk as the broader "Thai + German i18n scaffolded but not reviewed by a native speaker" entry in §1; this row tracks the specific new keys. (Severity: low. Workaround: open a PR with a corrected translation if you spot something awkward.) | `apps/web/lib/brain/i18n.ts` | opportunistic |
| **MCP client tool catalog is cached per session.** Claude Code / Cursor / Windsurf call `tools/list` at session start and cache the response for the lifetime of the MCP connection. After a server-side tool-catalog change (e.g. PR #284 adding `brain_create_project`, PR #285 adding `brain_list_projects` + `brain_get_active_project`), existing clients keep the old 9-tool list until they reconnect. The new tools simply aren't visible — calling them fails client-side before reaching the server. (Severity: low, transient. Workaround: restart Claude Code / reconnect the MCP server to refresh the catalog.) | `apps/mcp-server/src/index.ts` (server side is correct; symptom lives in clients) | client-side; no fix needed |
| **MCP session dies silently; client doesn't auto-reconnect ("Server not initialized" cascade).** MCP sessions are an in-memory `Map<sessionId, Session>` on the server (`apps/mcp-server/src/index.ts:163`). Three failure modes wipe a session without the client knowing: (a) **server restart** — every `./scripts/deploy.sh` / `./scripts/reload.sh` clears the map; (b) **orphan sweep** — sessions idle >30 min with zero tool calls are evicted every 5 min (intentional, catches probe leakage that hit 184 opens / 0 closes over 7 days in prod); (c) **network drop / transport close** — `transport.onclose` fires server-side and the session is deleted. In all three cases the client keeps its dead `sessionId`; subsequent tool calls return `Server not initialized` and the client SDK does **not** auto-reconnect. Symptom: every brain call fails until the editor is restarted. Diagnosed live 2026-05-26 when an in-flight Claude Code session reported "the brain MCP connection is genuinely down" while the server-side probes (`/api/healthz`, `/api/readyz`, `POST /mcp` with bearer) all responded correctly. (Severity: medium — annoying but transient; data is safe because the file-memory side keeps writing. Workaround: quit and restart Claude Code, or `/mcp` → reconnect. The MCP server's `instructions` field surfaces this guidance to capable clients on every reconnect. Root cause is a Claude Code limitation; upstream fix would be an SDK-level auto-reconnect on transport error.) | `apps/mcp-server/src/index.ts` (server side is correct; failure surface is client) | upstream Claude Code SDK; awareness fix shipped via `instructions` |
| **Project-scoped tokens can't create projects (by design; documented).** `brain_create_project` returns `FORBIDDEN_PROJECT` for tokens with `MCPToken.projectId IS NOT NULL`, and `brain_start_session` silently ignores the `projectName` parameter for the same tokens. This is the §12.21 token-scope invariant doing its job — a project-scoped token must not widen its own scope. Documented here because the error surface (`FORBIDDEN_PROJECT` from a tool the user thought they could call) reads as a bug until you know about the invariant. (Severity: low; intended behavior. Workaround: mint a user-scoped token at `/settings/tokens` and swap it into the MCP client config.) | `apps/mcp-server/src/tools/create-project.ts`, `apps/mcp-server/src/tools/start-session.ts` | intentional; documented |

---

## 0c. v0.14.0 → v0.14.3 first-time-user review pass (2026-05-27)

A four-iteration first-time-user review pass on the freshly deployed v0.14.0
surfaced **three user-visible bugs**, **two class-of-bug detection gaps**, and
**five structural backlog items**. v0.14.1 / v0.14.2 / v0.14.3 shipped the
bug fixes; the gaps + backlog stay open as the entries below. Cross-reference
with the closed issues for the worked examples.

### Class-of-bug findings (open meta-issues)

| Issue | Where | Status |
|---|---|---|
| **Next.js static rendering bakes empty env into prod artifacts.** `deploy/Dockerfile` builds with dummy env vars ("Dummy env so env validation at top-level doesn't crash the build"). Any `app/**/page.tsx` that reads `process.env.X` at module/server-component scope without `export const dynamic = "force-dynamic"` gets the empty value frozen into the static HTML. The deployed container's `process.env` is never re-consulted. v0.14.0 shipped this exact bug on `/welcome` (#293) — the round-1 fix (#297) added server-side resolution, the deploy succeeded, the bug was unchanged; round-2 (#299) added `force-dynamic` and the URLs finally rendered correctly. The audit task is open at [#7](https://github.com/bejranonda/ExternalBrain/issues/7) — grep `process.env\.` in `app/**/page.tsx` and decide per-page. **Discipline going forward: any server component reading deploy-time env vars must opt out of static rendering, OR the Dockerfile must pass real env at build time.** | `apps/web/app/**/page.tsx`, `deploy/Dockerfile` | open ([#7](https://github.com/bejranonda/ExternalBrain/issues/7)) |
| **e2e CI gate gives false confidence for onboarding-surface PRs.** The deployed-brain e2e job ran on PR #289 (v0.14.0) and missed three user-visible bugs on the freshly-added `/welcome` page (#293, #294, #296). Reasons: (a) no unauthenticated path coverage (the suite asserts signed-in behavior only); (b) no URL-vs-env assertion (install snippets are environment-specific, and a localhost-style URL slips past tests that hit a brain where `:3100` is real); (c) `e2e-please` label gates the run, the release PR didn't carry it. The fix sketch is open at [#6](https://github.com/bejranonda/ExternalBrain/issues/6): add an `onboarding-surface` paths-filter label that auto-applies + makes e2e mandatory + adds anon-walkthrough tests + asserts rendered URLs match `BRAIN_*_PUBLIC_HOSTNAME`. The `apps/web/e2e/welcome-public-urls.spec.ts` regression test shipped in v0.14.3 is the first installment of the anon-walkthrough net. | `.github/workflows/`, `apps/web/e2e/` | open ([#6](https://github.com/bejranonda/ExternalBrain/issues/6)) |

### Structural backlog (open enhancement issues)

| Issue | Where | Status |
|---|---|---|
| **`/signin` onboarding gap** — credentials-only prod offers no self-service signup path. v0.14.3 added a minimum-viable "Brain is invite-only — ask the operator for an invite link" footer (#303), but the structural decision (self-service voucher request flow vs OAuth-on-prod vs operator-email link) is unresolved. | `apps/web/app/signin/page.tsx`, `apps/web/auth.ts` | MVP shipped; structural followup open via #295 history |
| **Language picker only renders behind sign-in.** v0.14.0 restored TH + DE (#286) but the picker is gated by `LangContext`-wrapped shell. Users whose browser is Thai/German land on `/signin` and `/welcome` with EN copy and no recourse. | `apps/web/lib/brain/i18n.ts`, `apps/web/app/layout.tsx` | open ([#11](https://github.com/bejranonda/ExternalBrain/issues/11)) |
| **`/welcome` "60 seconds" promise has no stuck-state diagnostic.** The page polls `/api/dashboard` every 4 s indefinitely with no escalation. If the user's install fails, they stare at a pulsing dot forever. Need a 90-second amber escalation + 5-minute troubleshooting block. | `apps/web/components/brain/welcome-flow.tsx` | open ([#10](https://github.com/bejranonda/ExternalBrain/issues/10)) |
| **`/robots.txt` and `/sitemap.xml` return the generic HTML 404.** Polite crawlers expect at minimum a `text/plain` robots.txt. For an invite-only Brain the right default is `Disallow: /`; operators with a public landing can flip an env var. | `apps/web/app/robots.ts` (missing), `apps/web/app/sitemap.ts` (missing) | open ([#8](https://github.com/bejranonda/ExternalBrain/issues/8)) |
| **`mcp.brain.example.com/` bare root returns 9-byte nginx 404.** A developer typing the MCP hostname in a browser to verify their token gets no signal that this is a Brain Platform MCP endpoint, no link to `/health`, no instructions. | `apps/mcp-server/src/index.ts` | open ([#9](https://github.com/bejranonda/ExternalBrain/issues/9)) |
| **Icon-rail sidebar (Phase R) — pro UX, not beginner UX.** Phase R framed itself as "beginner-first redesign" but hover-to-reveal labels are an expert UX pattern (Linear/Notion/Stripe ship labels-by-default). Product discussion, not a bug. | `apps/web/components/brain/shell.tsx` | open ([#12](https://github.com/bejranonda/ExternalBrain/issues/12)) |
| **Dashboard logs a React hydration mismatch (`#418`) on every authenticated shell load.** Non-fatal — React recovers with a client re-render and the page is correct — but it's a console error on the primary surface. Ruled out: the theme/density pre-hydrate script (already `suppressHydrationWarning` on `<html>`) and client-fetched relative timestamps (absent from the SSR HTML). Most likely an SSR-empty-state vs client-initial-state divergence from `localStorage`-derived state (the dashboard scope toggle / `bp_tweaks`). Pinning the exact node needs the non-minified dev build. | `apps/web/components/brain/dashboard.tsx`, `home-hero.tsx` | open ([#16](https://github.com/bejranonda/ExternalBrain/issues/16)) |

### Worked example: why static-rendering bites a server-injected env var

The v0.14.0 → v0.14.2 sequence is the canonical retro:

1. **v0.14.0 (#283)** shipped `/welcome` with `resolveMcpUrl()` constructing the
   MCP URL client-side as `${window.location.hostname}:3100/mcp`. Works on
   localhost (port 3100 is real). Broken on any host where MCP is on a
   different subdomain — the canonical prod topology.
2. **v0.14.1 (#297)** added server-side resolution: `app/welcome/page.tsx`
   reads `BRAIN_MCP_PUBLIC_HOSTNAME` from `process.env` and passes the
   resolved URL as a prop to `WelcomeFlow`. CI green. Deploy succeeded.
   **Bug was unchanged.**
3. **v0.14.2 (#299)** added `export const dynamic = "force-dynamic"`. Bug
   fixed. Root cause: Next.js statically pre-rendered `/welcome` during
   `pnpm --filter @brain/web build` inside Docker, where the env was the
   dummy build-time value (empty). At request time, the rendered HTML was
   already frozen; the deployed container's `process.env` was never read.

**The lesson is in the discipline, not the fix.** Any future page that reads
deploy-time env vars will hit the same trap unless either the page opts out
of static rendering or the Dockerfile passes real env at build time. See
`docs/GUIDELINES.md §Server-component env vars` for the codified rule.

---

## 0d. v0.15.0 cascade (2026-06-01)

**Secret-hygiene close-out + publish-fresh decision — DONE (2026-06-01).** A
pre-existing risk — backup env files (`.env.local.bak2`/`.bak3`) committed in
`ff8bcec` with real secret values, removed from the tree in `387dca1` but still
present in *history* — was resolved for the public release by **publishing a
fresh repo with no history** rather than rewriting history (`git filter-repo` +
force-push to protected branches is riskier and can never be proven complete
against existing clones). The fresh repo is now live at
[`github.com/bejranonda/ExternalBrain`](https://github.com/bejranonda/ExternalBrain)
(`v1.0`), built from a `git archive HEAD` export (tracked files only — no
`.env`, no `*.bak`, no history). Proof captured before publish:
- working-tree scan flagged only `.env` (gitignored, never tracked) + two
  documented placeholders (`admin:pw` in a doc snippet, `bp_not_a_real_token…`
  in `verify-lockdown.sh`); the 464 *tracked* files carried no real secret;
- full-history scan of `BrainPlatform` confirmed the 4 real keys live **only**
  in the `.env.local.bak2`/`.bak3` blobs (the reason for going history-free);
- the exact publish payload re-scanned clean (`0` leaks with `.gitleaks.toml`),
  and every published file is byte-identical to the `BrainPlatform` tracked tree.

`.gitignore` is hardened with `.env.local.bak*` / `.env.*.bak*` (any suffix) so
the class can't recur, and a `gitleaks` scan (config: `.gitleaks.toml`) is part
of the pre-publish check (AGENTS.md hard rule #3). **Still required:** rotate the
leaked keys at their providers — a fresh repo does not invalidate a key anyone
already pulled. The **old private `BrainPlatform` repo must stay private** — its
history retains the values.

**Phase R.5 relabel — internal vs user-facing term divergence.** User-facing
copy now shows plain English ("Quality", "Answer relevance", "Brain") while the
code, docs, and DB keep the precise internal names (`SQS`, `NDCG@5`, `KEA`). The
mapping is recorded in `docs/KNOWLEDGE.md` and `docs/GUIDELINES.md`; the watch
item is support/debugging confusion when a user reports "Quality is low" and an
operator must map it back to `SQS`. Low severity, documented on purpose.

**Evidence gaps are tracked as roadmap, not bugs.** `docs/EVIDENCE.md` documents
the demonstrated multi-session + multi-project compounding and the roadmap to
surface multi-machine (per-machine telemetry) and inter-org (a two-org pilot) as
recorded metrics. These are capability-extension items, not defects.

---

## 0. MVP-complete open items (2026-04-29, operator action required)

These are not blocking pilot but must be resolved before a second contributor joins or the platform is advertised publicly.

| Issue | Where | Fix by |
|---|---|---|
| **Secrets in git history (`ff8bcec`, `387dca1`) — NEUTRALIZED for the public release (2026-06-01); key rotation still pending.** The public release was published as a fresh, history-free repo (`ExternalBrain` v1.0) carrying **none** of these commits (see §0d), so the public-repo trigger is satisfied without a history rewrite. The dirty history remains only in the **private** `BrainPlatform` repo, which must stay private. **The actual API keys must still be rotated at the providers** — that is the only thing that truly neutralizes the leak. _Original entry for archive:_ Commits `ff8bcec` (Apr 27, "feat(orgs): Phase 2b") and `387dca1` ("fix(security): remove accidentally-committed .env backups") contain three real secret values in `.env`: `ANTHROPIC_API_KEY`, `GOOGLE_GEMINI_API_KEY`, and an `ADMIN_PASSWORD_HASH` (since rotated). The bad commits are present on **both `origin/main` and `origin/develop`**, contrary to the prior note that scoped them to develop only. **Decision (2026-05-05): defer the history rewrite.** Repo is private on GitHub Free; blast radius is bounded to the access list, GitHub itself, and any local clone caches. Cleaning requires `git filter-repo --replace-text` followed by `git push --force-with-lease origin main develop`, which breaks every existing clone (this prod box, dev VPS, operator laptops) and orphans any open feature branches. **Trigger to revisit:** before the repo is made public, before adding any contributor outside the current trust circle, or after the next planned downtime window when uncoordinated clone-resets are tolerable. The actual API keys must be rotated at the providers (Z.ai/Anthropic console + Google Cloud console) for the leak to be neutralized regardless — git rewrite alone does not invalidate keys already pulled by anyone with prior access. | `origin/main`, `origin/develop`, all clones | before public repo / new contributor |
| **Branch protection now UNBLOCKED — `ExternalBrain` is public (2026-06-01).** Branch protection / rulesets are free on public repos, so the plan-tier blocker below no longer applies to `ExternalBrain`; enable PR-required + status-check-required on `main` and `develop` in its GitHub settings. _Original entry (applied to the private `BrainPlatform` repo):_ The repo is private on GitHub Free. Both classic branch protection (`POST /repos/.../branches/main/protection`) and the newer rulesets API (`POST /repos/.../rulesets`) return `403 Upgrade to GitHub Pro or make this repository public to enable this feature` (verified 2026-05-04 via `gh api`). Two paths to unblock: (a) upgrade `bejranonda` to GitHub Pro (~$4/mo), then enable PR-required + status-check-required on `main`; (b) make the repo public, which gates branch protection on Free. Until then, the discipline lives in operator habit + agent guardrails (see `~/.claude/projects/-root-BrainPlatform/memory/feedback_operator_style.md`). High-urgency before a second contributor joins. Steps once unblocked: `docs/RUNBOOK.md §"Enabling branch protection on main"`. | GitHub repo settings + plan tier | before 2nd contributor |
| **Cross-org knowledge bundles deferred (Phase 5).** A team-owned Brain cannot currently share a curated knowledge bundle with a separate org. The visibility system (private/project/org) operates within one org; cross-org sharing requires a bundle-import/export mechanism not yet designed. Not blocking for single-org pilots. | `packages/core/src/scope-filter.ts`, Phase 5 planning | Phase 5 |
| **pg-boss 10→12 upgrade has no auto v24→v25 path** (#71). PR #63 jumped from pg-boss 10 to 12 directly, but `pg-boss@12.18.2/dist/migrationStore.js` only ships migrations starting at v25→v26. A DB last touched by pg-boss 10 sits at `pgboss.version = 24`; v12's `boss.start()` fails fatal with `relation "pgboss.job_common" does not exist` and the worker crashloops. Recovery on dev: `DROP SCHEMA pgboss CASCADE` then redeploy (loses pending jobs). Recovery on prod: install pg-boss 11.x as a transient bridge, run migration to v26, then upgrade to v12 (preserves jobs). **Operator must check `SELECT version FROM pgboss.version;` on prod before deploying main.** | `apps/worker/src/index.ts`, `scripts/deploy-prod.sh` | before next prod deploy |
| **Bootstrap container image cache hazard on migration renames** (related to #37). When a Prisma migration directory is renamed (e.g. PR #36's `20260425_org_invites` → `20260427130000_org_invites`), `docker compose build` may serve a cached layer of the bootstrap image that still has the old name. The on-disk repo is correct but the image is stale, so `prisma migrate deploy` tries to apply a migration that the **schema has already partially started**, leaves a failed-state row, and blocks future deploys. Workaround: run `docker compose --profile bootstrap build --no-cache bootstrap` after any migration rename. Permanent fix: add a `cache_from`-aware step in `scripts/deploy.sh` that hashes `packages/db/prisma/migrations/` and forces no-cache on hash change. | `scripts/deploy.sh` | issue #37 follow-up |

---

## 1. Scaffolding-level issues (v0.1+)

The scaffolding has been substantially wired in the GUI↔backend pass (2026-04-21). Known remaining gaps:

| Issue | Location | Fix before |
|---|---|---|
| ~~**Dev-auth shim only.**~~ Replaced 2026-04-21 with a dual-mode auth: NextAuth v5 (GitHub OAuth, JWT strategy) when `AUTH_GITHUB_ID`+`AUTH_GITHUB_SECRET`+`AUTH_SECRET` are all set, dev shim otherwise. `getCurrentUserId()` reads the JWT first and fails closed (`401 not_signed_in`) when auth is configured but the session is absent — no silent fall-through. | — | done |
| **pg-boss enqueue is hand-rolled SQL.** Should go through the pg-boss client for retries and dead-lettering. | `apps/mcp-server/src/tools/report.ts` | Phase 1 |
| ~~**HTTP transport for MCP server not wired.**~~ Streamable HTTP transport (stateless, per-request Server/Transport pair; Bearer auth via `AsyncLocalStorage`) landed 2026-04-21. Select with `MCP_TRANSPORT=http`. | `apps/mcp-server/src/index.ts` | done |
| **No unit/integration tests yet.** Intelligence layer is untested. | `packages/core/__tests__/` (missing) | Phase 1 |
| **Autoskill router is regex + tag-match.** Adopts nicknisi/autoskill scoring (5/3/2/1 + cross-session bump) and conflict resolution, but `routeSignal()` still uses keyword heuristics for project-convention vs session-behavior detection. Graduate to an LLM classifier with few-shot examples once we have proposal-acceptance telemetry. | `packages/core/src/autoskill.ts::routeSignal` | Phase 4 |
| ~~**Rules-export materialization is deferred.**~~ `packages/core/src/exporter.ts` now builds a rules bundle from `rules-export`-tagged Knowledge rows, grouped by `target:*` tag, rendered per-format (Claude / Cursor / Windsurf / AGENTS.md / markdown). Exposed at `GET /api/export/rules` and wired into Skills as "Download rules bundle". | — | done |
| ~~**Session search uses `ILIKE`**~~ — replaced with Postgres FTS (`to_tsvector` + `websearch_to_tsquery` + `ts_rank_cd`) in a CTE; ILIKE stays as a fallback path so pre-migration DBs still work. GIN expression indexes in `packages/db/sql/session-fts-index.sql`. | `apps/mcp-server/src/tools/session-search.ts` | done |
| ~~**Oracle streaming not implemented.**~~ `askStream()` generator + `/api/oracle/stream` SSE endpoint (Anthropic `messages.stream()` + OpenAI `stream: true` branches). Frontend consumes via a streaming reader with delta/final events. | — | done |
| ~~**Knowledge immutability not enforced.**~~ `PATCH /api/knowledge/[id]` now rejects edits to `ruleText` / `triggerText` / `rationale` with `409 immutable_field`. Skills UI fork-on-edit: saving a modified body creates a new version with `parentKnowledgeId` pointing back. | — | done |
| **GraphEdge relation on Knowledge uses both sides of same table — Prisma self-relation might need a rework for large graphs.** | `packages/db/prisma/schema.prisma` | Phase 3 |
| ~~**No rate limiting.**~~ `apps/web/proxy.ts` enforces per-IP sliding windows for `/api/*` (`RATE_LIMIT_ORACLE_PER_DAY`, `RATE_LIMIT_KEA_PER_HOUR`, `RATE_LIMIT_MCP_PER_MINUTE`) with `x-ratelimit-*` headers. In-memory; swap for Redis before multi-node. | `apps/web/proxy.ts` | done |
| **Object storage adapter not implemented.** Env vars exist; code paths don't. | `packages/core/src/storage.ts` (missing) | Phase 2 |
| **Tweaks (language/theme/accent/density) are localStorage-only.** A Prisma model + migration is needed to sync settings across devices. Blocked on user approval for schema migration. | `apps/web/lib/brain/tweaks.ts` | Phase 1 |
| **Turbopack cannot resolve NodeNext-style `.js→.ts` imports** across workspace packages. `apps/web` must build with `next build --webpack`. Revisit if Turbopack adds `extensionAlias` support. | `apps/web/next.config.ts` | Phase 2 |
| **retrieveScored pulls a 20-candidate window on every call.** Fine for dev; may need result caching at scale. | `packages/core/src/kra.ts::retrieveScored` | Phase 2 |
| ~~**Teach modal creates Knowledge rows with no embedding.**~~ The worker's `embeddings.backfill` job (every 10 min) picks up any row with `embedding IS NULL` — covers both Teach-modal rows and user-imported Knowledge. | — | done |
| **No WebSocket/SSE for LiveExtraction.** Polls every 15 s. Acceptable for MVP; should move to SSE before public launch. | `apps/web/components/brain/dashboard.tsx` | Phase 2 |
| **No optimistic updates on Skills edit/delete.** UI waits for server response. Add optimistic patches if perceived latency becomes a problem. | `apps/web/components/brain/skills.tsx` | Phase 2 |
| **No initial Prisma migration committed.** `prisma migrate dev` will create one on first run. | `packages/db/prisma/migrations/` (none) | Phase 0 |
| ~~**Knowledge seed rows have no embeddings.**~~ One-shot backfill at `apps/worker/src/backfill-embeddings.ts` (`pnpm --filter @brain/worker backfill:embeddings`); pg-boss `embeddings.backfill` cron runs every 10 min to pick up new null-embedding rows. | — | done |
| ~~**Pre-existing strict-mode type errors**~~ — fixed in commit after the autoskill wiring. `tsc --noEmit` is now clean across both `apps/web` and `packages/core`. Optional-property fields in `@brain/types` now use explicit `\| undefined` syntax; `KEAFinding.scope` widened to `KEAScope` to permit the LLM-only `"community_candidate"` value before it's mapped on persist. | — | done |
| ~~**No nav e2e harness.**~~ Playwright suite landed 2026-04-22 — 16 specs, 104 cases, 98 passing / 0 failing / 6 skipped. Run with `pnpm --filter @brain/web e2e` against a live stack. | `apps/web/e2e/` | done |
| ~~**Command palette uses substring match, not fuzzy scoring.**~~ `fuzzyScore()` in `shell.tsx` now ranks by consecutive-run + word-start bonuses, with a substring fast-path. Empty queries still show all sections. | — | done |
| **Thai + German i18n scaffolded but not reviewed by a native speaker.** English is authoritative; TH/DE strings need proofing before promotion. | `apps/web/lib/brain/i18n.ts` | Phase 2 |
| **Dashboard section labels are hard-coded English.** The `<SectionLabel>` rows on the dashboard (`Your projects`, `Your recent work`, `Right now`) are inline literals, not i18n keys. Pre-existing pattern in `dashboard.tsx` (the older `Your recent work` label was hard-coded too); PR #266 followed it for the two new labels (`Your projects`, demoted `Right now`). Surfacing into a tracked debt so a future i18n pass can lift them at once. | `apps/web/components/brain/dashboard.tsx` | Phase 2 |
| ~~**Oracle answer renders as plain text.**~~ Answer now goes through `react-markdown` + `remark-gfm` with custom `p`/`li`/`strong`/`em` renderers that re-split text nodes around `[^K1]`/`[^S1]` markers and emit an `<a>` citation chip that smooth-scrolls to the matching citation card (stable IDs via `cite-<stamp>-<kind><n>-<sourceId>`). | `apps/web/components/brain/oracle.tsx`, `apps/web/app/globals.css` | done |
| ~~**Oracle stream doesn't forward AbortSignal.**~~ `askStream()` accepts `{ signal?: AbortSignal }`; `/api/oracle/stream` forwards `req.signal`. Both Anthropic (`messages.stream(…, { signal })`) and OpenAI (`chat.completions.create(…, { signal })`) branches honor it, and the generator short-circuits on `AbortError`. | `packages/core/src/oracle.ts`, `apps/web/app/api/oracle/stream/route.ts` | done |
| ~~**Rate-limit proxy is in-memory.**~~ Resolved in Wave 2 (2026-04-22). `packages/core/src/rate-limit.ts` gained an async `Store` interface; `apps/web/lib/brain/rate-limit-store.ts` provides Redis + memory adapters and swaps transparently when `REDIS_URL` is set. | — | done |
| **Fork-on-edit is silent.** Skills "Save" now forks on body change, with a flash message. Users with muscle memory may not realize they created a new row. UI should surface the parent→child distinction explicitly in the edit modal and the detail pane. Deferred past Phase T — onboarding demo uses Teach, not Edit. | `apps/web/components/brain/skills.tsx` | Phase 2 |
| ~~**Session FTS fallback returns inconsistent shape.**~~ Fallback projection now selects `NULL::real AS rank` so callers see the same `rank` field on both paths. | — | done |
| ~~**No tests for new hot paths.**~~ `fuzzyScore`, `parseSSE`, and `rate-limit/check` were extracted to `packages/core/src/{fuzzy,sse,rate-limit}.ts` and covered by `__tests__/fuzzy.test.ts` (7), `sse.test.ts` (7), `rate-limit.test.ts` (5). `env.test.ts` (8) added alongside. 70 tests total green. | — | done |
| **MCP SDK type escape hatch in HTTP transport.** `server.connect(transport as unknown as ...)` works around a real incompatibility between `StreamableHTTPServerTransport` (optional `onclose`) and the base `Transport` type (required `onclose`). Hides future SDK regressions — either upstream the fix or vendor a narrowed wrapper. | `apps/mcp-server/src/index.ts` | Phase 2 |
| **`turbo run test` silently scopes to one package under some cache states.** Observed mid-session: a clean run executed `@brain/core` (34 tests), a subsequent run limited scope to `@brain/web` (no tests, silent pass). Needs audit of `turbo.json` `test` task dependencies and outputs. | `turbo.json`, package `turbo.json` files | Phase 2 |
| **Dimension mismatch: DB column is 1536, Z.ai `embedding-3` native output is 3072.** pgvector will reject any insert where the vector length differs from the column's declared dimension, silently breaking all semantic retrieval. When using `EMBEDDING_BASE_URL` with Z.ai's `embedding-3`, you **must** also set `EMBEDDING_DIMENSIONS=1536` (or another value ≤ 3072 that `embedding-3` accepts via its `dimensions` truncation parameter) to force the model to emit 1536-dim output. The embedding caller already passes `dimensions: DIM` on every request — but if the upstream model ignores that parameter, inserts will fail at the pgvector layer and retrieval will return no results without surfacing an obvious error. Migrating the DB column to a higher dimension requires re-embedding every row and a destructive Prisma migration; that work is deferred until the embedding model choice stabilises. | `packages/db/prisma/schema.prisma` (vector dim `1536`), `packages/core/src/embedding.ts` | Phase 3 |
| ~~**No CI pipeline.**~~ `.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile` → `prisma generate` → `turbo typecheck` → `@brain/core test` → build each app on every push + PR. Cached by pnpm setup-node. | `.github/workflows/ci.yml` | done |
| ~~**No environment validation on startup.**~~ `@brain/core/env` exports `envForWeb()` / `envForMcp()` / `envForWorker()` — role-scoped zod schemas with `DATABASE_URL` required-and-postgres, int/bool coercion, memoization. MCP server + worker call the loader at module top-level; web calls lazily per route via the memoized singleton. | — | done |
| ~~**Oracle cost cap not enforced.**~~ Resolved 2026-04-21 (ledger) + Wave 3 (alerting). `OracleCostLedger` counts spend per user-day; `packages/core/src/cost.ts` emits warn at 80% and error at 100% of `MAX_ORACLE_COST_USD_PER_DAY` with in-process dedup keyed `${userId}:${day}`. | — | done |
| ~~**No server-side observability.**~~ Resolved across Phase 2 + Wave 2, extended 2026-04-24. `packages/core/src/logger.ts` is a pino + AsyncLocalStorage requestId structured logger with a `BrainError` envelope (`code`/`category`/`remediation`/`retryable`/`stackHead` — AI-readable), a recursive `redactFields()` secret scrubber, and a `withTimer(log, op, fn)` boundary helper. `initSentry(service)` + `captureError(log, err, fields, msg)` (lazy-loaded `@sentry/node`, activates on `SENTRY_DSN`). Next.js routes use `apps/web/lib/brain/log.ts::withApi` which stamps `x-request-id` on both directions so any failed response points at its matching log line. | — | done |
| ~~**E2E autoskill Edit modal: PATCH returns 404.**~~ Resolved. Root cause was the hook falling back to mock-mode when the `/api/autoskill/proposals` fetch returned 429 from the in-memory proxy rate-limiter; the Edit button then targeted a BRAIN_DATA mock ID (`p_42`) that doesn't exist in DB. Fix: `skipIfMockMode()` helper in `autoskill.spec.ts` detects the "API unreachable" banner and skips mutating tests; deterministic `toPass()` settle in `beforeEach` waits for the surface to resolve into ready/empty/mock state. | — | done |
| ~~**Responsive skills surface at 360x640 renders neither filters nor list.**~~ Resolved. Not a layout bug — the `.skills-filters` / `.skills-list` DOM is conditional on `items.length > 0` in `skills.tsx`. The test raced the `/api/knowledge` fetch and queried the empty-state panel instead. Fix: register a `page.waitForResponse` BEFORE `page.goto` and await it before the visibility assertion. | — | done |
| **In-memory proxy rate-limit saturates under burst E2E load.** `RATE_LIMIT_MCP_PER_MINUTE=200` (default) is low enough that 16 serial Playwright specs pushing `/api/knowledge`, `/api/autoskill/proposals`, `/api/sessions` etc. hit the window in bursts. Hooks fall back to mock mode (BRAIN_DATA), tests that depend on real rows skip. Fixed defensively at the test layer (skip-on-429) but the right long-term fix is the Redis store (already shipped in Wave 2 — just needs `REDIS_URL` set in the E2E deploy), or a per-client-IP tolerant limit for localhost test runs. | `apps/web/proxy.ts`, `.env` | Phase 2 |
| ~~**`autoskill.applyProposal(id)` returns 422 on seed proposals.**~~ Resolved 2026-04-22. Root cause was `seed-p-03` (target=skill) persisted with `targetId=null`, so `applySkillAppend` threw "skill target requires targetId" → 422. Fix: seed now creates a `tailwind-style` Skill row and wires `seed-p-03.targetId` to it. The `upsert` update path was also extended to heal stale DBs. | — | done |

### Newly documented 2026-04-24 (credentials-auth phase-1 pilot)

| Issue | Where | Fix by |
|---|---|---|
| ~~**Signed-in user signs out, still sees the app.**~~ Root cause: the deployment was silently in dev-shim mode (empty `AUTH_GITHUB_*` + `ALLOW_DEV_AUTH=true`), and dev-shim serves the first User row to every caller so there was no real session to sign out from. Resolved 2026-04-24 by pivoting phase-1 to Credentials mode (username + bcrypt-hashed password in `.env`), rewriting `/signin` for username+password, and fixing `getCurrentUserId()` to honor Credentials sessions. `/api/me` now correctly returns 401 for anonymous callers. See `docs/KNOWLEDGE.md §12.14` for the full truth table. | — | done |
| ~~**No sign-in path without a GitHub OAuth App.**~~ Resolved by introducing Credentials mode (`ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` in `.env`). One operator can run a pilot without provisioning an OAuth App; GitHub can be added later without code changes — the providers array registers both when configured. `pnpm hash-admin-password '<plaintext>'` helper generates the bcrypt hash; cost 12 caps brute-force at ~5 guesses/sec/core. | — | done |
| ~~**Multi-user Credentials path — pilot team blocked if they don't all have GitHub.**~~ Resolved 2026-04-27 by Phase-3b invite-signup: `POST /api/invites/signup` + `UserCredential` table + per-user `authorize()` branch. Invitees sign up with email + password via the invite link; no GitHub App required. Password change at `/settings/password` via `POST /api/me/password`. Admin sign-in path unchanged. | — | done |
| ~~**No automated password reset (SMTP out of scope).**~~ Closed 2026-04-29. Self-service `/forgot-password` + `/reset-password` flow added with `PasswordResetToken` model (1-hour, one-shot, 256-bit token). Email delivered via Resend HTTP API (no new npm dep). Falls back to operator-assisted path when `EMAIL_PROVIDER` is not configured. | — | done |
| **Resend is the only supported email provider.** Postmark, Sendgrid, and SMTP are easy to add via the same `email.ts` boundary (`sendEmail()` checks `EMAIL_PROVIDER` at call time). The current surface area is `invite` + `password reset`; both call `sendEmail()` from `@brain/core`. Adding a second provider is a switch-case in `email.ts` + a new `EMAIL_*` env var. | `packages/core/src/email.ts` | opportunistic |
| **No rate limit on `/signin` Credentials submissions.** The bcrypt cost 12 alone caps guess rate to ~5/sec/core, but an attacker with N parallel TCP connections and spare CPU time can still push. OAuth's voucher-code path has a per-IP 10/hr limit via `checkVoucherRateLimit()`; the Credentials submission doesn't. Add a matching per-IP gate in the server action on `/signin`. Low urgency while only the operator knows the endpoint exists; higher urgency once the host is publicly advertised. | `apps/web/app/signin/page.tsx`, `apps/web/lib/brain/vouchers.ts` (rename helper) | Phase 2 hardening |
| **No boot-time refusal for conflicting auth configs.** `ADMIN_USERNAME="foo"` + `AUTH_GITHUB_ID=""` + `ALLOW_DEV_AUTH=true` today silently picks Credentials (highest priority) and ignores the DEV_AUTH opt-in — correct, but an operator who mis-configures could be surprised. Add a startup assertion: if any two of (Credentials / OAuth / DEV_AUTH) are configured, log a prominent structured warn line so the operator sees it in `docker compose logs web`. | `apps/web/auth.ts` | opportunistic |
| ~~**Dev-shim activates silently when OAuth envs are declared but empty-valued.**~~ Closed by the credentials-auth pivot. `.env.example` now leads with Credentials mode as Option A; the empty-OAuth trap can't fire because operators set credentials first and leave GitHub empty until later. The underlying `authConfigured()` behavior (empty string = falsy = not configured) is still defensible and unchanged. | — | done |

### Newly documented 2026-04-28 (Oracle with-Brain indicator)

| Issue | Where | Fix by |
|---|---|---|
| **When `groundedness=none`, the LLM might still try to cite.** The `SYSTEM_PROMPT_NO_CONTEXT` override instructs the model not to use `[^N]` markers, but non-deterministic LLMs (especially smaller models or models accessed via `ANTHROPIC_BASE_URL` proxies) may still emit citation markers despite the instruction. If they do, `mapCitations()` will produce an empty citation list (the markers won't match any retrieved knowledge), which is harmless but inconsistent. Strengthen the no-context prompt over time: add a reinforced instruction and monitor for `[^` occurrences in answers that have `groundedness=none`. | `packages/core/src/oracle.ts::SYSTEM_PROMPT_NO_CONTEXT`, `mapCitations()` | opportunistic |

### Newly documented 2026-04-24 (the legacy host improvements wave + dev-shim trap)

| Issue | Where | Fix by |
|---|---|---|
| **Dev-shim activates silently when OAuth envs are declared but empty-valued.** `authConfigured()` in `apps/web/auth.ts` checks `!!process.env.AUTH_GITHUB_ID` — empty string is falsy, so the server falls through to the dev-shim path when `ALLOW_DEV_AUTH=true` is also set. An operator who filled in the key names in `.env.local` but left their values empty (or didn't create the GitHub OAuth App yet) sees `/api/*` returning 200 with the first User row's data to every anonymous caller and assumes auth is working. Observed live on the legacy host 2026-04-24. **Surfacing bug**: the operator-facing failure mode is invisible without a direct `curl /api/me` probe. **Proposed guard**: a boot-time refusal when `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET` are present-but-empty AND `ALLOW_DEV_AUTH=true` — the combination is always wrong. Diagnostic recipe in `docs/SECURITY.md §"declared-but-empty OAuth env trap"`. | `apps/web/auth.ts` (`authConfigured`), maybe a startup log line | next auth-hardening PR |
| ~~**MCP unauth `initialize` may be leaking serverInfo — `verify-lockdown.sh` false PASS.**~~ Audit script fixed 2026-04-24 (commit `098712b`): now probes with `Accept: application/json, text/event-stream` so `tools/list` tests auth instead of content negotiation, and emits a separate advisory probe for `initialize` (200 is spec-permitted). The architectural question "should we override the MCP spec and refuse unauth'd `initialize`?" is tracked in issue #4 — NOT fixed in code pending that decision. | `scripts/verify-lockdown.sh`, issue #4 | issue #4 decision |
| ~~**Dockerfile `prisma generate` silent no-op on pnpm 9.**~~ Fixed in commit `cd4d463` — both occurrences in `deploy/Dockerfile` now use `pnpm --filter @brain/db exec prisma generate`. `packages/db/package.json` also gained a `"prisma": "prisma"` script as a preventive measure. | — | done |
| ~~**`.env.local` was world-readable on the legacy host.**~~ Fixed live 2026-04-24 via `chmod 600 .env.local`. RUNBOOK row added explaining the `.env → .env.local` symlink trap (cosmetic `lrwxrwxrwx` on the symlink is fine; the target's mode is what gates access). | `docs/RUNBOOK.md` | done |
| **`.github/workflows/ci.yml` only triggers on `main` pushes/PRs.** Feature-branch PRs targeting `develop` get no code-CI — just GitGuardian + CodeRabbit. Local validation (pre-commit hook runs typecheck + tests) fills the gap, but there's no enforcement. Add `develop` to the `push:` and `pull_request:` branch lists so any PR into develop runs the full verify job. | `.github/workflows/ci.yml` | Phase 5+ |

### Newly documented 2026-04-24 (docker build-speed wave)

| Issue | Where | Fix by |
|---|---|---|
| **First-ever build on a fresh VM or after a BuildKit-builder wipe still costs ~20–30 min.** The cache-mount commit (`abd0caa`) prevents *recurrence* of that cold-path cost, not the first occurrence — webpack has no prior module graph to rehydrate from on run 1. Operators provisioning a new VPS should expect that hit once, after which warm-to-warm rebuilds run ~2.5–3 min and hot-`.next/cache` rebuilds drop webpack compile to ~40 s. Documented in `deploy/DEPLOY.md §"Build speed"` with the measured table. | `deploy/Dockerfile`, `deploy/DEPLOY.md` | docs-only — accepted behaviour |
| **Webpack compile on `next build --webpack` is still the tall pole at 40 s warm-warm / 112 s warm-cold.** The real fix is Turbopack, which we can't adopt until it supports `extensionAlias` (workspace packages export `.js` but the actual files are `.ts`). Every Next major release should be re-evaluated for Turbopack readiness. Until then the webpack cache mount is the best we have. | `apps/web/next.config.ts` (`bundler: "webpack"`), `docs/GUIDELINES.md §10` | next Next major |
| **No CI assertion that the build-speedup flags are honoured.** A well-meaning future edit could drop `DOCKER_BUILDKIT=1` or delete a `--mount=type=cache,...` line and we'd only notice next deploy. A CI smoke-build that grep's the `--progress=plain` output for the expected `RUN --mount=type=cache,...` lines would catch the regression cheaply. | `.github/workflows/ci.yml`, `deploy/Dockerfile` | Phase 5+ |

### Newly documented 2026-04-24 (AI-readable logging wave)

| Issue | Where | Fix by |
|---|---|---|
| **Not every Next.js API route is wrapped in `withApi`.** The new `apps/web/lib/brain/log.ts::withApi(op, handler)` gives each request a stamped `requestId`, timing, structured error line, and an `x-request-id` response header — but adoption is incremental. Today `authErrorResponse` logs every caught error from routes that use it, so 500s are no longer black holes; routes that don't catch errors still surface via Next.js' default error boundary (no `requestId` correlation). Mass-migrate existing routes to `withApi` when touching them — don't burn a sweep PR. | `apps/web/app/api/**/route.ts` | opportunistic |
| **`ENVIRONMENT` marker still unused by logger.** Wire the pino logger's `base` to include `env: process.env.ENVIRONMENT ?? process.env.NODE_ENV` so the informational stamp carries signal in every log line. Small change; deferred only because it touches `.env.pilot.example` too. | `packages/core/src/logger.ts` | next-doc-pass |
| **Embedding fallback is untested against a real transient 429.** The Gemini-2 → Gemini-1 → OpenAI chain + `isTransient()` detector in `packages/core/src/embedding.ts` is covered at the type level and by the logger unit tests but not by an integration test that forces a 429 from a provider. Would need a nock/MSW fixture of the OpenAI SDK's error surface. | `packages/core/src/embedding.ts`, new `__tests__/integration/embedding.test.ts` | Phase 5+ |

### Newly documented 2026-04-24 (post-merge cleanup)

| Issue | Where | Fix by |
|---|---|---|
| **`main` branch is not protected on GitHub.** A direct `git push origin main` from the legacy host succeeded during the `develop → main` fast-forward on 2026-04-24, bypassing any PR/review/CI gate. `CONTRIBUTING.md` says main is protected; reality currently disagrees. Fix by enabling the protection rule on GitHub: Settings → Branches → Add rule → `main` → require PR before merge + require status checks to pass + require at least 1 approving review. Low-urgency for a solo deploy, high-urgency before a second contributor joins. | GitHub repo settings | before 2nd contributor |

### Newly documented 2026-04-24 (architecture-clarification wave)

| Issue | Where | Fix by |
|---|---|---|
| ~~**`PROD_CLAUDE_PROMPT.md` assumes the prod host runs its own Brain — it doesn't.**~~ Resolved 2026-04-24 by deleting the file. At that time, the prod host was a coding-work VM; the replacement was `docs/AUTOBAHN_BOT_PROMPT.md` (the coding-VM recipe). On 2026-04-25 the prod host was promoted to production Brain and `AUTOBAHN_BOT_PROMPT.md` was also deleted — its rules were now backwards. See the 2026-04-25 topology section above. | — | done |
| ~~**Mental-model drift: my `22d6944` doc sweep framed two hosts as symmetric parallel Brains.**~~ They aren't; the prod host is a client of the legacy host's Brain. Corrected in the 2026-04-24 architecture-clarification wave. Lesson captured in APPROACH §5n. | — | done |

### Newly documented 2026-04-24 (two-env workflow + first dev-prompt run)

| Issue | Where | Fix by |
|---|---|---|
| ~~**DEV/PROD Claude prompts assume a shared-secret `MCP_BEARER_TOKEN` env.**~~ Resolved 2026-04-24 by deleting both prompts. The platform uses per-user `MCPToken` rows; operator-side token hashing was a no-op. Server ops now go through `scripts/deploy.sh` + `scripts/verify-lockdown.sh` directly. | — | done |
| **`ENVIRONMENT` env var not referenced by the app code.** The stamping step in the (now-deleted) DEV prompt wrote `ENVIRONMENT=dev` into `.env.local` on the legacy host, but no code in `apps/*` or `packages/*` reads it. It's an informational marker only — useful for `grep` / admin introspection, not load-bearing. Either remove the stamp (now only in `.env.pilot.example` as reference) or wire the pino logger to emit it so the marker carries signal. (Also tracked as a fresh line item under the 2026-04-24 AI-readable-logging wave.) | `packages/core/src/logger.ts`, `.env.pilot.example` | next-doc-pass |
| **Repo-resolved `.env` symlink confuses `docker compose` parsing.** On the legacy host `.env → .env.local`; direct `docker compose config` warns `DATABASE_URL is not set` even though `.env.local` defines it. `./scripts/deploy.sh` works fine because it passes `--env-file .env` explicitly. Cosmetic, but noise-in-output that looks like a real error. | `deploy/docker-compose.yml`, the legacy host host setup | low-priority |

### Newly documented 2026-04-23 (Phase-N self-audit wave)

| Issue | Where | Fix by |
|---|---|---|
| ~~**Generation-uplift benchmark is scaffolded but not run.**~~ First run shipped 2026-04-24 — 40 Oracle calls against Z.ai GLM 5.1, ~41K tokens total (<$0.10). Artifact at `benchmarks/uplift-first-run.jsonl`. Qualitative signal is unambiguous: with-Brain answers cite specific user Knowledge rows via `[^K1]` markers and include project-specific nuance; without-Brain answers open "I don't have your session data" then fall back to generic advice. The benchmark scripts and their author-written fixture were removed when the demo seed was retired (2026-05-08); reinstating uplift measurement requires a fresh corpus drawn from real session logs. | — | superseded |

### Newly documented 2026-04-23 (Phase-S security wave)

| Issue | Where | Fix by |
|---|---|---|
| ~~**No self-service admin role change UI.**~~ Resolved 2026-04-24. `/admin/users` gained a per-row Promote-to-admin / Demote button backed by `PATCH /api/admin/users/[id]/role`. Writes an `admin.role_change` audit row with the from/to values. Soft guard refuses to demote the last remaining admin (409 `last_admin_cannot_be_demoted`). `ADMIN_EMAILS` env remains the chicken-and-egg bootstrap. | — | done |
| **Vouchers are not email-scoped.** A voucher code can be redeemed by any email that knows it. If a code leaks (Slack paste, screenshot) anyone can self-enroll. Mitigated by short TTL + small `maxUses`; the right long-term fix is a `VoucherCode.emailAllowlist String[]` and matching check in `claimVoucher`. | `packages/db/prisma/schema.prisma`, `apps/web/lib/brain/vouchers.ts` | Phase 6 |
| **NextAuth callback not rate-limited.** `proxy.ts` exempts `/api/auth/*` to avoid 429 on cold starts. An attacker could flood the callback. Realistic mitigation: a per-IP limit inside the callback that doesn't bypass OAuth but delays brute-force. | `apps/web/proxy.ts`, `apps/web/auth.ts` | Phase 6 |
| ~~**No CAPTCHA on voucher entry.**~~ Resolved 2026-04-23 with a per-IP rate limit (10 attempts/hour) on the `/signin` server action, backed by the same Redis/in-memory `Store` as `proxy.ts`. Real attackers would need 10^9+ hours to enumerate the code space; honest mistypes still get 10 tries per hour before being told to wait. CAPTCHA is a heavier bet deferred until we see real abuse telemetry. | — | done |
| **JWTs cannot be revoked mid-session.** A compromised token works until expiry. Retrofit: a `Session` table with `revokedAt`, checked in `getCurrentUserId()`. Affects "a user suspected of being compromised" scenarios. | `apps/web/lib/brain/auth.ts` | Phase 6 |

### Resolved / newly documented 2026-04-23 (Phase-5 validation)

| Issue | What we learned / fix |
|---|---|
| ~~**KRA multi-factor formula underperforms raw cosine on clean queries.**~~ First retrieval benchmark (`packages/core/scripts/retrieval-benchmark.ts`, 20 hand-labelled queries) shows KRA at NDCG@5 0.928 vs. cosine-only at 1.000 — a −7.2% lift. The 60% weight on non-semantic factors (success 0.2 + recency 0.15 + ctx 0.15 + confidence 0.1) demotes relevant items that pure cosine would surface first, notably on queries where the expected row has moderate confidence or is older. Three queries out of 20 took the hit: all involved React server components / hooks where the target row (`seed-k-react-03`) is an anti-principle with lower confidence. Options to investigate: (a) re-tune weights empirically against the fixture, (b) apply the formula only as a tie-breaker when cosine similarities are within ε, (c) retire the re-rank entirely and use cosine. Current formula was chosen a priori from research, not from data. See `docs/VALIDATION.md` for the full write-up. | `packages/core/src/kra.ts::scoreItem`, `docs/VALIDATION.md` | Phase 5 |

### Resolved / newly documented 2026-04-22 (UX density pass + backend bug-hunt)

| Issue | What we learned / fix |
|---|---|
| **Worker crash-loop (12 h) — `Queue evolution.decay not found`.** pg-boss 10+ requires `createQueue(name)` before `schedule(name, ...)` / `work(name, ...)` — the previous v9 behaviour (auto-create on first schedule) was removed. The worker called `boss.schedule(...)` directly, failed a FK constraint (`schedule_name_fkey`), and crashed on every boot. **Fix:** iterate every queue name through `boss.createQueue()` immediately after `boss.start()`. The call is idempotent, so it's safe across restarts. See `apps/worker/src/index.ts`. |
| **E2E fork test accumulated "MODIFIED: …" Knowledge rows forever.** 22 polluted rows at discovery, visible in the Graph surface. **Fix:** `test.afterAll` in `skills.spec.ts` deletes any row whose body contains the fork marker string. Existing pollution requires a one-shot DELETE (API-authorized cleanup; not done automatically). |
| **First-mount density on Skills / Graph / Oracle.** All three surfaces auto-selected an item/node/empty-state on mount, opening a right-side pane with either stale data (Graph inspector auto-picked `nodes[0]`) or a placeholder ("Ask a question to see retrieval."). **Fix:** progressive disclosure — hide the rightmost column until the user clicks a row/node or asks a question. `Esc` + a close-icon on each detail pane back out to the listing. Graph canvas node labels also truncate to 42 chars so long KEA rules + fork-test "MODIFIED: …" titles don't collide into an unreadable wall. |
| **`seed-p-03` (target=skill) persisted without a `targetId`.** `applySkillAppend` threw, producing the HTTP 422 that had been in KNOWN_ISSUES since Phase E2E. **Fix:** seed creates a `tailwind-style` Skill row and wires `seed-p-03.targetId` to it. `upsert` update path now includes `{ target, targetId, patch }` so re-running seed heals older DBs. |

### Resolved / newly documented 2026-04-22 (Wave 1/2/3 + Playwright expansion)

| Issue | What we learned / fix |
|---|---|
| **Onboarding modal auto-opens during the pre-fetch window.** Modal keyed off `knowledgeCount === 0`, which is transiently true during the initial `useCounts` fetch. Existing users saw the onboarding flash on every reload, and E2E clicks were intercepted by the modal's scrim. **Fix:** new `ready` prop on `Onboarding`, gated on `liveCounts.loaded`, so the modal only opens after the host app has real counts. Added a second guard: `bp_onboarded=true` persisted on dismiss. See `apps/web/components/brain/onboarding.tsx` + `app.tsx`. |
| **Playwright config in wrong location.** `apps/web/e2e/playwright.config.ts` was never discovered — Playwright resolves config from the test-runner CWD. **Fix:** move to `apps/web/playwright.config.ts` with `testDir: "./e2e"`. Also set chromium-only + serial (shared DB state) + no `webServer` opt-in (caller must have the stack running). |
| **Next.js 16 proxy `runtime` override is a build error.** Originally set `export const config = { runtime: "nodejs" }` in `apps/web/proxy.ts`, which in Next 16 fails with `Route segment config is not allowed in Proxy file`. Next proxy always runs on Node now. **Fix:** drop the `runtime` key; keep only the `matcher`. |
| **pnpm 9 silently breaks `pnpm --filter @brain/db prisma migrate deploy`.** pnpm 9 looks for a `prisma` package.json script; when absent it no-ops instead of falling through to the bundled binary. Both `scripts/deploy.sh` and `scripts/deploy-prod.sh` were affected — migrations silently did nothing on fresh deploys. **Fix:** prefix with `exec`: `pnpm --filter @brain/db exec prisma migrate deploy`. |
| ~~**`pg_dump` backups are on-host only.**~~ Closed 2026-04-25. Off-host replication via rclone added as an opt-in `backup-replicate` Compose profile (`rclone/rclone:1` sidecar, syncs `brain_backups` to any S3/R2/B2 bucket every `BACKUP_INTERVAL` seconds). Activate with `COMPOSE_PROFILES=...,backup-replicate`; configure via `scripts/setup-backup-replicate.sh`. Heartbeat visible at `GET /api/admin/backup-status`. See `docs/RUNBOOK.md §"Off-host backup replication"`. **Follow-up:** rclone is the only supported sync mechanism; operators who prefer native `aws s3 sync` or `gsutil` could add an alternate sidecar image — tracked as a future PR. | `deploy/docker-compose.prod.yml`, `scripts/setup-backup-replicate.sh`, `deploy/rclone.conf` (gitignored) | done |
| **Admin role bootstrapping is manual.** `User.role` defaults to `"user"` with no first-admin grant path — you must `UPDATE "User" SET role='admin' WHERE email=…` by hand after deploy. Acceptable for a single-tenant / small-team deploy; a self-service admin grant flow is a Phase 3 item. |
| **GDPR erase is soft.** `POST /api/admin/users/[id]/erase` nulls PII on User + cascades knowledge/sessions/tokens/cost-ledger deletes, but **retains AuditLog rows** (by design — compliance requires an append-only record of the erase itself). The erased user's `actorUserId` references in audit rows therefore outlive the User row; queries must LEFT JOIN rather than INNER JOIN. |

### Resolved / newly documented 2026-04-21 (Wave 1 backup + Playwright smoke suite)

| Issue | What we learned / fix |
|---|---|
| ~~**Backups are on-host only.**~~ Closed 2026-04-25 — see entry in section above. Off-host replication via rclone sidecar is now opt-in. | — | done |

### Resolved 2026-04-25 (two-Brain topology promotion + stale-doc cleanup)

| Issue | What we learned / fix |
|---|---|
| ~~**`docs/AUTOBAHN_BOT_PROMPT.md` described a host role that no longer exists.**~~ The file was written for the prod host as a coding-work VM (rules like "Never `./scripts/deploy.sh` on this host", "There are no `web` / `mcp-server` / `worker` / `db` containers here"). On 2026-04-25 the prod host was promoted to production Brain; every rule in the file was reversed. Deleted via `git rm` and removed from all cross-references (README, ARCHITECTURE, GUIDELINES, CONTRIBUTING, RUNBOOK). Replaced by pointers to `docs/DEPLOY_CHECKLIST.md` and `deploy/PRODUCTION.md`, which already cover prod-Brain ops. Principle: fewer-but-correct prompts beat many misaligned ones (first applied in commit `5f3f660`; applied again here). See `docs/APPROACH.md §5t` for the extended lesson. | `docs/AUTOBAHN_BOT_PROMPT.md` (deleted), all cross-references updated | done |

### Resolved 2026-04-25 (MVP critical fixes — org-owner self-service, first-run defaults, onboarding re-trigger, cost-ledger UI, org-scoped audit)

| Issue | What we learned / fix |
|---|---|
| ~~**Audit #2 — /admin/org gated behind platform-admin layout.**~~ Org owners who were not platform admins could not reach their own org's member-management page. The page logic was correct (`requireOrgMember` inside); only the URL was wrong. Fixed: page moved to `/settings/org` (no platform-admin gate — just sign-in + org membership). The old URL `/admin/org` now permanently redirects to `/settings/org`. "Organization" entry removed from the `/admin/*` nav; added to the user menu via the `/settings/org` link. | — | done |
| ~~**Audit #4 — ensurePersonalOrg / ensureDefaultProject called lazily on every API request.**~~ The lazy call in `getActiveProject` worked but meant first-run defaults were created on the first API hit, not at sign-in. Fixed: both idempotent helpers are now called in `auth.ts` `signIn` callback (OAuth) and `authorize` (Credentials) immediately after the User row is resolved, wrapped in try/catch so sign-in never fails if the helpers do. | — | done |
| ~~**Audit #5 — No way to re-trigger the onboarding tour from the UI.**~~ The onboarding modal opens when `bp_onboarded` is absent/false, but there was no affordance to clear it. Fixed: "Show onboarding tour" menu item added to the user menu. On click it removes `bp_onboarded` from localStorage and reloads the page, causing the modal to auto-open. | — | done |
| ~~**Audit #6 — No /admin/cost-ledger UI page.**~~ `GET /api/admin/cost-ledger` existed but there was no web UI to view it. Fixed: `/admin/cost-ledger/page.tsx` added — client-rendered table showing date / user / calls / tokens-in / tokens-out / cost (USD) for the last 30 days. "Cost ledger" entry added to the `/admin/*` nav. | — | done |
| ~~**Audit #7 — Org-scoped audit log inaccessible to non-platform-admin org owners.**~~ `/admin/audit` requires platform-admin. Fixed: new endpoint `GET /api/orgs/:orgId/audit-log` gated by `requireOrgMember` + role≥admin. New page `/settings/audit` calls this endpoint and renders the same table shape as `/admin/audit`, pre-filtered to the active org. | — | done |
| ~~**Audit #10 — main branch not protected on GitHub (no PR/CI gate).**~~ A direct push from the legacy host succeeded during the develop→main fast-forward, bypassing review. This cannot be fully fixed in code — it requires the repo admin to enable the protection rule in GitHub UI settings. See `docs/RUNBOOK.md §"Enabling branch protection on main"` for the exact steps. | — | documented; operator action required |

### Resolved 2026-05-24 (dashboard projects + sessions value drill-down)

| Issue | What we learned / fix |
|-------|----------------------|
| ~~**Per-session value drill-down was only reachable from `#sessions`, not from the landing dashboard.**~~ The dashboard's `RecentSessions` panel listed sessions but the only affordance was *View all* → navigate to `/sessions` → click a row → finally see the two-column value panel from #263. Three clicks for what the user wanted on the first page. **Fix (PR #266):** lifted the existing click-to-expand behavior from `sessions.tsx` into the dashboard's `RecentSessions`. Same `SessionDetailPanel` component, same keyboard support — zero new component code. **Class of bug:** a feature that exists but isn't reachable from the surface the user actually lands on is, for most users, the same as a feature that doesn't exist. | `apps/web/components/brain/dashboard.tsx` | done |
| ~~**No per-project value summary anywhere in the product.**~~ Users could see what a single session got from the brain (#263) but not what a whole project had accumulated — "is the brain pulling its weight on `brain-platform`?" had no answer short of opening sessions one at a time. The aggregate was deliberately deferred in #263 until the per-session signal was validated; once it was, the project view became load-bearing. **Fix (PR #266):** new `GET /api/projects/:id` endpoint (aggregates `SessionKnowledgeApplication` rows across every session under the project, returns two ranked lists + `hitCount` + one-line summary), new `ProjectDetailPanel` mirroring `SessionDetailPanel`, new `ProjectsList` on the dashboard with earned-surface-area gating (returns null for 0 projects, one-line for 1, full list for ≥2). Auth: any org member, mirroring the session-detail policy. See `KNOWLEDGE.md §12.30`. | `apps/web/app/api/projects/[id]/route.ts`, `apps/web/components/brain/projects-list.tsx`, `apps/web/components/brain/project-detail-panel.tsx`, `apps/web/lib/brain/use-project-detail.ts`, `apps/web/components/brain/dashboard.tsx` | done |

### Resolved 2026-05-23 (AI loop tightening + project switcher stale-state + per-session value)

| Issue | What we learned / fix |
|-------|----------------------|
| ~~**Project switcher dropdown didn't show newly-created projects.**~~ User created a project named "Start-idea" but the topbar `OrgProjectSwitcher` dropdown never listed it — only the projects that existed when the page first loaded. **Root cause:** the switcher's `load()` was called once on mount and never again. Projects created in another tab, via the CLI, or via `POST /api/projects` directly never propagated to the dropdown until a hard page reload. The component's own inline create-form already refreshed after creation, masking the bug for the common path. **Fix (PR #262):** one extra `useEffect` that calls `load()` when the `open` state flips true. Cost is one `/api/orgs` request per dropdown open (cheap, and the endpoint already uses `cache: "no-store"`). **Class of bug:** components that own a "list of remote entities" cannot trust a one-shot mount fetch when other tabs / clients can mutate the same list — refetch-on-open or refetch-on-focus is the minimum, not a nice-to-have. | `apps/web/components/brain/org-project-switcher.tsx` | done |
| ~~**E2E gate fired only on `main` push; UI-only changes shipped without rendered evidence.**~~ Six UX sweeps (v0.12.2-v0.12.4) merged with CI green on type-safety alone because the AI's harness had no `pnpm` and no browser. The `e2e-deployed.yml` workflow only triggered on push:`main`, so PR-time render verification was never possible. **Fix (PR #260):** workflow gains a `pull_request` trigger gated on the `e2e-please` label (job short-circuits when absent, so default PR cadence is unchanged). The first run of the new label found a real pre-existing bug — `e2e/security.spec.ts` hardcoded `http://localhost:3100/mcp` for two MCP-unauth tests, which had been silently failing on `main` for an unknown duration. Same PR fixed the spec to honor `E2E_BASE_URL` and added two new `AGENTS.md` sections: *Local validation* and *PR descriptions: honest test plans*. **Class of bug:** type-safety + unit tests aren't a substitute for rendered verification on surfaces whose value is visual. See `APPROACH.md §5ah`. | `.github/workflows/e2e-deployed.yml`, `apps/web/e2e/security.spec.ts`, `AGENTS.md` | done |
| ~~**Sessions table showed `K in/out` counts but never the names of items.**~~ User asked: "when I click a session I want to see what the brain gained from this session and what I got from the connection." The counts existed (`SessionKnowledgeApplication` rows per session, split by `role`), but no UI surfaced the actual items — making the round-trip opaque. **Fix (PR #263):** new `GET /api/sessions/:id` endpoint + `SessionDetailPanel` component. Click a row → expand inline to see *Brain helped you* (injected) and *Brain learned from you* (extracted_from) as two columns, each linking to the underlying skill. Auth scoped to session-owner OR org-member of the session's project; soft-deleted Knowledge filtered at the API. The companion project-level "value summary" was deliberately deferred until the per-session view's usage validates the signal — see `APPROACH.md §5ah` on validate-before-aggregate. | `apps/web/app/api/sessions/[id]/route.ts`, `apps/web/components/brain/session-detail-panel.tsx`, `apps/web/components/brain/sessions.tsx` | done |
| ~~**Chip touch-targets at 22px failed Apple HIG (44x44) and WCAG 2.5.5 on touch devices.**~~ Mobile audit confirmed the 880px breakpoint already collapsed most layouts correctly, but `.chip { height: 22px; padding: 0 8px; }` was too small for finger tap on the small viewports. Onboarding modal at `92vw` left only ~14px effective side margin on 360px phones. **Fix (PR #261):** inside the existing `@media (max-width: 880px)` block, `.chip` minimum 32px (36px for interactive chips); onboarding modal `min(500px, calc(100vw - 24px))`. New Playwright tablet + touch-target tests in `e2e/responsive.spec.ts`. | `apps/web/app/globals.css`, `apps/web/e2e/responsive.spec.ts` | done |

### Resolved 2026-05-14 (closed the full learn → retrieve → apply → feedback → compound loop)

PR #213/#214 brought cross-session KEA. PR #217/#218 fixed KRA so `scope='user'` rows return without an explicit `projectId`. PR #219 wires cross-session KEA as a daily pg-boss schedule. The platform now compounds without operator intervention.

| Issue | What we learned / fix |
|-------|----------------------|
| ~~**KRA dropped `scope='user'` rows when no `projectId` was passed.**~~ KEA-extracted rows inherit `ownerProjectId` from the writing session even though their declared scope is cross-project. The old SQL filter trusted only `ownerProjectId IS NULL` to decide cross-project visibility, ignoring the `scope` column. Result: a `brain_retrieve_knowledge` call without `projectId` returned an empty bundle even when the user had 5 stored Knowledge rows. **Fix (#217/#218):** `buildRawProjectFilterV2`'s "no activeProjectId" branch now respects the `scope` column — rows with `scope IN ('user','global')` are returned regardless of `ownerProjectId`. `scope='project'` rows still require an explicit `projectId`. **Class of bug:** when a row carries multiple visibility-related columns (here `scope` and `ownerProjectId`), the read-side filter must respect the column whose value declares INTENT (`scope`) over the column whose value is just metadata about origin (`ownerProjectId`). | `packages/core/src/scope-filter.ts` | done |
| ~~**Cross-session KEA never ran automatically.**~~ PR #213 added the cross-session pipeline but it only ran via a manual driver script (`packages/core/scripts/run-cross-session-kea.ts`). Without a scheduled trigger, every operator had to remember to run it — a "soft" silent failure where the platform stops compounding but nothing visibly breaks. **Fix (#219):** new `kea.cross_extract` pg-boss queue + daily schedule (`0 6 * * *` UTC). The driver function `runCrossExtractDaily` has idempotent skip-on-no-new-sessions logic so it's safe to run repeatedly. Emits `op="kea.cross.skip"`, `op="kea.cross_extract"`, and `op="kea.cross.daily_done"` log lines. | `apps/worker/src/index.ts`, `packages/core/src/kea.ts` | done |
| **Test infrastructure: `vi.spyOn` doesn't intercept intra-module calls in ESM.** When `runCrossExtractDaily` calls `extractFromCrossSessions` inside the same module, `vi.spyOn` on the export doesn't intercept the call — Node's ESM resolves to the local function binding, not the namespace export. **Fix (#219):** dependency-inject the extractor via `runCrossExtractDaily({ extract? })` — production callers leave it undefined and get the real implementation, tests pass a stub. **Class of bug:** if you need to test a module function that wraps another module function, the wrapper's call site needs an injection point. `vi.mock` (full module replacement) is the alternative but blocks testing the wrapper's own logic. | `packages/core/src/__tests__/kea-cross-extract.test.ts` | done |

### Resolved 2026-05-12 (KEA pipeline diagnostic chain — knowledge_by_kea stuck at 0 even after sessions close)

PR #206/#207. The follow-up audit to PR #202: sessions were being closed via `brain_report_session_outcome`, `kea.extract` jobs were enqueuing in pg-boss, but `knowledge_by_kea` stayed at 0 and `last_kea_extraction_at` was `never`. Three nested bugs, each invisible until the layer above it was fixed.

| Issue | What we learned / fix |
|-------|----------------------|
| ~~**Worker P2025 retry-storm on deleted Sessions.**~~ The integration test for the install-ping flow cleans up its synthetic Session row in `afterAll`, but `brain_report_session_outcome` had already enqueued a `kea.extract` job. The worker hit `prisma.session.findUniqueOrThrow()` for a row that no longer existed → P2025 → pg-boss retried 3× with backoff → job parked as `failed`. From the worker logs it looked like KEA was broken, but the actual problem was a race between test cleanup and the worker's pickup loop. **Fix:** detect `err.code === "P2025"` in both `kea.extract` and `autoskill.run` handlers; log `outcome="skipped_session_gone"` and complete the job instead of throwing. The pattern also covers legitimate cases (GDPR erase, manual ops) where the session was deleted between enqueue and process. | `apps/worker/src/index.ts` | done |
| ~~**Misleading "Missing OPENAI_API_KEY" error from `callDashScope`.**~~ Once the P2025 case was handled, the next session failed differently: the OpenAI SDK threw `Missing credentials. Please pass apiKey, workloadIdentity, or set the OPENAI_API_KEY environment variable.` But the actual missing env was `DASHSCOPE_API_KEY` — `callDashScope` passes `apiKey: process.env.DASHSCOPE_API_KEY` (undefined), the SDK mentions OPENAI_API_KEY only because that's its fallback when no explicit apiKey is given. An operator chasing the error message would have wasted hours setting an env var that was already set. **Fix:** explicit `DASHSCOPE_API_KEY` guard at the entry of `callDashScope` with an actionable error naming the right env var AND the two alternative providers (`KEA_MODEL=claude-haiku-4-5 needs ANTHROPIC_API_KEY`, `gpt-* needs OPENAI_API_KEY`). | `packages/core/src/kea.ts` | done |
| ~~**`KEA_MODEL` env var not passed through to worker container.**~~ `.env` had `KEA_MODEL` set, but `deploy/docker-compose.yml`'s worker `environment` block was missing the variable. The worker silently used the in-code default (`qwen3-coder`, routes to DashScope), so `.env` overrides were ignored. Every probe of "is my env set right?" returned the right answer (the file had the value), but the container behaved wrong (the value never reached the process). **Fix:** add `KEA_MODEL: ${KEA_MODEL:-qwen3-coder}` and `DASHSCOPE_API_KEY: ${DASHSCOPE_API_KEY:-}` to the worker service's environment block, with a comment documenting the provider-routing logic so the next operator who edits this file doesn't have to chase the routing through code. **Class of bug:** a value being present in `.env` proves nothing about whether it reaches a specific container — verify with `docker compose exec <service> printenv \| grep <VAR>`. | `deploy/docker-compose.yml` | done |
| **New diagnostic: `op="kea.funnel"` log line.** Until this PR, the worker logged `items: <persisted-count>` after `extractFromSession()` — which conflated three different states ("LLM returned 0 findings" / "filter dropped them all" / "persistence failed"). The new funnel log emits `{llmFindings, filterPassed, persisted}` so operators can tell at a glance whether KEA is silent because the model returned nothing, the quality filter is too strict, or persistence broke. | `packages/core/src/kea.ts` | done |

**Validation captured in DB on dev brain (`brain-dev.example.com`):** before this chain, `knowledge_by_kea=0` and `last_kea_extraction_at=never`. After: `knowledge_by_kea=1`, `last_kea_extraction_at=2026-05-11 16:20:56`. The single KEA-extracted Knowledge row came from a real session through `claude-haiku-4-5` carrying two `user_correction` events about React useEffect dep-array patterns.

### Resolved 2026-05-11 (MCP observability + installer v2 — "tokens connected but brain not learning" diagnostic)

| Issue | What we learned / fix |
|-------|----------------------|
| ~~**Auth gate works ≠ pipeline learning.**~~ Spot-checking `brain-dev.example.com` after a release surfaced a silent failure: 184 successful `mcp.session.open` events over 7 days at exactly 900-second cadence (uptime probes), **zero tool calls**, and **zero session closes** (the in-memory `sessions` Map leaked forever — production had 184 entries growing). The DB confirmed: `sessions_total=0`, `knowledge_total=0`, `last_kea_extraction=never`. Tokens were authenticating fine; nothing past the auth gate ever fired. **Why it was invisible:** tool calls logged as `op="mcp.tool"` not `mcp.tool.call`, and `tools/list` calls logged nothing at all — so a histogram of `op` values showed "184 opens, 0 anything-else" which looked like the auth gate was the only thing running, not a real diagnostic. **Fix (PR #202):** (a) added `op="mcp.tools.list"` and `op="mcp.session.orphan"` log lines so probe-shape sessions leave a fingerprint; (b) added a 5-min sweeper that evicts sessions older than 30 min with zero tool calls, fixing the Map leak; (c) added `instructions` field on the MCP `initialize` response to nudge clients toward a bootstrap `brain_get_user_style` call so first-touch tool-use is automatic on capable clients (Claude Code reads it). **Class of bug to prevent in future:** logs that distinguish failure shapes are mandatory for any pipeline whose "auth works" path is much shorter than its "actually works" path. See `docs/APPROACH.md §5ab`. | `apps/mcp-server/src/index.ts` | done |
| ~~**`brain_start_session` response is JSON-escaped JSON; naive regex extraction fails silently.**~~ The v2 installer's I2 install-ping (`start_session → log_event → report_session_outcome`) created an orphan Session on first run because the sed `s/"sessionId":"\\([^"]*\\)"` never matched. The wire response wraps the sessionId in a JSON string that contains escaped quotes (`\"sessionId\": \"cm…\"` — with a space after the colon, escaped quotes, and a leading `\\`). The empty `NEW_SID` skipped `log_event` and `report_session_outcome`, leaving the Session row open forever — exactly the "orphan" pattern the rest of this PR was trying to detect. **Fix:** replaced the sed with `grep -oE 'c[a-z0-9]{24}' | head -1`. The cuid shape is invariant of JSON quoting; the first cuid in the response is always the sessionId. **Class of bug:** when extracting structured data from a string that may have been JSON-escaped one or more times, match invariants of the value (shape, length, alphabet) rather than the surrounding syntax (quotes, whitespace, escape chars). | `apps/web/lib/brain/installer-templates.ts` | done |
| ~~**Installer succeeded with `claude mcp list` but the client could not actually reach a tool.**~~ The previous installer ended with `claude mcp list \| grep brain` which proves only that the local config row was written. The token could still be revoked, the user could be behind a proxy that blocks the MCP host, Caddy could be down, the migration on `MCPToken` could be pending — any of which yield a "successful" install that never reaches the tool layer. **Fix:** installer v2 now ends with (a) **I1 smoke-test** — a curl-based JSON-RPC `initialize` + `tools/call brain_get_user_style` through `${MCP_URL}` with per-HTTP-code diagnostics; and (b) **I2 install-ping** — `brain_start_session → brain_log_event(payload={installer_version, claude_version, os}) → brain_report_session_outcome(success=true)`. The install-ping creates a real Session row with `clientType="claude_code"` and a closed outcome, so KEA has its first signal and the dashboard can distinguish a real install from a stale heartbeat. | `apps/web/lib/brain/installer-templates.ts` | done |

### Newly documented 2026-05-05 (i18n placeholder regression class)

| Issue | Where | Fix by |
|---|---|---|
| ~~**Hardcoded "· 2 cited" suffix in `oracle.retrieved` translation strings**~~ — surfaced 2026-05-05 from a screenshot showing `"0 items retrieved · 2 cited"` even though the answer had 0 citations. Root cause: all three i18n variants of `oracle.retrieved` (en/de/th) literally contained `· 2 cited` as placeholder mock text from an early prototype, not as a substitution. The number was a string literal, not bound to `turn.citations.length`. **Fix (PR #95):** stripped the suffix from `apps/web/lib/brain/i18n.ts` for all three languages, added a new `oracle.citedInline` key, and wrapped the citation count in a conditional render in `apps/web/components/brain/oracle.tsx` so the chip only renders when `citations.length > 0`. **Class of bug to prevent in future:** any number, count, or other dynamic value that appears in a translation string is a regression hazard — translations must be format strings (`"{n} cited"` or split keys), never literal numbers. Added to `docs/GUIDELINES.md §10` (frontend i18n rules). | `apps/web/lib/brain/i18n.ts`, `apps/web/components/brain/oracle.tsx` | done |

### Newly documented 2026-04-27 (token UX improvements)

| Issue | Where | Fix by |
|---|---|---|
| **`lastUsedAt` is not updated on subsequent MCP calls within the same session.** The auth gate in `apps/mcp-server/src/auth.ts` captures the token once at session-create per PR #15's design — it stamps `lastUsedAt` on the row the first time the token is seen in a process lifetime, but does not re-stamp on every subsequent tool invocation. An operator viewing `/settings/tokens` will see `lastUsedAt` reflect the last session start, not the last tool call. This is a known observability gap, not a security issue — the token is still authenticated on every call; only the timestamp is coarse. Fix: stamp `lastUsedAt` inside the per-request middleware path rather than the session-level cache. Deferred until the auth hot path is profiled under real load (every MCP tool call would then hit a DB update). | `apps/mcp-server/src/auth.ts` | observability follow-up |

### Documented 2026-04-27 (token UX cleanup — Rotate removed)

| Issue | Where | Fix by |
|---|---|---|
| **Rotate-with-grace removed (2026-04-27).** `POST /api/tokens/:id/rotate` (mint a replacement token + configurable grace window during which both tokens authenticate) was removed after user feedback indicated the Rotate action confused normal users who expected a simple "change my secret" button. Change (`POST /api/tokens/:id/change`) covers the common case — immediate in-place hash swap, same row, no overlap window. The schema columns `scheduledRevokeAt` and `rotatedFromId` remain on the `MCPToken` table, and the auth-gate check that rejects tokens where `scheduledRevokeAt <= NOW()` remains in `apps/mcp-server/src/auth.ts` (defense-in-depth; currently no path sets these columns). Re-enabling rotate-with-grace requires only: a new UI button/modal + the `POST /api/tokens/:id/rotate` route + re-adding `token.rotate` to the `Action` union — no schema migration. | `apps/web/app/api/tokens/[id]/rotate/` (deleted), `apps/web/app/settings/tokens/page.tsx`, `apps/worker/src/index.ts`, `packages/core/src/audit.ts` | intentional removal; see STATUS.md |

### Resolved 2026-04-26 (onboarding wizard + cross-platform installers)

| Issue | What we learned / fix |
|-------|----------------------|
| ~~**Operators editing the wrong Claude Code config file**~~ (`~/.claude/mcp.json` instead of `~/.claude.json`) | Two onboarding failures in 24 h where operators hand-edited `~/.claude/mcp.json` (a path that Claude Code does not read). Fixed in PR #11: `docs/CLIENTS.md` rewritten with the canonical path (`~/.claude.json` is the right file; `~/.claude/mcp.json` is a known trap), and both installer scripts (`/api/onboard.sh`, `/api/onboard.ps1`) use `claude mcp add` which writes to the correct location automatically. |
| ~~**No copy-paste install command after token mint**~~ | After creating or rotating a token, operators received only a raw `bp_…` value with no guidance on where to put it. The post-mint wizard at `/settings/tokens` now generates per-client/OS install snippets automatically — 3-step picker (client → OS → rendered snippet), copy button, and a "Test connection" button backed by `POST /api/tokens/test`. Unit tests: 36 snippet-generator tests, 135/135 total. The wizard has not yet been manually smoke-tested in a browser on the legacy host. |

### Resolved 2026-04-26 (token rotation with grace period)

| Issue | What we learned / fix |
|-------|----------------------|
| ~~**No way to rotate a token without an instant cutover.**~~ Resolved 2026-04-26 via `POST /api/tokens/:id/rotate`. The endpoint mints a replacement token and schedules the old one for deferred revocation after a configurable grace window (0 h / 1 h / 24 h default / 7 d). During the window both tokens authenticate, so the operator can update `~/.claude/mcp.json` or any other client config without downtime. Enforcement is in the auth gate (`scheduledRevokeAt <= NOW()` rejects immediately); the worker tick is a cleanup backstop. The `rotatedFromId @unique` chain-depth-1 constraint is a deliberate simplification — one pending rotation per token keeps the state machine simple and avoids a multi-generation chain that's hard to reason about under partial failure. **Open follow-up:** if re-rotation before the grace period expires proves painful in practice, consider either (a) exposing a "force-rotate" variant that first hard-revokes the pending chain, or (b) lifting the depth limit to 2 with explicit chain-position tracking. For now the operator can `DELETE /api/tokens/:oldId` to clear the chain manually. |

### Resolved 2026-04-26 (MCP-over-HTTPS for the dev TLS profile)

| Issue | What we learned / fix |
|---|---|
| ~~**Dev `--profile tls` exposed the webapp over HTTPS but left MCP on plain HTTP `:3100`.**~~ Surfaced when the operator wired Claude Code on the prod host to point at the dev Brain over the public internet — the only working URL was `http://brain-dev.example.com:3100/mcp`, which sends the Bearer token cleartext on every MCP call. `Caddyfile.dev` only had a webapp block; the prod `Caddyfile` already supported a separate MCP host but the dev posture didn't mirror it. **Fix:** Added an MCP block to `Caddyfile.dev` (`reverse_proxy mcp-server:3100` with 300s stream timeouts), made `BRAIN_MCP_PUBLIC_HOSTNAME` required when the `tls` profile is enabled, added Cloudflare A records for `mcp.brain-dev.example.com` and `mcp.brain.example.com` (gray-cloud, matching the existing pattern). Remote MCP clients now use `https://mcp.<host>.example.com/mcp`. Lesson: when a service crosses a host boundary, the auth material crosses with it — the transport must match the trust boundary, not just the user-facing surface. | `deploy/Caddyfile.dev`, `deploy/docker-compose.yml`, `deploy/DEPLOY.md` | done |

### Resolved 2026-04-25 (deploy-script gate parity + sign-in redirect + dev TLS)

| Issue | What we learned / fix |
|---|---|
| ~~**`scripts/deploy.sh` skipped embedding backfill on Gemini-only `.env`**~~ — the gate at step 5 checked `OPENAI_API_KEY` only, while `packages/core/src/embedding.ts` already prefers Gemini and walks the full key chain. Operators with a Gemini-only deploy saw `Skipping embedding backfill: OPENAI_API_KEY unset` and had to run the bootstrap container by hand. `deploy-prod.sh` already had the multi-key gate; only the test-server script lagged. **Fix:** gate now accepts `GOOGLE_GEMINI_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` / `EMBEDDING_API_KEY`. Lesson: every action gated on a provider key must enumerate the same set the runtime chain supports — gating on a single historical default reintroduces the "configurable but doesn't work out of the box" trap. | `scripts/deploy.sh`, `deploy/DEPLOY.md`, `README.md` | done |
| ~~**Sign-in bounces from remote host to `http://localhost:3000/` after auth**~~ — `.env.example` shipped `AUTH_URL="http://localhost:3000"` with only a brief comment, and operators copying it to `.env` on a remote VM saw NextAuth happily authenticate then redirect the browser to localhost (no app there). `trustHost: true` is set in `apps/web/auth.ts` but does NOT override an explicit `AUTH_URL`. **Fix:** strong inline warning in `.env.example` next to `AUTH_URL` enumerating the three real choices (localhost dev, IP-based test, HTTPS-domain prod). Operator must set `AUTH_URL` to the exact origin users hit. Surfaced live on the legacy host during the brain-dev.example.com setup; resolved by setting `AUTH_URL="https://brain-dev.example.com"` and recreating the `web` container. | `.env.example`, `apps/web/auth.ts` (already had `trustHost: true`) | done |
| ~~**No HTTPS on the dev test stack**~~ — `deploy/docker-compose.yml` exposed port 3000 directly with no reverse proxy; the only TLS-enabled compose file was `docker-compose.prod.yml`, which carries the full prod posture (different env requirements, hides 3000/3100 from the host). Operators wanting HTTPS on a dev box without committing to the full prod posture had to write their own Caddy by hand. **Fix:** added an opt-in `caddy` service to the dev compose behind the `tls` Compose profile, plus a minimal `deploy/Caddyfile.dev` that reverse-proxies the webapp only (MCP stays on `:3100` for direct-IP access). Bring up with `docker compose ... --profile tls up -d caddy` after setting `BRAIN_PUBLIC_HOSTNAME` + `CADDY_EMAIL` + `AUTH_URL` (https) in `.env`. Verified live: Caddy pulled an LE cert for `brain-dev.example.com` on first request; HTTPS healthz 200, HTTP→HTTPS 308 redirect, /signin 200. | `deploy/docker-compose.yml`, `deploy/Caddyfile.dev`, `deploy/DEPLOY.md` | done |

### Resolved / newly documented 2026-04-22 (Phase V deploy validation + Phase Y Gemini wiring)

| Issue | What we learned / fix |
|---|---|
| ~~**`SELECT *` on Knowledge deserializes the `vector(1536)` column and fails**~~ — `kra.ts::fetchCandidates` used `SELECT *, 1 - (embedding <=> $1::vector) AS "_similarity"`. Prisma's driver can't deserialize pgvector's `vector` type (no Prisma equivalent) and every `/api/knowledge/retrieve` call returned `500 internal`. Bug was latent because no row had an embedding in the DB until the first successful Gemini backfill on 2026-04-22. **Fix:** explicit column list in the SELECT, omitting the `embedding` column. Only the cosine-similarity scalar (`1 - (embedding <=> $1::vector)`) makes the wire. | `packages/core/src/kra.ts::fetchCandidates` | done |
| ~~**Embedding provider lock-in**~~ — key resolution was `EMBEDDING_API_KEY → OPENAI_API_KEY → ANTHROPIC_API_KEY`; Gemini users had to duplicate their key into `EMBEDDING_API_KEY`. Chain is now `EMBEDDING_API_KEY → GOOGLE_GEMINI_API_KEY → OPENAI_API_KEY → ANTHROPIC_API_KEY` so named-provider vars are picked up without explicit copying. `.env.example` documents three option blocks (A: Gemini, B: DashScope Qwen3, C: OpenAI). New providers slot in via the same `EMBEDDING_BASE_URL` + SDK-compatible endpoint — no code change needed. | `packages/core/src/embedding.ts::getClient` | done |
| **Generic** (pre-existing, untouched): See below.

| Issue | What we learned / fix |
|---|---|
| ~~**pnpm + Prisma stub client**~~ — `pnpm install` hardlinks files in the content-addressable `.pnpm` store; `prisma generate` can't overwrite them and silently produces 2 KB stub `.prisma/client/*` files that throw `did not initialize yet` at first use. **Fix:** `generator client { output = "../src/generated/client" }` in `schema.prisma` + `import { PrismaClient } from "./generated/client/index.js"` in `packages/db/src/index.ts`. Generated client is gitignored. |
| ~~**Next.js page-data collection trips Prisma init**~~ — `next build` eagerly imports every API route module server-side; a top-level `new PrismaClient()` throws on Alpine / slim images even with `serverExternalPackages`. **Fix:** `SKIP_DB_INIT=1` in the builder stage returns a throwing Proxy from `@brain/db`; the NextAuth route's DB import is deferred via dynamic `import()` inside the `signIn` callback. Runtime containers never set the flag and get a real client. |
| ~~**node:20-slim lacks `libssl`**~~ — Prisma's binary loader probes `libssl` to pick an engine target; without it, it falls back to `debian-openssl-1.1.x` which needs `libssl.so.1.1`, failing on modern slim images. **Fix:** `apt-get install openssl ca-certificates` added to every stage; `binaryTargets = ["native", "debian-openssl-3.0.x", "linux-musl-openssl-3.0.x"]` in `schema.prisma`. |
| ~~**`tsx` binary not at `node_modules/.bin/tsx`**~~ — pnpm hoists only direct deps; `tsx` (transitive) lives at `.pnpm/node_modules/.bin/tsx`. `CMD ["node_modules/.bin/tsx", ...]` fails, `CMD ["pnpm", "exec", "tsx", ...]` fails (no workspace package.json at runtime path). **Fix:** explicit absolute path `["/app/node_modules/.pnpm/node_modules/.bin/tsx", "src/index.ts"]` plus `WORKDIR /app/apps/{worker,mcp-server}` so nested package deps resolve. |
| ~~**Cross-package tsc resolution divergence**~~ — mcp-server & worker had `moduleResolution: "NodeNext"`; `@brain/core` used the base `"Bundler"`. When compiling source-referenced `@brain/core` files, TypeScript resolved `Prisma.InputJsonValue` through `.prisma/client/default.d.ts` (Node-next) but through `.prisma/client/index.d.ts` (Bundler). Docker's tsc picked the wrong file and reported `has no exported member 'InputJsonValue'`. **Fix:** (a) remove `NodeNext` overrides, (b) drop `Prisma.InputJsonValue` cast in favour of plain `as object`, (c) skip `tsc` in Docker for worker & mcp-server entirely — they run from `src/` via `tsx` at runtime, so compiled artifacts are vestigial. |
| ~~**Buildkit `COPY public/` failure**~~ — `COPY --from=builder /repo/apps/web/public ./apps/web/public` errors out when the app has no `public/` directory. **Fix:** drop the copy; Next tolerates a missing `public/`. |
| ~~**Stale bootstrap profile image**~~ — `docker compose build` defaults to the set of services whose profiles are currently active; the `bootstrap` service is gated behind `profiles: ["bootstrap"]` and was NOT rebuilt when source changed. Symptom: the `backfill-embeddings` container kept using the old `embedding.ts` without `EMBEDDING_BASE_URL` support and hit `api.openai.com`. **Fix:** always rebuild with `docker compose ... --profile bootstrap build`; documented in DEPLOY.md. |
| **Z.ai has no embedding API.** `paas/v4` and `coding-intl` subdomains both expose chat completions only; `/embeddings` returns 404. `ANTHROPIC_BASE_URL` routing solves Oracle chat but does nothing for retrieval. **Workaround (current):** DashScope Qwen3 `text-embedding-v4` via `EMBEDDING_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1`; supports `dimensions: 1536` so pgvector column stays unchanged. **Alternative:** Ollama sidecar with `nomic-embed-text` (requires 768-dim schema change). | `packages/core/src/embedding.ts`, `.env.example` | documented |
| **DashScope has two token kinds with different scopes.** A Claude-Code-style token issued under `coding-intl.dashscope.aliyuncs.com` works only for chat; a general 百炼 (Model Studio) `sk-…` token is required for `text-embedding-v4`. Symptoms are identical (`401 invalid access token`) across all four tested endpoint variants — only the scope dimension distinguishes them. | `.env.example`, `docs/CLIENTS.md` | documented |

### Resolved 2026-04-21

The following issues were fixed in the GUI↔backend wiring pass:

| Issue | Resolution |
|---|---|
| **Auth stub `__replace_with_session_user_id__` in /api/oracle and /api/knowledge/retrieve.** | Both routes now call `getCurrentUserId()` from `lib/brain/auth.ts`. |
| **Oracle was a fully hardcoded mock UI.** | Fully wired to `/api/oracle` + `/api/knowledge/retrieve`. Feedback POST, citations, and retrieval inspector rows all come from the backend. |
| **Graph surface had zero backend.** | Now reads from new `GET /api/graph` endpoint returning real `Knowledge` + `GraphEdge` data. |
| **Dashboard sub-panels (LiveExtraction, RecentSessions, PendingProposals) read from BRAIN_DATA seed.** | Now read from live hooks; `typeCounts` and `decayThisWeek`/`bundleHitRate` computed in `/api/dashboard`. |
| **Skills detail-pane buttons (Edit/Fork/Copy/More/Export) were orphan.** | Wired: PATCH edit, POST fork, DELETE, clipboard export. |
| **Shell orphans (Teach, notifications bell, user avatar, scope/tenant switch, live dot).** | All functional. |
| **Sessions pagination + filter were client-only.** | Now server-side cursor with `outcome`/`client` query filters. |
| **Autoskill Auto-apply toggle, Edit, and View Diff were unwired.** | Auto-apply persists to DB; Edit PATCHes reasoning; View Diff fetches full diff from backend. |
| **Rail/BottomNav counts used static BRAIN_DATA.** | Now driven by `useCounts` hook polling live endpoints. |

---

## 2. Structural risks (may exist at any scale)

From `research/knowledge/05-brainstorm-session.md`:

### 2.1 Lossy-compression problem
KEA summarizes a multi-hour session into 3 knowledge items. The information lost can be exactly what mattered. Mitigations:
- Keep raw session archives in object storage so we can re-extract with better KEA.
- Allow user override (`brain_teach_knowledge`) to inject what KEA missed.
- Oracle falls back to raw session search when knowledge is thin.

### 2.2 Bootstrap paradox
A new user with empty Brain gets worse AI assistance than a veteran with 6 months of data. If the first-session experience is bad, they don't come back, so they never build a Brain. Mitigations:
- Community pool pre-seeds Reasonable Default knowledge for popular frameworks.
- First 5 sessions run KEA in high-sensitivity mode + user-confirm prompts.
- Onboarding imports `CLAUDE.md` / `.cursorrules` / `AGENTS.md` if found.

### 2.3 Adversarial inputs
A malicious user could:
- Publish community skills that look helpful but include subtle vulnerabilities.
- Inject prompt-injection payloads into Knowledge that activate when the AI reads them.
Mitigations:
- Community moderation + usage-threshold gate before public visibility.
- Scan knowledge text for known injection patterns before injection (PIrate detector or similar).
- Never execute code from knowledge — only text.

### 2.4 User-model-sync drift
The user's actual preferences change (they adopt React 19, switch from CSS modules to Tailwind). Knowledge captured 6 months ago is now misleading. Mitigations:
- Evolution subsystem: `detectObsolescence` decays framework-tagged knowledge unused in 180 days.
- `detectContradictions` surfaces conflicting items for user to resolve.
- Temporal decay with 90-day half-life.

### 2.5 When the Brain is harmful
If extraction is noisy and retrieval is good, **we amplify garbage at scale**. The system is explicitly worse than "no brain at all" below certain quality thresholds. Gates in `ROADMAP.md` exist precisely to catch this. Stop-conditions in §3 below.

### 2.6 Privacy bleed
A user's personal scope must never leak into team or community. One mistaken JOIN in a query could expose preferences. Mitigations:
- Every ORM query filters by `ownerUserId` / `ownerTeamId` at the repository layer, not the handler layer.
- Integration test: "a user from team A should not see team B's knowledge under any query" — canary test in every PR.

### 2.7 Cost spiral
Oracle at Claude Sonnet 4.6 costs ~$0.02/query. Pro user at 500 queries/mo = $10 on a $12 tier. One over-engaged free user could run up a bill. Mitigations:
- `MAX_ORACLE_COST_USD_PER_DAY` and `RATE_LIMIT_ORACLE_PER_DAY` are hard caps.
- Free tier Oracle uses cheaper model (GPT-4o-mini or Haiku 4.5) unless user upgrades.

---

## 3. Stop-conditions (red flags that should halt development)

From `research/knowledge/13-build-roadmap.md` Gate 1 + `KNOWLEDGE.md §10`:

- SQS does not trend up after 4 weeks of real usage — do not proceed to next phase.
- KEA noise rate > 30 % on 50-session human spot-check — retune before scaling.
- Retrieval NDCG@5 < 0.4 after embeddings are live — retrieval is broken.
- Any cross-scope privacy leak — halt and fix immediately; this is a legal/GDPR risk.
- Any new feature regresses an existing MCP client integration — zero-regression rule.

---

## 4. Unresolved design questions

These were left intentionally open in the research. A decision is needed before Phase 3 at latest.

1. **Who owns community-extracted knowledge?** The user (with a CC-BY license when published), or us? Legal decision.
2. **How do we handle deletion in the face of downstream learning?** If user deletes knowledge X, do we roll back all the autoskill proposals that used X as evidence? Or leave them as historical?
3. **Should team style profile be per-team or per-project-within-team?** Affects `PeerCard` cardinality.
4. **Cross-tenant similarity search for community curation** — how do we find near-duplicate skills across all users without leaking identifying info? Needs a privacy-preserving clustering design.
5. **Model portability** — if we switch embedding models, we invalidate the similarity space. How do we re-embed ~1M items safely without downtime?
6. **Symbolic representation** — `symbolicWhen` / `symbolicThen` fields exist but nothing consumes them yet. Is the rule engine a v2 target, or never-build?
7. **Sync-bridge conflict UI** — when Obsidian and platform both edit the same skill, how do we show the conflict to the user? Three-way diff in the webapp? Obsidian-side banner?

---

## 5. Explicit non-goals

To keep scope sharp, the platform will **not**:

- Generate or execute code. That is the client's job.
- Run a long-lived agent loop. MCP call/response only.
- Provide a code editor UI. Even in the webapp.
- Replace `CLAUDE.md` / `.cursorrules` files — we export to them, not replace them.
- Store source code. We store knowledge derived from sessions. File paths and diffs are metadata, not sources of truth.
- Guarantee that injected knowledge will be followed by the AI. The AI is a probabilistic system; we raise the odds, not the certainty.

If a proposed feature conflicts with a non-goal, the feature should be built as an external integration, not inside the platform.

---

## See also

- [`User Flow diagram`](./assets/illustrations/user_flow.png) — visual: how AI tools connect via MCP and how knowledge is categorized.
- [`Architecture diagram`](./assets/illustrations/architecture.png) — visual: 3-layer system architecture.
- [`Process Logic diagram`](./assets/illustrations/process_logic.png) — visual: end-to-end session lifecycle including the background jobs described in §1.
- [`Vibe-Coding Improvement diagram`](./assets/illustrations/vibe_coding_improvement.png) — visual: how the platform improves coding outcomes.
- [`Skill Development diagram`](./assets/illustrations/skill_development.png) — visual: the pipeline of how skills and rules are developed.
