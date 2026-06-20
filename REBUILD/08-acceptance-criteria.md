# Acceptance Criteria — Definition of Done

> Run this checklist after completing all 6 phases. A faithful recreation of External
> Brain passes every item below. Items marked **automated** have test coverage in CI.
> Items marked **manual** require browser or shell verification.

---

## How to use this file

```
[ ] = not yet verified
[x] = verified and passing
[~] = partially passing (note the exception)
```

Copy this checklist into your tracking system, mark items as you verify them.
All 9 criteria must be `[x]` before the build is considered complete.

---

## Criterion 1 — Migration gate (automated)

**What it proves:** The database schema is complete, correct, and reproducible from zero.

```bash
# 1a. Fresh pgvector Postgres + migrate
docker run -d --name brain-pg-fresh \
  -e POSTGRES_USER=brain -e POSTGRES_PASSWORD=brain -e POSTGRES_DB=brain \
  -p 5433:5432 pgvector/pgvector:pg16
sleep 3

export DATABASE_URL=postgresql://brain:brain@localhost:5433/brain
pnpm --filter @brain/db exec prisma migrate deploy
# Expected: all migrations applied, exit 0

# 1b. Apply FTS
psql $DATABASE_URL -f packages/db/sql/session-fts-index.sql
# Expected: CREATE INDEX ... (two indexes)

# 1c. Seed
pnpm --filter @brain/db exec prisma db seed
# Expected: { users: 1, orgs: 1, projects: 1, knowledge: 16 }

# 1d. CI gates
pnpm turbo run typecheck
pnpm turbo run test
pnpm turbo run build
# Expected: all exit 0

# 1e. Idempotency: run seed twice
pnpm --filter @brain/db exec prisma db seed
# Expected: no errors, no duplicate rows
```

**Checklist:**
- [ ] `prisma migrate deploy` on a fresh DB exits 0 (automated in CI)
- [ ] FTS SQL applies without error
- [ ] Seed exits 0 and produces exactly 16 Knowledge rows
- [ ] Running seed twice is idempotent
- [ ] `pnpm turbo run typecheck` exits 0 across all packages
- [ ] `pnpm turbo run test` exits 0 (all unit tests)
- [ ] `pnpm turbo run build` exits 0 (all packages)

---

## Criterion 2 — MCP auth invariant (automated + manual)

**What it proves:** The MCP gateway enforces Bearer auth on every method, including
`initialize`. No unauthenticated client can call any tool.

```bash
# Start the MCP server
export MCP_TRANSPORT=http
export MCP_SERVER_HTTP_PORT=3100

# 2a. No Bearer → 401
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}')
echo "Expected 401, got: $STATUS"

# 2b. Wrong Bearer → 401
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer bp_invalid_token_here" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}')
echo "Expected 401, got: $STATUS"

# 2c. Valid Bearer → 200 with serverInfo
TOKEN="bp_<your_valid_token>"
RESPONSE=$(curl -s -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: accept-test-01" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{}},"id":1}')
echo "$RESPONSE" | jq '.result.serverInfo'
# Expected: { name: "brain", ... }

# 2d. Full round-trip: start_session → report_outcome
SESSION=$(curl -s -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: accept-test-01" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"brain_start_session","arguments":{"prompt":"test session for acceptance criteria"}},"id":2}')
SESSION_ID=$(echo "$SESSION" | jq -r '.result.content[0].text' | jq -r '.sessionId')
echo "SessionId: $SESSION_ID"

curl -s -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: accept-test-01" \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"params\":{\"name\":\"brain_report_session_outcome\",\"arguments\":{\"sessionId\":\"$SESSION_ID\",\"success\":true,\"filesCreated\":[],\"filesModified\":[],\"filesRejected\":[],\"knowledgeUsed\":[],\"buildAttempts\":0,\"errors\":[],\"durationMs\":1000,\"tokensUsed\":100}},\"id\":3}"
```

**Checklist:**
- [ ] `POST /mcp` with no Bearer returns HTTP `401` (automated)
- [ ] `POST /mcp` with an invalid/revoked token returns HTTP `401` (automated)
- [ ] `initialize` with a valid token returns `serverInfo` with instructions (manual)
- [ ] `brain_start_session` creates a `Session` row in the DB (manual)
- [ ] `brain_report_session_outcome` sets `endedAt` + `outcome` on the session (manual)
- [ ] A `kea.extract` job appears in `pgboss.job` after report (manual)
- [ ] `GET /health` returns 200 with no auth (automated via smoke.sh)

