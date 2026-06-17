# REST API (webapp + integrators)

The webapp and the SDK both consume these endpoints. The MCP server's tool handlers share the same core functions so there is no duplicate logic.

## Organizations and Projects

```
GET    /api/orgs
  auth   required (session cookie)
  resp   { orgs: [{ id, slug, name, role, projects: [{ id, slug, name, framework, language, createdAt, isOwn }] }], activeProjectId }

POST   /api/orgs
  body   { name: string }   (1–120 chars)
  auth   required (session cookie) — any signed-in user may create an org
  resp   200 { ok: true, org: { id, slug, name, role: "owner" }, redirectTo: "/<orgSlug>/default" }
  errs   400 invalid_request | INVALID_ORG_NAME · 409 slug_conflict (concurrent-create race; retry)
  side   creates the Organization + an owner OrganizationMember + a "Default" project,
         all in one transaction, then sets bp_active_project to the new project so the
         caller lands inside the new org. Org slugs are globally unique (de-duped with -2, -3…).

POST   /api/projects
  body   { orgId: string, name: string }
  auth   required; user must be a member of orgId
  resp   201 { project: { id, slug, name, organizationId, createdAt } }
  errs   400 invalid_request · 403 forbidden (not a member)

PATCH  /api/projects/:id
  body   { name?: string, slug?: string }
  auth   required; project owner or org owner only
  resp   200 { project: { id, slug, name, organizationId } }
  errs   403 forbidden · 404 not_found

GET    /api/projects/:id
  auth   required; any org member of the project's organization
  resp   200 { project: {...}, injected: [...], extracted: [...], totals: {...} }
         (see "GET /api/projects/:id" below for the full shape)
  errs   403 forbidden · 404 not_found

DELETE /api/projects/:id
  auth   required; project owner or org owner only
  resp   200 { ok: true }
  errs   403 forbidden · 404 not_found
         409 project_not_empty  (project has knowledge or sessions)
         409 last_project       (would be the user's only project)

POST   /api/projects/:id/activate
  auth   required; project must belong to one of the user's orgs
  resp   200 { ok: true, projectId }
  errs   403 not_found_or_forbidden
  side   sets the bp_active_project HTTP-only session cookie
```

**Slug rules.** Project slugs are lowercased, non-alphanumeric runs replaced with `-`, leading/trailing dashes stripped. Duplicate slugs within an org are de-duplicated by appending `-2`, `-3`, etc. The `PATCH` endpoint recalculates the slug from the new name (or accepts an explicit `slug` override) and ensures uniqueness automatically.

**Active-project cookie.** `bp_active_project` is an HTTP-only, `SameSite=Lax` session cookie. It stores the id of the currently selected project. The server-side resolver (`apps/web/lib/brain/active-project.ts`) falls back to the first project when the cookie is absent or stale.

**URL routing (Phase 3b).** Since Phase 3b, the canonical UI URL is `/[orgSlug]/[projectSlug]`. When the browser lands on this URL, the server-side page handler calls `getActiveProjectFromUrl()`, validates org membership and project existence, and **sets the `bp_active_project` cookie** to the resolved project id before rendering. This means the URL is authoritative for the UI — navigating to a URL with a different project automatically syncs the cookie. API routes, however, do NOT read slugs from the URL; they continue to use the cookie-based resolver (`getActiveProject(userId)`) so existing integrations and scripts are unaffected. The bare `/` URL still works and redirects to the user's current active project URL.

**Auto-hide.** The `<OrgProjectSwitcher>` component in the shell topbar is hidden entirely when the user has exactly 1 org × 1 project — the solo-user experience is unchanged.

## Organization members + invites

