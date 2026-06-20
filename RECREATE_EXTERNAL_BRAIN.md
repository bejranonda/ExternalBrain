# Recreate "External Brain" — superseded by `REBUILD/`

> **This file is kept for historical reference.** The canonical rebuild resource is now
> the **`REBUILD/` folder** — nine phase-optimised files, each with a copy-paste agent
> prompt and a runnable checkpoint gate. Start there:
>
> ```
> REBUILD/00-START-HERE.md   ← open this first
> ```
>
> The monolithic format below (one giant document) worked as a reference but was hard
> to hand to an AI agent incrementally. `REBUILD/` splits it by build-phase so the
> agent can be given exactly what it needs for each step and verified before the next.
> See `docs/APPROACH.md §5as` for the rationale.

---

# (Archive) Recreate "External Brain" — original monolithic brief

> **How to use this file.** Open a fresh repo on the target machine, start your AI
> coding agent (Claude Code, Cursor, Windsurf, etc.), and paste this document as the
> master brief. Build in the phases below — each phase ends with a runnable, testable
> checkpoint. Do **not** try to one-shot the whole thing; the system is a feedback
> loop with strict package boundaries, and building it in order is what keeps it
> coherent. Treat every "Invariant" callout as non-negotiable.
>
> **Prefer `REBUILD/` for new builds.** This archive is useful for understanding the
> full scope at a glance, but the phase files are more actionable.

---

## 0. Mission — what you are building

**External Brain** is a self-hostable **MCP (Model Context Protocol) server + web app**
that gives AI coding tools long-term memory. It:

1. **Captures** coding sessions from any MCP client (Claude Code, Cursor, Windsurf,
   Google Antigravity, GitHub Copilot, …) over a Bearer-authenticated MCP server.
2. **Extracts** durable, typed knowledge from finished sessions (a background worker
   mines them into reflexes / recipes / heuristics / principles / anti-principles).
3. **Retrieves** the most relevant knowledge by *meaning* (pgvector semantic search +
   effectiveness/recency/context scoring) and injects it into the *next* task's prompt.
4. **Answers** questions about your own codebase via a grounded **Oracle** (RAG with
   citations back to the sessions/knowledge that support each claim).
5. **Compounds**: confidence rises on rules that get used and succeed; stale rules
   decay; duplicates merge; project *decisions* are exempt from decay.

It is provider-agnostic (Claude / GLM / OpenAI / Gemini / Qwen, swapped by env),
runs on a single VM via Docker Compose, and is MIT-licensed.

**It is NOT another AI coding tool.** It writes no code; it is the memory substrate
that makes whatever tool you already use smarter over time. The product also dogfoods
itself — the team uses its own Brain while building it.

---

## 1. Tech stack & non-negotiables

| Concern | Choice |
|---|---|
| Language/runtime | TypeScript (strict everywhere) on Node 20 LTS |
| Monorepo | pnpm workspaces (`pnpm@9.15.0`) + Turborepo |
| Web | Next.js (App Router, `output: "standalone"`), React 19, Tailwind v4 |
| Auth | NextAuth v5 (JWT sessions) + `@auth/prisma-adapter`, `bcryptjs` |
| Database | PostgreSQL 16 + **pgvector** extension |
| ORM | Prisma 7 with `@prisma/adapter-pg` driver adapter |
| Embeddings | Provider-agnostic via OpenAI-compatible endpoint (Gemini / OpenAI / Qwen3) |
| LLM | Claude / GLM / OpenAI / Gemini / Qwen (selected by env, OpenAI-compatible or Anthropic SDK) |
| Background jobs | **pg-boss** v12 (no Redis required for jobs) |
| Protocol | `@modelcontextprotocol/sdk` (stdio + Streamable HTTP transports) |
| Validation | `zod` v4 (at boundaries only) |
| Packaging/deploy | Docker Compose (single VM), Caddy (auto-TLS edge profile) |
| Tests | Vitest (unit), Playwright (e2e, chromium-only in CI) |

**Hard rules (carry these the whole way):**

1. **Package boundary:** `types → db → core → (mcp-server | web | worker)`. Apps must
   never import from each other; share only through packages. Core holds *all*
   intelligence so three runtimes share one implementation.
2. **MCP requires Bearer auth on every method, including `initialize`.** A 401 without
   a Bearer is the correct gate. (The MCP spec allows unauthenticated discovery — you
   deliberately override that for defense-in-depth.)
3. **Secure-by-default:** with no auth mode configured, every web request returns
   `503 auth_not_configured`. The operator must pick a mode to unlock the instance.
4. **Multi-tenant scoping is on every query.** Every knowledge/session/skill read and
   write filters by `ownerUserId` (and project/org where relevant). Cross-tenant leakage
   is the cardinal sin; write the isolation tests early.
5. **TypeScript strict, no `any`, no `@ts-ignore` without justification.** Comments are
   rare and explain *why*, never *what*. Conventional Commits.
6. **Never commit secrets.** Only `.env.example` is tracked; `.env` and all backup
   variants are gitignored.

---

## 2. Repo layout

```
apps/
  web/                   # Next.js webapp — dashboard, Oracle, Skills, settings, admin
  mcp-server/            # MCP server (stdio + HTTP) — exposes the brain_* tools
  worker/                # pg-boss background jobs (extraction, decay, embeddings)
packages/
  core/                  # Intelligence layer (extraction, retrieval, Oracle, decay, embeddings)
  db/                    # Prisma schema + client + raw-SQL helpers
  types/                 # Cross-package TypeScript types (no runtime deps)
deploy/                  # docker-compose.yml, Dockerfile, Caddyfile
scripts/                 # dev-up.sh / deploy.sh / reload.sh / verify-lockdown.sh / smoke.sh
docs/                    # Documentation
```

Root files: `package.json` (turbo scripts), `pnpm-workspace.yaml` (`apps/*`,
`packages/*`), `turbo.json`, `tsconfig.base.json`, `.env.example`, `AGENTS.md`
(with `CLAUDE.md`/`GEMINI.md` as symlinks to it), `LICENSE` (MIT).

Turbo tasks: `build` (`dependsOn: ["^build"]`), `dev` (persistent, uncached),
`lint`/`test`/`typecheck` (`dependsOn: ["^build"]`). CI runs
`turbo run typecheck`, `turbo run test`, `turbo run build`.

---

## 3. Build plan (phases / checkpoints)

Build in this order. Each phase is independently runnable and testable.

1. **Foundation** — monorepo scaffold, `@brain/types`, `@brain/db` (schema + migrations
   + pgvector + raw-SQL helpers + seed). Checkpoint: `prisma migrate deploy` on a fresh
   pgvector DB succeeds and seed populates a deterministic fixture.
2. **Intelligence core** — `@brain/core`: env loader, LLM provider abstraction,
   embeddings, KRA (retrieve), KEA (extract), Oracle (RAG), cost ledger, decay/evolution,
   scope filters, formatter, install-snippets. Checkpoint: unit tests for scoring, decay,
   cost, dedup, and snippet generators pass.
