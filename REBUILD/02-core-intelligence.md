# Phase 2 — Intelligence Core: `@brain/core`

> **Before starting:** Phase 1 checkpoint must be green (migrations + seed passing).
> This is Phase 2 of 6. All intelligence lives here — KRA, KEA, Oracle, decay, cost,
> embeddings, snippets. Three runtimes (mcp-server, web, worker) share this one package.
> Build it completely and pass the checkpoint before opening Phase 3.

---

## Agent prompt (copy this verbatim to start Phase 2)

```
Phase 1 is complete (monorepo + types + db). Now build Phase 2: the @brain/core package.

This is the intelligence layer — ALL business logic lives here so the three runtimes
(mcp-server, web, worker) share a single implementation. No intelligence should leak
into apps.

Implement in this order (each depends on the previous):
1. env.ts — typed env loaders for each runtime
2. llm.ts — provider abstraction (Anthropic / OpenAI / DashScope routing)
3. embedding.ts — embed(), embedBatch(), cosineSimilarity() with LRU cache
4. kra.ts — retrieve() with KRA scoring (0.70/0.08/0.08/0.08/0.06 weights)
5. cost.ts — reserveCapSlot, recordCall, checkCap, OracleCostLedger
6. kea.ts — extractFromSession (mine + refine modes), extractFromCrossSessions
7. oracle.ts + oracle-sse.ts — ask() + askStream() with citation mapping
8. evolution.ts — decayUnused, consolidateDuplicates, snapshotKnowledgeHealth
9. learnings.ts — LearningSchema, supersedeKnowledge, decision helpers
10. scope-filter.ts — buildKnowledgeWhereV2, buildRawProjectFilterV2
11. formatter.ts — formatForInjection (decisions first)
12. install-snippets.ts — all 11 client snippet generators
13. Miscellaneous helpers: projects.ts, logger.ts, errors.ts, autoskill.ts

Stop at the Phase 2 checkpoint and show passing unit tests before proceeding.

Spec: REBUILD/02-core-intelligence.md
```

---

## 2.1 Package setup

```
packages/core/package.json    — name: "@brain/core"
packages/core/src/
  env.ts
  llm.ts
  embedding.ts
  kra.ts
  cost.ts
  kea.ts
  oracle.ts
  oracle-sse.ts
  evolution.ts
  learnings.ts
  scope-filter.ts
  formatter.ts
  install-snippets.ts
  projects.ts
  logger.ts
  errors.ts
  autoskill.ts
  autoskill-classifier.ts     — LLM type-decision for proposals (v1.10.0)
  index.ts                    — re-exports
packages/core/src/__tests__/  — unit tests (Vitest)
```

```json
// packages/core/package.json
{
  "name": "@brain/core",
  "dependencies": {
    "@brain/db": "workspace:*",
    "@brain/types": "workspace:*",
    "@anthropic-ai/sdk": "^0.24.0",
    "openai": "^4.0.0",
    "zod": "^4.0.0"
  },
  "scripts": {
    "build":     "tsc",
    "typecheck": "tsc --noEmit",
    "test":      "vitest run"
  }
}
```

---

## 2.2 Env loader (`env.ts`)

Three functions, each validates and returns a typed object. Throw `Error` on missing
required vars (do not silently default `DATABASE_URL`).

```typescript
export function envForMcp() {
  return {
    DATABASE_URL:          required("DATABASE_URL"),
    MCP_TRANSPORT:         process.env.MCP_TRANSPORT ?? "http",
    MCP_SERVER_HTTP_PORT:  Number(process.env.MCP_SERVER_HTTP_PORT ?? 3100),
    MCP_ENABLED:           process.env.MCP_ENABLED !== "false",
    KEA_ENABLED:           process.env.KEA_ENABLED !== "false",
    ORACLE_ENABLED:        process.env.ORACLE_ENABLED !== "false",
    AUTOSKILL_ENABLED:     process.env.AUTOSKILL_ENABLED !== "false",
    // ... LLM keys, embedding vars
  };
}

export function envForWorker() { /* same pattern */ }
export function envForWeb()    { /* same pattern */ }

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}
```

