# Implementation Stubs — Copy-Paste Seeds for Building the Platform
*Added 2026-04-20 | Concrete starting points for AI agents beginning implementation*

---

## 1. Purpose

This document provides **ready-to-use implementation seeds** for the hardest-to-invent parts of the system:
- Complete prompt templates (KEA, KRA scoring, Oracle)
- MCP tool JSON Schemas
- SSE event schemas (for Path A/R vibe-coding clients)
- Core API contracts
- Prisma schema extensions
- Environment variables

Copy, adapt, refine with real testing. These are starting points, not final specs.

**When to use:** You have chosen a build path and are ready to write code. These stubs fill the most commonly-needed gaps.

**When NOT to use:** For general architectural questions, use docs 00-13. For library-specific questions (e.g. "how does Prisma migrate?"), use the library's official docs.

---

## 2. KEA — Knowledge Extraction Agent

### System Prompt (ready to copy)

```
You are a knowledge extraction agent for a coding AI platform.

Your job: given a summary of a completed coding session, extract 0-3 structured
knowledge items that will help the AI perform better on similar tasks in the future.

QUALITY BAR:
- Specific, not generic. "Use TypeScript strict mode" is good. "Use good practices" is not.
- Actionable. The rule must be something an AI could apply mechanically.
- Derivable from evidence. Don't invent preferences the session didn't demonstrate.

OUTPUT FORMAT: valid JSON matching the schema below. If there is nothing
meaningful to extract, return {"findings": []}. Never force low-quality findings.

TYPES:
- REFLEX: unconditional rules. "Always X" / "Never X".
- RECIPE: template for a specific task type. "For Y, the approach is Z."
- HEURISTIC: context-sensitive guidance. "When A, prefer B (because C)."
- PRINCIPLE: abstract value. "Prefer X over Y."
- ANTI_PRINCIPLE: something to avoid. "Don't X (the user rejected this N times)."

SCOPES:
- GLOBAL: applies to all this user's work
- USER: applies across this user's projects (default)
- PROJECT: applies only in this specific project
- SESSION_CONTEXT: applies in specific modes (e.g. "while debugging")
- COMMUNITY_CANDIDATE: generic enough to share publicly

CONFIDENCE: 0.0 to 1.0. Only include findings at >= 0.7 confidence.

JSON SCHEMA:
{
  "findings": [
    {
      "type": "reflex" | "recipe" | "heuristic" | "principle" | "anti_principle",
      "scope": "global" | "user" | "project" | "session_context" | "community_candidate",
      "trigger": "natural language — when does this apply?",
      "rule": "natural language — what is the rule?",
      "rationale": "natural language — why?",
      "confidence": 0.0-1.0
    }
  ]
}

SESSION SUMMARY:
{session_json}

Extract now. Output JSON only, no prose before or after.
```

### Session Summary Input Shape (the `{session_json}`)

```typescript
interface KEAInputPayload {
  sessionId: string;
  userId: string;
  projectId?: string;

  // User request
  prompt: string;
  clarificationAnswers?: Record<string, string>;

  // What was injected at start
  skillInjected?: { name: string; triggers: string[] };
  patternsInjected?: Array<{ id: string; summary: string }>;

  // What happened
  framework?: string;
  language?: string;
  filesCreated: string[];
  filesModified: string[];
  filesRejected?: string[];              // user explicitly rejected these
  buildAttempts: number;
  errorsEncountered: string[];
  finalBuildSuccess: boolean;

  // How user reacted
  userFeedback?: 'up' | 'down' | null;
  userFeedbackComment?: string | null;

  // Meta
  durationMs: number;
  tokensUsed: number;
}
```

### Quality Filter (after KEA output)

The filter rejects findings that would add noise:
1. Confidence below 0.7
2. Rule text shorter than 20 characters OR trigger shorter than 10
3. Contains only generic phrases ("good practices", "best practices", "clean code", "proper", "correctly") when rule text is short
4. Semantic duplicate of existing knowledge (cosine similarity > 0.85) — increment confidence on existing instead
5. Beyond rate limit: 3 findings max per session

