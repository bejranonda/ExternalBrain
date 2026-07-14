# Meeting transcript upload — a real webapp surface for V2.0 (2026-07-13)

**Status:** approved design, pending implementation plan
**Audience:** the operator + the agents working this repo
**Depends on:** V2.0 meeting & document intelligence (2026-07-07 spec) — this
fills in the one deferred item that turned out to be needed sooner than
expected

---

## 1. Problem statement

The V2.0 spec deliberately shipped **zero new webapp surfaces** (§8
non-goals) — meeting intelligence was designed to flow entirely through an
AI agent running the `meeting-miner` protocol. That was a considered bet,
not an oversight, with an explicit revisit trigger: *"a webapp 'paste a
transcript' surface, if the agent-mediated workflow proves to be the
bottleneck."*

That trigger fired 2026-07-12: the operator went to the live webapp
looking for a way to feed a meeting transcript in and found nothing —
not even a manual path, since the existing "+ Teach a skill" modal's type
dropdown is hardcoded to the five rule types and doesn't offer
`action_item`. There is currently no way to get meeting content into the
Brain through the webapp at all, full stop.

This spec builds the deferred surface, now that real friction (not
speculation) justifies it.

## 2. Scope

### Goals

1. A signed-in project member can paste a meeting transcript into a new
   `/meetings` page and get back extracted **decisions** (with a
   suggested supersession link to any existing decision it likely
   replaces), **action items** (assignee resolved via a dropdown of real
   project members, blocker flag), and **open questions**.
