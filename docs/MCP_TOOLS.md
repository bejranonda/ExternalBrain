# MCP Tools Reference

The External Brain exposes **12 tools** and **4 resources** over MCP. Any MCP-capable AI client (Claude Code, Cursor, Windsurf, Autobahn, custom agents) becomes Brain-aware by connecting to this server.

## Connect

Mint a token at `/settings/tokens`. After mint, the wizard generates the exact install command for your client and OS — copy and run it. The manual snippet below is a fallback reference.

```bash
# Claude Code — .mcp.json
{
  "mcpServers": {
    "brain": {
      "command": "npx",
      "args": ["-y", "@brain/mcp-server"],
      "env": { "BRAIN_MCP_TOKEN": "<your token from brain.example/settings/tokens>" }
    }
  }
}
```

## Tools

| # | Name | When to call | Returns |
|---|---|---|---|
| 1 | `brain_start_session` | ONCE at the start of a coding task. Accepts optional `projectName` to file the session under a project (creating it on demand). | `{ sessionId, startedAt, relevantKnowledge? }` — save `sessionId`; apply `relevantKnowledge` (inject-at-open, see below) |
| 2 | `brain_create_project` | Before work on a new codebase / client, when you want an explicit, audit-friendly create | `{ projectId, slug, created }` |
| 3 | `brain_list_projects` | Before `brain_create_project`, to avoid duplicates; or to surface a "switch project?" prompt | `{ projects: [...] }` |
| 4 | `brain_get_active_project` | Before `brain_start_session`, to verify the default destination matches the user's intent | `{ project: {...} \| null }` |
| 5 | `brain_retrieve_knowledge` | BEFORE generating code | `{ bundle, injection }` — typed items + pre-formatted injection string |
| 6 | `brain_report_session_outcome` | AFTER user accepts/rejects | `{ sqs, queued, hint? }` — `hint` is the ask-back nudge on a learning-less close (see below) |
| 7 | `brain_teach_knowledge` | when user says "remember …" | `{ id, confidence: 1.0 }` |
| 8 | `brain_get_user_style` | when scaffolding new files | `{ peerCard, reflexes }` |
| 9 | `brain_ask_oracle` | "how did I solve X?" | `{ answer, citations, ... }` |
| 10 | `brain_log_event` | during session (per event) | `{ id, accepted }` |
| 11 | `brain_find_skill` | user asks for complete recipe | top-N skills |
| 12 | `brain_session_search` | "what did I do last week?" | recent matching sessions (Postgres FTS) |

Full JSON schemas live in `apps/mcp-server/src/tools/*.ts` — each file exports a `ToolDef` with `inputSchema`. Order in this table matches `apps/mcp-server/src/tools/index.ts`.

### Project-management tools (v0.14.0)

The three project-management tools — `brain_create_project`, `brain_list_projects`, `brain_get_active_project` — closed the "AI agent doesn't know which project this work belongs to" gap. Before v0.14.0, agents could only attach sessions to projects that already existed and were either bound to the token or returned by the Phase 2b first-project fallback. New projects had to be created through the webapp. Now an agent can:

1. Call `brain_get_active_project` to learn the current default,
2. Call `brain_list_projects` to see if a target project already exists,
3. Either pass `projectName` to `brain_start_session` for the implicit path or call `brain_create_project` for the explicit, audit-friendly path.

#### `brain_create_project`

Idempotent on `(userId, name)` within the user's personal org — re-calling with the same name returns the existing project with `created: false`.

**Input schema**
```json
{
  "type": "object",
  "required": ["name"],
  "properties": {
    "name":      { "type": "string", "minLength": 1, "maxLength": 120 },
    "framework": { "type": "string", "maxLength": 60, "examples": ["react","nextjs","vue"] },
    "language":  { "type": "string", "maxLength": 60, "examples": ["typescript","python"] }
  }
}
```

**Behavior**
- Name lookup is case-insensitive.
- `framework` and `language` are only persisted when the project is being created — they do not overwrite the values of an existing project.
- The project is created in the caller's personal org (slug + uniquify-within-org applies, same as `POST /api/projects`).

**Returns**
```json
{ "projectId": "proj_abc123", "slug": "acme-robotics", "created": true }
```