3. **MCP server** — `apps/mcp-server`: Bearer auth, stdio + HTTP transports, the 12
   `brain_*` tools, 4 resources, job enqueue. Checkpoint: `initialize` without Bearer →
   401; with a valid token, `tools/list` + a `brain_start_session`/`report` round-trip
   works end-to-end.
4. **Worker** — `apps/worker`: pg-boss setup, the 9 jobs, cron schedules, embeddings
   backfill. Checkpoint: closing a session enqueues `kea.extract` + `autoskill.run`, the
   worker drains them, and NULL embeddings get backfilled within a tick.
5. **Web app** — `apps/web`: NextAuth (4 modes), theme/i18n shell, dashboard, Oracle
   (SSE), Skills, Graph, Sessions, Settings (tokens + install wizard), Admin (vouchers),
   self-registration, password reset. Checkpoint: sign in, create a token, ask the Oracle,
   browse skills; anon/authed e2e green.
6. **Deploy & CI** — Docker Compose (db/web/mcp/worker + edge: caddy/redis/backup),
   multi-stage Dockerfile, the scripts, GitHub Actions (ci + onboarding-e2e + authed-e2e
   + prod-drift). Checkpoint: `./scripts/dev-up.sh` brings the stack up locally and the
   lockdown audit prints PASS.

---

## 4. `@brain/types` — shared types (build first)

Pure TypeScript, no runtime dependencies. Every other package imports from here. Define:

**Knowledge ontology**
- `KnowledgeType = "reflex" | "recipe" | "heuristic" | "principle" | "anti_principle"`
- `KnowledgeScope = "global" | "user" | "project" | "session_context" | "team" | "community"`
- `KnowledgeExtractedBy = "kea" | "user" | "imported" | "promoted"`
- `interface Knowledge { id; type; scope; ownerUserId|null; ownerTeamId|null;
  ownerProjectId|null; triggerText; ruleText; rationale|null; symbolicWhen|null;
  symbolicThen|null; instead|null; framework|null; language|null; tags[]; confidence;
  successCount; failureCount; usageCount; decayScore; createdAt; confirmedAt|null;
  lastUsedAt|null; extractedBy; sourceSessionIds[]; parentKnowledgeId|null }`
- `interface KnowledgeBundle { reflexes; recipes; heuristics; principles; antiPrinciples:
  Knowledge[]; skill?: Skill|null; injectedIds: string[] }`

**Skills** (markdown-first, Obsidian-style)
- `SkillStage = "inbox" | "notes" | "knowledge" | "wisdom"`; `SkillKind = "output" | "internal"`
- `SkillFrontmatter { skill_id; title; stage; kind; scope; tags[]; dependencies[];
  confidence; mastery; created; updated; [k]: unknown }`
- `Skill { id; skillId; title; content; frontmatter; ownerUserId|null; ownerTeamId|null;
  scope; successCount; failureCount; usageCount; version; parentSkillId|null;
  createdAt; updatedAt }`
- `SkillExportFormat = "claude-code" | "cursor" | "windsurf" | "codex" | "markdown"`

**Sessions**
- `SessionClientType = "claude_code" | "cursor" | "windsurf" | "autobahn" | "antigravity"
  | "github_copilot" | "custom" | "webapp"`
- `SessionOutcome = "success" | "partial" | "failed"`
- `SessionEventType = "session_started" | "tool_use" | "file_created" | "file_modified" |
  "file_rejected" | "build_attempt" | "build_success" | "build_failure" |
  "user_clarification" | "user_correction" | "knowledge_injected" | "knowledge_rejected"`
- `Session`, `SessionEvent`, `SessionContext { sessionId; userId; projectId?; framework?;
  language?; sessionMode?: "building"|"debugging"|"refactoring"|"exploring"; dataScope?:
  "project"|"all"; orgId?; accessibleProjectIds? }`, `SessionMetrics`.

**Graph** — `GraphRelation = "depends_on" | "prerequisite_for" | "related_to" | "deepens"
| "specializes" | "contradicts" | "supersedes"`; `GraphEdge`.

**Oracle** — `OracleReasoningLevel = "minimal"|"low"|"medium"|"high"|"max"`;
`OracleGroundedness = "strong"|"moderate"|"weak"|"none"`; `OracleQuery`,
`OracleCitation { marker; knowledgeId?; sessionId?; skillId?; excerpt; meta? }`,
`OracleCitationMeta`, `OracleResponse { answer; citations[]; confidence:
"high"|"medium"|"low"; groundedness; retrievedCounts {knowledge; sessions};
relatedQuestions[]; tokensUsed }`.

**Other** — `PeerCard { id; ownerUserId; ownerProjectId|null; facts[]; updatedAt }`;
`AutoskillConfidence = "high"|"medium"`; `AutoskillTarget = "skill"|"rules"|"knowledge"
|"internal_skill"`; `AutoskillProposal`; `MCPToken`; `SessionQualityScore`;
`KnowledgeHealthSnapshot`.

---

## 5. `@brain/db` — data layer

Prisma 7 + `@prisma/adapter-pg`. Generate the client into `packages/db/src/generated/client`.
Export a singleton `db` (guard against hot-reload connection storms in Next dev), plus
raw-SQL helpers. Build-time builds set `SKIP_DB_INIT=1` to avoid engine init during
`next build`; runtime always gets a real client.

### 5.1 Models (Postgres tables)

**Tenancy**
- `User { id @cuid; email @unique; name?; image?; role @default("user"); createdAt; updatedAt }`
  — `role` is `"admin" | "user"`; admin unlocks `/admin`.
- `Organization { id; slug @unique; name; createdAt; updatedAt }` — every user gets a
  personal org on first signup.
- `OrganizationMember { id; orgId→Org Cascade; userId→User Cascade; role @default("member");
  joinedAt } @@unique([orgId,userId])` — role `owner|admin|member`.
- `OrganizationInvite { id; orgId Cascade; email; role; invitedById; token @unique;
  createdAt; expiresAt; acceptedAt?; revokedAt? }`.
- `Project { id; ownerUserId?→User; ownerTeamId?→Team; organizationId→Org Restrict (NOT
  NULL); name; slug; framework?; language?; createdAt } @@unique([organizationId,slug])`.
- `Team`, `TeamMembership @@unique([userId,teamId])` (roles owner/admin/editor/member).

**Knowledge & skills**
- `Knowledge` — all fields from the `Knowledge` type above, **plus** an
  `embedding Unsupported("vector(1536)")` column (NULL until backfilled), `deletedAt?`
  (soft delete), `visibility @default("project")` (`private|project|org`), and
  `originProjectId?`. Defaults: `scope @default("user")`, `confidence @default(0.7)`,
  `decayScore @default(1.0)`, `extractedBy @default("kea")`, counts `@default(0)`,
  `tags @default([])`, `sourceSessionIds @default([])`. Indexes:
  `(ownerUserId,type,scope)`, `(ownerUserId,confidence)`, `(parentKnowledgeId)`,
  `(ownerUserId,ownerProjectId,deletedAt)`.
