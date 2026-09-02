# MCP Tools Reference

The External Brain exposes **12 tools** and **4 resources** over MCP. Any MCP-capable AI client (Claude Code, Cursor, Windsurf, Google Antigravity, GitHub Copilot, Autobahn, custom agents) becomes Brain-aware by connecting to this server.

## Connect

Mint a token at `/settings/tokens`. After mint, the wizard generates the exact install command for your client and OS — copy and run it. The manual snippet below is a fallback reference.

> **Repointing an existing entry at a different Brain requires a client
> restart.** MCP clients bind their endpoint at session start, so editing the
> config (or re-running the installer) mid-session leaves the live connection
> on the previous instance — every subsequent write lands there, succeeds, and
> returns a real id. Knowledge does not federate across deployments
> (`KNOWLEDGE.md` invariant 13), so those rows are simply absent from the Brain
> you meant to use. See [`KNOWN_ISSUES §0t`](./KNOWN_ISSUES.md).

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

### `GET /health` — unauthenticated liveness + tier

```jsonc
{ "ok": true, "transport": "http", "sessions": 5, "environment": "production" }
```

`environment` mirrors the web app's `/api/healthz` field of the same name and
comes from `BRAIN_DEPLOY_ENV`. It is **absent (`null`) when unset, never
guessed** — a caller must treat that as *cannot verify*, not as *not
production*. It reports a tier label and never a hostname, since this endpoint
is public.

It exists so that a destructive automated check can ask **the box** what it is
rather than trusting its own shell — the property a test guard needs when the
process doing the writing may be running anywhere (`KNOWN_ISSUES §0ax`).

## Tools

### `brain_whoami` — which Brain am I talking to?

Takes no arguments. Returns the deployment's own public hostname and database
name (read from the **server's** env, so it is a fact the client cannot know or
get wrong), the user and token the bearer resolves to including its capability
list, and how much knowledge that user holds.

Reach for it when a teach appears to succeed but the data never appears, when
`brain_get_user_style` comes back empty, or after repointing a client — an MCP
client binds its endpoint **at session start**, so the config file on disk is
not proof of the live target ([`KNOWN_ISSUES §0t`](./KNOWN_ISSUES.md)).

```json
{
  "instance":  { "mcpPublicHostname": "brain.example.com", "databaseName": "brain" },
  "identity":  { "email": "you@example.com", "tokenName": "laptop",
                 "capabilities": [], "capabilitiesMeaning": "unrestricted" },
  "knowledgeHeld": { "knowledge": 128, "sessions": 40 }
}
```

`knowledgeHeld: 0` on a healthy connection means *fresh instance* or *wrong
instance* — not a fault. It is not capability-gated: a restricted token must
still be able to ask what it is.


| # | Name | When to call | Returns |
|---|---|---|---|
| 1 | `brain_start_session` | ONCE at the start of a coding task. Accepts optional `projectName` to file the session under a project (creating it on demand). Project scoping is per-call, not persisted. | `{ sessionId, startedAt, project, hint?, relevantKnowledge?, openActionItems? }` — save `sessionId`; `project.source` says whether this landed in a real project or the "Default" fallback, with `hint` present on fallback; apply `relevantKnowledge` (inject-at-open, see below); `openActionItems` = your meeting to-dos (V2.0, flag-gated) |
| 2 | `brain_create_project` | Before work on a new codebase / client, when you want an explicit, audit-friendly create | `{ projectId, slug, created }` |
| 3 | `brain_list_projects` | Before `brain_create_project`, to avoid duplicates; or to surface a "switch project?" prompt | `{ projects: [...] }` |
| 4 | `brain_get_active_project` | Before `brain_start_session`, to verify the default destination matches the user's intent | `{ project: {...} \| null }` |
| 5 | `brain_retrieve_knowledge` | BEFORE generating code | `{ bundle, injection }` — typed items + pre-formatted injection string |
| 6 | `brain_report_session_outcome` | AFTER user accepts/rejects | `{ sqs, queued, resolvedActionItems?, hint? }` — `hint` is the ask-back nudge on a learning-less close (see below); `resolvedActionItems` counts retired meeting to-dos (V2.0) |
| 7 | `brain_teach_knowledge` | when user says "remember …" | `{ id, confidence: 1.0, project, hint?, superseded?, supersedeHint? }` |
| 8 | `brain_retire_knowledge` (v2.20.0) | cleaning up a mistake — a misfile, a duplicate, a row you or a teammate got wrong. NOT a normal part of every session; most sessions never call this | `{ retired: true, wasOwnRow, snapshot, note? }` — `snapshot` is the full pre-delete content, kept so a wrong retire is recoverable by re-teaching from it |
| 9 | `brain_get_user_style` | when scaffolding new files | `{ peerCard, reflexes }` |
| 10 | `brain_ask_oracle` | "how did I solve X?" | `{ answer, citations, project, hint?, ... }` |
| 11 | `brain_log_event` | during session (per event) | `{ id, accepted }` |
| 12 | `brain_find_skill` | rarely — see "Two things are called Skills" below | top-N skill *bundles* |
| 13 | `brain_session_search` | "what did I do last week?" | recent matching sessions (Postgres FTS) |

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

