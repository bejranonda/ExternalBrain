# Phase 3 — MCP Server: `apps/mcp-server`

> **Before starting:** Phase 2 checkpoint must be green (unit tests + typecheck passing).
> This is Phase 3 of 6. The MCP server is the gateway that every AI client talks to.
> Its security model is the most critical part of the system — read the invariants
> before writing a single line of auth code.

---

## Agent prompt (copy this verbatim to start Phase 3)

```
Phase 2 is complete (@brain/core unit tests all pass). Now build Phase 3: apps/mcp-server.

This is the MCP gateway — every AI client (Claude Code, Cursor, Windsurf, GitHub Copilot,
etc.) connects here over Bearer-authenticated MCP. Its security invariants are:

INVARIANT A: Every MCP method — including `initialize` — must check Bearer auth.
  A missing or invalid token → HTTP 401 with WWW-Authenticate: Bearer realm="brain-mcp"
  and JSON-RPC error -32001. This is intentional; a 401 on initialize is not a bug.

INVARIANT B: Session-token binding. An HTTP session is bound to the token that created
  it. A request reusing a session ID with a different Bearer token → 401.
  Use crypto.timingSafeEqual for token comparison.

INVARIANT C: Orphan sweeper. Every 5 minutes, evict HTTP sessions older than 30 minutes
  with zero tool calls. Log only the first 8 chars of the session ID.

Implement: transport setup (stdio + HTTP), auth.ts, the 12 brain_* tools, 4 resources,
and job enqueueing. Stop at the Phase 3 checkpoint.

Spec: REBUILD/03-mcp-server.md
```

---

## 3.1 Package layout

```
apps/mcp-server/
  package.json
  src/
    index.ts         — transport setup + server bootstrap
    auth.ts          — token validation, session binding, orphan sweeper
    http-helpers.ts  — request/response helpers for HTTP transport
    resources.ts     — 4 brain:// read-only resources
    jobs.ts          — pg-boss job enqueueing helpers
    tools/
      index.ts                        — tool registry
      brain-start-session.ts
      brain-create-project.ts
      brain-list-projects.ts
      brain-get-active-project.ts
      brain-retrieve-knowledge.ts
      brain-report-session-outcome.ts
      brain-teach-knowledge.ts
      brain-get-user-style.ts
      brain-ask-oracle.ts
      brain-log-event.ts
      brain-find-skill.ts
      brain-session-search.ts
```

```json
// apps/mcp-server/package.json
{
  "name": "mcp-server",
  "scripts": {
    "dev":       "tsx watch src/index.ts",
    "build":     "tsc",
    "start":     "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@brain/core":  "workspace:*",
    "@brain/db":    "workspace:*",
    "@brain/types": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "pg-boss": "^12.0.0",
    "zod":     "^4.0.0"
  }
}
```

---

## 3.2 Transport setup (`src/index.ts`)

Choose transport at startup:

```typescript
const transport = process.env.MCP_TRANSPORT
  ?? (process.env.MCP_SERVER_HTTP_PORT ? "http" : "stdio");

if (transport === "stdio") {
  // stdio: token comes from BRAIN_MCP_TOKEN env var
  // stdout is reserved for JSON-RPC — all logs MUST go to stderr
  runStdio();
} else {
  // HTTP: Streamable HTTP transport on MCP_SERVER_HTTP_PORT (default 3100)
  // Bind to 127.0.0.1 only — never 0.0.0.0
  runHttp();
}
```

**HTTP server routes:**
```
GET  /         — landing page (HTML, no auth)
GET  /health   — { ok: true, transport: "http", sessions: N } (no auth required)
POST /mcp      — JSON-RPC handler (auth required on EVERY method)
```

`MCP_ENABLED=false` → `POST /mcp` returns `503 { error: "mcp_disabled" }`.
`GET /health` always returns 200 regardless of `MCP_ENABLED`.

**Server `initialize` instructions string** — return this in the capabilities response:
```
External Brain connected. House rules:
1. Call brain_get_user_style first to verify connectivity.
2. Call brain_start_session(prompt: <task description>) at the start of each task.
   Phrase as: technology + repo + task shape. Returns relevantKnowledge — apply it.
3. Call brain_report_session_outcome when done. Include learnings (0-5 items).
   Without this call, the brain cannot learn from the session.
4. If a tool returns "Server not initialized": the MCP transport dropped.
   Fix: quit and restart your editor. Retrying in a loop will not recover.
```