- `Skill` — fields from `Skill` type, `frontmatter Json`, `embedding vector(1536)`,
  `stage @default("notes")`, `kind @default("output")`, `mastery @default(1)`.
  `@@unique([skillId, ownerUserId])`. Index `(scope,stage)`.

**Sessions**
- `Session { id; userId→User Cascade; projectId?→Project SetNull; teamId?; tokenId?→MCPToken
  SetNull; parentSessionId?; clientType; startedAt; endedAt?; outcome?; sqs? Float;
  metadata? Json }`. Indexes `(userId,startedAt)`, `(parentSessionId)`,
  `(userId,projectId,startedAt)`, `(tokenId,startedAt)`. `metadata.prompt` is FTS-indexed.
- `SessionEvent { id; sessionId Cascade; eventType; payload Json; timestamp }`. Index
  `(sessionId,timestamp)`, `(eventType)`. `payload::text` is FTS-indexed.
- `SessionKnowledgeApplication { id; sessionId Cascade; knowledgeId→Knowledge Cascade;
  role; createdAt } @@unique([sessionId,knowledgeId,role])` — role `"injected" |
  "retrieved_but_not_used" | "extracted_from"`.

**Graph / peer card / autoskill / feedback**
- `GraphEdge { id; sourceId→Knowledge Cascade; targetId→Knowledge Cascade; relation; scope;
  weight @default(1.0); createdBy; evidence[]; createdAt } @@unique([sourceId,targetId,relation])`.
- `PeerCard { id; ownerUserId Cascade; ownerProjectId? Cascade; facts[]; updatedAt }
  @@unique([ownerUserId,ownerProjectId])`.
- `AutoskillProposal { id; userId Cascade; sessionId Cascade; target; targetId?; confidence;
  diff Text; patch Json; reasoning Text; status @default("pending"); createdAt; resolvedAt? }`
  Index `(userId,status)`.
- `Feedback { id; userId Cascade; sessionId?; knowledgeId?; skillId?; rating; comment?;
  feedbackType @default("session"); createdAt }`.

**Tokens & auth**
- `MCPToken { id; userId Cascade; teamId? Cascade; organizationId? Cascade; projectId? Cascade;
  name; tokenHash @unique; scope; expiresAt?; createdAt; lastUsedAt?; revokedAt?;
  scheduledRevokeAt?; rotatedFromId? @unique }` — scope `"personal" | "team"`.
- `UserCredential { id; userId Cascade @unique; passwordHash; createdAt; updatedAt }` (bcrypt cost 12).
- `PasswordResetToken { id; userId Cascade; token @unique; createdAt; expiresAt; usedAt? }` (1h TTL).
- `VoucherCode { id; code @unique; kind; organizationLabel?; maxUses @default(1);
  usedCount @default(0); expiresAt?; disabled @default(false); note?; createdByUserId?;
  createdAt; updatedAt }`; `VoucherRedemption { id; voucherId Cascade; userId Cascade @unique;
  redeemedAt }`.

**Audit & metrics**
- `AuditLog { id; actorUserId?; action; targetType?; targetId?; payload? Json; ip?;
  userAgent?; organizationId?; projectId?; createdAt }` — append-only.
- `OracleCostLedger { id; userId; day Date; tokensInput; tokensOutput; costUsd Decimal(10,6);
  callCount; updatedAt } @@unique([userId,day])`.
- `KnowledgeHealthSnapshot { id; snapshotAt; tenantScope; usedInLast30Days; totalActive;
  averageConfidence; contradictionCount; medianAgeDays }`.
- `CommunitySkill`, `SkillImport` (community library — can be stubbed early).

> **Invariant — FK semantics.** `Project.organizationId` is `Restrict` (no silent
> orphaning); `SessionKnowledgeApplication.knowledgeId` and `MCPToken.{organizationId,
> projectId}` are `Cascade` (a token is revoked *with* its scope, never widened). GDPR
> erase is the only sanctioned bulk-delete path.

### 5.2 pgvector + FTS

- Migration 0 creates `CREATE EXTENSION IF NOT EXISTS vector`.
- `embedding vector(1536)` on `Knowledge` and `Skill`; stored NULL, backfilled by worker.
- Raw-SQL helper `toVector(number[]): string` → `"[0.1,0.2,…]"`.
- `searchKnowledgeByEmbedding(embedding, {ownerUserId?, scope?, framework?, limit?,
  minSimilarity?})` — cosine distance operator `<=>`, similarity = `1 - distance`,
  filters `embedding IS NOT NULL AND deletedAt IS NULL AND decayScore > 0.3`, order by
  distance ASC, default limit 20.
- A hand-applied `packages/db/sql/session-fts-index.sql`: GIN indexes on
  `to_tsvector('english', metadata->>'prompt')` (Session) and `payload::text` (SessionEvent).
  (Applied by the deploy scripts, **not** by Prisma migrations.)

### 5.3 Seed (deterministic, idempotent via upsert)