### Model Choice

- Cheap model: Qwen3-Coder via DashScope (free tier), GLM-4.5-Air, Haiku 4.5
- Typical cost per extraction: $0.0005 – $0.002
- Latency budget: 3s (fire-and-forget, non-blocking)

---

## 3. KRA — Knowledge Retrieval Agent

### Ranking Formula (concrete math)

```typescript
interface RankingWeights {
  semanticSimilarity: 0.40;
  successRate:        0.20;
  recencyDecay:       0.15;
  contextFit:         0.15;
  confidence:         0.10;
}

function scoreKnowledge(
  item: KnowledgeItem,
  queryVector: number[],
  context: SessionContext,
): number {
  const sim = cosineSimilarity(item.embedding, queryVector);            // 0-1
  const success = item.successCount / (item.successCount + item.failureCount + 1);

  const daysSinceConfirmed = (Date.now() - item.confirmedAt.getTime()) / 86_400_000;
  const recency = Math.exp(-daysSinceConfirmed / 90);                    // half-life 90 days

  const contextFit = calculateContextFit(item, context);                 // 0-1, see below
  const confidence = item.confidence;                                    // 0-1

  return 0.40 * sim
       + 0.20 * success
       + 0.15 * recency
       + 0.15 * contextFit
       + 0.10 * confidence;
}

function calculateContextFit(
  item: KnowledgeItem,
  context: SessionContext,
): number {
  let fit = 0.5;                                                         // baseline
  if (item.framework && item.framework === context.framework) fit += 0.3;
  if (item.language && item.language === context.language) fit += 0.2;
  if (item.scope === 'project' && item.ownerProjectId === context.projectId) fit += 0.2;
  if (context.sessionMode === 'debugging' && item.type === 'heuristic'
      && item.tags.includes('debugging')) fit += 0.2;
  return Math.min(fit, 1.0);
}
```

### Retrieval Pipeline (pseudocode)

```
1. Embed the user's prompt -> queryVector
2. Query pgvector for top-20 candidates by cosine distance, filtered by:
   - owner_user_id matches
   - decay_score > 0.3
   - scope is global/user OR (scope='project' AND project matches)
3. Score each candidate with the multi-factor formula above
4. Sort descending by score
5. Diversify: at most 3 items per type, total <= 8 items, minimum score 0.45
6. Record retrieval in SessionKnowledgeApplication table (for outcome tracking)
7. Return bundle grouped by type
```

### Injection Format (for system prompt)

```markdown
## What I've Learned About You

### Unconditional Rules (always apply)
- [REFLEX] Use 2-space indentation, single quotes, semicolons (confidence 0.95)
- [REFLEX] End files with newline (confidence 0.90)

### Your Preferred Approaches
- [HEURISTIC] For React forms, use react-hook-form — cleaner validation (89% success)
- [HEURISTIC] For data fetching, use @tanstack/query, not useEffect (100% success)

### Things You've Asked Me To Avoid
- [ANTI-PRINCIPLE] Don't inline styles — you've rejected this twice. Use Tailwind instead.
- [ANTI-PRINCIPLE] Don't use `any` type — you've corrected me 8 times. Use `unknown` + narrowing.

### A Skill That Might Apply
[Skill: React Tailwind Dark Todo App v1.2.0]
- Used 4 times, 100% success rate
- Key decisions: Vite over CRA, Tailwind dark mode class strategy, localStorage for persistence
- Files: src/App.tsx, src/components/TodoItem.tsx, tailwind.config.js

### Your Coding Principles
- Prefer composition over inheritance
- Co-locate tests with source files
```

**Bad injection (avoid):** unstructured blobs like "Past corrections: don't inline styles, use TypeScript strict mode, ..." bury signal. Structured sections with types + confidence help the LLM weigh and apply.

---

## 4. Oracle — Chat Prompt Template

### System Prompt

