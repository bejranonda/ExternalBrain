# UI/UX Master Audit — External Brain

**Date:** 2026-08-05
**Scope:** whole repository, auto-discovered (no path assumptions)
**Method:** config inspection → deterministic grep sweep → source review → numeric WCAG contrast computation → targeted refactor

> Supersedes `apps/web/MASTER_UI_UX_AUDIT.md` from the first pass, which was
> written against a brief that assumed `apps/web/src` and Tailwind utilities.
> Both assumptions were wrong; this document is the consolidated result.

---

## 1. Stack & Structure Summary

| Aspect | Detected |
|---|---|
| **Monorepo** | pnpm workspaces (`apps/*`, `packages/*`) + Turborepo; pnpm 9.15.0, Node ≥20 |
| **Framework** | Next.js 16 App Router, React 19 |
| **Frontend surface** | **`apps/web` only.** `apps/mcp-server` and `apps/worker` ship no UI. The only other `.tsx` files in the repo are LLM benchmark fixtures under `packages/core/generation-uplift/` — not application code. |
| **Layout** | `apps/web/app` (routes) · `apps/web/components/brain` (39 components) · `apps/web/lib/brain` (36 hooks/utils). **No `src/` directory.** |
| **Styling** | **CSS custom properties + semantic classes**, all in the 1091-line `apps/web/app/globals.css`. `tailwindcss` is a listed dependency but there is **no `tailwind.config.*` and no `postcss.config.*`** — Tailwind utilities do not compile. All 565 `className` usages reference hand-authored classes (`panel`, `row`, `btn`, `mono`, `chip`, `grow`, `kbd-key`). |
| **Data fetching** | Custom hooks over `fetch` with an explicit `LoadState` union (`"loading" \| "ready" \| "error"`, plus `"empty"`, `"idle"`, `"unauthorized"` where meaningful). No SWR/TanStack Query. `AbortController` cleanup is standard. |
| **Auth** | Auth.js (next-auth) v5, `auth()` in server components |
| **Deploy** | Docker Compose + Caddy reverse proxy with auto-TLS (`deploy/Caddyfile`); webapp and MCP server are **separate vhosts** |

### Design language (already established, not introduced by this audit)

The codebase already occupies the "high-density workbench" destination: `--bg: #0A0A0B`, hairline `--line: #242429` borders, a four-step elevation ramp, a five-step type scale anchored at 16px, tabular numerics, a documented z-index ladder, and an ink ramp annotated in-source with its WCAG targets.

**Phase 3's anti-pattern sweep returned zero hits across the entire application** — no `bg-gradient-to`, `from-indigo`, `from-purple`, `rounded-2xl`, `rounded-3xl`, `p-8`, `p-10`, or `shadow-2xl`. Likewise zero `onClick={() => {}}`, zero `TODO`/`FIXME`, zero `href="#"`. There were no AI template tropes to purge.

---

## 2. Validation Scorecard

| Dimension | Verdict | Evidence |
|---|---|---|
| **Wiring / functional integrity** | ⚠️ 2 blockers (fixed) | Token wizard MCP URL; permanent stale-error state in admin audit log |
| **Contrast (WCAG 1.4.3)** | ⚠️ 1 failure (fixed) | Design tokens all pass; one hardcoded colour pair at 3.82:1 |
| **Focus visibility (2.4.7)** | ⚠️ 2 failures (fixed) | Textareas and links had no focus indicator |
| **Status messages (4.1.3)** | ⚠️ 1 failure (fixed) | Bulk destructive op reported outcome visually only |
| **Use of colour (1.4.1)** | ⚠️ 1 failure (fixed) | Prose links visually identical to body text |
| **Character key shortcuts (2.1.4)** | ⚠️ 1 failure (self-inflicted, reverted) | See §5 |
| **4-state boundaries** | ⚠️ 1 gap (fixed) | 12 components use `LoadState` correctly; admin audit log had no loading state |
| **Destructive guardrails** | ⚠️ 1 gap (fixed) | Autoskill reject was one-way and unguarded |
| **Client-side secret exposure** | ✅ **Pass** | Zero `process.env` reads in any `"use client"` file. Sole `NEXT_PUBLIC_*` is `APP_VERSION` (a `git describe` string). |
| **Reverse-proxy correctness** | ✅ Pass | `X-Forwarded-For` parsed consistently across ~20 API routes; Caddy sets `X-Forwarded-Proto` |
| **Operational telemetry** | ✅ Pass | `ConnectionStatus`, `QueueHealthCard`, `BackupStatusCard`, `LoopHealthCard` built and mounted |
| **i18n resilience** | ⚠️ 1 risk (fixed, measured) | Thai font swapped without line-height compensation. *Note:* `i18n.spec.ts` and `responsive.spec.ts` do not run in CI — see F3 |
| **e2e coverage wiring** | 🔴 **20 of 31 specs never run** | See F3 — including `a11y.spec.ts` and `responsive.spec.ts` |
| **Aesthetic (anti-AI-template)** | ✅ Pass | 0/8 tropes present |

