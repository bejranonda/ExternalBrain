# Wiring — How a GUI surface connects to the backend

The webapp ships six surfaces (Dashboard, Oracle, Skills, Graph, Autoskill, Sessions). Each was first built as a design prototype reading from the seed in `apps/web/lib/brain/data.ts`. As of 2026-04-21 all six surfaces are wired to real API routes. This doc is the canonical wiring matrix plus the contract pattern.

> Reference implementation: `apps/web/components/brain/autoskill.tsx` + `apps/web/lib/brain/use-autoskill.ts` + `apps/web/app/api/autoskill/proposals/**`. Read those four files together.

---

## 1. The four-file contract

For each surface:

| File | Purpose |
|---|---|
| `apps/web/app/api/<surface>/.../route.ts` | REST endpoint(s). Authenticate, query DB, map to view types, return JSON. |
| `apps/web/lib/brain/views.ts` | Server-side mappers from DB rows → view types. View types are the API contract. |
| `apps/web/lib/brain/use-<surface>.ts` | Client hook. Fetches, optimistic mutates, mock fallback. |
| `apps/web/components/brain/<surface>.tsx` | React component. Reads only from the hook, never from `BRAIN_DATA` directly. |

Why a view type? GUI components were drafted from the design bundle with their own field names. Rather than refactor 4,000+ lines every time the schema evolves, server routes shape data into stable view types declared in `views.ts`. **View types are the contract.** Schema can change; views stay stable until the contract changes deliberately.

---

## 2. Mock fallback (non-negotiable)

Every hook must fall back to `BRAIN_DATA.<key>` when the API is unreachable, and signal the fallback with `loadState: "mock"` so the surface can show a banner. This means:

- Designers can review the prototype without a DB.
- Demos work offline.
- The "you forgot to start Postgres" failure mode is a banner, not a blank screen.

---

## 3. Auth (today)

Every API route calls `getCurrentUserId()` from `apps/web/lib/brain/auth.ts`. Today that helper:

1. Returns `process.env.DEV_USER_ID` if set, else
2. Returns the first User row in the DB (single-tenant dev mode), else
3. Throws `AuthError(401)`.

When NextAuth v5 lands (Phase 0 acceptance), only `auth.ts` changes. Routes do not.

**Do not deploy past local dev with this shim.** See `KNOWN_ISSUES.md §1`.

**Known gap — NextAuth replacement:** The dev shim must be replaced before staging deploy. All routes already call `getCurrentUserId()` so the swap is a single-file change.

---

## 4. Optimistic mutations + rollback

Mutations follow the autoskill pattern:

1. Optimistically remove/update the affected row in local state.
2. POST/PATCH/DELETE to the endpoint.
3. On failure, refresh from the server (source of truth).

This avoids the "user clicks Apply, sees no change for 200ms, clicks again" double-action bug. See `useAutoskillProposals().act()`.

---

## 5. Scope invariants in routes

Every mutation route must:

1. Resolve `userId` via `getCurrentUserId()` first.
2. Fetch the target row.
3. **Verify the row's owner matches the current user.** If not, return 403 — never 404 (404 leaks existence).
4. Verify the row's status allows the action (e.g. only `pending` proposals can be applied).
5. Perform the action. Catch invariant violations from `@brain/core` and surface them as 422.

---

## 6. Surface wiring matrix

### Dashboard

| GUI element | Handler / hook | Endpoint | Status |
|---|---|---|---|
| Stats bar (sessions, knowledge, etc.) | `useDashboard` | `GET /api/dashboard` | WIRED |
| typeCounts / KnowledgeTypes panel | `useDashboard` | `GET /api/dashboard` (returns `typeCounts[]`) | WIRED |
| decayThisWeek / bundleHitRate | `useDashboard` | `GET /api/dashboard` | WIRED |
| SQS trend chart delta | `useDashboard` | `GET /api/dashboard` (computed from trend) | WIRED |
| LiveExtraction panel | `useLiveExtraction` | `GET /api/dashboard/live` (polls 15 s) | WIRED |
| RecentSessions panel | `useDashboard` | `GET /api/dashboard` | WIRED |
| PendingProposals count | `useDashboard` | `GET /api/dashboard` | WIRED |
| Export button | shell handler | Opens live export endpoint | WIRED |
| MCP button | shell handler | Opens live MCP endpoint | WIRED |

### Oracle

| GUI element | Handler / hook | Endpoint | Status |
|---|---|---|---|
| Chat send | `useOracle` | `POST /api/oracle` | WIRED |
| Retrieval inspector (scored rows) | `useOracle` | `POST /api/knowledge/retrieve` (parallel) | WIRED |
| Per-row score breakdown | `useOracle` | `kra.retrieveScored()` → `POST /api/knowledge/retrieve` | WIRED |
| Inline reasoning segment | `useOracle` | response from `POST /api/oracle` | WIRED |
| Citations from backend | `useOracle` | response from `POST /api/oracle` | WIRED |
| Thumbs up / down feedback | `useOracle.sendFeedback` | `POST /api/oracle/feedback` | WIRED |