```
You are the user's personal coding Brain Oracle.

You answer questions about the user's own coding patterns, past sessions,
and preferences — based ONLY on the knowledge and session data provided below.

RULES:
1. Cite sources using [^N] markers. Every claim must be grounded.
2. If you don't have enough context to answer, say so. Don't hallucinate.
3. Be specific: use real numbers, dates, project names, framework names.
4. Distinguish high-confidence knowledge ("you consistently...") from 
   low-confidence ("you've done this a few times...").
5. If the user's question is off-topic (not about their coding), redirect:
   "I'm your coding Brain — I can help with questions about your patterns,
   past work, and preferences."

USER ID: {userId}
USER QUESTION: {question}

RELEVANT KNOWLEDGE:
{knowledge_items_formatted}

RELEVANT SESSIONS:
{session_summaries_formatted}

ANSWER (markdown, with [^N] citations):
```

### Session Summaries Format (for the `{session_summaries_formatted}`)

```
[S1] 2026-04-15 — "Add auth to my app"
     Project: saas-dashboard | Framework: Next.js
     Duration: 12min | SQS: 89 | Outcome: success
     Key actions: Implemented NextAuth with Google OAuth, JWT tokens,
     httpOnly cookies. Added /api/auth/callback route.
```

### Response Shape

Oracle returns markdown with citations. Parse citations out with regex `/\[\^(\d+)\]/g`:

```typescript
interface OracleResponse {
  answer: string;              // markdown with [^N] markers
  citations: Citation[];       // one per cited item, mapped from markers
  confidence: 'high' | 'medium' | 'low';
  relatedQuestions: string[];  // suggested follow-ups
}
```

### Model Choice

- Capable model required: Claude Sonnet 4.6, GPT-4-class, or best-available
- Cost: $0.01-0.03 per query — rate-limit for free tier
- Latency: stream response (SSE) so user sees it arrive; typical 3-5s total

---

## 5. MCP Tool JSON Schemas (6 core tools)

### 5.1 brain_retrieve_knowledge

```json
{
  "name": "brain_retrieve_knowledge",
  "description": "Retrieve knowledge relevant to a coding task. Call BEFORE generating code to ensure consistency with the user's preferences and past successful patterns. Returns typed knowledge items to inject into system prompt.",
  "inputSchema": {
    "type": "object",
    "required": ["prompt"],
    "properties": {
      "prompt": {
        "type": "string",
        "description": "The user's coding request or task description"
      },
      "context": {
        "type": "object",
        "properties": {
          "projectId": { "type": "string" },
          "framework": { "type": "string", "examples": ["react", "nextjs", "vue"] },
          "language": { "type": "string", "examples": ["typescript", "python"] },
          "sessionMode": {
            "type": "string",
            "enum": ["building", "debugging", "refactoring", "exploring"]
          }
        }
      },
      "maxItems": { "type": "integer", "default": 10, "maximum": 20 }
    }
  }
}
```

### 5.2 brain_report_session_outcome

```json
{
  "name": "brain_report_session_outcome",
  "description": "Report the outcome of a coding session after completion. Must be called after the user accepts/rejects generated code. Enables the Brain's feedback loop.",
  "inputSchema": {
    "type": "object",
    "required": ["sessionId", "success"],
    "properties": {
      "sessionId": { "type": "string" },
      "success": { "type": "boolean" },
      "filesCreated": { "type": "array", "items": { "type": "string" } },
      "filesModified": { "type": "array", "items": { "type": "string" } },
      "filesRejected": { "type": "array", "items": { "type": "string" } },
      "knowledgeUsed": {
        "type": "array",
        "items": { "type": "string" },
        "description": "IDs of knowledge items that were injected at session start"
      },
      "buildAttempts": { "type": "integer" },
      "errors": { "type": "array", "items": { "type": "string" } },
      "userFeedback": { "type": "string", "enum": ["up", "down"] },
      "userFeedbackComment": { "type": "string" }
    }
  }
}
```