---

## 2.3 LLM provider abstraction (`llm.ts`)

Route calls to the correct SDK by model-name prefix and env var presence:

```
Model name starts with "claude" OR ANTHROPIC_BASE_URL is set
  → Anthropic SDK  (pass baseURL if ANTHROPIC_BASE_URL set — enables Z.ai / Bedrock gateway)

Model name starts with "qwen" OR "glm"
  → OpenAI-compatible SDK with base URL:
    https://dashscope-intl.aliyuncs.com/compatible-mode/v1
    API key: DASHSCOPE_API_KEY

Everything else
  → OpenAI SDK (uses OPENAI_API_KEY + OPENAI_BASE_URL if set)
```

Model env vars with defaults:
- `ORACLE_MODEL` — used for Oracle Q&A and cross-session KEA
- `KEA_MODEL` — per-session extraction
- `KEA_REFINE_MODEL` — defaults to `KEA_MODEL`
- `CROSS_SESSION_KEA_MODEL` — defaults to `ORACLE_MODEL`

Expose a `callLLM(opts: {model, systemPrompt, userPrompt, maxTokens}): Promise<string>`
that routes and returns the text. Always call `recordCall(...)` after a billable response.

---

## 2.4 Embeddings (`embedding.ts`)

```typescript
export async function embed(text: string): Promise<number[]>
export async function embedBatch(texts: string[]): Promise<number[][]>
export function cosineSimilarity(a: number[], b: number[]): number
```

**Provider chain (first success wins):**
1. **Gemini**: if `GOOGLE_GEMINI_API_KEY` is set → `gemini-embedding-001` via
   `https://generativelanguage.googleapis.com/v1beta/openai/embeddings`.
   **Do NOT send a `dimensions` parameter** — Gemini's OpenAI-compat layer rejects
   dimension arguments it doesn't expect and silently breaks the embedding.
2. **Fallback**: `EMBEDDING_MODEL` (default `text-embedding-3-small`, 1536 dims) via
   `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` (OpenAI-compatible).

**In-process LRU cache**: SHA-256 of the input text → cached `number[]`. Max 5000 entries.
If cache hits, return immediately without a network call.

**Retry on transient errors** (429, 408, 5xx): one retry with the next provider. If all
providers fail, throw a retryable `BrainError({code:"EMBED_FAILED", retryable:true})`.

---

## 2.5 Retrieval — KRA (`kra.ts`)

```typescript
export async function retrieve(
  prompt: string,
  context: SessionContext,
  maxItems = 10
): Promise<KnowledgeBundle>

export async function retrieveScored(
  prompt: string,
  context: SessionContext,
  maxItems?: number
): Promise<Array<Knowledge & { score: number }>>
```

**Algorithm:**

1. `embed(prompt)` → vector
2. `searchKnowledgeByEmbedding(vector, { ownerUserId, limit: 20 })` → candidates
3. For each candidate, compute the composite score:

```
score = 0.70 * similarity
      + 0.08 * successRate
      + 0.08 * recencyDecay
      + 0.08 * contextFit
      + 0.06 * confidence
```

Where:
- **`similarity`**: from pgvector cosine distance (1 - distance)
- **`successRate`**: Laplace smoothed `(successCount + 1) / (successCount + failureCount + 2)`.
  Floor to 0.5 when total outcomes < 3 (insufficient data)
- **`recencyDecay`**: `Math.exp(-daysSince / 90)` using `confirmedAt ?? createdAt`
- **`contextFit`**: start at 0.5; add:
  - +0.3 if `knowledge.framework === context.framework`
  - +0.2 if `knowledge.language === context.language`
  - +0.2 if knowledge is `scope:"project"` and `context.projectId` matches
  - +0.2 if `context.sessionMode === "debugging"` AND `type === "heuristic"` AND `tags.includes("debugging")`
  - Cap at 1.0