---

## 3. Categorized Findings

### `[BLOCKER]` B1 — Token install wizard emitted an unreachable MCP URL

**`apps/web/app/settings/tokens/page.tsx:860-865`** (pre-refactor)

Issue #293 — install snippets baking in `${hostname}:3100/mcp` — was found, fixed, and guarded by `e2e/welcome-public-urls.spec.ts`. But fix and test were both scoped to `/welcome`. **The identical defect was still live in the token install wizard**, the surface operators actually use to connect their first client. The page was `"use client"`, so it *structurally could not* read `BRAIN_MCP_PUBLIC_HOSTNAME`.

Behind Caddy the MCP server is its own vhost on :443 (`deploy/Caddyfile:70`) — port 3100 is not exposed. The operator's first copy-paste fails.

**The test named a page instead of a bug class, so it never looked.**

```diff
- // app/settings/tokens/page.tsx  ("use client")
- function resolveMcpUrl(): string {
-   if (typeof window === "undefined") return "http://localhost:3100/mcp";
-   return `${window.location.protocol}//${window.location.hostname}:3100/mcp`;
- }
- ...
-   mcpUrl={resolveMcpUrl()}
+ // app/settings/tokens/page.tsx  (server component)
+ export const dynamic = "force-dynamic";
+
+ function resolvePublicMcpUrl(): string | undefined {
+   const host = process.env.BRAIN_MCP_PUBLIC_HOSTNAME?.trim();
+   return host ? `https://${host}/mcp` : undefined;
+ }
+ export default function TokensPage() {
+   return <TokensClient mcpUrl={resolvePublicMcpUrl()} webUrl={resolvePublicWebUrl()} />;
+ }
+
+ // app/settings/tokens/tokens-client.tsx  ("use client")
+   mcpUrl={mcpUrl ?? resolveMcpUrl()}   // env wins; heuristic is dev-only
```

`force-dynamic` is load-bearing: `deploy/Dockerfile` builds with dummy env, so a pre-rendered page would freeze an empty hostname at image-build time (the `#293 round 2` hazard, documented at `app/welcome/page.tsx:11-16`).

**A third surface.** Sweeping the bug class (rather than the bug) found `components/brain/onboarding.tsx:128` also hardcoding the endpoint in its copy-paste `mcp.json`, with prose telling the operator to hand-edit it — and pointing them at the tokens page for the correct value, which was itself wrong until this changeset. Now threaded from the server component through `BrainApp` → `Onboarding`.

The three resolvers have been consolidated into `lib/brain/public-urls.ts`; duplicating them per-surface is *why* the bug kept reappearing.

**Guarded by:** a new describe block in `e2e/welcome-public-urls.spec.ts` covering the wizard, plus `lib/brain/public-urls.test.ts` — a source-level guard that fails if any new file hardcodes the port. That second test is the one that matters: it is named after the bug class, so a fourth surface cannot appear silently.

---

### `[BLOCKER]` B2 — Admin audit log pinned a stale error forever

**`apps/web/app/admin/audit/page.tsx:25-38`** (pre-refactor)

`setError` was only ever *set*, never cleared. One transient failure left the error banner on screen for the rest of the session — including after a successful refetch, so the page showed fresh rows under a stale error. There was also no retry affordance and no loading state (`rows` starts `null`, rendering an empty `<tbody>` indistinguishable from "no results").