### 5.3 brain_teach_knowledge

```json
{
  "name": "brain_teach_knowledge",
  "description": "Record a piece of knowledge the user explicitly taught. Use when the user says 'remember that I prefer X' or 'always do Y' or similar. User-taught knowledge has highest confidence (1.0).",
  "inputSchema": {
    "type": "object",
    "required": ["type", "trigger", "rule"],
    "properties": {
      "type": {
        "type": "string",
        "enum": ["reflex", "recipe", "heuristic", "principle", "anti_principle"]
      },
      "trigger": {
        "type": "string",
        "description": "When does this apply? E.g., 'when building React forms'"
      },
      "rule": {
        "type": "string",
        "description": "What is the rule? E.g., 'use react-hook-form'"
      },
      "rationale": { "type": "string" },
      "scope": {
        "type": "string",
        "enum": ["global", "user", "project"],
        "default": "user"
      },
      "projectId": { "type": "string" }
    }
  }
}
```

### 5.4 brain_get_user_style

```json
{
  "name": "brain_get_user_style",
  "description": "Get the user's coding style preferences (indentation, quotes, naming conventions, framework defaults). Use for scaffolding new files to match user conventions from the first line.",
  "inputSchema": { "type": "object", "properties": {} }
}
```

### 5.5 brain_ask_oracle

```json
{
  "name": "brain_ask_oracle",
  "description": "Ask a natural-language question about the user's Brain. Use when the user asks retrospective questions like 'how did I solve X before?' or 'what do I usually use for Y?'. Returns an answer with citations.",
  "inputSchema": {
    "type": "object",
    "required": ["question"],
    "properties": {
      "question": { "type": "string" }
    }
  }
}
```

### 5.6 brain_log_event

```json
{
  "name": "brain_log_event",
  "description": "Log an event during a coding session. Events feed the knowledge extraction pipeline. Call frequently during sessions — do not batch.",
  "inputSchema": {
    "type": "object",
    "required": ["sessionId", "eventType", "payload"],
    "properties": {
      "sessionId": { "type": "string" },
      "eventType": {
        "type": "string",
        "enum": [
          "session_started", "tool_use", "file_created", "file_modified",
          "file_rejected", "build_attempt", "build_success", "build_failure",
          "user_clarification", "user_correction"
        ]
      },
      "payload": { "type": "object" },
      "timestamp": { "type": "string", "format": "date-time" }
    }
  }
}
```

---

## 6. SSE Event Schema (vibe-coding clients — Path A/R only)

**Note:** This schema is for vibe-coding clients. The Path B Brain Platform does NOT emit these events — it receives session data via `brain_log_event` and `brain_report_session_outcome`.

```typescript
type VibeCodingSSEEvent =
  | { event: 'thinking'; data: { text: string } }
  | { event: 'text_delta'; data: { delta: string; fullText: string } }
  | { event: 'tool_start'; data: { id: string; name: string; args: unknown } }
  | { event: 'tool_end'; data: { id: string; success: boolean; result?: unknown } }
  | { event: 'file_created'; data: { path: string; language: string; size: number } }
  | { event: 'file_modified'; data: { path: string; diff: string } }
  | { event: 'phase_start'; data: { phase: string; description: string } }
  | { event: 'phase_progress'; data: { phase: string; progress: number } }
  | { event: 'clarification_request'; data: { questions: ClarificationQuestion[] } }
  | { event: 'build_start'; data: { command: string } }
  | { event: 'build_fix_start'; data: { attempt: number; errors: string[] } }
  | { event: 'build_fix_complete'; data: { attempt: number; filesFixed: number } }
  | { event: 'preview_ready'; data: { url: string; subdomain: string } }
  | { event: 'preview_failed'; data: { error: string; suggestedFix?: string } }
  | { event: 'complete'; data: { sessionSummary: SessionSummary } }
  | { event: 'error'; data: { message: string; code: string } };
```

---

## 7. Core API Contracts (Path B — Brain Platform)

