# How the External Brain Works — Step-by-Step

*A chronological walkthrough from first deploy to self-improving knowledge corpus, with concrete examples.*

---

## The thesis in one paragraph

External Brain is a persistent knowledge layer that sits between AI coding tools and the developer. It captures the durable rules a developer accumulates while coding — via vibe-coding sessions in Claude Code, Cursor, Windsurf, Gemini CLI, or any MCP-capable agent — and serves them back at moments of decision so that the next time you face the same problem, the AI tool already knows your team's answer. The compounding mechanic: every session contributes signal; **autoskill** proposes new skills from the patterns it sees you reuse; sessions whose rules pay off get reinforced; rules that don't fade. The brain gets better on its own, so each project improves day by day without anyone stopping to hand-write a rules file. The retrieval layer has its first published number (2026-07-06): the production KRA ranking beats a raw-cosine baseline by +0.148 NDCG@5 on a real, telemetry-labeled fixture — see [`docs/VALIDATION.md`](./VALIDATION.md). The stronger end-to-end claim ("the Brain measurably improves AI coding *output*") remains unproven until the generation-uplift benchmark runs; the docs deliberately don't extend the retrieval result to it.

**Why a separate layer, when AI tools already have memory?** Because that memory is trapped — **per tool, per project, and per person**. Claude Code's memory doesn't carry over to Cursor or Copilot, a lesson learned on one repo doesn't reach the next, and each teammate starts from zero. It's also a **black box** you can't inspect or correct, and **vendor-locked** in someone else's cloud. External Brain is one shared, inspectable, self-hosted knowledge layer that spans every MCP tool, project, and team — with user / project / team / org scopes it was built for **enterprise knowledge reuse**, so a skill learned once becomes the team's. Use it *alongside* a tool's built-in memory, not instead of it.

---

## Step 0 — Where the platform runs

A Brain is a single self-contained stack of four services: `web` (Next.js,
port 3000), `mcp-server` (TypeScript MCP, port 3100), `worker` (pg-boss
background jobs), and `db` (Postgres + pgvector). Caddy handles TLS via Let's
Encrypt HTTP-01. Bring it up with `docker compose -f deploy/docker-compose.yml
up` (bare local) or `./scripts/deploy.sh` (server with TLS, the `edge` profile).

Each instance is independent — its tokens and knowledge live in its own
Postgres and don't cross to any other instance.