---

## 3.3 Auth (`src/auth.ts`)

**Token format:** `bp_` prefix + 256 bits of random hex (64 chars). Stored as SHA-256
in `MCPToken.tokenHash`. Shown to the user exactly once; lost tokens must be re-issued.

```typescript
export interface AuthContext {
  userId:         string;
  teamId:         string | null;
  scope:          string;
  tokenId:        string;
  organizationId: string | null;
  projectId:      string | null;
}

export async function authenticate(rawToken: string | undefined): Promise<AuthContext>
```

**`authenticate` steps:**
1. If `rawToken` is missing or doesn't start with `bp_` → throw `AuthError(401)`
2. Hash: `createHash("sha256").update(rawToken).digest("hex")`
3. `db.mcpToken.findUnique({ where: { tokenHash } })`
4. Reject if: not found, `revokedAt !== null`, `expiresAt` elapsed,
   `scheduledRevokeAt` elapsed
5. `db.mcpToken.update({ lastUsedAt: new Date() })`
6. Return `AuthContext`

**Session-token binding (HTTP transport):**
```typescript
// On first request with a session ID: record Map<sessionId, tokenHash>
// On subsequent requests: timingSafeEqual(stored, incoming) — 401 if mismatch
import { timingSafeEqual, createHash } from "crypto";
```

**Orphan sweeper:**
```typescript
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [sessionId, session] of sessions) {
    if (session.createdAt < cutoff && session.toolCallCount === 0) {
      sessions.delete(sessionId);
      logger.info({ sessionPrefix: sessionId.slice(0, 8) }, "orphan session evicted");
    }
  }
}, 5 * 60 * 1000);
```

**Error response shape:**
```
HTTP 401
WWW-Authenticate: Bearer realm="brain-mcp"
Content-Type: application/json
Body: { "jsonrpc": "2.0", "error": { "code": -32001, "message": "Unauthorized" }, "id": null }
```

---

## 3.4 The 12 tools

Implement each tool in its own file. Register all in `tools/index.ts` as an array. Every
tool handler must:
1. Call `authenticate(bearerFromRequest)` — if it throws, propagate as MCP error
2. Validate input with zod (throw `MCP_INVALID_PARAMS` on failure)
3. Check ownership of referenced resources (`sessionId`, `knowledgeId` → must belong to `auth.userId`)
4. Return typed output

### Tool 1: `brain_start_session`

**Inputs:** `clientType?` (enum, default `"custom"`), `projectId?`, `projectName?` (1–120),
`framework?`, `language?`, `prompt?`

**Logic:**
1. Resolve project: token `projectId` scope → provided `projectId` → provided `projectName`
   (upsert via `ensureNamedProject`) → first user project → `ensureDefaultProject`
2. Create `Session` + `SessionEvent(type:"session_started", payload:{prompt})`
3. If `prompt` provided: call `retrieve(prompt, context, maxItems=5)` (fail-soft — never
   fail the session start just because retrieval failed)
4. Return: `{ sessionId, startedAt, relevantKnowledge?: { knowledgeIds[], injection } }`

### Tool 2: `brain_create_project`

**Inputs:** `name` (1–120), `framework?`, `language?`

**Guard:** project-scoped tokens → `403 FORBIDDEN_PROJECT`

**Logic:** `ensureNamedProject(userId, name, orgId)` (idempotent, case-insensitive slug)

**Returns:** `{ projectId, slug, created: boolean }`

### Tool 3: `brain_list_projects`

**Inputs:** none

**Returns:** `{ projects: [{ id, slug, name, orgId, orgSlug, orgName, framework, language, isOwn, createdAt }] }`

### Tool 4: `brain_get_active_project`

**Inputs:** none

**Returns:** `{ project: { ...fields, source: "token_scope" | "first_project_fallback" } | null }`

The `source` field tells the agent whether the project was pinned by the token or inferred.

### Tool 5: `brain_retrieve_knowledge`

**Inputs:** `prompt` (required), `context?` (`{ sessionId, projectId, framework, language, sessionMode }`),
`maxItems?` (≤20, default 10)

**Returns:** `{ bundle: KnowledgeBundle, injection: string }` where `injection` is the
`formatForInjection(bundle)` output.