### Session lifecycle

```
POST   /api/session/start
Body:  { userId, projectId?, clientType: 'claude_code' | 'cursor' | 'autobahn' | 'custom' }
Resp:  { sessionId: string }

POST   /api/session/{sessionId}/event
Body:  { eventType: string, payload: unknown, timestamp: ISO8601 }
Resp:  { accepted: true }

POST   /api/session/{sessionId}/end
Body:  { success: boolean, metrics: SessionMetrics }
Resp:  { sqs: number, knowledgeExtracted: number }
```

### Knowledge CRUD

```
GET    /api/knowledge?scope=user&type=heuristic&framework=react&limit=20
Resp:  { items: KnowledgeItem[], total: number }

POST   /api/knowledge
Body:  { type, scope, trigger, rule, rationale?, framework? }
Resp:  { id: string, embedding_generated: true }

PATCH  /api/knowledge/{id}
Body:  { rule?, rationale?, tags? }
Resp:  { id, version: number }

DELETE /api/knowledge/{id}
Resp:  { deleted: true }

POST   /api/knowledge/retrieve
Body:  { prompt, context: { framework?, projectId?, sessionMode? } }
Resp:  KnowledgeBundle
```

### Oracle

```
POST   /api/oracle/ask
Body:  { question: string, conversationId?: string }
Resp (SSE):  stream of { token: string } then { citations: Citation[] }
```

### Skills

```
GET    /api/skills?framework=react&sort=popular&scope=personal
Resp:  { skills: Skill[] }

POST   /api/skills/{id}/export?format=claude-code
Resp:  { content: string, filename: string }

POST   /api/skills/{id}/publish-community
Body:  { consentToAnonymize: true }
Resp:  { moderationQueueId: string }
```

### MCP Auth

```
POST   /api/mcp-tokens
Body:  { name: string, scope: 'personal' | 'team:{teamId}' }
Resp:  { token: string, expiresAt: ISO8601 }

GET    /api/mcp-tokens
Resp:  { tokens: Array<{ id, name, scope, createdAt, lastUsedAt }> }

DELETE /api/mcp-tokens/{id}
Resp:  { revoked: true }
```

---

## 8. Prisma Schema Extensions

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}

// === Core knowledge (Path R additions to existing schema) ===

model LearningPattern {
  // ... existing fields preserved ...
  embedding   Unsupported("vector(1536)")?
  scope       String      @default("user") // global | user | project | community
  confirmedAt DateTime?
  decayScore  Float       @default(1.0)
  failureCount Int        @default(0)
  successCount Int        @default(0)
  
  @@index([userId, scope])
}

model Skill {
  // ... existing fields preserved ...
  embedding     Unsupported("vector(1536)")?
  scope         String      @default("user")
  failureCount  Int         @default(0)
  successCount  Int         @default(0)
  
  @@index([userId, scope])
}

// === New for Path A/B — unified Knowledge ===

model Knowledge {
  id                String    @id @default(cuid())
  type              String    // reflex | recipe | heuristic | principle | anti_principle
  scope             String    // global | user | project | community
  ownerUserId       String?
  ownerTeamId       String?
  ownerProjectId    String?
  
  triggerText       String    @db.Text
  ruleText          String    @db.Text
  rationale         String?   @db.Text
  symbolicWhen      String?
  symbolicThen      String?
  instead           String?   // for anti-principles
  
  embedding         Unsupported("vector(1536)")?
  framework         String?
  language          String?
  tags              String[]
  
  confidence        Float     @default(0.7)
  successCount      Int       @default(0)
  failureCount      Int       @default(0)
  usageCount        Int       @default(0)
  decayScore        Float     @default(1.0)
  
  createdAt         DateTime  @default(now())
  confirmedAt       DateTime?
  lastUsedAt        DateTime?
  
  extractedBy       String    @default("kea") // kea | user | imported
  sourceSessionIds  String[]
  parentKnowledgeId String?
  
  @@index([ownerUserId, type, scope])
  @@index([ownerUserId, confidence])
}