---

## Criterion 3 — Knowledge flywheel closes (manual)

**What it proves:** The complete loop works — session close → KEA extraction → embeddings
backfill → retrieval injects relevant knowledge into the next session.

```bash
# After running criterion 2's round-trip:

# 3a. Wait for kea.extract to drain (or trigger manually)
sleep 30  # or watch pgboss.job until completedon is set

# 3b. Verify Knowledge row was created
psql $DATABASE_URL -c "
  SELECT id, type, \"triggerText\", confidence
  FROM \"Knowledge\"
  WHERE 'seed' != ANY(tags)
  ORDER BY \"createdAt\" DESC LIMIT 5;
"
# Expected: at least 0 rows (KEA may find nothing in a trivial test session)

# To force KEA to create knowledge: run a session with learnings
# brain_report_session_outcome with learnings: [{
#   trigger: "When testing acceptance criteria",
#   rule: "Always verify the full feedback loop closes, not just individual components",
#   rationale: "End-to-end integration is different from unit behavior",
#   type: "heuristic",
#   source: "user_correction"
# }]

# 3c. Verify NULL embeddings get backfilled
psql $DATABASE_URL -c "
  SELECT COUNT(*) as total, COUNT(embedding) as with_embedding
  FROM \"Knowledge\"
  WHERE \"deletedAt\" IS NULL;
"
# Expected: with_embedding count increases after the backfill cron runs

# 3d. Verify retrieval works end-to-end
# Run brain_start_session with a prompt similar to the learnings above
# Response should include relevantKnowledge with the newly extracted rule
```

**Checklist:**
- [ ] Worker drains `kea.extract` jobs (completedon set in pgboss)
- [ ] KEA persists typed Knowledge rows when learnings are submitted
- [ ] `embeddings.backfill` fills NULL embedding columns (verified via psql)
- [ ] A subsequent `brain_start_session` with a relevant prompt returns `relevantKnowledge`
- [ ] The injected knowledge is semantically relevant to the prompt (not random)

---

## Criterion 4 — Oracle grounding (manual)

**What it proves:** The Oracle returns cited, grounded answers and meters cost.

```bash
# Run brain_ask_oracle with a question about something in the seed knowledge
RESPONSE=$(curl -s -X POST http://localhost:3100/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: accept-test-01" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"brain_ask_oracle","arguments":{"question":"What are the key rules for pgvector embedding setup?"}},"id":4}')
echo "$RESPONSE" | jq '.result.content[0].text'
# Expected: JSON with answer containing [^K1] citations, groundedness field, confidence
```

**Checklist:**
- [ ] `brain_ask_oracle` returns an answer (non-empty string)
- [ ] Answer contains `[^K1]` or `[^S1]` citation markers
- [ ] Response includes `groundedness` field (`"strong"`, `"moderate"`, `"weak"`, or `"none"`)
- [ ] Response includes `confidence` field (`"high"`, `"medium"`, or `"low"`)
- [ ] Response includes `citations[]` array with `knowledgeId` or `sessionId` references
- [ ] `OracleCostLedger` has a row for the user+day after the Oracle call (psql check)
- [ ] A second Oracle call after the per-day cap is exceeded returns `OracleCapExceededError`

---

## Criterion 5 — Tenant isolation (automated)

**What it proves:** No user can see another user's knowledge, sessions, or skills.

These tests must run as part of `pnpm turbo run test`. Implement them in
`packages/core/src/__tests__/isolation.test.ts` or `apps/web/src/__tests__/isolation.test.ts`.