```diff
  const load = useCallback(async () => {
+   setError(null);
+   setBusy(true);
    try {
      ...
      setRows(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
+   } finally {
+     setBusy(false);
    }
  }, [filterOrgId, filterProjectId, filterAction]);

- useEffect(() => { void load(); }, [load]);
+ // Debounced: `load` is keyed on three filter strings, so every keystroke
+ // previously fired a fresh LIMIT 200 query against the audit table.
+ useEffect(() => {
+   const t = window.setTimeout(() => void load(), 250);
+   return () => window.clearTimeout(t);
+ }, [load]);
```

```diff
- {error && <div role="alert" style={{ color: "var(--warn)", … }}>{error}</div>}
+ {error && (
+   <div role="alert" className="row" style={{ color: "var(--bad)", … }}>
+     <span>Couldn&rsquo;t load the audit log — {error}</span>
+     <button type="button" className="btn btn-ghost" onClick={() => void load()}>Retry</button>
+   </div>
+ )}
```

Also fixed here: `--warn` (yellow) used to signal an error where `--bad` exists; loading skeleton rows added; distinct empty states for "no data" vs "no matches"; `scope="col"` and an `sr-only` `<caption>` added to the table.

---

### `[FRICTION]` F1 — Autoskill reject was irreversible and unguarded

**`apps/web/lib/brain/use-autoskill.ts:58-77`**

`reject` optimistically removed the row and POSTed; no un-reject endpoint existed. `skills.tsx:245` guards delete with `window.confirm`, but reject had nothing.

Because rejecting is a **pure status flip** — unlike apply, it writes no knowledge rows — undo was safe to add without unwinding side effects. `status` is a plain `String` and `resolvedAt` is `DateTime?` in `packages/db/prisma/schema.prisma:442-461`, so **no migration is required**.

```diff
- action: z.enum(["apply", "reject"]),
+ action: z.enum(["apply", "reject", "unreject"]),
```
```diff
+ } else if (body.action === "unreject") {
+   const claim = await db.autoskillProposal.updateMany({
+     where: { id, userId, status: "rejected" },
+     data: { status: "pending", resolvedAt: null },
+   });
+   if (claim.count === 0) { /* 404 / 403 / 409 not_rejected */ }
+ } else {
```