### Tool 6: `brain_report_session_outcome`

**Inputs:**
```typescript
{
  sessionId:          string;
  success:            boolean;
  filesCreated:       string[];
  filesModified:      string[];
  filesRejected:      string[];
  knowledgeUsed:      string[];   // IDs of injected knowledge that was actually applied
  buildAttempts:      number;
  errors:             string[];
  userFeedback?:      "up" | "down";
  userFeedbackComment?: string;
  durationMs:         number;
  tokensUsed:         number;
  learnings?:         LearningInput[];  // 0–5 items
}
```

**Logic:**
1. Validate `sessionId` ownership (`session.userId === auth.userId`) → 404 if mismatch
2. Persist `learnings` as `SessionEvent(type:"learning_captured")` entries
3. Close session: `endedAt = now()`, `outcome = success ? "success" : "failed"`, compute SQS
4. Bump confidence on `knowledgeUsed` IDs (they got used → small confidence increment)
5. If `userFeedback` provided: create `Feedback` row
6. Enqueue `kea.extract` + `autoskill.run` (singleton key per session, so idempotent on retry)
7. Return: `{ sqs: number, queued: ["kea.extract", "autoskill.run"], hint?: string }`

**`hint`** appears when: session failed (`success=false`) OR `userFeedback="down"`, AND
no `learnings` were submitted. Value: `"Consider adding learnings to help the brain learn
from this session."` This prompts the agent to call `brain_teach_knowledge`.

### Tool 7: `brain_teach_knowledge`

**Inputs:**
```typescript
{
  type:                    KnowledgeType;
  trigger:                 string;  // ≥5 chars
  rule:                    string;  // ≥10 chars
  rationale?:              string;
  instead?:                string;  // the alternative that was rejected
  scope?:                  "global" | "user" | "project"; // default "user"
  projectId?:              string;
  framework?:              string;
  language?:               string;
  tags:                    string[];
  supersedesKnowledgeId?:  string;
}
```

**Logic:**
1. Create `Knowledge` with `confidence: 1.0`, `extractedBy: "user"`, `confirmedAt: now()`
2. `embed(trigger + "\n" + rule)` → store vector
3. If `supersedesKnowledgeId` provided: call `supersedeKnowledge(db, {newId, supersededId, userId})`
4. If `"decision" in tags`: write `AuditLog(action:"decision.captured")`
5. Return: `{ id, confidence: 1.0 }`

### Tool 8: `brain_get_user_style`

**Inputs:** none

**Returns:**
```typescript
{
  peerCard: string[];    // facts[] from the user's PeerCard (empty array if no card yet)
  reflexes: Array<{
    triggerText: string;
    ruleText: string;
    confidence: number;
    tags: string[];
  }>;                    // top 30 reflexes with confidence ≥ 0.7
}
```

This is the "verify connectivity" bootstrap call. Every agent should call this first.

### Tool 9: `brain_ask_oracle`

**Inputs:** `question` (≥3 chars), `reasoningLevel?` (enum, default `"medium"`)

**Guard:** `ORACLE_ENABLED=false` → `503 oracle_disabled`

**Returns:** `OracleResponse` from `oracle.ask(...)`

### Tool 10: `brain_log_event`

**Inputs:** `sessionId`, `eventType` (enum), `payload: object`, `timestamp?`

**Guard:** `session.userId === auth.userId` → 404 if mismatch

**Returns:** `{ id: string, accepted: true }`

### Tool 11: `brain_find_skill`

**Inputs:** `query` (≥2 chars), `framework?`, `stage?` (enum), `limit?` (≤20, default 5)

**Logic:** embed query → pgvector cosine search over `Skill.embedding` (same visibility
rules as Knowledge) → return ranked results

**Returns:** `{ skills: Skill[] }`

### Tool 12: `brain_session_search`

**Inputs:** `query` (≥2 chars), `limit?` (≤50, default 10)

**Logic:**
```sql
-- Primary: FTS
SELECT s.*, ts_rank_cd(
  to_tsvector('english', COALESCE(s.metadata->>'prompt', '')),
  websearch_to_tsquery('english', $1)
) AS rank
FROM "Session" s
WHERE s."userId" = $2
  AND to_tsvector('english', COALESCE(s.metadata->>'prompt', ''))
      @@ websearch_to_tsquery('english', $1)
ORDER BY rank DESC
LIMIT $3

-- Fallback if FTS returns 0 results:
SELECT * FROM "Session"
WHERE "userId" = $2
  AND metadata->>'prompt' ILIKE '%' || $1 || '%'
LIMIT $3
```