### `brain_start_session` — `project` + `hint` response fields

The response always carries a `project` object naming the resolved
destination, and a `hint` string when that resolution was a silent fallback
rather than a deliberate choice:

```json
{
  "sessionId": "…",
  "startedAt": "…",
  "project": { "id": "…", "name": "Default", "source": "default_created" },
  "hint": "This session is filed under the \"Default\" project because no projectId/projectName was given. …"
}
```

`project.id` and `project.source` are always present. `project.name` is
best-effort: the fallback paths already hold it, and the scoped/explicit
paths look it up **fail-soft** after the session row is committed — a failed
lookup omits `name` rather than failing the call, because throwing there
would hand back no `sessionId` for a session that already exists and could
therefore never be closed.

`project.source` mirrors the same values `brain_get_active_project` reports:

| `source` | Meaning |
|---|---|
| `token_scope` | Token is project-scoped; that project won. |
| `explicit` | Caller passed `projectId`, or `projectName` resolved (created or matched) an existing project. |
| `first_project_fallback` | No `projectId`/`projectName` given; an existing project was used — either the user's first project (unordered) or the personal org's oldest, since `ensureDefaultProject` returns an existing project when one is present. |
| `default_created` | No `projectId`/`projectName` given, no project existed, so a "Default" project was created. Derived from `ensureDefaultProject`'s `created` flag rather than assumed. |

`hint` is present only when the caller named no project **and** the fallback
was actually worth flagging — i.e. the session landed on the catch-all
"Default" project, or there was more than one project it could have picked.
It steers the caller toward `brain_create_project` or passing `projectName`,
and reminds them that project scoping is **per-call**: there is no persisted
"active project", so the same `projectName`/`projectId` must be passed again
on every subsequent `brain_start_session` call for that project's work.

Deliberately **absent** for `token_scope`/`explicit` (the caller chose), and
for a user whose single project is their own named one — omitting
`projectName` there is not a mistake, and a hint on every session would
train the agent to ignore the field.

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

### Meeting action items (V2.0, 2026-07-07 — dark behind `V2_ACTION_ITEMS`)

Three tool-surface additions carry the meeting-intelligence loop
(spec `docs/superpowers/specs/2026-07-07-brain-v2-meeting-doc-intelligence-design.md`):

- **`brain_teach_knowledge` accepts `type: "action_item"`** — a meeting to-do
  or open question. Tag contract: `action-item` *or* `open-question`, plus
  `for:<assignee-email-lowercase>`, `meeting:<YYYY-MM-DD-slug>`, and `blocker` when
  it blocks other work. Action items are **tasks, not rules**: they are
  excluded from semantic retrieval, KEA, and decay statistics everywhere.
- **`brain_start_session` response may carry `openActionItems`**
  (`{ knowledgeIds, injection }`) — the caller's open items in the session's
  project, matched **deterministically** by the `for:` tag (never
  embedding-matched), blockers first then oldest, capped at 10. Fail-soft
  like `relevantKnowledge`. Deliberately writes **no**
  `SessionKnowledgeApplication` rows — tasks must not pollute the
  injection→used loop-health metric.
- **`brain_report_session_outcome` accepts `resolvedActionItemIds`** (≤50) —
  items done or obsolete are retired (soft-deleted) at close; the response
  reports `resolvedActionItems: <count>`. Retirement is bounded to
  `action_item` rows visible in the session's project — rule IDs and foreign
  projects are silently ignored.

### Ownership scope (v0.11.2, extended v0.14.0)

Every tool that takes a caller-supplied `sessionId`, `projectId`, or `knowledgeId` validates ownership before mutating:

- **`brain_log_event`, `brain_report_session_outcome`** — look up the session by `(id, userId = auth.userId)` and return `NOT_FOUND` if the caller isn't the owner. `report`'s `knowledgeUsed` counter bumps are scoped to `ownerUserId: auth.userId` — foreign Knowledge IDs are silently skipped (matches the best-effort `bulkBumpKnowledgeOutcome` semantic).
- **`brain_start_session`, `brain_teach_knowledge`, `brain_ask_oracle`** — when the token is unscoped (`auth.projectId === null`) and the caller supplies an explicit `projectId`, the server checks the user is a member of the org that owns it. Returns `FORBIDDEN_PROJECT` if not. When the token is project-scoped, a mismatched `projectId` **or `projectName`** returns `FORBIDDEN_PROJECT` — the name path used to be ignored silently, so a token scoped to A that named B was served A. A `projectName` naming no accessible project returns `PROJECT_NOT_FOUND` on reads: `brain_ask_oracle` never creates, because answering from a project a typo conjured reads as "you have no knowledge about that".
- **`brain_teach_knowledge`'s `supersedesKnowledgeId`** — retiring a prior decision is ownership-checked, and (2026-07-14, meeting-transcript-upload plan) now also project-checked: the target row must be owned by the caller **and** in the same resolved project as the new row, not just owned by the caller. Without this a user with knowledge scattered across multiple projects could retire a decision that belongs to a different project than the one superseding it. A non-matching id is silently ignored — the new row is still created, just without a supersession link. See `supersedeKnowledge` (`packages/core/src/knowledge-stats.ts`).
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

### Server-side observability (2026-05-11, an early PR)

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
| `kea.extract` (worker) | KEA pipeline run completed (or short-circuited) | Carries `outcome: ok\|error\|skipped_session_gone` + `items: <persisted-count>`. `skipped_session_gone` (an early PR) fires when the Session row was deleted between enqueue and process — completes the job instead of triggering a retry storm. |
| `kea.funnel` (worker, 2026-05-12, an early PR) | Every successful `kea.extract` | Separates `llmFindings` (model output count) from `filterPassed` (quality-filter survivors) from `persisted` (final count). If `persisted=0` while `llmFindings>0`, the quality filter is the bottleneck; if `llmFindings=0` the model is producing nothing extractable from the session shape. |
| `kea.cross.skip` (worker, 2026-05-14, an early PR) | A user has fewer than 2 new closed sessions since their last cross-session extract | The "instrument the invisible" log line for the daily cron's no-op case. Carries `reason` + `newSessionCount`. Without this, idempotent skips would be silent. |
| `kea.cross_extract` (worker, 2026-05-14, an early PR) | Each daily `kea.cross_extract` job run | Top-level wrapper log: `outcome`, `users`, `totalPersisted`, `durMs`. |
| `kea.cross.daily_done` (worker, 2026-05-14, an early PR) | After all users processed in a daily run | Summary: `users`, `processed`, `skipped`, `totalPersisted`, `model`. |
| `autoskill.run` (worker) | Every `autoskill.run` job | Same `outcome` tri-state as `kea.extract` (`ok`/`error`/`skipped_session_gone`). |

A 5-minute sweeper evicts in-memory sessions older than 30 min with `toolCalls === 0` to (a) emit the orphan log even when the client never sends DELETE, and (b) prevent the in-memory `sessions` Map from growing forever on probe-only traffic. See `apps/mcp-server/src/index.ts`.

### KEA provider routing (2026-05-12, an early PR)

`packages/core/src/kea.ts` picks the LLM provider by `KEA_MODEL` prefix:

| `KEA_MODEL` prefix | Provider | Required env var | Cost (rough) |
|---|---|---|---|
| `qwen*` / `glm*` | DashScope (Alibaba) via OpenAI-compatible endpoint | `DASHSCOPE_API_KEY` | ~$0.001/extraction |
| `claude*` | Anthropic | `ANTHROPIC_API_KEY` | ~$0.01/extraction |
| anything else (e.g. `gpt-4o-mini`) | OpenAI | `OPENAI_API_KEY` | ~$0.003/extraction |

Default in code: `qwen3-coder`. The `worker` service in `deploy/docker-compose.yml` passes both `KEA_MODEL` and `DASHSCOPE_API_KEY` through from `.env` so operators can switch providers without a code change.

Each provider's entry point (`callAnthropic`, `callDashScope`, `callOpenAI`) checks its env var explicitly — a misconfigured `KEA_MODEL` produces an actionable error naming the right variable AND the two alternative providers. Before an early PR, a missing `DASHSCOPE_API_KEY` produced a misleading "set OPENAI_API_KEY" error from the OpenAI SDK, sending operators chasing the wrong env var.

### Bootstrap hint via `instructions` (2026-05-11, an early PR)

The MCP `initialize` response carries an `instructions` string (MCP-spec field). Capable clients (Claude Code reads it; many SDKs ignore unknown fields) see:

> External Brain is connected. Run `brain_get_user_style` first to verify end-to-end connectivity and bootstrap your peer card. End each coding session with `brain_report_session_outcome` so the Knowledge Extraction Agent can learn from the outcome — without that close call, sessions stay open and the brain doesn't learn.

The bootstrap call makes first-touch tool-use automatic, so the dashboard's per-token "last tool call" signal is meaningful from day 1 of a new install, not "whenever the user happens to type a brain trigger phrase."

### Install-ping flow (2026-05-11, an early PR)

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

## Project scoping across tools (v2.18.0)

Three tools take a project: `brain_start_session`, `brain_teach_knowledge` and
`brain_ask_oracle`.

All three share one resolver
(`apps/mcp-server/src/scope.ts::resolveProjectForCall`) — precedence lives in
exactly one place so the three cannot drift again.

They still *report* differently, deliberately. `brain_teach_knowledge` and
`brain_ask_oracle` return the canonical `token_scope` | `explicit_id` |
`explicit_name` | `default_fallback` and hint on every fallback.
`brain_start_session` translates those onto its longer-standing vocabulary —
`explicit` | `first_project_fallback` | `default_created` — because it
distinguishes "we created a project for you" from "we picked your existing one",
and it hints *selectively* (only when the fallback landed on Default or had more
than one project to choose between), since nagging every session trains callers
to ignore hints. If you branch on `source`, handle both spellings. Precedence,
identical across all three:

1. **Project-scoped token** — wins outright; a mismatched `projectId` is
   rejected with `FORBIDDEN_PROJECT` rather than silently narrowed.
2. **Explicit `projectId`** — verified against the caller's access first.
3. **`projectName`** — resolved, created on demand.
4. **Fallback** — the user's first project, *and the response says so*.

Every response carries `project: { id, name?, source }` where `source` is
`token_scope` | `explicit_id` | `explicit_name` | `default_fallback`, plus a
`hint` string whenever it fell back. **Read `project.source`** — it is the only
way to know the call landed where you meant.

`brain_teach_knowledge` additionally returns `superseded: boolean` when you pass
`supersedesKnowledgeId`, with a `supersedeHint` when it did **not** apply.
Supersession matches the target within the same user *and project*, so a
predecessor living in another project is not retired; before v2.18.0 that
returned success while the stale rule stayed active.

Scoping is **per call**. Opening a session with a project does not scope later
teach or Oracle calls — pass the project again. See `KNOWN_ISSUES.md §0ar` for
what the pre-v2.18.0 disagreement between these three cost.

### The fallback now tells you where it probably belonged

The fallback resolves to the user's **first** project, oldest-first — which for
essentially every user is the auto-created "Default". Until v2.20.0 the hint
that reported this said "pass `projectName`" **without naming a single
project**, which is not an instruction a caller can follow: an agent would have
to already suspect the problem and call `brain_list_projects` unprompted.

A fallback response now carries `suggestedProjects`, ranked:

```jsonc
{
  "project": { "id": "…", "name": "Default", "source": "default_fallback" },
  "hint": "Filed under \"Default\" … This looks like it belongs in \"External Brain\" (matches framework nextjs + its name appears in the task text) — re-send with projectName: \"External Brain\" if so.",
  "suggestedProjects": [
    { "projectId": "…", "name": "External Brain", "score": 0.85, "why": "matches framework nextjs + its name appears in the task text" }
  ]
}
```

| Property | Why it is this way |
|---|---|
| **Suggests, never redirects** | The call still lands in the fallback project. Silently rerouting a write to a better-fitting project would turn a *visible* misfile into an invisible one. |
| **Ranked on framework, language, and name-in-text — not embeddings** | Similarity to a project's existing knowledge is weakest exactly when it matters: a genuinely new topic has nothing similar filed, so "best fit" degrades to "biggest project". These three signals are already loaded, cost nothing, and produce a `why` an operator can audit. |
| **Only recommends above a threshold** | `language: typescript` matches most projects and distinguishes nothing. Below the bar the hint just *lists* the candidates. A confident suggestion built from no signal teaches callers to ignore suggestions. |
| **Never suggests the project it just picked** | Recommending what you already did is noise. Excluding by id also means no magic `"Default"` string. |

The strongest single signal is the project's name appearing in your prompt or
rule text — a caller who names the project has already said where it belongs
and simply did not put it in the parameter. That was the exact shape of the
2026-08-30 incident (`KNOWN_ISSUES §0au`).


## Reading a `brain_report_session_outcome` response

`learnings` are validated per item and **dropped**, never rejected — a
malformed learning must not block the close, because an unclosed session
teaches nothing. What was dropped is reported back:

| Field | Meaning |
|---|---|
| `learningsDropped.invalid` | wrong shape (missing/short fields) |
| `learningsDropped.overflow` | more than 5 submitted; the extras |
| `learningsDropped.markup` | text carried leaked tool-call markup |
| `learningsHint` | present when `markup > 0` — re-send those items with each field as its own parameter |

Absent `learningsDropped` means every submitted learning was captured. Before
v2.19.4 the drops appeared only in a worker log, so a submitting agent had no
way to know.

## Reading a `brain_teach_knowledge` response

`{ id, confidence: 1.0 }` proves the row was **accepted**, not that it was
understood. Three fields carry the rest:

| Field | Check it because |
|---|---|
| `project.source` | `explicit_name` / `explicit_id` = landed where you asked; `default_fallback` = it did not, and `hint` says why |
| `superseded` | present when you passed `supersedesKnowledgeId`; `false` + `supersedeHint` means the predecessor is in another project and is **still active** |
| — | since v2.19.3 the tool **rejects** `rule`/`trigger`/`rationale`/`instead` containing leaked tool-call markup rather than storing them (`KNOWN_ISSUES §0as`) |

That last one exists because a malformed call used to succeed: the tail of a
field swallowed every parameter after it, including `tags` — and `decision` is
the tag that makes a rule `visibility: "org"`. A decision recorded to be
team-visible was silently filed private.

## Using `brain_retire_knowledge` (v2.20.0)

Every other write on this surface only ever *adds* — `brain_teach_knowledge`
creates a row, and its `supersedesKnowledgeId` only ever retires a row the
**same caller already owns**, as a side effect of teaching a replacement.
`brain_retire_knowledge` is the first verb whose whole job is removing a row,
and its scope is wider than supersede's:

> **If `brain_retrieve_knowledge` could have returned this row to you, you can
> retire it — including a teammate's `visibility: "org"` decision, not only
> rows you authored.**

That is a real widening of what an agent can do on its own initiative, and it
was chosen deliberately (operator decision, 2026-08-30) in exchange for one
guarantee: **it never destroys the content.** `deletedAt` is set (never a hard
delete), and the full row is written into an audit-log snapshot *before* the
update — the same `snapshot` object comes back in the tool's own response. If
you retire the wrong thing, re-teach it from that snapshot; there is no
separate restore tool, and none is needed.

**When to use it:** cleaning up a specific, identified mistake — a rule that
landed in the wrong project via a fallback (`KNOWN_ISSUES §0au`), a duplicate
left behind after a supersede failed cross-project, a decision you taught
before catching a typo. **When not to use it:** as a routine part of closing a
session, or to "tidy up" knowledge you merely disagree with — disagreement is
what `supersedesKnowledgeId` is for, because a supersede leaves a lineage
(`parentKnowledgeId`) an operator can trace; a retire does not.

A `FORBIDDEN` response means the row was never visible to you in the first
place — that is not a bug to route around by trying a different id or
projectName; it means you don't have the access this operation requires.

## Two things are called "Skills" (read this before using `brain_find_skill`)

The word is overloaded, deliberately, and the two meanings have different data:

| | Webapp **Skills** tab | The **`Skill`** table |
|---|---|---|
| What it holds | `Knowledge` rows — reflexes, recipes, heuristics, principles | whole markdown bundles |
| Written by | KEA extraction, `brain_teach_knowledge`, autoskill promotions | autoskill's `internal_skill` route only |
| Typical `kind` | n/a | `internal` (platform self-improvement: KEA prompt addenda and similar) |
| Read by | `brain_retrieve_knowledge`, `brain_ask_oracle`, the UI | `brain_find_skill` |
| Populated? | yes | usually empty |

**Practical consequence:** for "how do we do X here?" reach for
`brain_retrieve_knowledge` or `brain_ask_oracle`. An empty result from
`brain_find_skill` is normal and does **not** mean the Brain has no knowledge
on the topic — it means the bundle store is empty, which it usually is.

**Why both names were kept** (decision, 2026-08-22): "Skills" is established
product language across the UI, the README and `AGENTS.md`, and the tab has
the data users actually care about. Renaming it would churn a surface users
already understand for internal tidiness they do not. Renaming the `Skill`
table or the `brain_find_skill` tool would be a migration plus a breaking
change to a published MCP surface. The collision never cost anything at the
tab; it cost at the routing table in the Brain's own SKILL.md, which sent
agents to the empty store for exactly the questions the Knowledge store
answers. That routing, and this tool's description, are what got fixed.