2. Nothing is written to the Brain until the user reviews and confirms
   each item — extraction is fallible, and the review step is the same
   caution the `meeting-miner` protocol already asks of an agent ("if you
   cannot resolve an owner, ask the user rather than guessing"), now
   enforced in the UI instead of trusted to agent judgment.
3. Confirmed items are taught through the *existing* teach path — the
   same `Knowledge` rows, same tags, same exclusion invariants the MCP
   tool already produces. This is a new front door, not a new backend.
4. A history view lets a user see past meeting imports without any new
   persistence — derived by querying already-taught rows tagged
   `meeting:<date-slug>`.

### Non-goals

- File upload (`.vtt`/`.docx`/etc.) — paste-only for v1. A drag-and-drop
  file surface is a fast-follow if paste proves too manual, not a launch
  requirement.
- Persisted in-progress review state. Closing the tab mid-review loses
  unconfirmed candidates; re-paste and re-extract. Revisit only if this
  causes real repeated pain (see §3 Approach B rationale).
- Any change to the `doc-harvest`/`doc-draft`/`report-draft` protocols —
  those remain agent-only; this spec is meeting-miner's webapp door only.
- Real-time/live meeting capture, bots, speech-to-text — unchanged from
  the V2.0 spec's existing non-goals.

## 3. Architecture

Stateless extraction, no new database tables (**Approach B**, chosen over
a persisted `MeetingImport` schema). The decisive factor: a new schema
means a Prisma migration, and this repo's autonomous-CD envelope requires
explicit per-turn operator authorization the moment a migration appears
in a diff — accepting that stop was weighed against the cost of losing
an unconfirmed review on tab-close, and the tab-close cost lost. It also
matches the standing architectural bias from the V2.0 build: compose
existing primitives (tags, the `Knowledge` model, existing endpoints)
over new entities.

```
User pastes transcript on /meetings
        │
        ▼
POST /api/meetings/extract   (flag-gated: MEETING_UPLOAD_ENABLED)
        │  stateless — nothing persisted yet
        │  1. pure prompt-build (packages/core/src/meeting-extract.ts)
        │  2. callLLMText — existing provider dispatch, no new LLM plumbing
        │  3. pure response-parse → { decisions[], actionItems[] }
        │     (open questions are actionItems with kind:"open-question" —
        │     see §4a; combined during implementation planning to avoid a
        │     near-duplicate type + UI path for two structurally identical
        │     shapes distinguished only by a rendering label)
        │  4. per decision: kra semantic search scoped to this project's
        │     decision-tagged Knowledge → attach a supersession suggestion
        │  5. attach the project's member list (existing
        │     GET /api/orgs/[orgId]/members) for assignee dropdowns
        ▼
Browser holds candidates in React state — review screen
        │  edit text, pick assignee, confirm/dismiss each supersession
        │  suggestion, discard anything wrong
        ▼
Per-item (or "teach all confirmed") → existing POST /api/knowledge,
one call per item — the same path brain_teach_knowledge already uses
        │
        ▼
Knowledge rows exist, tagged meeting:<date-slug>. /meetings' history tab
queries these back out. Nothing else persisted.
```

One prerequisite fix, small and additive: `POST /api/knowledge`'s type
validator (`apps/web/app/api/knowledge/route.ts`) currently accepts only
the five rule types — `action_item` is missing. Without this the review
screen's "Teach" button 400s on every action item. This mirrors the
`brain_teach_knowledge` MCP tool's enum exactly; the REST path was simply
never updated when `action_item` shipped (2026-07-07), because nothing
called it with that type until now.

## 4. Components

### 4a. `packages/core/src/meeting-extract.ts` (new)

Pure extraction core, following the established KEA / autoskill-classifier
seam pattern (`docs/GUIDELINES.md` §4, "Testing LLM-backed units"):

- `buildExtractionPrompt(transcript: string): string` — pure, unit-testable.
- `parseExtractionResponse(raw: string): ExtractedMeeting` — pure,
  unit-testable; must fail soft on malformed LLM output (empty arrays, not
  a thrown error — the route layer turns that into the "didn't find
  anything meeting-shaped" empty state, not a 500).
- `extractMeeting(transcript: string, opts: { call: typeof callLLMText }): Promise<ExtractedMeeting>`
  — thin orchestration; `opts.call` is the injectable seam a unit test
  supplies canned output through, exactly like `ExtractOpts.judge` in
  `kea.ts`.
- `ExtractedMeeting = { decisions: ExtractedDecision[]; actionItems: ExtractedActionItem[] }`
  with each item shaped to match what the review UI and the teach call
  need directly (trigger/rule/rationale/instead for decisions;
  rule/trigger/assigneeGuess for action items) — no separate "domain
  model" translation layer. **Open questions are `ExtractedActionItem`s
  with `kind: "open-question"`**, not a third array — they share every
  field (trigger, rule, optional assignee) with action items and differ
  only in how the review UI labels the card and which teach-time tag
  (`open-question` vs `action-item`) gets applied. Reconciled here during
  implementation planning (2026-07-14) after this section and the plan
  disagreed; keeping one combined shape avoids a near-duplicate
  type/route/UI path for something that's a label, not a different kind
  of data.

### 4b. `POST /api/meetings/extract` (new)

- Auth: `getCurrentUserId()` + `getActiveProject()`, same pattern as every
  other project-scoped route.
- Flag check: 503 with a clear "not enabled on this deployment" message
  when `MEETING_UPLOAD_ENABLED` is false — mirrors the `ORACLE_ENABLED`
  /`MCP_ENABLED` kill-switch pattern already in `env.ts`.
- Rate limit: new `RATE_LIMIT_MEETING_EXTRACT_PER_DAY` (default 20),
  enforced via the existing `rateLimitCheck` helper, same shape as
  Oracle's.
- Body: `{ transcript: string, meetingDate?: string }` (date defaults to
  today; drives the `meeting:<date-slug>` tag applied client-side when
  each item is later taught).
- Response: the `ExtractedMeeting` shape from §4a, with `decisions[]`
  additionally carrying an optional `supersedes?: { id: string; ruleText: string; similarity: number }`
  found via `kra.candidatesForPrompt` scoped to `tags: {has: "decision"}`
  in the active project, and a top-level `members: { email: string; name: string | null }[]`
  for the assignee dropdowns.

### 4c. `/meetings` page (new)

Client component, added to the sidebar nav (new top-level item, matching
Oracle/Skills/Proposals' visual treatment).

- **Paste tab:** meeting title (optional) + date (defaults today) +
  transcript textarea + Extract button. Loading state during the
  extraction call (can take several seconds on a long transcript).
- **Review state:** three card lists as designed in the brainstorming
  session — Decision / Action Item / Open Question cards, each with
  inline-editable text and per-card Teach/Discard. A confirmed-decision's
  supersession suggestion is a visible "Replaces: `<text>`" toggle,
  default-off (the reviewer opts in, not out — an unconfirmed supersede
  link is worse than none). "Teach all confirmed" as a bulk shortcut.
  Taught cards flip to a checked-done visual state rather than
  disappearing.
- **History tab:** queries `GET /api/knowledge?tagPrefix=meeting:&scope=project`,
  grouped by the `meeting:<date-slug>` tag value, read-only. **Resolved
  during spec self-review:** the existing endpoint filters by `type` and
  `scope`/`visibility` only, no tag filter today — and history needs both
  decisions (`type=principle`/`anti_principle`) and action items
  (`type=action_item`) in one view, so a `type=` filter alone can't do
  it. Small additive extension: `GET /api/knowledge` gains an optional
  `?tagPrefix=<string>` query param (matches rows where any tag
  `startsWith` the given prefix), applied alongside the existing
  `buildKnowledgeWhereV2` filter — same pattern as the existing `type`
  param, not a new query mechanism.

### 4d. Docs

- `docs/protocols/meeting-miner.md` gains one paragraph: the webapp
  `/meetings` page is now an alternative front door for the exact same
  underlying teach calls — useful for anyone without an agent handy, or
  for a quick single-meeting import without opening a coding tool.
- `docs/MCP_TOOLS.md` / `docs/REST_API.md`: document the new
  `POST /api/meetings/extract` endpoint and the `action_item` addition to
  `POST /api/knowledge`'s accepted types.

## 5. Security & tenancy

- Extraction is project-scoped like everything else — no cross-project
  leakage risk introduced (the semantic search for supersession
  candidates is bounded to the active project's decision-tagged rows,
  same as every other `kra` call site).
- The transcript text itself is user-supplied free text sent to an LLM
  provider — same trust boundary as any KEA extraction input; no new
  class of exposure beyond what session-mining already accepts.
- Rate limiting (§4b) is the cost/abuse control; no additional auth tier
  beyond standard project membership (§2 goal 2 already gates the
  consequential action — nothing reaches the Brain without a human
  confirming it).
- Assignee dropdown is sourced from the existing verified org-member
  list (`GET /api/orgs/[orgId]/members`), never free text — the `for:`
  tag this produces is exactly as trustworthy as one an agent would
  produce reading the same member list per the `meeting-miner` protocol.

## 6. Rollout

1. **Flag default OFF** (`MEETING_UPLOAD_ENABLED`, `boolish(false)`) —
   matches the operator's own standing rule (recorded in the Brain,
   2026-06-24): decouple code deploy from flag flip for any
   cost-incurring feature. Ships dark; the operator flips it in `.env` +
   `deploy/docker-compose.yml` allowlist (learned the hard way on V2's
   first flag-enable — the compose allowlist entry is easy to forget) +
   a reload, on their own schedule.
2. **No Prisma migration** in this diff — verify with
   `git diff <base>..HEAD --stat -- packages/db/prisma/migrations` before
   merge, same gate every other PR in this program has passed.
3. Single PR, reviewed and merged via the standing green-CI-merge
   envelope — no migration means no authorization stop.
4. Post-flag-enable validation: the operator (or an agent, in the
   already-established fixture project) runs one real transcript through
   the UI end-to-end before calling it validated — matching the "never
   claim tested without evidence" standing rule.

## 7. Testing

- **Unit:** `meeting-extract.ts`'s prompt-build/parse core, keyless CI,
  canned LLM output — happy path, malformed output (fail-soft to empty
  arrays), empty transcript, a transcript with no decision/action/question
  content at all.
- **Integration:** the extract route with a real (test-fixture) project's
  decision-tagged rows, confirming supersession suggestions surface only
  within the active project's scope, never cross-project.
- **E2E:** flag-gated off by default, so not reachable by the existing
  anon/authed CI suites without an env override — matches the
  `AUTOSKILL_SHADOW` precedent. A `security.spec.ts`-style suite gets
  added under a `test.skip(!MEETING_UPLOAD_ENABLED, ...)` guard so it's
  ready to activate the moment CI's env sets the flag, without silently
  claiming coverage that doesn't exist (the lesson from 2026-07-10's
  `security.spec.ts` CI-wiring gap applies directly here — verify the
  new spec is actually on a workflow's file list, don't assume).
- **Manual:** §6 step 4, a real transcript, post-flag-enable.

## 8. Deferred-items register (carried forward + new)

| Item | Trigger to revisit |
|---|---|
| File upload (`.vtt`/`.docx`) | Paste-only proves too manual in real use |
| Persisted in-progress review | Tab-close data loss causes repeated real pain |
| Live meeting bots / speech-to-text | Unchanged from the V2.0 spec |
| Everything else in the V2.0 §8 register | Unchanged — Jira/GitHub sync, Word/Excel forms, task-board UI, etc. |
