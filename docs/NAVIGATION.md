# Navigation — Zero-Error Iteration Process

Scope: the in-app navigation of `apps/web` — the six surfaces (Dashboard,
Oracle, Skills, Graph, Autoskill, Sessions) plus the Tweaks panel and
command palette.

The design's promise is **every surface is reachable in at most two
interactions**. This document defines how we validate that promise
continuously, catch regressions early, and avoid navigation defects
shipping.

---

## 1. Navigation surfaces

There are exactly six primary surfaces. They are enumerated once in
`apps/web/lib/brain/routes.ts` and consumed by:

- `Rail` (desktop left rail)
- `BottomNav` (mobile bottom bar)
- `Topbar` breadcrumbs
- `CmdK` command palette
- Global number-key bindings (`1`..`6`)
- Hash-based deep links (`#dashboard`, `#oracle`, …)

**Rule:** adding or renaming a surface touches `ROUTES`, `KEY_MAP`, and
the i18n `nav.*` dictionary in the same change. No other file should
hard-code a surface name.

## 1b. The public funnel (anonymous visitors)

Four public pages, each with one job. Adding a fifth needs a job none of these
has — the recurring failure here has been breadth, not depth. `/welcome`
carried two jobs through v2.14.x (pick a tool + verify the connection); the
first was removed in v2.15.0 once `/docs/tutorials/00-quick-start` existed to
own it properly — see `KNOWLEDGE.md §12.34` for the general lesson that
surfaced.

| Page | Its one job | Sends you to |
|---|---|---|
| `/` | What is this, and which door do I take? Renders for anonymous visitors only; signed-in users are routed to `/[orgSlug]/[projectSlug]`. | `/start`, `/signin`, `/docs` |
| `/start` | I hold a voucher code. Prefills `?voucher=`, offers agent-driven or browser setup. Target of every voucher error on `/signin`. | `/signup` (voucher forwarded), the agent prompt, `/welcome` (labelled "Already installed? Check your connection" — not "guided tour", which described a flow `/welcome` no longer has) |
| `/docs` | Concept primers + tutorials (in-app, real markdown), localised, no auth. Tutorials lead the page — a first-timer needs "how do I connect" before "what is Autoskill". | `/docs/tutorials/[slug]`, `/docs/concepts/[slug]`, repo docs on GitHub |
| `/welcome` | Post-install verification only: has your Brain actually learned anything yet? Live poll with 90s/5min stuck-state escalation — the one thing none of the other three pages do. Not an entry point; this is where the installer and the quick-start tutorial send people AFTER install. | `/docs/tutorials/00-quick-start` (if not installed yet), `/` (once it worked) |

`/signin`, `/signup`, `/forgot-password`, `/reset-password` and `/accept-invite`
are also anonymous-reachable but are transactional, not navigational — they are
not part of the funnel and should not accumulate explanatory copy.

## 2. Entry points (must all work)

| Entry point | Desktop | Mobile |
|---|---|---|
| Left rail item click | ✓ | n/a (rail hidden) |
| Bottom nav tap | n/a | ✓ |
| Number key `1`..`6` | ✓ | n/a |
| `⌘K` / `Ctrl K` palette (fuzzy) | ✓ | ✓ (tap search pill) |
| Breadcrumb click | ✓ | ✓ |
| Deep link `/#<route>` | ✓ | ✓ |
| Browser back/forward | ✓ | ✓ |
| Dashboard CTA ("View all", "Review") | ✓ | ✓ |

## 3. Pre-merge checklist (run on every PR that touches nav)

Run through this list by hand or script the subset that can be
automated. Each item is stated as a pass/fail assertion.

### Keyboard
- [ ] `1`..`6` switch to the expected surface from idle focus.
- [ ] `1`..`6` are **ignored** while focus is inside `<input>` /
      `<textarea>` / `contentEditable`.
- [ ] `⌘K` toggles the palette; `Esc` closes it.
- [ ] Palette `Enter` fires the top result.
- [ ] Tab order inside the palette is sane (input → first item).
- [ ] `Esc` from the Tweaks panel closes it without changing route.

### Mouse / touch
- [ ] Every rail item highlights on hover and shows the correct
      `aria-current="page"` when active.
- [ ] Bottom nav badge shows pending proposals count and disappears
      when zero.
- [ ] Topbar breadcrumbs reflect the current route in the current
      language.
- [ ] "Teach" button is visually primary but is **not** a navigation
      action (clicking it does not change route).

### Deep links & history
- [ ] Reloading the page on any surface (e.g. `/#graph`) restores that
      surface.
