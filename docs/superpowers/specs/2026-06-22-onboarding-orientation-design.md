# First-time-user orientation layer — design

**Date:** 2026-06-22
**Branch:** `feature/onboarding-orientation`
**Status:** approved (brainstorming), pre-implementation

## Problem

A brand-new user who installs the Brain MCP token still does not know **what to
type to their AI agent** to actually use it, and several live nav surfaces
(`graph`, `decisions`) and in-surface terms (skill types, confidence, decay,
KEA queue) have no plain-English explanation reachable from where they appear.

What already exists (do **not** rebuild): the 5-step first-run modal
(`onboarding.tsx`), the `/welcome` guided install flow, `empty-brain-callout`,
the `/docs` + `/docs/concepts/[slug]` system with i18n (en/de/th), and nav-item
`title=` hints. The gaps are narrower than "we have no onboarding."

## Goals

1. Teach the **daily agent verbs** (verify connection, create project, start /
   apply / close a session, transfer knowledge, ask the Oracle) with literal,
   copyable prompts mapped to the MCP tool each triggers.
2. Close the **glossary holes**: concept docs for `graph` and `decisions`;
   crisp tooltip-level definitions for the five skill types
   (recipe / rule-of-thumb / principle / reflex / anti-pattern).
3. Make in-surface jargon **self-explaining** via one shared tooltip primitive.
4. **Polish** the existing flow to point at the new cheat-sheet.

Non-goals (YAGNI): no new nav item, no "run this prompt for me" automation, no
video, **no backend/schema change** (keeps the change inside the autonomous-CD
no-migration deploy envelope).

## Architecture

Reuse existing infrastructure. Four coordinated pieces, all content/UI only.

### 1. Agent-prompt cheat-sheet (doc + dashboard card)

- **New concept doc** `using-from-your-agent`, authored as parallel `DocPage`
  data in `DOCS` (en, authoritative), `DOCS_DE`, `DOCS_TH` in
  `apps/web/lib/brain/docs-content.ts`, resolved via `getDoc(lang, slug)` with
  the existing per-slug EN fallback. Added to `DOCS_SECTIONS` in the
  **"Start here"** section, immediately after `vocabulary`. TH/DE are
  AI-generated pending native sweep — same caveat as the existing localized docs
  (see `docs/KNOWN_ISSUES.md`).
  Content groups, each a copyable prompt + the MCP verb it triggers:
  - *Verify:* "Do you have a connection to the brain? Can you see any projects?"
    → `brain_get_user_style` / `brain_get_active_project`
  - *Set up:* "Create a project in the brain for this workspace." →
    `brain_create_project`
  - *Work:* "Check the brain before you start, and apply what it knows." →
    `brain_start_session` + `brain_retrieve_knowledge`
  - *Close:* "Transfer what we learned this session into the brain." →
    `brain_report_session_outcome`
  - *Recall:* "What did we decide about X?" → `brain_ask_oracle`
- **New component** `apps/web/components/brain/agent-prompts-card.tsx`
  (`AgentPromptsCard`). Rendered on the dashboard. Expanded while
  `sessionsAllTime === 0`; after the first session (or on dismiss) it collapses
  to a one-line "Talk to your Brain →" link. Dismiss persists via
  `localStorage: bp_agent_prompts_dismissed` (mirrors the `bp_onboarded`
  pattern in `onboarding.tsx`). 3–4 copy-to-clipboard prompts + a link to the
  full concept doc. Copy strings live in the i18n dictionary (`useT`,
  `agentPrompts.*` namespace) since this is chrome, not long-form doc prose.

### 2. Complete the glossary

- **New concept docs** `graph` and `decisions` (en/de/th), added to the
  **"Core concepts"** `DOCS_SECTIONS` entry.
- The five skill types already live inside the `skills`/`vocabulary` docs; no
  new pages — instead each gets a one-line definition surfaced via the InfoDot
  tooltip on the Skills type badges/filter.

### 3. Tooltip audit — one shared primitive

- **New component** `apps/web/components/brain/info-dot.tsx`
  (`<InfoDot conceptSlug="…" tip="…" />`): a small superscript "?" that shows a
  one-line `tip` and links to `/docs/concepts/[slug]`. Keyboard-focusable,
  `aria-label`ed.
- Apply to currently-unexplained in-surface terms:
  - Skills: type badges, confidence, decay/stale, scope
  - Decisions: "supersedes", the decision tag
  - Graph: node / edge meaning
  - Connection-status: heartbeat, KEA queue depth

### 4. Polish existing flow

- Onboarding modal final step and `/welcome` success state gain a "Now try
  these prompts →" link to `using-from-your-agent`.
- Tighten copy where the first-time-user review flags confusion.

## Data flow

- Doc content is static (`docs-content.ts`); no API, no DB.
- Card gating reuses `useDashboardStats` (`sessionsAllTime`) + `localStorage`.
- `InfoDot` is purely presentational; links to existing doc routes.
- **No Prisma migration** → eligible for autonomous deploy per `CLAUDE.local.md`
  rule 2 (verify with `git diff HEAD...origin/main -- packages/db/prisma/migrations/ | wc -l` == 0).

## Testing

- **Registry/unit:** extend the existing docs-parity test so the new slugs
  (`using-from-your-agent`, `graph`, `decisions`) resolve in en/de/th and appear
  in `DOCS_SECTIONS`.
- **Playwright** (`apps/web/e2e`): new spec — docs index shows the new cards;
  each new concept page renders; dashboard `AgentPromptsCard` renders, copy
  button works, dismiss persists across reload.
- **Route/hand-trace:** verify nav→doc links and InfoDot `slug` targets resolve
  (no dead `/docs/concepts/<slug>`), with file:line evidence.
- **First-time-user review:** bounded loop — one build → one structured review on
  a clearly-marked throwaway, non-admin account (per `CLAUDE.local.md`
  AI-review carve-out) → fix what it finds → re-verify. Not open-ended.
- Local gates can't run in this checkout (Node 18, no pnpm) → rely on CI for
  typecheck/test/build; hand-verify cross-file refs. Honest test plan in the PR.

## Risks / honest flags

- TH/DE strings AI-generated, awaiting native review (documented caveat).
- Tooltip audit scope could sprawl; bounded to the enumerated terms above.
- Any pre-existing bug surfaced by the review that we do **not** fix in this PR
  gets a GitHub issue; gaps this PR introduces-and-fixes do not.
