# Pass 2 — MCP & Multi-Tenancy Security Audit

**Role:** Lead Application Security Engineer (MCP + enterprise SaaS)
**Scope:** `apps/mcp-server`, `packages/core`, `apps/web/app/api`
**Baseline:** `202fe7a` (`v2.7.1`), branch `main`, 2026-08-02.

## Method & honesty statement

Static audit; no exploitation was attempted against any running instance.

- ✅ **Performed:** enumeration of all 58 API route handlers against their auth
  imports; full read of the MCP HTTP transport gate, `authenticate()`, all 12
  tool handlers and the 4 resources; trace of every `$queryRaw*` site in
  `packages/core` and `apps/`; read of the pgvector filter builders and the
  actual SQL they produce; secret-pattern sweep across `ts/tsx/yml/sh/json`.
- ⬜ **Not performed (reviewer must do):** live exploitation of H-1 against a
  running MCP server, and a runtime check of M-1. Both are 5-minute `curl`
  checks and I have written the exact commands below.

One finding (**M-1**) is marked **PLAUSIBLE** rather than confirmed because it
depends on Prisma driver behaviour I could not execute. It is labelled as such
in place; everything else is read directly off the code.

---

## Findings

| ID | Severity | Finding |
|---|---|---|
| **H-1** | **[HIGH]** | `initialize` / `tools/list` / `resources/list` accept **any** syntactically-valid Bearer — no DB validation. Capability disclosure + unauthenticated session allocation. |
| **H-2** | **[HIGH]** | MCP token **project scope is enforced on writes but ignored on every read**. A project-scoped token reads the user's entire Brain. |
| **M-1** | [MEDIUM] | `brain_find_skill` passes 3 SQL parameters to a 2-parameter statement whenever `stage` is omitted. *(PLAUSIBLE — needs a runtime check.)* |
| **M-2** | [MEDIUM] | No rate limiting of any kind on the MCP server. |
| **M-3** | [MEDIUM] | `authenticate()`'s user-facing error hardcodes the placeholder domain `https://brain.example`. |
| **M-4** | [MEDIUM] | `LIMIT ${…}` string-interpolated into four raw SQL statements. |
| **L-1** | [LOW] | Each tool maintains its JSON Schema and its Zod schema by hand — silent drift. `find-skill`'s `framework` is accepted and ignored. |
| **L-2** | [LOW] | `authenticate()` writes `lastUsedAt` on every request — a DB write per MCP call. |

### Verified clean — do not spend review time here

These were checked and are correct. Stating them explicitly so the reviewer can
skip them:

- **No unauthenticated API routes.** All 58 handlers under
  `apps/web/app/api` were classified. Nine are public, every one intentionally:
  `auth/[...nextauth]`, `auth/register`, `auth/forgot-password`,
  `auth/reset-password`, `invites/signup`, `healthz`, `readyz`, `onboard.sh`,
  `onboard.ps1`, `skills/brain`. The remaining 49 import `getCurrentUserId`,
  `requireAdmin`, or `withApi`.
- **Admin routes are role-gated, not merely authenticated.** `requireAdmin()`
  (`lib/brain/admin-auth.ts`) re-reads `user.role` from the DB per call and
  throws `AuthError(403)`; `app/admin/layout.tsx:27-31` does the same and
  redirects to `/` rather than revealing the surface exists.
- **No hardcoded secrets.** The pattern sweep returned only test fixtures
  (`bp_testtoken1234567890ABCDEF`, `"hunter2"` in a **redaction** test),
  `localStorage` keys, and UI copy. `verify-lockdown.sh` reads `AUTH_SECRET`
  from `.env` rather than embedding it.
- **Structured-log redaction works.** `packages/core/src/logger.ts:82-118`
  redacts `password`, `token`, `brain_mcp_token`, and strips
  `authorization` / `cookie` / `x-api-key` from Sentry request headers.
- **Session hijack is already defended.** `index.ts:326-347` binds each MCP
  session to its bootstrap token and compares with `timingSafeEqual` behind a
  length pre-check.
- **`supersedeKnowledge` is owner-scoped** (`knowledge-stats.ts:49-57`) — a
  caller cannot retire another user's row by guessing its id.
- **User-supplied text never reaches SQL by concatenation.** Every FTS and
  vector query binds it positionally (`$1`, `$2`).

---