- [ ] Clicking rail items updates the URL hash without a full
      navigation.
- [ ] Browser back/forward moves between surfaces you previously
      visited.
- [ ] Bookmarking `/#oracle` and opening it in a new tab lands on
      Oracle.

### Responsive
- [ ] Rail hidden below 880 px; bottom nav visible.
- [ ] Bottom nav respects iOS safe-area inset (visible on notched
      devices).
- [ ] Tweaks panel becomes a bottom sheet on mobile and never overlaps
      the bottom nav.
- [ ] Command palette full-width on mobile; input autofocuses without
      scrolling the page.
- [ ] Skills layout collapses filters → list → detail cleanly at
      breakpoint.
- [ ] Graph inspector re-flows below the canvas; canvas stays pinch-
      zoomable.

### i18n
- [ ] Switching language via Tweaks re-renders all nav labels within
      one frame (no stale EN strings).
- [ ] Thai + German labels do not clip in the rail at balanced
      density.
- [ ] `html[lang]` attribute updates (used by the Thai font CSS rule).

### Accessibility (treated as navigation correctness, not polish)
- [ ] Rail, Topbar, BottomNav each have an `aria-label`.
- [ ] Active surface carries `aria-current="page"`.
- [ ] Focus-visible outline appears for keyboard users on every
      interactive element in the nav chain.
- [ ] Palette has `role="dialog"` and `aria-modal="true"` and traps
      focus while open.
- [ ] All icon-only buttons have a `title` / `aria-label`.

### Persistence
- [ ] Last surface persists across reloads (localStorage `bp_route`).
- [ ] Tweaks (theme, accent, density, language) persist across reloads
      without causing a flash of default theme — the pre-hydrate
      script in `app/layout.tsx` handles this.

### Automated companions

The manual checklist above is the source of truth, but parts of it now
have script equivalents. Run these on every nav-touching PR before
walking the manual list — they catch the cheapest 80% mechanically:

| Script | What it covers from §3 |
|---|---|
| `./scripts/nav-smoke.sh` | Every shell hash-route, every auth route, every admin route, every `/api/*` probe — exits non-zero on any 5xx. The "deep links" + "Bookmarking" + "Reloading the page" rows. |
| `./scripts/verify-lockdown.sh` | Auth-posture: anonymous → 401 on protected routes, 307 on root, MCP strict gate. Catches a class of regression that's easy to miss visually. |
| `pnpm --filter @brain/web e2e` | Playwright: keyboard, mouse, deep-links, breadcrumbs, palette, browser back/forward. Covers the "Keyboard" + "Mouse / touch" + "History" rows. ~3 min on a warm box. |
| `pnpm turbo run test` | Unit tests for routes/i18n/hooks. ~3 sec cached. Catches `routes.ts` ↔ i18n drift and stale dictionary keys. |