```typescript
// Cross-tenant isolation test
describe("Multi-tenant isolation", () => {
  let userA: { id: string };
  let userB: { id: string };
  let knowledgeA: { id: string };

  beforeAll(async () => {
    // Create two separate users with separate knowledge
    userA = await createTestUser("user-a@test.com");
    userB = await createTestUser("user-b@test.com");
    knowledgeA = await db.knowledge.create({
      data: { ownerUserId: userA.id, triggerText: "User A private rule", ruleText: "This belongs to User A only", type: "reflex", scope: "user" }
    });
  });

  it("userB cannot retrieve userA knowledge via KRA", async () => {
    // Create a session context as userB
    const context = { sessionId: "test", userId: userB.id };
    const bundle = await retrieve("User A private rule", context);
    const allIds = [
      ...bundle.reflexes,
      ...bundle.recipes,
      ...bundle.heuristics,
      ...bundle.principles,
      ...bundle.antiPrinciples,
    ].map(k => k.id);
    expect(allIds).not.toContain(knowledgeA.id);
  });

  it("userB cannot access userA knowledge via API", async () => {
    const response = await fetch(`/api/knowledge/${knowledgeA.id}`, {
      headers: { Authorization: `Bearer ${userBToken}` }
    });
    expect(response.status).toBe(404);
  });

  it("userB cannot close userA session via MCP", async () => {
    const sessionA = await db.session.create({
      data: { userId: userA.id, clientType: "custom" }
    });
    // Try to report outcome as userB
    const result = await mcpCall("brain_report_session_outcome", {
      sessionId: sessionA.id,
      success: true,
      // ... other required fields
    }, userBAuthContext);
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
```

**Checklist:**
- [ ] User B cannot retrieve User A's knowledge via KRA (unit test)
- [ ] User B gets 404 on User A's knowledge via the API (integration test)
- [ ] User B cannot close User A's MCP session (unit test)
- [ ] Cross-tenant tests run as part of `pnpm turbo run test` (automated in CI)
- [ ] `pgvector` queries always include `ownerUserId` filter (code review)

---

## Criterion 6 — Secure-by-default (automated)

**What it proves:** An unconfigured instance is locked; `verify-lockdown.sh` passes for
the chosen auth mode.

```bash
# 6a. Test secure-by-default: comment out auth vars in .env, restart web
# Then:
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/knowledge
# Expected: 503

# 6b. Restore auth vars, restart web
# Then run the lockdown audit:
./scripts/verify-lockdown.sh
# Expected: "PASS: Lockdown audit passed"

# 6c. Verify no 0.0.0.0 bindings (except Caddy in edge profile)
docker compose ps
# All services except caddy should show 127.0.0.1:XXXX->XXXX/tcp
```

**Checklist:**
- [ ] With no auth vars set, web returns `503 auth_not_configured` on all protected routes
- [ ] `verify-lockdown.sh` exits 0 (PASS) with credentials auth configured
- [ ] `/api/knowledge` returns 401/403/503 (never 200) without authentication
- [ ] `POST /mcp` without Bearer returns 4xx (never 200) — for all methods
- [ ] No service is bound to `0.0.0.0` except Caddy (in edge profile)
- [ ] `scripts/verify-lockdown.sh` is part of the deploy pipeline (`deploy.sh` hard gate)

---

## Criterion 7 — Decay and decision semantics (automated)

**What it proves:** Knowledge degrades appropriately over time; decisions are permanent;
duplicates merge.

```bash
# Unit tests cover this — run:
pnpm turbo run test --filter=@brain/core
# Look for decay.test.ts and evolution.test.ts passing
```

**Checklist:**
- [ ] `decayUnused()` reduces `decayScore` for old, unused knowledge (unit test)
- [ ] `decayUnused()` does NOT modify knowledge tagged `decision` (unit test)
- [ ] `decayScore` never drops below `0.05` (floor assertion in unit test)
- [ ] Half-life is 45 days for low-effectiveness rules (effectiveness < 0.3, ≥5 outcomes)
- [ ] Half-life is 180 days for high-effectiveness rules (effectiveness ≥ 0.7)
- [ ] `consolidateDuplicates()` merges pairs with cosine > 0.92 (same type, same owner)
- [ ] On merge: older row survives, younger is soft-deleted, confidence += 0.02
- [ ] Rows with `"decision"` tag are exempt from decay (checked in decay job handler)

---

## Criterion 8 — Snippet correctness (automated)

**What it proves:** The install snippet generators produce valid config for every client,
including the two silent-failure traps.

```bash
# These tests MUST exist and MUST pass in @brain/core unit tests:
pnpm turbo run test --filter=@brain/core -- --reporter=verbose
# Look for install-snippets.test.ts
```

**The two mandatory test assertions** (from `02-core-intelligence.md`):