```
GET    /api/orgs/:orgId/members
  auth   required; any org member
  resp   200 { members: [{ userId, email, name, role, joinedAt }] }
  errs   403 not a member · 401 unauthenticated

PATCH  /api/orgs/:orgId/members/:userId
  body   { role: "owner"|"admin"|"member" }
  auth   required; owner or admin of orgId
  resp   200 { ok: true }
  errs   403 insufficient privilege or admin-touching-owner
         404 target not in org
         409 LAST_OWNER  (would demote the last owner)

DELETE /api/orgs/:orgId/members/:userId
  auth   required; owner or admin of orgId
  resp   200 { ok: true }
  errs   403 insufficient privilege or admin-touching-owner
         404 target not in org
         409 LAST_OWNER  (would remove the last owner)

GET    /api/orgs/:orgId/invites
  auth   required; owner or admin of orgId
  resp   200 { invites: [{ id, email, role, invitedById, createdAt, expiresAt, acceptedAt, revokedAt, status }] }
  note   returns only active (non-expired, non-accepted, non-revoked) invites
  errs   403 member-level caller

POST   /api/orgs/:orgId/invites
  body   { email: string, role: "owner"|"admin"|"member" }
  auth   required; owner or admin of orgId (admin cannot set role="owner")
  resp   201 { invite: { id, email, role, expiresAt }, link: "https://<host>/accept-invite?token=...", emailSent: boolean }
  note   emailSent=true when EMAIL_PROVIDER=resend and delivery succeeded.
         emailSent=false (fallback) when email is disabled or delivery failed — link is still returned for manual copy.
  errs   400 invalid_request (bad email/role) · 403 insufficient privilege

DELETE /api/orgs/:orgId/invites/:inviteId
  auth   required; owner or admin of orgId
  resp   200 { ok: true }
  errs   403 insufficient privilege · 404 not found
  note   idempotent — revoking an already-revoked/accepted invite silently succeeds

POST   /api/invites/accept
  body   { token: string }
  auth   required (session userId is used as the joining user)
  resp   200 { orgId }
  errs   401 not signed in · 404 token not found
         409 INVITE_ALREADY_ACCEPTED · 410 INVITE_REVOKED | INVITE_EXPIRED

POST   /api/invites/signup
  body   { token: string; name: string; password: string }
  auth   none (anonymous — invitee has no account yet)
  resp   200 { ok: true; redirectTo: string; existingUser?: boolean }
  errs   400 weak_password (< 8 chars) | invalid_request
         404 invite_not_found
         409 invite_already_accepted | email_taken (race condition)
         410 invite_revoked | invite_expired
  note   Atomically creates User + UserCredential + OrganizationMember + marks invite accepted.
         If the email already has a User row (OAuth / admin), skips user + credential creation,
         accepts invite, and returns existingUser: true so the client can show "sign in instead".
         redirectTo is "/<orgSlug>/<projectSlug>" — the invited org's first project.
```

POST   /api/auth/register
  body   { email: string; password: string; voucher?: string }
  auth   none (anonymous — self-service sign-up). Requires the Credentials provider
         to be configured (ADMIN_USERNAME/ADMIN_PASSWORD_HASH) so the new account can
         sign in afterwards; otherwise 403 registration_unavailable.
  resp   200 { ok: true; redirectTo: string }
  errs   400 invalid_request | weak_password (< 8 chars) | voucher_required
         400 voucher_invalid | voucher_expired | voucher_exhausted | voucher_disabled
         403 registration_unavailable  (Credentials provider not configured)
         409 email_taken
         429 rate_limited (5/hour/IP) | voucher_rate_limited (voucher brute-force limiter)
  note   Posture is governed by REGISTRATION_REQUIRES_VOUCHER (default "true"): when on,
         a valid voucher is mandatory and is validated BEFORE the email-exists check so an
         attacker without a voucher cannot enumerate accounts. When the operator sets the
         flag to "false", registration is fully open and the voucher field is ignored.
         On success: creates User + UserCredential (+ claims the voucher when gated), then
         bootstraps the user's personal org + default project. The /signin?mode=register
         page calls this, then signs the user in with the just-created credentials.