## H-1 — [HIGH] Unauthenticated capability disclosure + session allocation

**Where:** `apps/mcp-server/src/index.ts:279-314`, `:95-109`, `:146-148`

### The gap

The HTTP gate checks only that a Bearer is **present**:

```ts
// apps/mcp-server/src/index.ts:279,293
const token = extractBearer(req);
…
if (!token) { …401… }
```

The comment above it is explicit that this is deliberate — *"The token itself is
validated against the DB by `authenticate()` when the first authenticated method
runs; this gate just refuses the obviously-unauthenticated case cheaply."*

But only **two** handlers call `authenticate()`:

| Handler | `authenticate()`? | Line |
|---|---|---|
| `CallToolRequestSchema` | ✅ | `:112` |
| `ReadResourceRequestSchema` | ✅ | `:151` |
| `ListToolsRequestSchema` | ❌ | `:95` |
| `ListResourcesRequestSchema` | ❌ | `:146` |
| `initialize` (SDK transport) | ❌ | — |

So `Bearer x` — 1 character, never issued, not in the database — reaches
`initialize`, allocates a real `Server` + `StreamableHTTPServerTransport`, and
returns `serverInfo` plus a session id. That session id then satisfies the
`timingSafeEqual` check at `:326` (it is compared against the *same* garbage
string), so `tools/list` and `resources/list` return the full catalogue.

### Why this matters

**It defeats the stated objective of the gate.** `:283-289` says the strict-auth
override exists precisely because unauthenticated `initialize` *"leaks
`serverInfo.name` + `version` to anyone who can reach the endpoint"*. That leak
is still fully reachable — the check moved the bar from "no header" to "any
header", which is not a bar.

What an unauthenticated attacker gets: server name and version (version-pinned
CVE targeting), the complete tool catalogue with descriptions and input schemas
(`:103-107`), and the resource URI list — i.e. a full map of the attack surface
before spending a single credential.

**And it is an unauthenticated memory-growth primitive.** Every `initialize`
allocates a `Session` in an in-memory `Map` (`:182`) with **no cap on entries and
no per-IP limit** (see M-2). The orphan sweeper (`:196-215`) only evicts sessions
older than **30 minutes** with zero tool calls, and runs every 5 minutes — so a
sprayer holds every session it opens for up to 35 minutes. `/health` returns
`sessions.size` unauthenticated (`:224`), handing the attacker a live progress
meter.

### The test that looks like it covers this does not

`apps/web/e2e/security.spec.ts:129-142` sends `tools/list` with
`Bearer bp_definitely_not_a_real_token_abcdef` and asserts `status >= 400`. It
passes — but **for the wrong reason**: the request carries no `Mcp-Session-Id`
and no prior `initialize`, so the SDK rejects it with `-32000 "Server not
initialized"`. The bearer is never consulted. The assertion cannot distinguish
"rejected for bad auth" from "rejected for no session", so it verifies neither.

⬜ **Reviewer: confirm in 30 seconds.**