**Returns:** `{ sessions: Session[] }`

---

## 3.5 Resources

Four read-only resources, each user-scoped. Return `{ contents: [{ uri, mimeType: "application/json", text }] }`.

```
brain://user/style-profile    — PeerCard facts + top reflexes (same as brain_get_user_style)
brain://user/active-skills    — user's Skill rows (stage != "inbox")
brain://user/recent-sessions  — last 10 closed sessions with outcomes
brain://user/peer-card        — raw PeerCard row
```

All resources require the same Bearer auth as tools.

---

## 3.6 Job enqueueing (`src/jobs.ts`)

```typescript
import PgBoss from "pg-boss";

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
    await boss.start();
  }
  return boss;
}

export async function enqueueKEAExtract(sessionId: string, userId: string) {
  const b = await getBoss();
  await b.sendOnce(
    "kea.extract",
    { sessionId, userId },
    { key: `kea.extract:${sessionId}` }  // singleton per session
  );
}

export async function enqueueAutoskill(sessionId: string, userId: string) {
  const b = await getBoss();
  await b.sendOnce(
    "autoskill.run",
    { sessionId, userId },
    { key: `autoskill.run:${sessionId}` }
  );
}
```

---

## 3.7 Multi-tenant enforcement

Every mutation must validate ownership before acting:

```typescript
// Pattern for sessionId ownership check
const session = await db.session.findUnique({ where: { id: sessionId } });
if (!session || session.userId !== auth.userId) {
  throw new McpError(ErrorCode.InvalidParams, "Session not found", { code: "NOT_FOUND" });
}

// Pattern for knowledgeId ownership check
const k = await db.knowledge.findUnique({ where: { id: knowledgeId } });
if (!k || k.ownerUserId !== auth.userId) {
  throw new McpError(ErrorCode.InvalidParams, "Knowledge not found", { code: "NOT_FOUND" });
}

// Pattern for bulk knowledge updates — always scope to userId
await db.knowledge.updateMany({
  where: { id: { in: ids }, ownerUserId: auth.userId },  // never omit ownerUserId
  data:  { ... }
});
```

**Project access**: token with `projectId` scope → `FORBIDDEN_PROJECT` (403) when trying
to write to a different project. Use `userCanAccessProject(userId, projectId)` for reads.

---

## Phase 3 checkpoint

```bash
# Start a pgvector Postgres and the MCP server in HTTP mode
export DATABASE_URL="postgresql://brain:brain@localhost:5432/brain"
export MCP_TRANSPORT=http
export MCP_SERVER_HTTP_PORT=3100

# Typecheck
pnpm turbo run typecheck --filter=mcp-server

# Manual auth invariant test
# A: No Bearer → 401
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'
# Expected: 401

# B: With a valid token → tools/list works
TOKEN="bp_yourtokenhere"
curl -s -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: test-session-01" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{}},"id":1}'
# Expected: 200 with serverInfo

# C: Health endpoint (no auth)
curl -s http://localhost:3100/health
# Expected: {"ok":true,"transport":"http","sessions":0}

# D: Full round-trip
# brain_start_session → brain_report_session_outcome (with no learnings)
# → response should include hint field
# → check db: session endedAt is set, kea.extract job enqueued in pgboss.job
```

**Pass criteria:**
- [ ] `typecheck` exits 0
- [ ] `POST /mcp` without Bearer returns HTTP `401`
- [ ] `GET /health` returns `{"ok":true,...}` without auth
- [ ] `initialize` with valid Bearer returns `serverInfo` with instructions string
- [ ] `brain_start_session` creates a Session row in the DB
- [ ] `brain_report_session_outcome` closes the session (`endedAt` set) and enqueues `kea.extract`
- [ ] A second user's `sessionId` is rejected with NOT_FOUND (ownership check works)
- [ ] `brain_ask_oracle` returns a `groundedness` field
- [ ] `brain_get_user_style` returns `{ peerCard: [], reflexes: [...] }` for a new user

**Do not start Phase 4 until all boxes are checked.**

---

## Ready for Phase 4

Open `04-worker.md`.