- **`confidence`**: raw `knowledge.confidence` value (0–1)

4. Filter: drop items with `score < 0.45`
5. Sort descending by score
6. Cap at max 3 items per `KnowledgeType`
7. Take top `maxItems`

**Side effects (on selected items):**
- Write `SessionKnowledgeApplication(role: "injected")` for each selected row
- `UPDATE Knowledge SET usageCount = usageCount + 1, lastUsedAt = now()` for each

**Return:** `KnowledgeBundle` (grouped by type) + `injectedIds`

**Visibility filtering**: apply `buildKnowledgeWhereV2(args)` from `scope-filter.ts` — do
not return knowledge the context user cannot see.

---

## 2.6 Extraction — KEA (`kea.ts`)

```typescript
export async function extractFromSession(
  payload: {
    sessionId: string;
    userId: string;
    summary?: string;
    learnings?: Array<LearningSchema>;
  },
  opts?: { model?: string }
): Promise<{ extracted: number; skipped: number }>
```

**Refine mode** (agent submitted `learnings`):
1. Split off items with `source: "decision"` — bypass the judge entirely. Create them
   directly as `Knowledge` with `scope: "project"`, `tags: ["decision", "close_capture"]`,
   `confidence: min(submitted, 0.95)`. No dedup check for decisions.
2. Send remaining learnings through `defaultRefineJudge`: an LLM call that validates
   durability and specificity. Ask "is this trigger/rule pair durable enough to reuse in
   a different codebase? Score 0–1." Drop items where judge confidence < 0.7.
3. Clamp all `confidence ≤ 0.95`.

**Mine mode** (no learnings — session text only):
1. Build a summary from session events + outcome
2. Call `KEA_MODEL` with the extraction prompt over the summary
3. Parse response as `KEAFinding[]`:
   ```typescript
   interface KEAFinding {
     type: KnowledgeType;
     scope: KnowledgeScope;
     trigger: string;   // ≥10 chars
     rule: string;      // ≥20 chars
     rationale: string;
     confidence: number; // 0–1
   }
   ```

**Quality filter (both modes):**
- Take top 3 by confidence
- Drop: `confidence < 0.7`, `trigger.length < 10`, `rule.length < 20`
- Drop generic short rules (e.g. "Use TypeScript" with rule < 40 chars)
- **Cosine dedup**: embed `trigger + "\n" + rule` for each candidate. If cosine similarity
  to an existing Knowledge row > 0.85 (same type, same owner), bump that row's confidence
  by +0.05 instead of inserting a duplicate.

**Persist** (in a transaction):
1. `embed(trigger + "\n" + rule)` for each surviving candidate
2. `db.knowledge.create(...)` with the vector
3. `db.sessionKnowledgeApplication.create(role: "extracted_from")`
4. Write an `AuditLog` row: action `kea.extract_session`

**`extractFromCrossSessions`**: requires ≥ 2 sessions; uses `CROSS_SESSION_KEA_MODEL`;
tags output `cross_session`. Run by the daily `kea.cross_extract` worker job.

---

## 2.7 Oracle (`oracle.ts`, `oracle-sse.ts`)

```typescript
// oracle.ts
export async function ask(
  userId: string,
  query: string,
  projectId?: string,
  dataScope?: "project" | "all",
  visibilityArgs?: object
): Promise<OracleResponse>

// oracle-sse.ts
export async function* askStream(
  userId: string,
  query: string,
  opts?: { projectId?: string; dataScope?: string; reasoningLevel?: OracleReasoningLevel }
): AsyncGenerator<OracleStreamEvent>

type OracleStreamEvent =
  | { type: "meta";  groundedness: OracleGroundedness; retrievedCounts: {...} }
  | { type: "delta"; text: string }
  | { type: "final"; citations: OracleCitation[]; confidence: string; tokensUsed: number }
  | { type: "error"; message: string }
  | { type: "done" }
```

**Implementation steps:**