```bash
curl -sD- -X POST "$MCP_URL" \
  -H 'Authorization: Bearer x' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

A `200` with an `Mcp-Session-Id` header and a `serverInfo` body confirms H-1.

### Patch

Validate the token **once, at session creation**. This keeps the per-request cost
identical for established sessions — they are already bound to the validated
bootstrap token by the `timingSafeEqual` check — while closing both the
disclosure and the allocation primitive.

```diff
--- a/apps/mcp-server/src/index.ts
+++ b/apps/mcp-server/src/index.ts
@@ -345,6 +345,34 @@
     }
     if (!session) {
+      // Validate the bearer against the DB BEFORE allocating a transport.
+      // The presence-only gate above stops the no-header case cheaply, but
+      // any syntactically-valid string reached `initialize` and got back
+      // serverInfo + the tool catalogue + a live session — defeating the
+      // stated goal of the strict-auth override, and giving an anonymous
+      // caller an unbounded way to grow the `sessions` map (evicted only
+      // after 30 min by the orphan sweeper). Established sessions are NOT
+      // re-validated here: they are already pinned to this same token by
+      // the timingSafeEqual check above, so the per-request cost is
+      // unchanged for real clients.
+      try {
+        await authenticate(token);
+      } catch {
+        res.writeHead(401, {
+          "content-type": "application/json",
+          "www-authenticate": 'Bearer realm="brain-mcp"',
+        });
+        res.end(
+          JSON.stringify({
+            jsonrpc: "2.0",
+            error: { code: -32001, message: "Invalid or expired token" },
+            id: null,
+          }),
+        );
+        log.warn(
+          { op: "mcp.auth.reject", tokenPrefix: token.slice(0, 8) },
+          "rejected session bootstrap with an invalid bearer",
+        );
+        return;
+      }
+
       const counter: CallCounter = { n: 0, lists: 0 };
       const server = buildServer(counter);
```

Defence in depth — authenticate the two list handlers too, so the stdio transport
and any future code path are covered by the same rule:

```diff
@@ -93,8 +93,9 @@
-  server.setRequestHandler(ListToolsRequestSchema, async () => {
+  server.setRequestHandler(ListToolsRequestSchema, async () => {
+    await authenticate(currentToken());
     counter.lists++;
@@ -145,7 +146,10 @@
-  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
-    resources,
-  }));
+  server.setRequestHandler(ListResourcesRequestSchema, async () => {
+    await authenticate(currentToken());
+    return { resources };
+  });
```

And replace the false-confidence test with one that can only pass for the right
reason:

```diff
--- a/apps/web/e2e/security.spec.ts
+++ b/apps/web/e2e/security.spec.ts
@@ -129,15 +129,23 @@
-  test("MCP HTTP transport refuses a bogus Bearer token", async () => {
+  // Must be `initialize`, not `tools/list`: a session-less `tools/list` is
+  // rejected by the SDK for "Server not initialized" regardless of the
+  // bearer, so it would pass even with auth removed entirely.
+  test("MCP HTTP transport refuses `initialize` with a bogus Bearer token", async () => {
     const ctx = await pwRequest.newContext();
     try {
       const res = await ctx.post(`${MCP_URL}/mcp`, {
         headers: {
           "content-type": "application/json",
+          accept: "application/json, text/event-stream",
           Authorization: "Bearer bp_definitely_not_a_real_token_abcdef",
         },
-        data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
+        data: {
+          jsonrpc: "2.0", id: 1, method: "initialize",
+          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1" } },
+        },
       });
-      expect(res.status()).toBeGreaterThanOrEqual(400);
+      expect(res.status()).toBe(401);
+      expect(res.headers()["mcp-session-id"]).toBeUndefined();
+      expect(await res.text()).not.toContain("serverInfo");
     } finally {
       await ctx.dispose();
     }
   });
```

---

## H-2 — [HIGH] Token project-scope is enforced on writes, ignored on reads

**Where:** `apps/mcp-server/src/tools/retrieve.ts:52-65`, `oracle.ts:29-33`,
`find-skill.ts:30-50`, `session-search.ts:22-105`, `resources.ts:36-45`

`AuthContext` carries `organizationId` and `projectId` (`auth.ts:16-17`), and the
product exposes a UI for setting them (`app/api/tokens/[id]/scope/route.ts`). The
enforcement is split cleanly down the read/write line — and the wrong half is
enforced:

| Tool | Honours `auth.projectId`? | Evidence |
|---|---|---|
| `brain_start_session` | ✅ rejects foreign `projectId` | `start-session.ts:90-91` |
| `brain_teach_knowledge` | ✅ rejects foreign `projectId` | `teach.ts:70-71` |
| `brain_create_project` | ✅ refuses on a scoped token | `create-project.ts:56` |
| `brain_list_projects` | ✅ filters to the scope | `list-projects.ts:35-37` |
| `brain_get_active_project` | ✅ | `get-active-project.ts:34-36` |
| **`brain_retrieve_knowledge`** | ❌ takes `projectId` from *client input* | `retrieve.ts:59` |
| **`brain_ask_oracle`** | ❌ `auth.projectId` never referenced | `oracle.ts:30` |
| **`brain_find_skill`** | ❌ no project predicate at all | `find-skill.ts:41-43` |
| **`brain_session_search`** | ❌ no project predicate at all | `session-search.ts:45,93` |
| **all 4 `brain://` resources** | ❌ `auth.userId` only | `resources.ts:38-44` |

`retrieve.ts` is the sharpest case — it takes the project from the caller and
never compares it to the token's own scope:

```ts
// apps/mcp-server/src/tools/retrieve.ts:56-63
{
  sessionId: input.context.sessionId ?? "",
  userId: auth.userId,
  projectId: input.context.projectId,   // ← client-controlled, never checked
                                        //   against auth.projectId
  …
}
```

**Blast radius — the good news first.** This is **not** a cross-tenant leak. I
traced the SQL and both vector paths are hard-pinned to the owner *outside* the
visibility filter:

```sql
-- packages/core/src/kra.ts:186-188
WHERE embedding IS NOT NULL
  AND "decayScore" > 0.3
  AND "ownerUserId" = $2   ← outer pin, ANDed with everything below
```

```sql
-- packages/core/src/oracle.ts:152
WHERE "ownerUserId" = $2
```

This matters because `buildRawProjectFilterV2`'s org-sharing arm deliberately
carries **no** owner predicate (`scope-filter.ts:437` —
`("visibility" = 'project' AND "ownerProjectId" = $pProject)`), exactly as its
docblock at `:51-54` describes. On its own that clause would return any project
member's rows for an attacker-supplied `ownerProjectId`. The outer
`"ownerUserId" = $2` in both call sites is the only thing standing between that
clause and a cross-tenant read. It holds today — but the safety of the whole
tenancy model rests on one predicate in two `$queryRawUnsafe` templates, with no
test pinning it. That is worth a regression test in its own right.

**The actual impact** is confinement failure *within* one user's Brain: a token
minted and labelled "scoped to project X" can retrieve knowledge, run the Oracle,
find skills and search sessions across **all** of that user's projects. An
operator who hands a contractor a project-scoped token is relying on a boundary
that four of the twelve tools do not implement. The feature is, on the read side,
decorative.

### Patch

Enforce the token scope at the tool boundary, matching the pattern `teach.ts` and
`start-session.ts` already use:

```diff
--- a/apps/mcp-server/src/tools/retrieve.ts
+++ b/apps/mcp-server/src/tools/retrieve.ts
@@ -51,10 +51,21 @@
   handler: async (raw, auth) => {
     const input = inputShape.parse(raw);
+    // Honour the token's project scope on the READ path too. Write tools
+    // (teach, start_session) have always rejected a foreign projectId;
+    // retrieval did not, so a token labelled "scoped to project X" could
+    // read every project the user owns. Not a cross-tenant leak — kra.ts
+    // hard-pins "ownerUserId" — but the scope is a promise we make in the
+    // token UI, and it has to hold on both sides.
+    if (auth.projectId !== null) {
+      if (input.context.projectId && input.context.projectId !== auth.projectId) {
+        throw new Error("FORBIDDEN_PROJECT: this token is scoped to a different project");
+      }
+    }
+    const effectiveProjectId = auth.projectId ?? input.context.projectId;
     const bundle = await kra.retrieve(
       input.prompt,
       {
         sessionId: input.context.sessionId ?? "",
         userId: auth.userId,
-        projectId: input.context.projectId,
+        projectId: effectiveProjectId,
         framework: input.context.framework,
```

`oracle.ts`, `find-skill.ts` and `session-search.ts` need the equivalent — the
latter two by adding an `ownerProjectId` / `projectId` predicate to their SQL when
`auth.projectId !== null`. `cross-user-isolation.test.ts` already has the exact
shape to copy: it asserts `FORBIDDEN_PROJECT` for `start_session` (`:220`) and
`teach_knowledge` (`:229`); add the four read tools to that file.

### Related — org knowledge sharing does not work over MCP

`retrieve.ts` passes no `accessibleProjectIds`, so `kra.retrieve` defaults it to
`[]` (`kra.ts:150`) and takes the `accessibleProjectIds.length === 0` branch
(`scope-filter.ts:423-429`). Together with the `ownerUserId = $2` pin, **every MCP
read is owner-only** — a teammate's `visibility: 'org'` knowledge is never
returned through MCP, only through the webapp.

This fails *safe*, so it is not a vulnerability. But Phase 4 org visibility is a
shipped feature that silently does not apply to the primary product surface, and
a reviewer reading `scope-filter.ts` would reasonably assume otherwise. Worth an
explicit decision: either wire `getAccessibleProjectIds()` into the MCP path, or
document that MCP reads are owner-only by design.

---

## M-1 — [MEDIUM, PLAUSIBLE] `brain_find_skill` binds 3 params to a 2-param statement

**Where:** `apps/mcp-server/src/tools/find-skill.ts:34-50`

```ts
`… AND "ownerUserId" = $2
   ${input.stage ? `AND stage = $3` : ""}   ← $3 disappears when stage is absent
 …`,
toVector(vec),
auth.userId,
input.stage,                                 ← but is still passed
```

`stage` is `.optional()` with no default (`:9`), so the common call —
`brain_find_skill({ query: "…" })` — produces SQL declaring `$1`/`$2` while
passing three values. PostgreSQL rejects a bind with more parameters than the
statement declares (`bind message supplies 3 parameters, but prepared statement
requires 2`).

**Marked PLAUSIBLE, not confirmed:** I could not execute it, and Prisma may drop
a trailing `undefined` before it reaches the driver. If it does, the tool works
and this is cosmetic. If it does not, `brain_find_skill` is broken for every call
that omits `stage`, surfacing to the agent as `Error: …` via the `isError` path
at `index.ts:138-142`.

⬜ **Reviewer: `brain_find_skill({query: "test"})` against any instance settles
it.** The fix is correct either way:

```diff
--- a/apps/mcp-server/src/tools/find-skill.ts
+++ b/apps/mcp-server/src/tools/find-skill.ts
@@ -31,7 +31,10 @@
   handler: async (raw, auth) => {
     const input = inputShape.parse(raw);
     const vec = await embedding.embed(input.query);
+    // Keep the bound-parameter list in lockstep with the placeholders that
+    // actually appear in the SQL — an omitted `stage` removes $3 from the
+    // statement, so it must not be bound either.
+    const params: unknown[] = [toVector(vec), auth.userId];
+    if (input.stage) params.push(input.stage);
 
     const rows = await db.$queryRawUnsafe<
       Array<{ id: string; skillId: string; title: string; similarity: number }>
@@ -44,9 +47,7 @@
       LIMIT ${input.limit}
       `,
-      toVector(vec),
-      auth.userId,
-      input.stage,
+      ...params,
     );
```

---

## M-2 — [MEDIUM] No rate limiting on the MCP server

`apps/web/proxy.ts:22` declares `matcher: ["/api/:path*"]` — the rate limiter
covers the **webapp only**. `apps/mcp-server` has no equivalent: no per-IP limit,
no per-token limit, no cap on `sessions.size`.

Consequences: unthrottled bearer guessing against `authenticate()`; unthrottled
session allocation (the amplifier behind H-1); and an authenticated token can
drive `brain_ask_oracle` — a **billed** LLM call — as fast as the network allows.
`packages/core/src/cost.ts` has a `reserveCapSlot` spend cap, which bounds the
money but not the load.

`rateLimitCheck` and the Redis-backed `Store` already exist in `@brain/core` and
are consumed by `proxy.ts`; the fix is wiring, not new machinery. Gate on the
token id after the H-1 validation lands, and on the source IP before it.

---

## M-3 — [MEDIUM] Placeholder domain in a user-facing auth error

```ts
// apps/mcp-server/src/auth.ts:23-27
throw new Error(
  "Missing BRAIN_MCP_TOKEN. Create one at https://brain.example/settings/tokens",
);
```

`brain.example` is not the operator's host. A user hitting this — a first-run
misconfiguration, exactly when they most need a correct pointer — is sent to a
domain that does not resolve. Every other surface in the codebase derives this
from env (`publicUrlsFromEnv()`, `lib/brain/skill-template.ts:139`).

```diff
--- a/apps/mcp-server/src/auth.ts
+++ b/apps/mcp-server/src/auth.ts
@@ -20,9 +20,13 @@ export async function authenticate(
   if (!rawToken) {
+    // Never hardcode a hostname in operator-facing copy — this deployment's
+    // host is the only one the user can act on.
+    const host = process.env.BRAIN_PUBLIC_HOSTNAME?.trim();
+    const where = host ? `https://${host}/settings/tokens` : "your Brain's /settings/tokens page";
     throw new Error(
-      "Missing BRAIN_MCP_TOKEN. Create one at https://brain.example/settings/tokens",
+      `Missing BRAIN_MCP_TOKEN. Create one at ${where}`,
     );
   }
```

---

## M-4 — [MEDIUM] `LIMIT ${…}` interpolated into raw SQL

Four sites build `LIMIT` by string interpolation inside `$queryRawUnsafe`:

| Site | Value | Currently safe because |
|---|---|---|
| `kra.ts:190` | `limit` | defaults to the `CANDIDATE_POOL_SIZE` constant |
| `find-skill.ts:45` | `input.limit` | `z.number().int().min(1).max(20)` |
| `session-search.ts:66` | `input.limit` | `z.number().int().min(1).max(50)` |
| `session-search.ts:101` | `input.limit` | same |

**No injection exists today** — Zod's `.int()` guarantees a number reaches the
template. But the safety of a raw-SQL statement is carried entirely by a
validator three files away, with nothing at the SQL site saying so. Dropping
`.int()` during a refactor, or adding a fifth caller that forwards a REST query
param, turns any of these into injection with no local signal.

Bind it instead, and the class of bug disappears:

```diff
--- a/apps/mcp-server/src/tools/session-search.ts
+++ b/apps/mcp-server/src/tools/session-search.ts
@@
-      LIMIT ${input.limit}
+      LIMIT $3
       `,
       auth.userId,
       input.query,
+      input.limit,
```

`kra.ts:190` is the one to leave alone if you prefer — its value is a
module-level constant, not caller data.

---

## Input & schema sanitization

**Zod coverage is complete.** All 11 tools that accept input declare a
`z.object` and call `.parse()` on the raw arguments as the first statement of the
handler. `style.ts` and the dispatcher take no input. `ZodError` surfaces as a
400-equivalent through `authErrorResponse` on the REST side
(`lib/brain/auth.ts`) and as `isError: true` on the MCP side (`index.ts:138`).

### L-1 — [LOW] Hand-maintained dual schemas

Every tool declares its shape twice: once as the JSON Schema advertised in
`tools/list`, once as the Zod schema that actually enforces. Nothing checks they
agree. The drift is already visible — `find-skill` advertises and accepts
`framework` (`:22`, `:8`) and **never uses it**: it appears in neither the SQL nor
the post-filter. An agent that passes `framework: "react"` gets unfiltered
results and no error.

Deriving the JSON Schema from the Zod schema (`zod-to-json-schema`) removes the
class. Short of that, `tools-catalog.test.ts` is the natural home for an assertion
that every advertised property exists in the Zod shape.

### On "reject prompt injection" — a correction to the brief

The checklist asks that Zod schemas *"reject prompt injection or command
manipulation."* **Schema validation cannot do this, and no change to these
schemas would.** Zod validates *shape* — that `question` is a string of length
≥ 3. Prompt injection lives in the *content* of a legitimately-shaped string, and
`brain_ask_oracle` exists precisely to pass that string to an LLM.

Command manipulation **is** properly handled, and by the right mechanism: every
raw SQL statement binds user text positionally, so no string a caller controls is
ever concatenated into a query. That is the defence that matters for the injection
class, and it is in place.

The real prompt-injection exposure in this system is second-order and worth naming
so it is not mistaken for covered: **KEA and autoskill mine session text and
persist the result as `Knowledge`, which is later injected into other sessions'
context.** Text an agent was tricked into recording can therefore be replayed as a
"rule" into a future session — including, via org-visible knowledge, a teammate's.
The mitigations are provenance (`extractedBy`, already stored) and human review
(the autoskill proposal queue, already built). Recommend documenting that
threat-model explicitly in `docs/SECURITY.md` rather than implying schema
validation addresses it.

---

## Recommended order

1. **H-1** — closes both the disclosure and the allocation primitive; ~30 lines,
   plus a replacement test. Fix the test in the same PR: leaving it is worse than
   having no test, because it reads as coverage.
2. **H-2** — four read tools + four resources. `cross-user-isolation.test.ts`
   already has the assertion shape.
3. **M-1** — verify first, then patch regardless.
4. **M-2, M-3, M-4** — before release.
5. **L-1, L-2** — schedule after.

Add one test that does not correspond to any finding above: **assert that
`kra.ts` and `oracle.ts` keep the outer `"ownerUserId" = $2` pin.** It is the
single predicate preventing `buildRawProjectFilterV2`'s intentionally
owner-agnostic org arm from becoming a cross-tenant read, and nothing currently
guards it.

**Verdict for this pass: no CRITICAL findings.** No data-leakage or auth-bypass
path reaches another tenant's data. The two HIGH findings are a pre-auth
disclosure/resource issue and a confinement promise the read path does not keep —
both fixable inside a single PR each, neither requiring architectural change.
