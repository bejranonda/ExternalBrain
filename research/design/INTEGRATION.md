# Brain Platform — Design Integration Notes

This folder is the **original handoff bundle** from Claude Design (see
`README.md`). Its source is frozen. The implementation lives in
`apps/web/` — changes belong there, not here. Keep this folder as the
authoritative reference for the original design intent.

## What was ported

| Original (`research/design/project`) | Ported to `apps/web/` |
|---|---|
| `styles.css` | `app/globals.css` (tokens, layout, responsive, density additions) |
| `Brain Platform.html` | `app/layout.tsx` + `app/page.tsx` |
| `components/icons.jsx` | `components/brain/icons.tsx` (typed `IconName` union) |
| `components/i18n.jsx` | `lib/brain/i18n.ts` (typed dict, `translate`, `LangContext`, `useT`) |
| `components/data.jsx` | `lib/brain/data.ts` (typed seeds) |
| `components/shell.jsx` | `components/brain/shell.tsx` (Rail + Topbar + BottomNav + CmdK) |
| `components/dashboard.jsx` | `components/brain/dashboard.tsx` |
| `components/oracle.jsx` | `components/brain/oracle.tsx` |
| `components/skills.jsx` | `components/brain/skills.tsx` |
| `components/graph.jsx` | `components/brain/graph.tsx` (with Autoskill + Sessions → split) |
| (new) | `components/brain/autoskill.tsx`, `components/brain/sessions.tsx` |
| (new) | `components/brain/tweaks.tsx`, `components/brain/app.tsx` |
| (new) | `lib/brain/routes.ts`, `lib/brain/tweaks.ts` |

## Design decisions I made during the port

1. **State-based navigation, not Next.js routes.** Each surface is a
   `Route` in `lib/brain/routes.ts`, synced with `location.hash` for
   deep-linking and `localStorage['bp_route']` for persistence. See
   `docs/APPROACH.md §4.6`.
2. **English default, TH + DE scaffolded.** The user explicitly asked
   to start with English only; the Tweaks panel lets them switch. i18n
   strings for all three live in the same dictionary and decay
   gracefully to EN on missing keys.
3. **Fonts via `next/font`.** Geist (sans), JetBrains Mono, Fraunces
   (serif), and Noto Sans Thai are loaded with the CSS variables
   `--font-geist`, `--font-jetbrains`, `--font-fraunces`,
   `--font-noto-thai`. No external `<link>` tags.
4. **Pre-hydrate tweak application.** A small inline script in
   `app/layout.tsx` reads `bp_tweaks` from localStorage and sets the
   `data-theme`, `lang`, `data-density`, and accent CSS variables
   before React mounts. This prevents the flash of default theme.
5. **Density tweak is real.** The prototype's density control is
   wired via CSS rules on `html[data-density="dense"|"spacious"]`
   (see `app/globals.css`).
6. **Removed `/dashboard` Next.js route.** It was a DB-backed sample
   that used a placeholder `userId` and would crash on load. The
   design's Dashboard surface lives at `/#dashboard` (or `/`).
7. **Accessibility tightening.** `aria-label`, `aria-current`,
   `role="dialog"` / `aria-modal` on the palette, focus-visible
   outlines, and keyboard behavior that ignores `1`..`6` while typing.
8. **Strict TS passes.** Works under `noUncheckedIndexedAccess` and
   `exactOptionalPropertyTypes`. The remaining errors in
   `packages/core`, `packages/db`, and two `/api` routes are
   pre-existing from commit `692e391` and tracked in
   `docs/KNOWN_ISSUES.md §1`.

## What was not ported

- **Editor-mode postMessage handshake** (`window.parent.postMessage`
  to open/close Tweaks). The prototype runs inside Claude Design's
  iframe. In production, the user opens Tweaks via the topbar
  settings icon.
- **Reasoning-level segmented control in Oracle** is decorative — the
  buttons do not change state yet. Will activate when the Oracle API
  is wired.

## Iterating on the design

1. Read `docs/NAVIGATION.md` for the zero-error navigation loop.
2. Treat `apps/web/lib/brain/data.ts` as the **temporary** seed. When
   wiring live API endpoints, replace imports call-site by call-site
   rather than rewriting the file.
3. If an original design detail looks wrong, diff the port against
   the files in this folder — the original is authoritative for
   visual intent.