### Skills

| GUI element | Handler / hook | Endpoint | Status |
|---|---|---|---|
| Knowledge list | `useKnowledge` | `GET /api/knowledge` | WIRED |
| Single item detail | `useKnowledge` | `GET /api/knowledge/[id]` | WIRED |
| Teach modal (create) | `teach.tsx` | `POST /api/knowledge` | WIRED |
| Inline edit (save) | `useKnowledge.update` | `PATCH /api/knowledge/[id]` | WIRED |
| Delete | `useKnowledge.remove` | `DELETE /api/knowledge/[id]` (soft, sets `deletedAt`) | WIRED |
| Fork | `useKnowledge.fork` | `POST /api/knowledge/[id]` `{action:"fork"}` | WIRED |
| Related items panel | `useRelated` | `GET /api/knowledge/[id]/related` | WIRED |
| Scope filter buttons | `useScope` | `localStorage bp_scope` tenant switch | WIRED |
| Sort toggle (recency/confidence/uses) | `useKnowledge` | query params on `GET /api/knowledge` | WIRED |
| Copy/Copy id/Clipboard exports | local | — | WIRED |

### Graph

| GUI element | Handler / hook | Endpoint | Status |
|---|---|---|---|
| Graph nodes + edges | `useGraph` | `GET /api/graph` | WIRED |
| Per-node related panel | `useRelated` | `GET /api/knowledge/[id]/related` | WIRED |
| Search / filter | `useGraph` | client-side filter on fetched nodes | WIRED |
| Zoom controls | `graph.tsx` | client-side | WIRED |
| Queries (Backlinks/Orphans/Dependents) | `useGraph` | client-side over fetched graph | WIRED |
| Inspector stats | `useGraph` | derived from selected node data | WIRED |
| Offline seed fallback | `useGraph` | falls back to `BRAIN_DATA` if API returns empty | WIRED |

### Autoskill

| GUI element | Handler / hook | Endpoint | Status |
|---|---|---|---|
| Proposals list | `useAutoskillProposals` | `GET /api/autoskill/proposals` | WIRED |
| Apply / Reject | `useAutoskillProposals.act` | `POST /api/autoskill/proposals/[id]` | WIRED |
| Auto-apply HIGH toggle | `autoskill.tsx` | persisted to `localStorage`; auto-applies on load | WIRED |
| Edit reasoning modal | `autoskill.tsx` | `PATCH /api/autoskill/proposals/[id]` | WIRED |
| View Diff modal | `autoskill.tsx` | `GET /api/autoskill/proposals/[id]` (full diff+patch) | WIRED |
| Live `sessionsWeek` subtitle | `useDashboard` / `autoskill.tsx` | `GET /api/dashboard` | WIRED |

### Sessions

| GUI element | Handler / hook | Endpoint | Status |
|---|---|---|---|
| Sessions list | `useSessions` | `GET /api/sessions` | WIRED |
| Filter panel (outcome + client) | `useSessions` | `GET /api/sessions?outcome=…&client=…` | WIRED |
| Load more (cursor pagination) | `useSessions.loadMore` | `GET /api/sessions?cursor=…` → `nextCursor`, `total` | WIRED |

### Shell / cross-cutting

| GUI element | Handler / hook | Endpoint | Status |
|---|---|---|---|
| Scope tenant buttons | `useScope` | `localStorage bp_scope` | WIRED |
| Teach button | `teach.tsx` | `POST /api/knowledge` | WIRED |
| Notification bell + badge | `notifications.tsx`, `useCounts` | `GET /api/autoskill/proposals` count (polls 30 s) | WIRED |
| User/avatar menu | `user-menu.tsx` | `GET /api/me` | WIRED |
| Rail / bottom nav counts | `useCounts` | polls every 30 s | WIRED |
| Live ingest dot | `useLiveExtraction` | `GET /api/dashboard/live` | WIRED |

---

## 7. API route index