POST   /api/auth/forgot-password
  body   { email: string }
  auth   none (anonymous-friendly)
  resp   200 { ok: true, message: string }  — ALWAYS 200, even if email not found (prevents enumeration)
  note   Rate-limited: 3 requests/hour/IP. If EMAIL_PROVIDER=resend, sends a reset link to the user.
         If email is disabled, the token is created in the DB for operator lookup; user will not receive the link.
         Writes audit row: user.password_reset_request (targetId = userId or null if not found).

POST   /api/auth/reset-password
  body   { token: string; newPassword: string }
  auth   none (anonymous-friendly)
  resp   200 { ok: true }
  errs   400 invalid_token — token not found, expired, or already used
         400 weak_password — newPassword < 8 characters
  note   Validates token, updates UserCredential.passwordHash (bcrypt cost 12), marks token usedAt.
         Writes audit row: user.password_reset_complete.

**Privilege matrix.** See `docs/ARCHITECTURE.md §"Phase 3a — role privilege matrix"`.

**Last-owner protection.** The API enforces the invariant that every org has at least one owner. Attempts to demote or remove the last owner return `409 LAST_OWNER`.

## Session lifecycle

```
POST   /api/session/start
  body { clientType, projectId? }
  resp { sessionId }

POST   /api/session/:id/event
  body { eventType, payload, timestamp? }
  resp { accepted: true }

POST   /api/session/:id/end
  body { success, metrics }
  resp { sqs, knowledgeExtracted }
```

### `GET /api/sessions/:id` (2026-05-23)

Per-session value drill-down. Returns the session's basic fields plus
the lists of Knowledge items the session interacted with, split by
role. Backs the click-to-expand panel on the Sessions surface.

```jsonc
{
  "session": {
    "id":          "ck...",
    "prompt":      "Wire stripe webhook handler",   // first 140 chars of metadata.prompt; may be null
    "clientType":  "claude_code",
    "startedAt":   "2026-05-23T02:15:13Z",
    "endedAt":     "2026-05-23T02:24:01Z",           // null if still in progress
    "outcome":     "success",                        // success | partial | failed | null
    "sqs":         0.78,                             // 0..1, or null
    "projectName": "External Brain",                 // null for personal sessions
    "projectSlug": "brain-platform"                  // null for personal sessions
  },
  "injected": [                                      // skills the AI retrieved INTO this session (KRA)
    { "id": "ck...", "type": "heuristic",
      "triggerText": "When writing a Stripe webhook handler",
      "ruleText":    "Verify signature with raw request body, not parsed JSON",
      "appliedAt":   "2026-05-23T02:15:42Z" }
  ],
  "extracted": [                                     // new skills KEA pulled OUT of this session
    { "id": "ck...", "type": "anti_principle", ... }
  ]
}
```

**Auth.** Session-owner OR org-member of the session's project's
organization. Personal sessions (`projectId IS NULL`) reachable only
by their owner. Returns `404 not_found` for missing rows, `403
forbidden` for cross-user / cross-org probes.

**Role split.** `SessionKnowledgeApplication.role` has three values
(`injected`, `retrieved_but_not_used`, `extracted_from`); this
endpoint returns only the first and third. The middle one is
operator telemetry, not user-facing value. Soft-deleted Knowledge
rows are filtered at the API layer — the lists contain only what
the caller can act on.

See `KNOWLEDGE.md §12.29` for the normative contract.

### `GET /api/projects/:id` (2026-05-24)

Per-project value drill-down. Aggregates `SessionKnowledgeApplication`
rows across **every session in the project** and returns the union as
two ranked lists, mirroring `GET /api/sessions/:id` one level up.
Backs the click-to-expand panel on the Dashboard `Projects` section.

```jsonc
{
  "project": {
    "id":             "ck...",
    "slug":           "brain-platform",
    "name":           "External Brain",
    "organizationId": "ck...",
    "framework":      "next",        // nullable
    "language":       "ts",          // nullable
    "createdAt":      "2026-04-20T10:00:00Z"
  },
  "injected": [                       // skills retrieved INTO any session in this project
    { "id": "ck...", "type": "heuristic",
      "triggerText":   "When writing a Stripe webhook handler",
      "ruleText":      "Verify signature with raw request body, not parsed JSON",
      "hitCount":      4,             // how many distinct sessions applied it
      "lastAppliedAt": "2026-05-24T08:13:00Z" }
  ],
  "extracted": [                      // new skills KEA pulled OUT of any session in this project
    { "id": "ck...", "type": "anti_principle", "hitCount": 1, ... }
  ],
  "totals": {
    "sessionCount":    42,
    "injectedCount":   12,            // count of distinct injected skills (not row count)
    "extractedCount":   8
  }
}
```