1. **Reserve cost atomically**: call `reserveCapSlot(userId, $0.05)` under a Postgres
   advisory lock `pg_advisory_xact_lock(userId, today)`. Throw `OracleCapExceededError`
   if the user's daily spend plus reservation exceeds `MAX_ORACLE_COST_USD_PER_DAY`.

2. **Build context**:
   - `embed(query)` → top 12 Knowledge (visibility-filtered via `buildRawProjectFilterV2`)
   - Top 10 recent Sessions (ordered by `startedAt DESC`)
   - Format each Knowledge as `[^K1] triggerText: ruleText` etc.
   - Format each Session as `[^S1] prompt excerpt + outcome`

3. **Compute groundedness** (pre-LLM, from retrieval counts):
   - `k = knowledge count`, `s = session count`
   - `"none"` if k=0 and s=0
   - `"strong"` if k ≥ 6
   - `"moderate"` if k ≥ 3 OR (k ≥ 1 AND s > 0)
   - else `"weak"`

4. **Build system prompt**:
   - If context is non-empty: grounding prompt with citation instructions (`[^K1]`, `[^S1]`)
   - If context is empty: "You have no recorded knowledge for this. Acknowledge the absence
     honestly; do not fabricate answers."

5. **Max tokens by reasoning level**:
   `minimal=256, low=512, medium=1024, high=2048, max=4096`

6. **Stream or batch call** to `ORACLE_MODEL`

7. **Post-processing**:
   - `mapCitations(answer, knowledge, sessions)` — parse `[^K\d+]`/`[^S\d+]` markers →
     `OracleCitation[]` with `knowledgeId`/`sessionId` and excerpt
   - `recordCall(userId, day, tokensInput, tokensOutput, modelName)` — net against reservation
   - Return `OracleResponse`

---

## 2.8 Cost ledger (`cost.ts`)

```typescript
// Per-model $/1M token table — include these families:
// Claude (claude-3-5-*, claude-3-*), GPT (gpt-4o*, gpt-4-*, gpt-3.5*)
// GLM/Qwen (glm-4*, qwen*) — unknown model: $15/$75 fallback

export async function reserveCapSlot(userId: string, amountUsd: number): Promise<void>
export async function recordCall(
  userId: string,
  day: Date,
  tokensIn: number,
  tokensOut: number,
  model: string
): Promise<void>
export async function checkCap(userId: string): Promise<{ used: number; cap: number; pct: number }>
```

**`reserveCapSlot`**: use `db.$queryRaw` with `SELECT pg_advisory_xact_lock(...)` in a
transaction; then `db.oracleCostLedger.upsert` to add the reservation. If `used + amount >
cap`, throw `OracleCapExceededError`. Warn in logs at 80% of cap (deduplicated per user-day).

---

## 2.9 Decay & evolution (`evolution.ts`)

```typescript
export async function decayUnused(): Promise<{ updated: number }>
export async function consolidateDuplicates(): Promise<{ merged: number }>
export async function snapshotKnowledgeHealth(): Promise<void>
export async function detectObsolescence(): Promise<void>
```

**`decayUnused`**:
```
halfLife = 90 days baseline
  → 45 days if effectiveness < 0.3 AND outcomes ≥ 5
  → 180 days if effectiveness ≥ 0.7

decay = Math.max(Math.exp(-daysSinceLastUsed / halfLife), 0.05)
```
- `daysSinceLastUsed` from `lastUsedAt ?? createdAt`
- Cursor-paginate 1000 rows per run
- **Rows tagged `decision` are NEVER decayed** — skip them entirely
- Flag rows with `effectiveness < 0.3` AND `usageCount ≥ 5` AND unused 30d:
  add tag `flagged:low-effectiveness`

**`consolidateDuplicates`**:
- Per user: pull stored embeddings via `embedding::text` (avoid re-embedding)
- Compare same-type pairs; merge when cosine > 0.92
- On merge: keep the older row, soft-delete the younger (`deletedAt = now()`),
  `confidence += 0.02`, sum `successCount` + `failureCount` + `usageCount`