See [`docs/ARCHITECTURE.md §"Deployment topology"`](./ARCHITECTURE.md#deployment-topology) for the diagram and operating notes.

---

## Step 1 — The pilot operator stands up the platform

### What the operator does

The operator has a VPS (Debian 12 or Ubuntu 22.04 recommended, 2 vCPU / 4 GB RAM / 40 GB disk, Docker Engine 24+ with Compose v2):

```bash
git clone https://github.com/bejranonda/ExternalBrain.git external-brain
cd external-brain
cp .env.example .env
$EDITOR .env
```

Key env vars to set before first deploy:

| Variable | What it does | Example |
|---|---|---|
| `BRAIN_PUBLIC_HOSTNAME` | Webapp's public hostname — used in email links, onboarding wizard URLs | `brain.acme.com` |
| `BRAIN_MCP_PUBLIC_HOSTNAME` | MCP server's public hostname — used in install snippets | `mcp.brain.acme.com` |
| `AUTH_SECRET` | NextAuth JWT signing key | `openssl rand -base64 32` |
| `ADMIN_USERNAME` | Admin sign-in username | `admin` |
| `ADMIN_PASSWORD_HASH` | bcrypt hash (cost 12) of admin password | `pnpm hash-admin-password 'hunter2'` |
| `GOOGLE_GEMINI_API_KEY` | Embedding provider (primary: `gemini-embedding-001`) | `AIza…` |
| `RESEND_API` | Transactional email — invite + password-reset links | `re_…` |
| `EMAIL_FROM` | Sender address in outgoing emails | `brain@acme.com` |

Then (local/dev — for a public server use `./scripts/deploy.sh`):

```bash
./scripts/dev-up.sh
```

What this orchestrates:

- Exports `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1` and builds the multi-stage Docker image (warm rebuild ~2–3 min, cold first build ~20–30 min).
- Waits for the `db` service to accept connections, then runs `prisma migrate deploy` against the schema migrations in `packages/db/prisma/migrations/`.
- Runs the embedding backfill worker to compute 1536-dim vectors for every Knowledge row without one.
- Starts the Caddy sidecar with ACME auto-TLS for `BRAIN_PUBLIC_HOSTNAME` and `BRAIN_MCP_PUBLIC_HOSTNAME`.
- Runs `scripts/verify-lockdown.sh` — probes `/api/knowledge`, MCP tools/list, and the sign-in surface in all auth modes. Refuses to report success on any lockdown failure.
- Runs `scripts/nav-smoke.sh` — curls every shell hash-route, every auth route, every admin route, every `/api/*` probe. Exits non-zero on any 5xx.

Smoke-check the result:

```bash
curl https://brain.acme.com/api/healthz    # → {"ok":true}
curl https://brain.acme.com/api/readyz     # → {"ok":true,"dbMs":4}
```

Full operator runbook: [`deploy/PRODUCTION.md`](../deploy/PRODUCTION.md) and [`docs/DEPLOY_CHECKLIST.md`](./DEPLOY_CHECKLIST.md).

---

## Step 2 — The pilot user receives their invite

### What the operator does

The operator navigates to `https://brain.acme.com/settings/org` → "Invite member" → enters `bob@acme.com` → selects role `member` → submits.

### What happens on the server

```
POST /api/orgs/:orgId/invites  { email: "bob@acme.com", role: "member" }
```

The handler in `apps/web/app/api/orgs/[orgId]/invites/route.ts` calls `createOrgInvite()` from `packages/core/src/org.ts`, which:

1. Generates a 32-byte `crypto.randomBytes` token encoded as base64url (≈43 chars, 256 bits entropy).
2. Inserts an `OrganizationInvite` row: `{ token, email: "bob@acme.com", role: "member", orgId, expiresAt: now + 7 days }`.
3. If `EMAIL_PROVIDER=resend` (or `RESEND_API` is set), calls `sendEmail()` from `packages/core/src/email.ts` — a direct Resend HTTP call via `fetch()` with no extra npm dependency. The email looks like:

   > **Subject:** You're invited to join Acme on External Brain
   >
   > Hi, alex@acme.com invited you to join Acme. Click below to set your password and join:
   > https://brain.acme.com/accept-invite?token=xxxxx
   >
   > This link expires in 7 days.

4. If email is not configured, the response includes `{ link: "https://brain.acme.com/accept-invite?token=xxxxx" }` as a single-show copyable link in the UI.

### What Bob sees

Bob clicks the link → `/signin?invite=<token>` renders a sign-up form pre-filled with `bob@acme.com` (email read-only). Bob enters a display name and picks a password (≥8 chars). On submit, `POST /api/invites/signup` runs a transaction:

1. Creates the `User` row (email lowercased, username from display name).
2. Creates a `UserCredential` row — bcrypt hash at cost 12, stored in the `packages/db/prisma/schema.prisma` `UserCredential` model (migration `20260427_user_credentials`).
3. Marks `OrganizationInvite.acceptedAt = now` (one-shot — future attempts are rejected).
4. Creates an `OrganizationMember` row: `{ orgId, userId: bob.id, role: "member" }`.
5. Calls `ensurePersonalOrg(bob.id)` (from `packages/core/src/org.ts`) — idempotently creates bob's personal org with `id = "org_<bob.id>"`, `slug = "personal-<bob.id.slice(3,15)>"`, `role = "owner"`.
6. Calls `ensureDefaultProject(bob.id)` — creates a "Default" project in that personal org.

Bob is signed in (NextAuth JWT cookie via `CredentialsProvider.authorize()` in `apps/web/auth.ts`) and lands at `https://brain.acme.com/welcome` — the v0.14.0 first-run route. `/welcome` is a 3-step explainer: (1) pick the AI tool you use (Claude Code / Cursor / Windsurf / Gemini CLI / other), (2) copy the install one-liner generated for that tool, (3) wait for the dashboard to show "Brain learned something new" — the toast that confirms the first session round-tripped and KEA produced at least one Knowledge row. Once a user has any session, `/welcome` redirects to the canonical project URL `/[orgSlug]/[projectSlug]` per the Phase 3b routing scheme. Bob's lands at `/acme-corp/default`.

---

## Step 3 — Bob wires Claude Code to the Brain

### Creating a token

Bob navigates to `/settings/tokens` → enters a name "laptop · claude-code" → optionally picks a project scope from the dropdown (or leaves "Any project") → clicks **Create**.

Behind the scenes, `POST /api/tokens` inserts an `MCPToken` row: `{ tokenHash: SHA256(raw), name, organizationId, projectId, expiresAt: now + 90d }`. The raw `bp_…` string is shown once and never stored — only its SHA-256 hash lives in the DB.

### The install wizard

The post-mint wizard appears. Bob picks **Claude Code** and **macOS**. The snippet is generated client-side by `packages/core/src/install-snippets.ts` (the raw token never re-crosses the wire after the mint response):

```bash
curl -fsSL https://brain.acme.com/api/onboard.sh | bash -s 'bp_QzL…'
```

Bob clicks Copy, runs it in his terminal. The script (`apps/web/app/api/onboard.sh/route.ts` serves a templated POSIX bash script with `{{MCP_URL}}` and `{{WEB_URL}}` substituted server-side):

1. Calls `claude mcp add brain --scope user --transport http https://mcp.brain.acme.com/mcp --header "Authorization: Bearer $TOKEN"` — writes the server entry to **`~/.claude.json`** (the canonical Claude Code MCP config; `~/.claude/mcp.json` is a common trap path that Claude Code does not read).
2. Downloads `/api/skills/brain` and writes `~/.claude/skills/brain/SKILL.md` — this teaches Claude Code *when and why* to call the `brain_*` tools, not just that they exist.
3. Verifies with `claude mcp list | grep brain`.
4. **Smoke-test (installer v2, 2026-05-11)** — runs a curl-based `initialize` + `tools/call brain_get_user_style` end-to-end through `${MCP_URL}`. Proves the bearer reaches a tool through Bob's network, TLS, Caddy, and `authenticate()`. Hard-fails the installer on any failure with per-HTTP-code diagnostics (401 = revoked, 502 = backend down, 000 = DNS/TLS/firewall, etc.).
5. **Install-ping (installer v2, 2026-05-11)** — best-effort `brain_start_session(clientType="claude_code")` → `brain_log_event(payload={installer_version, claude_version, os})` → `brain_report_session_outcome(success=true)`. Creates a real Session row with `endedAt` set, which is the strict signal KEA reads as "real client did real work."
6. Prints a first-touch nudge — a literal `Brain, remember: …` prompt Bob can paste into his first Claude Code session to fire `brain_teach_knowledge` immediately, converting the install into a teach call.

Bob restarts Claude Code. Now in any new session, the `brain_*` tools are available — and the SKILL.md already tells Claude when to call them.

Bob can click **Test connection** in the wizard — this calls `POST /api/tokens/:id/test`, which validates the token's DB state and returns `{ ok: true }` without re-exposing the raw token. A `token.test` audit row is written to `AuditLog`. (The Test-connection button predates installer v2 and complements it — Test verifies the token's DB state from the webapp; the install-ping verifies the full MCP-over-HTTP path from Bob's laptop.)

---

## Step 4 — The first coding session creates signal

Bob opens Claude Code and asks: *"add zod validation to the login form."*

Because Claude Code loaded the SKILL.md, it knows to call brain tools at session boundaries. The sequence:

### 4a. Session start

```json
brain_start_session({
  "clientType": "claude-code",
  "prompt": "add zod validation to the login form",
  "framework": "react",
  "projectName": "acme-frontend"
})
```

The MCP server handler in `apps/mcp-server/src/tools/start-session.ts` authenticates the bearer token against the `MCPToken` table (SHA-256 compare, checks `revokedAt` and `expiresAt`), then resolves the destination project. Resolution precedence (v0.14.0): token scope wins; otherwise caller's `projectId` wins; otherwise `projectName` is looked up case-insensitively via `ensureNamedProject` and **created on demand** if it doesn't exist; otherwise the user's first project (Phase 2b fallback); otherwise a lazy "Default" project. A `Session` row is inserted and `{ sessionId: "sess_abc123", startedAt: "2026-05-02T09:00:00Z" }` is returned. Claude saves `sessionId` for the rest of the session. Because the call included a `prompt`, the handler also runs retrieval in the same round-trip and attaches `relevantKnowledge { knowledgeIds, injection }` (inject-at-open, #64) — for bob's first-ever session the bundle is empty so the field is omitted; once knowledge exists it arrives pre-formatted, as shown in [Step 6](#step-6--the-next-session-benefits).

The on-demand project creation closes a v0.13.0-era gap where AI agents could only attach sessions to projects that already existed. Agents that want an explicit, audit-friendly path can instead call `brain_create_project` first (returns `{ projectId, slug, created }`, idempotent on name). Agents that want to verify intent before starting can call `brain_get_active_project` (returns the project a session would default to right now, with a `source: "token_scope" | "first_project_fallback"` field) and `brain_list_projects` (returns every project the caller can see). See [`docs/MCP_TOOLS.md §"Project-management tools (v0.14.0)"`](./MCP_TOOLS.md#project-management-tools-v0140) for the full catalog.

### 4b. Retrieval before generation

```json
brain_retrieve_knowledge({
  "query": "zod login form",
  "context": { "sessionId": "sess_abc123", "projectId": "proj_frontend" }
})
```

KRA (Knowledge Retrieval Agent, `packages/core/src/kra.ts`) embeds the query, runs a pgvector cosine search, scores candidates, and returns a bundle. For bob's first-ever session, the bundle is empty — no rules yet. Claude proceeds with general knowledge.

### 4c. Logging events during work

As Claude proposes and the user accepts/rejects diffs, the SKILL.md instructs Claude to call:

```json
brain_log_event({
  "sessionId": "sess_abc123",
  "eventType": "user_accepted_diff",
  "payload": { "file": "components/LoginForm.tsx", "linesChanged": 34 }
})
```

Each call inserts a `SessionEvent` row (type `STRING`, payload `JSONB`) — the raw material for extraction.

### 4d. Session end

When the task is complete, Claude calls:

```json
brain_report_session_outcome({
  "sessionId": "sess_abc123",
  "success": true,
  "knowledgeUsed": [],
  "filesCreated": [],
  "filesModified": ["components/LoginForm.tsx", "lib/schema/login.ts"],
  "buildAttempts": 1,
  "tokensUsed": 8400
})
```

The handler in `apps/mcp-server/src/tools/report-session-outcome.ts`:

1. Sets `Session.outcome = "success"`, `Session.sqsScore` (Session Quality Score, a 0–1 composite of signals).
2. Calls `bulkBumpKnowledgeOutcome()` from `packages/core/src/knowledge-stats.ts` for any `knowledgeUsed` IDs (none here for the first session).
3. Enqueues a `kea.extract` job on pg-boss — this is the trigger for background extraction.

---

## Step 5 — KEA extracts knowledge

The worker process (`apps/worker/`) picks up the `kea.extract` pg-boss job. The handler calls `packages/core/src/kea.ts`.

**Refine mode (close-capture, 2026-06-09):** if the agent submitted `learnings` when it closed the session (see [`MCP_TOOLS.md §brain_report_session_outcome — learnings`](./MCP_TOOLS.md#brain_report_session_outcome--learnings-parameter-close-capture-2026-06-09)), KEA *validates* those instead of mining — a cheap judge pass screens each candidate for durability/specificity, then the normal quality filter + semantic dedup apply, and persisted rows are tagged `close_capture`. This exists because single-session summaries are thin (mining yielded ~17%); the agent's own context holds the full session, so it distills and the brain verifies. Sessions closed without learnings take the original mine path below.

KEA reads the session's events and outcome, assembles a `KEAInputPayload`, and sends it to the configured KEA model (env var `KEA_MODEL`, default Qwen3-Coder via DashScope or GLM-4.5-air). The prompt (sourced from `research/knowledge/15-implementation-stubs.md §2`) asks:

> *"What durable, project-specific rules can be extracted from this session? Return 0–3 KEAFindings as JSON."*

The model returns structured findings. One example for bob's session:

```json
{
  "type": "recipe",
  "scope": "project",
  "trigger": "Adding a zod schema to a React form",
  "rule": "Define the schema in lib/schema/<form>.ts, export <form>Schema and the inferred TypeScript type. Use zodResolver from @hookform/resolvers/zod in the form component. Surface errors via formState.errors.<field>.message.",
  "rationale": "User accepted this pattern across 3 diff hunks in this session with no corrections.",
  "confidence": 0.78
}
```

KEA's `persist()` function in `kea.ts`:

1. Applies a quality filter (confidence floor, dedup against existing Knowledge rows via embedding similarity).
2. Inserts a `Knowledge` row into Postgres:
   - `ownerUserId = bob.id`
   - `ownerProjectId = proj_frontend`
   - `type = "recipe"`
   - `triggerText = "Adding a zod schema to a React form"`
   - `ruleText = "Define the schema in lib/schema/<form>.ts…"`
   - `confidence = 0.78`
   - `visibility = "project"` (default — visible to project members)
   - `successCount = 0`, `failureCount = 0`, `usageCount = 0`
3. Calls `embed(ruleText + " " + triggerText)` from `packages/core/src/embedding.ts` — the embedding chain tries `gemini-embedding-001` (1536 dim) first, falls back to `gemini-embedding-002` on quota/error, then to any `EMBEDDING_BASE_URL`-compatible endpoint. The resulting `number[]` is stored in the `embedding vector(1536)` column.

The new `Knowledge` row is now searchable via pgvector and will appear in future KRA retrieval calls.

---

## Step 6 — The next session benefits

A week later, bob asks Claude Code: *"add zod to the password-reset form."*

**Since v1.5.0 (inject-at-open, #64) this step is automatic:** opening the
session with `brain_start_session(prompt: "add zod to the password-reset
form")` runs the retrieval below on the agent's behalf and returns
`relevantKnowledge { knowledgeIds, injection }` in the same response — no
separate call to remember. The standalone tool remains for mid-task re-query;
the worked example below shows what happens under the hood either way.

Claude calls `brain_retrieve_knowledge({ query: "zod password reset form", context: { sessionId: "sess_def456", projectId: "proj_frontend" } })`.

### What KRA does

`packages/core/src/kra.ts::retrieveScored()`:

1. Calls `embed("zod password reset form")` → 1536-dim query vector.
2. Executes a raw SQL query against the `Knowledge` table with pgvector's `<=>` cosine distance operator, applying the Phase 4 visibility filter from `buildRawProjectFilterV2()` in `packages/core/src/scope-filter.ts`:
   ```sql
   SELECT id, type, triggerText, ruleText, confidence, successCount, failureCount,
          usageCount, lastUsedAt, decayScore, …
          1 - (embedding <=> $1::vector) AS "_similarity"
   FROM "Knowledge"
   WHERE deletedAt IS NULL
     AND (
       (visibility = 'project' AND "ownerProjectId" = $activeProjectId)
       OR (visibility = 'org' AND "ownerProjectId" IN ($accessibleProjectIds))
       OR ("ownerProjectId" IS NULL AND "ownerUserId" = $userId)
     )
   ORDER BY "_similarity" DESC
   LIMIT 20
   ```
3. For each of the top-20 candidates, computes a multi-factor score using the weights in `WEIGHTS` (tuned 2026-04-23; re-validated unchanged 2026-07-06 on the first real-corpus benchmark — see `docs/VALIDATION.md`):
   ```
   score = 0.70 × similarity
         + 0.08 × successRate     (0.5 floor for rules with < 3 outcomes)
         + 0.08 × recencyDecay    (exp(-days/90))
         + 0.08 × contextFit
         + 0.06 × confidence
   ```
4. Diversifies the top-K results by type to avoid returning 5 recipes when 1 principle would also be useful.
5. Returns a `KnowledgeBundle` with `injectedIds`, typed buckets, and a pre-formatted `injection` string ready to prepend to Claude's prompt.

The bundle comes back with the zod-form-pattern rule at rank 1 (cosine similarity ~0.89 — same topic, close phrasing). Claude injects `bundle.injection` into its prompt and writes the password-reset form using the exact pattern bob established last week: schema in `lib/schema/password-reset.ts`, `zodResolver` in the component, `formState.errors` for field display.

`brain_log_event({ sessionId, eventType: "knowledge_applied", payload: { knowledgeIds: ["k_xyz"] } })` records the application. A `SessionKnowledgeApplication` row is written with `role: "injected"`.

---

## Step 6b — Bob checks the dashboard (v0.14.0 layout)

Bob navigates to `https://brain.acme.com/acme-corp/frontend`. The v0.14.0 dashboard is deliberately quiet:

- **PulseLine** — a single sentence at the top describing what changed since Bob's last visit ("Brain learned 2 new rules from your session yesterday.").
- **Three action cards** — equally-weighted, each linking to one destination:
  - **Skills** — a count of rules in Bob's Brain, with the most-recent one's trigger line.
  - **Latest insight** — the most recent KEA extraction with a "see why" link to the source session.
  - **Oracle prompt** — a one-line invitation to ask a question, with one suggested prompt drawn from Bob's recent work.
- **`▾ Show everything` fold** — collapses by default; expands to show the legacy stat row (sessions, knowledge, proposals counters), the LiveExtraction panel, the PendingProposals panel, and the projects/sessions drill-downs from v0.13.0. The system-chatter surfaces have been demoted below user-facing surfaces per the *quiet-by-default* principle in [`docs/DESIGN_PRINCIPLES.md`](./DESIGN_PRINCIPLES.md).

A **"Brain learned something new"** toast fires on dashboard mount when a new Knowledge row was extracted since Bob's last visit — surfaces KEA's silent work into a foreground signal without requiring Bob to click into the LiveExtraction panel.

The **sidebar** is collapsed to a 56-px icon rail by default; hovering expands it to show labels. Every destination page has a plain-English subtitle under its h1 ("Skills — the rules Brain has learned from your sessions"; "Oracle — ask a question and get an answer grounded in your Brain").

---

## Step 7 — Bob asks the Oracle

Bob switches to the Brain webapp at `https://brain.acme.com/acme-corp/frontend`, opens **Oracle**, and types:

> *"What's our preferred way to add zod validation to a form?"*

Server-side (`POST /api/oracle/stream`, handler in `apps/web/app/api/oracle/stream/route.ts`):

1. Calls `oracle.askStream()` from `packages/core/src/oracle.ts`, which runs KRA retrieval first — same embedding + pgvector pipeline as above, but with the full org context: `orgId`, `accessibleProjectIds`, `dataScope`.
2. Computes groundedness from the retrieval bundle **before** the LLM call:
   - `strong`: ≥5 knowledge items or ≥3 session items
   - `moderate`: ≥2 knowledge or ≥1 session
   - `weak`: ≥1 knowledge or session
   - `none`: empty bundle — uses `SYSTEM_PROMPT_NO_CONTEXT` override (nudges the LLM to be honest rather than fabricate)
3. Emits a `meta` SSE event immediately (before the first `delta`) carrying `{ groundedness: "moderate", retrievedCounts: { knowledge: 4, sessions: 1 } }` — this is why the header pill renders *during* streaming, not after.
4. The Oracle model (`ORACLE_MODEL`, default `glm-5.1` via Z.ai or `claude-sonnet-4-6`) receives the retrieval bundle injected into the system prompt and streams its answer with `[^K1]` / `[^S1]` citation markers.
5. After streaming completes, `mapCitations()` in `oracle.ts` enriches each citation with metadata from the already-loaded retrieval bundle (no extra DB queries): type, triggerText, effectivenessScore, outcomes, usageCount, lastUsedAt.
6. `bulkBumpKnowledgeUsage()` from `knowledge-stats.ts` bumps `usageCount` and `lastUsedAt` on each cited Knowledge row (best-effort, non-blocking).

Bob's screen shows:

```
🧠 Grounded on 4 rules · 1 session   ·   moderate

Define the schema in lib/schema/<form>.ts as <form>Schema [^K1].
Use zodResolver in the form component, surface errors via
formState.errors [^K2]…

▾ Sources used by the Brain (4)
```

Expanding the sources shows each citation card: type chip (recipe, color-coded), effectiveness badge (✓ 100% useful — based on `successCount / (successCount + failureCount)`), last-used time ("3 days ago"), and the `WHEN:` trigger line ("Adding a zod schema to a React form").

### Thumbs feedback

Bob clicks 👍 — `POST /api/oracle/feedback` with the `citationIds`. The handler calls `bulkBumpKnowledgeOutcome()` which increments `successCount += 1` on each cited Knowledge row. The effectiveness badge updates within seconds on the Skills page.

If bob clicks 👎 — `failureCount += 1` on each cited row.

---

## Step 8 — The self-improvement loop tightens

With continued use, the `evolution.decayUnused()` job (scheduled daily at 02:00 by pg-boss, handler in `packages/core/src/evolution.ts`) computes each rule's `decayScore`:

```
decayScore = max(exp(-days_since_last_use / halfLife), 0.05)
```

where `halfLife` is effectiveness-aware (logic in `evolution.ts::decayUnused`):

- **Insufficient data** (< 3 outcomes): `halfLife = 90 days` (baseline — no penalty for new rules)
- **Low effectiveness** (≥5 outcomes, score < 0.3): `halfLife = 45 days` (2× faster decay)
- **High effectiveness** (≥5 outcomes, score ≥ 0.7): `halfLife = 180 days` (2× slower decay)

Rules whose `effectivenessScore < 0.3` with ≥5 outcomes and no usage in the last 30 days get tagged `"flagged:low-effectiveness"` in their `tags` array (non-destructive — bob can review them in the Skills tab). They don't disappear; they sink in KRA scores because `decayScore` feeds into `contextFit`.

The KRA scoring formula also applies a 0.5 neutral floor for rules with fewer than 3 outcomes (in `scoreItem()` in `kra.ts`) — newly extracted rules don't compete at a disadvantage against established rules that happen to have 0 successes and 0 failures recorded. Fresh rules wait for evidence, then earn their rank.

Over weeks:
- The zod-form-pattern rule, used in 4 sessions and thumbed-up 3 times, gets a 180-day half-life and consistently ranks at the top of every zod-adjacent query.
- A one-time rule that was never reused gradually decays from `decayScore = 1.0` toward `0.05` and stops surfacing unless the query is very specific.
- The **Skills tab** becomes a curated list — high-effectiveness rules sit at the top; low-effectiveness rules display an ✗ red badge.

---

## Step 9 — Multi-tenant collaboration

A few weeks in, bob's company hires charlie. Bob (org owner) goes to `/settings/org` → invites `charlie@acme.com`. Same flow as Step 2. Charlie joins the Acme org as a `member`.

### Knowledge visibility

Every `Knowledge` row carries a `visibility` column (added in migration `20260427_knowledge_visibility`, default `"project"`):

| Visibility | Who sees it |
|---|---|
| `"private"` | Only `ownerUserId` — not even project members |
| `"project"` | Default. Anyone whose active project matches `ownerProjectId` |
| `"org"` | All org members across any project in the org |

When charlie opens the `acme-corp/frontend` project, he sees:

- Rules bob has **promoted** to org visibility (`POST /api/knowledge/:id/promote` → `visibility → "org"`, `originProjectId` recorded for lineage) — labeled with 🌐 Org in the Skills UI.
- Rules scoped to `acme-corp/frontend` (`visibility = "project"`) — labeled 📁 Project.
- No rules with `visibility = "private"` that bob created.

`buildKnowledgeWhereV2()` in `packages/core/src/scope-filter.ts` handles the three-way visibility filter for both Prisma queries and the raw pgvector SQL used by KRA.

### Forking a rule

Charlie's project is a legacy codebase that uses Formik rather than react-hook-form. An org-level rule about `zodResolver` doesn't fit. Charlie clicks **Fork here** on that rule — `POST /api/knowledge/:id/fork-to-project` creates a new `Knowledge` row with `visibility = "project"`, `parentKnowledgeId = source.id`, `ownerProjectId = charlie's project`. Charlie edits the fork to reflect Formik's resolver API. His sessions now get the Formik variant; bob's sessions still get the original.

---

## Step 10 — The operator measures effectiveness

The previous "Brain Effectiveness" dashboard widget and its underlying
generation-uplift benchmark were retired on 2026-05-08 alongside the
demo seed they were authored against (see [`docs/VALIDATION.md`](./VALIDATION.md)).
Until a non-author-written fixture and a real-corpus methodology are in
place, per-deployment effectiveness is observed qualitatively via the
per-rule effectiveness badges on the Skills tab and the per-citation
"Why this answer" panel in Oracle.

---

## The five visible signals at a glance

| Signal | Where | Cadence |
|---|---|---|
| 🧠 Groundedness header | Above each Oracle answer — `N rules · M sessions · strong/moderate/weak/none` | Per-answer (streams before the first word) |
| Why-this-answer panel | Inside "Sources used by the Brain" expander — type chip, effectiveness badge, WHEN trigger line, last-used time | Per-citation |
| ✓/~/✗/—/○ effectiveness badge | On every Skills row and Oracle citation card | Days (updated on thumbs feedback + session outcome) |
| Effectiveness-aware decay | Background; visible via badge changes and `flagged:low-effectiveness` tag on Skills rows | Days–weeks (daily decay job) |
| Brain Effectiveness widget | Dashboard (admin-only) — headline delta, win rate, sparkline | Weeks (per manual or scheduled uplift run) |

---

## End-to-end concrete example

Here is one realistic scenario start-to-finish, using the Acme team and fictional-but-plausible data.

---

**Day 1 — Setup.** The operator (alex@acme.com) deploys to the server VPS. He sets `BRAIN_PUBLIC_HOSTNAME=brain.acme.com`, `ADMIN_USERNAME=admin`, runs `pnpm hash-admin-password 'acme-pilot-2026'`, pastes the hash into `.env`, and runs `./scripts/deploy.sh`. Seven minutes later, `curl https://brain.acme.com/api/healthz` returns `{"ok":true}`. He invites bob@acme.com and charlie@acme.com from `/settings/org`.

---

**Day 2 — First token.** Bob clicks the invite link, sets his password, lands on `https://brain.acme.com/acme-corp/default`. He goes to `/settings/tokens` → creates "laptop · claude-code" → wizard appears → he picks Claude Code + macOS → copies the one-liner → runs it:

```
curl -fsSL https://brain.acme.com/api/onboard.sh | bash -s 'bp_QzL9rU2xHa…'
```

Output:
```
✓ Registered brain MCP server in ~/.claude.json
✓ Wrote skill: ~/.claude/skills/brain/SKILL.md
✓ Verified: brain is in `claude mcp list`
Restart Claude Code to activate.
```

Bob restarts Claude Code.

---

**Day 2 — First session.** Bob opens Claude Code and asks: *"scaffold a Prisma soft-delete pattern for the User table."* Claude calls:

1. `brain_start_session({ clientType: "claude-code", prompt: "scaffold Prisma soft-delete" })` → `sessionId: "sess_001"`
2. `brain_retrieve_knowledge({ query: "prisma soft delete", context: { sessionId: "sess_001" } })` → empty bundle (Brain is fresh)
3. Claude writes the migration, model changes, and service helpers. Bob accepts 3 diff hunks.
4. `brain_log_event({ sessionId: "sess_001", eventType: "user_accepted_diff", payload: { file: "prisma/schema.prisma" } })`
5. `brain_log_event({ sessionId: "sess_001", eventType: "user_accepted_diff", payload: { file: "lib/user.ts" } })`
6. `brain_report_session_outcome({ sessionId: "sess_001", success: true, filesModified: ["prisma/schema.prisma", "lib/user.ts", "prisma/migrations/…"] })`

---

**Day 2, minutes later — KEA extracts.** The `kea.extract` pg-boss job runs. KEA reads the session events and calls the KEA model. It returns one finding:

```json
{
  "type": "recipe",
  "trigger": "Implementing soft-delete on a Prisma model",
  "rule": "Add deletedAt DateTime? to the model. Add @@index([deletedAt]). In all queries, filter WHERE deletedAt IS NULL. Provide a softDelete(id) helper in lib/<model>.ts that sets deletedAt = new Date() instead of db.<model>.delete(). Never use db.<model>.delete() directly.",
  "confidence": 0.82
}
```

KEA computes the embedding (`gemini-embedding-001`, 1536 dim) and inserts the `Knowledge` row with `id: "k_soft_001"`.

---

**Day 9 — Second session benefits.** One week later, charlie (now wired to the Brain) asks Claude Code: *"add soft delete to the Post model."* His token is scoped to `acme-corp/frontend`, so KRA runs with `accessibleProjectIds = ["proj_frontend"]`.

Bob's soft-delete rule has `visibility = "project"` and `ownerProjectId = "proj_default"`. Charlie's project is `proj_frontend`. The rule is NOT visible to charlie yet — the filter requires `ownerProjectId IN accessibleProjectIds`.

Bob sees this situation and decides this pattern should be universal. He goes to the Skills tab, finds the soft-delete rule, clicks **Promote to org** → `visibility` becomes `"org"`. Now:

- KRA for charlie's session returns the rule at cosine similarity 0.91 (near-identical query).
- Claude injects the pattern: charlie's code adds `deletedAt DateTime?`, the `@@index`, the `softDelete()` helper.
- Zero re-explanation needed.

`brain_log_event({ eventType: "knowledge_applied", payload: { knowledgeIds: ["k_soft_001"] } })`.

---

**Day 16 — Oracle confirms the pattern.** Bob opens Oracle and asks: *"how do we handle soft deletes in this project?"*

KRA retrieves `k_soft_001` (similarity 0.94) plus one session reference (sess_001). Groundedness: `moderate` (1 rule + 1 session). Oracle streams:

```
🧠 Grounded on 1 rule · 1 session   ·   moderate

Add deletedAt DateTime? to the model and index it [^K1]. All queries
filter WHERE deletedAt IS NULL [^K1]. Use softDelete(id) in lib/<model>.ts
— never db.<model>.delete() directly [^K1].

▾ Sources used by the Brain (1)
  [recipe] ✓ 100% useful (2) · 7 days ago
  WHEN: Implementing soft-delete on a Prisma model
```

Bob clicks 👍. `successCount` on `k_soft_001` becomes 2 (charlie's session outcome + bob's thumbs). With ≥5 outcomes accumulated over the next few months, its `halfLife` would stretch to 180 days and it would consistently rank at the top of any query that mentions soft delete, deletion, or even "flagging records instead of deleting."

---

## Where to go next

| Need | Doc |
|---|---|
| Install locally (zero to running stack in 15 min) | [`docs/QUICKSTART.md`](./QUICKSTART.md) |
| Wire Claude Code, Cursor, or Windsurf | [`docs/CLIENTS.md`](./CLIENTS.md) |
| Operator deploy + pre-launch checklist | [`docs/DEPLOY_CHECKLIST.md`](./DEPLOY_CHECKLIST.md), [`deploy/PRODUCTION.md`](../deploy/PRODUCTION.md) |
| The 12 brain_* MCP tools (schemas, typical flows) | [`docs/MCP_TOOLS.md`](./MCP_TOOLS.md) |
| What can go wrong and how to recover | [`docs/KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) |
| Why these design choices were made | [`docs/APPROACH.md`](./APPROACH.md), [`docs/BLUEPRINT.md`](./BLUEPRINT.md) |
| Honest measurement: NDCG@5, generation uplift | [`docs/VALIDATION.md`](./VALIDATION.md) |
| Auth modes, invite flow, password reset | [`docs/SECURITY.md`](./SECURITY.md) |
| Knowledge ontology (5 types, lifecycle invariants) | [`docs/KNOWLEDGE.md`](./KNOWLEDGE.md) |
| Deployment topology diagram | [`docs/ARCHITECTURE.md §"Deployment topology"`](./ARCHITECTURE.md#deployment-topology) |