1 admin user (e.g. `alex@brain.local`), 1 personal org, 1 default project
(nextjs/typescript), 6 closed sessions (mixed outcomes, deterministic SQS), ~16 Knowledge
rows (all 5 types, tagged `seed`), 4 pending AutoskillProposals. Leave embeddings NULL
(worker backfills). This fixture is what the authed-e2e suite asserts against (e.g. "≥16
skills").

---

## 6. `@brain/core` — the intelligence layer

All business logic lives here. Organize as one module per subsystem under
`packages/core/src/`.

### 6.1 Env loader (`env.ts`)
`envForWeb()`, `envForMcp()`, `envForWorker()` validate and return typed env. Throw on
missing `DATABASE_URL`. See the full env catalog in §11.

### 6.2 LLM provider abstraction
Route by model-name prefix and base-URL presence:
- `claude*` **or** `ANTHROPIC_BASE_URL` set → Anthropic SDK (with optional `baseURL`).
- `qwen*` / `glm*` → DashScope OpenAI-compatible endpoint
  (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, key `DASHSCOPE_API_KEY`).
- else → OpenAI SDK.

Model env vars (with defaults): `ORACLE_MODEL` (Q&A + cross-session KEA),
`KEA_MODEL` (per-session extraction), `KEA_REFINE_MODEL` (→`KEA_MODEL`),
`CROSS_SESSION_KEA_MODEL` (→`ORACLE_MODEL`). Always `recordCall(...)` after a billed call.

### 6.3 Embeddings (`embedding.ts`)
`embed(text)`, `embedBatch(texts)`, `cosineSimilarity(a,b)`. Provider chain (first
success wins): **Gemini** `gemini-embedding-001` via
`https://generativelanguage.googleapis.com/v1beta/openai` if `GOOGLE_GEMINI_API_KEY` set
(do **not** send a `dimensions` arg — Gemini rejects mismatches); else fallback to
`EMBEDDING_MODEL` (default `text-embedding-3-small`, 1536 dims) via `EMBEDDING_BASE_URL`/
provider key. In-process LRU cache (SHA-256 keys, max 5000). On transient error (429/408/
5xx) retry once with the next provider; if all fail throw a retryable `BrainError`.

### 6.4 Retrieval — KRA (`kra.ts`)
`retrieve(prompt, context: SessionContext, maxItems=10): Promise<KnowledgeBundle>` and a
`retrieveScored(...)` variant for debugging.
- **Candidates:** embed prompt → pgvector top 20 → filter `decayScore > 0.3`,
  `deletedAt IS NULL`, visibility-aware (see §6.10).
- **Score (tuned weights):**
  `0.70*similarity + 0.08*successRate + 0.08*recencyDecay + 0.08*contextFit + 0.06*confidence`.
  - `successRate`: Laplace `(succ+1)/(succ+fail+2)`, floor 0.5 when <3 outcomes.
  - `recencyDecay`: `exp(-daysSince/90)` from `confirmedAt ?? createdAt`.
  - `contextFit`: base 0.5; +0.3 framework match, +0.2 language match, +0.2 project-scope
    match, +0.2 if `sessionMode="debugging"` & type `heuristic` & tagged `debugging`; cap 1.
- **Diversify:** sort desc, max 3 per type, min score 0.45, ≤ maxItems.
- **Side effects:** write `SessionKnowledgeApplication(role:"injected")`, bump `usageCount`
  + `lastUsedAt` for selected rows. Return the bundle (grouped by type) + `injectedIds`.

### 6.5 Extraction — KEA (`kea.ts`)
Runs after a session closes. `extractFromSession(payload, opts?)`:
- **Refine mode** (agent submitted `learnings`): split off `source:"decision"` items
  (bypass judge → project scope, tags `decision`+`close_capture`, no dedup), send the rest
  through `defaultRefineJudge` (durability/specificity check), clamp confidence ≤ 0.95.
- **Mine mode** (no learnings): call `KEA_MODEL` with `SYSTEM_PROMPT` over a session
  summary; parse JSON findings.
- **Quality filter:** top 3; drop confidence < 0.7, trigger < 10 chars, rule < 20 chars,
  generic-and-short rules; if cosine > 0.85 to an existing row, bump that row's confidence
  instead of inserting a duplicate.
- **Persist:** embed `trigger+"\n"+rule`, create `Knowledge` (+ `SessionKnowledgeApplication
  role:"extracted_from"`) in a transaction; idempotent on retry (NULL-embedding dedup).
- **Output schema** `KEAFinding { type; scope; trigger(≥10); rule(≥20); rationale;
  confidence(0–1) }`.
- `extractFromCrossSessions({userId, sessionIds[], model?})` (needs ≥2 sessions, tags
  `cross_session`) and `runCrossExtractDaily({windowSize?, model?})` for the daily job.
- Write an `AuditLog` row per run (`kea.extract_session` / `kea.extract_cross_session`).

### 6.6 Oracle (`oracle.ts`, `oracle-sse.ts`)
`ask(userId, query, projectId?, dataScope?, visibilityArgs?): Promise<OracleResponse>` and
`askStream(...)` async generator (events: `meta` → `delta*` → `final`; also `error`/`done`).
- **Reserve cost** atomically (`reserveCapSlot`, default $0.05) under a `pg_advisory_xact_lock`
  on `(userId, day)`; throw `OracleCapExceededError` if over `MAX_ORACLE_COST_USD_PER_DAY`.
- **Build context:** embed question → top 12 Knowledge (visibility-filtered) + top 10
  recent Sessions; format with `[^K1]…`/`[^S1]…` markers.
- **Groundedness** (computed pre-LLM): `none` if 0/0; `strong` if k≥6; `moderate` if k≥3
  or (k≥1 & sessions>0); else `weak`.
- **System prompt:** normal grounding+citation prompt, or a no-context variant when the
  bundle is empty (acknowledge absence, don't fabricate).
- **Max tokens by reasoning level:** minimal 256 / low 512 / medium 1024 / high 2048 / max 4096.
- **After:** `mapCitations(answer, knowledge, sessions)` parses `[^K\d]`/`[^S\d]` →
  `OracleCitation[]`; `recordCall` nets the reservation against actual cost.

### 6.7 Cost ledger (`cost.ts`)
Per-model `$/1M` input/output table (Claude / GPT / GLM / Qwen families; unknown → $15/$75
fallback). `reserveCapSlot`, `recordCall`, `checkCap`. Per-day UTC bucket in
`OracleCostLedger`. Warn at 80% of cap, error at cap (deduped per user-day).

### 6.8 Decay & evolution (`evolution.ts`, `knowledge-stats.ts`)
- `decayUnused()` — `decay = max(exp(-days/halfLife), 0.05)` from `lastUsedAt ?? createdAt`.
  Half-life 90d baseline; 45d if effectiveness < 0.3 (≥5 outcomes); 180d if ≥ 0.7.
  Cursor-paginate 1000 rows. Flag low-effectiveness (<0.3, ≥5 outcomes, unused 30d) with tag
  `flagged:low-effectiveness`. **Rows tagged `decision` never decay.**
- `consolidateDuplicates()` — per user, pull stored embeddings via `embedding::text`
  (don't re-embed), merge same-type pairs with cosine > 0.92 (keep older, soft-delete
  younger, +0.02 confidence, sum counts).
- `detectObsolescence()` (weekly), `snapshotKnowledgeHealth()` (weekly),
  `detectContradictions()` (stub).
- `effectivenessScore(k)` — `(succ)/(succ+fail)` when total ≥ 3, else `-1` ("insufficient");
  UI shows "— Untested" not a misleading %. `bulkBumpKnowledgeOutcome`,
  `bulkBumpKnowledgeUsage`, `getTopRules`.

### 6.9 Learnings & decisions (`learnings.ts`)
`LearningSchema = { trigger(10–500), rule(20–2000), rationale(1–2000),
type: KnowledgeType, source: "user_correction"|"decision"|"discovery",
confidence?(0–1) }`. Constants: `LEARNING_EVENT_TYPE="learning_captured"`,
`MAX_LEARNINGS_PER_SESSION=5`, `MAX_SUBMITTED_CONFIDENCE=0.95`, `DECISION_TAG="decision"`.
`supersedeKnowledge(db,{newId,supersededId,userId})` soft-deletes the old row and links
`parentKnowledgeId` (never fails the capture).

### 6.10 Scope filters (`scope-filter.ts`)
Visibility levels `private | project | org`. `buildKnowledgeWhereV2(args)` (Prisma where)
and `buildRawProjectFilterV2(args, startParam)` (`{sql, params}` for pgvector queries) apply
project/all scope + visibility rules using `accessibleProjectIds`.

### 6.11 Formatter (`formatter.ts`)
`formatForInjection(bundle): string` → markdown for prompt injection. Order: **decisions
first** (settled facts), then reflexes, recipes, heuristics, anti-principles, principles.
Each non-decision item shows success rate (≥3 outcomes) else confidence.

### 6.12 Install snippets (`install-snippets.ts`)
Pure generators returning `InstallSnippet { kind: "shell"|"json"|"rest"; lines[]; note?;
configPath? }`. **The exact config shape per client matters — clients fail silently on the
wrong key:**

| Generator | Top key | Notable shape | Config path |
|---|---|---|---|
| `claudeCodeCli` | — (shell) | `curl …/api/onboard.sh \| bash -s '<token>'` (PS1 on win32) | — |
| `claudeDesktop` | `mcpServers.brain` | `transport:{type:"http",url}` + `headers.Authorization` | per-OS Claude config |
| `cursor` | `mcpServers.brain` | same as Claude Desktop | `~/.cursor/mcp.json` |
| `windsurf` | `mcpServers.brain` | same | `~/.codeium/windsurf/mcp_config.json` |
| `geminiCli` | `mcpServers.brain` | same | `~/.gemini/settings.json` |
| `antigravity` | `mcpServers.brain` | **`serverUrl`** (not `url`) + `headers` | `~/.gemini/antigravity/mcp_config.json` |
| `githubCopilotVscode` | **`servers`** | `type:"http"` + `url` + `headers` | `.vscode/mcp.json` |
| `githubCopilotJetbrains` | **`servers`** | `url` + **`requestInit.headers`** (no type) | IDE `mcp.json` |
| `githubCopilotCli` | `mcpServers` | `type:"http"` + `url` + `headers` | `~/.copilot/mcp-config.json` |
| `rawMcpServersJson` | `mcpServers.brain` | generic fallback | — |
| `restApiCurl` | — (rest) | `curl -N …/api/oracle/stream` | — |

> **Invariant — pin these in unit tests.** A test must assert `antigravity` emits
> `serverUrl` (not `url`) and `githubCopilotJetbrains` puts headers under `requestInit`.
> These are the silent-failure traps.

### 6.13 Also in core
Project helpers (`ensureDefaultProject`, `ensureNamedProject`, `getUserProjects`,
`userCanAccessProject`), `getLogger`/`withRequest`/`shortId` (structured logging to
stderr for stdio MCP), `BrainError` (typed `{code,status,category,retryable}`),
`evaluation.computeAndStoreSQS`, autoskill (`runForSession`), and feature kill-switch reads
(`ORACLE_ENABLED`, `KEA_ENABLED`, `AUTOSKILL_ENABLED`, `MCP_ENABLED`).

---

## 7. `apps/mcp-server` — the MCP surface

Uses `@modelcontextprotocol/sdk`. File layout: `index.ts` (transport setup), `auth.ts`,
`http-helpers.ts`, `resources.ts`, `jobs.ts`, `tools/*` (one file per tool + `index.ts`
registry).

### 7.1 Transports
- **stdio:** `StdioServerTransport`; token from `BRAIN_MCP_TOKEN` env; stdout reserved for
  JSON-RPC, logs to stderr.
- **HTTP:** `StreamableHTTPServerTransport` on `MCP_SERVER_HTTP_PORT` (default 3100), bind
  `127.0.0.1`. Routes: `POST /mcp` (JSON-RPC), `GET /` (landing, no auth),
  `GET /health` (`{ok:true,transport,sessions}`, no auth). `MCP_ENABLED=false` → `/mcp`
  returns 503; `/health` stays open.
- Choose transport by `MCP_TRANSPORT`, else HTTP if `MCP_SERVER_HTTP_PORT` set, else stdio.

### 7.2 Auth (`auth.ts`)
Token format `bp_<256-bit random>`, shown once, stored as SHA-256 in `MCPToken.tokenHash`.
`authenticate(rawToken)`: hash → `findUnique` → reject if missing/revoked/scheduledRevoke
elapsed/expired → update `lastUsedAt` → return `AuthContext { userId; teamId; scope;
tokenId; organizationId; projectId }`.

> **Invariants.** (a) **Every** method — including `initialize` — calls `authenticate`;
> missing Bearer → `401` with `WWW-Authenticate: Bearer realm="brain-mcp"` and JSON-RPC
> error `-32001`. (b) **Session-token binding:** an HTTP session is bound to its bootstrap
> token; a request reusing a session id with a *different* Bearer → 401 (constant-time
> `timingSafeEqual`). (c) An **orphan sweeper** runs every 5 min, evicting sessions older
> than 30 min with zero tool calls; log only an 8-char session-id prefix.

### 7.3 The 12 tools (exact names + key inputs)

1. **`brain_start_session`** — inputs: `clientType?(enum,default custom)`, `projectId?`,
   `projectName?(1–120)`, `framework?`, `language?`, `prompt?`. Resolves project (token
   scope → projectId → projectName → first/default). If `prompt` given, retrieves top 5
   knowledge (fail-soft) and returns `{sessionId, startedAt, relevantKnowledge?:
   {knowledgeIds[], injection}}`. Writes `Session` + `session_started` event.
2. **`brain_create_project`** — `{name(1–120), framework?, language?}` → `{projectId, slug,
   created}` (idempotent case-insensitive; project-scoped tokens → 403 `FORBIDDEN_PROJECT`).
3. **`brain_list_projects`** — no input → `{projects:[{id,slug,name,orgId,orgSlug,orgName,
   framework,language,isOwn,createdAt}]}`.
4. **`brain_get_active_project`** — no input → `{project: {…, source: "token_scope" |
   "first_project_fallback"} | null}`.
5. **`brain_retrieve_knowledge`** — `{prompt, context?:{sessionId,projectId,framework,
   language,sessionMode}, maxItems?(≤20,default10)}` → `{bundle, injection}` (calls
   `kra.retrieve` + `formatter.formatForInjection`).
6. **`brain_report_session_outcome`** — `{sessionId, success, filesCreated[], filesModified[],
   filesRejected[], knowledgeUsed[], buildAttempts, errors[], userFeedback?("up"|"down"),
   userFeedbackComment?, durationMs, tokensUsed, learnings?(≤5 of {trigger,rule,rationale,
   type,source,confidence?})}`. Validates session ownership; persists learnings as events;
   closes session (`endedAt`, `outcome`); computes SQS; bumps confidence on `knowledgeUsed`;
   enqueues `kea.extract` + `autoskill.run` (singletonKey per session). Returns `{sqs, queued[],
   hint?}` — `hint` appears when the close failed/down-voted with no learnings.
7. **`brain_teach_knowledge`** — `{type, trigger(≥5), rule(≥10), rationale?, instead?,
   scope?(global|user|project,default user), projectId?, framework?, language?, tags[],
   supersedesKnowledgeId?}`. Creates Knowledge `confidence:1.0, extractedBy:"user",
   confirmedAt:now`, embeds it, supersedes predecessor if given, logs `decision.captured`
   when tagged `decision`. → `{id, confidence}`.
8. **`brain_get_user_style`** — no input → `{peerCard: string[], reflexes: [{triggerText,
   ruleText,confidence,tags}]}` (top 30 reflexes ≥0.7). The "verify connectivity" bootstrap call.
9. **`brain_ask_oracle`** — `{question(≥3), reasoningLevel?(enum,default medium)}` →
   `OracleResponse`.
10. **`brain_log_event`** — `{sessionId, eventType(enum), payload:object, timestamp?}` →
    `{id, accepted}` (ownership-checked).
11. **`brain_find_skill`** — `{query(≥2), framework?, stage?(enum), limit?(≤20,default5)}` →
    skills by embedding similarity.
12. **`brain_session_search`** — `{query(≥2), limit?(≤50,default10)}` →
    `websearch_to_tsquery` over session prompt + event payload, `ts_rank_cd`, ILIKE fallback.

### 7.4 Resources (read-only, user-scoped)
`brain://user/style-profile`, `brain://user/active-skills`, `brain://user/recent-sessions`,
`brain://user/peer-card` — each returns `{contents:[{uri, mimeType:"application/json", text}]}`.

### 7.5 Multi-tenant enforcement
Every mutation validates ownership: `sessionId`/`knowledgeId` must belong to `auth.userId`
(else `404 NOT_FOUND`); project writes respect token scope (`403 FORBIDDEN_PROJECT`) and
`userCanAccessProject`. `knowledge.updateMany` always includes `ownerUserId: auth.userId`.

### 7.6 `initialize` instructions string
Return the house-rules brief telling the agent to call `brain_get_user_style` first,
`brain_start_session(prompt:…)` per task, apply `relevantKnowledge`, close with
`brain_report_session_outcome` + `learnings`, and that a dropped transport needs an editor
restart (the SDK does not auto-reconnect).

---

## 8. `apps/worker` — background pipeline (pg-boss)

`new PgBoss({connectionString: DATABASE_URL, schema: PG_BOSS_SCHEMA})` (default schema
`pgboss`). On start: `boss.start()` → **explicitly `createQueue` every queue** → register
`boss.work` handlers → register `boss.schedule` crons. Validate `job.data` with zod at the
handler boundary; treat Prisma `P2025` (session gone) as terminal success, not a retry.

> **Invariant — pg-boss v12 schema floor.** pg-boss v12 split the `job` table; a DB last
> touched by v10 fails `boss.start()`. Ship a `scripts/pgboss-version-check.sh` that runs
> before worker start and exits non-zero if the existing `pgboss` schema is below v25.

**Jobs** (name · trigger · payload · retry):

| Job | Trigger | Payload | Retry/expire |
|---|---|---|---|
| `kea.extract` | enqueued on session close | `{sessionId,userId}` | 3 / backoff / 600s, singleton per session |
| `autoskill.run` | enqueued on session close | `{sessionId,userId}` | 3 / backoff / 600s, singleton |
| `kea.cross_extract` | cron `0 6 * * *` | `{}` | 1 / 3600s, singleton |
| `session.sweep_abandoned` | cron `0 7 * * *` | `{}` | 1 / 600s — close sessions idle >24h as `abandoned` |
| `evolution.decay` | cron `0 2 * * *` | `{}` | 2 / backoff / 1800s |
| `evolution.consolidate` | cron `0 3 * * *` | `{}` | 2 / backoff / 1800s |
| `evolution.detect-obsolescence` | cron `0 4 * * 0` (Sun) | `{}` | 2 / 1800s |
| `evolution.health-snapshot` | cron `0 5 * * 0` (Sun) | `{}` | 1 / 600s |
| `embeddings.backfill` | cron `*/10 * * * *` | `{}` | 1 / 600s, singleton |

**Embeddings backfill:** find `Knowledge` (and `Skill`) with `embedding IS NULL AND
deletedAt IS NULL` ordered by `createdAt`, process in batches of 32 (cap 256/cron run),
`embedBatch(trigger+"\n"+rule)` → `UPDATE … SET embedding = toVector(vec)`. Idempotent.

Startup validates env (`envForWorker`), inits Sentry if `SENTRY_DSN` set, logs ready;
add a `SIGTERM` handler to `boss.stop({graceful:true})`.

---

## 9. `apps/web` — Next.js webapp

Next.js App Router, `output:"standalone"`, `transpilePackages:["@brain/core","@brain/db",
"@brain/types"]`, `serverExternalPackages:["@prisma/client",".prisma/client",
"@auth/prisma-adapter"]`, `serverActions.bodySizeLimit:"10mb"`. Tailwind v4.

### 9.1 Theme + i18n shell
`app/layout.tsx` is an async server component that (a) reads a `bp_lang` cookie server-side
for SSR-correct i18n (avoids hydration mismatch), (b) injects a **pre-hydration inline
script** reading `localStorage.bp_tweaks` → sets `data-theme` (dark default / light),
`lang` (en/th/de), `data-density` (spacious/balanced/dense), and CSS vars.

> **Invariant — accent text contrast.** Define **two** accent vars: `--accent` (brand
> *fill*, e.g. lime `#D8FF3E`) and `--accent-text` (AA-tuned *foreground*, theme-aware —
> on light theme the lime resolves to a dark `#5C7A00` for ≥4.5:1 contrast). **Never use
> `color: var(--accent)` for text** — always `var(--accent-text)`. Four accent presets
> (lime/coral/blue/violet), each with a bright (dark-mode) and darkened (light-mode-text)
> value. `globals.css` also defines knowledge-type colors `--k-reflex/-recipe/-heuristic/
> -principle/-anti`.

### 9.2 Auth (`auth.ts`, NextAuth v5, JWT sessions)
Four mutually-exclusive modes resolved at runtime:
- **Credentials** (default pilot): `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` (bcrypt cost 12,
  generated by `pnpm hash-admin-password '<pw>'`); timing-safe compare; admin email from
  `ADMIN_EMAILS[0]`.
- **GitHub OAuth**: `AUTH_GITHUB_ID` + `AUTH_GITHUB_SECRET` + `AUTH_SECRET`; new signups
  gated by `REGISTRATION_REQUIRES_VOUCHER` (voucher in `bp_voucher` cookie).
- **Dev shim**: `ALLOW_DEV_AUTH=true` (refused in production unless
  `ALLOW_DEV_AUTH_IN_PRODUCTION=true`).
- **Unconfigured**: every request → `403 auth_not_configured` (secure default).

Callbacks: `signIn` (user lookup, admin promotion via `ADMIN_EMAILS`, personal-org +
default-project bootstrap, voucher claim), `jwt` (store `userId`), `session` (expose
`userId`). Per-user passwords stored in `UserCredential`; self-service register +
forgot/reset-password flows. `AUTH_TRUST_HOST=true` behind a proxy.

### 9.3 Page routes
- **Public:** `/` (redirect to active project or `/signin`), `/signin`, `/welcome`
  (onboarding + install snippets), `/forgot-password`, `/reset-password`, `/accept-invite`,
  `/docs`.
- **Signed-in:** `/[orgSlug]/[projectSlug]` (the main SPA shell — dashboard, oracle, skills,
  graph, autoskill, sessions, decisions screens, ⌘K palette, rail/bottom-nav),
  `/settings/{password,tokens,projects,org,audit,reset-knowledge}`, `/signout`.
- **Admin (`role:"admin"`):** `/admin`, `/admin/{vouchers,users,org,audit,cost-ledger}`.

### 9.4 API routes (`app/api/**`)
- **Auth:** `/api/auth/[...nextauth]`, `/api/auth/register`, `/api/auth/forgot-password`
  (rate-limited), `/api/auth/reset-password`.
- **Oracle:** `/api/oracle` (unary), `/api/oracle/stream` (SSE), `/api/oracle/feedback`.
- **Tokens:** `/api/tokens` (GET/POST), `/api/tokens/[id]` (GET/DELETE),
  `/api/tokens/[id]/change` (rotate), `/api/tokens/[id]/scope`, `/api/tokens/test`.
- **Knowledge/skills:** `/api/knowledge` (list/create), `/api/knowledge/[id]`
  (GET/PATCH/DELETE soft), `/[id]/related`, `/[id]/promote`, `/[id]/fork-to-project`,
  `/api/knowledge/retrieve`.
- **Dashboard:** `/api/dashboard`, `/api/dashboard/live` (SSE), `/api/dashboard/top-rules`,
  `/api/dashboard/connection-status`.
- **Sessions/autoskill/graph/export:** `/api/sessions`, `/api/sessions/[id]`,
  `/api/autoskill/proposals(/[id])`, `/api/graph`, `/api/export/rules`.
- **Orgs/projects/invites:** `/api/orgs(/[orgId]/{invites,members,audit-log})`,
  `/api/projects(/[id]/activate)`, `/api/invites/{accept,signup}`.
- **Installers (public):** `/api/onboard.sh`, `/api/onboard.ps1`.
- **Admin:** `/api/admin/{vouchers,users,audit-log,cost-ledger,backup-status,
  knowledge/reset,gdpr/export/[userId],gdpr/erase/[userId]}`.
- **Health:** `/api/healthz` (liveness, always 200, includes `.version`), `/api/readyz`
  (DB-connected). The version field is what the prod-drift watchdog reads.

Use a shared `getCurrentUserId()` helper for auth in route handlers; `authErrorResponse()`
for 401/403/503. Rate-limit forgot-password / register / voucher attempts per-IP
(Redis-backed in prod, in-memory fallback).

### 9.5 Components & lib
Shell (`app.tsx`, `shell.tsx`, ⌘K), screens (dashboard/oracle/skills/graph/autoskill/
sessions/decisions), modals (teach, tweaks, user-menu), data widgets (effectiveness-badge,
scope-pill, connection-status), **`token-install-wizard.tsx`** (renders the §6.12 snippets),
`welcome-flow.tsx`/`onboarding.tsx`, locale picker + `lang-provider`. Lib: data hooks
(`use-oracle` SSE, `use-knowledge`, `use-dashboard`, `use-graph`, …), `i18n.ts` (EN/TH/DE),
`tweaks.ts` (zustand), `vouchers.ts`, `active-project.ts`, installer templates.

### 9.6 Design philosophy
**Progressive disclosure / quiet by default:** dashboard opens calm, depth behind a
"show everything" fold; autoskill queue only when proposals exist; empty states show a
single CTA ("connect a tool"). Earned surface area, not a wall of dials.

---

## 10. Deploy & infra

### 10.1 Docker Compose (`deploy/docker-compose.yml`)
Core services (always): **`db`** (`pgvector/pgvector:pg16`, loopback `127.0.0.1:5432`,
volume `brain_db`, `pg_isready` healthcheck), **`web`** (port 3000, `/api/healthz`
healthcheck, depends_on db healthy), **`mcp-server`** (`MCP_TRANSPORT=http`, port 3100,
`/health` healthcheck), **`worker`** (no host port), **`bootstrap`** (one-shot profile for
migrate/seed). Edge profile (`--profile edge`): **`redis`** (`redis:7-alpine`, rate-limit
state), **`backup`** (`prodrigestivill/postgres-backup-local`, nightly `0 3 * * *`,
volume `brain_backups`), optional **`backup-replicate`** (rclone off-host), **`caddy`**
(auto-TLS on 80/443, depends on web+mcp healthy). All host ports bind `127.0.0.1` by
default — **never `0.0.0.0` in prod** (the lockdown audit checks this).

### 10.2 Dockerfile (multi-stage, `deploy/Dockerfile`)
`base` (node:20-slim + corepack pnpm@9.15.0, `pnpm install --frozen-lockfile`,
`prisma generate`, BuildKit cache-mount the pnpm store) → `builder` (`SKIP_DB_INIT=1`,
build-arg `APP_VERSION` → `NEXT_PUBLIC_APP_VERSION`, cache-mount `.next/cache`, build web)
→ `web` (standalone bundle, runs `node apps/web/server.js`) → `mcp-server` + `worker`
(run TS from src via `tsx`). All final stages run as the non-root `node` user.
`Caddyfile.Dockerfile` builds Caddy with the `mholt/caddy-ratelimit` plugin via xcaddy.

### 10.3 Scripts
- **`dev-up.sh`** — local bring-up (no TLS): preflight → build → start db → create `vector`
  extension → `prisma migrate deploy` → apply FTS SQL → seed (if `SEED_ON_DEPLOY`) →
  backfill embeddings (if a key is set) → start web/mcp/worker → run `verify-lockdown.sh` →
  print endpoints. Idempotent.
- **`deploy.sh`** — production: requires clean worktree + configured auth + public
  hostnames + `CADDY_EMAIL`; refuses `ALLOW_DEV_AUTH=true`; build → migrate → FTS → start
  with `--profile edge` → wait for TLS `/api/healthz` → **hard** lockdown audit (fails
  deploy) → smoke tests.
- **`reload.sh <svc…>`** — rebuild + `--force-recreate` one service for fast iteration
  (skips DB wait); re-runs lockdown if web reloaded.
- **`verify-lockdown.sh`** — detects auth mode, asserts `/api/healthz` 200, root bounces to
  signin, `/api/knowledge` is 401/403 (or 503 unconfigured — never 200), `POST /mcp` without
  Bearer is 4xx (incl. initialize), and DB/web/mcp aren't bound to `0.0.0.0`. Exit 0=locked,
  1=leak, 2=unreachable.
- **`smoke.sh`** — public tier (`/api/healthz`, MCP `/health`) + authed tier (MCP session
  lifecycle: initialize → notifications/initialized → tools/list → DELETE) when
  `BRAIN_MCP_TOKEN` is set.
- **`release.sh vX.Y.Z [--publish]`**, **`pgboss-version-check.sh`**, **`hash-admin-password.ts`**.

### 10.4 CI/CD (GitHub Actions)
- **`ci.yml`** (required): pgvector service → `prisma generate` → migrate fresh DB +
  apply FTS (the day-zero migration gate) → `turbo run typecheck` → `turbo run test`
  (DB-gated incl. **cross-tenant isolation** tests) → `turbo run build`.
- **`onboarding-e2e.yml`** (required, path-gated to anon surfaces): build web, Playwright
  chromium, run `/welcome` + healthz specs unauthenticated.
- **`authed-e2e.yml`** (required, path-gated): credentials mode + seeded fixture, run
  dashboard/sessions/skills/nav/mobile specs (e.g. assert ≥16 skills).
- **`prod-drift.yml`** (daily): compare deployed `/api/healthz`.version vs `git describe`
  on main; open/close a `prod-drift` issue.

---

## 11. Environment variable catalog (`.env.example`)

> Secure-by-default: shipping with **no** auth mode set leaves the instance locked (503).
> Pick a provider key + an auth mode to go live.

**Database / jobs:** `DATABASE_URL` (required), `POSTGRES_USER/PASSWORD/DB` (compose),
`PG_BOSS_SCHEMA` (`pgboss`), `REDIS_URL` (edge rate-limit; empty → in-process).

**LLM providers:** `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`
(gateway: Z.ai/Bedrock), `DASHSCOPE_API_KEY` (Qwen/GLM), `GOOGLE_GEMINI_API_KEY`.

**Embeddings:** `EMBEDDING_MODEL` (`text-embedding-3-small`), `EMBEDDING_DIMENSIONS`
(`1536`, schema-locked), `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`.

**Models:** `ORACLE_MODEL`, `KEA_MODEL`, `KEA_REFINE_MODEL`, `CROSS_SESSION_KEA_MODEL`,
`CROSS_SESSION_WINDOW` (`20`).

**Auth/secrets:** `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_EMAILS`,
`AUTH_GITHUB_ID/SECRET`, `AUTH_SECRET` (`openssl rand -base64 32`), `AUTH_URL`/`NEXTAUTH_URL`,
`AUTH_TRUST_HOST`, `ALLOW_DEV_AUTH`, `ALLOW_DEV_AUTH_IN_PRODUCTION`, `DEV_USER_ID`,
`REGISTRATION_REQUIRES_VOUCHER` (`true`).

**MCP:** `MCP_TRANSPORT` (`http`), `MCP_SERVER_HTTP_PORT` (`3100`), `MCP_TOKEN_SECRET`.

**Public hostnames / ports:** `BRAIN_PUBLIC_HOSTNAME`, `BRAIN_MCP_PUBLIC_HOSTNAME`,
`CADDY_EMAIL`, `WEB_HOST_PORT/BIND`, `MCP_HOST_PORT/BIND`, `POSTGRES_HOST_PORT/BIND`.

**Kill-switches:** `KEA_ENABLED`, `AUTOSKILL_ENABLED`, `ORACLE_ENABLED`, `MCP_ENABLED` (all `true`).

**Cost & rate limits:** `MAX_ORACLE_COST_USD_PER_DAY` (`10`), `MAX_KEA_COST_USD_PER_SESSION`
(`0.05`), `RATE_LIMIT_ORACLE_PER_DAY`, `RATE_LIMIT_KEA_PER_HOUR`, `RATE_LIMIT_MCP_PER_MINUTE`.

**Email (optional):** `EMAIL_PROVIDER` (`resend`/disabled), `EMAIL_API_KEY`, `EMAIL_FROM`,
`EMAIL_REPLY_TO`.

**Observability / deploy:** `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `LOG_LEVEL` (`info`),
`NODE_ENV`, `SEED_ON_DEPLOY`, `APP_VERSION` (build-arg), `DEPLOY_ALLOW_DIRTY`,
`DEPLOY_SKIP_SMOKE`. **Backup:** `BACKUP_REMOTE`, `BACKUP_INTERVAL`.

---

## 12. Acceptance criteria (definition of done)

A faithful recreation passes all of:

1. **Migration gate:** `prisma migrate deploy` on a fresh pgvector DB + FTS SQL succeeds;
   seed yields the deterministic fixture; `turbo run typecheck|test|build` all green.
2. **MCP auth invariant:** `POST /mcp` `initialize` with no Bearer → 401; with a valid
   `bp_` token, a full `brain_start_session → brain_report_session_outcome` round-trip
   creates a session and enqueues `kea.extract`+`autoskill.run`.
3. **Loop closes:** the worker drains those jobs, KEA persists ≥0 typed Knowledge rows,
   embeddings backfill populates NULL vectors, and a subsequent `brain_start_session(prompt)`
   injects relevant knowledge by meaning.
4. **Oracle grounding:** `brain_ask_oracle` returns an answer with `[^K]/[^S]` citations and
   a `groundedness` value; cost is metered in `OracleCostLedger` and capped per day.
5. **Tenant isolation:** a second user's queries never see the first user's knowledge
   (automated cross-tenant test).
6. **Secure-by-default:** with auth unconfigured, web returns 503; `verify-lockdown.sh`
   prints PASS for the chosen mode and flags any `0.0.0.0` binding.
7. **Decay/decision semantics:** unused rules lose `decayScore` over time; rows tagged
   `decision` are exempt; duplicates (cosine > 0.92, same type) merge.
8. **Snippet correctness:** unit tests pin `antigravity → serverUrl` and
   `githubCopilotJetbrains → requestInit.headers`.
9. **Stack up:** `./scripts/dev-up.sh` brings up db/web/mcp/worker; web at `:3000`, MCP at
   `:3100/mcp`; sign in, mint a token, ask the Oracle, browse Skills.

---

## 13. Suggested first prompt to your agent

> "Read `RECREATE_EXTERNAL_BRAIN.md` in full. We're building the External Brain platform
> from scratch in this empty repo. Start with **Phase 1**: scaffold the pnpm + Turborepo
> monorepo (`apps/*`, `packages/*`), then implement `@brain/types` and `@brain/db`
> (full Prisma schema with the pgvector `embedding vector(1536)` columns, the raw-SQL
> `searchKnowledgeByEmbedding`/`toVector` helpers, the FTS SQL file, and the deterministic
> seed). Stop at the Phase 1 checkpoint and show me a fresh `prisma migrate deploy` + seed
> succeeding against a local pgvector Postgres before moving on. Honor every Invariant
> callout — especially the package boundary and the `embedding`/scoping design."

Build phase by phase, run the checkpoint after each, and keep the §12 acceptance criteria
as the running definition of done.