**`effectivenessScore(k: Knowledge)`**:
```typescript
// Returns -1 ("insufficient") when total < 3 — UI shows "— Untested"
const total = k.successCount + k.failureCount;
return total >= 3 ? k.successCount / total : -1;
```

**Also export:**
- `bulkBumpKnowledgeOutcome(ids, outcome: "success"|"failure")` — used by worker on session close
- `bulkBumpKnowledgeUsage(ids)` — bump `usageCount` in batch
- `getTopRules(userId, limit)` — top knowledge by effectiveness × confidence

---

## 2.10 Learnings (`learnings.ts`)

```typescript
import { z } from "zod";

export const LearningSchema = z.object({
  trigger:    z.string().min(10).max(500),
  rule:       z.string().min(20).max(2000),
  rationale:  z.string().min(1).max(2000),
  type:       z.enum(["reflex","recipe","heuristic","principle","anti_principle"]),
  source:     z.enum(["user_correction","decision","discovery"]),
  confidence: z.number().min(0).max(1).optional(),
});
export type LearningInput = z.infer<typeof LearningSchema>;

export const LEARNING_EVENT_TYPE    = "learning_captured";
export const MAX_LEARNINGS_PER_SESSION = 5;
export const MAX_SUBMITTED_CONFIDENCE  = 0.95;
export const DECISION_TAG              = "decision";

export async function supersedeKnowledge(
  db: PrismaClient,
  { newId, supersededId, userId }: { newId: string; supersededId: string; userId: string }
): Promise<void>
// Soft-deletes supersededId, links newId.parentKnowledgeId = supersededId
// Never throws — log and continue if the old row is already deleted
```

---

## 2.11 Scope filters (`scope-filter.ts`)

```typescript
// Both helpers take the SAME full args object. activeOrgId +
// accessibleProjectIds are REQUIRED to enforce org-scoped visibility — kra.ts
// passes this exact shape, so a simplified signature won't compile against it.
export interface VisibilityScopeArgs {
  userId: string;
  activeProjectId: string | null;
  activeOrgId: string | null;
  /** All project IDs in the active org that this user can access. */
  accessibleProjectIds: string[];
  scope: "project" | "all";
}

// For Prisma `where` clauses
export function buildKnowledgeWhereV2(args: VisibilityScopeArgs): object // Prisma.KnowledgeWhereInput

// For raw pgvector queries
export function buildRawProjectFilterV2(
  args: VisibilityScopeArgs,
  startParam: number, // the next $N placeholder index
): { sql: string; params: (string | null)[] }
```

**Visibility rules:**
- `visibility = "private"`: only the owner can see it
- `visibility = "project"`: owner + anyone with access to the same project
- `visibility = "org"`: owner + anyone in the same organization

Apply these on top of `ownerUserId` / `ownerProjectId` / `organizationId` filters.

---

## 2.12 Formatter (`formatter.ts`)

```typescript
export function formatForInjection(bundle: KnowledgeBundle): string
```

**Format order: decisions first, then other types.**
Within each type, show the rule with success rate (when ≥3 outcomes) or confidence.

```markdown
## Relevant Knowledge

### Decisions (settled facts)
- **[DECISION]** When X: Do Y. (instead of Z)

### Reflexes
- Trigger: Rule. [74% success]

### Anti-patterns to avoid
- Trigger: Rule. [confidence: 0.85]
```

Decisions are items with `"decision" in knowledge.tags`. They appear first regardless of
type. This is the string injected into the AI's context at session open.

---

## 2.13 Install snippets (`install-snippets.ts`)