The UI now shows a 10-second undo toast in a `role="status"` live region (`"status"` rather than `"alert"` — an undo offer is informational and shouldn't interrupt a screen-reader user mid-sentence).

---

### `[FRICTION]` F2 — Admin audit filters fired a query per keystroke

Covered by the B2 diff above (250 ms debounce). Typing a 12-character action filter previously issued 12 `LIMIT 200` queries.

---

### `[BLOCKER]` F3 — **20 of 31 Playwright specs never run in CI**

Found while fixing a CI failure this audit caused. The two e2e workflows name their specs explicitly, and the lists have drifted badly behind the suite:

**Runs (11):** `dashboard`, `docs-i18n`, `healthz`, `meetings`, `mobile-overflow`, `nav`, `page-scroll`, `security`, `sessions`, `skills`, `welcome-public-urls`

**Never runs (20):** `a11y`, `autoskill`, `credentials-signup`, `empty-dashboard`, `graph`, `i18n`, `onboarding`, `onboarding-orientation`, `oracle`, `org-invites`, `palette`, `password-reset`, `projects`, `responsive`, `settings-org`, `signout`, `streaming`, `tokens`, `tweaks`, `visual`

This is the same defect `.github/workflows/authed-e2e.yml:205-215` documents for a *previous* spec ("fell into NEITHER e2e workflow, so its tests… had never actually run in CI despite existing in the repo"). It was fixed for that one file and not generalized — **the identical shape as #293**: an instance repaired, the class left open.

**This materially corrects an earlier claim in this report.** The scorecard originally rated i18n and responsive coverage a pass by citing `i18n.spec.ts`, `responsive.spec.ts` and `mobile-overflow.spec.ts` as existing coverage. Only `mobile-overflow` actually runs. `a11y.spec.ts` — the suite most relevant to this audit's own subject — has never gated a single PR.

**Not fixed here, deliberately.** Wiring 20 unrun specs into CI will almost certainly surface pre-existing failures, which belongs in its own PR rather than smuggled into an audit remediation. Recommended follow-up: enable them one workflow at a time, starting with `a11y` and `responsive`.

---

### `[ACCESSIBILITY]` A1 — Textareas had no visible focus indicator (2.4.7)

**`apps/web/app/globals.css:173` + `:197`**

`input, textarea` reset `outline: 0`, but the restoring `:focus-visible` rule listed only `input`. Every textarea in the app — Teach, Oracle, meetings transcript, autoskill edit modal — was keyboard-invisible.

### `[ACCESSIBILITY]` A2 — Links had no focus indicator (2.4.7)

**`apps/web/app/globals.css:174`** — `a { color: inherit; text-decoration: none; }` with no `a:focus-visible` rule anywhere in 1091 lines.

```diff
- button:focus-visible, input:focus-visible, [role="button"]:focus-visible {
+ button:focus-visible,
+ input:focus-visible,
+ textarea:focus-visible,
+ select:focus-visible,
+ a:focus-visible,
+ summary:focus-visible,
+ [tabindex]:focus-visible,
+ [role="button"]:focus-visible {
    outline: 1.5px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--r-sm);
  }
```

### `[ACCESSIBILITY]` A3 — Prose links were indistinguishable from body text (1.4.1)

The same global `a` reset is *correct* for nav chrome (rail, cards, breadcrumbs) but left inline links in body copy with no colour delta and no underline — undiscoverable. 5 sites: `settings/reset-knowledge/page.tsx:153,301`, `admin/page.tsx:57,61,65`.

Scoped by `:not([class])` because every nav/styled link in the app carries a `className` and every prose link does not (3 of 21 `<a>` elements are styled).

```diff
+ p a:not([class]),
+ li a:not([class]) {
+   color: var(--accent-text);
+   text-decoration: underline;
+   text-underline-offset: 2px;
+   text-decoration-thickness: 1px;
+ }
```

### `[ACCESSIBILITY]` A4 — Destructive button failed AA contrast (1.4.3)

**`apps/web/app/settings/reset-knowledge/page.tsx:275-277`**

`color: white` on `background: #e05252` = **3.82:1**, below the 4.5:1 floor — on the single most destructive control in the product (bulk knowledge deletion). The hardcoded colours also bypassed the token system entirely.

```diff
-   background: canSubmit ? "var(--bad, #e05252)" : "var(--bg-elev-1)",
-   color: canSubmit ? "white" : "var(--ink-3)",
-   borderColor: canSubmit ? "var(--bad, #e05252)" : "var(--line)",
+   background: canSubmit ? "var(--bad)" : "var(--bg-elev-1)",
+   color: canSubmit ? "var(--bg)" : "var(--ink-3)",
+   borderColor: canSubmit ? "var(--bad)" : "var(--line)",
```

`--bg` on `--bad` measures **8.36:1**.

### `[ACCESSIBILITY]` A5 — Bulk delete gave screen readers no confirmation (4.1.3)

Same file. After deleting N rows, the result panel rendered with no live region — a screen-reader user received no feedback that anything happened.

```diff
+ <div aria-live="polite" aria-atomic="true">
    {result?.kind === "ok" && (
-     <section className="panel" style={{ … }}>
+     <section className="panel" role="status" style={{ … }}>
        ✓ Reset complete — {result.deleted} row…
    {result?.kind === "err" && (
-     <section className="panel" style={{ background: "rgba(224,82,82,0.07)", color: "#e05252" }}>
+     <section className="panel" role="alert" style={{
+       background: "color-mix(in oklab, var(--bad) 8%, transparent)",
+       color: "var(--bad)" }}>
+ </div>
```

### `[ACCESSIBILITY]` A6 — Unlabeled filter inputs (3.3.2 / 4.1.2)

**`apps/web/app/admin/audit/page.tsx:53-70`** — three filter inputs carried only `placeholder`. Placeholders are not accessible names; they vanish on input and several screen readers skip them. Added `aria-label` to each.

### `[ACCESSIBILITY]` A7 — No reduced-motion support (2.3.3 / 2.2.2)

Two infinite-loop keyframes (`pulse` on the live-dot, `bp-blink` on the Oracle caret) plus 12 transitions, with no escape hatch. Added a `@media (prefers-reduced-motion: reduce)` block.

### `[ACCESSIBILITY]` A8 — Table clipped instead of scrolling on mobile (1.4.10)

**`apps/web/app/admin/audit/page.tsx:93`** — the wrapper used `overflow: hidden`. Six columns of IDs, timestamps and IPs cannot fit 375px, so content was silently cut off rather than scrollable. Changed to `overflowX: "auto"`.

---

### `[AESTHETIC]` / i18n — Thai lacked line-height compensation

**`apps/web/app/globals.css:685-686`**

Thai is a supported locale and the font *is* swapped (`Noto Sans Thai`), but the **leading never was**. Thai stacks an upper vowel above the base glyph and a tone mark above that, so a line box tuned for Latin lets consecutive lines collide.

**Measured** in headless Chromium against the real `Noto Sans Thai` webfont, comparing `TextMetrics` ink height (`actualBoundingBoxAscent + actualBoundingBoxDescent`) to the computed line box:

| Site | font/line-height | line box | Thai ink | Result |
|---|---|---|---|---|
| `docs/concepts/[slug]/concept-view.tsx:41` | 32px / 1.1 | 35.2px | 42.0px | **6.8px overlap** |
| `globals.css:393` `.rail-user-meta` | 12px / 1.1 | 13.2px | 17.0px | **3.8px overlap** |
| `oracle.tsx:452,636`, `skills.tsx:632`, `dashboard.tsx:561,766` | 13px / 1.35 | 17.55px | 17.0px | −0.55px — no collision |
| *Latin control* | 32px / 1.1 | 35.2px | 33.0px | no collision |
| **Proposed heading fix** | 32px / **1.4** | 44.8px | 42.0px | −2.8px clearance ✅ |
| **Proposed body fix** | 13px / **1.75** | 22.75px | 17.0px | −5.75px clearance ✅ |

The Latin control passing at the *identical* 32px/1.1 setting confirms this is specific to Thai, not a general leading problem.

**Correction:** an earlier draft of this report listed the 1.35 sites as at-risk. They are not — they clear by 0.55px. Only the two 1.1 sites actually collide. The `p/li/td` → 1.75 rule remains a readability improvement for stacked Thai, but it is not fixing a defect at those call sites.

```diff
+ html[lang="th"] :is(h1, h2, h3) { line-height: 1.4 !important; }
+ html[lang="th"] :is(p, li, td, dd, .oracle-answer) { line-height: 1.75 !important; }
```

`!important` is required because the tight values are set as **inline styles**, which outrank any normal stylesheet rule. Scoped to the Thai locale so Latin rendering is untouched.

> **Verification note:** the table above is measured, not inferred. What is
> *not* verified is the end-to-end appearance in the running app — the
> measurement isolates the typography, so a screenshot at `?lang=th` is still
> worth one look before trusting it fully.
> I also checked and **discarded** a false positive: `home-hero.tsx:65` uses
> line-height 1.05 but renders `{count.toLocaleString()}` — a number, never Thai.

---

## 4. Findings NOT fixed (deliberate)

| # | Finding | Why not |
|---|---|---|
| N1 | `app/sitemap.ts:19-20` falls back to `localhost:3000` | Correct for local dev; deployed instances always set `BRAIN_PUBLIC_HOSTNAME` (`deploy/docker-compose.yml:93`). Sitemap-only impact. |
| N2 | `--line-strong` (#2F2F36) is 1.28:1 on `--bg-elev-3` | Used as scrollbar thumb and row separator — decorative. WCAG 1.4.11 governs UI-component boundaries; inputs here carry their affordance via a filled `--bg-elev-2` background. Flagged for your call, not changed unilaterally. |
| N3 | 10 near-duplicate `LoadState` unions across `lib/brain/` | Real duplication, but a cross-cutting type refactor deserves its own PR and review surface. |
| N4 | `AGENTS.md` documents `apps/sync-bridge/` | That directory does not exist. Doc drift, not a UI issue — noted for a docs sweep. |
| N5 | `reset-knowledge` retains `hard: true` in state when scope changes away from `all` | The checkbox is hidden but the flag persists; harmless today because the `older-than` request body omits `hard`. Latent surprise, not a live bug. |

---

## 5. Correction: a Level A violation I introduced and reverted

The first pass of this audit added <kbd>J</kbd>/<kbd>K</kbd>/<kbd>A</kbd>/<kbd>R</kbd>/<kbd>U</kbd> shortcuts to the Autoskill queue, bound to a `window` keydown listener.

That **violates WCAG 2.1.4 Character Key Shortcuts (Level A)**, which requires single-character shortcuts to be turn-off-able, remappable, or active only on focus. The implementation was none of those. The input guard also only skipped `input`/`textarea`/`select`/`contenteditable` — tabbing to a link and pressing <kbd>R</kbd> would still have rejected the selected proposal.

Removed at the operator's direction. The feature was also built on an unvalidated assumption that anyone triages these proposals in bulk.

**What was deliberately kept:** standard keyboard operability — Tab order, Enter/Space activation, Esc-to-close, and the focus-ring fixes in A1/A2. Those are WCAG 2.1.1 and 2.4.7 requirements, categorically different from optional accelerators.

---

## 6. Files Changed

```
apps/web/app/admin/audit/page.tsx                  +83  ← refactor 1
apps/web/app/settings/reset-knowledge/page.tsx     +90  ← refactor 2
apps/web/app/globals.css                           +74  ← refactor 3 (systemic)
apps/web/components/brain/autoskill.tsx            +95
apps/web/app/api/autoskill/proposals/[id]/route.ts +20
apps/web/lib/brain/use-autoskill.ts                +17
apps/web/e2e/welcome-public-urls.spec.ts           +47
apps/web/app/settings/tokens/{page → tokens-client}.tsx +19
```

**No Prisma migration in this diff** — relevant to the autonomous-deploy safety envelope.

---

## 7. Verification Status — read before merging

Per the repo's honest-test-plan rule:

The local toolchain gap that blocked verification in earlier drafts is now closed: Node 20 + pnpm 9.15.0 are installed under `/root/.nvm`, symlinked into `/root/.local/bin` (system Node 18 at `/usr/bin/node` untouched).

**Performed**
- ✅ **`pnpm turbo run typecheck` — 9/9 tasks pass.** This caught a real error that parse-checking had missed: the workspace sets `exactOptionalPropertyTypes`, under which `mcpUrl?: string` rejects an explicitly-passed `undefined`. Fixed to `?: string | undefined`.
- ✅ **`pnpm turbo run test` — 710 passed, 6/6 tasks.** *Caveat:* all 19 `apps/web` route tests self-skip when no DB is reachable, so the web changes have no unit coverage from this run.
- ✅ **`pnpm turbo run build` — 6/6 tasks, 50/50 static pages.** The one warning is a pre-existing OpenTelemetry `Critical dependency` notice, unrelated to this diff.
- ✅ **New test passes: `lib/brain/public-urls.test.ts`, 4/4** — needs no DB, so it runs in CI unconditionally.
- ✅ Thai typography measured in headless Chromium against the real webfont (table in §3)
- ✅ Deterministic greps across all of `apps/`, `packages/`, `deploy/`
- ✅ Contrast computed numerically (11 tokens × 4 surfaces, plus the 2 hardcoded pairs)
- ✅ Client-side secret sweep: zero `process.env` in any `"use client"` file
- ✅ Confirmed schema nullability permits `unreject` without a migration
- ✅ Confirmed zero shortcut residue after the 2.1.4 revert

**NOT performed**
- ⬜ The wizard e2e test now lives in `e2e/tokens.spec.ts`, which **no workflow runs** (F3). It is written but does not gate anything. The unconditional guard for this bug class is `lib/brain/public-urls.test.ts`.
- ⬜ `apps/web` route tests (skip without a database)
- ⬜ Live browser validation at 375 / 768 / 1440px (`responsive.spec.ts`, `mobile-overflow.spec.ts` exist but were not run)
- ⬜ End-to-end exercise of the undo flow against a real database
- ⬜ Visual confirmation of Thai in the running app (the measurement isolates typography only)

The undo endpoint is the change most deserving a hands-on pass — it is the only one that mutates persisted state and it has no executed test.