// === Session events (Path A/B) ===

model Session {
  id          String   @id @default(cuid())
  userId      String
  projectId   String?
  teamId      String?
  clientType  String   // vibe_coding | claude_code | cursor | custom
  startedAt   DateTime @default(now())
  endedAt     DateTime?
  outcome     String?  // success | partial | failed
  sqs         Float?
  metadata    Json?
  
  events      SessionEvent[]
  
  @@index([userId, startedAt])
}

model SessionEvent {
  id         String   @id @default(cuid())
  sessionId  String
  session    Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  eventType  String
  payload    Json
  timestamp  DateTime @default(now())
  
  @@index([sessionId, timestamp])
}

model SessionKnowledgeApplication {
  id          String   @id @default(cuid())
  sessionId   String
  knowledgeId String
  role        String   // injected | retrieved_but_not_used | extracted_from
  createdAt   DateTime @default(now())
  
  @@unique([sessionId, knowledgeId, role])
  @@index([knowledgeId])
}

// === MCP tokens ===

model MCPToken {
  id         String    @id @default(cuid())
  userId     String
  teamId     String?
  name       String
  tokenHash  String    @unique
  scope      String    // personal | team
  expiresAt  DateTime?
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
  
  @@index([userId])
}

// === Community ===

model CommunitySkill {
  id                String    @id @default(cuid())
  knowledgeId       String    @unique
  publishedByUserId String
  publishedAt       DateTime  @default(now())
  downloadCount     Int       @default(0)
  successRate       Float?
  averageRating     Float?
  reportCount       Int       @default(0)
  moderationStatus  String    @default("pending") // pending | approved | flagged | removed
  
  @@index([moderationStatus])
}
```

---

## 9. Environment Variables (complete list)

```bash
# === Database ===
DATABASE_URL="postgresql://user:pass@host:5432/brain"
# Note: run `CREATE EXTENSION IF NOT EXISTS vector;` after provision

# === LLM Providers ===
OPENAI_API_KEY="sk-..."              # for embeddings + optionally Oracle
ANTHROPIC_API_KEY="sk-ant-..."       # optional, for Oracle (preferred model)
DASHSCOPE_API_KEY="..."              # optional, for Qwen KEA (cheapest)
GLM_API_KEY="..."                    # optional, alternative KEA

# === Model selection ===
KEA_MODEL="qwen3-coder"              # options: qwen3-coder, glm-4.5-air, claude-haiku-4-5
ORACLE_MODEL="claude-sonnet-4-6"     # preferred: claude-sonnet-4-6 or gpt-4o
EMBEDDING_MODEL="text-embedding-3-small"
EMBEDDING_DIMENSIONS="1536"

# === Feature flags ===
KEA_ENABLED="true"
SEMANTIC_RETRIEVAL_ENABLED="true"
OUTCOME_FEEDBACK_ENABLED="true"
ORACLE_ENABLED="true"
COMMUNITY_PUBLISHING_ENABLED="false" # enable when Phase 3 ready

# === Auth ===
NEXTAUTH_URL="https://brain.example"
NEXTAUTH_SECRET="<openssl rand -base64 32>"
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
GITHUB_CLIENT_ID="..."
GITHUB_CLIENT_SECRET="..."

# === MCP server ===
MCP_SERVER_HTTP_PORT="3100"          # for HTTP transport
MCP_TOKEN_SECRET="<openssl rand -base64 32>"  # for signing MCP tokens

# === Object storage (for session archives, skill markdown) ===
STORAGE_PROVIDER="s3"                # s3 | r2 | local
STORAGE_BUCKET="brain-sessions"
STORAGE_REGION="us-east-1"
STORAGE_ACCESS_KEY="..."
STORAGE_SECRET_KEY="..."

# === Background jobs ===
PG_BOSS_SCHEMA="pgboss"              # pg-boss job schema in same DB

