# Architecture (condensed)

See `BLUEPRINT.md` for the full narrative. This doc is the quick-reference diagram + subsystem table.

## Deployment topology

External Brain runs as a single self-contained stack — four containers on one
host, brought up by `./scripts/deploy.sh`:

```
                 laptops / IDEs
                       │
                       │  MCP over HTTPS (Bearer bp_…)
                       ▼
        ┌────────────────────────────┐
        │  Your host                  │
        │  ╔══════════════════════╗   │
        │  ║ web        :3000     ║   │
        │  ║ mcp-server :3100/mcp ║   │
        │  ║ worker (pg-boss)     ║   │
        │  ║ db (Postgres+pgvec)  ║   │
        │  ╚══════════════════════╝   │
        │  Caddy → Let's Encrypt TLS  │
        └────────────────────────────┘
```

**One instance = one Brain = one Postgres.** Knowledge, tokens, and audit logs
all live in that instance's database; nothing is shared with any other
instance. Clients choose which Brain they talk to by pointing their MCP config
at its URL — a token issued by one instance only authenticates against that
instance.

**Optional staging.** If you want a staging environment, run a second instance
on another host from the same `main` code — they share code, not data. TLS is
per-origin via Caddy (Let's Encrypt HTTP-01); set `CADDY_EMAIL` and your public
hostnames in `.env`. (The original author runs a single instance on one host
from `main`; a single instance is all a fork needs.)

### Token model

- Tokens are rows in the `MCPToken` table on whichever Brain issued them (SHA-256-hashed on write, revocable individually).
- Issued exactly once via the webapp at `/settings/tokens` on that Brain — the raw value is shown once, never retrievable again.
- A token from one instance does not authenticate against another. Each instance's token namespace is independent.
- Revocation is immediate: the next MCP call from a revoked token returns 401 with no cache warmup.
- There is **no shared-secret bearer token** in any `.env`. If you read older docs that reference `MCP_BEARER_TOKEN`, that's a historical assumption from an earlier prototype — archived, not current.

### Operating an instance

- **Deploy:** `docker compose -f deploy/docker-compose.yml up` for a bare local stack; `./scripts/deploy.sh` for a server with Caddy + auto-TLS (the `edge` profile). The server deploy auto-runs `scripts/verify-lockdown.sh` + `scripts/smoke.sh` and refuses to report success on a lockdown failure.
- **TLS:** Caddy on the origin handles certs via Let's Encrypt HTTP-01; set `CADDY_EMAIL` and your public hostname(s) in `.env`. See [`docs/DEPLOY_CHECKLIST.md`](./DEPLOY_CHECKLIST.md) and [`deploy/PRODUCTION.md`](../deploy/PRODUCTION.md).
- **Branch protection:** enable required-PR + status checks on `main` before a second contributor joins.
- **Feedback freshness:** a session's MCP calls become signal within ~seconds (MCP write) → minutes (extraction job) → next-session impact (retrieval). No nightly batch.

## Multi-tenant model

Brain uses a four-level ownership hierarchy: **Organization → Project/Team → User**.

| Layer | Model | Notes |
|---|---|---|
| Organization | `Organization` + `OrganizationMember` | Top-level container. Owns Projects, Teams, and MCP tokens. A user can belong to multiple orgs. |
| Project | `Project` | Belongs to exactly one Organization (`organizationId NOT NULL` after migration `20260427125332`). |
| Team | `Team` | Belongs to one Organization (`organizationId` nullable — a team without an org is valid for legacy data). |
| User | `User` | Belongs to one or more Organizations via `OrganizationMember`. |

### Personal org invariant

Every user gets a **personal Organization** on first sign-in, created idempotently by `ensurePersonalOrg()` in `packages/core/src/org.ts`. The personal org has:
- `id = "org_<userId>"` (deterministic, stable)
- `slug = "personal-<userId.slice(3,15)>"`
- The user as sole member with `role = "owner"`

Existing data was migrated 2026-04-27: every user in the DB at migration time received an `org_<userId>` org with the matching slug. See migration `20260427125302_add_organization_layer`.

### Org member roles

| Role | Meaning |
|---|---|
| `owner` | Full control; personal org is always owner-only |
| `admin` | Can manage members and settings |
| `member` | Read + write access to org resources |

### Project slug invariant (Phase 2a)

Every `Project` now has a `slug` column — unique within its org (`@@unique([organizationId, slug])`). The slug is derived from the project name via `slugify()` in `packages/core/src/org.ts` (mirrors the SQL in migration `20260427_add_project_slug`). Duplicate slugs within the same org are de-duplicated by appending `-2`, `-3`, etc.

### Active-project cookie

The UI tracks the "active project" in an HTTP-only `bp_active_project` session cookie (set by `POST /api/projects/:id/activate`). The server-side resolver (`apps/web/lib/brain/active-project.ts`) reads the cookie on each request, falls back to the first project if the cookie is stale or absent, and lazily creates a "Default" project if the user has none.

**Phase 2a shipped (2026-04-27):** `Project.slug`, org/project switcher in the topbar (`<OrgProjectSwitcher>`), `/settings/projects` page, CRUD endpoints (`GET /api/orgs`, `POST/PATCH/DELETE /api/projects`, `POST /api/projects/:id/activate`). URL routing and per-project filtering come in Phase 2b/3.

### Phase 2b — per-project filter rule (shipped 2026-04-25)

Every Knowledge/Session/Autoskill-proposal listing applies the following Prisma filter by default:

```
(ownerProjectId = activeProjectId)
  OR
(ownerProjectId IS NULL AND ownerUserId = currentUserId)
```

This keeps "personal knowledge" (rows with no project assigned) visible in all projects for the user who owns them. Org-level cross-project sharing (e.g. a team member viewing another member's project) is deferred to Phase 4.

**Scope toggle.** Any API route that uses this filter accepts `?scope=all` to show everything the authenticated user owns across all projects. The client persists the user's choice in `localStorage` under key `bp_project_scope` via the `useProjectScope()` hook. The `<ScopePill>` component (auto-hidden when the user has 1 org × 1 project) lets them switch inline on each surface.

**Helper module.** `packages/core/src/scope-filter.ts` exports four pure builder functions (no DB calls):

| Export | Used by |
|---|---|
| `buildKnowledgeWhere(userId, projectId, scope)` | `/api/knowledge`, `/api/graph`, `/api/oracle`, `/api/export/rules`, dashboard counts |
| `buildSessionWhere(userId, projectId, scope)` | `/api/sessions`, `/api/dashboard/live`, dashboard counts |
| `buildProposalWhere(userId, projectId, scope)` | `/api/autoskill/proposals`, dashboard counts |
| `buildRawProjectFilter(userId, projectId, scope, startParam)` | `kra.ts` + `oracle.ts` raw pgvector SQL |

All four are re-exported from `@brain/core`.

**Default project on create paths.** When the MCP tools `brain_start_session` / `brain_teach_knowledge` do not receive a `projectId`, they default to the user's first project (via `getUserProjects` + `ensureDefaultProject`). The `POST /api/knowledge` route similarly defaults `ownerProjectId` to `getActiveProject(userId).projectId` when not explicitly provided.

### Phase 3a — org member management + invite flow (shipped 2026-04-25)

#### Role privilege matrix

| Operation | owner | admin | member |
|---|---|---|---|
| Read member list | yes | yes | yes |
| Invite member/admin | yes | yes | no |
| Invite owner | yes | no | no |
| Change member ↔ admin | yes | yes | no |
| Change → owner / demote owner | yes | no | no |
| Remove member/admin | yes | yes | no |
| Remove owner | yes* | no | no |
| Revoke invite | yes | yes | no |

*: only when at least one other owner exists (last-owner protection).

**Invariant:** An organization always has at least one owner. `setOrgMemberRole` and `removeOrgMember` both check `count({role:"owner"}) <= 1` before demoting/removing the last owner and throw `BrainError{code:"LAST_OWNER", status: 409}`.

#### Invite flow

```
Owner/Admin → POST /api/orgs/:orgId/invites { email, role }
           ← { invite: {...}, link: "https://<host>/accept-invite?token=<base64url>" }

Invitee follows link →  GET /accept-invite?token=...
  Signed in  → POST /api/invites/accept { token }
             → OrganizationMember created with invite.role
             → redirect /settings/projects
  Not signed → redirect /signin?callbackUrl=/accept-invite?token=...
             → after sign-in, same POST /api/invites/accept flow
```

Invite tokens are 32-byte `crypto.randomBytes` encoded as base64url (≈43 chars, 256 bits entropy). They are **one-shot** (acceptedAt set on first use) and expire in 7 days. Revocation sets `revokedAt`; both checks happen before creating the membership.

No email is sent in Phase 3a — the operator copies the link from the API response or the `/admin/org` page.

#### Org-scoped knowledge access (`scope=all`)

The `buildKnowledgeWhere` helper now accepts an optional `accessibleProjectIds?: string[]` fourth argument. When provided with a non-empty array and `scope="all"`, it returns:

```
(ownerProjectId IN accessibleProjectIds)
  OR
(ownerProjectId IS NULL AND ownerUserId = currentUserId)
```

This enables org members to see all project knowledge in their org when opting into `scope=all`. The `getAccessibleProjectIds(db, userId, orgId)` helper resolves the IDs. Solo-user behaviour (no `accessibleProjectIds`) is unchanged.

### Phase 3b — URL routing (shipped 2026-04-25)

Since Phase 3b the canonical UI URL encodes the active org and project:

```
/[orgSlug]/[projectSlug]
```

**Examples:**

| URL | Meaning |
|---|---|
| `/personal-a1b2c3d4e5f6/default` | Personal org's default project |
| `/acme-corp/backend-api` | Team org's backend-api project |
| `/` | Bare root — redirects to the user's active project URL |

**Routing rules:**

1. `GET /[orgSlug]/[projectSlug]` — resolved by `apps/web/app/[orgSlug]/[projectSlug]/page.tsx` (server component). Returns 404 via Next.js `notFound()` if the user is not a member of the org or the project does not exist in that org. On a valid match, sets the `bp_active_project` cookie and renders `<BrainApp />`.
2. `GET /` — resolved by `apps/web/app/page.tsx`. Redirects to `/[orgSlug]/[projectSlug]` using the cookie-based resolver (`getActiveProject(userId)`), so existing bookmarks never break.
3. **Settings + admin pages** (`/settings/tokens`, `/settings/projects`, `/admin/*`) are NOT under the org/project segment — they are user/platform-level routes. Do not move them.
4. **Sub-surface URLs** (`/[orgSlug]/[projectSlug]/oracle`, etc.) are deferred to Phase 3c. Surface switching (Dashboard/Oracle/Skills/…) remains client-side state in the SPA shell for now.

**Cookie synchronisation.** The URL-routed page always overwrites the `bp_active_project` cookie with the URL-resolved project id. API routes continue to use `getActiveProject(userId)` (cookie + fallback) — they are unaffected by Phase 3b. Navigating to a different project URL therefore automatically syncs all subsequent API calls.

**Resolver split:**

| Helper | Where used | Logic |
|---|---|---|
| `getActiveProject(userId)` | All API routes | Cookie → first project → create default |
| `getActiveProjectFromUrl(orgSlug, projectSlug, userId)` | `[orgSlug]/[projectSlug]/page.tsx` | `getUserProjects` + slug match; throws `BrainError{status:404}` on mismatch |

**Solo-user experience.** A 1-org-1-project user lands on `/personal-xxx/default` after sign-in. The `<OrgProjectSwitcher>` auto-hides; there is no regression vs Phase 2.

### Phase 3c — token-level project scoping + audit-log scoping (shipped 2026-04-27)

#### Token scoping rule

An `MCPToken` may optionally carry a `projectId` (`nullable`, `onDelete: SetNull`). When set:

- The `authenticate()` function in `apps/mcp-server/src/auth.ts` returns `projectId` in the `AuthContext`.
- Every MCP tool handler that writes project-scoped data (`brain_start_session`, `brain_teach_knowledge`) checks: if `auth.projectId` is set AND the caller requests a different project → throw `BrainError{code:"FORBIDDEN_PROJECT", category:"auth", status:403}`.
- If `auth.projectId` is set and the caller does not specify a project → default to `auth.projectId`.
- If `auth.projectId` is null → Phase 2b "user's first project" fallback applies unchanged.

**Blast radius reduction.** A token scoped to project A cannot write to project B, even if the authenticated user has access to both. This limits the impact of a leaked CI token to a single project.

**Rotation preserves scope.** `POST /api/tokens/:id/rotate` carries `organizationId` and `projectId` from the old token to the new row. `POST /api/tokens/:id/change` is in-place and retains all metadata.

#### Audit log scoping

`AuditLog` now has two nullable columns: `organizationId` and `projectId`. When action context has them, they are written alongside the row:

| Action | orgId written | projectId written |
|---|---|---|
| `token.create` | user's personal org | new token's projectId (if set) |
| `token.rotate` | old token's org | new token's projectId (if set) |
| `token.change` | token's org | token's projectId (if set) |

`writeAudit()` accepts optional `orgId` and `projectId` in its input type and persists them. All callers that have context pass it.

`GET /api/admin/audit-log` accepts `?orgId=` and `?projectId=` filter params. The admin audit page has corresponding filter inputs.

#### Phase 3c+ (future)

SMTP invite emails, sub-surface URLs (`/[orgSlug]/[projectSlug]/oracle`, etc.), team-level ACL.

### Phase 4 — Knowledge visibility + Promote-to-org + Fork-into-project (shipped 2026-04-27)

#### Visibility field

Knowledge rows now carry a `visibility` column (TEXT, NOT NULL, DEFAULT `'project'`). It is **separate** from the existing `scope` field (which expresses semantic context: global/user/project/team/community) and controls **who sees this row in their listings**.

| value | Who sees it |
|---|---|
| `"private"` | Only `ownerUserId` (ignores project context) |
| `"project"` | Default. Anyone whose active project matches `ownerProjectId` |
| `"org"` | All org members across any project in `ownerProjectId`'s org |

The `originProjectId` column (nullable TEXT) records the project where the row was first created, preserved across promote + fork chains for traceability.

#### Filter rule V2

`buildKnowledgeWhereV2(args)` and `buildRawProjectFilterV2(args, startParam)` in `packages/core/src/scope-filter.ts` implement the visibility-aware filter:

```
scope="project":
  (visibility="project" AND ownerProjectId=activeProjectId)
  OR (visibility="private" AND ownerUserId=userId AND ownerProjectId=activeProjectId)
  OR (visibility="org" AND ownerProjectId IN accessibleProjectIds)
  OR (ownerProjectId IS NULL AND ownerUserId=userId)   // legacy/personal

scope="all":
  (visibility IN ('project','org') AND ownerProjectId IN accessibleProjectIds)
  OR (visibility="private" AND ownerUserId=userId)
  OR (ownerProjectId IS NULL AND ownerUserId=userId)
```

`accessibleProjectIds` is resolved via `getAccessibleProjectIds(db, userId, orgId)` (Phase 3a). When empty (solo user or no org context), the filter degrades gracefully to project-scoped / personal-only behavior.

#### Promote-to-org rule

`POST /api/knowledge/:id/promote`:
- Requires: `ownerUserId === current user` AND `visibility="project"` AND `ownerProjectId IS NOT NULL`
- Effect: `visibility → "org"`, `originProjectId → current ownerProjectId`
- Audit: `knowledge.promote { knowledgeId, fromProjectId, toOrgVisibility: true }`

#### Fork-into-project rule

`POST /api/knowledge/:id/fork-to-project`:
- Requires: `visibility="org"` AND source + target projects in same org AND user is org member
- Body: `{ projectId? }` — defaults to active project
- Creates a new row with `visibility="project"`, `parentKnowledgeId=source.id`, `originProjectId=source.originProjectId ?? source.ownerProjectId`
- Audit: `knowledge.fork_to_project { sourceId, newId, projectId }`

**Chain invariant.** `originProjectId` always points back to the project that first created the rule, regardless of how many promote + fork hops occurred.

**Solo-user invariant.** With 1 project, `accessibleProjectIds` contains only that project. The org-visibility branch of the V2 filter shows org-visible rows from that same single project — functionally equivalent to "project" visibility. Promote button appears (to set visibility="org" for future multi-project scenarios) but no cross-project sharing happens until a second project is added.

---

## Three layers

```
    External AI clients (Claude Code, Cursor, Windsurf, Autobahn, …)
                              │ MCP / REST / LiveSync
┌─────────────────────────────▼─────────────────────────────┐
│  EXPERIENCE LAYER                                         │
│    apps/web   apps/mcp-server   REST API   apps/sync-bridge │
└─────────────────────────────┬─────────────────────────────┘
┌─────────────────────────────▼─────────────────────────────┐
│  INTELLIGENCE LAYER (packages/core)                        │
│    kea · kra · oracle · autoskill · graph · evolution      │
│    evaluation · formatter · embedding                      │
└─────────────────────────────┬─────────────────────────────┘
┌─────────────────────────────▼─────────────────────────────┐
│  DATA LAYER (packages/db)                                  │
│    Postgres + pgvector  ·  Object storage  ·  pg-boss      │
│    (optional CouchDB for LiveSync bridge)                  │
└───────────────────────────────────────────────────────────┘
```

## Eight subsystems × their home module

| Subsystem | Home |
|---|---|
| Ingestion | `apps/mcp-server/src/tools/log-event.ts` + `@brain/db` SessionEvent |
| Extraction (KEA) | `packages/core/src/kea.ts` |
| Storage | `packages/db/prisma/schema.prisma` + object storage adapter |
| Retrieval (KRA) | `packages/core/src/kra.ts` + `formatter.ts` |
| Evolution | `packages/core/src/evolution.ts` (scheduled by worker) |
| Oracle | `packages/core/src/oracle.ts` |
| Evaluation | `packages/core/src/evaluation.ts` |
| Trust / Audit | confidence fields on `Knowledge`, `SessionKnowledgeApplication` log |
| Observability | `packages/core/src/logger.ts` (pino + AsyncLocalStorage requestId, `BrainError` envelope, `redactFields`, `withTimer`, lazy Sentry) + `apps/web/lib/brain/log.ts::withApi` request wrapper. See `docs/KNOWLEDGE.md §12.12` for the normative envelope shape and `docs/APPROACH.md §5p` for the AI-readable-logs rationale. |

## Additional subsystems from the four reference systems

| Idea | Home |
|---|---|
| Autoskill (Hermes-inspired) | `packages/core/src/autoskill.ts` + `AutoskillProposal` table |
| Peer Card (Honcho-inspired) | `PeerCard` table + `brain_get_user_style` tool |
| Graph engine (Obsidian-inspired) | `packages/core/src/graph.ts` + `GraphEdge` table |
| LiveSync bridge (CouchDB-inspired) | `apps/sync-bridge` (optional, Phase 4) |

## Data flow (a single session, end to end)

1. **Session start.** Client calls `brain_retrieve_knowledge({ prompt, context })`.
   - KRA embeds prompt, fetches top-20 pgvector matches, scores with multi-factor formula, diversifies, returns bundle.
   - `formatter.formatForInjection(bundle)` produces a ready-to-inject string.
   - `SessionKnowledgeApplication` row written with `role: injected`.
2. **During session.** Client calls `brain_log_event(...)` for every file create/modify/reject/build-attempt/correction.
3. **Session end.** Client calls `brain_report_session_outcome`.
   - SQS computed and stored.
   - Knowledge success/failure counts incremented.
   - `kea.extract` + `autoskill.run` enqueued on pg-boss.
4. **Background.** Worker picks up jobs.
   - KEA runs LLM extraction → quality filter → dedup → persist with embeddings.
   - Autoskill detects correction patterns → classifies → creates proposals.
5. **Nightly.** Evolution jobs (decay, consolidate, obsolescence, health-snapshot).
6. **Human query.** User asks Oracle via webapp or `brain_ask_oracle` — RAG over the accumulated state, cited.

## Visual diagrams

Rendered illustrations of these concepts are available in [`assets/illustrations/`](./assets/illustrations/):

- **[Architecture diagram](./assets/illustrations/architecture.png)** — the 3-layer block diagram above, rendered as a flowchart.
- **[AI Application diagram](./assets/illustrations/ai_application.png)** — where LLMs and vector embeddings are applied (KEA, KRA, Oracle, Autoskill).
- **[Process Logic diagram](./assets/illustrations/process_logic.png)** — the data flow above as a sequence diagram.
- **[User Flow diagram](./assets/illustrations/user_flow.png)** — simplified view for end users: AI tool → MCP → Brain → Skills & Rules.

Source files (Mermaid `.md`) are co-located with the PNGs. Regenerate with `npx @mermaid-js/mermaid-cli`.