| Route | Methods | Primary caller hook | Notes |
|---|---|---|---|
| `/api/dashboard` | GET | `useDashboard` | Returns `typeCounts[]`, `decayThisWeek`, `bundleHitRate`, recent sessions, SQS trend. |
| `/api/dashboard/live` | GET | `useLiveExtraction` | Current open session + tail of `SessionEvents`. Polls every 15 s. |
| `/api/sessions` | GET | `useSessions` | Accepts `outcome`, `client`, `cursor` params. Returns `nextCursor` and `total`. |
| `/api/knowledge` | GET, POST | `useKnowledge`, `teach.tsx` | GET = list with filters. POST = create new item. |
| `/api/knowledge/[id]` | GET, PATCH, DELETE, POST | `useKnowledge` | GET single. PATCH = edit fields. DELETE = soft delete. POST `{action:"fork"}` = clone with decreased confidence + `parentKnowledgeId`. |
| `/api/knowledge/[id]/related` | GET | `useRelated` | Graph neighbors via `GraphEdge`. |
| `/api/knowledge/retrieve` | POST | `useOracle` | KRA retrieval; now calls `kra.retrieveScored()` — returns `{bundle, rows}` with score/similarity/recency/used per candidate. |
| `/api/graph` | GET | `useGraph` | Returns `{nodes, edges}` from `Knowledge` + `GraphEdge`. |
| `/api/oracle` | POST | `useOracle` | Main Oracle turn. Auth stub replaced with real `getCurrentUserId()`. |
| `/api/oracle/feedback` | POST | `useOracle.sendFeedback` | Logs thumbs up/down to `Feedback` table. |
| `/api/me` | GET | `user-menu.tsx` | User profile + team memberships. |
| `/api/autoskill/proposals` | GET | `useAutoskillProposals` | List proposals. |
| `/api/autoskill/proposals/[id]` | GET, POST, PATCH | `useAutoskillProposals`, `autoskill.tsx` | GET = full diff+patch. POST = apply/reject. PATCH = edit reasoning/diff while pending. |

---

## 8. Client hook index

| Hook | File | Feeds | Notes |
|---|---|---|---|
| `useOracle` | `use-oracle.ts` | `oracle.tsx` | Manages turn list; parallel `/api/oracle` + `/api/knowledge/retrieve`; exposes `sendFeedback`. |
| `useGraph` | `use-graph.ts` | `graph.tsx` | Fetches `/api/graph`; deterministic type-ring layout; falls back to `BRAIN_DATA` seed. |
| `useRelated` | `use-related.ts` | `skills.tsx`, `graph.tsx` | Per-item related nodes via `/api/knowledge/[id]/related`. |
| `useCounts` | `use-counts.ts` | `shell.tsx`, `app.tsx` | Unified counts powering rail/bottom-nav; polls every 30 s. |
| `useScope` | `use-scope.ts` | `shell.tsx`, `app.tsx` | Scope tenant (personal/team/community); persisted to `localStorage bp_scope`. |
| `useLiveExtraction` | `use-live-extraction.ts` | `dashboard.tsx`, `shell.tsx` | Polls `/api/dashboard/live` every 15 s. |
| `useKnowledge` | `use-knowledge.ts` | `skills.tsx`, `teach.tsx` | Added `update` / `remove` / `fork` methods this pass. |
| `useSessions` | `use-sessions.ts` | `sessions.tsx` | Added filter state + `loadMore` cursor pagination. |
| `useAutoskillProposals` | `use-autoskill.ts` | `autoskill.tsx` | Full loop: list + apply + reject + edit with optimistic mutate. |

---

## 9. Known gaps

### Gap 1 — Tweaks server-side sync (NOT SHIPPED)

The Tweaks panel (language, theme, preferences) persists changes to `localStorage` only. Server-side sync requires a new Prisma model (`UserPreferences` or similar) and a DB migration. This migration touches the shared DB schema and **requires explicit approval** before running. Tweaks are local-only until that migration lands.

### Gap 2 — NextAuth v5 (NOT SHIPPED)

All API routes call `getCurrentUserId()` from `apps/web/lib/brain/auth.ts`, which today returns the dev shim user. NextAuth v5 is a single-file replacement in `auth.ts`. No route changes needed. **Blocks staging deploy.** See `KNOWN_ISSUES.md §1`.

### Gap 3 — Oracle streaming (NOT SHIPPED)

`POST /api/oracle` returns a complete response. SSE streaming is not yet surfaced. The `@brain/core` Oracle implementation is non-streaming today.

---

## 10. Checklist for a new surface

- [ ] View types added to `lib/brain/views.ts` with mapper functions.
- [ ] REST route(s) under `app/api/<surface>/.../route.ts` use `getCurrentUserId()`.
- [ ] All mutation routes verify ownership and status before acting.
- [ ] Client hook in `lib/brain/use-<surface>.ts` exposes `{data, loadState, error, refresh, …mutations}`.
- [ ] Hook falls back to `BRAIN_DATA` when fetch fails; `loadState: "mock"` surfaced.
- [ ] Component imports only from hook + i18n + design tokens; no direct `BRAIN_DATA` reads.
- [ ] Surface renders three states: loading, ready+empty, ready+populated.
- [ ] Surface renders error state when a mutation fails (banner, not silent).
- [ ] Typecheck clean for the new files (existing pre-existing errors are tolerated until Phase 1).
- [ ] If a hook needs new pure helpers, add unit tests under `packages/core/src/__tests__/`.
- [ ] `KNOWN_ISSUES.md` updated if anything is left as a TODO.
- [ ] Walk the nav checklist in `docs/NAVIGATION.md §3` before merge.