# === Observability ===
LOG_LEVEL="info"                     # debug | info | warn | error
SENTRY_DSN="..."                     # optional

# === Rate limits ===
RATE_LIMIT_ORACLE_PER_DAY="100"
RATE_LIMIT_KEA_PER_HOUR="60"
RATE_LIMIT_MCP_PER_MINUTE="200"

# === Cost guards ===
MAX_KEA_COST_USD_PER_SESSION="0.05"
MAX_ORACLE_COST_USD_PER_DAY="10.00"
```

---

## 10. Package Dependencies (Path B — Brain Platform)

### `apps/mcp-server/package.json` (minimum)

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@brain/core": "workspace:*",
    "@brain/types": "workspace:*",
    "@brain/db": "workspace:*",
    "zod": "^3.22.0"
  }
}
```

### `apps/web/package.json` (minimum)

```json
{
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "next-auth": "^5.0.0",
    "@brain/core": "workspace:*",
    "@brain/types": "workspace:*",
    "@brain/db": "workspace:*",
    "tailwindcss": "^4.0.0",
    "framer-motion": "^11.0.0",
    "zustand": "^5.0.0"
  }
}
```

### `packages/core/package.json` (minimum)

```json
{
  "dependencies": {
    "@brain/types": "workspace:*",
    "@brain/db": "workspace:*",
    "openai": "^4.0.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "pg-boss": "^10.0.0"
  }
}
```

### `packages/db/package.json` (minimum)

```json
{
  "dependencies": {
    "@prisma/client": "^5.0.0",
    "pg": "^8.11.0"
  },
  "devDependencies": {
    "prisma": "^5.0.0"
  }
}
```

---

## 11. The First 10 Files to Create (Path B — Brain Platform)

For an AI agent starting Path B, the first 10 files in build order:

1. `packages/types/src/index.ts` — TypeScript types for Knowledge, Session, Skill
2. `packages/db/prisma/schema.prisma` — schema from §8
3. `packages/db/src/index.ts` — Prisma client export
4. `packages/core/src/embedding.ts` — OpenAI embedding wrapper
5. `packages/core/src/kea.ts` — KEA service with prompt from §2
6. `packages/core/src/kra.ts` — KRA retrieval with formula from §3
7. `packages/core/src/oracle.ts` — Oracle service with prompt from §4
8. `apps/mcp-server/src/index.ts` — MCP server skeleton
9. `apps/mcp-server/src/tools/retrieve.ts` — first MCP tool (schema §5.1)
10. `apps/web/app/layout.tsx` — Next.js root layout

With these 10 files, you have: types, DB, embedding, KEA, KRA, Oracle, MCP server skeleton, one MCP tool, webapp shell. Everything else extends these.

**Note:** No `packages/agent` or `apps/vibe-coding-engine` — the platform does not contain a vibe-coding engine.

---

## 12. What This Doesn't Contain

Deliberately out of scope for this stubs document:

- Full Oracle UI implementation (doc 12 describes; implementor uses Next.js patterns)
- Full dashboard implementation (doc 10 describes screens; implementor uses shadcn patterns)
- Moderation workflow implementation (doc 11 describes; implementor designs based on product needs)
- Team ACL specifics (doc 09 describes; implementor uses RBAC patterns)
- Specific agentic loop (for Path A/R only — port from Autobahn's `glm-agent.ts`)
- Complete error handling — each module should have structured error types per standard patterns
- Full testing harness — use Vitest or Jest with Testing Library following standard patterns

If you need one of the above and don't have a reference, ask. Don't invent silently.

---

## 13. Using This Document

- **Don't read linearly.** Jump to the section you need.
- **Copy, then adapt.** Every prompt, schema, contract here is a starting point. Refine based on your testing and constraints.
- **Keep it versioned.** When you find a prompt or schema that works better after real usage, update this doc.
- **Add new stubs as you discover needs.** If you find yourself inventing something the next agent will also invent, add it here.

The goal: close the gap between "research says what to build" and "I can start coding today."