CI runs `nav-smoke` + `verify-lockdown` automatically at the end of
`./scripts/reload.sh web` and both deploy scripts. The Playwright suite
runs locally (e2e package isn't yet wired into the GitHub Actions
workflow — see #37 follow-ups).

## 4. Iteration loop (until zero-error)

This is the repeatable process we run whenever nav changes:

1. **Define the change.** Open a scratch note with the one-line
   statement of what's changing (e.g. "add /sessions/:id detail
   route").
2. **Update `routes.ts` and i18n dicts first.** If those don't compile
   or translate, the change is ill-shaped — stop and rethink before
   touching components.
3. **Implement the minimum.** One surface at a time. Don't chain
   refactors.
4. **Run the checklist above.** Mechanical. If any item fails, fix
   before moving on.
5. **Script the failure.** Anything we caught by hand that we *could*
   have caught automatically becomes a line in `navigation.e2e.ts`
   (Playwright — planned). This is how zero-error stays zero-error:
   each human-found defect leaves a test behind.
6. **Record the result.** Tick the checklist in the PR description and
   note any item we consciously skipped and why.

We stop iterating on a change when:

- every checklist item passes, and
- the new failure mode (if any) is encoded as a test, and
- a teammate can reproduce the checklist run locally in <5 minutes.

## 5. Known gaps (next iterations)

These are not bugs today but are the next things to attack:

- **No e2e test harness yet.** Checklist is run manually.
- ~~**Breadcrumbs are not clickable.**~~ Each crumb is now a button. The last crumb carries `aria-current="page"` and re-focuses the current surface; parent crumbs jump to the category's canonical landing surface (workspace → dashboard, activity → sessions).
- ~~**Palette has no fuzzy search.**~~ `fuzzyScore()` in `shell.tsx` — consecutive-run + word-start bonuses, substring fast path.
- ~~**No route guard for invalid hashes.**~~ `/#totally-wrong` still falls back to `dashboard`, but `routes.ts` now emits a `console.warn` with the allowed set on both initial hydrate and subsequent `hashchange` events when `NODE_ENV !== "production"`.
- **Mobile: no swipe gesture** between adjacent surfaces. Explicit
  decision — taps and bottom nav remain the only way in, to avoid
  accidental navigation mid-scroll.

## 6. Reference: how the pieces fit

```
apps/web/
  app/
    layout.tsx          # fonts, pre-hydrate theme/tweaks script
    page.tsx            # mounts <BrainApp />
    globals.css         # design tokens + responsive rules
    api/
      dashboard/route.ts          # GET  /api/dashboard
      knowledge/
        route.ts                  # GET, POST  /api/knowledge
        [id]/route.ts             # PATCH, DELETE  /api/knowledge/[id]
        [id]/fork/route.ts        # POST  /api/knowledge/[id]/fork
      proposals/
        route.ts                  # GET  /api/proposals
        [id]/route.ts             # PATCH  /api/proposals/[id]
      sessions/
        route.ts                  # GET  /api/sessions
        [id]/route.ts             # GET  /api/sessions/[id]
      autoskill/
        route.ts                  # GET  /api/autoskill
        [id]/approve/route.ts     # POST  /api/autoskill/[id]/approve
      graph/route.ts              # GET  /api/graph
      me/route.ts                 # GET  /api/me
  components/brain/
    app.tsx             # route state, keybinds, Lang context, Tweaks
    shell.tsx           # Rail / Topbar / BottomNav / CmdK
    tweaks.tsx
    dashboard.tsx, oracle.tsx, skills.tsx, graph.tsx,
    autoskill.tsx, sessions.tsx
    icons.tsx
  lib/brain/
    routes.ts           # ROUTES, KEY_MAP, useRoute (hash + storage)
    i18n.ts             # I18N dict, translate(), useT(), LangContext
    tweaks.ts           # TweakState, ACCENTS, useTweaks, applyTweaks
    data.ts             # typed seed data (BRAIN_DATA; fallback when API unreachable)
    views.ts            # view types + mapper functions (schema→GUI contract)
    auth.ts             # getCurrentUserId(), authErrorResponse()
    use-knowledge.ts    # KnowledgeItemView[], update, fork
    use-sessions.ts     # SessionView[], session detail
    use-autoskill.ts    # ProposalView[], approve
    use-counts.ts       # badge counts (polls /api/dashboard every 30 s)
    use-live-extraction.ts  # active extraction status (polls every 15 s)
```

## 7. Component → hook → endpoint map

| GUI action | Component | Hook | Endpoint |
|---|---|---|---|
| Dashboard load | `dashboard.tsx` | `useCounts` | GET `/api/dashboard` |
| Knowledge list | `skills.tsx` | `useKnowledge` | GET `/api/knowledge` |
| Edit knowledge item | `skills.tsx` | `useKnowledge.update` | PATCH `/api/knowledge/[id]` |
| Delete knowledge item | `skills.tsx` | `useKnowledge.remove` | DELETE `/api/knowledge/[id]` |
| Fork knowledge item | `skills.tsx` | `useKnowledge.fork` | POST `/api/knowledge/[id]/fork` |
| Teach (add knowledge) | `teach.tsx` modal | `useKnowledge.create` | POST `/api/knowledge` |
| Proposals list | `skills.tsx` (review panel) | `useProposals` | GET `/api/proposals` |
| Approve / reject proposal | `skills.tsx` | `useProposals.decide` | PATCH `/api/proposals/[id]` |
| Sessions list | `sessions.tsx` | `useSessions` | GET `/api/sessions` |
| Session detail | `sessions.tsx` | `useSessions.detail` | GET `/api/sessions/[id]` |
| Autoskill queue | `autoskill.tsx` | `useAutoskill` | GET `/api/autoskill` |
| Approve autoskill | `autoskill.tsx` | `useAutoskill.approve` | POST `/api/autoskill/[id]/approve` |
| Graph load | `graph.tsx` | `useGraph` | GET `/api/graph` |
| User profile / me | `shell.tsx` (UserMenu) | `useMe` | GET `/api/me` |

All hooks follow the fallback pattern from GUIDELINES.md §14: fetch fails → `loadState = "mock"` → seed data from `BRAIN_DATA` → surface shows "seed" chip.
