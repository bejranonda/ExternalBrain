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
- **A 8 GB host cannot run `pnpm turbo run build` while the stack is up
  (2026-08-15).** On `autobahn-bot` (7.6 GiB, **no swap**) with all six
  containers resident, ~1.8 GiB stays free and the Next.js production build is
  SIGKILLed by the OOM killer — exit 137, confirmed in `dmesg`
  (`Out of memory: Killed process … total-vm:38793780kB`). It is not a code
  fault and prod is unaffected: `reload.sh` builds *before* recreating, so a
  failed build aborts and the running container keeps serving. Docker builds
  did succeed the same day at marginally lower pressure, which is the hazard —
  the failure is load-dependent, so it looks intermittent. Mitigations, in
  order: add 2–4 GiB of swap (removes the class), build on CI/another host and
  pull the image, or accept CI as the authoritative build gate and skip the
  local one. `docker builder prune -f` reclaims disk, not RAM — it freed
  24.7 GB here and changed nothing about the OOM.
- **Old backup snapshots are not portable across hosts.** Knowledge
  rows have embeddings tied to the host's pgvector index; restoring an old
  dump on the new host requires `REINDEX INDEX` on the pgvector indexes if
  the index versions disagree. Greenfield deploy + re-import via the seed
  + per-token re-issue path is simpler than a `pg_restore`.