**Auth.** Any member of the project's organization. Mirrors the
session-detail policy — members already see each other's sessions
through the org-shared scope, so the project roll-up adds no new
disclosure surface.

**Aggregation shape.** The endpoint groups `SessionKnowledgeApplication`
rows by `(knowledge.id, role)`, summing `hitCount` and taking the
most-recent `createdAt` as `lastAppliedAt`. Output is sorted by
`hitCount DESC, lastAppliedAt DESC` — most-relevant items first.
Soft-deleted Knowledge rows are filtered at the API layer.

**No new index needed.** The query joins
`SessionKnowledgeApplication → Session → projectId` via the existing
`(userId, projectId, startedAt)` index (DB5, #103); the application
row scan is bounded by the project's session count and is fast for
typical org sizes.

See `KNOWLEDGE.md §12.30` for the normative contract.

## Knowledge

```
GET    /api/knowledge?scope&type&framework&limit        list
POST   /api/knowledge                                    create (user-taught = confidence 1.0)
PATCH  /api/knowledge/:id                                edit (creates new version)
DELETE /api/knowledge/:id                                soft-delete
POST   /api/knowledge/retrieve                           same as MCP brain_retrieve_knowledge
```

**`?scope` on GET /api/knowledge.** This parameter is overloaded:
- `?scope=all` — data-scope opt-out: show all knowledge owned by the current user across all projects (not just the active project).
- `?scope=user|project|team|global|community` — knowledge-row scope filter: show only rows with that `scope` field value.
- Omitted — default: show active project + the user's project-less personal knowledge (see `KNOWLEDGE.md §12.19`).

**`?scope=all` on other listing routes.** The following routes also accept `?scope=all` to opt out of active-project filtering: `GET /api/sessions`, `GET /api/graph`, `GET /api/autoskill/proposals`, `GET /api/dashboard`, `GET /api/dashboard/live`, `GET /api/oracle` (both routes), `POST /api/knowledge/retrieve`, `GET /api/export/rules`.

**Default project on POST /api/knowledge.** If `ownerProjectId` is not provided in the body, the route defaults it to the current user's active project (resolved via the `bp_active_project` cookie).

### Phase 4 — Visibility filter + Promote + Fork-into-project

**`?visibility=` filter on `GET /api/knowledge` (Phase 4).** Accepts `private`, `project`, or `org` to restrict the listing to rows of that visibility. Omit for "all visible" (the default V2 filter applies).

```
POST   /api/knowledge/:id/promote
```
Elevates a project-local Knowledge row to org visibility.
- **Auth:** must own the row (`ownerUserId === current user`)
- **Guard:** `visibility === "project"` AND `ownerProjectId IS NOT NULL`
- **Effect:** `visibility → "org"`, `originProjectId → current ownerProjectId`
- **Response:** `{ item: KnowledgeItemView }` with updated visibility
- **Error 422** if visibility is already `"org"` or `"private"`, or ownerProjectId is null
- **Error 403** if not the owner

```
POST   /api/knowledge/:id/fork-to-project
Body:  { projectId?: string }
```
Creates a project-local copy of an org-visible Knowledge row.
- **Auth:** must be a member of the org that owns the source project
- **Guard:** `source.visibility === "org"` AND source + target in same org
- **Body:** `projectId` defaults to the active project when omitted
- **Effect:** new `Knowledge` row with `visibility="project"`, `ownerProjectId=targetProject`, `parentKnowledgeId=source.id`, `originProjectId=source.originProjectId ?? source.ownerProjectId`
- **Response:** `{ item: KnowledgeItemView }` with the new row (status 201)
- **Error 422** if source not org-visible, or cross-org attempt
- **Error 403** if user is not a member of the org

Both endpoints write an audit row (`knowledge.promote` / `knowledge.fork_to_project`).

## Skills

```
GET    /api/skills?framework&stage&scope
POST   /api/skills                                       create
PATCH  /api/skills/:id                                   update (bumps version)
POST   /api/skills/:id/export?format=claude-code         export
POST   /api/skills/:id/publish-community                 moderate then publish
```

## Oracle

```
POST   /api/oracle/ask              non-streaming
POST   /api/oracle/stream           SSE — token stream + citations
```

### Oracle response shape (non-streaming + streaming `final` event)

```json
{
  "answer": "…markdown…",
  "citations": [
    {
      "marker": 1,
      "knowledgeId": "…",
      "excerpt": "Use react-hook-form + zod for form validation.",
      "meta": {
        "knowledgeType": "recipe",
        "triggerText": "When scaffolding a React form",
        "effectiveness": 0.87,
        "outcomes": 12,
        "usageCount": 20,
        "lastUsedAt": "2026-04-22T10:00:00.000Z"
      }
    },
    {
      "marker": 2,
      "sessionId": "…",
      "excerpt": "Build a login form with email + password fields.",
      "meta": {
        "projectName": "thaisim2026",
        "sessionStartedAt": "2026-04-23T08:00:00.000Z",
        "sessionOutcome": "success",
        "clientType": "claude_code"
      }
    }
  ],
  "confidence": "high|medium|low",
  "groundedness": "strong|moderate|weak|none",
  "retrievedCounts": { "knowledge": 7, "sessions": 3 },
  "relatedQuestions": ["…"],
  "tokensUsed": 1234
}
```

**`OracleCitation.meta`** — optional "Why this answer" enrichment. Absent when the row cannot be resolved (e.g. deleted row referenced by a stale marker). Fields for knowledge citations:
- `knowledgeType` — `"reflex"|"recipe"|"heuristic"|"principle"|"anti_principle"`
- `triggerText` — the "when" of the rule (WHEN clause from the Knowledge row)
- `effectiveness` — 0..1 score from `effectivenessScore()`, or `-1` when fewer than 3 outcomes have been recorded
- `outcomes` — `successCount + failureCount` (total sessions with recorded outcome)
- `usageCount` — total Oracle retrieval count
- `lastUsedAt` — ISO timestamp of the last time this rule was cited in an Oracle answer

Fields for session citations:
- `projectName` — display name of the owning Project (absent when session has no project)
- `sessionStartedAt` — ISO timestamp of when the session started
- `sessionOutcome` — `"success"|"failure"|"unknown"` (maps DB `"partial"` and `"failed"` to `"failure"`)
- `clientType` — the client that ran the session (`"claude_code"|"cursor"|"windsurf"|"autobahn"|"custom"|"webapp"`)

**`groundedness`** — reflects how much Brain context was available before the LLM call. Computed from the retrieval bundle, not the LLM output:
- `none` — bundle is empty (0 knowledge rows + 0 sessions)
- `weak` — 1-2 knowledge rows, or only sessions (no knowledge)
- `moderate` — 3-5 knowledge rows, or knowledge + sessions mix
- `strong` — 6+ knowledge rows

**`retrievedCounts`** — raw counts. Use for "N rules · M sessions" display.

**`confidence`** — the LLM's stated confidence in its answer. Different concept from `groundedness` — a LLM can be highly confident from general knowledge (`groundedness=none, confidence=high`).

### Oracle streaming SSE events

```
event: meta
data: {"groundedness":"strong","retrievedCounts":{"knowledge":7,"sessions":3}}
```
Emitted once, right after retrieval and before the first `delta`. Lets the frontend render the "Grounded on N rules · M sessions" header pill immediately while the answer streams.

```
event: delta
data: {"text":"…chunk…"}
```

```
event: final
data: {"citations":[…],"confidence":"high","groundedness":"strong","retrievedCounts":{…},"relatedQuestions":[…],"tokensUsed":1234}
```

```
event: error
data: {"message":"…","code":"cost_cap_exceeded","spentUsd":0.42,"capUsd":1.0}
```

```
event: done
data: {}
```

## Graph

```
GET    /api/graph/:skillId/backlinks
GET    /api/graph/:skillId/dependents
GET    /api/graph/orphans
GET    /api/graph/deadends
```

## MCP tokens

```
GET    /api/tokens                  list all tokens for the authenticated user
POST   /api/tokens                  { name, scope, ttlDays?, organizationId?, projectId? } → returns raw token ONCE
DELETE /api/tokens/:id              immediate hard revocation
POST   /api/tokens/:id/change       in-place secret swap — same row, new hash, immediate cutover
PATCH  /api/tokens/:id/scope        in-place scope change — same secret, new org/project binding (v0.11.2)
```

> **Rotation-with-grace removed (2026-04-27).** `POST /api/tokens/:id/rotate` (mint a replacement + grace-window overlap) was removed in the Token UX cleanup pass. It confused users who expected a simple "change my secret" action. The two schema columns (`scheduledRevokeAt`, `rotatedFromId`) and the auth-gate check that honors them are kept in place (defense-in-depth). For a no-disruption migration: (1) create a new token with the same name + project scope, (2) update client configs to the new token, (3) revoke the old token once confirmed working. Audit action `token.rotate` is also removed.

**`scope` enum.** The accepted values are `"personal"` and `"team"` — anything else (including the intuitive `"mcp:read"` / `"mcp:write"`) is rejected with `invalid_enum_value` at the zod validation layer. The webapp form at `/settings/tokens` always submits `"personal"`; teams are wired through `teamId` on the request body when `scope === "team"`. Future broader scope semantics (per-tool grants, read-only, etc.) would extend this enum in `apps/web/app/api/tokens/route.ts`.

**`projectId` on `POST /api/tokens` (Phase 3c).** Optional nullable string. When provided:

- The server validates that the calling user is a member of the org that owns the project. Returns `403` if not.
- The token is bound to that project — any MCP write targeting a different project is rejected with `FORBIDDEN_PROJECT`.
- The project name is displayed alongside the token name in `/settings/tokens`.

Omit `projectId` (or set it to `null`) for the default unscoped behavior (any project the user has access to).

**`organizationId` on `POST /api/tokens` (v0.11.2).** Optional nullable string. When provided, the server validates the caller is a member of that org and binds the token to it. When `projectId` is also provided, the project must belong to that org. Omit (or `null`) to default to the user's personal org. The audit `token.create` payload now records both `organizationId` and `projectId`.

**`projectId` and `organizationId` on `GET /api/tokens`.** Each token in the response includes `projectId: string | null` and `organizationId: string | null`.

### `PATCH /api/tokens/:id/scope` (v0.11.2)

Change a token's organization and/or project scope **without rotating the secret**. Clients keep working without re-pasting; the new scope takes effect on the next request the token makes.

**Request body** (either or both fields, both nullable):

```json
{
  "organizationId": "org_abc123",
  "projectId": "proj_def456"
}
```

- `organizationId: null` resets to the user's personal org.
- `projectId: null` resets to "any project (within the chosen org)".
- Omitting a field keeps the current value (with one exception: if the org changes and the existing project no longer belongs to the new org, projectId is auto-cleared rather than left dangling).

**Response `200 OK`:**

```json
{
  "token": { /* updated MCPToken row with new organizationId/projectId */ }
}
```

**Validation:**

- The user must be a member of any org they specify (returns `403 forbidden` otherwise).
- The project must belong to the resolved org AND be accessible to the user (returns `403 forbidden` otherwise).
- Revoked tokens cannot be rescoped (returns `409 revoked`).

**Audit:** writes a `token.scope_change` row with before/after values, IP, and user-agent. Awaited (matches W6).

### `POST /api/tokens/:id/change`

Swaps the secret hash **in-place** on the same `MCPToken` row. All other fields — `id`, `name`, `scope`, `userId`, `teamId`, `expiresAt`, `createdAt` — are preserved unchanged. The old secret stops working the instant `tokenHash` is overwritten; there is no grace period and no new row created.

Change is the only secret-swap action in the UI. For a zero-disruption migration (old token kept alive while clients are updated), the manual procedure is: (1) create a new token, (2) update all clients, (3) revoke the old token.

**Request body:** empty or `{}` — no fields required or consumed.

**Response `200 OK`:**

```json
{
  "token": { /* same MCPToken row — id/name/scope/createdAt/expiresAt unchanged */ },
  "raw": "bp_…"
}
```

`raw` is shown exactly once and is never retrievable again (same single-show pattern as token creation).

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| `404` | `not_found` | `:id` doesn't exist or belongs to another user |
| `409` | `TOKEN_ALREADY_REVOKED` | token has `revokedAt != null` |
| `409` | `ROTATION_ALREADY_PENDING` | token has `scheduledRevokeAt != null` (set by a historical rotation; revoke and recreate) |
| `409` | `TOKEN_EXPIRED` | token's `expiresAt` is in the past |

**Audit log:** emits `token.change` with `{ tokenId }`. The raw token is never logged.

### `POST /api/tokens/test`

Validates token state from the DB row only — does **not** receive or accept the raw token value. Used by the post-mint wizard's "Test connection" button.

**Request body:**

```json
{ "tokenId": "<MCPToken.id>" }
```

Auth-required (session cookie). The calling user must own the token.

**Response `200 OK` — active:**

```json
{ "ok": true, "status": "active" }
```

**Response `200 OK` — not usable:**

```json
{ "ok": false, "reason": "revoked" | "expired" | "scheduled-revoke" }
```

**Error cases:**

| Status | Code | Condition |
|--------|------|-----------|
| `404` | `token_not_found` | `tokenId` doesn't exist or belongs to another user |

**Audit log:** emits `token.test` with `{ tokenId }`. The raw token is never received or logged by this endpoint.

## Current user

```
GET    /api/me
  auth   required
  resp   { user: { id, email, name, hasCredential: boolean, teams: [...] } }
  note   hasCredential: true when the user signed up via invite and has a UserCredential row.
         Used by the user menu to decide whether to show "Change password".

POST   /api/me/password
  body   { currentPassword: string; newPassword: string }
  auth   required
  resp   200 { ok: true }
  errs   400 WEAK_PASSWORD (< 8 chars)
         401 WRONG_PASSWORD (currentPassword doesn't match stored hash)
         409 NO_CREDENTIAL  (user signed in via OAuth or admin env — no credential to change)
  note   Audits as "user.password_change" on success.
```

## Dashboard

The base `GET /api/dashboard` endpoint returns `{ stats: DashboardStats, typeCounts: TypeCount[] }`.

### `GET /api/dashboard/top-rules` (Core Value B)

Returns the top Knowledge rows by effectiveness score, for the "Most useful rules" dashboard card.

Query params:

| Param | Type | Default | Effect |
|-------|------|---------|--------|
| `scope` | `"project"` \| `"all"` | `"project"` | Active-project filter vs. all user's knowledge |
| `limit` | integer 1–20 | 5 | Max rules returned |
| `minOutcomes` | integer ≥1 | 5 | Min `successCount + failureCount` required |

Response:

```jsonc
{
  "rules": [
    {
      "id": "knowledge-row-id",
      "title": "First sentence of ruleText (truncated at 80 chars)",
      "type": "principle",
      "score": 0.87,        // successCount / (successCount + failureCount)
      "outcomes": 15,       // successCount + failureCount
      "usageCount": 42      // total Oracle citation count
    }
  ]
}
```

Rules are sorted by `score` descending. Rows with `score === -1` (fewer than 3 outcomes) are excluded even if `minOutcomes` would allow them — the score threshold is always ≥0.

**Note:** effectiveness data accumulates from two sources:
1. Oracle answers — `usageCount` + `lastUsedAt` bumped per citation (best-effort, from `/api/oracle` and `/api/oracle/stream`).
2. Session outcomes — `successCount` / `failureCount` bumped when `brain_report_session_outcome` is called (via `SessionKnowledgeApplication` rows + the explicit `knowledgeUsed` list).

## Admin / health

```
GET    /api/admin/brain-health      SQS trend, knowledge health, retrieval quality
GET    /api/health/ingest-queue     pending_work_units — block before time-sensitive queries (Honcho pattern)
GET    /api/admin/audit-log         paginated audit log (admin-only)
GET    /api/admin/backup-status     off-host backup replication heartbeat (admin-only)
POST   /api/admin/knowledge/reset   bulk soft-delete (or hard-delete) Knowledge rows in current org
```

**`POST /api/admin/knowledge/reset`**

Bulk-deletes Knowledge rows scoped to the caller's active org. Soft-delete
by default (sets `deletedAt = NOW()`, hidden from KRA / Oracle / Skills
queries but recoverable); hard-delete only with `scope=all`.

Auth: org-admin (`owner` or `admin` member of the active org). Members
get `403 forbidden`.

Request body — discriminated by `scope`:

```jsonc
// All knowledge in this org (optional hard-delete)
{ "scope": "all", "hard": false, "confirmPhrase": "RESET KNOWLEDGE" }

// Older than N days
{ "scope": "older-than", "olderThanDays": 30, "confirmPhrase": "RESET KNOWLEDGE" }
```

`confirmPhrase` MUST be the literal string `"RESET KNOWLEDGE"` (case-
sensitive). Defends against accidental triggers. `hard: true` is only
allowed when `scope: "all"` — partial scopes are always soft-delete so
the wrong window is recoverable.

Response:

```jsonc
{
  "deleted": 42,
  "scopeLabel": "older-than:30d",
  "hard": false
}
```

Each successful reset writes an `AuditLog` row with `action: "knowledge.reset"`,
the actor's `userId`, the active `orgId`, and a payload of `{ scope, hard,
deleted }`. Recover by setting `deletedAt = NULL` on the affected rows
(soft-delete only):

```sql
UPDATE "Knowledge" SET "deletedAt" = NULL
WHERE "ownerProjectId" IN (...) AND "deletedAt" >= '<reset-timestamp>';
```

UI surface: `/settings/reset-knowledge` (org-admin only).

**`GET /api/admin/backup-status`**

Reports whether the `backup-replicate` sidecar last synced successfully and how
long ago. The sidecar writes a Unix-epoch timestamp to
`/data/backups/.replicate-heartbeat` after each rclone sync; the web container
mounts `brain_backups` read-only to stat the file.

Auth: platform admin (`requireAdmin()`).

Response when replication is active and healthy:

```jsonc
{
  "ok": true,
  "configured": true,
  "lastSyncAge": 312,        // seconds since last successful sync
  "threshold": 7200,         // warn when lastSyncAge exceeds this (2× BACKUP_INTERVAL)
  "warn": false
}
```

Response when `backup-replicate` profile is not active (or first sync not yet complete):

```jsonc
{
  "ok": false,
  "configured": false,
  "lastSyncAge": null,
  "threshold": 7200,
  "warn": false,
  "message": "backup-replicate not active or first sync not yet complete"
}
```

`warn: true` fires when `lastSyncAge > threshold` — the sidecar is configured
but has not synced recently (possible network error; check container logs).

**`GET /api/admin/audit-log` query params:**

| Param | Type | Effect |
|-------|------|--------|
| `action` | string | exact match on the action column |
| `actorUserId` | string | filter by the actor |
| `orgId` | string | filter by `organizationId` (Phase 3c) |
| `projectId` | string | filter by `projectId` (Phase 3c) |
| `limit` | integer 1–500 | max rows returned (default 100) |

The `orgId` and `projectId` filters are null-safe — they use Prisma's equality check which returns only rows where the column equals the provided value (rows with `null` in that column are excluded).