```typescript
export interface InstallSnippet {
  kind: "shell" | "json" | "rest";
  lines: string[];
  note?: string;
  configPath?: string;
}

export function generateClaudeCodeCli(token: string, mcpUrl: string): InstallSnippet
export function generateClaudeDesktop(token: string, mcpUrl: string): InstallSnippet
export function generateCursor(token: string, mcpUrl: string): InstallSnippet
export function generateWindsurf(token: string, mcpUrl: string): InstallSnippet
export function generateGeminiCli(token: string, mcpUrl: string): InstallSnippet
export function generateAntigravity(token: string, mcpUrl: string): InstallSnippet
export function generateGithubCopilotVscode(token: string, mcpUrl: string): InstallSnippet
export function generateGithubCopilotJetbrains(token: string, mcpUrl: string): InstallSnippet
export function generateGithubCopilotCli(token: string, mcpUrl: string): InstallSnippet
export function generateRawMcpServersJson(token: string, mcpUrl: string): InstallSnippet
export function generateRestApiCurl(token: string, oracleUrl: string): InstallSnippet
```

> **INVARIANT — these shapes are tested in unit tests. Get them exactly right:**

| Client | Top-level key | Auth key | Notable difference |
|--------|--------------|----------|--------------------|
| `claudeCodeCli` | — (shell) | `Bearer <token>` in curl command | `onboard.sh` installer |
| `claudeDesktop` | `mcpServers.brain` | `headers.Authorization` | `transport:{type:"http",url}` |
| `cursor` | `mcpServers.brain` | `headers.Authorization` | Same as Claude Desktop |
| `windsurf` | `mcpServers.brain` | `headers.Authorization` | Same |
| `geminiCli` | `mcpServers.brain` | `headers.Authorization` | Same |
| **`antigravity`** | `mcpServers.brain` | `headers.Authorization` | **`serverUrl`** (NOT `url`) |
| `githubCopilotVscode` | **`servers`** | `headers.Authorization` | `type:"http"` + `url` |
| **`githubCopilotJetbrains`** | **`servers`** | **`requestInit.headers.Authorization`** | No `type` field |
| `githubCopilotCli` | `mcpServers` | `headers.Authorization` | `type:"http"` |

The two bold rows are **silent-failure traps** — the wrong key produces zero errors
but the AI tool never connects.

---

## 2.14 Project helpers (`projects.ts`)

```typescript
export async function ensureDefaultProject(userId: string, orgId: string): Promise<Project>
export async function ensureNamedProject(userId: string, name: string, orgId: string): Promise<Project>
export async function getUserProjects(userId: string): Promise<Project[]>
export async function userCanAccessProject(userId: string, projectId: string): Promise<boolean>
```

---

## 2.15 Logger, errors, autoskill

**`logger.ts`**: `getLogger(name)` returns a structured logger that writes JSON to
`stderr` (critical for stdio MCP — stdout is reserved for JSON-RPC). Include `shortId(id)`
helper that returns the first 8 chars of a CUID for log-safe references.

**`errors.ts`**:
```typescript
export class BrainError extends Error {
  constructor(public opts: {
    code: string;
    message: string;
    status: number;
    category?: string;
    retryable?: boolean;
  }) { super(opts.message) }
}
export class OracleCapExceededError extends BrainError {}
```

**`autoskill.ts`**: `runForSession(sessionId, userId)` — stub is fine for Phase 2.
Full implementation: analyze the session's events, produce `AutoskillProposal` rows.
Mark with `confidence: "medium" | "high"`. Status starts `"pending"`.