**Error codes**
| Code | Status | When |
|---|---|---|
| `FORBIDDEN_PROJECT` | 403 | The token is project-scoped. The token IS the project — use a user-scoped token, or create the project from the webapp. |
| `VALIDATION` | 400 | Name missing, empty, or >120 chars. |

**Example**
```json
{ "name": "brain_create_project", "arguments": { "name": "Acme Robotics", "framework": "react", "language": "typescript" } }
→ { "projectId": "proj_4uy…", "slug": "acme-robotics", "created": true }
```

#### `brain_list_projects`

Read-only enumeration. Returns every project the authenticated user can see across every org they're a member of.

**Input schema** — `{}` (no parameters)

**Returns**
```json
{
  "projects": [
    {
      "id":         "proj_abc123",
      "slug":       "acme-robotics",
      "name":       "Acme Robotics",
      "orgId":      "org_xyz",
      "orgSlug":    "personal-…",
      "orgName":    "alex@acme.com",
      "framework":  "react",
      "language":   "typescript",
      "isOwn":      true,
      "createdAt":  "2026-05-26T09:14:22.000Z"
    }
  ]
}
```

**Scope rule**
- **User-scoped token** → returns all projects the user can see (all orgs they're a member of, in `getUserProjects` order — owned org first).
- **Project-scoped token** → returns *only* the project the token is bound to. The same scope rule that applies to writes applies symmetrically to reads.

**Error codes** — none beyond auth (401 unauthenticated, no per-tool failures).

#### `brain_get_active_project`

Returns the project a `brain_start_session` call would default to *right now* if no `projectId` or `projectName` were passed. Mirrors the resolution logic in `start-session.ts`.

**Input schema** — `{}` (no parameters)

**Returns**
```json
{
  "project": {
    "id":      "proj_abc123",
    "slug":    "acme-robotics",
    "name":    "Acme Robotics",
    "orgName": "alex@acme.com",
    "source":  "first_project_fallback"
  }
}
```

`source` is either:
- `"token_scope"` — the token is project-scoped and the active project is whatever the token binds to.
- `"first_project_fallback"` — the token is user-scoped and the resolver picked the user's first project per Phase 2b ordering.

When the user has no projects yet, the response is `{ "project": null }` — the caller should either create one (`brain_create_project`) or pass `projectName` to `brain_start_session` to create one implicitly.

**Error codes** — none beyond auth.

### `brain_start_session` — `projectName` parameter (v0.14.0)

`brain_start_session` now accepts an optional `projectName: string` (1–120 chars, case-insensitive). Resolution precedence (highest wins):

1. **Token scope** — if the token is project-scoped, the session lands in the token's project and any caller-supplied `projectId`/`projectName` is overridden (with `FORBIDDEN_PROJECT` returned for an explicit *different* `projectId`).
2. **Caller `projectId`** — if supplied AND the user has access, used as-is.
3. **Caller `projectName`** — if supplied (and no `projectId` won above), `ensureNamedProject(userId, name)` is called: it looks up an existing project by case-insensitive name in the user's personal org, or creates one. `framework` / `language` from the same call are forwarded only when the project is being created.
4. **First-project fallback** — the user's first project (Phase 2b).
5. **Lazy default** — `ensureDefaultProject` creates a "Default" project if the user has zero projects.

For project-scoped tokens, `projectName` is silently ignored — the scope wins.

### `brain_start_session` — `relevantKnowledge` response (inject-at-open, 2026-06-11)

When `brain_start_session` is called with a `prompt` (the task description),
the response additionally carries the knowledge the agent should apply:

```json
{
  "sessionId": "…",
  "startedAt": "…",
  "relevantKnowledge": {
    "knowledgeIds": ["…"],
    "injection": "## What I've Learned About You\n### Unconditional Rules …"
  }
}
```

- Retrieval runs the existing KRA scoring (top 5) **in the same round-trip**
  — no separate `brain_retrieve_knowledge` call to remember. (That tool
  remains for mid-task re-query.)
- Each injected row is recorded as `SessionKnowledgeApplication(role:
  "injected")`; passing `knowledgeIds` back as `knowledgeUsed` at close bumps
  success/failure — the confidence loop, end to end.
- **Fail-soft:** any retrieval error (no embedding provider, vector blip) is
  logged (`op:"start.inject_failed"`) and the field is omitted — opening a
  session never blocks on retrieval. No `prompt` → no retrieval.

Why: measured before this change, **0%** of knowledge had ever been retrieved
across 22 sessions — the read-side mirror of the elicitation gap close-capture
fixed at the close call (#64).

### `brain_report_session_outcome` — `learnings` parameter (close-capture, 2026-06-09)

`brain_report_session_outcome` accepts an optional `learnings` array (0–5 items)
— the durable rules the agent distilled from the session, shaped like the
knowledge model itself:

```json
{
  "trigger":   "when scaffolding a React form in this repo",
  "rule":      "use react-hook-form + zod, not Formik",
  "rationale": "Formik abandoned; team standard",
  "type":      "reflex | recipe | heuristic | principle | anti_principle",
  "source":    "user_correction | decision | discovery",
  "confidence": 0.9
}
```

Semantics:

- **Never blocks the close.** Items are validated *per-item*; invalid ones are
  dropped (and counted in the `report.learnings_captured` log) while the
  outcome report, SQS, and confidence updates proceed normally. More than 5
  items → the first 5 are kept.
- **Persistence.** Each valid item becomes a
  `SessionEvent { eventType: "learning_captured" }` row.
- **Refine mode.** When KEA runs for a session that has captured learnings, it
  *validates* them (durability/specificity judge, confidence clamped ≤ 0.95)
  instead of mining the summary — then the usual quality filter + semantic
  dedup apply. Persisted rows are tagged `close_capture`, so yield is
  queryable split by source (`kea.funnel` log: `mode`, `submitted`). Sessions
  without learnings keep the original mine path.
- **Ask-back `hint` (2026-06-11).** A close *without* learnings returns an
  advisory `hint` in the response — strong after `success: false` or
  `userFeedback: "down"` ("capture the correction NOW with
  `brain_teach_knowledge`"), gentle otherwise, absent when learnings were
  submitted. The close is committed by then, so the hint targets the
  still-callable teach tool; agents should act on it.

Why: per-session mining yielded ~17% because single-session summaries are
thin. The agent has the full session in *its own* context — close-capture asks
it to hand over the distilled `(trigger, rule, rationale)` at the one call
every client already makes.

### Ownership scope (v0.11.2, extended v0.14.0)

Every tool that takes a caller-supplied `sessionId`, `projectId`, or `knowledgeId` validates ownership before mutating:

- **`brain_log_event`, `brain_report_session_outcome`** — look up the session by `(id, userId = auth.userId)` and return `NOT_FOUND` if the caller isn't the owner. `report`'s `knowledgeUsed` counter bumps are scoped to `ownerUserId: auth.userId` — foreign Knowledge IDs are silently skipped (matches the best-effort `bulkBumpKnowledgeOutcome` semantic).
- **`brain_start_session`, `brain_teach_knowledge`** — when the token is unscoped (`auth.projectId === null`) and the caller supplies an explicit `projectId`, the server checks the user is a member of the org that owns it. Returns `FORBIDDEN_PROJECT` if not. When the token is project-scoped, any `projectId` mismatch already returns `FORBIDDEN_PROJECT` (Phase 3c behavior, unchanged).
- **`brain_create_project`** — refused with `FORBIDDEN_PROJECT` (403) for project-scoped tokens. User-scoped tokens may create only inside the caller's personal org; the org is resolved server-side, never from caller input.
- **`brain_list_projects`, `brain_get_active_project`** — project-scoped tokens see only their bound project. The same scoping rule that prevents writing across the boundary prevents reading across it.

Closed audit findings C3-C6 / issue #106. The regression net lives in `apps/mcp-server/src/__tests__/cross-user-isolation.test.ts` (5 tests against the live dev DB).

### Authorization matrix (v0.14.0)

| Tool | User-scoped token | Project-scoped token |
|---|---|---|
| `brain_start_session` | Any accessible project; `projectName` may create on demand | Token's project only; mismatched `projectId` → `FORBIDDEN_PROJECT`; `projectName` ignored |
| `brain_create_project` | ✓ creates in personal org | ✗ `FORBIDDEN_PROJECT` (403) |
| `brain_list_projects` | All visible projects | Token's project only |
| `brain_get_active_project` | First-project fallback (Phase 2b) | Token's project (`source: "token_scope"`) |
| `brain_retrieve_knowledge`, `brain_ask_oracle`, `brain_session_search`, `brain_find_skill`, `brain_get_user_style` | Scope filter resolves to user + accessible-project IDs | Scope filter narrowed to the token's project |
| `brain_teach_knowledge` | Any accessible project | Token's project only |
| `brain_log_event`, `brain_report_session_outcome` | Caller must own the `sessionId` | Same + session must belong to token's project |

### Session binding (v0.11.2, audit C1)

The MCP HTTP transport binds each `Mcp-Session-Id` to the bootstrap token via constant-time comparison. A request with a leaked session ID + a different valid Bearer is rejected with `401 -32001 "Session-token mismatch"`. The session UUID is no longer logged at info — only an 8-char prefix.

### Server-side observability (2026-05-11, PR #202)

The mcp-server emits structured `op="…"` log lines that distinguish probe-shaped traffic from real client work. Use them when diagnosing "tokens authenticate but nothing happens":

| `op` value | When it fires | What it means |
|---|---|---|
| `mcp.unauth` | Request without a Bearer | Auth gate working as intended (most uptime monitors that don't carry a token land here) |
| `mcp.session.open` | After a valid-Bearer `initialize` | A client is connecting. Carries `sessionPrefix` + `total` (live session count) |
| `mcp.tools.list` | Every `tools/list` call | Distinguishes "client is discovering tools" from "client is actually calling them" |
| `mcp.tool` | Every `tools/call` (ok or error) | Real client work. Carries `tool`, `durMs`, `outcome` |
| `mcp.session.close` | DELETE /mcp closes a session that had ≥1 tool call | Clean teardown |
| `mcp.session.orphan` | A session ends (DELETE or sweeper eviction) with **zero** tool calls | Smoking gun for "token authenticates but no work happens" |
| `mcp.session.token_mismatch` | Mid-session request with a different Bearer than the bootstrap | Audit C1 reject |
| `kea.extract` (worker) | KEA pipeline run completed (or short-circuited) | Carries `outcome: ok\|error\|skipped_session_gone` + `items: <persisted-count>`. `skipped_session_gone` (PR #206) fires when the Session row was deleted between enqueue and process — completes the job instead of triggering a retry storm. |
| `kea.funnel` (worker, 2026-05-12, PR #206) | Every successful `kea.extract` | Separates `llmFindings` (model output count) from `filterPassed` (quality-filter survivors) from `persisted` (final count). If `persisted=0` while `llmFindings>0`, the quality filter is the bottleneck; if `llmFindings=0` the model is producing nothing extractable from the session shape. |
| `kea.cross.skip` (worker, 2026-05-14, PR #219) | A user has fewer than 2 new closed sessions since their last cross-session extract | The "instrument the invisible" log line for the daily cron's no-op case. Carries `reason` + `newSessionCount`. Without this, idempotent skips would be silent. |
| `kea.cross_extract` (worker, 2026-05-14, PR #219) | Each daily `kea.cross_extract` job run | Top-level wrapper log: `outcome`, `users`, `totalPersisted`, `durMs`. |
| `kea.cross.daily_done` (worker, 2026-05-14, PR #219) | After all users processed in a daily run | Summary: `users`, `processed`, `skipped`, `totalPersisted`, `model`. |
| `autoskill.run` (worker) | Every `autoskill.run` job | Same `outcome` tri-state as `kea.extract` (`ok`/`error`/`skipped_session_gone`). |

A 5-minute sweeper evicts in-memory sessions older than 30 min with `toolCalls === 0` to (a) emit the orphan log even when the client never sends DELETE, and (b) prevent the in-memory `sessions` Map from growing forever on probe-only traffic. See `apps/mcp-server/src/index.ts`.

### KEA provider routing (2026-05-12, PR #206)

`packages/core/src/kea.ts` picks the LLM provider by `KEA_MODEL` prefix:

| `KEA_MODEL` prefix | Provider | Required env var | Cost (rough) |
|---|---|---|---|
| `qwen*` / `glm*` | DashScope (Alibaba) via OpenAI-compatible endpoint | `DASHSCOPE_API_KEY` | ~$0.001/extraction |
| `claude*` | Anthropic | `ANTHROPIC_API_KEY` | ~$0.01/extraction |
| anything else (e.g. `gpt-4o-mini`) | OpenAI | `OPENAI_API_KEY` | ~$0.003/extraction |

Default in code: `qwen3-coder`. The `worker` service in `deploy/docker-compose.yml` passes both `KEA_MODEL` and `DASHSCOPE_API_KEY` through from `.env` so operators can switch providers without a code change.

Each provider's entry point (`callAnthropic`, `callDashScope`, `callOpenAI`) checks its env var explicitly — a misconfigured `KEA_MODEL` produces an actionable error naming the right variable AND the two alternative providers. Before PR #206, a missing `DASHSCOPE_API_KEY` produced a misleading "set OPENAI_API_KEY" error from the OpenAI SDK, sending operators chasing the wrong env var.

### Bootstrap hint via `instructions` (2026-05-11, PR #202)

The MCP `initialize` response carries an `instructions` string (MCP-spec field). Capable clients (Claude Code reads it; many SDKs ignore unknown fields) see:

> External Brain is connected. Run `brain_get_user_style` first to verify end-to-end connectivity and bootstrap your peer card. End each coding session with `brain_report_session_outcome` so the Knowledge Extraction Agent can learn from the outcome — without that close call, sessions stay open and the brain doesn't learn.

The bootstrap call makes first-touch tool-use automatic, so the dashboard's per-token "last tool call" signal is meaningful from day 1 of a new install, not "whenever the user happens to type a brain trigger phrase."

### Install-ping flow (2026-05-11, PR #202)

The bash installer at `/api/onboard.sh` ends with a 3-call sequence per token, immediately after `claude mcp add`:

1. **Smoke-test** — `initialize` + `tools/call brain_get_user_style`. Proves end-to-end reachability through the user's network, TLS, Caddy, the MCP server, and `authenticate()`. Hard-fails the installer on any failure with per-HTTP-code diagnostics.
2. **Install-ping** — `brain_start_session(clientType="claude_code", prompt="brain installer ping v2")` → `brain_log_event(payload={installer_version, claude_version, os})` → `brain_report_session_outcome(success=true)`. Creates a real Session row with `endedAt` set, which is the strict signal KEA reads as "real client did real work."
3. **First-touch nudge** — prints a literal example prompt the user can paste to fire `brain_teach_knowledge` in their first Claude Code session, converting the install into immediate value.

Failures in step 2 are non-fatal (step 1 already proved the round-trip); failures in step 1 abort the install loudly.

## Resources (read-only)

- `brain://user/style-profile` — quick JSON of the user's reflexes + peer card.
- `brain://user/active-skills` — skills in knowledge/wisdom stage.
- `brain://user/recent-sessions` — last 10 sessions.
- `brain://user/peer-card` — hard-override facts.

Resources are designed for quick context hydration at session start.

## Typical flow in a client

```
// Optional but recommended on first session of a new task:
// confirm the destination project matches the user's intent.
{ project } = client.callTool('brain_get_active_project', {})
if (project?.name !== userIntendedProject) {
  // either: switch to a known project by name…
  { sessionId } = client.callTool('brain_start_session', {
    clientType, prompt, framework, projectName: userIntendedProject,
  })
  // …or list first and decide:
  { projects } = client.callTool('brain_list_projects', {})
  // …or create explicitly:
  { projectId } = client.callTool('brain_create_project', { name: userIntendedProject })
  { sessionId } = client.callTool('brain_start_session', {
    clientType, prompt, framework, projectId,
  })
} else {
  { sessionId } = client.callTool('brain_start_session', { clientType, prompt, framework })
}

client.callTool('brain_retrieve_knowledge', { prompt, context: { sessionId, ... } })
  → inject `injection` as user message
client.callTool('brain_log_event', { sessionId, eventType, payload }) × N during generation
(user accepts code)
client.callTool('brain_report_session_outcome', {
  sessionId, success: true, knowledgeUsed: bundle.injectedIds, ...
})
```

The platform handles everything from there: KEA extracts new knowledge, autoskill proposes skill edits, evolution runs nightly.