- **Newcomer-eye walk-through catches issues code review can't.** The
  40-iteration UX sweep (2026-05-17 → 2026-05-20, early PRs /
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
- **`docker compose exec -T` silently truncates piped stdout at 64 KiB** (exit
  code 0, so the cut looks like success — a piped JSON export dies mid-string).
  Write large outputs to a file inside the container and `docker compose cp`
  them out; always validate piped-export integrity (GUIDELINES §3).
- **GitHub silently registers an invalid-YAML workflow as trigger-less.** If a
  workflow file fails GitHub's YAML parse (e.g. a multi-line shell string in a
  `run: |` block with column-1 continuation lines — they terminate the block
  scalar), GitHub still registers it, with the **file path as its name and no
  triggers**: cron never fires, `gh workflow run` 422s with "does not have
  workflow_dispatch trigger". The workflow looks merged and healthy until you
  try to run it (#54: the prod-drift watchdog shipped dead this way).
  Discipline: `python3 -c "import yaml; yaml.safe_load(open(f))"` over every
  `.github/workflows/*.yml` before merge, and treat name==path in
  `gh api .../actions/workflows` as the broken-parse tell.
- **Prisma 7 moved `seed` config out of `package.json`.** Surfaced 2026-05-17
  via an early PR → hotfix an early PR. In Prisma ≤ 6 the seed wires through a
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

| ~~**AI-translated TH / DE strings unreviewed by native speakers.**~~ **Native-speaker sweep completed (2026-08-09).** All Thai (`th`) UI keys in `apps/web/lib/brain/i18n-dict.ts` (`landing`, `start`, `welcome`, `oracle`, `decisions`, `dash`, `nav`, `skills`, `graph`, `autoskill`, `sessions`, `callout`, `tip`, `tweaks`) and German (`de`) strings were thoroughly reviewed, polished for natural tone, and aligned with proper technical product terminology. No longer tracked as i18n debt. | `apps/web/lib/brain/i18n-dict.ts` | done |
| ~~**Passive memory positioning replaced with self-improving intelligence.**~~ **Positioning updated (2026-08-09).** Hero copy and repository introduction shifted from passive "memory layer" to "self-improving, compounding AI coding intelligence across EN, TH, and DE". | `apps/web/lib/brain/i18n-dict.ts`, `README.md` | done |
| **MCP client tool catalog is cached per session.** Claude Code / Cursor / Windsurf call `tools/list` at session start and cache the response for the lifetime of the MCP connection. After a server-side tool-catalog change (e.g. An early PR adding `brain_create_project`, an early PR adding `brain_list_projects` + `brain_get_active_project`), existing clients keep the old 9-tool list until they reconnect. The new tools simply aren't visible — calling them fails client-side before reaching the server. (Severity: low, transient. Workaround: restart Claude Code / reconnect the MCP server to refresh the catalog.) | `apps/mcp-server/src/index.ts` (server side is correct; symptom lives in clients) | client-side; no fix needed |
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
| **Users copying dummy setup commands instead of real ones.** A common failure mode during onboarding is users copying the placeholder `curl ... \| bash -s 'bp_<your-token>'` directly from the documentation into their terminal, leading to immediate `401 Unauthorized` errors when their agent tries to connect. The documentation format itself was the trap. **Fixed (2026-08-12):** All setup tutorials and readmes now wrap dummy commands in `> [!WARNING]` blocks and explicitly label the code blocks as `EXAMPLE ONLY — Do NOT copy this block`. | `docs/tutorials/00-quick-start.md`, `README.md`, `docs/USING_BRAIN.md` | fixed |
| **Next.js static rendering bakes empty env into prod artifacts.** `deploy/Dockerfile` builds with dummy env vars ("Dummy env so env validation at top-level doesn't crash the build"). Any `app/**/page.tsx` that reads `process.env.X` at module/server-component scope without `export const dynamic = "force-dynamic"` gets the empty value frozen into the static HTML. The deployed container's `process.env` is never re-consulted. v0.14.0 shipped this exact bug on `/welcome` (an early PR) — the round-1 fix added server-side resolution, the deploy succeeded, the bug was unchanged; round-2 added `force-dynamic` and the URLs finally rendered correctly. **Audit complete (2026-06-01):** grepped `process.env\.` across `app/**/page.tsx` + `layout.tsx` + `route.ts` + `robots.ts` + `sitemap.ts` — every env-reading server component has the directive. **Discipline going forward (canonical rule in [`docs/GUIDELINES.md §10`](./GUIDELINES.md#10-frontend--design-system)): any server component reading deploy-time env vars must opt out of static rendering, OR the Dockerfile must pass real env at build time.** | `apps/web/app/**/page.tsx`, `deploy/Dockerfile` | audit clean (v1.0.x) |
| **e2e CI gate gives false confidence for onboarding-surface PRs.** The deployed-brain e2e job ran on an early PR (v0.14.0) and missed three user-visible bugs on the freshly-added `/welcome` page (early PRs). Reasons: (a) no unauthenticated path coverage (the suite asserts signed-in behavior only); (b) no URL-vs-env assertion (install snippets are environment-specific, and a localhost-style URL slips past tests that hit a brain where `:3100` is real); (c) `e2e-please` label gates the run, the release PR didn't carry it. The fix sketch is open at [#1](https://github.com/bejranonda/ExternalBrain/issues/1): add an `onboarding-surface` paths-filter label that auto-applies + makes e2e mandatory + adds anon-walkthrough tests + asserts rendered URLs match `BRAIN_*_PUBLIC_HOSTNAME`. The `apps/web/e2e/welcome-public-urls.spec.ts` regression test shipped in v0.14.3 is the first installment of the anon-walkthrough net. **Closed (v1.3.0, [#1]):** the `onboarding-e2e` workflow builds + boots the app and runs the anon specs (`welcome-public-urls` incl. the URL-vs-env assertion, `healthz`) as a **required check**, path-gated on the onboarding/unauth surfaces — opt-out by path, not opt-in by label. **Authed installment closed (v1.4.x, [#52]):** the `authed-e2e` workflow signs in against the seeded fixture and runs the signed-in suite as a second required gate; its 12-iteration rollout itself surfaced real defects (vocabulary-drifted specs, a 0-byte demo download, the 429 rate-limit-under-test-burst class — see GUIDELINES §4). **Reopened in part (2026-08-05, §0r):** both workflows enumerate their specs by name, and those lists have drifted — **20 of 31 specs run in neither**, including `a11y`, `responsive`, `i18n` and `tokens`. The *gates* exist and are required; what is not true is that the suite behind them is complete. A spec existing in `apps/web/e2e/` is not evidence that it gates anything. | `.github/workflows/{onboarding,authed}-e2e.yml`, `apps/web/e2e/` | partially reopened — see §0r |

| ~~**`/` and `/start` shipped with no visual hierarchy — every section header used the identical tiny gray label.**~~ **Fixed (v2.15.0).** The operator loaded both live pages and called it directly: dense, monotone, no separation. Root cause: both pages were built reusing the app's information-density dialect (a 13px `--ink-4` "eyebrow" label, correct for a settings-panel subhead) as the *only* heading treatment on pages whose job is persuasion — every section, from the cornerstone feature grid to the footer link list, read as equally (un)important, and neither page's CTAs used the app's own `--accent` color at all. The type scale used throughout (11.5–16px) was invented rather than drawn from `globals.css`'s actual `--text-xs/sm/base/lg/xl` (12/14/16/20/24) tokens. Fixed by giving real section headings 20px/600/full-contrast treatment (matching `/docs`'s own concept-page headings) with a small `--accent` tick borrowed from the nav's existing "active" idiom, applying `.btn-primary` to the actual primary CTAs, and using unequal section spacing so gaps signal importance. Also surfaced the page had never been opened in a browser before being called done — see `APPROACH.md §2.6d`. | `apps/web/components/brain/landing.tsx`, `apps/web/components/brain/start-flow.tsx` | fixed (v2.15.0) |
| ~~**`var(--bg-2)` on `/start` silently rendered two elements with no background.**~~ **Fixed (v2.15.0).** Found while cross-referencing the hierarchy fix above against `globals.css`'s real token list — `--bg-2` is not declared anywhere in the stylesheet. `var()` against an undefined custom property with no fallback resolves to `unset`, which produced no error, no type-check failure, and no lint hit; the voucher input and the agent-prompt box on `/start` had no fill since #224 shipped. Nothing in this stack's toolchain can catch this class mechanically — TypeScript has no model of the CSS custom-property namespace, and a "page renders" smoke test passes regardless of a missing background. The mitigation is procedural: `grep` the token against `globals.css` before writing `var(--name)`. Full incident and the generalized rule at `KNOWLEDGE.md §12.32`. | `apps/web/components/brain/start-flow.tsx` | fixed (v2.15.0) |
| ~~**`/`'s "Quick start" link sent visitors to the self-hosting operator guide, not a quick start.**~~ **Fixed (v2.15.0).** Operator asked where quick-start/tutorial content was, since it wasn't easy to find — investigating found the link wasn't merely buried, it was wrong: `landing.tsx` pointed "Quick start" at `docs/QUICKSTART.md` on GitHub, which is written for someone self-hosting a *new* instance (Docker Engine, `.env`, an LLM provider key) — of no use to a visitor on an existing deployment, and an external, unstyled, unlocalized context switch besides. Repointed to `/welcome`, the actual in-app quick-start (pick your AI tool → copy the install command → watch for your first session), which is already public and already localized — no sign-in required to view it. "Tutorials" was already audience-correct (`docs/tutorials/README.md`'s own header: *"someone who's been given a Brain URL and a token"*) but remains an external GitHub jump; no in-app tutorial renderer exists yet to fix that properly. | `apps/web/components/brain/landing.tsx` | fixed (v2.15.0) |
| ~~**Anonymous visitors have no way to switch theme.**~~ **Fixed (2026-08-15).** New `ThemeToggle` (`components/brain/theme-toggle.tsx`) rendered inside `<LocalePicker>`'s existing fixed pill. Two choices worth keeping: (1) it drives `useTweaks()` rather than writing `data-theme` itself, so the anon choice persists to the same `bp_tweaks` key the authed panel reads and survives sign-in — a bespoke writer would have produced a theme that silently reset on login; (2) it lives *inside* the locale pill instead of being a second fixed element, which avoids hard-coding one control's width into the other's `right` offset and reached all **eight** unauth surfaces carrying `<LocalePicker>` (not the five this row originally named) with zero page edits. The outer element's `aria-label` moved from "Language" to "Display settings" with the language buttons keeping their own nested group. | `apps/web/components/brain/theme-toggle.tsx`, `locale-picker.tsx` | done |
| **A module header can assert a capability the types never permitted, and nothing detects it.** `packages/core/src/org.ts` opened with "Every function accepts a `db` client as the first argument so callers … can supply a transaction client or a mock" — a design rule stated as accomplished fact. All 19 functions took `db: PrismaClient`, and Prisma's `TransactionClient` is `Omit<PrismaClient, ITXClientDenyList>`, so it is not structurally assignable; passing one had never compiled and no caller had ever tried. Reviewers trust the docstring, CI is silent because nothing violates a type, and the cost lands on whoever first *needs* the capability — here `/api/onboard/claim`, whose voucher-burn and token-mint must share a transaction. **Partially fixed (v2.15.0):** a `DbClient` union plus a `canOpenTransaction()` guard now makes `ensurePersonalOrg` and `ensureDefaultProject` genuinely transaction-safe, and the header was rewritten to name *which two* functions qualify instead of claiming all of them. The other 17 still require a full client. **Instance now type-enforced (2026-08-15):** `org.test.ts` carries compile-time assertions that `Prisma.TransactionClient` satisfies the first parameter of both named functions, so narrowing either back to `PrismaClient` makes the header a lie *and* fails `pnpm turbo run typecheck` — instead of waiting for the next caller who genuinely needs a transaction. Verified non-vacuous by narrowing `ensurePersonalOrg` and confirming `error TS2322` at the assertion line, then restoring. **The class stays open:** no check exists that a capability claimed in prose has a caller exercising it — detecting lying comments in general is not mechanically tractable, so this remains a review habit. Grep for confident header comments in `packages/core/src/*.ts` when you touch them. | `packages/core/src/org.ts`, `docs/APPROACH.md §2.6c` | class open; instance fixed (v2.15.0) |

### Structural backlog (open enhancement issues)

| Issue | Where | Status |
|---|---|---|
| ~~**`/signin` onboarding gap** — credentials-only prod offers no self-service signup path.~~ **Structurally resolved (v2.15.0).** The unresolved decision was "self-service voucher request flow vs OAuth-on-prod vs operator-email link"; the answer turned out to be none of the three. A public `/start` is now the one canonical URL a voucher holder is given, offering exactly two paths (let the agent do it, or sign up in a browser) and prefilling from `?voucher=`. Every voucher error on `/signin` links to it — previously six error strings all terminated in "ask your admin" with no URL, on the page's highest-frequency failure path. | `apps/web/app/start/page.tsx`, `apps/web/components/brain/start-flow.tsx`, `apps/web/app/signin/page.tsx` | done (v2.15.0) |
| ~~**`/welcome` has two jobs and only one of them is still its own.**~~ **Resolved (v2.15.0).** Stripped to the part nothing else does — the live first-session poll with the 90s/5min stuck-state diagnostics. Steps 1–2 (pick a tool, copy an install command) removed; `/welcome` now links out to `/docs/tutorials/00-quick-start` for anyone who hasn't installed. Found on the way: the deleted tool picker had a live bug (`welcome.tool_blurb.generic` rendering as a raw string in all three locales, from an id/key mismatch between the tool list and the dictionary) — the consolidation fixed a real defect, not just a duplication. Every other surface pointing at `/welcome` as an install flow was found by grepping the href and repointed: `landing.tsx`'s "Quick start" card, the empty-Brain dashboard callout's primary CTA, and `/start`'s "See the guided tour" link (reworded to describe what it now leads to). | `apps/web/components/brain/welcome-flow.tsx`, `apps/web/app/welcome/page.tsx` | done (v2.15.0) |
| ~~**`e2e/welcome-public-urls.spec.ts` lost its only anon-surface MCP-URL assertion, with no replacement.**~~ **Fixed (2026-08-15)** by taking the entry's own "fix sketch" — with a correction from CodeRabbit review. `/api/onboard/agent.md` (public, unauthenticated, non-flag-gated, `force-dynamic`) resolves a real WEB host, but its template never embeds `{{MCP_URL}}` — the first version of this fix asserted an MCP-host check there and it would have passed only vacuously. The genuine MCP-URL coverage comes from a second anon spec against `/api/skills/brain`, whose template does embed `{{MCP_URL}}` (confirmed live: `curl .../api/skills/brain` contains the real `mcp.<host>`). Asserting on a markdown endpoint rather than a page is deliberate — the #293 class is "a URL was built from the wrong source", which has nothing to do with rendering, and scoping the original test to a *page* is precisely why it died when that page's content moved (`GUIDELINES §4`, verify the property not the nearest signal). **The first draft of this test would have shipped red:** it asserted `E2E_EXPECTED_MCP_HOST`, but that document embeds only webUrl-derived links — the MCP URL comes back from `/api/onboard/claim` at runtime and is never baked into it. Caught by checking the assertion against a live deployment before committing, not by CI. Now asserts the web host via a new `E2E_EXPECTED_WEB_HOST`, plus a non-vacuous anchor and a no-unsubstituted-placeholder guard. Confirmed the spec is on `onboarding-e2e.yml`'s explicit file list, per `GUIDELINES §4`'s "a spec existing is not a spec running" rule. | `apps/web/e2e/welcome-public-urls.spec.ts`, `.github/workflows/onboarding-e2e.yml` | done |
| ~~**The onboarding explanation surface is now ~19 documents and still has no single generator.**~~ **Reduced by deletion (2026-08-13).** The duplication that could actually go stale silently — a hand-authored `quick-start.html` and three exported PDFs (EN/TH/DE), last built 2026-08-08 — is gone, along with the two README rows linking them. They had no generator, nothing regenerated them across four quick-start rewrites in the following week, and a printed handout carrying a September-stale command produces a failure the user blames on the product. Deleting beat generating: the operator confirmed the PDFs were no longer needed, and the in-app tutorials plus `/start` already cover every audience the handouts did. The *remaining* copies (`docs/tutorials/00-quick-start.{md,th.md,de.md}`, `/welcome`, `/docs`, the agent bootstrap doc) are all live-rendered from source, so they cannot drift the way a checked-in PDF can, and `install-command-single-source.test.ts` still guards the install command itself. | `docs/assets/handouts/` (removed), `README.md`, `docs/README.md` | done |
| **`/start?voucher=` is attacker-supplied text that ends up in a prompt a human pastes into an AI agent.** Found in review of the landing/onboarding PR. The page renders the code inside an instruction block the user is explicitly told to hand to an agent, so a crafted link (`/start?voucher=<prose>`) is a prompt-injection delivery vector — React escapes markup, but nothing escapes natural language aimed at a model. **Mitigated (v2.15.0)** by `sanitizeVoucherInput()`: input is reduced to `[A-Z0-9-]` and capped at 32 chars before it can reach the prompt or the input box, which removes whitespace, newlines, punctuation and shell metacharacters — no multi-word instruction, command, or extra prompt line can be formed. **Residual, stated rather than papered over:** the letters survive and collapse into one long token, so this is a structural defence, not a proof that no model could read meaning into the residue. A strict format match (`PREFIX-XXXX-XXXX`) would close it fully but was rejected — `POST /api/admin/vouchers` accepts an operator-supplied `body.code`, so codes are not guaranteed to fit the generated shape and rejecting on format would break legitimate custom codes. Revisit if custom codes are ever dropped. | `apps/web/lib/brain/agentic-onboarding.ts`, `apps/web/components/brain/start-flow.tsx` | mitigated, residual accepted |
| **A bootstrap token's raw bearer necessarily lands in the agent's transcript.** `POST /api/onboard/claim` returns `installCommand` with the secret inline, the agent prints it to run it, and the harness writes that to its own session log (`~/.claude/projects/*.jsonl` for Claude Code) — which is also sent to a model provider. This is not specific to agentic onboarding; the existing token wizard has the same property the moment a user pastes into a terminal. **Accepted, with mitigations rather than a fix:** the token is capped at 14 days, omits the billed `oracle` capability, and the response tells the user to mint a proper token at `/settings/tokens` once they have web access. A true fix needs a one-time-use exchange code the installer redeems out-of-band, which is more machinery than a 14-day token justifies today. | `apps/web/app/api/onboard/claim/route.ts` | accepted |
| ~~**Language picker only renders behind sign-in.**~~ **Fixed (v1.3.0, [#3]).** A root-level `<LangProvider>` now wraps every surface; its initial locale is resolved **server-side** from a new `bp_lang` cookie (so SSR and first client render agree — no #418), and a `<LocalePicker>` (EN / ไทย / DE) renders on every unauth surface. Follow-up [#36] aligned the `<html lang>` pre-hydrate script with the cookie. | `apps/web/components/brain/lang-provider.tsx`, `locale-picker.tsx`, `app/layout.tsx`, `lib/brain/tweaks.ts` | done (v1.3.0) |
| ~~**`/welcome` "60 seconds" promise has no stuck-state diagnostic.**~~ **Shipped v1.0.1.** Two escalation tiers: at 90 s the pulse dot turns amber and copy switches to "Still nothing after N min — your install likely didn't take"; at 5 min a dashed-border troubleshooting block surfaces with the top three causes (token, MCP host, client tool-list cache). | `apps/web/components/brain/welcome-flow.tsx` | done |
| ~~**`/robots.txt` and `/sitemap.xml` return the generic HTML 404.**~~ **Shipped v1.0.1.** `app/robots.ts` defaults to `Disallow: /` (invite-only posture); `BRAIN_ROBOTS_DISALLOW_ALL=false` flips it. `app/sitemap.ts` lists only unauth surfaces (/, /welcome, /signin, /forgot-password) — auth routes intentionally absent. Both opt out of static rendering per GUIDELINES §10. | `apps/web/app/robots.ts`, `apps/web/app/sitemap.ts` | done |
| ~~**`mcp.<host>/` bare root returns 9-byte nginx 404.**~~ **Shipped v1.0.1.** `apps/mcp-server/src/index.ts` GET / now returns a no-auth JSON landing with `endpoints.mcp` (auth-gated), `endpoints.health`, and deep links to the webapp's `/docs` + `/welcome` (built from `BRAIN_PUBLIC_HOSTNAME`, piped through to the mcp-server container in v1.0.3). | `apps/mcp-server/src/index.ts` | done |
| ~~**Icon-rail sidebar (Phase R) — pro UX, not beginner UX.**~~ **Shipped (v1.3.0, [#4]).** Labels-by-default (option B): the rail reserves its expanded width so content sits beside it (Linear/Notion model); a footer toggle collapses to icon-only with hover-peek for users who prefer density. Mount-gated via `useTweaks` so the collapsed class can't trigger #418. | `apps/web/components/brain/shell.tsx`, `app/globals.css`, `lib/brain/tweaks.ts` | done (v1.3.0) |
| **`cookies()` in the root layout opts the whole app out of static rendering.** The #3 locale fix reads the `bp_lang` cookie in `app/layout.tsx`, which forces request-time rendering for *every* route — including the `docs/concepts/[slug]` pages that have `generateStaticParams` and were previously static. Build is unaffected; this is a caching/latency tradeoff on the most cacheable public surface. **Accepted** for a self-hosted single-VM instance (low docs traffic); the alternative is scoping the cookie read to a nested layout so the docs tree keeps pre-rendering. **Update (#59):** the `/docs` body is now deliberately **client-rendered** (`useLang()`) so the locale picker switches it in place — so even a route-group refactor would no longer make the docs body static HTML; the tradeoff is now intrinsic to the localized-docs design, not just the root cookie read. | `apps/web/app/layout.tsx`, `apps/web/app/docs/concepts/[slug]/page.tsx` | accepted — deferred perf tradeoff ([#45](https://github.com/bejranonda/ExternalBrain/issues/45) closed not-planned; reopen if docs traffic warrants the route-group refactor) |
| ~~**Dashboard React hydration mismatch (`#418`) on authenticated shell load.**~~ **Fixed (2026-06-05).** Root cause: `ShowEverythingFold` (`dashboard.tsx`) and the Teach examples accordion (`teach.tsx`) initialized `useState` by reading `localStorage` *during render* — the server rendered the default state, the client's first render read the persisted value, and the two diverged once a stored value existed (so it only fired after you'd toggled the fold). Fix: initialize to the SSR default and restore the persisted state in a `useEffect` after mount — the pattern `autoskill.tsx` already used. | `apps/web/components/brain/dashboard.tsx`, `teach.tsx` | done |
| ~~**Residual React `#418` — env tag (every app load) + `/welcome` install snippet.**~~ **Fixed (2026-06-07)** via a first-time-user review on an isolated stack. Two more *render-time client-global reads* (same class as the `localStorage` one above): (a) `useEnvLabel()` (`shell.tsx`) read `window.location.hostname` in a `useMemo`, so the rail env-tag `<div>` was absent on the server (null) but present on the client — a structural mismatch that fired on **every** app-shell load, including prod; (b) `/welcome`'s install snippet read `window`/`navigator` (`fallbackWebUrl`/`detectOs`) during render, emitting `localhost:3000` on SSR but `window.location.host` on the client — a text mismatch whenever `BRAIN_*_PUBLIC_HOSTNAME` is unset. Fix: mount-gate both (SSR-safe default → read the client value in `useEffect`). Verified via JS-off vs JS-on DOM diff + Playwright console capture (0 `#418` after). **Lesson:** any `window`/`navigator`/`Date`/`Math.random` read reachable from render must be mount-gated; grep for `typeof window`/`typeof navigator` in render paths. | `apps/web/components/brain/shell.tsx`, `welcome-flow.tsx` | done |
| ~~**Rail-footer version label always showed `dev` (version feature shipped broken in v1.2.0).**~~ **Fixed (2026-06-07).** The single-server `docker-compose.yml` rewrite (PR #26) dropped the `web.build.args.APP_VERSION` block that PR #23 added, so the `APP_VERSION` build-arg never reached the Dockerfile and `NEXT_PUBLIC_APP_VERSION` defaulted to `dev`. Caught by the first-time-user review (footer read `dev` on a `v1.2.0` build). Fix: restore the `args:` block. **Lesson:** a full-file rewrite of a config silently drops blocks the linter/CI won't catch — diff against the prior file, or have a smoke check assert the rendered version. | `deploy/docker-compose.yml` | done |
| ~~**Dev-auth + empty DB → `/` ↔ `/signin` infinite redirect loop.**~~ **Fixed (2026-06-07).** With `ALLOW_DEV_AUTH=true` and no real auth, the shim resolves the dev user as "the first User row". On an empty DB (a plausible local/VPN first-run): `/` can't resolve a user → redirects to `/signin`; `/signin`'s dev-shim branch redirects straight back to `/` → loop. Fix: `/signin` now checks `db.user.count()` first — hands off to `/` only when a user exists, otherwise renders a bootstrap notice (seed the DB / set `DEV_USER_ID` / configure real auth). Verified: `/signin` returns 200, `/`→`/signin` settles in one hop. | `apps/web/app/signin/page.tsx` | done |
| ~~**README/QUICKSTART localhost quickstart broke when `deploy.sh` became server-only.**~~ **Fixed (2026-06-07).** The single-server merge (PR #26) turned `deploy.sh` into the TLS server deploy (requires `BRAIN_*_PUBLIC_HOSTNAME`, `CADDY_EMAIL`, real auth; refuses `ALLOW_DEV_AUTH=true`) — but README/QUICKSTART/AGENTS still told newcomers `cp .env.example .env && ./scripts/deploy.sh`, which now dies in preflight, and a bare `compose up` skips migrations. Fix: resurrected the pre-#26 dev flow as `scripts/dev-up.sh` (build → migrate → FTS → seed → up → lockdown warn) and repointed all local-dev docs at it. **Validated end-to-end (2026-06-07):** a fresh clone + `cp .env.example .env` + `./scripts/dev-up.sh` under an isolated compose project built/migrated/seeded/served cleanly — `healthz`+`readyz` 200, app resolved the seeded project, MCP gated 401 without Bearer, lockdown audit PASS. **Lesson:** doc sweeps that grep for *removed names* miss *changed semantics* — when a command keeps its name but changes meaning, search docs for the command name too. (The first sweep, PR #29, itself missed HOW_IT_WORKS/SECURITY/ARCHITECTURE/GUIDELINES/APPROACH local-context refs — a name-grep over **all** docs in a follow-up caught them.) | `scripts/dev-up.sh`, `README.md`, `docs/QUICKSTART.md`, `AGENTS.md`, `docs/CONTRIBUTING.md`, `docs/HOW_IT_WORKS.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/GUIDELINES.md` | done |

### Worked example: why static-rendering bites a server-injected env var

The v0.14.0 → v0.14.2 sequence is the canonical retro:

1. **v0.14.0 (an early PR)** shipped `/welcome` with `resolveMcpUrl()` constructing the
   MCP URL client-side as `${window.location.hostname}:3100/mcp`. Works on
   localhost (port 3100 is real). Broken on any host where MCP is on a
   different subdomain — the canonical prod topology.
2. **v0.14.1 (an early PR)** added server-side resolution: `app/welcome/page.tsx`
   reads `BRAIN_MCP_PUBLIC_HOSTNAME` from `process.env` and passes the
   resolved URL as a prop to `WelcomeFlow`. CI green. Deploy succeeded.
   **Bug was unchanged.**
3. **v0.14.2 (an early PR)** added `export const dynamic = "force-dynamic"`. Bug
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

**Positioning leans on structural claims, not an efficacy claim.** The product's
differentiation — *shared across every MCP tool, inspectable/editable, and
self-hosted/owned* (README §Why) — is structurally verifiable: it's how the
system is built, not a performance promise. The stronger claim that the Brain
*measurably improves* AI coding output remains **unproven by a published number**
for the end-to-end claim — the generation-uplift benchmark (#126) has not run.
**The retrieval layer, however, now has a published number (2026-07-06,
`docs/VALIDATION.md`): KRA NDCG@5 0.4514 vs cosine 0.3036 (+0.1478) on a real
telemetry-labeled fixture.** Keep copy anchored on the structural
differentiators plus the retrieval delta where relevant; don't extend it to
an output-quality claim until #126 backs that too.

**The GitHub repo About + topics aren't in the repo.** They're set via `gh repo
edit` and render on the GitHub repo page and in search results, but they're not
version-controlled — so they can drift from the README positioning **silently**
(no diff, no CI to catch it). Re-sync them whenever the README hook or §Why
changes; the canonical surface list is in `GUIDELINES.md` (problem-framing
discipline).

**Discoverability is optimised by best-practice, not measured.** The README H1,
GitHub About, and topics are kept keyword-rich (`GUIDELINES.md` SEO / discoverability
discipline), but no analytics tie any of it to stars, clones, or search traffic —
it's optimisation by convention, not by data. Same honesty posture as the
unproven-efficacy caveat above: real where it's structural (the terms are
accurate), unproven where it's a performance claim (that they drive reach).

---

## 0e. v1.5.0 flywheel close-out (2026-06-11 → 2026-06-12)

| Issue | Where | Status |
|---|---|---|
| ~~**Agent-session retrieval was a dead path — knowledge flowed in but was never read back.**~~ **Resolved (v1.5.0, [#64]).** Production telemetry showed coding agents essentially never called `brain_retrieve_knowledge`, so the injection→feedback loop (`SessionKnowledgeApplication` → report step 3b success-rate updates) was wired but starved — zero inflow for weeks. Fix mirrors close-capture: `brain_start_session(prompt)` now runs the KRA query in the same round-trip, returns `relevantKnowledge { knowledgeIds, injection }`, and records the injection; retrieval happens at the one touchpoint every client reliably hits instead of relying on agents remembering a second call. Fail-soft: a retrieval error logs `start.inject_failed` and the session still opens (keyless CI proves the path). Complemented by the ask-back `hint` on learning-less closes ([#66]) and the AGENTS.md brain-protocol house rule ([#68]). **Caveat for future diagnosis:** the original "0% of knowledge ever retrieved" reading was a measurement artifact (summed `usageCount`/`successCount`, which `/api/knowledge` doesn't serialize — it exposes `uses`/`success`); the corrected baseline was 57% usage via Oracle citations, and only the agent-session path was truly dead. See `docs/APPROACH.md §5ao`. | `apps/mcp-server/src/tools/start-session.ts`, `apps/mcp-server/src/tools/report.ts`, `packages/core/src/kra.ts` | done (v1.5.0) |
| **MCP clients cache tool catalogs + instructions per connection.** Sessions opened before the inject-at-open deploy keep the old `brain_start_session` description (no `prompt` guidance) until the client reconnects — same class as the §0b tool-catalog row. Transient; restart the editor or `/mcp` → reconnect. | client-side | no fix needed |

---

## 0f. Self-service onboarding (2026-06-17)

| Issue | Where | Status |
|---|---|---|
| ~~**No self-service registration — new users could not create an account.**~~ **Resolved.** `/signin` only offered invite acceptance or voucher-gated GitHub OAuth; there was no email+password self-service path, so a Credentials-mode pilot was effectively invite-only. Added `POST /api/auth/register` + a `/signin?mode=register` form. Posture is governed by the existing `REGISTRATION_REQUIRES_VOUCHER` flag (default `true`), which now gates *both* the OAuth and email paths — a single secure-by-default knob. Voucher is validated before the email-exists check so the endpoint can't be used to enumerate accounts. | `apps/web/app/api/auth/register/route.ts`, `apps/web/app/signin/page.tsx`, `apps/web/auth.ts` | done |
| ~~**No way to create an organization, and `/settings/org` hard-blocked zero-org users with "Admins only".**~~ **Resolved.** There was no org-creation API or UI; every user got exactly one auto-provisioned personal org and could make no others. A user who ended up with zero *manageable* orgs (dev-shim, or a silently-swallowed sign-in bootstrap failure at `auth.ts`) hit a dead-end "Admins only" panel with no path forward. Added `createOrg` (core) + `POST /api/orgs` + a "New organization" affordance, and replaced the dead-end with a "Create your first organization" form. Any user can now own multiple orgs. | `packages/core/src/org.ts`, `apps/web/app/api/orgs/route.ts`, `apps/web/app/settings/org/page.tsx` | done |
| **Self-service email registration requires the Credentials provider.** `POST /api/auth/register` returns `403 registration_unavailable` when `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` aren't set — an email+password account can only sign in through that provider, so without it the route refuses rather than create a stranded account. OAuth-only deployments should onboard via the voucher-gated GitHub path instead. | `apps/web/app/api/auth/register/route.ts` | by design |
| ~~**`deploy-backup-1` unhealthy for weeks.**~~ **Fixed v1.11.1 (2026-07-02).** The earlier diagnosis here was wrong on two counts: `deploy-backup-1` is the **main on-host `pg_dump` `backup` service**, not the rclone off-host sidecar (that is the separate opt-in `backup-replicate` profile), and on-host backups were **not** "running normally" — they had failed **every night since the pg16 upgrade**. Root cause: the backup image was pinned to `postgres-backup-local:15` (pg_dump 15.14) while `db` is `pgvector/pgvector:pg16` (server 16.13); `pg_dump` refuses to dump a newer-major server, exiting 1 silently at the 3am cron (the health probe reported the failed run as 503). Fix: bump the backup image to `:16` + record the "majors must match" invariant (`docs/GUIDELINES.md §3 invariant 15`). **Lesson:** a `docker compose ps` `(unhealthy)` on a backup sidecar deserves a `docker logs` before a plausible-but-unverified root cause is written down. ~~Follow-up worth doing: have `GET /api/admin/backup-status` / the health probe alert when the last successful dump ages out.~~ **Shipped v1.14.0:** the endpoint now stats the newest dump under `/data/backups/last` and warns past `BACKUP_DUMP_MAX_AGE` (default 26 h); an existing-but-empty dumps dir counts as the failure state; the admin card leads with the dump line. The alarm watches the **artifact's freshness, not the process's health** — process signals were all green or unseen throughout the original incident. | `deploy/docker-compose.yml` | done (v1.11.1) |

---

## 0g. Multi-client MCP onboarding — Antigravity + GitHub Copilot (2026-06-19, v1.7.0)

| Issue | Where | Status |
|---|---|---|
| **A wrong-shaped config is silently ignored — each client keys its remote server differently.** Antigravity uses `mcpServers` + **`serverUrl`** (a `url` key is dropped); Copilot VS Code uses `servers` + `headers`; Copilot JetBrains/Visual Studio/Eclipse/Xcode use `servers` + **`requestInit.headers`** (a top-level `headers` is dropped); Copilot CLI uses `mcpServers` + `headers`. The token install wizard emits the correct shape per client, so use it rather than hand-editing. (Severity: low; user error. Workaround: copy from `/settings/tokens` wizard or the matrix in `docs/CLIENTS.md`.) | `packages/core/src/install-snippets.ts`, `docs/CLIENTS.md` | mitigated by wizard |
| **Antigravity / Copilot may attempt OAuth discovery on a `401` instead of sending the configured static bearer.** Both clients have shipped bugs (antigravity-cli #25, copilot-cli #3100) where an HTTP MCP server's `401` triggers a `/.well-known/oauth-*` discovery flow rather than falling back to the configured header. The Brain uses a **static bearer** and advertises no OAuth metadata, so a statically-configured `headers`/`requestInit.headers` entry is sent on every request including `initialize` — the supported path. If a client is observed probing `/.well-known/oauth-protected-resource` against `/mcp`, re-check that the header is actually present in its config. (Severity: low; client-side, config-dependent.) | client-side; `docs/CLIENTS.md` static-bearer note | client-side; documented |
| **Copilot cloud coding agent can't reach a self-hosted Brain on a private network.** Unlike the editor/CLI surfaces, the coding agent runs in GitHub's cloud and is configured in repo **Settings → Copilot → Coding agent** (not a local file), with the token stored as a `COPILOT_MCP_*` secret. It only works against an **internet-reachable** Brain — a localhost or LAN-only deploy will fail. Documented-only; not a wizard entry. | repo Settings UI; `docs/CLIENTS.md` | by design |

---

## 0h. Vibe-coding reconstruction guide — `REBUILD/` (2026-06-20)

The `REBUILD/` folder at the repo root is the canonical resource for recreating
External Brain from scratch on a new machine using AI-assisted (vibe) coding.
It supersedes the earlier monolithic `RECREATE_EXTERNAL_BRAIN.md`.

| Issue | Where | Status |
|---|---|---|
| **Two client config shapes are silent-failure traps.** Antigravity uses `serverUrl` (not `url`); GitHub Copilot JetBrains uses `requestInit.headers` (not `headers`). Paste the wrong key and the client connects with zero error messages. The unit tests in `@brain/core` pin both shapes — any rebuild must include those tests. | `REBUILD/02-core-intelligence.md §2.16`, `packages/core/src/__tests__/install-snippets.test.ts` | tested + documented |
| **pg-boss v12 schema floor.** A fresh install gets schema v25+. A DB migrated from pg-boss v10 sits at v24; `boss.start()` crashes. The `scripts/pgboss-version-check.sh` script (spec'd in `REBUILD/04-worker.md §4.5`) exits non-zero on sub-v25 schemas and must run before the worker starts. | `REBUILD/04-worker.md`, `scripts/pgboss-version-check.sh` | documented; script to be included in rebuild |
| **`SKIP_DB_INIT=1` required during `next build`.** The Prisma engine initialises on `import` in a Next.js build context unless `SKIP_DB_INIT=1` is set. Omitting it causes the build to fail or silently use the wrong client. Set it as a build-time env in both the Dockerfile and CI. | `REBUILD/06-deploy-ci.md §6.2`, `deploy/Dockerfile` | documented |
| **Seed password hash placeholder.** `REBUILD/01-foundation.md` includes a placeholder bcrypt hash in the seed file. A builder must generate a real hash with `pnpm hash-admin-password '<pw>'` and replace it before testing sign-in. | `REBUILD/01-foundation.md §5.6`, `scripts/hash-admin-password.ts` | documented |
| **`--accent` vs `--accent-text` contrast invariant.** `--accent` is brand fill (e.g. lime `#D8FF3E`), never safe as foreground text. Always use `--accent-text` for text color. Rebuilders who copy raw color values from the theme system will introduce WCAG failures that pass visual inspection on a dark monitor but fail on light themes. | `REBUILD/05-web-app.md §5.3`, `apps/web/src/app/globals.css` | documented |

---

## 0i. Autoskill LLM classifier rollout (v1.10.0 → v1.10.3, 2026-06-24)

The keyword `routeSignal` type-decision graduated to an LLM classifier
(`packages/core/src/autoskill-classifier.ts`; see `KNOWLEDGE.md §5.8`,
`GUIDELINES.md §3.14/§4`, `APPROACH.md §4.7`). Items from the rollout:

| Issue | Where | Status |
|---|---|---|
| ~~**Classifier vars not forwarded to the worker container.**~~ **Fixed (v1.10.2).** The classifier reads `process.env.AUTOSKILL_*`, but the worker's explicit `environment:` allowlist didn't list them — so `AUTOSKILL_LLM_CLASSIFIER` / `AUTOSKILL_SHADOW` set in `.env` were silently ignored and the feature was un-toggleable in prod. Now passed through with code-matching defaults; codified as the §3.14 env-passthrough invariant. | `deploy/docker-compose.yml` | done |
| **Live flag off; shadow validation pending real traffic.** The classifier ships **default off**. `AUTOSKILL_SHADOW=true` is enabled on the live worker to log `autoskill.classify.shadow { heuristic, llm, agree }`; promote to `AUTOSKILL_LLM_CLASSIFIER=true` only after the agreement rate looks right on real sessions. Operator-gated (`docker compose logs -f worker \| grep classify.shadow`). | `.env` (operator) | awaiting agreement data |
| **Few-shot ranks by recency, not cosine (v1 deferral).** The user-derived few-shot (resolved proposals + recent knowledge) is ranked by recency within `AUTOSKILL_FEWSHOT_TOKEN_BUDGET`; cosine-relevance over the user's nearest knowledge is a fast-follow once the recency baseline is observed in shadow. | `packages/core/src/autoskill-classifier.ts` | deferred (fast-follow) |

---

## 0j. Flywheel repair Stage 1 — project-identity drift (2026-07-02)

The flywheel-repair program (spec:
`docs/superpowers/specs/2026-07-02-flywheel-repair-design.md`) opened with a
diagnosis pass on the platform's own dogfood Brain. Items:

| Issue | Where | Status |
|---|---|---|
| ~~**Free-text `projectName` silently spawns duplicate project identities.**~~ **Prevented (v1.12.0).** `brain_start_session(projectName)` / `brain_create_project` matched names only case-insensitively with trim, so agent-supplied drift like "BrainPlatform" vs "Brain Platform" created sibling projects — and project-scoped retrieval can't see knowledge filed under a sibling, silently starving injection. (The dogfood Brain accumulated **three** identities for one repo over 7 weeks before anyone looked at the project list.) `ensureNamedProject` now matches by aggressive normalization (lowercase, all non-alphanumerics stripped; all-punctuation names never match each other). | `packages/core/src/org.ts` | done (v1.12.0) |
| **Existing fragmentation needs an operator-run merge.** `scripts/merge-duplicate-projects.sql` repairs pre-existing duplicates: dry-run by default, `-v apply=1` mutates in one transaction holding `SHARE ROW EXCLUSIVE` locks (in-DB write freeze; `MCPToken.projectId` is `onDelete: Cascade`, so an unfrozen merge could silently delete a mid-window token), `-v merge_from/-v merge_into` for genuinely differently-named merges. Requires a verified backup + explicit operator authorization (bulk `deploy_*` mutation). Validated end-to-end against a seeded postgres:16 fixture incl. `PeerCard` unique-collision handling and idempotent re-run. **Executed against prod 2026-07-05** (operator-authorized): 14 knowledge rows, 6 sessions, 7 audit logs consolidated onto one identity; post-merge verification all zeros; `brain_list_projects` confirms a single project for the repo. | `scripts/merge-duplicate-projects.sql` | done (2026-07-05) |
| ~~**Flywheel Stage-3 gate reading due 2026-07-17.**~~ **Done (2026-07-21/23, [#149](https://github.com/bejranonda/ExternalBrain/issues/149)).** Official rolling-14-day reading (2026-07-07→07-21, the first window entirely post-v1.13.0): 62.5% closed-with-learnings (gate ≥60%) and 75% injection→used (gate ≥40%) — both pass, though the per-project split shows the window is proven on this platform's own dogfooding (11/11 closed) and not yet on the 3 external repos where Brain-first was installed (still 0 sessions there). Operator chose to proceed on that evidence rather than wait. Stage 3 executed in order: (1) `MEMORY.md` shrunk to a bootstrap stub, with gaps found and backfilled into the Brain first so nothing was lost; (2) generation-uplift benchmark [#126](https://github.com/bejranonda/ExternalBrain/issues/126) — first read +33.3pp test pass-rate (control 4/6, treatment 6/6, n=6, 0 regressions), small-n and honestly caveated (`packages/core/generation-uplift/`); (3) KRA candidate pool widened 20→50 [#146](https://github.com/bejranonda/ExternalBrain/issues/146), shipped and deployed. Feature freeze lifted. | loop-health panel; #149; `packages/core/generation-uplift/` | done (2026-07-23) |
| **Aggregate "how is my Brain doing" questions have no surface.** The Oracle retrieves semantically and cannot count — asked for 30-day session/close/learning stats it returns zero sessions and defers to SQL. **Shipped (v1.13.0):** the loop-health panel (dashboard, behind the Show-everything fold) surfaces sessions closed-with-learnings, injection→used rate (accrues from v1.13.0 — `used_reported` SessionKnowledgeApplication rows), validation coverage, and a duplicate-project detector via `GET /api/dashboard/health`. The Oracle deliberately does not grow SQL-agent capabilities. | `apps/web/app/api/dashboard/health/route.ts`, `loop-health-card.tsx` | done (v1.13.0) |

---

## 0k. V2.0 meeting & document intelligence — dark launch (2026-07-07, v2.0.0)

V2.0 (spec: `docs/superpowers/specs/2026-07-07-brain-v2-meeting-doc-intelligence-design.md`)
shipped **dark**: the code is deployed but both flags default off, so runtime
behavior is v1.14-identical until the operator enables them.

| Issue | Where | Status |
|---|---|---|
| ~~**Flags off until the Stage-3 gate passes.**~~ **Enabled 2026-07-09 on the reference instance** (operator decision, spec §6.2 re-amendment): the §6.1 prod dry-run passed all six contract points and the mid-window gate preview read 87%/87% vs the 60%/40% thresholds ([#149](https://github.com/bejranonda/ExternalBrain/issues/149)). Compose/env defaults remain `false` — forks stay dark until they opt in (the flags also had to be added to the compose `environment:` allowlists; `.env` alone is ignored at runtime). Rollback: flip flags off + `./scripts/reload.sh mcp-server web`, or redeploy `v1.14.0` (whole range migration-free). The #149 gate still governs the Stage-3 flywheel actions (official reading 2026-07-17). | `packages/core/src/env.ts`, `deploy/docker-compose.yml`, `.env` | enabled (2026-07-09) |
| **Teach path is live regardless of flags.** `brain_teach_knowledge(type:"action_item")` works today — the protocols under `docs/protocols/` are usable now; the flags only gate the *surfacing* (injection + Oracle). Dry-running meeting-miner on real meetings before flag-enable is the intended validation. | `docs/protocols/meeting-miner.md` | by design |
| **Webapp renders `action_item` rows generically.** Knowledge lists show them as raw `chip k-action_item` (default styling) and the dashboard composition panel ignores unknown types (no crash, just uncounted). A task-aware presentation is deliberately deferred (spec §8: no new webapp surfaces in V2.0). | `apps/web/components/brain/dashboard.tsx` | accepted (deferred) |
| **Non-dev Oracle adoption is the untested bet.** Meeting outputs for scrum masters/stakeholders are consumed via the signed-in Oracle (operator decision: no email/push, ever). Extraction quality is dry-run-testable; whether non-devs actually *ask* is not — validate with a real stakeholder in the first week after flag-enable (spec §1 names this residual risk). | spec §1 goal 3 | open |
| **`brain_ask_oracle` (MCP) is project-context-free, so its OPEN TASKS block stays empty.** The MCP oracle tool calls `oracle.ask(userId, …)` without resolving a project, so even with `V2_ORACLE_TASKS` on, the deterministic task enumeration has no project to enumerate (surfaced during flag-enable validation 2026-07-09; a pre-existing tool limitation — the Brain already carried "validate project-bound knowledge via `brain_start_session`, not context-free oracle calls"). The spec's §4c surface — the **webapp** Oracle — has both the flag and project context and is unaffected. Fix candidate: resolve the caller's default project in `tools/oracle.ts` like `start-session.ts` does (changes semantic scoping of every MCP oracle answer — needs its own small design pass, not a drive-by). | `apps/mcp-server/src/tools/oracle.ts` | open (deferred) |
| **`for:` addressing uses the assignee's Brain account email**, which can differ from their work/external email (the operator's account is `admin@…local`, not the Gmail used in early fixtures). meeting-miner must map people to their Brain emails (webapp → Settings → members), lowercase. Surfaced by the first live addressed-injection test (2026-07-09). | `docs/protocols/meeting-miner.md` | fixed in protocol (v2.1.1) |

---

## 0l. Docs-hub integration audit (2026-07-08, v2.0.3)

Triggered by the tutorials review: audited how every manual/tutorial is reached
from the README, the docs indexes, and the deployed webapp's `/docs` hub.

| Issue | Where | Status |
|---|---|---|
| ~~**Webapp docs hub pointed at the pre-rename repo.**~~ 18 absolute GitHub URLs in the in-app `/docs` hub and the concepts registry (all three locales) still said `bejranonda/BrainPlatform` after the repo became `ExternalBrain` — every "browse full docs / tutorials / troubleshooting / file an issue" link in the deployed product 404'd. Class lesson: after a repo rename, grep the whole tree for the old absolute URL — relative links survive renames, absolute ones don't. | `apps/web/app/docs/page.tsx`, `apps/web/lib/brain/docs-content.ts` | fixed (v2.0.3) |
| ~~**Docs hub linked gitignored `docs/RUNBOOK.md`.**~~ The "operator runbook" item pointed at an author-only file that isn't in the public tree (dead even with the right repo). Retargeted to the public `docs/DEPLOY_CHECKLIST.md`, labels updated in EN/TH/DE. | same files | fixed (v2.0.3) |
| ~~**Skills concept page omitted the Decisions filter; tutorials invisible from the root README.**~~ The in-app skills concept now lists the Decisions filter (all locales) and deep-links tutorial 07; root README gained a tutorials row; END_USER count corrected to seven guides. | `docs-content.ts`, `README.md`, `docs/END_USER.md` | fixed (v2.0.3) |

---

## 0m. Ops-hygiene pass (2026-07-10)

Post-flag-enable hardening sweep. Items:

| Issue | Where | Status |
|---|---|---|
| ~~**Backups had never been restore-tested.**~~ First restore drill executed: latest nightly dump restored into an isolated `pgvector/pgvector:pg16` container with **zero errors**; row counts matched prod minus post-dump activity; all 228 embeddings survived. Reference procedure now in `DEPLOY_CHECKLIST §E "Backups"` — repeat periodically. Note: plain `postgres:16` cannot restore this dump (no `vector` extension). | `docs/DEPLOY_CHECKLIST.md` | drill passed (2026-07-10) |
| **KEA mines agent meta-sessions into procedural noise.** Dogfood sessions about validating the platform itself yield "rules" like "ensure the output includes an openActionItems block" — plausible-looking, useless, and they compete in retrieval. First prune: 3 rows soft-deleted (fixture-validated dry-run→apply→idempotent re-run under the data-repair carve-out). Watch rate on future meta-heavy weeks; if recurring, teach KEA to skip validation/fixture sessions rather than pruning by hand. | KEA corpus | pruned 3 (recurring risk) |
| **Gate window is self-referential so far.** 14/19 closed sessions in the #149 window are BrainPlatform meta-work; **0 sessions from the three external repos** with the protocol installed. The official 2026-07-17 reading should report the external-repo count alongside the aggregate; if still ~0, treat the gate as passed-but-unproven-on-independent-workloads (see the 07-10 comment on #149). | #149 | flagged for the reading |
| ~~**Security review finding 1 (critical): org-promotion leaked action items across projects.**~~ An independent review found `/api/knowledge/[id]/promote` (and fork) had no `action_item` type guard, and the Oracle task block queried with org-wide `accessibleProjectIds` — any project member could broadcast a meeting item (assignee, task text) into every other project's Oracle. Fixed threefold: promote + fork now 422 on `action_item`; task queries are hard-bounded to the active project (`accessibleProjectIds` removed from the entire task path); regression test pins the non-leak. The rule generalizes: **a non-rule type value's exclusion sweep must also cover the visibility-travel paths (promote/fork/org serving)**, not just retrieval — GUIDELINES §11 updated. | `promote/route.ts`, `fork-to-project/route.ts`, `action-items.ts` | fixed (v2.1.2) |
| **Security review finding 2 (important): cross-user prompt injection via task text.** Action items are the first surface where user A's free text lands in user B's agent context as something to act on. Mitigation shipped: the injection block now frames items as user-authored data ("NOT instructions to execute automatically; confirm with your user"). Residual risk accepted for now — a stronger stance (assignee confirmation before resolve, content sanitization) is the revisit trigger if real-world abuse or over-trusting agents appear. | `action-items.ts` formatter | mitigated (v2.1.2) |

---

## 0n. First-time-user review (2026-07-10)

Cold, no-background review of the live webapp (unauthenticated Playwright + code audit — this checkout has no path to mint a test account under single-admin Credentials mode, which has no self-registration; a signed-in pass needs the operator to hand over a voucher/session cookie per the carve-out in `CLAUDE.local.md`).

| Issue | Where | Status |
|---|---|---|
| ~~**Critical: `/settings/*` had no server-side auth guard.**~~ Unlike `/admin` and the main app shell (`[orgSlug]/[projectSlug]`), which both redirect anonymous visitors, `/settings` pages were bare client components. An anonymous visitor clicking the welcome page's own "Get a token →" link landed on a fully-rendered, functional-*looking* "Create token" form whose data fetches silently 401'd — rendering the literal string `HTTP 401` where a token row should be. New `apps/web/app/settings/layout.tsx` closes the gap. **Self-corrected same day:** the first version copied `admin/layout.tsx`'s bare `anySignInConfigured()` gate — an independent review caught that this silently locks dev-shim (`ALLOW_DEV_AUTH=true`) deployments out of `/settings/tokens` entirely, their only path to create an MCP token, even though dev-shim resolves a real user fine downstream. `admin`'s stricter gate is intentional there (no per-user surface in single-user dev-shim mode); settings has no such justification. Fixed to mirror `app/page.tsx`'s three-way gate instead (real session required / unconfigured refused loudly / dev-shim passes through). CI's `authed-e2e.yml` runs Credentials mode only, so this gap would not have self-surfaced from green CI — the regression test remains valid for that mode, but the dev-shim path was reasoned through by hand, not covered by an assertion. | `apps/web/app/settings/layout.tsx` | fixed (v2.1.3) |
| ~~**`callbackUrl`/`next` were accepted at `/signin` but silently discarded.**~~ Both sign-in server actions hardcoded `redirectTo: "/"` regardless of the query param — a pre-existing bug, not new. Affected the welcome page's own `next=/welcome` link (a first-time user who signs in mid-onboarding was unexpectedly dumped on the dashboard instead of returned to their step) and the main app shell's existing `callbackUrl=/org/project` usage. Fixed with a same-origin-validated `safeRedirect()`. **CodeRabbit caught a bypass in the first version** (an independent security-review subagent had traced it and incorrectly called it safe): `safeRedirect` rejected literal `//`/`://` but not backslashes — `/\evil.com` resolves identically to `//evil.com` per the WHATWG URL parser's relative-slash state (it treats `/` and `\` interchangeably when detecting a new authority for special schemes). Verified against the spec by hand before accepting either reviewer's claim; now rejects any backslash. E2e-tested end-to-end with a real credentials login (CI's throwaway admin account) asserting the post-login host — see the next row for why that wasn't possible until this same pass. | `apps/web/app/signin/page.tsx` | fixed (v2.1.3) |
| ~~**Skills concept page: forward reference.**~~ The Decisions-clarification paragraph named "principle / anti-pattern" skills before those terms were defined in the bullet list rendered after it (`body[]` renders before `bullets[]`) — unresolvable for a true first-time reader. Split into two sections (EN/DE/TH) so terms are introduced before being referenced. | `apps/web/lib/brain/docs-content.ts` | fixed (v2.1.3) |
| ~~**`security.spec.ts` was wired into neither e2e CI workflow — ~15 tests, including pre-existing ones, had never actually run automatically.**~~ Discovered while trying to verify my own new regression tests actually executed: `onboarding-e2e.yml` and `authed-e2e.yml` both pass an explicit file list to `playwright test`, and `security.spec.ts` was on neither. A green CI check never meant these tests ran — commit messages earlier in this same PR claimed "new e2e regression test" before this was verified, which was premature. Its two MCP-transport tests would have vacuously passed if naively added (`POST /mcp` 404s on a Next.js app with no MCP route → still satisfies `status ≥ 400`) — a false-confidence risk distinct from a hard CI break. Separately, `authed-e2e.yml`'s `chromium` project applies a pre-authenticated `storageState` to every test by default, which would have silently invalidated any test in this file assuming anonymity. Fixed: the file's "negative path" describe block now forces `test.use({ storageState: { cookies: [], origins: [] } })`, and the whole file joined `authed-e2e.yml`'s run. | `.github/workflows/authed-e2e.yml`, `apps/web/e2e/security.spec.ts` | fixed (v2.1.3) |
| **Investigated, confirmed benign:** `net::ERR_ABORTED` on docs concept-page RSC prefetches in the Playwright harness (all ten pages return 200 on direct fetch — the harness navigated away before an unused hover-prefetch completed); a stale local screenshot showing old invite-only sign-in copy (verified against current source — only one copy variant exists today; the screenshot predated a copy change). | — | not a bug |
| **Known imprecision (accepted, not fixed):** the `/settings` guard always bounces back to `/settings/tokens` after sign-in, not the specific sub-page (e.g. `/settings/org`) the anonymous visitor tried to reach — layouts don't see the request pathname without a `middleware.ts`, which is more than this narrow case warrants. One extra click, not a broken state. | `apps/web/app/settings/layout.tsx` | accepted |

---

## 0o. Meeting-transcript upload — shipped dark (2026-07-17)

Closes the exact gap `§0n`'s "Known imprecision" row left open and the
operator's 2026-07-12 live question both pointed at: is there a path into
the Brain for someone with a transcript and no agent handy? `POST
/api/meetings/extract` plus the `/meetings` webapp surface (paste a
transcript, review the extracted decisions and action items, confirm each
individually through the existing `POST /api/knowledge` path) now exist end
to end. Ships **dark**, matching `§0k`'s pattern: `MEETING_UPLOAD_ENABLED`
defaults `false` in `env.ts` and in the compose `environment:` allowlist —
`.env` alone is ignored at runtime, the same trap `§0k` already recorded. An
operator enables it with `MEETING_UPLOAD_ENABLED="true"` in `.env`, then a
redeploy (or `./scripts/reload.sh web mcp-server`) so the compose allowlist
picks it up. **Merged and deployed 2026-07-18 as v2.2.0** on the reference
instance; flag confirmed `false` post-deploy — behavior is byte-identical
to v2.1.3 until an operator opts in. An operator also needs a working model
before enabling: `MEETING_EXTRACT_MODEL`/`DASHSCOPE_API_KEY` are in the
compose allowlist for the `qwen3-coder` default, or override
`MEETING_EXTRACT_MODEL` to a model backed by a key `web` already has
(`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GOOGLE_GEMINI_API_KEY`).

| Issue | Where | Status |
|---|---|---|
| ~~**No non-agent path into the Brain from a meeting.**~~ `docs/protocols/meeting-miner.md` required an AI agent in the loop; a scrum master or stakeholder holding a transcript with no MCP client had no way in. `/meetings` now runs the identical `brain_teach_knowledge` calls behind a paste → review → confirm flow, rate-limited and flag-gated. | `apps/web/app/api/meetings/extract/route.ts`, `apps/web/components/brain/meetings.tsx` | done, dark |
| **Plan-stage CodeRabbit review paid for itself before any code existed.** The spec+plan PR (#165) carried complete draft code for every task, so it was reviewable as a document, not just as prose — the review caught a cross-project supersede gap, a silent-teach-failure path, unvalidated assignee emails, and a React list-key anti-pattern, all before Task 1 started. Fixing a finding in a plan is cheaper than fixing it in a second review pass on code and tests already built around the bug. Worth deliberately requesting this class of review on future plan documents, not only on finished diffs. | PR #165 | precedent |
| ~~**`rateLimitCheck`'s get-then-set is not atomic.**~~ **Fixed (2026-07-28).** Flagged by CodeRabbit review (2026-07-18) and deferred here as a soft cap on LLM cost. That framing was wrong on both counts, which is why it sat for ten days. **(a) Severity:** the bucket advanced by **one per burst regardless of burst size** — every concurrent caller read the same pre-increment count and wrote `count + 1` — so a caller who simply kept requests in flight was never limited at all, repeatably. Not "a burst can slightly exceed the cap" — an unbounded bypass **of the application limiter**. (Corrected 2026-08-01: the first version of this row said simply "unbounded". `deploy/Caddyfile` rate-limits `/api/*` at the edge to 10 events per IP per second, ordered before `reverse_proxy`, so a caller was never wholly unbounded. The finding stands — the edge limit is three-plus orders of magnitude looser than the control it was masking, 10/**second** against a voucher gate meant to allow 10/**hour**, and being per-IP it does nothing against a distributed caller — but the word was wrong. The same overclaim was corrected in APPROACH §5bf on 2026-07-31 and missed here and in GUIDELINES; a retraction applied in one of three places is not a retraction.) **(b) Blast radius:** the same helper guards the **auth surface**, not just the LLM-cost caps named in the original entry — `voucher:${ip}` (10/hr, the invite-code gate on a self-service Brain), `register:${ip}`, and forgot-password. A brute-force amplifier on the invite-code gate, not a metering nicety. Also note the two stores diverged under concurrency: `memoryStore` handed back a shared object reference (callers mutated each other's read), while the Redis store JSON-round-tripped — so the in-memory fallback and production behaved differently. **Fix:** the `Store` contract is now a single atomic `increment(key, windowMs, now)` (the racy `get`/`set` pair is gone, so it can't be reassembled by a future store). In-memory does its read-modify-write with no `await` between the two and copies the bucket out; Redis runs `INCR` + conditional `PEXPIRE` + `PTTL` as one Lua script. Redis errors degrade to the per-process limiter rather than passing the request through uncounted. Regression tests fire concurrent bursts and assert exactly `max` pass. **Lesson: when deferring a rate-limit finding, enumerate the call sites first — "it's only a cost cap" was an artifact of looking at the one endpoint the PR touched.** | `packages/core/src/rate-limit.ts`, `apps/web/lib/brain/rate-limit-store.ts` | done |
| ~~**The default rules export omitted rules the Brain was serving.**~~ **Fixed for the exporter (2026-08-01); dashboard and graph left as-is deliberately.** Two things are called "scope" here: persisted `Knowledge.scope` (`user`/`project`/`global`) and request `DataScope` (`project`/`all`). Under `DataScope: "all"` the V1 helper already returns everything the caller owns; the gap was `DataScope: "project"`, where it resolved on `ownerProjectId` alone and never consulted `Knowledge.scope` — so it could not filter to a project *while* admitting the caller's `user`-scoped rows from elsewhere. `buildRulesBundle` defaults to `"project"`, so the query admitted a strictly narrower set than `kra.ts` injects. **Correction (2026-08-01), measured after deploying the fix:** the defect was real in the query logic but its user-visible symptom was **not** observable, because `buildRulesBundle` also filters `tags: { has: "rules-export" }` and **zero rows carry that tag, for any user** — the bundle is empty for everyone regardless. The fix widens the base clause from 146 to 183 rows for a `Brain Platform`-scoped export, matching retrieval's reach, but nothing downstream of the tag filter changes today. Latent-correct, not user-visible. Verified rather than assumed after the deploy; the original wording implied a live symptom. **Fix:** an owner-anchored `includeUserScopeAcrossProjects` opt-in on V1, always enabled by the exporter. **Deliberately NOT a V1→V2 migration:** V2's `visibility: 'project'` arm carries **no `ownerUserId` predicate** — that absence is what makes Phase-4 org sharing work — so migrating a personal surface to it would also start returning teammates' rules. That is a product decision about team sharing, not this defect. **Dashboard and graph keep the project-scoped view** on purpose: they are browsing surfaces where project focus is the point, consistent with `KNOWLEDGE §12.19`'s retrieval-is-wider-than-listing rule. A rules bundle is different — it is the agent's configuration, and there is no reading of "export my rules" that wants less than you are served. | `packages/core/src/scope-filter.ts`, `exporter.ts:95` | done (exporter) |
| **"Download rules bundle" returns an empty bundle for every user.** `exporter.buildRulesBundle` selects only `Knowledge` tagged `rules-export`. In production exactly one path writes that tag: `autoskill.ts:801`, when a user **approves** an autoskill proposal (the demo seed also tags 4 rows, but that is a dev fixture). On the reference instance all 4 autoskill proposals sit `pending` and **0 rows carry the tag**, so `/api/export/rules` and the Skills download button return nothing for everyone. Not obviously a bug — invariant 8 requires user approval before autoskill writes anything, so an unused approval queue legitimately yields an empty export — but it does mean the whole export surface is untested by real usage, and any statement about export behaviour is theoretical until a proposal is approved. Worth deciding whether "export my rules" should mean *approved autoskill rules only* (today's behaviour) or *the rules the Brain actually serves me*, which is what a reader of the button label would expect. Found 2026-08-01 while measuring the fix above. | `packages/core/src/exporter.ts:109`, `autoskill.ts:801` | open — product call |
| ~~**The CI benchmark-doc coherence gate did not exist.**~~ **Built (2026-08-01, v2.6.0).** `docs/ROADMAP.md` listed it among *shipped* deliverables from 2026-07 while no such workflow existed — recorded as a gap 2026-07-28 (§0p), closed now. `scripts/check-benchmark-coherence.sh` + the `benchmark-coherence` CI job fail a PR that changes `kra.ts`'s `WEIGHTS` or `CANDIDATE_POOL_SIZE` without also changing `docs/VALIDATION.md`, enforcing GUIDELINES §3 invariant 12 mechanically instead of by memory. **It compares the constants' VALUES across the merge base, not whether `kra.ts` was touched** — a file-level check would have fired on the #174 scope work, which edited that file without moving a weight, and a gate that cries wolf gets switched off. Validated against real history: silent across `v2.4.0..v2.5.0`, fires across `v2.2.0..v2.3.0` (#146's pool widening, which did record its numbers). **Follow-up (v2.6.1):** the new script itself then survived `prod-drift`'s filter and would have opened a false drift issue the next morning — the exact failure §0p records. Root `scripts/` is now excluded, verified by checking the running `web`, `worker` and `mcp-server` containers (not just the Dockerfile) that `/app/scripts` is absent; the `^` anchor keeps `packages/core/scripts/` in scope, since that path *is* copied into the image. | `.github/workflows/ci.yml`, `.github/workflows/prod-drift.yml`, `scripts/check-benchmark-coherence.sh` | done |

---

## 0p. Corpus capture gap + scope-filter blindness (2026-07-28)

Found while building the second generation-uplift suite (#126 follow-up). That
suite's treatment arm takes its injected block from the **live KRA path** rather
than a hand-written file — the change you make when you want to measure the
product instead of the mechanism. The first probe returned a null, and chasing
it produced two defects and one measurement.

**Method (reproducible).** Ask a well-formed technical question whose answer is a
documented repo rule, via both `brain_start_session(projectName:
"BrainPlatform")` (the production path) and `brain_retrieve_knowledge`
(unscoped), then compare what comes back.

| Issue | Where | Status |
|---|---|---|
| ~~**Hard-won repo rules were never taught to the Brain.**~~ **Partially closed (2026-07-28).** A probe of three documented rules found two absent from the corpus entirely: the `force-dynamic` rule (§10) and the package-boundary rule — each with a class-of-bug entry here and real debugging cost behind it. The Oracle said so outright: *"isn't captured in your current knowledge base."* Only the `#418` mount-gate rule was present. **This is a capture gap, not a retrieval gap** — proven by teaching `force-dynamic` and re-running the *identical* prompt, which then ranked it **first**. KRA ranked it correctly the moment it existed. Nine rules were backfilled from GUIDELINES §9/§10 and AGENTS.md. **The rest of GUIDELINES/KNOWN_ISSUES has not been swept** — the docs remain the de facto memory for pre-Stage-1 lessons. | `docs/GUIDELINES.md`, the Brain corpus | partially done |
| ~~**`scope: "user"` knowledge is invisible outside the project it was captured in.**~~ **Fixed (2026-07-30, #174).** **Correction to this row's first version, which named the wrong mechanism:** it claimed the production path was `buildRawProjectFilter` and that "`Knowledge.visibility` does not govern this path". Both are wrong. `kra.ts:154` and `oracle.ts:139` call **`buildRawProjectFilterV2`**, which is **visibility-driven** — and `visibility` defaults to `"project"`, so a row taught from inside project A is bound to project A. The `scope` column *is* consulted, but **only in the no-active-project branch**, which received exactly this fix on 2026-05-12 after "5/5 retrieval misses" (see the comment at `scope-filter.ts`). The active-project branches never got it. So this was not a new design question at all — the project had already decided, and applied the decision to one branch out of three. **Fix:** the same `scope IN ('user','global') AND ownerUserId = $user` disjunct, gated behind a new **opt-in** `includeUserScopeAcrossProjects` flag (default `false`) and enabled only at the two personal-rule retrieval sites. Opt-in is load-bearing: `action-items.ts` treats the project edge as the isolation line for tasks (2026-07-10 review, finding 1) and `meeting-extract.ts`'s supersession search is deliberately project-wide but **not** owner-scoped (2026-07-17 finding I2) — widening either would breach a reviewed boundary. **Measured on the live corpus:** rows visible to a `Brain Platform` session go **104 → 141 (+37)**, and the 0.9009-similarity item that motivated the investigation now matches. It is +37 and not +101 because the remaining `Default` rows are `scope='project'` and correctly stay project-bound — the fix is narrow by design, not a bucket merge. | `packages/core/src/scope-filter.ts`, `kra.ts:154`, `oracle.ts:139` | done (#174) |
| ~~**The two V2 scope helpers disagreed — twice.**~~ **Fixed (2026-07-31, #180 + follow-up).** `buildKnowledgeWhereV2` (Prisma listings) and `buildRawProjectFilterV2` (raw pgvector) express **one** visibility policy on two query surfaces, so any divergence makes results depend on which code path a caller hits. Two were found by reviewing the #174 fix itself: **(a)** with no `activeProjectId` the raw helper admitted `scope IN ('user','global')` unconditionally (the 2026-05-12 decision) while the Prisma twin gated it behind the new opt-in flag — a divergence *introduced by* the #174 fix, and the same inconsistency class review had already caught inside the raw helper; **(b)** pre-existing and unrelated to #174 — under `scope: "all"` with an empty accessible-project list, the raw helper returns everything the user owns while the Prisma twin enumerated only `private` + project-less rows, silently dropping the user's own `visibility: 'project'` rows (**the default visibility**). That contradicted the documented `?scope=all` contract in `KNOWLEDGE §12.19` and was reachable whenever `getAccessibleProjectIds()` short-circuits to `[]` for a non-member (`org.ts`). Fail-safe — under-reported, never leaked — but wrong. **Correction (2026-07-31):** #180 claimed `buildKnowledgeWhereV2` had *zero* test coverage. That was wrong, and the mistake is instructive — it came from `grep -c` against `scope-filter.test.ts` alone, concluding "no coverage anywhere" from one file. A second file, **`scope-filter-v2.test.ts`, covers it in 22 places**, and CI caught the error by failing one of those tests against divergence (b)'s fix. What was actually true is narrower: the #177 branch was unreachable (no caller passed the flag), and the *cross-helper* case had no test in either file. Tests now assert the two helpers **against each other in the same case**, because a per-function test cannot see a gap that lives between them. | `packages/core/src/scope-filter.ts`, `__tests__/scope-filter.test.ts` | done |
| ~~**The Redis `Store` adapter had no tests, and could not have any.**~~ **Fixed (2026-08-01, v2.5.5).** Every decision in `redisStore.increment` sat behind the `client.eval` call inside `apps/web`, which needs workspace resolution to run — so the adapter production has used since `REDIS_URL` was set (2026-07-31) was entirely unverified. The argument that finally made it urgent: **the untested branches were the *failure* branches** — malformed reply, `PTTL` of −1/−2, Redis unreachable. Those never run while things are healthy, so "it's clean in production" was evidence about the happy path only; the code with no evidence behind it was precisely the code that runs when Redis breaks. **Fix:** `redisWindowMs()` and `bucketFromRedisReply()` moved to `packages/core` beside the `Store` contract, per the injectable-seam pattern GUIDELINES §4 already prescribes for LLM calls; `apps/web` keeps only the `eval` and the fallback wiring. 14 tests, TDD'd. **The extraction surfaced a latent hole:** the old parse accepted any numeric count, but `INCR` on a counter this module owns cannot return `< 1` — a zero or negative count from a foreign write would make `check()` compute `ok` forever, granting unlimited requests through an auth-facing limiter. Both `count` and `ttl` are now integer-validated (the `ttl` half was a CodeRabbit catch: validating one field strictly and leaving its sibling on a bare `typeof` undercut the argument for the guard). Validated against a real `redis:7-alpine` as well as fixtures — replies really are `[count, ttl]`, and `PTTL` really does answer −1 for a key with no expiry and −2 for a missing one. | `packages/core/src/rate-limit.ts`, `apps/web/lib/brain/rate-limit-store.ts` | done |
| ~~**`.env.example` claimed compose provides Redis; it does not.**~~ **Closed (2026-07-31).** The comment read *"Production docker-compose provides `redis://redis:6379`"*, but `deploy/docker-compose.yml` only passes the value through (`REDIS_URL: ${REDIS_URL:-}`). Consequence: a healthy `deploy-redis-1` had been up for weeks with **nothing connected to it**, rate-limit state lived in an in-process Map that reset on every deploy, and the pre-2026-07-28 get-then-set race (§0o) was therefore a **live production** bypass rather than a dev-only concern. `.env.example` corrected, and the operator set `REDIS_URL` on the live host and redeployed (v2.5.1). **Verified:** exactly one `REDIS_URL` line in `.env`, present in the running `web` container, `{"msg":"redis ready"}` in the web log, and eight requests through the limiter with no error or fallback line — the atomic Lua path is executing in production for the first time. | `.env.example`, live `.env` | done |
| **Two checkouts on the host share one Compose project — `deploy`.** `/root/BrainPlatform` is the live checkout (164-line `.env`); `/root/ExternalBrain` carries a 4-line stub `.env` with no `DATABASE_URL`, `BRAIN_PUBLIC_HOSTNAME`, `CADDY_EMAIL` or `ADMIN_PASSWORD_HASH`. Because the Compose project name derives from the compose file's parent directory (`deploy/`), it is **identical from either checkout** — so `./scripts/deploy.sh` run from the wrong one targets the live production stack with the wrong env. `deploy.sh`'s preflight requires the hostname/email vars and would very likely abort, but that is a guard, not a design. Surfaced 2026-07-31 when a `REDIS_URL` append landed in the stub by mistake. **Always confirm `pwd` is `/root/BrainPlatform` before any deploy or compose command.** (Severity: low-probability, high-impact. No fix beyond the check — a `-p` flag per checkout would work but the second checkout has no reason to deploy at all.) | `/root/ExternalBrain`, `scripts/deploy.sh` | operator discipline |
| ~~**`prod-drift` opened a false-positive issue for a release that correctly wasn't deployed** (#176).~~ **Fixed (2026-07-31).** The watchdog compares the deployed `git describe` against `main`'s, with a carve-out treating docs-only drift as in-sync. Two paths survived its filter and tripped it for v2.4.0: `.env.example` (a template — the container reads the real `.env`) and `packages/core/generation-uplift/**` (operator-run benchmark artifacts kept outside `src/` precisely so nothing builds them, GUIDELINES §4). So the repo's own "don't redeploy changes that touch nothing app-served" rule and this watchdog were **guaranteed to conflict**. Exclusion set completed (also `.github/`, which never enters an image) and verified in both directions: `v2.3.1..v2.4.0` now filters to empty, while `v2.4.0..v2.5.0` — a real `kra.ts`/`oracle.ts` change — still reports drift, so the detector is not blinded. | `.github/workflows/prod-drift.yml` | done |

---

## 0. MVP-complete open items (2026-04-29, operator action required)

These are not blocking pilot but must be resolved before a second contributor joins or the platform is advertised publicly.

| Issue | Where | Fix by |
|---|---|---|
| **Secrets in git history (`ff8bcec`, `387dca1`) — NEUTRALIZED for the public release (2026-06-01); key rotation still pending.** The public release was published as a fresh, history-free repo (`ExternalBrain` v1.0) carrying **none** of these commits (see §0d), so the public-repo trigger is satisfied without a history rewrite. The dirty history remains only in the **private** `BrainPlatform` repo, which must stay private. **The actual API keys must still be rotated at the providers** — that is the only thing that truly neutralizes the leak. _Original entry for archive:_ Commits `ff8bcec` (Apr 27, "feat(orgs): Phase 2b") and `387dca1` ("fix(security): remove accidentally-committed .env backups") contain three real secret values in `.env`: `ANTHROPIC_API_KEY`, `GOOGLE_GEMINI_API_KEY`, and an `ADMIN_PASSWORD_HASH` (since rotated). The bad commits are present on **both `origin/main` and `origin/develop`**, contrary to the prior note that scoped them to develop only. **Decision (2026-05-05): defer the history rewrite.** Repo is private on GitHub Free; blast radius is bounded to the access list, GitHub itself, and any local clone caches. Cleaning requires `git filter-repo --replace-text` followed by `git push --force-with-lease origin main develop`, which breaks every existing clone (this prod box, dev VPS, operator laptops) and orphans any open feature branches. **Trigger to revisit:** before the repo is made public, before adding any contributor outside the current trust circle, or after the next planned downtime window when uncoordinated clone-resets are tolerable. The actual API keys must be rotated at the providers (Z.ai/Anthropic console + Google Cloud console) for the leak to be neutralized regardless — git rewrite alone does not invalidate keys already pulled by anyone with prior access. | `origin/main`, `origin/develop`, all clones | before public repo / new contributor |
| **Branch protection now UNBLOCKED — `ExternalBrain` is public (2026-06-01).** Branch protection / rulesets are free on public repos, so the plan-tier blocker below no longer applies to `ExternalBrain`; enable PR-required + status-check-required on `main` and `develop` in its GitHub settings. _Original entry (applied to the private `BrainPlatform` repo):_ The repo is private on GitHub Free. Both classic branch protection (`POST /repos/.../branches/main/protection`) and the newer rulesets API (`POST /repos/.../rulesets`) return `403 Upgrade to GitHub Pro or make this repository public to enable this feature` (verified 2026-05-04 via `gh api`). Two paths to unblock: (a) upgrade `bejranonda` to GitHub Pro (~$4/mo), then enable PR-required + status-check-required on `main`; (b) make the repo public, which gates branch protection on Free. Until then, the discipline lives in operator habit + agent guardrails (see `~/.claude/projects/-root-BrainPlatform/memory/feedback_operator_style.md`). High-urgency before a second contributor joins. Steps once unblocked: `docs/RUNBOOK.md §"Enabling branch protection on main"`. | GitHub repo settings + plan tier | before 2nd contributor |
| **Cross-org knowledge bundles deferred (Phase 5).** A team-owned Brain cannot currently share a curated knowledge bundle with a separate org. The visibility system (private/project/org) operates within one org; cross-org sharing requires a bundle-import/export mechanism not yet designed. Not blocking for single-org pilots. | `packages/core/src/scope-filter.ts`, Phase 5 planning | Phase 5 |
| **pg-boss 10→12 upgrade has no auto v24→v25 path** (#71). PR #63 jumped from pg-boss 10 to 12 directly, but `pg-boss@12.18.2/dist/migrationStore.js` only ships migrations starting at v25→v26. A DB last touched by pg-boss 10 sits at `pgboss.version = 24`; v12's `boss.start()` fails fatal with `relation "pgboss.job_common" does not exist` and the worker crashloops. Recovery on dev: `DROP SCHEMA pgboss CASCADE` then redeploy (loses pending jobs). Recovery on prod: install pg-boss 11.x as a transient bridge, run migration to v26, then upgrade to v12 (preserves jobs). ~~**Operator must check `SELECT version FROM pgboss.version;` on the server before deploying.**~~ **Automated (#88)** — `scripts/deploy.sh:159` runs `scripts/pgboss-version-check.sh` as a preflight, so the unmigratable v24 state is detected by the deploy rather than by the operator remembering. The recovery procedure above still stands if the check fires. | `apps/worker/src/index.ts`, `scripts/deploy.sh` | done (#88) |
| **Bootstrap container image cache hazard on migration renames** (related to #37). When a Prisma migration directory is renamed (e.g. PR #36's `20260425_org_invites` → `20260427130000_org_invites`), `docker compose build` may serve a cached layer of the bootstrap image that still has the old name. The on-disk repo is correct but the image is stale, so `prisma migrate deploy` tries to apply a migration that the **schema has already partially started**, leaves a failed-state row, and blocks future deploys. ~~Workaround: run `docker compose --profile bootstrap build --no-cache bootstrap` after any migration rename. Permanent fix: add a `cache_from`-aware step in `scripts/deploy.sh` that hashes `packages/db/prisma/migrations/` and forces no-cache on hash change.~~ **Fixed** — `scripts/deploy.sh:137-143` unconditionally rebuilds the bootstrap image with `--no-cache` before running migrations (see the in-script comment for the originating ref). Blunter than the hash-compare sketched here (it costs a rebuild every deploy) but it cannot miss a rename, and the bootstrap image is small. | `scripts/deploy.sh` | done |

---

## 0q. Four-pass pre-release master audit (2026-08-02, v2.8.0 → v2.10.1)

> **⚠️ Upgrade note for multi-user instances (v2.10.0).** A
> `brain_teach_knowledge` call with `scope: "project"` **and** the `decision`
> tag is now written `visibility: "org"`, and MCP retrieval carries org scope —
> so project decisions become readable by **org teammates**. That is what
> `AGENTS.md` has always described and what did not previously happen.
> Single-operator instances are unaffected. Rules **not** tagged `decision` are
> unchanged and stay visible only to their author. Nothing existing is
> retroactively re-shared; this applies to rows written after upgrading. The
> containment argument — the `ownerUserId` pin is *kept*, with a bounded
> disjunct added beside it rather than relaxed — is in the org-sharing row
> below and in [`APPROACH §5bh`](./APPROACH.md).


A structured pre-release sweep across four roles — onboarding/DX, MCP + tenancy
security, worker/DB reliability, deployment/i18n. Full reports live in
[`docs/pre-release/`](./pre-release/); what was fixed and what was deliberately
deferred is in
[`00_REMEDIATION_LOG.md`](./pre-release/00_REMEDIATION_LOG.md).

**Headline: zero CRITICAL findings — no cross-tenant leak, no auth bypass, no
secret exposure.** Both pgvector paths hard-pin `"ownerUserId" = $2` outside the
visibility filter, all 49 non-public API routes are gated, and admin routes
check role rather than mere authentication. What the audit found was a cluster
of last-mile defects, and **one pattern behind almost all of them**: *hardening
applied in one place and not carried to its siblings.* Clipboard hardened in 4
of 7 call sites; the 429 lesson in `embedding.ts` but not `llm.ts`; token
project-scope enforced on every write tool and no read tool; `captureError` on
4 of 9 worker handlers; rate limiting on `/api/*` but not `/mcp`. That is now a
standing review question in [`GUIDELINES §4`](./GUIDELINES.md).

| Issue | Where | Status |
|---|---|---|
| ~~**Every standalone page was unscrollable past one viewport — no scrollbar, no way down.**~~ **Fixed (v2.11.0; regression corrected in v2.11.3).** **The fix broke the desktop shell**, and the reasoning error is worth keeping: the original comment claimed *"the shell is unaffected because `.app` sets its own height and therefore never makes the document taller than the viewport."* Wrong. `.app { height: 100vh }` bounds the **shell**, not the **document** — a surface whose content escapes its `.scroll` pane still grows `<body>`, and with nothing pinning it the rail (anchored inside that 100vh box at the document top) ended up stranded mid-page. Reported against `#skills`. The desktop shell is now re-pinned **explicitly** via `@media (min-width: 881px) { html:has(.app), body:has(.app) { height:100%; overflow:hidden } }` rather than by assumption. **`html` is the half that does the work** — a body-only rule looked right and failed CI: reproduced in a browser against this stylesheet, a `.scroll` pane whose content escapes it gave `scrollY = 800` with body-only and `0` once the root element was constrained. Body's overflow does not reliably propagate to the viewport once its own box overflows, and the viewport is what scrolling moves; below 881px the mobile block already does the opposite deliberately (`.app{height:auto}`, `.rail{display:none}`, document scroll intended). **The e2e guard missed it because it visited one surface** — `/`, the dashboard — and passed while `#skills` was broken in production. A shell test that visits one surface tests one surface; it now walks five and additionally asserts the rail's bottom edge sits at the viewport bottom, which is the reported symptom rather than a proxy for it. **Original fix:** `globals.css` carried `body { overflow: hidden; height: 100vh }`, added for the SPA shell. On the shell it was **redundant** — `.app` pins itself to `100vh` and scrolls inside its own `.scroll` panes — and everywhere else it was a trap: `/settings/*`, `/admin/*`, `/signin`, `/welcome`, `/docs`, `/accept-invite` and the password pages all render straight into `<body>` with no `.scroll` wrapper, so content past one screen was simply unreachable. **Reported by an operator whose account had 9 access tokens and could only see the first two.** Now `min-height: 100vh` + `overflow-x: hidden` — the horizontal half is kept deliberately, because that is what `e2e/mobile-overflow.spec.ts` (#60, the 375px sideways-scroll regression) leans on; only the Y axis needed freeing. **Why nothing caught it:** the surface only breaks once content EXCEEDS the viewport, and every fixture is small — a seed with two tokens looks perfect. The new `e2e/page-scroll.spec.ts` therefore injects **synthetic** overflow rather than trusting the fixture to be tall enough, and separately asserts the shell still never scrolls the document (the counterpart risk of freeing `<body>`). A fixture-dependent scroll test would have passed for the wrong reason — the exact failure mode this audit arc kept finding. | `apps/web/app/globals.css`, `e2e/page-scroll.spec.ts` | done |
| ~~**The installer's success message sent every new user to a 404.**~~ **Fixed (v2.8.0).** The bash installer's closing line pointed at `${webUrl}/skills`. The app's surfaces are **hash routes** inside the SPA shell at `/[orgSlug]/[projectSlug]` (`lib/brain/routes.ts`); a single-segment `/skills` path resolves to `not-found.tsx` — there are no rewrites in `next.config.ts` and `proxy.ts` matches `/api/*` only. So the last instruction a user received at the moment of first success was broken. Now `/#skills`, which survives the `/` → project redirect because fragments are client-side. Four doc references swept with it. **Generalisation, already recorded in APPROACH §"frozen URLs":** a route shape that lives in a `const` array is invisible to every doc, test and template that writes the URL by hand. | `apps/web/lib/brain/installer-templates.ts`, `docs/USING_BRAIN.md`, `docs/tutorials/` | done |
| ~~**Any syntactically-valid Bearer reached `initialize` and got back the tool catalogue.**~~ **Fixed (v2.8.0).** The MCP HTTP gate checked only that a Bearer was *present*; `authenticate()` ran on `tools/call` and `resources/read` but **not** on `initialize`, `tools/list` or `resources/list`. `Bearer x` therefore allocated a real session and returned `serverInfo` + every tool name, description and input schema — defeating the stated goal of the strict-auth override documented in the same file — and gave an anonymous caller an unbounded way to grow the in-memory session map (evicted only by the 30-min orphan sweeper, with `sessions.size` readable at `/health`). Token is now validated **before** the transport is allocated, in the `if (!session)` branch only; established sessions are unaffected because they are already pinned to that token by `timingSafeEqual`. **The e2e test that appeared to cover this passed for the wrong reason** — see §2. | `apps/mcp-server/src/index.ts`, `apps/web/e2e/security.spec.ts` | done |
| ~~**Every deploy killed in-flight worker jobs and re-spent their LLM tokens.**~~ **Fixed (v2.8.0).** No SIGTERM/SIGINT handler existed, so `deploy.sh` killed handlers mid-execution without releasing the pg-boss lease; rows sat `active` until `expireInSeconds` (10 min for `kea.extract`, 60 for `kea.cross_extract`) and re-ran from the top. `kea.cross_extract` is `retryLimit: 1`, so a deploy landing in its 06:00 window skipped that day's cross-session extraction entirely. Added `boss.stop({ wait: true })` behind a 25 s bounded grace window + `stop_grace_period: 30s` on the service so Docker's 10 s default cannot SIGKILL mid-drain. | `apps/worker/src/index.ts`, `deploy/docker-compose.yml` | done |
| ~~**The LLM seam had no timeout, no retry and no error classification.**~~ **Fixed (v2.8.0).** `packages/core/src/llm.ts` is the single seam every KEA, autoskill and meeting-extract call goes through, and in 121 lines it had no `catch`, no retry and no timeout — while its sibling `embedding.ts` has classified and retried transient provider failures since the first live 429. A provider rate-limit propagated straight out and cost that session its extraction, silently. **The default timeout is load-bearing, not ergonomic:** the vendor SDKs' documented default is 10 min, which is *not shorter than* `expireInSeconds: 600` on `kea.extract` — so a hung call and the job's expiry raced, and pg-boss could hand the job to a second worker while the first was still spending tokens. Now 120 s + one jittered retry on a transient failure; 25 tests. | `packages/core/src/llm.ts`, `__tests__/llm-resilience.test.ts` | done |
| ~~**The once-shown invite link was destroyed whenever the clipboard write failed.**~~ **Fixed (v2.8.0).** `settings/org` fired `void navigator.clipboard.writeText(...)` and cleared the flash on an unconditional 800 ms timer. `navigator.clipboard` is `undefined` on a non-secure origin — **the default `dev-up.sh` posture** — so the call threw; on a secure origin a denied permission rejected a promise `void` discarded. Either way the only copy of the link vanished and the admin had to revoke and re-issue. Now dismisses only after the write resolves, and otherwise keeps the link with a `role="alert"` noting it is still selectable. | `apps/web/app/settings/org/page.tsx` | done |
| ~~**TH and DE were each missing 10 keys, and nothing could detect it.**~~ **Fixed (v2.8.0).** The whole `decisions` section (9 keys) plus `oracle.tagline` were absent from both non-English locales. `translate()` falls back to English before giving up, so users saw English sentences rather than raw keys — degraded but never loud enough to notice, which is exactly why it persisted. Root cause is that the dictionary was three independent `as const` literals with **no type relating them**, so a gap was invisible to `tsc`, ESLint and CI. Added a recursive `DeepStrings` lock; `typecheck` now fails on the next omission. **The lock earned its place on first run** — it caught `oracle.tagline`, which both a flat *and* a corrected nested key-diff had missed. | `apps/web/lib/brain/i18n.ts` | done |
| ~~**`MAX_KEA_COST_USD_PER_SESSION` is documented but enforced nowhere.**~~ **Resolved by removal + replacement (v2.10.0).** Not implemented as specified, because a per-SESSION dollar cap is unenforceable in principle: KEA is one LLM call chain, its cost is unknown until after it runs, and extraction cannot be partial — so the cap either never fires or aborts after the money is spent, yielding no knowledge for it. It could not prevent the spend it named. A *cost*-based daily cap was the other candidate and was also rejected for now: **KEA does no token accounting at all** (nothing in `kea.ts` calls `recordCall`), so it would mean building a cost model first. Shipped instead: **`MAX_KEA_EXTRACTIONS_PER_DAY`** (default 200, `0` disables), checked in the worker **before any LLM call** — a limit that fires afterwards is a report, not a limit. Failed attempts count against it because they still spent tokens; over-quota sessions get `extractionStatus = 'skipped_quota'` and the job completes rather than retrying, since retrying cannot free quota. Extractions are roughly constant-cost so a count bounds the operator's bill proportionally, and a count is the dimension a tier is actually expressed in ("50 extractions/day") — which is what the freemium-with-no-payment phase needs (`BLUEPRINT §11.1`). The counter was free: `Session.extractionAt` had landed in v2.9.0 for the FAILED_EXTRACTION work. | `.env.example`, `apps/worker/src/index.ts`, `deploy/docker-compose.yml` | done |
| ~~**Two "MCP transport" security tests had never contacted the MCP server.**~~ **Fixed (v2.8.0).** Worse than the sibling finding above, and found only because tightening that assertion turned a silent pass into a red build. `security.spec.ts` derived its target as `E2E_BASE_URL ?? "http://localhost:3100"`. The `authed surfaces e2e` job sets `E2E_BASE_URL=http://localhost:3000` and boots **only the web app** — so both tests POSTed to `/mcp` on Next.js, which has no such route, and read its **404**. Both asserted `status >= 400`, which a 404 satisfies. So two tests named *"MCP HTTP transport refuses…"* had been green for their entire existence while never once reaching the MCP server, in the same suite that was itself added in 2026-07 because its specs "had never actually run in CI" (§0c). **Fix:** a dedicated `E2E_MCP_URL` with **no fallback**; both tests `test.skip()` loudly when it is absent; the workflow now builds and boots `@brain/mcp-server`, waits on `/health`, and **fails the job** if it never comes up; `apps/mcp-server/**` added to the job's paths filter so an MCP change can trigger the gate that tests it. Assertions tightened from a range to exactly `401` plus a negative on `serverInfo`. **The generalisation is in `GUIDELINES §4`:** an assertion that only checks *that* something failed proves nothing when the outcome has two possible causes — here, "refused by auth" and "no such route on a different server" were indistinguishable. | `apps/web/e2e/security.spec.ts`, `.github/workflows/authed-e2e.yml` | done |
| **`@brain/mcp-server`'s and `@brain/worker`'s `start` scripts (`node dist/index.js`) cannot work.** `@brain/core` and `@brain/db` publish `"main": "./src/index.ts"` (and `exports` pointing at `src/*.ts`), so plain Node has no loader for what those imports resolve to — the process dies in ~60 ms. Production already works around it: `deploy/Dockerfile` runs `CMD ["…/tsx", "src/index.ts"]` and its comment says why. Nothing else invokes `pnpm start` for these packages, so the broken script sat unnoticed until the e2e job tried to boot the MCP server (2026-08-02) and got `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` with **no diagnostic output** — pnpm swallows a child's startup crash. CI now runs it the way the artifact runs (`pnpm --filter @brain/mcp-server exec tsx src/index.ts`) **and captures stderr to a file that is printed on failure**, so the next crash is diagnosable from the log alone. The `start` scripts themselves are still misleading — either point them at tsx or delete them. (Severity: low; no runtime impact, but it is a trap for anyone running a service outside Docker.) | `apps/mcp-server/package.json`, `apps/worker/package.json`, `deploy/Dockerfile`, `.github/workflows/authed-e2e.yml` | mitigated in CI; scripts still wrong |
| ~~**`boss.stop({ wait: true })` does not compile — pg-boss v12 has no `wait` option.**~~ **Fixed (v2.8.0).** The first cut of the graceful-shutdown handler passed an option copied from an older pg-boss API; CI typecheck caught it (`TS2353`). Reading the shipped `types.d.ts` and `index.js` showed `StopOptions` is `{ close?, graceful?, timeout? }` and that **`stop()` already performs the bounded drain itself** — it polls `hasPendingCleanups()` every 500 ms up to `timeout`, then runs `failWip()` and closes the pool. So the hand-rolled 25 s bail timer that called `process.exit(0)` on expiry was not just redundant but *worse*: it would have skipped exactly the cleanup the handler exists to perform. Now `stop({ graceful: true, timeout: 20_000 })`, with the outer timer demoted to a last-resort guard against `stop()` itself hanging (DB unreachable) and deliberately set longer (25 s) so pg-boss wins every normal case. **Lesson: read the dependency's own types before assuming its API** — the correct implementation was simpler than the guess. | `apps/worker/src/index.ts` | done |
| ~~**5 of 9 worker handlers had no error capture; the worker had no healthcheck.**~~ **Fixed (v2.8.0).** `evolution.{decay,consolidate,detect-obsolescence,health-snapshot}` and `embeddings.backfill` had no `try`/`catch` and no `captureError`, so failures reached neither Sentry nor the structured log — `evolution.decay` erroring nightly looked identical to it working, and `embeddings.backfill` (a 10-min cron) could fail 144×/day in silence. Separately, `worker` was the only long-running service with **no healthcheck**: `restart: unless-stopped` only reacts to a process that *exits*, so a worker wedged on a dropped pg-boss connection stayed "up" forever — and this is the service where failure was already quietest. Both closed. **Follow-up (v2.8.1):** the first healthcheck shipped in v2.8.0 was itself broken — `node -e "require('pg')…"` inside the container failed with `Cannot find module 'pg'`, because under pnpm's isolated `node_modules` `pg` is not resolvable from `/app/apps/worker` even though pg-boss depends on it. Caught by reading `docker inspect .State.Health.Log` after the deploy, not by CI (compose healthchecks are not exercised by any gate). Replaced with a liveness endpoint served by the worker itself, probed via Node's built-in `fetch` — which requires nothing from `node_modules` at all. The endpoint answers only after `boss.getQueue()` round-trips to the pgboss schema, so green means "this process can still reach its queue", not merely "the event loop runs". **A permanently-unhealthy container is worse than no healthcheck** — it trains operators to ignore health status. | `apps/worker/src/index.ts`, `deploy/docker-compose.yml` | done |
| ~~**MCP token project-scope is enforced on writes but ignored on every read path.**~~ **Fixed (v2.10.0).** `apps/mcp-server/src/scope.ts` is now the single resolver every read path calls, deliberately one helper rather than four copies — the audit's own finding was that this class of bug is *hardening applied in one place and not its siblings* (GUIDELINES §4). `brain_retrieve_knowledge` (which took the project from **client input** and never compared it), `brain_ask_oracle` (which never passed a projectId at all, though `ask()` has always accepted one) and `brain_session_search` now confine to the token's project; a foreign `projectId` throws `FORBIDDEN_PROJECT` rather than being silently narrowed, because a caller that asked for project B and got project A's answers has wrong data, not less. Resources: `style-profile` and `recent-sessions` scoped. **Two are deliberately NOT scoped, and that is a schema fact rather than an omission:** `brain_find_skill` and `brain://user/active-skills` read `Skill`, which has **no `ownerProjectId` column at all** — there is no project boundary to cross, and pretending otherwise would mean returning nothing. `brain://user/peer-card` already reads the user-level card (`ownerProjectId IS NULL`), which is a user fact by definition. **Decided 2026-08-03: skills stay user/team-level — no project partition.** Two reasons. (a) *There is no correct backfill*: a skill is distilled from work that may span several projects, so existing rows would have to be either NULLed (silently hiding every existing skill from scoped tokens) or assigned arbitrarily, which is fabricating data to satisfy a schema. The unique key `(skillId, ownerUserId)` would also have to change, and adding the project to it duplicates the same skill per project where it then drifts. (b) *It fights what a Skill is for*: `Knowledge` is atomic and project-bound; a Skill is a portable recipe — `BLUEPRINT §11.2` plans to sell them as packs and the exporter writes them to `.claude/skills/` and `.cursor/rules/`. Portability is the point. `Skill` already carries `scope` and `ownerTeamId`; it has no project axis because it isn't a project-level artifact. the right primitive is a **token capability** — one column on `MCPToken`, no backfill, generalising to every future surface. **Built in v2.12.0** (`MCPToken.capabilities`: an allow-list where empty = unrestricted, so no existing token changed and there was no backfill to invent). Enforced in one place for `retrieve` / `teach` / `find_skill` / `session_search` / `ask_oracle` and the `active-skills` / `recent-sessions` resources; configurable at `/settings/tokens`; shown as a `Limited:` chip on any restricted token. Session-lifecycle tools are deliberately exempt — a token that cannot open a session is not a token, it is a confusing spelling of "revoked". See `KNOWLEDGE §12.21a`. 10 unit tests on the resolver, plus DB-backed cases in `cross-user-isolation.test.ts` — each of the latter carries a **control assertion** proving the row IS reachable unscoped, since asserting a scoped token can't see another *user's* row would be vacuous (both queries already filter `userId`). | `apps/mcp-server/src/scope.ts`, `tools/{retrieve,oracle,session-search}.ts`, `resources.ts` | done |
| ~~**A failed KEA extraction leaves no trace on the session.**~~ **Fixed (v2.9.0, operator-authorized migration 2026-08-03).** `Session` gains `extractionStatus` / `extractionError` / `extractionAt`, written by the `kea.extract` handler. Kept **separate from `outcome`** on purpose: `outcome` is the CLIENT's report of whether the user's coding task succeeded, and the two are unrelated — a session can succeed for the user and still lose its extraction to a provider 429. Marked `failed` only on the **final** attempt (`retryCount >= KEA_RETRY_LIMIT - 1`), since an earlier failure may still recover and a row reading `failed` that later extracted fine is worse than no marker. `KEA_RETRY_LIMIT` is now a single constant shared by the queue definition and the handler so the two cannot drift. Status bookkeeping swallows its own errors — if the write fails, the interesting error is the one that got us there. Existing rows read NULL (extraction status unknown) rather than being backfilled as successful. | `packages/db/prisma/schema.prisma`, `apps/worker/src/index.ts` | done |
| ~~**`glm-*` routed to two different providers — cross-session KEA had been dead for eight nights.**~~ **Fixed (v2.11.0), and found BY the queue-health surface within minutes of building it.** `oracle.ts` decided provider with `useAnthropicSdk()`: `claude*` → Anthropic, **and anything at all when `ANTHROPIC_BASE_URL` is set**, because that variable means an Anthropic-compatible gateway (Z.ai/GLM, Bedrock, a Vertex proxy) fronts every model and takes provider-native names verbatim. `llm.ts::callLLMText` had its own rule: `glm*`/`qwen*` → **DashScope**, ignoring the gateway entirely. On a host with `ANTHROPIC_BASE_URL` set and `ORACLE_MODEL=glm-5.1`, the Oracle worked and `callLLMText` died on `DASHSCOPE_API_KEY is unset`. `kea.cross_extract` inherits `ORACLE_MODEL` when `CROSS_SESSION_KEA_MODEL` is unset and is `retryLimit: 1`, so it failed once and died **every night from 2026-07-28 to 2026-08-04 — 8 consecutive runs, zero cross-session extraction** — while every health check, smoke test and lockdown audit stayed green. One predicate now, exported from `llm.ts` and imported by `oracle.ts`, with four regression tests pinning both the gateway and no-gateway cases. **This is the fifth instance of the same defect class in this audit arc** (clipboard, 429-retry, token scope, captureError, now provider routing): one rule, two implementations, silently disagreeing. | `packages/core/src/llm.ts`, `oracle.ts` | done |
| ~~**No dead-letter queue on any of the nine pg-boss queues.**~~ **Fixed (v2.11.0, corrected twice — v2.11.1 and v2.11.2).** Two mistakes worth keeping, because both looked like success. **(1) `expireInSeconds` where `retentionSeconds` was meant** — pg-boss asserts a 24-hour ceiling on expiry, so `createQueue` threw *"expiration cannot exceed 24 hours"* before any handler registered and the worker crash-looped in production. Expiry is how long a job may sit ACTIVE; retention is how long it is KEPT. I had checked that the option *existed* without checking what it *meant*. **(2) `createQueue` is a no-op on an existing queue** — it does not reconcile options. Every real brain has run before, so the queues predated the config and `deadLetter` silently never attached: the `dlq` row appeared, `dead_letter` stayed NULL on all three source queues, and the feature was **inert while looking installed**. Fixed by calling `updateQueue` alongside. Caught only by querying `pgboss.queue` after the deploy rather than trusting a green smoke — the row existing is not the same claim as the wiring existing.**Original fix:** An exhausted job moved to `failed` in `pgboss.job` and stopped existing as far as the platform was concerned — no surface, no cron check, no alert. The three session-scoped queues (`kea.extract`, `autoskill.run`, `kea.cross_extract`) now dead-letter to `dlq`, read by **`GET /api/admin/queue-health`** and a `QueueHealthCard` beside `BackupStatusCard` — the same shape that solved the three-week silent backup failure (§0f), because a failure with no surface is indistinguishable from success. Cron queues deliberately do NOT dead-letter: a missed nightly decay is corrected by tomorrow's run, so routing them there would fill the inbox with entries nobody acts on — and an inbox nobody acts on is the thing this replaces. **Note on the API:** `deadLetter` is on pg-boss v12's `Queue`, not `QueueOptions`; the audit's proposed `createQueue(…, { deadLetter })` diff was written against `QueueOptions` and would not have compiled. The card also reports per-queue `failed` counts over 24 h — the leading indicator, since jobs that fail and then retry successfully never reach the DLQ at all. | `createQueue` sets `retryLimit` / `retryBackoff` / `expireInSeconds` on all of them and no `deadLetter`, so a job that exhausts its retries moves to `failed` in `pgboss.job` and nothing ever reads it — no admin surface, no cron check, no alert. Same failure shape as the three-week silent backup failure (§0f), which was solved with a status endpoint + an admin tile; the same shape of fix applies (`/api/admin/queue-health` beside `BackupStatusCard`). | `apps/worker/src/index.ts` | done |
| ~~**Oracle's "copy answer" gives no feedback and throws on a non-secure origin.**~~ **Fixed (v2.11.0).** `onCopy` now returns whether the write landed and `TurnView` owns a per-turn `copyState`, rendering `Copied` / `Clipboard unavailable`. New `oracle.copied` + `oracle.copy_unavailable` keys in all three locales. **The first attempt reached for `common.copied`, which does not exist** — `copied` lives under `sessions` and `welcome` — and `translate()` would have rendered the literal string `common.copied` to users. Caught by grepping for the key rather than assuming it. Last unhardened clipboard call site. | `oracle.tsx:203` is a bare `void navigator.clipboard.writeText(turn.answer)` — no guard, no `copied` state. It is the only remaining unhardened clipboard call site after v2.8.0 (`token-install-wizard`, `skills` ×2, `agent-prompts-card` and now `settings/org` all handle it). Needs a `copied` prop threaded through `TurnView`. | `apps/web/components/brain/oracle.tsx` | done |
| ~~**Registration self-fetches over the public origin with no error handling.**~~ **Fixed (v2.11.0).** Both server actions now POST to `127.0.0.1:${PORT}` (overridable via `INTERNAL_SELF_ORIGIN`) inside a `try`/`catch` that redirects to the existing `registration_failed` copy. Previously they built the URL as `NEXTAUTH_URL ?? AUTH_URL ?? "http://localhost:3000"` — wrong twice: `NEXTAUTH_URL` is the Auth.js **v4** name and was checked FIRST despite this repo running v5, and `AUTH_URL` is required to be the browser-facing origin, so in production the container called itself back out through Caddy, needing self-egress and split-horizon DNS. With no `try`/`catch`, a rejected fetch surfaced as Next's generic error boundary **on the account-creation step**. | The `/signin?mode=register` server action POSTs to its own API via `process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "http://localhost:3000"`. `NEXTAUTH_URL` is the Auth.js **v4** name and is checked *first* despite this repo being on v5 and wiring only `AUTH_URL` — which `.env.example` requires to be the exact browser-facing origin. So in production the web container calls itself back out through Caddy, requiring self-egress and split-horizon DNS, and there is **no `try`/`catch`**: a rejected fetch surfaces as Next's generic error boundary on the account-creation step. | `apps/web/app/signin/page.tsx` | done |
| ~~**Org knowledge sharing silently did not apply over MCP — and `AGENTS.md` promised it did.**~~ **Fixed (v2.10.0).** Two halves; fixing either alone would have left the claim just as false. **(a) Retrieval:** nothing on the MCP path populated `accessibleProjectIds`, so `kra.retrieve` took its empty-list branch and, behind the `ownerUserId` pin, returned only the caller's own rows — Phase-4 `visibility:'org'` worked in the webapp and nowhere else. `apps/mcp-server/src/org-scope.ts` now resolves it from the project's **own** `organizationId` (read from the DB, never client-supplied) and re-checks `OrganizationMember`. It fails **closed** — `{}` on any error — because failing open costs a tenant boundary while failing closed costs one teammate's rule. **(b) Writes:** `brain_teach_knowledge` left `visibility` at its `'project'` default, which the owner gate deliberately does not share, so a "decision" was never org-visible to begin with. A `scope:"project"` teach tagged `decision` is now written `visibility:"org"`; nothing else changes. The widening lives in ONE extracted helper, `buildOwnerGate` (`scope-filter.ts`), used by both `kra.ts` and `oracle.ts` — inlining it twice would have recreated this audit's own sibling-drift finding, which is exactly what the first draft of this change did before it was refactored. **Verified against a real pgvector fixture running the exact generated SQL:** an org member gets their own rows **plus** a teammate's `visibility:'org'` row, while a teammate's `project` row, a teammate's `private` row, and another org's `org` row are all still refused; for a non-member the emitted SQL is byte-identical to the pre-change form. | `packages/core/src/scope-filter.ts`, `kra.ts`, `oracle.ts`, `apps/mcp-server/src/org-scope.ts`, `tools/teach.ts`, `AGENTS.md` | done |
| ~~**No gate anywhere asserted container health — a broken healthcheck shipped silently.**~~ **Fixed (v2.10.1).** `smoke.sh` checked HTTP endpoints only, and the worker has no HTTP surface, so a running-but-broken worker passed every check. That is how v2.8.0's healthcheck (`node -e "require('pg')…"`, which cannot resolve a transitive dep under pnpm's isolated `node_modules`) failed on every interval while deploy reported success — found by hand with `docker inspect`, not by any gate. Smoke now fails when any compose service reports `unhealthy`, printing that container's last probe output so the failure is diagnosable from the deploy log alone. **Deliberately "nothing is unhealthy" rather than "everything is healthy":** `caddy` declares no healthcheck, and a gate that failed on services which never declared one would cry wolf every run — a gate that cries wolf gets switched off, which is how you end up with no gate. `starting` warns without failing, since smoke runs immediately after deploy and `start_period` is up to 40 s. **Chose the deploy over CI on purpose:** a full `docker compose up` in CI costs minutes on every PR and duplicates what deploy already does; its only marginal benefit is catching the bug before *merge* instead of before *traffic*, and with autonomous-deploy-on-green, before-traffic is the boundary that protects the instance. Verified both directions — passes against the live stack, and detects a deliberately-broken container (reproducing the original `require('pg')` failure) while ignoring one with no healthcheck defined. | `scripts/smoke.sh` | done |
| ~~**Neither Caddy nor the app rate-limits `/mcp`.**~~ **Fixed (v2.11.0).** The MCP vhost now carries a 30/s/IP `rate_limit` zone. Defence in depth rather than the fix — v2.8.0 already removed the anonymous amplifier by rejecting an invalid bearer before a session is allocated. 30/s sits far above a real editor (a working session is a handful of calls per minute) while still bounding a spray. | `proxy.ts` matches `/api/:path*` only, and the MCP vhost in the Caddyfile has no `rate_limit` directive — so bearer guessing and session-spray are throttled by nothing at either layer. The v2.8.0 auth fix removes the anonymous amplifier; an edge limit is still worth adding. | `deploy/Caddyfile`, `apps/web/proxy.ts` | done |
| **`header_up X-Forwarded-For {remote_host}` is load-bearing and undocumented.** Caddy *replaces* rather than appends XFF, and the app reads `split(",")[0]` — the **first** element. Under Caddy's conventional appending form that first element would be client-supplied, and every per-IP limit (5 registrations/hr, 10 voucher attempts/hr, 100 Oracle calls/day) would be bypassable by rotating a header. Anyone "fixing" these lines to the append form, or fronting the stack with a different proxy, silently turns the limiters off. Comment added in v2.8.0; recorded here because the trap outlives the comment. | `deploy/Caddyfile`, `apps/web/proxy.ts` | documented |

---

## 0r. UI/UX + accessibility audit (2026-08-05, v2.13.0)

A project-wide UI/UX, accessibility and deployment-readiness audit. The
aesthetic half found nothing — zero AI-template tropes, and the token palette
already passes AA on every text/surface pair. What it did find was two
instances of the same meta-failure this repo keeps hitting: **a defect fixed as
an instance, never as a class.**

| Issue | Where | Status |
|---|---|---|
| ~~**The install-snippet URL defect survived in two more surfaces.**~~ **Fixed (v2.13.0).** The `${hostname}:3100/mcp` bug (§0c worked example) was fixed for `/welcome` and guarded by `e2e/welcome-public-urls.spec.ts` — a spec named after a **page**. It was still live in (a) `/settings/tokens`, a `"use client"` page that *structurally could not* read `BRAIN_MCP_PUBLIC_HOSTNAME`, and (b) the onboarding modal, which hardcoded the endpoint and told the operator to hand-edit it — pointing them at the tokens page for the correct value, which was itself wrong. Behind Caddy the MCP server is its own vhost on :443, so the guessed port is closed and first-run copy-paste fails. Resolution is now centralized in `apps/web/lib/brain/public-urls.ts`; per-surface duplication is *why* it kept reappearing. Guarded by `lib/brain/public-urls.test.ts`, a **source-level** test named after the bug class that needs no DB and runs unconditionally. | `apps/web/app/settings/tokens/`, `components/brain/onboarding.tsx`, `lib/brain/public-urls.ts` | done |
| **20 of 31 Playwright specs are referenced by NEITHER e2e workflow.** Both workflows name their specs explicitly and the lists drifted far behind the suite. Never run: `a11y`, `autoskill`, `credentials-signup`, `empty-dashboard`, `graph`, `i18n`, `onboarding`, `onboarding-orientation`, `oracle`, `org-invites`, `palette`, `password-reset`, `projects`, `responsive`, `settings-org`, `signout`, `streaming`, `tokens`, `tweaks`, `visual`. `a11y.spec.ts` — the suite most relevant to an accessibility audit — has never gated a single PR. This is the **same defect** `authed-e2e.yml:205-215` documents for one earlier spec: found once, fixed for that file, never generalized. Verify with `grep -rhoE 'e2e/[a-z0-9-]+\.spec\.ts' .github/workflows/*.yml \| sort -u` against `ls apps/web/e2e/*.spec.ts`. **Deliberately not fixed in v2.13.0** — enabling 20 dormant specs will surface pre-existing failures and belongs in its own PR, not smuggled into an audit remediation. **Scoped 2026-08-07, and it is smaller than it looks:** the authenticated harness already exists and works — `authed-e2e.yml` spins a real stack, sets `E2E_ADMIN_USERNAME=alex` / `E2E_ADMIN_PASSWORD=e2e-ci-throwaway-password`, bcrypts it into `ADMIN_PASSWORD_HASH`, and `playwright.config.ts` turns that into a `setup` project that signs in once and persists `storageState`. The dormant specs are dormant **only because the workflow names 8 specs explicitly** (`dashboard`, `meetings`, `mobile-overflow`, `nav`, `page-scroll`, `security`, `sessions`, `skills`). So the task is "add spec names and triage what fails", not "build auth for e2e". Measured: running the 5 nominally auth-free dormant specs (`a11y`, `i18n`, `responsive`, `tweaks`, `visual`) against a live instance **without** `E2E_ADMIN_PASSWORD` yields **2 passed, 48 skipped** — they need the shell mounted, so enabling them without the auth gate would add ~50 skipped tests and near-zero coverage. **Not attempted on this host:** spinning a test stack here is unsafe — `dev-up.sh` and `deploy.sh` share the compose project name `deploy`, so it would rebuild the live containers and seed the demo fixture into the production database. Do it on a throwaway host or with an isolated `-p` project name. | `.github/workflows/{onboarding,authed}-e2e.yml`, `apps/web/e2e/` | **open** |
| ~~**Focus indicators missing on textareas and links.**~~ **Fixed (v2.13.0).** `globals.css` reset `outline: 0` on `input, textarea` but the restoring `:focus-visible` rule listed only `input` — every textarea in the app (Teach, Oracle, meetings transcript, autoskill edit) was keyboard-invisible. No `a:focus-visible` rule existed at all in 1091 lines. WCAG 2.4.7. **Lesson:** when a reset names a set of elements, the rule that restores the affordance must name the same set — check both halves. | `apps/web/app/globals.css` | done |
| ~~**Inline prose links were indistinguishable from body text.**~~ **Fixed (v2.13.0).** The global `a { color: inherit; text-decoration: none }` is correct for nav chrome but left prose links with no colour delta and no underline — undiscoverable (WCAG 1.4.1). Fixed with `p a:not([class]), li a:not([class])`, scoped that way because every nav link in the app carries a className and every prose link does not (3 of 21 `<a>` are styled). | `apps/web/app/globals.css` | done |
| ~~**Destructive reset button failed AA contrast.**~~ **Fixed (v2.13.0).** `/settings/reset-knowledge` rendered `color: white` on `background: #e05252` = **3.82:1**, below the 4.5 floor, on the most destructive control in the product. Hardcoded values also bypassed the token system. Now `--bg` on `--bad` = 8.36:1. The same page reported bulk-delete results visually only — a screen-reader user got no confirmation that N rows were deleted (WCAG 4.1.3); result panels are now in an `aria-live` region. | `apps/web/app/settings/reset-knowledge/page.tsx` | done |
| ~~**Admin audit log pinned a stale error forever.**~~ **Fixed (v2.13.0).** `setError` was only ever *set*, never cleared at the start of a load, so one transient failure left the banner on screen for the rest of the session — including above freshly-loaded rows, i.e. the page showed correct data under an incorrect error. Also had no loading state (empty `<tbody>` indistinguishable from "no results"), no retry, a table clipping six columns on mobile via `overflow: hidden`, and filters firing a `LIMIT 200` query per keystroke. | `apps/web/app/admin/audit/page.tsx` | done |
| ~~**Thai locale had a font swap but no leading compensation.**~~ **Fixed (v2.13.0).** `html[lang="th"]` swapped to Noto Sans Thai but never adjusted `line-height`. Thai stacks an upper vowel above the base glyph and a tone mark above that. **Measured** in headless Chromium against the real webfont: docs `h1` at 32px/1.1 gives a 35.2px line box against 42px of ink — a **6.8px overlap**; `.rail-user-meta` at 12px/1.1 overlaps by 3.8px. A Latin control at the identical 32px/1.1 does *not* collide, confirming it is Thai-specific. The 13px/1.35 sites clear by 0.55px and were **not** defects — an earlier draft of the audit wrongly listed them. | `apps/web/app/globals.css` | done |
| ~~**Autoskill reject was irreversible and unguarded.**~~ **Fixed (v2.13.0).** Adds a `"unreject"` action (`rejected → pending`), safe to expose because rejecting is a pure status flip that writes no knowledge rows — unlike apply. Surfaced as a 10s undo toast in a `role="status"` live region. No migration needed: `status` is a plain `String`, `resolvedAt` already nullable. | `apps/web/app/api/autoskill/proposals/[id]/route.ts` | done |
| **`prefers-reduced-motion` was unsupported**, despite two infinite-loop keyframes (`pulse` on the live-dot, `bp-blink` on the Oracle caret). Fixed (v2.13.0) with a global reduce block. | `apps/web/app/globals.css` | done |

### Corrections issued during this audit

Recorded because the audit's own errors are the more useful artifact:

1. **A WCAG Level A violation was introduced by the audit itself.** The first pass added <kbd>J</kbd>/<kbd>K</kbd>/<kbd>A</kbd>/<kbd>R</kbd>/<kbd>U</kbd> shortcuts on a global `window` listener. That violates **WCAG 2.1.4 Character Key Shortcuts (Level A)**, which requires single-character shortcuts to be turn-off-able, remappable, or active only on focus. The input guard skipped only text-entry elements, so tabbing to a link and pressing <kbd>R</kbd> would still have rejected a proposal. Removed at the operator's direction. Standard keyboard operability (Tab/Enter/Esc, focus rings) is a separate, mandatory category and was retained.
2. **The audit rated i18n and responsive coverage a pass by citing specs that never run.** Corrected once the workflow wiring was traced — see the 20-spec row above.
3. **The audit's e2e addition failed CI** by putting an authed assertion in `welcome-public-urls.spec.ts`, which runs in the **anon** job (`auth_not_configured` → fill timeout). Moved to `e2e/tokens.spec.ts`. That file runs in no workflow, so the guard that actually gates the bug class is the source-level vitest one.
4. **`esbuild` parse-checking is not type-checking.** Four files parsed clean and then failed `tsc`: the workspace sets `exactOptionalPropertyTypes`, under which `foo?: string` rejects an explicitly-passed `undefined`.

---

## 0s. Unattended-operation audit (2026-08-05, v2.13.0 prod redeploy)

Found while redeploying `main` (`4c16f8e` → `7780eec`) onto the nginx-fronted
prod host. The code deployed cleanly — every defect below was in the parts
nobody watches: **the things that were supposed to run by themselves and
didn't.** Both headline findings share one shape: *a scheduled job that
reports success while producing nothing*, invisible until the moment you need
its output.

| Issue | Where | Status |
|---|---|---|
| ~~**Nightly backups had never produced a single file.**~~ **Fixed.** `deploy_brain_backups` was empty after months of "nightly" backups. Two independent causes, either alone sufficient: (a) the `backup` service carried `profiles: ["edge"]`, but the nginx-fronted topology (§#164) never runs `--profile edge` — only `deploy.sh` passes it, and this host cannot run `deploy.sh` because its Caddy sidecar collides with nginx on :443. So the container **never started**. (b) Its image was pinned `postgres-backup-local:15` against a `pgvector:pg16` server, and `pg_dump` refuses to dump a *newer* server — so it would have failed silently even if started. The `:16` bump shipped in v2.13.0, but **fixing (b) alone changes nothing** while (a) keeps the service down; the two look identical from outside (empty volume, no error anyone reads). Backups are orthogonal to who terminates TLS, so the profile gate is now removed — `backup` is default-on. Verified by dumping and counting: 34 `Knowledge` rows in the dump against 34 live. | `deploy/docker-compose.yml` | done |
| ~~**A renewed TLS cert was never served, silently breaking every MCP client for 11 days.**~~ **Fixed.** `mcp.brain.autobahn.bot` served a cert that expired 2026-07-25; all MCP traffic failed `curl (60) certificate has expired` / HTTP 000, and the onboard script died at its smoke step. Two layers: (a) the wildcard `*.autobahn.bot` covers `brain.autobahn.bot` but **cannot** cover a two-level subdomain — TLS wildcards match exactly one label — so MCP has its own cert whose expiry nobody tracked. (b) The one that actually bites: **no certbot deploy hook existed**, and nginx only re-reads cert files on reload. A successful `certbot renew` therefore left nginx serving the expired cert from memory indefinitely. Recognise it by the split: `openssl x509 -in /etc/letsencrypt/live/<n>/fullchain.pem` shows the NEW date while `openssl s_client -connect <host>:443` shows the OLD one. Fixed by `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` (`nginx -t` then `systemctl reload nginx`; fires only on actual renewal, applies to every cert). | host: `/etc/letsencrypt/renewal-hooks/deploy/` | done |
| **Most of the e2e suite cannot run against a populated instance.** Of 31 specs, ~22 write data (`credentials-signup`, `org-invites`, `tokens`, `projects`, …) — pointing them at a real deployment injects junk users/orgs/tokens into live data. Only `healthz` is genuinely auth-free. Compounding it, `nav.spec.ts:19-20` asserts in a comment that auth mode "redirects to /signin then back… either way we end up at / with the BrainApp mounted", which is **false** for CREDENTIALS mode without a cookie: `/` → 307 → `/signin` and stays, so `nav.rail` never mounts and 4 tests fail for environmental reasons that read as regressions. Its third test handles this correctly via `test.skip()`; the first two do not. Related to the 20-dormant-specs row in §0r. | `apps/web/e2e/nav.spec.ts`, `apps/web/e2e/` | **open** |
| **Prisma CLI is unusable from a host shell without rewriting the DB host.** `.env` carries `DATABASE_URL=…@db:5432/brain`, where `db` is a compose *service name* that resolves only inside the compose network. Every host-shell Prisma command therefore dies `P1001: Can't reach database server at db:5432`, which reads like an outage rather than a name-resolution mismatch. Use `DATABASE_URL="${DATABASE_URL/@db:5432/@127.0.0.1:5433}"`. Separately, a bare `pnpm exec prisma` does **not** auto-load `.env` (compose does, via `--env-file`), so `prisma.config.ts` sees `process.env.DATABASE_URL` undefined and reports the misleading "The datasource.url property is required in your Prisma config file". | `docs/DEPLOY_CHECKLIST.md` | documented |
| **A stale generated Prisma client fails typecheck in a way that looks like bad code.** After pulling schema changes, `pnpm turbo run typecheck` fails with e.g. `'extractionStatus' does not exist in type SessionUpdateInput`. Docker builds regenerate the client internally so containers are correct — it is only the *host's* `packages/db/src/generated/client` that is stale. Run `prisma generate` before reading anything into the error. | `docs/DEPLOY_CHECKLIST.md` | documented |

**The class:** every item here is a *silent* failure of an unattended
mechanism — a backup that never ran, a renewal that never took effect, a test
suite that cannot execute where it matters. None surfaced an error to anyone;
all three were discovered only because a human went looking during unrelated
work. Where §0r's lesson was "fix the class, not the instance", this one is:
**an automated mechanism is not verified until you have inspected its
output.** A green container, a zero exit code, and a "renewals succeeded"
banner each proved nothing here. Verify the artifact — count rows in the dump,
read the cert off the wire — not the process that claims to produce it.

---

## 0t. Writes went to the wrong Brain (2026-08-06)

The direct sequel to §0s, and the same lesson pointed at the product itself.
While fixing the §0s defects, the agent recorded six knowledge rows — five
rules and one decision — via
`brain_teach_knowledge` and verified the loop end-to-end — teach, retrieve,
inject, close, `SQS 88`. Every call succeeded and returned a real knowledge id.
**All of it was written to the wrong instance.**

| Issue | Where | Status |
|---|---|---|
| ~~**Re-onboarding mid-session silently writes to the previously-connected Brain.**~~ **Documented.** Claude Code binds its MCP configuration **at session start**. The operator re-ran `onboard.sh` against prod during a live session whose client had connected to `mcp.brain-dev.autobahn.bot`; the installer rewrote `~/.claude.json` correctly, but the open client kept using the dev connection. All six of those writes landed on **dev** and are absent from prod — confirmed by `select id from "Knowledge" where id in (…)` returning 0 rows on prod. Nothing errored at any point: the tool calls returned ids, the round-trip verification passed, and the agent reported the loop "verified end-to-end" while verifying the wrong host. The installer already prints "Restart Claude Code first", but it reads as a convenience note about tool visibility, not as *"until you do, your writes go somewhere else."* | `apps/web/app/api/onboard.sh`, `docs/CLIENTS.md` | documented |
| **An empty MCP result is a signal, not a pass.** `brain_get_user_style` returned ~30 reflexes one day and **0** the next. The connection was healthy both times; the difference was which Brain answered. Two legitimate causes look identical to a fault: (a) you are talking to a different instance, (b) the token's user genuinely owns no knowledge — on this prod host all 34 pre-existing rows belong to two `alex@*` demo/seed personas, and the operator's `admin@…` account owned none. Reporting "connection works" on a non-error response would have concealed the misrouted writes for as long as nobody compared instances. | `docs/CLIENTS.md` troubleshooting table | documented |
| ~~**Diagnosing this required DB access, which an ordinary user does not have.**~~ **Fixed.** The only conclusive check was `select id from "Knowledge" where id = '<returned-id>'` against Postgres — unavailable to a self-hoster on a managed host and to every non-admin, i.e. to exactly the people it fails for. `brain_whoami` now returns the three facts that distinguish instances in one call: the deployment's own public hostname and database name (read from the SERVER's env, so it is the fact a client cannot know or get wrong), which user/token the bearer resolves to, and how much knowledge that user holds — so "0 reflexes" reads as *fresh instance* or *wrong instance* rather than *something is broken*. Takes no argument, is deliberately not capability-gated (a diagnostic a restricted token cannot call is useless precisely when the restriction is the confusion), and returns no secret material — pinned by a test that strips comments before searching, and **verified non-vacuous** by injecting a `tokenHash` field. | `apps/mcp-server/src/tools/whoami.ts` | done |

**Operator decision (2026-08-06):** the stranded dev knowledge is **not**
migrated. The prod Brain (`brain.autobahn.bot`) is the system of record from
this date; the four host-specific ops rules from §0s were re-taught here (plus
the start-fresh decision itself, five rows in total), and
dev's remaining rules are historical. Prod's near-empty starting state is a
deliberate choice, not data loss to repair — recorded as a `decision`-tagged
project rule so a future session doesn't try to "fix" the asymmetry.

**The class:** §0s was about mechanisms that report success while producing
nothing. This is the same failure one level up — *the verification itself*
reported success while measuring the wrong system. A round-trip test proves the
loop is closed; it says nothing about **which** loop. When a check can pass
against the wrong target, identify the target as part of the check.

---

## 0u. Every JSON install snippet was the wrong shape (2026-08-06)

Found while auditing the token wizard for copy-button consistency — the
reported symptom was cosmetic; the defect underneath was that **five of the
eleven generated configs did not work**, and one could silently remove the user's *other* MCP server entries.

All five JSON clients shared one helper, `mcpServersLines()`, emitting an
invented shape:

```json
{ "mcpServers": { "brain": { "transport": { "type": "http", "url": "…" }, "headers": { … } } } }
```

No MCP client documents `transport: { type, url }` as a config key. Each of the
five wants something different, and every one of them fails **silently** —
the entry is ignored, not rejected:

| Client | Needs | Got |
|---|---|---|
| Claude Desktop | `command`/`args` **stdio bridge** (`mcp-remote`) | `transport.url` — ignored, and can drop the whole `mcpServers` block on next save, taking the user's OTHER servers with it ([anthropics/claude-code#37286](https://github.com/anthropics/claude-code/issues/37286)) |
| Cursor | flat `url` | `transport.url` |
| Windsurf | `serverUrl` | `transport.url` |
| Gemini CLI | `httpUrl` (it reserves `url` for SSE) | `transport.url` |
| Generic fallback | flat `url` | `transport.url` |

| Issue | Where | Status |
|---|---|---|
| ~~**Five JSON install snippets emitted a shape no client accepts.**~~ **Fixed.** Each generator now emits its client's documented field, and the generic fallback's note enumerates the deviations so a user on an unlisted client can adapt. The shared "one standard entry" helper is gone — replaced by `wrapServerEntry(entry, wrapper)`, which deliberately takes the entry shape as an argument, because assuming a shared shape is what caused this. | `packages/core/src/install-snippets.ts` | done |
| ~~**`docs/CLIENTS.md` contradicted the wizard, and was itself half-stale.**~~ **Fixed.** The doc said Cursor and Windsurf were "stdio-only, wrap with `mcp-remote`" (true when written, now wrong — both speak native HTTP) while correctly specifying the `mcp-remote` bridge for Claude Desktop (which the wizard ignored). Two surfaces, opposite errors, neither checked against the other. | `docs/CLIENTS.md` | done |
| ~~**The onboarding modal hardcoded its own copy of the same wrong JSON**~~ **Fixed.** It also told the reader "Cursor and Windsurf use the same config shape" — false for all three named clients. Now renders from `rawMcpServersJson()` so it cannot drift again. This is the §0r defect class exactly: one value rendered by several surfaces, fixed in one of them. | `apps/web/components/brain/onboarding.tsx` | done |
| ~~**348 passing tests proved only that the output was valid JSON.**~~ **Fixed.** Per-client blocks asserted `JSON.parse` succeeded and the token appeared — both true of *any* shape, including a wrong one. Cursor's and Windsurf's tests still passed after their shape was corrected, which is the proof they were never testing the thing that mattered. Assertions now pin the specific field per client (`url` / `serverUrl` / `httpUrl` / `command`) and assert the *absence* of the others. | `packages/core/src/__tests__/install-snippets.test.ts` | done |
| ~~**No test compared clients against each other.**~~ **Fixed.** Added a cross-client sweep over all 11 clients × 3 OSes asserting the invariants a pasteable snippet must satisfy. It immediately caught an unrelated drift: `claudeDesktop` was the only client of eleven with no `note`, so its users got a wall of JSON and a file path with no instruction. | `packages/core/src/__tests__/install-snippets.test.ts` | done |

**The class:** §0s was a mechanism reporting success while producing nothing;
§0t was a verification measuring the wrong system. This is the third form —
**a test asserting a property weaker than the one that matters.** "Parses as
JSON" is to "is a valid config" what "container is Up" is to "a backup exists".
Each per-client test also only ever looked at its own client, so a property
every client should satisfy was checked only where someone remembered to. When
N surfaces implement one contract, at least one test must range over all N.

---

## 0v. Subpage navigation consistency (2026-08-06)

Audited after §0u, on the same suspicion: if one affordance drifted across
surfaces, others had too. `/admin/*` and `/docs/*` each own their
back-to-Brain link in a **layout**, so every page under them gets it for
free. `/settings/*` did not — its layout was an auth guard only, and each
page hand-rolled its own link. Four rendered a link to `/`; `/settings/password` rendered `← Settings` (pointing at `/settings`, which itself redirects to `/settings/tokens`); `/settings/org` rendered nothing at all.

| Issue | Where | Status |
|---|---|---|
| ~~**`/settings/org` had no route back to the app at all.**~~ **Fixed.** A user who reached Organization settings could leave only via the browser Back button. Not an oversight by one author so much as the predictable outcome of an affordance that lived in four sibling files and nowhere authoritative. | `apps/web/app/settings/org/page.tsx` | done |
| ~~**The four pages that had it disagreed.**~~ **Fixed.** `audit`, `projects`, `reset-knowledge` and `tokens` each rendered their own `← back to Brain` → `/`; `password` rendered `← Settings` → `/settings` (which itself redirects to `/settings/tokens`, so "up" landed on a sibling). Ownership moved to `settings/layout.tsx`, matching `admin/` and `docs/`; the four inline copies are deleted. `password`'s up-level link is kept — it points somewhere different on purpose, and no longer duplicates the root link. | `apps/web/app/settings/layout.tsx` | done |
| ~~**Nothing prevented the next settings page from repeating it.**~~ **Fixed.** `lib/brain/page-home-link.test.ts` walks every `page.tsx` and requires a home link on the page, an ancestor layout, or a component it imports. A new page under a nav-owning layout passes for free; a new top-level section fails until it provides one. **Verified non-vacuous:** reverting the layout link fails 6 settings routes. Source-level (no DB, no browser) so it runs unconditionally — §0r's 20-dormant-specs finding makes an e2e-only guard indistinguishable from no guard. | `apps/web/lib/brain/page-home-link.test.ts` | done |

**Not defects, and worth recording so a later audit doesn't "fix" them:**
`/` is home; `/signin`, `/signup`, `/signout`, `/forgot-password`,
`/reset-password` and `/accept-invite` are pre-auth surfaces where a home link
would bounce the visitor straight back; `/settings` renders nothing (it
redirects to `/settings/tokens`); and `/[orgSlug]/[projectSlug]` renders the
full SPA shell with its navigation rail — it *is* the app, scoped to a
project, not a subpage to escape from.

**The class, restated once more:** an affordance implemented per-page is an
affordance that will be missing from some page. The fix is never "add it to
the one that lacks it" — it is to move ownership somewhere the next author
inherits without knowing it exists. Two sections of this app already did that;
the third had drifted, and only a test that ranges over *all* routes could see
it. Same shape as §0u, where only a sweep across all clients could see that one
of eleven lacked a note.

---

## 0w. Reset and invite tokens were stored raw (2026-08-06)

Found during a privacy audit — the request was to *prove* the privacy
measures, and proving them is what surfaced this.

`PasswordResetToken.token` and `OrganizationInvite.token` persisted the **exact
value emailed to the user**. Lookup was `findUnique({ where: { token } })` on
the raw string, confirming it. Anyone with database read access — a leaked
dump, a compromised credential, an operator — held every live reset link
(1 h window) and every live invite (**7 d** window). `MCPToken.tokenHash` in
the same schema was already SHA-256: the rule existed and was applied
inconsistently.

Both tables were empty at the time (verified: 0 rows each), so there was no
live exposure and no in-flight link to invalidate — which is also why the fix
is a clean rename with no backfill.

| Issue | Where | Status |
|---|---|---|
| ~~**Raw reset/invite tokens at rest.**~~ **Fixed.** Both columns renamed `token` → `tokenHash` and store `hashSecret()` output. The rename is deliberate: a column named `token` invites the next author to compare it against user input, which is how this arrived. Migration `20260806211500_hash_reset_and_invite_tokens`. | `packages/db/prisma/schema.prisma` | done |
| ~~**Seven call sites, and `grep` found only five.**~~ **Fixed.** Two lived in server *page components* (`app/reset-password/page.tsx`, `app/signin/page.tsx`), not API routes, and were caught only because `tsc` rejected the renamed field. A rename that breaks the build is a safer refactor than an in-place semantic change that compiles. | `apps/web/app/**`, `packages/core/src/org.ts` | done |
| ~~**The SHA-256 line was inlined at three MCPToken sites.**~~ **Fixed.** Extracted to `packages/core/src/secret-hash.ts` with the reasoning attached (why sha256 is right for 32-random-byte tokens and wrong for passwords), and adopted at all sites. One rule, one implementation. | `packages/core/src/secret-hash.ts` | done |
| ~~**Nothing prevented the next model from adding a raw one.**~~ **Fixed.** `secrets-hashed-at-rest.test.ts` parses `schema.prisma` and fails on any scalar column named `token`/`secret`/`apiKey`/`accessToken`/`refreshToken` outside a justified allow-list. Schema-level on purpose: a test asserting "forgot-password hashes its token" passes while the *next* model adds a raw one. **Verified non-vacuous** — reintroducing a raw column fails it. | `packages/core/src/__tests__/secrets-hashed-at-rest.test.ts` | done |
| ~~**Hashing broke the documented no-email recovery path.**~~ **Fixed.** The handler's own header promised that with `EMAIL_PROVIDER` unset "the operator can look it up manually" — true when the raw token sat in the DB, false the moment it was hashed. On an instance without an email provider, password reset became unrecoverable while the code still told the operator where to look. Caught in review, not by any test: no test asserts a comment is still true. The reset **link** is now written to the server log on both non-delivery paths (`warn`, `sensitive: true`), which stays on the host — `redactFields` applies only to `err.fields`, and Sentry receives `error`-or-worse, so `warn` does not leave the machine. The link is logged ONLY when `ALLOW_RESET_LINK_IN_LOGS=true`; unset, the log carries a non-usable 16-char hash prefix for correlation. **The first version logged unconditionally**, reasoning that a log beats a raw token in the database — a false dichotomy that ignored "neither", and default-on credential logging contradicts hard rule #2. Caught by automated security review, not by me. A second miss followed: the flag was added to `env.ts` but **not** to `docker-compose.yml`, so setting it in `.env` would have done nothing and the operator would have had no way to tell — the §0p passthrough trap, hit while fixing §0w. Both halves are now verified against the running container. **Proven end-to-end on prod:** flag off → only a `tokenIdHash` in the log; flag on → the logged link hashes to the stored row, the reset completes, the token is marked used, and a replay returns `invalid_token`. | `apps/web/app/api/auth/forgot-password/route.ts` | done |
| **Backups now capture more than they used to.** Enabling nightly dumps (§0s) means any short-lived secret present at 03:00 is also on disk for 7 daily / 4 weekly / 6 monthly cycles. Hashing removes the sting for these two tables; the general point stands for whatever is added next. Off-host replication remains opt-in and disabled. | `deploy/docker-compose.yml` | **open** |

**The class:** §0u was a test asserting a property weaker than the one that
mattered. This is its security-shaped twin — the *codebase* knew the rule
(`MCPToken` did it correctly) and applied it to one of three models. Neither a
per-model review nor a per-endpoint test can see that; only a check that ranges
over the whole schema can. Third time this week that the fix was "assert the
invariant across all N", after §0u (all clients) and §0v (all routes).

Documented in [`docs/PRIVACY.md`](./PRIVACY.md), written after the fix so it
describes a posture that is actually true.

---

## 0x. Pilot-readiness validation (2026-08-07)

Ran the whole customer journey against live prod before inviting anyone,
rather than reasoning about it from the code.

**Validated working** (probe user created, exercised, deleted; residue checks
all zero):

| Step | Result |
|---|---|
| Register with a valid voucher | account + personal org + default project created |
| Reuse the same single-use voucher | rejected — `voucher_exhausted` |
| Register with **no** voucher | rejected — `voucher_required` |
| Sign in with email + password | real authenticated session |
| Mint an MCP token | succeeds, scoped to the user's own org |
| `/api/dashboard/health`, `/api/knowledge` | 200 |
| `/admin` as a non-admin | **307** — correctly blocked |
| `nav-smoke.sh` | PASS, no 5xx on any surface |
| Demo-data isolation | all 34 seed rows are `visibility: project` in single-member personal orgs — invisible to a new user |

| Issue | Where | Status |
|---|---|---|
| ~~**A seeded demo persona held `role=admin` on production.**~~ **Fixed.** `alex@brain.local` came from the seed fixture with admin rights. Not exploitable as it stands — the account has no `UserCredential` and `.local` is unroutable — but an admin-roled demo account on a customer-facing instance is the kind of thing that becomes exploitable the moment auth config changes. Demoted to `user`. | `User` table | done |
| **Deleting a User leaves an orphaned Organization and Project.** Found while cleaning up the probe: `Organization` has no cascading FK from `User`, so the personal org and its default project survive the delete and had to be removed by hand. This matters for the GDPR erase path, whose header states "cascade-delete relations fire naturally via Prisma's `onDelete: Cascade`" — true for Knowledge and Sessions, **not** for the org tree. An erased user currently leaves a named, empty org behind. | `packages/db/prisma/schema.prisma`, `/api/admin/gdpr/erase` | **open** |

**Not yet pilot-ready — blocked on operator input, not on code:** no email
provider (so invites cannot be sent and a password reset produces a token
nobody can use), `ADMIN_EMAILS` empty (nobody is granted admin on first
sign-in), and zero vouchers minted. The signup *path* is proven; the
*credentials to run it* are the operator's to supply.

---

## 0y. Email delivery could never work in Docker (2026-08-07)

Surfaced by the operator asking a simple question while preparing the pilot:
*"there's no place to put the Resend API key in .env"*. There wasn't — and
following that thread found three independent breakages stacked on one path,
each sufficient on its own to make outbound email impossible.

| Issue | Where | Status |
|---|---|---|
| ~~**No email variable was forwarded by compose.**~~ **Fixed.** `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` and both accepted aliases were absent from the `web` service's `environment:` block, so the container saw them **UNSET** no matter what `.env` said. `EMAIL_PROVIDER === "resend"` was unreachable on *every* containerised deployment — while `.env.example` and `DEPLOY_CHECKLIST` both instructed operators to configure it. Third occurrence of the §0p passthrough trap in two days. | `deploy/docker-compose.yml` | done |
| ~~**Both callers ignored the auto-detect the library advertises.**~~ **Fixed.** `sendEmail()` deliberately treats a populated key as Resend even when `EMAIL_PROVIDER` is unset — its comment says that exists because "operators commonly drop a key into .env without remembering the toggle", and `.env.example` documents exactly that. But `forgot-password` and the org-invite route each tested `process.env.EMAIL_PROVIDER === "resend"` themselves, so an operator who set **only the key** got a system where `sendEmail()` would have delivered and nothing ever called it. One rule, three implementations. Now `isEmailConfigured()` in `email.ts`, used by both. | `packages/core/src/email.ts`, `apps/web/app/api/**` | done |
| ~~**The live `.env` had no email block at all.**~~ **Fixed.** The deployed `.env` predates the template's email section, so the fields simply did not exist on disk — the operator's original observation, and correct. Added with setup instructions. Also clarified `.env.example`: the key field is named `EMAIL_API_KEY`, which is why searching for "RESEND_API_KEY" found nothing; the aliases are now named next to it. | `.env`, `.env.example` | done |

**The class, again:** every layer looked right in isolation. `email.ts` was
correct. `.env.example` documented the right key. The callers read plausibly.
The defect lived in the *seams* — schema-to-compose, library-to-caller,
template-to-deployed-file — which is the same shape as §0u (5 of 11 clients),
§0v (4 of 5 pages), §0w (1 of 3 token models) and §0p. Nothing but a check
that ranges across all N surfaces finds it.

Guarded by `email-configured.test.ts`, which walks every file under `apps/`
and fails on any local `EMAIL_PROVIDER ===` check. **Verified non-vacuous**
both ways: reintroducing a caller-local check names the offending file, and
removing the auto-detect fails the key-only case.

**Confirmed live 2026-08-07 with a real Resend key**, which is the check the
PR left open. Both callers now deliver: `forgot-password` logged
`"password reset email sent"` with a Resend message id, and the org-invite
route returned `emailSent: true` / HTTP 201 with its own id — sent to
`delivered@resend.dev`, Resend's test sink, so no real inbox was involved.
Before the fix both paths logged "EMAIL_PROVIDER not configured". The
emailed invite token was also confirmed stored as its SHA-256 (§0w) with the
raw value absent from the row.

---

## 0z. The Antigravity config path went stale under us (2026-08-07)

Raised by the operator: *"gemini cli change to antigravity cli already"*. It
had, and the consequence was larger than a rename.

Google retired Gemini CLI for consumer accounts on **2026-06-18** and folded it
into a new Go-based **Antigravity CLI**
([announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)).
Enterprise access continues. The merge also **moved the config file**: the
Antigravity IDE and the new CLI now share
`~/.gemini/config/mcp_config.json` (workspace-local: `.agents/mcp_config.json`),
per [Google's MCP docs](https://antigravity.google/docs/mcp).

| Issue | Where | Status |
|---|---|---|
| ~~**The Antigravity `configPath` pointed at a directory nothing reads.**~~ **Fixed.** We emitted `~/.gemini/antigravity/mcp_config.json`, correct when written (v1.7.0, §5ar) and dead since the 2026-05-19 merge. The JSON **shape** was right — `mcpServers` → `serverUrl` + `headers` is still exactly what Antigravity wants — so a user pasting our snippet into our path got a syntactically perfect config in a location the client never loads: no error, no server, nothing to diagnose. Now `~/.gemini/config/mcp_config.json`, with the note naming both the IDE route and the CLI's direct-edit route. | `packages/core/src/install-snippets.ts` | done |
| ~~**"Gemini CLI" was offered as a current client.**~~ **Fixed.** Relabelled "Gemini CLI (legacy — retired 2026-06-18)" and its note now points at Antigravity. Kept rather than deleted because enterprise access continues, so removing it would strand those users — but a consumer picking it today would configure a tool they no longer have. | `token-install-wizard.tsx`, `install-snippets.ts` | done |
| ~~**Three docs carried the dead path.**~~ **Fixed.** `CLIENTS.md`, `QUICKSTART.md` and `APPROACH.md` §5ar all named `~/.gemini/antigravity/`. The design spec under `docs/superpowers/specs/` deliberately retains it — it is a point-in-time record of what was true when written, the same convention the changelog rows follow. | `docs/` | done |

**What this one adds to the pattern.** §0u was a shape no client accepts —
wrong data, right place. This is the inverse: **right data, wrong place**, and
it is the harder half to catch. Nothing in the repo could have detected it,
because the defect was not in our code or our tests but in an external product
changing under a value we had hardcoded and pinned with a passing assertion.
The test asserting `~/.gemini/antigravity/...` kept passing precisely *because*
it was pinned to the stale value.

There is no clever fix for that class — an external path cannot be verified
from inside the repo. What is available is cheap: when a snippet's target
product announces a merge, retirement or rename, re-check its config path and
treat "our test passes" as evidence about **us**, not about the vendor.

Verified non-vacuous: reverting to the old path fails 2 assertions.

---

## 0aa. One-line install for every client — and two bugs no static check could see (2026-08-08)

Raised by the operator: *"When I generate token, for claude code, I got command
line to make it automatically. But for the other harness, I have to open the
config and put the json."* Correct, and it had been that way since the wizard
shipped: 1 of 11 clients had a command, 10 had a wall of JSON and a file path.

**Why not just emit each vendor's own command?** Because we checked, and the
coverage isn't there. Of the clients we support, exactly three ship a
non-interactive `mcp add` verb: Claude Code, [GitHub Copilot
CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers),
and [Codex](https://github.com/openai/codex/pull/4904) — and Codex's takes the
*name of an environment variable* rather than the bearer, so even the three do
not share a shape. Cursor offers a `cursor://` deeplink and a settings UI;
Windsurf, Antigravity and Claude Desktop offer a file. So `--client` routes
through our own installer, which uses the vendor verb where one exists and
merges the config file where one doesn't.

| Issue | Where | Status |
|---|---|---|
| ~~**10 of 11 clients had no one-line install.**~~ **Fixed.** `--client <id>` / `-Client <id>` on both installers, covering 10 clients. JetBrains/VS/Eclipse/Xcode and the REST recipe deliberately have none — no stable path and not an install respectively — and now print an explanatory error instead of being silently absent. | `installer-templates.ts`, `install-snippets.ts` | done |
| ~~**Client identity was duplicated across four surfaces.**~~ **Fixed.** The wizard, `/welcome`, the installers and the test sweep each had their own hand-maintained list. Now one `CLIENTS` registry in `@brain/core`; the installers' per-client config tables are *generated* from the same snippet functions the wizard renders, with the bearer as a `__BRAIN_TOKEN__` placeholder. A shape can no longer drift between "what we show" and "what we write". | `packages/core/src/install-snippets.ts` | done |
| ~~**A config merge could destroy a user's other MCP servers.**~~ **Fixed.** The merge backs up (`<file>.bak.<ts>`), preserves every sibling server, writes via temp-file rename, `chmod 600`s the result, and **refuses to write** if the existing file doesn't parse (comments in `mcp.json` are the common cause). Destroying a config we merely failed to understand is the worst available outcome. | `installer-templates.ts` | done |
| ~~**The install ping was hardcoded `claude_code`.**~~ **Fixed.** Every client carries a `sessionClientType`, asserted against the enum `brain_start_session` accepts — an out-of-enum value is rejected and the install records nothing. | `install-snippets.ts` | done |

**The two bugs that only running it could find.** Both were the same mistake:
the installers are TypeScript template literals that emit bash, which embeds
Python in a heredoc. `\n` and `\"` written for Python were consumed by
TypeScript, so the emitted Python read `"…(%s).` + a real newline, and
`print("… under "%s"")`. Both produce `SyntaxError` **at run time**.

Everything static passed. `tsc` passed — it's a valid string. The unit sweep
passed — it asserted the *bash* was well-formed. `bash -n` passed, and this is
the instructive part: **to bash, a quoted heredoc is data**, so a syntax error
inside it parses perfectly clean. The first evidence of a broken installer was
running it.

The guard is now `installer-clients.test.ts`, which *executes* the generated
script against a sandbox `HOME` with a stubbed `curl` (so the smoke test can't
reach the network) and asserts the **resulting file**: brain entry present and
byte-identical to the wizard's, siblings preserved, backup created, no
placeholder left behind, bad JSON left untouched. Static checks verify the
layer you wrote; only execution verifies the layer you generated.

This is [§0u](#0u-every-json-install-snippet-was-the-wrong-shape-2026-08-06)'s
lesson one level down: a test that asserts the artifact parses is not a test
that the artifact works.

Verified non-vacuous: both escaping bugs were found by the executed test, not
by `tsc`, the unit sweep, or `bash -n`.

---

## 0ab. `reload.sh` stamped every build as version `dev` (2026-08-08)

Raised by the operator: *"Why bottom left of menu bar show dev, not the real
version?"* Because it genuinely was `dev` — not a display fallback.

`deploy/docker-compose.yml` passes `APP_VERSION: ${APP_VERSION:-dev}` as a
build arg, which the Dockerfile turns into `NEXT_PUBLIC_APP_VERSION`. That is
**inlined into the client bundle at build time**, so it cannot be corrected by
restarting a container — only by rebuilding. `deploy.sh` and `dev-up.sh` both
exported `APP_VERSION` from `git describe`. `reload.sh` — the script that
handles most rebuilds, by its own docstring — did not. Any service last
rebuilt that way served the literal string `dev` from both the rail footer and
`/api/healthz`, on a correctly-tagged release.

| Issue | Where | Status |
|---|---|---|
| ~~**`reload.sh` didn't export `APP_VERSION`.**~~ **Fixed.** Same `git describe` line the other two entrypoints use, before the build. | `scripts/reload.sh` | done |
| ~~**Nothing checked that build entrypoints stamp the version.**~~ **Fixed.** `build-version-stamp.test.ts` ranges over every `*.sh` that triggers a Docker build and asserts the export exists, derives from `git describe`, and precedes the build command. | `apps/web/lib/brain/build-version-stamp.test.ts` | done |

Two details worth keeping. First, the sweep's first version matched
`compose build` **inside a comment** — every one of these scripts documents its
own build invocation in its header — so the ordering assertion compared against
a position ~2500 chars before the real command. Comment-stripping was needed to
make the test mean what its name says; this is the same trap as the home-link
matcher that accepted `// href="/"` ([§0v](#0v-subpage-navigation-consistency-2026-08-06)).
Second, the sweep asserts it found at least two build scripts, because a
detector that silently matches nothing passes every downstream assertion.

Verified non-vacuous: reverting `reload.sh` fails 3 assertions. Verified at the
artifact level: `/api/healthz` went from `{"version":"dev"}` to
`{"version":"v2.13.0-6-g3cee904-dirty"}` after a rebuild — per the standing
rule, the mechanism's output was inspected, not its exit code.

---

## 0ac. A fresh `docker compose up` shipped an OPEN instance (2026-08-08)

Found during the pilot-readiness audit. The most serious defect in this file,
and the same shape as every other one: **one rule, N surfaces, one surface
disagreeing — and the disagreeing surface was the one that runs.**

`CLAUDE.md` states the posture: *"The platform is secure-by-default: a freshly-
deployed instance is intentionally locked until you pick an auth mode."*
`auth.ts`'s own docstring repeats it: *"better to be locked shut than serve
every visitor as the first User row."* `.env.example` sets both dev-auth flags
to `"false"`. `scripts/deploy.sh` reads both as `${VAR:-false}`.

`deploy/docker-compose.yml` defaulted **both to `"true"`**.

Resolved against a minimal `.env` (Postgres + one LLM key, which is what
`QUICKSTART` asks for), a fresh deploy produced:

```
ADMIN_USERNAME: ""            # no Credentials
AUTH_GITHUB_ID: ""            # no OAuth
AUTH_SECRET: ""
ALLOW_DEV_AUTH: "true"        # dev shim ON
ALLOW_DEV_AUTH_IN_PRODUCTION: "true"   # production guard DISABLED
NODE_ENV: production
```

That is every branch `getCurrentUserId()` needs to reach the dev shim:
`anySignInConfigured()` false → `devAuthAllowed()` true →
`refuseDevShimInProduction()` does not throw. **Every anonymous request
resolves to the first `User` row**, with that user's knowledge, tokens and
admin surfaces. No error, no warning — the instance simply answers as
somebody.

| Issue | Where | Status |
|---|---|---|
| ~~**Compose defaulted the dev shim ON.**~~ **Fixed.** Both flags now default `false`, matching `.env.example`, `deploy.sh` and the documented posture. A fresh deploy now throws `auth_not_configured` on every request until the operator picks a mode — locked, as promised. | `deploy/docker-compose.yml` | done |
| ~~**Nothing checked what an unconfigured deploy resolves to.**~~ **Fixed.** `compose-secure-defaults.test.ts` runs `docker compose config` against a deliberately minimal env file and asserts the **resolved** values, including that they agree with `.env.example`. | `apps/web/lib/brain/compose-secure-defaults.test.ts` | done |

**Why no existing gate caught it.** `verify-lockdown.sh` is the designated
auth-posture audit and it passes on this host — because it probes a **running
instance**, and any instance configured enough to probe has already set these
in `.env`. The defect existed only in the gap between the template and an
*unconfigured* deploy, which no running instance can exhibit. That is the
`§0a` fresh-host class again: the checks all inspect a system that has already
been rescued by a human.

Mitigating factors, for honesty about severity: `scripts/deploy.sh` refuses
this combination and `die`s with a "No production auth configured" message, so
operators following `QUICKSTART`'s deploy path were protected. The exposure was
anyone bringing the stack up with a bare `docker compose up` — which is a
documented thing to do, and the first thing many people try.

This instance was never affected: its `.env` sets `ALLOW_DEV_AUTH="false"`
explicitly, and the audit above confirmed 401s on every gated surface.

Verified non-vacuous: reverting either default fails 2 assertions.

---

## 0ad. Pilot-readiness audit (2026-08-08, v2.14.0)

Full sweep of the production instance before opening it to pilot customers.
Recorded here because "we checked" is worthless without saying *what artifact
was inspected* — the standing rule from §0s.

**Verified working** (artifact inspected, not status believed):

| Area | Evidence |
|---|---|
| TLS | `openssl s_client` off the wire: both hosts valid to Nov 2026 — read from the server, not from disk |
| Backups | Fresh dump 585K containing 34 `COPY` blocks; the `User` rows were read out of the gzip before any deletion |
| Queues | 2248 jobs `completed`, zero failed, zero dead-lettered, zero orphan sessions |
| Email | Live send through Resend, message id `d9f19e08-…` in the `forgot-password` log line |
| Oracle | Real answer with a citation, on prod, retrieving knowledge taught the same session |
| MCP gate | 401 without a bearer; 401 with a bogus bearer; `initialize` does not leak `serverInfo` |
| Auth | `verify-lockdown.sh` PASS, credentials mode locked |
| Installer | The v3 multi-client installer run for real against prod: registered, skill installed, round-trip smoke-tested, install ping recorded |

**Fixed during the audit:** §0ac (open instance on a fresh deploy) and §0ab
(`dev` version stamp). Both shipped in v2.14.0.

**Operational state corrected:** 34 of 45 `Knowledge` rows and 12 of 15
`Session` rows belonged to seeded demo fixtures (`alex@example.local`,
`alex@brain.local`) — a pilot customer's first view of the dashboard would have
been mostly demo data presented as real activity. Removed, with a verified
backup taken first. The agent's MCP token was also re-minted under the
operator's real account: it had been writing as `admin@brain-platform.local`,
so the operator signing in saw an empty Brain while their agent's learnings
accumulated under a fixture identity.

**Resolved (2026-08-11, issue #218).** `Project.organizationId` is now
`onDelete: Restrict`, explicit and commented in `schema.prisma` — deleting
an org with projects still fails, but on purpose: the operator-side
erase/GDPR flow is the one sanctioned path that purges projects, not a
one-click org delete that would silently destroy a team's shared
Knowledge. No org-delete route exists in the app yet (the admin UI does
not currently expose one, despite this entry's original claim), so there
was nothing to wire a handled 409 into — the actionable half of #218 was
deciding the semantics before that route gets built, which is now done and
schema-documented. The durable fix per #218's own suggestion:
`packages/core/src/__tests__/owner-delete-semantics.test.ts` ranges over
every relation to `User`/`Organization`/`Team` and fails if one has no
explicit `onDelete` — the next owner-ish model added has to declare a
choice instead of inheriting Prisma's implicit default silently. One more
instance of the §0u/§0v shape — a rule (decide + document delete
semantics) now applied to all three owner graphs, not just `User`.

---

## 0ae. A voucher option that promised shared tenants and delivered isolated ones (2026-08-08)

Found while minting a 60-seat pilot voucher, when the operator asked whether
one shared code would give each redeemer their own separate tenant. Verifying
the answer instead of assuming it turned up a defect in the opposite direction.

`VoucherCode.kind` (`personal` | `organization`) and `.organizationLabel` were
settable through `POST /api/admin/vouchers` and offered in the admin UI as a
`<select>` with an **Organization** option plus a label field that appeared
when chosen. **Neither field is read at redemption.** Every signup path —
credentials (`register/route.ts:188`) and the four NextAuth callbacks in
`auth.ts` — calls `ensurePersonalOrg(db, userId)`, which creates
`org_${userId}`, one per user.

So an operator minting "Acme Inc." as an organization voucher for their team
got **N separate isolated tenants**. Every redemption succeeded. Nothing
errored. The only symptom was the team eventually noticing they could not see
each other's knowledge — long after onboarding, and with no obvious cause.

| Issue | Where | Status |
|---|---|---|
| ~~**The UI offered a kind that did nothing.**~~ **Fixed.** The selector is gone; the form now states plainly that every redeemer gets an isolated tenant, and points at organization invites — the flow that actually does add people to an existing org. Removing the broken option without saying where the real one lives would just send the operator looking elsewhere. | `app/admin/vouchers/page.tsx` | done |
| ~~**The API accepted it too.**~~ **Fixed.** `kind` is now `z.literal("personal")` and `organizationLabel` is never persisted. Rejected at the boundary, not merely hidden in the UI, so a direct API call gets the same answer as the form. | `app/api/admin/vouchers/route.ts` | done |
| ~~**Nothing pinned the isolation guarantee.**~~ **Fixed.** `voucher-tenancy.test.ts` asserts the API rejects the dead kind, the UI doesn't offer it, the UI names the real alternative, and **every** signup path still bootstraps a personal org — the mechanism the guarantee rests on. | `apps/web/lib/brain/voucher-tenancy.test.ts` | done |

**Verified on production before closing.** Two accounts redeeming the same
60-seat code landed in `org_cmsk0ae15…` and `org_cmsk0aeez…`, each `owner` of
their own org with its own project, sharing none; knowledge isolation is
enforced by `buildKnowledgeWhere` pinning `ownerUserId` (28 scope-filter tests).
Concurrency is safe too — `claimVoucher` holds `SELECT … FOR UPDATE`, so 60
simultaneous redemptions queue rather than race past `maxUses`. Both test
accounts were then removed and the seat count reset.

**What this adds to the pattern.** §0u was wrong data in the right place; §0z
was right data in the wrong place. This is a third kind: **a control surface
wired to nothing.** The field existed end-to-end — schema column, Zod schema,
API persistence, admin `<select>`, list display — every layer present and
consistent, with only the *consumer* missing. Nothing about reading any single
layer reveals it; the absence is only visible by asking "who reads this?" and
finding nobody. Worth a specific habit: when adding a settable field, the
review question is not "is it stored?" but **"what changes when it changes?"**

Verified non-vacuous: reverting the fix fails 4 assertions.

---

## 0af. The language picker changed nothing on five of six surfaces (2026-08-08)

Reported by the operator: *"the sign-in page — we cannot change the language,
EN/TH/DE."* Two independent defects, both of which had to be fixed.

**1. The auth surfaces could not reach the dictionary.** `/signin`,
`/forgot-password` and `/reset-password` are async **server** components, and
`useT()` is a client hook reading React context. The dictionary itself lived
inside `i18n.ts`, a `"use client"` module — so even the pure `translate()`
function was unreachable from them. Every string on those pages was a hardcoded
English literal.

**2. Even translated, the picker would not have updated them.** `setLang` set
React state and the `bp_lang` cookie but never called `router.refresh()`, so
server-rendered markup kept the old language until a manual reload.

Which is exactly why `/welcome` worked and the rest did not: it is the one
surface whose copy lives in a client component, so a context change alone
re-rendered it.

Proven before fixing — `/signin` returned an identical **20883 bytes** for
`bp_lang=en`, `th` and `de`, differing only in the `<html lang>` attribute,
with zero Thai or German UI text.

| Issue | Where | Status |
|---|---|---|
| ~~**Server components had no route to the dictionary.**~~ **Fixed.** Dictionary + `translate()` extracted to `i18n-dict.ts` with no `"use client"`; `i18n.ts` re-exports it, so every existing client import is untouched. New `getServerT()` resolves `bp_lang` exactly as the root layout does, so `<html lang>` and the copy cannot disagree. | `lib/brain/i18n-dict.ts`, `i18n-server.ts` | done |
| ~~**Switching never re-rendered server markup.**~~ **Fixed.** `setLang` calls `router.refresh()`. | `components/brain/lang-provider.tsx` | done |
| ~~**Four auth pages + the docs layout were untranslated.**~~ **Fixed.** 39 `auth.*` keys × 3 locales. TH/DE are AI-generated and await a native sweep — the same caveat the existing `welcome.*` strings carry. | `app/{signin,forgot-password,reset-password,accept-invite}`, `app/docs/layout.tsx` | done |
| ~~**Nothing checked that a picker implied a translation.**~~ **Fixed.** `locale-coverage.test.ts` ranges over every page rendering `<LocalePicker />`. | `apps/web/lib/brain/locale-coverage.test.ts` | done |

**What the sweep caught that the report didn't.** The operator named one page;
five of the six carrying the picker were broken. The sweep also surfaced two
docs surfaces, one of which was a **false positive in my own test**:
`docs/page.tsx` translates via `useLang()` + `getDocsChrome(lang)` rather than
`useT()`, so the detector was asserting the nearest signal instead of the
property, and was widened. `docs/layout.tsx` was genuinely broken — one
untranslated back-link, now translated so the rule has no carve-out.

**The shape.** §0ae was a control surface wired to nothing. This is its
sibling: **a control surface wired to a mechanism that cannot reach the
content it controls.** The picker was real, the dictionary was real, the
provider was real — and the one thing missing was any path between a *server*
render and the dictionary. Every part was individually correct and demonstrably
working somewhere (on `/welcome`), which is what made it invisible.

Verified non-vacuous: reverting the wiring fails the per-page assertions;
reverting `router.refresh()` is caught in review, not by the sweep — a limit
worth stating, since the sweep proves the copy *can* translate, not that a
click updates it without reload.

---

## 0ag. Tutorial cross-links 404'd in the app; docs subpages didn't match the redesigned landing/`/docs` shell (2026-08-09 → 2026-08-10)

Two related defects surfaced during a docs UX pass, both invisible to
`pnpm turbo run build` because the build only proves the markdown parses,
not that a link resolves or that a heading renders with the right component.

**1. Every "Where next" / "See Tutorial N" link 404'd in the app.**
`docs/tutorials/*.md` is written for two audiences — GitHub's file viewer
(where `./01-getting-started.md` is correct) and the in-app renderer, which
serves each tutorial at `/docs/tutorials/01-getting-started` with no `.md`
suffix and no per-language route. Confirmed live before fixing:
`/docs/tutorials/01-getting-started.md` → 404, the no-suffix route → 200.
Every cross-tutorial link in every language variant was silently broken —
clickable-looking text that went nowhere.

**2. The tutorial and concept subpages didn't match `/docs`'s own design.**
The 2026-08-09 landing-page pass gave `/` and the `/docs` index panel cards
and accent-tick section headings (`SectionHeading`, the same idiom
`.rail-item.active::before` uses for "you are here"). The subpages that
carry the actual tutorial/concept content — where most reading time is
spent — never got it: plain unstyled `h2`s, bare hairline-bordered
`<table>`s. Clicking from a designed `/docs` card into a tutorial dropped
into what read as raw GitHub markdown.

| Issue | Where | Status |
|---|---|---|
| ~~**Relative `.md` links 404'd in-app.**~~ **Fixed.** `resolveDocLink()` rewrites `./NN-slug.md` (any language suffix) to the in-app route at render time, and `../OTHER.md` (docs with no in-app route — `USING_BRAIN.md`, `CLIENTS.md`, `HOW_IT_WORKS.md`, …) to its GitHub source instead of a page that doesn't exist. Source markdown is untouched, so GitHub's own viewer still resolves the original relative links correctly. | `apps/web/lib/brain/resolve-doc-link.ts`, used by `app/docs/tutorials/[slug]/tutorial-view.tsx`'s `a` renderer | done |
| ~~**Bare in-app paths mentioned in prose (`` `/start` ``, `` `/settings/tokens` ``, `` `/#oracle` ``, `` `/#skills` ``) were inline code, not links.**~~ **Fixed** where they act as the primary pointer to a surface, across `00-quick-start` (EN/TH/DE), `01-getting-started`, `02-asking-the-oracle`, `03-teaching-knowledge`, `05-exporting-rules`, `06-troubleshooting`. | `docs/tutorials/*.md` | done |
| ~~**Tutorial/concept `h2`s and tables didn't match the landing/`/docs` design.**~~ **Fixed.** `SectionHeading` extracted out of `landing.tsx` into a shared component; wired into `tutorial-view.tsx`'s markdown `h2` and `concept-view.tsx`'s section headings. Tables wrapped in `.panel` — the same card class `/docs`'s own cards already use. | `apps/web/components/brain/section-heading.tsx`, `tutorial-view.tsx`, `concept-view.tsx` | done |

**The shape.** Both defects are the same class as §0v (subpage navigation
consistency) and the `/welcome` half of §0af: a redesign or restructure
landed on the pages someone actually reviews (`/`, `/docs`), and the pages
one click deeper — reached only by *using* the product, not by looking at
it — kept the old shape. A build succeeding and a page returning 200 both
say "the page exists," neither says "the link on it goes anywhere" or "it
looks like the rest of the product." Caught here by clicking through the
live site link-by-link and comparing screenshots side by side, not by any
automated check — `doc refs (no phantom PRs)` CI checks markdown for
phantom PR numbers, not for whether relative links resolve to a real route.

Verified non-vacuous: `apps/web/lib/brain/resolve-doc-link.test.ts` asserts
the exact rewrite for same-folder, language-suffixed, parent-folder, and
passthrough cases — reverting the rewrite fails on the first case; the
visual fix has no unit test (styling isn't a unit-testable property) and
was verified by live screenshot instead.

---

## 0ah. §0ag's fix had gaps of its own — three more rounds before the tutorials were actually link-clean (2026-08-10 → 2026-08-11)

§0ag's `resolveDocLink()` only rewrites an `href` that already exists. A user
report — "this link doesn't work," quoting `00-quick-start`'s
`` `https://<your-brain>/start` `` — turned out to be plain inline code,
never a markdown link at all, so the fix had nothing to rewrite. Auditing
for the same shape (an in-app path mentioned as backticked text instead of
a link) found it repeated across every tutorial. Linking them surfaced a
second bug: two of the newly-clickable paths, `/skills` and `/dashboard`,
are not real routes — this SPA hash-routes its authenticated shell
(`GUIDELINES.md §10`), so the correct targets are `/#skills` /
`/#dashboard`. Confirmed live before fixing: `/dashboard` → 404. A full
crawl of all 25 public/doc pages (62 unique links) then found one link
that was broken before any of this — `06-troubleshooting.md` cited
`../RUNBOOK.md`, a file that was never created — and CodeRabbit caught
that the first attempt to fix *that* named a manual re-trigger mechanism
(`kea.extract`'s pg-boss job) with no actual operator-facing way to invoke
it, i.e. a new phantom pointer replacing the old one. Removed the claim
instead of inventing a command.

**The shape.** Each round's fix was correct and narrow; each round's audit
found the next thing the previous fix's scope didn't cover. "All tutorial
links now resolve" turned out to require: (1) rewriting hrefs that exist,
(2) finding mentions that were never hrefs, (3) verifying every newly-added
href against the actual route table rather than assuming the source
markdown had the right path, and (4) a full crawl rather than trusting the
class of bug was exhausted after fixing the instances that prompted the
investigation. None of the later rounds were reachable by generalizing from
the first fix's diff — each required looking at the actual rendered output
again with a wider net.

A **renamed heading breaks its own anchor silently**, one layer under all
of the above: `00-quick-start.md`'s Shortcut section was reworded
(`docs/tutorials/quick-start-shortcut-fork-framing`), and
`docs/tutorials/README.md` still linked to the old heading's GitHub-slug
anchor (`#shortcut--let-your-ai-do-all-three-steps`). No tool checks that
a `#fragment` link still matches a heading that exists — `doc refs (no
phantom PRs)` checks PR numbers, `resolve-doc-link.test.ts` checks route
rewriting, neither checks anchor-heading correspondence. Caught only by
grepping every `quick-start.md#` reference after the rename, the same
"grep before you close" discipline as `KNOWLEDGE.md §12.34`, applied to
anchors instead of routes.

---

## 0ai. The agentic-onboarding completion message told users to restart before telling them what they'd lose (2026-08-11)

Reported live by a pilot user's actual install: they set up External Brain
via the voucher prompt inside Antigravity, and the agent's closing message
said `claude mcp list` — a Claude Code CLI command that does not exist for
Antigravity. `BRAIN_BOOTSTRAP_TEMPLATE` (`skill-template.ts`) already asks
the agent to declare its client (`claude-code` / `cursor` / `windsurf` /
`antigravity` / …) in the voucher-exchange call two steps earlier — the
verification instruction just didn't use that information, and hardcoded
the one client's command for every client.

**A second, sharper bug in the same template, caught by the same user
before the first fix even shipped:** the three closing instructions were
ordered *"restart now" → verify → set a password*. Restarting the AI tool
ends the conversation the agent is delivering these instructions in — so a
user who follows step 1 literally never sees steps 2 and 3, including the
one-time `setPasswordUrl` link, which is the **only** way to ever reach the
dashboard. The bug wasn't the content of steps 2–3; it was that step 1
being first made them unreachable.

| Issue | Fix |
|---|---|
| ~~Verification hardcoded to `claude mcp list`.~~ | Replaced with the client-agnostic check the quick-start tutorial already uses — *"ask the brain what it knows about this project"* — which works for any client because it doesn't depend on a CLI existing. `claude mcp list` kept as an aside for Claude Code specifically. |
| ~~Restart instruction ordered first, orphaning the rest of the message.~~ | Reordered: password link → verification method → restart, last, with an explicit note in the prompt telling the agent *why* ("restarting ends this conversation, say this last"). |

**The shape.** Both bugs are instances of the same category — instructions
written for an agent to relay, not tested by actually being an agent
following them literally. The client-hardcoding bug required imagining "a
user in a client that isn't the one I usually test with." The ordering bug
required imagining "what happens if the reader does exactly what step 1
says, right now, mid-sentence" — a question that's easy to skip when
writing the steps in the natural order you'd explain them out loud, which
is not the same as the order in which their side effects are irreversible.
Any instruction sequence ending in an action that destroys the channel it's
delivered through (closing a connection, restarting a process, navigating
away) needs that action last, with everything the reader needs *after* it
already said.

Found and fixed within one round because a real pilot user hit it on a real
install in a client this repo doesn't run its own e2e suite against
(`anon onboarding e2e` covers the shell-installer path, not the
agent-conversation bootstrap path) — the gap a synthetic test suite has no
way to close on its own.

---

## 0aj. `next-auth`/`@auth/core` were one patch behind their own critical CVE fix (2026-08-11)

Found by `pnpm audit --prod` during a general whole-project review — not
prompted by any specific symptom, since the vulnerability (GHSA-7rqj-j65f-
68wh / GHSA-8fpg-xm3f-6cx3: Auth.js's email normalizer validates the
address *before* Unicode normalization, allowing a homoglyph `@` bypass)
had produced no observed incident on this instance. `next-auth@5.0.0-
beta.31` and `@auth/core@0.41.2` were both one patch behind the fix
(`beta.32` / `0.41.3`), which existed on npm the whole time — the
project's own `^5.0.0-beta.25` range already permitted resolving to it, it
had simply never been re-resolved since the range was set.

This is the auth library this app actually runs in production, not a dev-
tooling transitive (contrast the 71 remaining moderate/high findings,
which are `@prisma/dev`'s own dependency tree, wired into local Prisma
Studio tooling, not the deployed image — confirmed by `pnpm audit --prod`
before/after this session's `mermaid` addition matched exactly, same
technique used there). A homoglyph email-normalization bypass is directly
relevant to a platform that matches invite/voucher emails case- and
address-insensitively.

**Fix:** `pnpm update next-auth @auth/core @auth/prisma-adapter --recursive`
— no code changes required, the existing semver range already covered the
patched versions. `pnpm audit --prod --audit-level critical` went from 3
findings to 0. Full gate (typecheck/test/build, 15/15) re-run clean after
`prisma generate` to pick up the regenerated client.

**The generalisable gap:** a semver range that *permits* a patched version
does not *resolve* to it automatically — `pnpm install` only re-resolves
when the lockfile is touched or `pnpm update` is run explicitly. A
dependency can sit one patch behind a fix indefinitely, invisible to
`pnpm audit` only if someone runs it. Nothing in CI runs `pnpm audit`
today; this was caught by a manual pass, not a gate. Worth adding as a
scheduled check rather than relying on the next incidental review to catch
the next one.

**Closed (2026-08-13):** a `dependency audit (critical, prod only)` job now
runs on every PR — `pnpm audit --prod --audit-level critical` against the
frozen lockfile. Scoped deliberately: `--prod` excludes `@prisma/dev`'s
~70 moderate/high dev-tooling findings that never reach the deployed image,
and `critical` is the only tier currently clean (`high` still exits 1 on
pre-existing transitives with no fix available), because a permanently-red
gate trains people to ignore it — the same failure mode §0ak records for
flaky tests. Verified non-vacuous before merge: the command exits 1 against
the pre-patch lockfile (3 critical) and 0 against the current one. Raise the
bar to `high` when that tier is genuinely clean.

---

## 0ak. A tutorial rewrite reintroduced three defect classes the previous ten PRs had just closed (2026-08-12, v2.15.0)

Three commits overhauled `00-quick-start` (EN/TH/DE) into an explicit
two-option structure with a real session transcript. Good rewrite; it also
silently reverted three fixes shipped days earlier, because a full-section
rewrite replaces the *text* that carried those fixes without any signal
that the text was load-bearing.

| Reintroduced | Originally fixed in | Why it came back |
|---|---|---|
| **`<dein-brain>` in the DE file** (4 occurrences). `withResolvedHost()` matches the literal string `<your-brain>` — a localized placeholder is never substituted, so German readers see the raw placeholder where the real host should be. | PR #233 | The rewrite localized the placeholder along with the prose. It reads as a translation improvement; it is a functional break, and only in the language nobody on the team reads first. |
| **Bare `` `/settings/tokens` ``** in the troubleshooting table (all 3 languages), plus `` `/start` `` in `04-managing-tokens`. Inline code where a link belongs — the exact "looks clickable, isn't" complaint that drove PRs #236/#237. | PRs #236, #237 | New table rows were authored fresh; the linkify pass had covered the *old* rows. |
| **A self-contradicting session transcript.** The rewrite flipped the worked example's direction (rules say route handler → correction moves to repository layer) but left quick-start's own reference table *and* `01-getting-started`'s transcript on the original direction. Same page, opposite conclusions. | n/a — new | A transcript is prose to a reviewer, but it is a *worked example* whose parts must agree with each other and with every other copy of it. |

**The shape.** Every one of these is invisible to CI: `pnpm turbo run
build` proves markdown parses, `resolve-doc-link.test.ts` proves route
rewriting, `tutorial-content.test.ts` proves content exists and is
non-trivially long. None of them assert *"the placeholder in this file is
the one `withResolvedHost` will substitute"*, *"an in-app path mentioned in
prose is a link"*, or *"the two copies of the worked example agree."* The
fixes lived only as text, so rewriting the text reverted them.

**What would actually prevent the next one.** Not "review harder" — the
reviewable unit is a 150-line diff in a language the reviewer may not read.
The durable form is a test per class, and two of the three are cheap:
a placeholder assertion (every tutorial's placeholder is exactly
`<your-brain>`) and the existing bare-path grep promoted from a
one-off command into a unit test. The transcript-consistency one is harder
and probably not worth automating; it is the case for keeping *one* copy of
a worked example and cross-linking it, rather than duplicating it into
every language and every adjacent tutorial. Filed as follow-up rather than
built here, because this session's job was to validate the rewrite, and
adding three tests to a docs-fix commit is the scope creep
`GUIDELINES §12c` warns about.

**§0ah's anchor bug recurred in the same rewrite, which is the cleanest
possible evidence for the rule above.** The rewrite renamed
`## Have a voucher code? Let your AI do it` to
`## OPTION 1 — Auto-setup with a voucher code (1 minute)`, orphaning
`docs/tutorials/README.md`'s `#have-a-voucher-code-let-your-ai-do-it`
link — the *same* file, the *same* link, broken the *same* way as two days
earlier, because §0ah's fix was a corrected anchor string and nothing more.
A stale-anchor check is the third cheap test this class wants. Fixed again,
along with three stale "5 min" duration claims (README, both localized rows
in `tutorials/README.md`) and `tutorial-meta.ts`'s `minutes` field, all
left behind when the tutorial retitled itself to "3 minutes" — the in-app
`/docs` card had been advertising a duration the page itself contradicted.

**Process defect found by the operator in the same session, worth recording
next to the technical ones:** closing this family of bugs took *fifteen*
PRs (#233–#247), nearly all touching the same handful of tutorial files,
each paying a full CI cycle (~5 min of gates) to re-prove overlapping green.
The operator's correction — batch related commits into one PR — is now the
documented rule (`AGENTS.md` → *One PR, many commits*, `GUIDELINES §6`,
`CONTRIBUTING`). The generalisable trap is in `APPROACH.md §5bu`: an agent
opens a PR when a fix *feels complete*, and completeness fires many times
an hour, so the natural rhythm produces a PR per increment. The correct
trigger is coherence of the batch, not completeness of the increment.

**Also caught in the same pass:** `apps/mcp-server`'s `tools-catalog.test.ts`
flaked twice under `turbo run --force`, failing the whole gate both times
while passing standalone in 2s. Not a product bug — the test does
`await import("../tools/index.js")` inside the test body, pulling
`@brain/core` + the generated Prisma client, and that import cost lands
against vitest's 5s *test* timeout. Under 15 parallel turbo tasks it
exceeds it. Raised to 30s with the reasoning in
`apps/mcp-server/vitest.config.ts`: still far below anything that hides a
genuine hang, high enough that CPU contention alone cannot turn a green
suite red. A gate that fails randomly trains people to re-run instead of
read, which is how a real failure gets waved through.

---

## 0al. The prod-drift watchdog has been watching the **dev** host since it was wired up (2026-08-14)

`BRAIN_DEPLOY_URL` — the secret the `prod-drift` workflow polls — points at
`brain-dev.autobahn.bot`, not `brain.autobahn.bot`. The watchdog named
`prod-drift`, whose issues say *"Production is running X but main is at Y"*,
has never once measured production.

**How it surfaced.** Not from a failure — from noticing the *shape* of the
noise. Four consecutive issues (#227, #242, #246, #248) were closed with
"prod matches main", and three of them reported the deployed version as the
identical string `v2.14.2-7-g945d9ee` across three days during which
production was redeployed repeatedly. A number that does not move while the
thing it describes does is not a stale reading; it is a reading of something
else. Confirmed directly:

```
brain-dev.autobahn.bot/api/healthz  → v2.14.2-7-g945d9ee   ← what the watchdog reports
brain.autobahn.bot/api/healthz      → v2.15.0-1-gf7b09e5   ← actual production
```

**Why it went unnoticed for months.** Every ingredient looked healthy. The
workflow ran daily, opened issues, closed them on redeploy, and
`APPROACH.md §"watchdogs must be validated by firing them"` recorded the full
lifecycle as exercised — because it *was* exercised. Firing correctly proves
the plumbing works; it says nothing about whether the input is the right
input. The dev host runs `develop` and is rarely redeployed, so it sits
permanently behind `main` — which means the watchdog produced a *plausible*
alarm on most days, and a plausible alarm is far harder to spot than a
silent one. I closed four of these myself without checking what
`BRAIN_DEPLOY_URL` actually resolved to, because the alarm agreed with a
drift I already knew was real for prod.

**Consequences.**
- The failure this watchdog exists to prevent — the v1.2.x incident where a
  fix sat merged on `main` for two days while production served an older
  build — is **still unguarded**, and has been the whole time.
- Worse than unguarded: it looked guarded. This is the same shape as
  `GUIDELINES §4`'s rule about gate thresholds, arrived at from the opposite
  direction — there a gate could never go red, here a gate goes red about the
  wrong subject. Both leave a repo that *appears* covered.
- The four closure comments I wrote ("production matches main") were true
  statements that did not answer the question the issue was actually asking.

**Fix:** repoint `BRAIN_DEPLOY_URL` at the production origin, then
`workflow_dispatch` it once and confirm the reported version matches
production's `/api/healthz` — the registration check `§0-`era lessons already
require after touching this workflow. Deliberately **not** applied
unilaterally: the secret is repo configuration whose current value is
unreadable by design, and the operator may have set it at a time when only
the dev host existed (secret created 2026-06-09). Raised for confirmation
rather than changed silently.

**Prevention shipped with the fix (2026-08-14), because a repointed secret
would have drifted again the next time anyone touched it.** Three changes
turn this from "documented" into "cannot recur silently":

1. **The deployment declares its own tier.** `/api/healthz` now returns
   `environment`, sourced from a new `BRAIN_DEPLOY_ENV`. Deliberately a
   *new* variable: the live prod host's `.env` carries `ENVIRONMENT=dev` as
   a stale label, so reusing it would have made the guard certify production
   as dev — reproducing this exact bug one layer deeper.
2. **The watchdog asserts its target.** It compares that field against
   `vars.BRAIN_EXPECT_DEPLOY_ENV` (default `production`) and **exits 1 with
   an explicit error** on mismatch. Pointing it at dev is now a red run, not
   a plausible alarm. A missing field maps to `unknown` — it refuses to
   report drift rather than restore the false all-clear.
3. **The issue names what it measured.** Title and body now read
   *"the `production` deployment is behind main"* with a line stating which
   `environment` the reading came from. The old body gave a reader no way to
   tell dev from prod, which is why four of these were closed by hand
   without anyone noticing. This is the "make the target visible in the
   alarm" corollary, implemented rather than merely recommended.

Guarded by `apps/web/app/api/healthz/route.test.ts` — the `environment`
field is a contract read by something *outside* this repo, so dropping or
renaming it would otherwise degrade the watchdog to "cannot verify" with
nobody noticing.

**The generalisable check:** a monitor's *output* being live is not evidence
its *input* is correct. When a watchdog reports a value, at least once verify
that value independently against the system you believe it is watching — the
one-line `curl` here would have caught this on day one. Prefer wiring the
target so it is visible in the alarm itself (the issue body naming the host
it polled) over a secret that makes the question unanswerable without repo
admin.

---

## 0am. Live user-account deletion needed a second authorization gate, distinct from Prisma's (2026-08-15)

Not a bug — a documented gap in *how this class of request should proceed*,
surfaced by an actual operator ask: remove `sun2child@yahoo.com` and all its
data.

**What made this non-trivial technically.** `User` cascades cleanly
(`Session`, `MCPToken`, `Knowledge.ownerUserId`, `PeerCard.ownerUserId`,
`VoucherRedemption`, `UserCredential`, `OrganizationMember` are all
`ON DELETE CASCADE`), but `Project.organizationId` is `ON DELETE RESTRICT`
(deliberate — see the `Organization` delete-semantics work, `§218`). A plain
`DELETE FROM "User"` on an account that owns a personal org with a project
would either fail outright or, worse, silently leave the `Organization`
and `Project` orphaned depending on statement order. Surveyed first —
1 Session, 1 MCPToken, 1 personal Project, 1 personal Organization
(1 member), 0 Knowledge/PeerCard/VoucherRedemption/UserCredential — then
deleted in the order the constraints require: `Project` → `Organization`
(cascades the now-sole `OrganizationMember` row) → `User` (cascades the
rest), inside one transaction.

**What made it non-trivial operationally.** The `docker exec … psql …
DELETE` command was denied twice by the harness's auto-mode classifier —
identically the second time, even though the user had explicitly replied
"run it all for me" in between. That reply didn't change anything, because
the classifier gates the Bash call itself, not a stated intent in the
conversation transcript. The only thing that unblocked it was the user
exiting auto mode (a distinct harness state, surfaced by a
`## Exited Auto Mode` system message), after which the identical command
ran on the next attempt.

**Two gates, not one, and they don't compose the way you'd guess.**
`AGENTS.md §3` already documented Prisma's `migrate reset --force` refusal
— a schema-level gate, opt-in via an env var, entirely inside this repo's
code. Raw destructive SQL against a live database goes through a completely
different, harness-level gate that this repo has no control over and no
visibility into beyond "denied" / "not denied." Assuming the first gate's
shape (a consent flag you can locate and reason about) generalizes to the
second (a classifier decision plus an auto-mode toggle) wastes a retry.

**The operating pattern, now in `AGENTS.md §3`:** don't retry an identically
denied command — it will deny again, deterministically. Survey and state
the exact blast radius before asking for approval, so the approval (however
it eventually arrives) is informed. Offer the user a copy-pasteable command
to run themselves as a parallel path, since they may not want to wait on a
permission flow at all. If they ask the agent to run it anyway, say plainly
that retrying won't help and that exiting auto mode is the actual unlock —
don't let "run it all for me" read as if it were the missing permission,
when the missing permission is a harness state, not a sentence.

Full narrative: `KNOWLEDGE.md §12.36`, `APPROACH.md §5bx`.

---

## 0an. Agentic-onboarding accounts had no way to ever get a web password (2026-08-15)

Found live: an operator asked to reset the password for an account created
weeks earlier through `/api/onboard/claim` (agentic onboarding — an AI
agent redeems a voucher and gets a User row + API token, no browser
involved). `POST /forgot-password` returned its normal generic 200, but no
email ever arrived, no matter how many times it was retried.

**Root cause.** `/api/onboard/claim` deliberately never creates a
`UserCredential` — the whole point of that path is a passwordless,
agent-only account. But `forgot-password` required `user.credential` to
already exist before it would create a `PasswordResetToken` or send mail;
lacking one, it hit the same generic "if an account exists…" branch used
for *nonexistent* emails, with no log line either way — so from the
outside, "no credential" and "no such user" were indistinguishable, and
both looked like silence. `reset-password` had the same assumption
independently: it re-checked `UserCredential` existed before honoring even
a valid, unexpired token. The account was real, reachable via
`/api/onboard/claim`'s own `email_taken` check (confirmed: `db.user.
findUnique` found it) — it just had no path to ever acquire a password.
`/settings/tokens`, the address the `email_taken` message points to,
itself requires a signed-in session, which this account could never
reach. A structural dead end, not a delivery bug.

**Fix.** `forgot-password` (`apps/web/app/api/auth/forgot-password/
route.ts`) now looks up the user without filtering on `credential`, and
`reset-password` (`apps/web/app/api/auth/reset-password/route.ts`) upserts
`UserCredential` instead of requiring one to pre-exist. The existing
one-hour, single-use, hashed reset-token machinery is unchanged — this
just widens who is allowed to land in it. Verified live against
`brain.autobahn.bot`: before the fix, `POST /api/auth/forgot-password` for
the affected address produced zero log lines (the credential-gated
early-return); after redeploying the fix, the same request logged
`"password reset email sent"` with a real Resend `messageId`.

**Why this matters beyond the one account.** Any account minted purely via
`/api/onboard/claim` — which is the entire point of agentic onboarding —
was in the same trap. This wasn't a one-off; it was every credential-less
account, permanently, until this fix.

Full narrative: `KNOWLEDGE.md §12.37`, `APPROACH.md §5by`.

---

## 0ao. Prompt-based token install + the guard that couldn't see the defect (2026-08-15)

Shipping the `/settings/tokens` "Paste a prompt" tab — the authenticated
counterpart to `/start`'s voucher prompt — turned up three defects in the
same change, two of them in code that had already passed typecheck, test
and build. Recording them because two are recurring classes, and one is a
still-open gap in a guard the repo relies on.

**1. The new bootstrap document hand-wrote its install command.** It told
the agent to run `claude mcp add --transport http brain <url> --header …`.
The real command, from `packages/core/src/install-snippets.ts`, is the
`onboard.sh` installer, which additionally installs the Brain skill and
smoke-tests the round-trip, and passes `--scope user`. So the prompt path
would have produced a *worse* install than the manual tab beside it — a
connection with no skill and no verification. Fixed by deriving both the
POSIX and PowerShell commands from `clientById("claude-code").snippet(…)`
with `<TOKEN>` as the placeholder, so the document cannot drift from the
installer. This is `APPROACH.md §2.6` again, in a new surface.

**2. `install-command-single-source.test.ts` did not catch (1), and still
can't in general — OPEN.** Its docstring claims it enforces "only one
place is *able* to construct the command." It greps for two literals
(`/api/onboard.sh | bash`, `/api/onboard.ps1 -UseBasicParsing | iex`), so
a *different* command shape for the same job is invisible to it. Adding
`mcp add` to the pattern list is not a fix: `skill-template.ts`
legitimately quotes that command in prose, and a literal guard cannot
distinguish constructing from mentioning. Mitigated for this document by
asserting on the *rendered* output (`toContain("/api/onboard.sh")` +
`not.toMatch(/claude mcp add/)`), where there is no prose ambiguity. The
general gap stands: **any future surface that invents a third command
shape passes this guard.** See `GUIDELINES.md` ("A guard that greps for
literals…").

**3. The document offered `--client` ids the installer rejects.** The list
was built from all of `CLIENTS`, but `jetbrains` and `rest` have no
one-line command (the claim route answers `installCommand: null` for
them). An agent in a JetBrains IDE would have picked `jetbrains` off the
list and hit `ERROR: no config template for client 'jetbrains'` mid-setup,
with no recovery path. The list is now filtered by
`snippet(…).command !== undefined` — the same predicate
`installer-templates.ts` uses — and those users are routed to the manual
wizard explicitly.

**Also fixed in the same pass:** an unguarded `project.findUnique` added
after `session.create()` in `brain_start_session`, which would have
stranded a created session on any DB blip (`APPROACH.md §4.5`); and a
`source: "default_created"` label that assumed `ensureDefaultProject`
always creates, when it returns the personal org's oldest existing project
when there is one.

**Residual, not defects:** the new `brain_start_session` project/hint test
cannot run on the prod host (no dev DB; it writes `User` rows) — it
executes in CI's `verify` job, which provisions pgvector. The tokens-page
tab was verified by typecheck/build and by reading the `authed-e2e`
selectors, not by opening a browser.

Full narrative: `KNOWLEDGE.md §12.8b`, `APPROACH.md §2.6`/`§4.5`.

---

## 0ap. The new install tab shipped invisible (2026-08-15, v2.16.1)

v2.16.0 added a second install route to `/settings/tokens` — paste a prompt,
let your agent install itself. It worked. Nobody would have found it.

**Symptom.** The operator sent a screenshot of the live page with the tab
circled: *"the Prompt tab is not easy to recognize, because it is like a text
next to run myself"*.

**Root cause.** The unselected tab was `className="btn btn-ghost"`, and
`globals.css` defines `.btn-ghost { background: transparent; border-color:
transparent; }`. Ghost is the correct token for a de-emphasised secondary
action (Dismiss, Copy) where the user already knows the primary path. Used for
one half of a mutually exclusive choice, sitting beside a filled
`.btn-primary`, it renders as a caption — the affordance disappears exactly
where discovery has to happen.

**Why every gate missed it.** `role="tab"` + `aria-selected` were correct, the
click handler worked, typecheck/test/build were green, the e2e selectors
resolved (they target the default tab, which was never the invisible one), and
the live endpoint returned 200. Each check answered a question one step short
of the one that mattered. An invisible control satisfies all of them; see
`APPROACH.md §2.6f` on not letting "verified" span the gap between *renders*
and *is discoverable*.

**Fix — second attempt (v2.16.2).** The first fix (v2.16.1) swapped
`.btn-ghost` for the design system's default `.btn` and added a
`CHOOSE HOW TO INSTALL` caption. The operator reported the same defect again
from a fresh screenshot: *"when no mouse hover the paste a prompt button, it
does not show as a button."* Correct — and measurable. `.btn`'s border is
`--line`, which against this panel's `--bg-elev-1` is **1.30:1** in light and
**1.23:1** in dark, versus the **3:1** WCAG 2.1 SC 1.4.11 floor for UI
component boundaries. The control was still invisible; it merely became
visible *on hover*, when the fill changes. `--line-strong` would not have
fixed it either (1.57:1). The inactive tab now uses `--ink-4` — the lowest
rung of the ink ramp that is AA-legible as text — giving **6.21:1** light and
**5.73:1** dark.

**Lesson.** "Use the design system token" is necessary, not sufficient: a
token can be in-system and still fail AA in the specific pairing you put it
in. Contrast is a property of the *pair*, so it has to be computed against the
actual surface the component sits on. Two rounds of screenshot feedback were
spent discovering something ten lines of arithmetic answered.

**OPEN — systemic.** `.btn`'s default border fails SC 1.4.11 against
`--bg-elev-1` on **both** themes, so every plain `.btn` on an elevated panel
has the same near-invisible boundary; only `.btn-primary` (accent fill) and
text-bearing buttons are unaffected. `GUIDELINES.md §10` states WCAG 2.1 AA is
the floor, so this is a standing violation of the repo's own bar. Fixing it
means changing `--line` (or `.btn`'s border) app-wide — a blast radius across
every surface, and not something to fold into a tab fix. Filed here so the
next person to touch the palette sees the arithmetic rather than rediscovering
it from a screenshot.

**Also in v2.16.1:** the rendered-artifact assertions v2.16.0 added for the
token bootstrap were extended to sweep all three agent-facing documents —
no rendered doc may embed a real `bp_…` bearer (they are public and
unauthenticated, and the token doc renders its placeholder through the same
snippet functions that render real tokens elsewhere), and only the token-mode
doc may construct an installer invocation.

---

## 0aq. A routine model bump found four things the stack was quietly lying about (2026-08-18, v2.17.0)

The task was "can we step up the model versions?" Answering it honestly meant
reading `res.model` off a live response instead of trusting config — and every
subsequent finding came from that one habit.

**1. The Oracle had already been upgraded, by the provider, without telling
anyone.** `ORACLE_MODEL=glm-5.1` was served by **`glm-5.3`**. Probing each ID
against the live gateway showed `glm-5.1`, `glm-5.2` and `glm-5` all answered
as `glm-5.3`; `glm-4.5-air` answered as `glm-4.7`. Anthropic-compatible
gateways **alias instead of 404ing**, so config, docs, and every cost row named
a model that had not run for days. Fixed by `reportServedModel()` in
`packages/core/src/llm.ts`, called at all three dispatch sites, which warns
once per `requested→served` pair.

**2. The documented `claude-haiku-4-5` fallback does not exist on this
deployment.** `kea.ts` defaults its Anthropic wrapper to `claude-haiku-4-5`;
with `ANTHROPIC_BASE_URL` set, `useAnthropicSdk()` sends it to Z.ai, which
answers **as `glm-4.7` with a 200**. The ledger would have attributed GLM
tokens to Anthropic prices. Not a crash — an accounting fiction.

**3. `qwen3-coder`, the in-code default for `KEA_MODEL` and `AUTOSKILL_MODEL`,
returns HTTP 400 here.** Prod is safe only because `.env` sets `KEA_MODEL`
explicitly. Unset it and extraction stops. Same fresh-deploy fragility class as
§0a; documented in `.env.example` rather than changed, because the default is
correct for the DashScope forkers it was written for.

**4. `cost.ts` cannot describe this deployment at all.**
`https://api.z.ai/api/anthropic` is the **GLM Coding Plan** endpoint: a flat
subscription with prompt quotas per 5-hour window, not per-token billing.
`glm-5.3` had no row, so it fell through to the conservative Opus fallback of
15/75 — a ~25× overstatement. Rows added for `glm-5.2`/`glm-5.3` with an
explicit caveat that on a Coding Plan the ledger estimates list value, not
money owed.

**The embedding "upgrade" that would have silently destroyed retrieval.**
`gemini-embedding-2-preview` is live and accepts 1536 dims, so it looked like a
free step up. Three measurements said otherwise:

| Check | Result |
|---|---|
| Separation (paraphrase vs unrelated) | `001` **+0.4065**, `2-preview` +0.3466 — the *older* model discriminates better on this corpus |
| Cross-model similarity, same sentence | **−0.024** — the two vector spaces are orthogonal |
| Rows the backfill would have re-embedded | **0** — it selected `embedding IS NULL` only |

Worse, `EMBEDDING_MODEL` never controlled the primary provider: `embedding.ts`
hardcoded `gemini-embedding-001` whenever a Gemini key was present, so the env
var an operator would reach for was **inert**. Changing the model "properly"
would have left every existing row on the old model forever — a mixed index
where new query vectors score ~0 against all prior knowledge, returning
nothing relevant and raising no error.

**Fix (the actual deliverable).** Embedding provenance:
`Knowledge.embeddingModel` + `Skill.embeddingModel`
(`20260818180000_embedding_model_provenance`), the backfill widened to
`embedding IS NULL OR "embeddingModel" IS DISTINCT FROM $active`, and
`activeEmbeddingModel()` honouring `EMBEDDING_MODEL` when it names a Gemini
model. Verified on prod: 79 rows re-embedded, `remaining: 0`, second run a
no-op. The model choice is now reversible; §4.5's "how do we re-embed safely"
question is answered for the first time.

**The wrong recommendation, and what corrected it.** A synthetic benchmark
ranked `glm-5.3` best for KEA. Replayed against five **real** sessions it came
last — **3 of 5 runs returned zero findings**, including the richest session,
plus one schema-invalid `type`. KEA's failure mode is a silent empty
extraction: no error, no test failure, nothing in a health check. The harness
is now committed as `pnpm --filter @brain/worker eval:kea` so the next model
decision is measured, not argued. `glm-4.5` and `glm-4.7` scored equivalently
(0 empty, 12 findings each); `glm-4.7` was chosen on ~45% fewer output tokens.

**A false alarm worth recording.** The first post-bump extraction logged
`items: 0`, which looks exactly like a model regression. The existing
`kea.funnel` line disambiguated it in one read: `llmFindings:2,
filterPassed:0` — the model was fine, semantic dedup was correctly rejecting
near-duplicates of rows written the day before. A re-run on a novel topic gave
`llmFindings:2 → filterPassed:2 → persisted:2`. **`items:0` alone cannot
distinguish a broken model from healthy dedup; always read the funnel.**

**Two process defects in the fix itself.** (a) The alias warning was first
added only to `llm.ts` — but `oracle.ts` carries two Anthropic clients of its
own, so it would never have fired for the Oracle, the one model actually being
aliased. Sixth instance of the one-rule-two-implementations class (§0q).
(b) The `bootstrap` service had no LLM env passthrough, so the new eval
harness routed every GLM model to DashScope and died on `DASHSCOPE_API_KEY is
unset` — the same passthrough trap as §0's `KEA_MODEL`, in a service nobody
had needed to make model calls from before. Both fixed.

**Follow-ups shipped in the same batch.** (a) The alias signal was only a
`warn` line, and nobody reads container logs — the docker json-file driver
rolls them at ~50MB, so a provider re-pointing an alias next month would
scroll away unnoticed. It now also writes an `llm.model_alias` AuditLog row:
`SELECT payload FROM "AuditLog" WHERE action = 'llm.model_alias';`. (b)
`deploy.sh` gained `DEPLOY_EDGE=false`, closing tech-debt **#164** — the
script unconditionally ran `--profile edge`, whose Caddy sidecar collides with
the external nginx already bound to :443 on this host, so **the production
deploy script could not be run against production** and every migration had to
be hand-assembled. With the flag it does everything except TLS and probes the
URL the existing proxy serves. (c) `GUIDELINES` now carries a one-canonical-
home doc rule, because this very entry is the kind of thing that gets
restated into five files and then drifts.

**Resolved 2026-08-22 — operator decision: stay on the Coding Plan**, on budget
grounds. Recorded as a project decision in the Brain, not tracked as debt. The
constraints below are now design constraints rather than defects, and the
tripwires built during this work (`reportServedModel` + the `llm.model_alias`
audit row) exist precisely so the substrate's behaviour stays visible without
changing it. Revisit only if usage grows or the Brain is handed to other
people — the blind spots scale with traffic while the flat fee does not.

The Coding Plan is a
per-developer interactive subscription being used as a server substrate:
single-concurrency cap (which the worker's pg-boss default of 1 currently
matches *by accident* — adding `teamSize` would produce unexplained 429s),
quota windows with a 3× peak multiplier, silent aliasing, and no rate card for
the model actually served. Fine at present volume, wrong for a product others
fork, and the root cause of every finding above. Moving prod to pay-as-you-go
API keys requires new credentials and is therefore blocked on the operator;
`ORACLE_MODEL` is already pinned to `glm-5.2`, the newest ID with a published
rate card, so the config stays valid if that decision is ever revisited.

---

## 0ar. Three tools disagreed about what "the project" means, and all three returned success (2026-08-20, v2.18.0)

Found while transferring the v2.17.0 lessons into the Brain — i.e. by dogfooding
the product, not by reading the code.

**The disagreement.** Three project-aware MCP tools each resolved "the project"
differently, and each had its own copy of the logic:

| Tool | `projectId` | `projectName` | Reports where it landed |
|---|---|---|---|
| `brain_start_session` | ✅ | ✅ | ✅ `project.source` + `hint` |
| `brain_teach_knowledge` | ✅ | ❌ | ❌ nothing |
| `brain_ask_oracle` | ❌ | ❌ | ❌ nothing |

**What that produced.** `brain_teach_knowledge` had no way to name a project, so
it fell back to the default one and said nothing about it — and an audit showed
that **every rule ever taught from this repo had landed in "Default"**, mixed in
with unrelated projects' content, while KEA-*extracted* knowledge filed
correctly because the session carried the project. The agent following
`AGENTS.md`'s "pass the project on EVERY call" discipline could not comply: the
parameter did not exist.

**The part that made it pathological.** `brain_ask_oracle` took no project at
all and resolved via `resolveReadProjectId(auth)`, which on a non-project-scoped
token means the default project only. So *correcting* the filing made knowledge
**invisible to the Oracle**: six decisions moved into their proper project and
the Oracle immediately began answering *"I don't have specific knowledge about
your embedding model setup"* while those exact rows sat in the database. The
accidental misfiling had been the only reason years of taught knowledge was
retrievable at all. The tool's own source carried the admission — *"`ask()` has
always accepted a projectId; this tool simply never passed"*.

**Third defect, stacked on top.** `supersedeKnowledge` matches its target on
`ownerProjectId`, returns `false` on a miss, and `teach.ts` **discarded that
boolean**. So passing `supersedesKnowledgeId` across projects reported success
while the superseded rule stayed `ACTIVE` and kept being retrieved — the worst
outcome for a supersession, since the caller believes the old advice is retired.
Verified both directions: cross-project did nothing; same-project retired the
predecessor and set `parentKnowledgeId`.

**Fix.** One `resolveProjectForCall()` in `apps/mcp-server/src/scope.ts`, used by
all three tools, with the precedence `brain_start_session` already had: scoped
token wins outright → explicit id → name (created on demand) → reported
fallback. `projectName` added to teach and to the Oracle; every response now
carries `project.source` and a `hint` when it fell back; the supersede boolean
is surfaced as `superseded` plus a `supersedeHint` naming the likely cause.

**Measured after deploy.** The same Oracle question that had returned nothing
useful now answers from the named project — and **session retrieval went from 0
to 7**, because the Oracle had been reading the wrong project for every question
ever asked, not just the ones about recently-filed knowledge. That second effect
was invisible for as long as the first one was.

**Why every gate missed it.** Typecheck, 1500+ tests, lockdown and both e2e
suites were green throughout: each tool did exactly what its own code said, the
data was never corrupted, and all three returned HTTP 200 with a plausible
payload. The defect lived in the *disagreement* between three correct-looking
implementations — the same one-rule-N-copies class as §0q (provider routing) and
the v2.17.0 embedding writers, now the seventh instance in this arc.

---

## 1. Scaffolding-level issues (v0.1+)

The scaffolding has been substantially wired in the GUI↔backend pass (2026-04-21). Known remaining gaps:

| Issue | Location | Fix before |
|---|---|---|
| ~~**Dev-auth shim only.**~~ Replaced 2026-04-21 with a dual-mode auth: NextAuth v5 (GitHub OAuth, JWT strategy) when `AUTH_GITHUB_ID`+`AUTH_GITHUB_SECRET`+`AUTH_SECRET` are all set, dev shim otherwise. `getCurrentUserId()` reads the JWT first and fails closed (`401 not_signed_in`) when auth is configured but the session is absent — no silent fall-through. | — | done |
| ~~**pg-boss enqueue is hand-rolled SQL.**~~ **Resolved.** `report.ts` now enqueues `kea.extract` + `autoskill.run` through `enqueueJob` (pg-boss `boss.send()`) with the retry/backoff defaults from `jobs.ts` (audit C7); the raw-SQL `INSERT` against `pgboss.job` is gone. | `apps/mcp-server/src/tools/report.ts` | done |
| ~~**HTTP transport for MCP server not wired.**~~ Streamable HTTP transport (stateless, per-request Server/Transport pair; Bearer auth via `AsyncLocalStorage`) landed 2026-04-21. Select with `MCP_TRANSPORT=http`. | `apps/mcp-server/src/index.ts` | done |
| ~~**No unit/integration tests yet.**~~ **Resolved.** The intelligence layer has extensive unit coverage under `packages/core/src/__tests__/` (kea, autoskill, the LLM classifier, oracle, scope-filter, knowledge-*, …), run keyless in CI via `turbo run test`. | `packages/core/src/__tests__/` | done |
| ~~**Autoskill router is regex + tag-match.**~~ **Resolved (v1.10.0).** `routeSignal`'s type decision (rules / knowledge / ignore) graduated to an LLM classifier grounded in the user's resolved-proposal telemetry + nearest knowledge (few-shot), behind `AUTOSKILL_LLM_CLASSIFIER` (default off; `AUTOSKILL_SHADOW` logs heuristic-vs-LLM agreement first). The score gate, skill short-circuit, and quality filter stay as cheap pre-filters; the keyword path remains the fail-soft fallback. The scoring/conflict system is unchanged. | `packages/core/src/autoskill-classifier.ts`, `autoskill.ts::routeSignal` | done |
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
| ~~**Thai + German i18n scaffolded but not reviewed by a native speaker.**~~ **Native-speaker sweep completed (2026-08-09).** All Thai UI strings across dictionary and docs pages swept and polished for native flow and proper terminology. | `apps/web/lib/brain/i18n-dict.ts` | done |
| ~~**AI-translated TH / DE `welcome.*` onboarding strings unreviewed.**~~ **Native-speaker sweep completed (2026-08-09).** Swept and polished welcome/start onboarding copy across TH/DE. | `apps/web/lib/brain/i18n-dict.ts` | done |
| ~~**AI-translated TH / DE `/docs` body content unreviewed (#59).**~~ **Native-speaker sweep completed (2026-08-09).** Full native Thai sweep completed across all concept pages in `DOCS_TH` (`docs-content.ts`), including `using-from-your-agent`, `graph`, and `decisions`. | `apps/web/lib/brain/docs-content.ts` | done |
| **Pre-login auth pages (`/signin`, `/forgot-password`, `/reset-password`, `/accept-invite`) are still hard-coded English** while rendering the EN/ไทย/DE switcher. `/welcome` was lifted into i18n; these remain. A TH/DE first-timer sees an English pre-login flow. Next i18n slice. | `apps/web/app/signin/`, `apps/web/app/forgot-password/`, `apps/web/app/reset-password/`, `apps/web/app/accept-invite/` | Phase 2 |
| **Dashboard section labels are hard-coded English.** The `<SectionLabel>` rows on the dashboard (`Your projects`, `Your recent work`, `Right now`) are inline literals, not i18n keys. Pre-existing pattern in `dashboard.tsx` (the older `Your recent work` label was hard-coded too); an early PR followed it for the two new labels (`Your projects`, demoted `Right now`). Surfacing into a tracked debt so a future i18n pass can lift them at once. | `apps/web/components/brain/dashboard.tsx` | Phase 2 |
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
| ~~**`.github/workflows/ci.yml` only triggers on `main`; PRs into `develop` got no code-CI.**~~ **Obsolete (2026-06-06).** The repo collapsed to a single-server, single-`main` model — `develop` was deleted, so `main`-only CI is now correct. All feature/bugfix/docs branches PR straight into `main`, which runs the full verify job. | `.github/workflows/ci.yml` | done |

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
| ~~**`main` branch is not protected on GitHub.**~~ **Resolved (2026-06-06).** `main` now has branch protection: PR required + the two required status checks (`typecheck · test · build`, `fresh-DB migrate · FTS`). With the repo public, rulesets are free. `develop` was deleted in the single-branch migration, so the old `develop → main` fast-forward path no longer exists. | GitHub repo settings | done |

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
| **KRA `WEIGHTS` are unvalidated on a real corpus.** The current weights (semantic 0.7 / success 0.08 / recency 0.08 / ctx 0.08 / confidence 0.06) were last checked against a hand-labelled demo seed that was **retired on 2026-05-08** (the "remove all fake data" sweep) — that run put KRA at NDCG@5 0.928 vs cosine 1.000, but it was author-written against the seed it validated, so it is not evidence for today's formula. The benchmark **harness was re-shipped fixture-driven in v1.11.0** (`packages/core/src/retrieval-benchmark.ts`, reusing `kra.ts` `scoreItem`; run via `pnpm --filter @brain/core run benchmark:retrieval`), but **no number has been published from a real corpus yet** — that needs an operator export (issue #127). Until then the weights are defensible only qualitatively. If a real run shows KRA trailing cosine on clean queries, retune (issue #129). See `docs/VALIDATION.md`. | `packages/core/src/kra.ts::scoreItem`, `packages/core/src/retrieval-benchmark.ts`, `docs/VALIDATION.md` | issues #127 / #129 |

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
| ~~**Per-session value drill-down was only reachable from `#sessions`, not from the landing dashboard.**~~ The dashboard's `RecentSessions` panel listed sessions but the only affordance was *View all* → navigate to `/sessions` → click a row → finally see the two-column value panel from an early PR. Three clicks for what the user wanted on the first page. **Fix (an early PR):** lifted the existing click-to-expand behavior from `sessions.tsx` into the dashboard's `RecentSessions`. Same `SessionDetailPanel` component, same keyboard support — zero new component code. **Class of bug:** a feature that exists but isn't reachable from the surface the user actually lands on is, for most users, the same as a feature that doesn't exist. | `apps/web/components/brain/dashboard.tsx` | done |
| ~~**No per-project value summary anywhere in the product.**~~ Users could see what a single session got from the brain (an early PR) but not what a whole project had accumulated — "is the brain pulling its weight on `brain-platform`?" had no answer short of opening sessions one at a time. The aggregate was deliberately deferred in an early PR until the per-session signal was validated; once it was, the project view became load-bearing. **Fix (an early PR):** new `GET /api/projects/:id` endpoint (aggregates `SessionKnowledgeApplication` rows across every session under the project, returns two ranked lists + `hitCount` + one-line summary), new `ProjectDetailPanel` mirroring `SessionDetailPanel`, new `ProjectsList` on the dashboard with earned-surface-area gating (returns null for 0 projects, one-line for 1, full list for ≥2). Auth: any org member, mirroring the session-detail policy. See `KNOWLEDGE.md §12.30`. | `apps/web/app/api/projects/[id]/route.ts`, `apps/web/components/brain/projects-list.tsx`, `apps/web/components/brain/project-detail-panel.tsx`, `apps/web/lib/brain/use-project-detail.ts`, `apps/web/components/brain/dashboard.tsx` | done |

### Resolved 2026-05-23 (AI loop tightening + project switcher stale-state + per-session value)

| Issue | What we learned / fix |
|-------|----------------------|
| ~~**Project switcher dropdown didn't show newly-created projects.**~~ User created a project named "Start-idea" but the topbar `OrgProjectSwitcher` dropdown never listed it — only the projects that existed when the page first loaded. **Root cause:** the switcher's `load()` was called once on mount and never again. Projects created in another tab, via the CLI, or via `POST /api/projects` directly never propagated to the dropdown until a hard page reload. The component's own inline create-form already refreshed after creation, masking the bug for the common path. **Fix (an early PR):** one extra `useEffect` that calls `load()` when the `open` state flips true. Cost is one `/api/orgs` request per dropdown open (cheap, and the endpoint already uses `cache: "no-store"`). **Class of bug:** components that own a "list of remote entities" cannot trust a one-shot mount fetch when other tabs / clients can mutate the same list — refetch-on-open or refetch-on-focus is the minimum, not a nice-to-have. | `apps/web/components/brain/org-project-switcher.tsx` | done |
| ~~**E2E gate fired only on `main` push; UI-only changes shipped without rendered evidence.**~~ Six UX sweeps (v0.12.2-v0.12.4) merged with CI green on type-safety alone because the AI's harness had no `pnpm` and no browser. The `e2e-deployed.yml` workflow only triggered on push:`main`, so PR-time render verification was never possible. **Fix (an early PR):** workflow gains a `pull_request` trigger gated on the `e2e-please` label (job short-circuits when absent, so default PR cadence is unchanged). The first run of the new label found a real pre-existing bug — `e2e/security.spec.ts` hardcoded `http://localhost:3100/mcp` for two MCP-unauth tests, which had been silently failing on `main` for an unknown duration. Same PR fixed the spec to honor `E2E_BASE_URL` and added two new `AGENTS.md` sections: *Local validation* and *PR descriptions: honest test plans*. **Class of bug:** type-safety + unit tests aren't a substitute for rendered verification on surfaces whose value is visual. See `APPROACH.md §5ah`. | `.github/workflows/e2e-deployed.yml`, `apps/web/e2e/security.spec.ts`, `AGENTS.md` | done |
| ~~**Sessions table showed `K in/out` counts but never the names of items.**~~ User asked: "when I click a session I want to see what the brain gained from this session and what I got from the connection." The counts existed (`SessionKnowledgeApplication` rows per session, split by `role`), but no UI surfaced the actual items — making the round-trip opaque. **Fix (an early PR):** new `GET /api/sessions/:id` endpoint + `SessionDetailPanel` component. Click a row → expand inline to see *Brain helped you* (injected) and *Brain learned from you* (extracted_from) as two columns, each linking to the underlying skill. Auth scoped to session-owner OR org-member of the session's project; soft-deleted Knowledge filtered at the API. The companion project-level "value summary" was deliberately deferred until the per-session view's usage validates the signal — see `APPROACH.md §5ah` on validate-before-aggregate. | `apps/web/app/api/sessions/[id]/route.ts`, `apps/web/components/brain/session-detail-panel.tsx`, `apps/web/components/brain/sessions.tsx` | done |
| ~~**Chip touch-targets at 22px failed Apple HIG (44x44) and WCAG 2.5.5 on touch devices.**~~ Mobile audit confirmed the 880px breakpoint already collapsed most layouts correctly, but `.chip { height: 22px; padding: 0 8px; }` was too small for finger tap on the small viewports. Onboarding modal at `92vw` left only ~14px effective side margin on 360px phones. **Fix (an early PR):** inside the existing `@media (max-width: 880px)` block, `.chip` minimum 32px (36px for interactive chips); onboarding modal `min(500px, calc(100vw - 24px))`. New Playwright tablet + touch-target tests in `e2e/responsive.spec.ts`. | `apps/web/app/globals.css`, `apps/web/e2e/responsive.spec.ts` | done |

### Resolved 2026-05-14 (closed the full learn → retrieve → apply → feedback → compound loop)

An early PR brought cross-session KEA. An early PR fixed KRA so `scope='user'` rows return without an explicit `projectId`. An early PR wires cross-session KEA as a daily pg-boss schedule. The platform now compounds without operator intervention.

| Issue | What we learned / fix |
|-------|----------------------|
| ~~**KRA dropped `scope='user'` rows when no `projectId` was passed.**~~ KEA-extracted rows inherit `ownerProjectId` from the writing session even though their declared scope is cross-project. The old SQL filter trusted only `ownerProjectId IS NULL` to decide cross-project visibility, ignoring the `scope` column. Result: a `brain_retrieve_knowledge` call without `projectId` returned an empty bundle even when the user had 5 stored Knowledge rows. **Fix (an early PR):** `buildRawProjectFilterV2`'s "no activeProjectId" branch now respects the `scope` column — rows with `scope IN ('user','global')` are returned regardless of `ownerProjectId`. `scope='project'` rows still require an explicit `projectId`. **Class of bug:** when a row carries multiple visibility-related columns (here `scope` and `ownerProjectId`), the read-side filter must respect the column whose value declares INTENT (`scope`) over the column whose value is just metadata about origin (`ownerProjectId`). | `packages/core/src/scope-filter.ts` | done |
| ~~**Cross-session KEA never ran automatically.**~~ an early PR added the cross-session pipeline but it only ran via a manual driver script (`packages/core/scripts/run-cross-session-kea.ts`). Without a scheduled trigger, every operator had to remember to run it — a "soft" silent failure where the platform stops compounding but nothing visibly breaks. **Fix (an early PR):** new `kea.cross_extract` pg-boss queue + daily schedule (`0 6 * * *` UTC). The driver function `runCrossExtractDaily` has idempotent skip-on-no-new-sessions logic so it's safe to run repeatedly. Emits `op="kea.cross.skip"`, `op="kea.cross_extract"`, and `op="kea.cross.daily_done"` log lines. | `apps/worker/src/index.ts`, `packages/core/src/kea.ts` | done |
| **Test infrastructure: `vi.spyOn` doesn't intercept intra-module calls in ESM.** When `runCrossExtractDaily` calls `extractFromCrossSessions` inside the same module, `vi.spyOn` on the export doesn't intercept the call — Node's ESM resolves to the local function binding, not the namespace export. **Fix (an early PR):** dependency-inject the extractor via `runCrossExtractDaily({ extract? })` — production callers leave it undefined and get the real implementation, tests pass a stub. **Class of bug:** if you need to test a module function that wraps another module function, the wrapper's call site needs an injection point. `vi.mock` (full module replacement) is the alternative but blocks testing the wrapper's own logic. | `packages/core/src/__tests__/kea-cross-extract.test.ts` | done |

### Resolved 2026-05-12 (KEA pipeline diagnostic chain — knowledge_by_kea stuck at 0 even after sessions close)

An early PR. The follow-up audit to an early PR: sessions were being closed via `brain_report_session_outcome`, `kea.extract` jobs were enqueuing in pg-boss, but `knowledge_by_kea` stayed at 0 and `last_kea_extraction_at` was `never`. Three nested bugs, each invisible until the layer above it was fixed.

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
| ~~**Auth gate works ≠ pipeline learning.**~~ Spot-checking `brain-dev.example.com` after a release surfaced a silent failure: 184 successful `mcp.session.open` events over 7 days at exactly 900-second cadence (uptime probes), **zero tool calls**, and **zero session closes** (the in-memory `sessions` Map leaked forever — production had 184 entries growing). The DB confirmed: `sessions_total=0`, `knowledge_total=0`, `last_kea_extraction=never`. Tokens were authenticating fine; nothing past the auth gate ever fired. **Why it was invisible:** tool calls logged as `op="mcp.tool"` not `mcp.tool.call`, and `tools/list` calls logged nothing at all — so a histogram of `op` values showed "184 opens, 0 anything-else" which looked like the auth gate was the only thing running, not a real diagnostic. **Fix (an early PR):** (a) added `op="mcp.tools.list"` and `op="mcp.session.orphan"` log lines so probe-shape sessions leave a fingerprint; (b) added a 5-min sweeper that evicts sessions older than 30 min with zero tool calls, fixing the Map leak; (c) added `instructions` field on the MCP `initialize` response to nudge clients toward a bootstrap `brain_get_user_style` call so first-touch tool-use is automatic on capable clients (Claude Code reads it). **Class of bug to prevent in future:** logs that distinguish failure shapes are mandatory for any pipeline whose "auth works" path is much shorter than its "actually works" path. See `docs/APPROACH.md §5ab`. | `apps/mcp-server/src/index.ts` | done |
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
6. **Two different things are called "Skills"** (2026-08-22). The webapp's
   Skills tab renders **Knowledge** rows (`components/brain/skills.tsx` →
   `useKnowledge`), while the `Skill` table is a separate, headless store of
   markdown bundles written only by autoskill's `internal_skill` route
   (`kind: "internal"` — platform self-improvement) and read only through the
   `brain_find_skill` MCP tool. Both are legitimate; the collision is the
   problem. Building a user-facing page for the `Skill` table would put two
   things named Skills in one product, so the open question is naming and
   surface, not implementation. Until it is answered, `Skill` stays headless
   and internal — and as of v2.19.1 its rows are at least embedded, so
   `brain_find_skill` can return them.

5. ~~**Model portability** — if we switch embedding models, we invalidate the similarity space. How do we re-embed ~1M items safely without downtime?~~ **Mechanism answered (2026-08-18, §0aq); scale still open.** Each row now records the model that produced its vector (`Knowledge.embeddingModel`), and the 10-minute backfill re-embeds anything whose model differs from the active one, converging the index without a maintenance window — verified on prod (79 rows, `remaining: 0`, idempotent on re-run). The measured hazard it closes: vectors from two Gemini models scored **−0.024** cosine on the same sentence, so a partial migration is not "slightly degraded", it is orthogonal. What remains open at ~1M items is throughput and cost, not correctness: convergence is bounded by the 256-row batch per 10-minute tick (≈36k rows/day), retrieval quality is mixed until it completes, and re-embedding the whole corpus is a real provider bill. A large migration needs a rate-limit-aware runner and a decision on whether to serve stale-model rows during convergence.
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