**`autoskill-classifier.ts`** (v1.10.0): the proposal's *type* decision
(`rules` / `knowledge` / `ignore`) is made by an LLM, not keyword regexes. Keep the
cheap deterministic stages in `autoskill.ts` (score gate, conflict dedup, the
4-question quality filter, the embedding skill short-circuit); only the *type*
decision for surviving signals goes to **one batched `callLLM`** (the `llm.ts` seam
from §2.3). Build it as **pure cores** — `parseClassifierResponse`,
`routedFromVerdict`, `decideTarget`, `buildClassifierPrompt`, `rankFewShot` — with
the LLM call injected as `deps.call` so they unit-test keyless (§2.16). Few-shot is
hybrid: static gold examples + the user's own resolved `AutoskillProposal` rows
(applied = positive, rejected = ignore), ranked by recency within
`AUTOSKILL_FEWSHOT_TOKEN_BUDGET`, fail-soft to gold-only at cold-start.
**Fail-soft is mandatory**: any LLM error / invalid output / missing verdict falls
back to the keyword heuristic *per signal* — a signal is never dropped. Rollout is
flag-gated: `AUTOSKILL_LLM_CLASSIFIER` (default off) drives behaviour;
`AUTOSKILL_SHADOW` (default off) only logs heuristic-vs-LLM agreement
(`autoskill.classify.shadow`). Both off → zero extra LLM calls. No DB migration
(`target` / `status` are `String` columns). Rationale: the keyword router couldn't
judge durability, so it had to cap `knowledge` at `score>=5`; the LLM lifts recall
on durable sub-score-5 rules without lowering precision (the quality filter stays
the floor).

---

## 2.16 Unit tests

Create `packages/core/src/__tests__/` with Vitest tests for:

**`kra.scoring.test.ts`** — test the composite score formula:
```typescript
import { describe, it, expect } from "vitest";

describe("KRA scoring", () => {
  it("weights similarity at 70%", () => {
    // Given a knowledge item with similarity 0.8 and all other factors at baseline
    // score should be approximately 0.8 * 0.70 + baselines
    expect(computeScore({ similarity: 0.8, ... })).toBeCloseTo(0.56 + baselines);
  });

  it("floors successRate at 0.5 when outcomes < 3", () => {
    const rate = computeSuccessRate(0, 0);
    expect(rate).toBe(0.5);
  });

  it("filters items below 0.45 threshold", () => {
    const results = diversify([{ score: 0.44 }, { score: 0.46 }]);
    expect(results).toHaveLength(1);
  });

  it("caps at 3 items per type", () => {
    const six_reflexes = Array.from({ length: 6 }, (_, i) =>
      ({ type: "reflex", score: 0.9 - i * 0.01 })
    );
    expect(diversify(six_reflexes).filter(k => k.type === "reflex")).toHaveLength(3);
  });
});
```

**`decay.test.ts`** — test decay formula:
```typescript
it("decision-tagged knowledge never decays", () => {
  const result = computeDecay({ tags: ["decision"], daysSinceLastUsed: 365 });
  expect(result).toBe(1.0); // untouched
});

it("floors at 0.05", () => {
  const result = computeDecay({ tags: [], daysSinceLastUsed: 10000 });
  expect(result).toBe(0.05);
});

it("uses 45-day half-life for low-effectiveness rules", () => {
  const result = computeDecay({ effectiveness: 0.2, outcomes: 10, days: 45 });
  expect(result).toBeCloseTo(0.5, 1);
});
```

**`cost.test.ts`** — test per-model pricing lookup and cap enforcement.

**`install-snippets.test.ts`** — **these two tests are mandatory**:
```typescript
import { generateAntigravity, generateGithubCopilotJetbrains } from "../install-snippets";

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

---

## Phase 2 checkpoint

```bash
# Unit tests must all pass
pnpm turbo run test --filter=@brain/core

# Typecheck the full workspace (types + db + core)
pnpm turbo run typecheck --filter=@brain/types --filter=@brain/db --filter=@brain/core
```

**Pass criteria:**
- [ ] `turbo run test --filter=@brain/core` exits 0, all unit tests green
- [ ] KRA scoring formula tests pass (weights, floor, cap, threshold)
- [ ] Decay tests pass (decision exemption, floor at 0.05, half-life variants)
- [ ] **Install-snippet tests pass** (antigravity `serverUrl`, JetBrains `requestInit.headers`)
- [ ] `typecheck` exits 0 for all three packages
- [ ] No `any` types in `@brain/core/src/` (checked by strict TS)
- [ ] All 11 snippet generators return valid JSON/shell (parseable in tests)

**Do not start Phase 3 until all boxes are checked.**

---

## Ready for Phase 3

Open `03-mcp-server.md`.