```typescript
it("antigravity uses serverUrl not url", () => {
  const snippet = generateAntigravity("bp_test", "https://brain.example.com/mcp");
  const config = JSON.parse(snippet.lines.join("\n"));
  expect(config.mcpServers.brain.serverUrl).toBeDefined();
  expect(config.mcpServers.brain.url).toBeUndefined();
});

it("githubCopilotJetbrains uses requestInit.headers for auth", () => {
  const snippet = generateGithubCopilotJetbrains("bp_test", "https://brain.example.com/mcp");
  const config = JSON.parse(snippet.lines.join("\n"));
  expect(config.servers.brain.requestInit.headers.Authorization).toMatch(/^Bearer bp_test$/);
  expect(config.servers.brain.headers).toBeUndefined();
});
```

**Checklist:**
- [ ] `antigravity` snippet uses `serverUrl` (not `url`) — automated unit test
- [ ] `githubCopilotJetbrains` snippet uses `requestInit.headers` (not `headers`) — automated unit test
- [ ] All 11 snippet generators return parseable JSON or valid shell (automated)
- [ ] Token appears in the correct location for each client (reviewed manually)
- [ ] `claudeCodeCli` generates a `curl .../api/onboard.sh | bash` command
- [ ] `githubCopilotVscode` uses the `servers` top-level key (not `mcpServers`)

---

## Criterion 9 — Stack up (manual)

**What it proves:** The full Docker Compose stack starts from zero, the operator can
complete the day-one workflow.

```bash
# Fresh environment
cp .env.example .env
# Edit .env: add DATABASE_URL, at least one LLM key, and ADMIN auth vars

./scripts/dev-up.sh
# Expected: exits 0, prints "External Brain is running"

# Verify endpoints
curl -sf http://localhost:3000/api/healthz | jq .
# Expected: { ok: true, version: "...", timestamp: "..." }

curl -sf http://localhost:3100/health | jq .
# Expected: { ok: true, transport: "http", sessions: 0 }
```

**Day-one workflow:**
1. Open `http://localhost:3000/` in a browser
2. Sign in with the admin credentials
3. Navigate to `/settings/tokens`
4. Create a new MCP token → copy the raw `bp_...` value
5. Navigate to the "Install wizard" tab
6. Select your AI client (e.g. Claude Code)
7. Follow the install instructions
8. Verify the client connects (test via `brain_get_user_style`)
9. Run a coding task and close the session with `brain_report_session_outcome`
10. Navigate to the Skills/Knowledge screens and verify the extracted knowledge appears

**Checklist:**
- [ ] `dev-up.sh` completes without errors
- [ ] Web app accessible at `http://localhost:3000`
- [ ] MCP server accessible at `http://localhost:3100/mcp`
- [ ] Sign in works with the admin credentials
- [ ] Token creation works; raw token shown exactly once
- [ ] Install wizard renders snippets for at least 3 clients
- [ ] At least one AI client can connect and call `brain_get_user_style`
- [ ] Skills screen shows ≥16 seed skills after sign-in
- [ ] Oracle answers a question with citations
- [ ] `verify-lockdown.sh` exits 0 (PASS)
- [ ] `./scripts/reload.sh web` rebuilds and restarts web without database restart

---

## Sign-off

```
Criteria passed: [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7 [ ] 8 [ ] 9

Date verified: _______________
Verified by:   _______________
Branch/commit: _______________
```

All 9 criteria passing = External Brain is fully rebuilt and production-ready.

---

## First agent prompt (use this to start Phase 1)

```
We are building the External Brain platform from scratch in this empty git repository.
It is an MCP server + webapp that gives AI coding tools persistent memory.

Start with Phase 1. Read REBUILD/00-START-HERE.md to understand the project, then
read REBUILD/01-foundation.md for the complete Phase 1 spec.

Build in this exact order:
1. Monorepo scaffold (pnpm + Turborepo)
2. @brain/types (pure TypeScript, zero runtime deps)
3. @brain/db (Prisma 7, full schema including pgvector embedding columns, raw-SQL helpers,
   FTS index SQL file, and the deterministic seed with 16 knowledge rows)

After each piece, run typecheck. After the schema, run prisma migrate deploy against a
fresh pgvector Postgres and show me the output. Stop there and confirm the Phase 1
checkpoint passes before I hand you Phase 2.

Honor every Invariant callout in the spec — they are non-negotiable.
```
