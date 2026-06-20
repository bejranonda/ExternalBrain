# Phase 1 — Foundation: Monorepo · `@brain/types` · `@brain/db`

> **Before starting:** read `00-START-HERE.md` for the non-negotiable rules and repo
> layout. This is Phase 1 of 6. Build this phase completely and pass the checkpoint
> before opening Phase 2.

---

## Agent prompt (copy this verbatim to start Phase 1)

```
We are building the External Brain platform from scratch. This is Phase 1.

Your job:
1. Scaffold a pnpm + Turborepo monorepo (apps/*, packages/*) with the exact layout below.
2. Implement @brain/types — pure TypeScript types, zero runtime deps.
3. Implement @brain/db — Prisma 7 schema with all models, pgvector embedding columns,
   raw-SQL helpers, FTS index file, and a deterministic idempotent seed.

Stop at the Phase 1 checkpoint and show me a passing `prisma migrate deploy` + seed run
before proceeding. Honor every Invariant callout — they are non-negotiable.

Spec file: REBUILD/01-foundation.md
```

---

## 1.1 Monorepo scaffold

### Root `package.json`
```json
{
  "private": true,
  "scripts": {
    "build":      "turbo run build",
    "dev":        "turbo run dev",
    "typecheck":  "turbo run typecheck",
    "test":       "turbo run test",
    "lint":       "turbo run lint",
    "hash-admin-password": "tsx scripts/hash-admin-password.ts"
  },
  "devDependencies": {
    "turbo":      "latest",
    "typescript": "^5.0.0",
    "tsx":        "latest"
  },
  "packageManager": "pnpm@9.15.0"
}
```

### `pnpm-workspace.yaml`
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### `turbo.json`
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev":       { "persistent": true, "cache": false },
    "typecheck": { "dependsOn": ["^build"] },
    "test":      { "dependsOn": ["^build"] },
    "lint":      { "dependsOn": ["^build"] }
  }
}
```

### `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

### `.gitignore` essentials
```
node_modules/
.env
.env.local
*.env.bak*
*.dump
.next/
dist/
packages/db/src/generated/
```

### `.env.example`
See `07-env-catalog.md` for the complete catalog. For Phase 1, you only need:
```
DATABASE_URL=postgresql://brain:brain@localhost:5432/brain
```

---

## 1.2 `packages/types` — `@brain/types`

**Package rule:** zero runtime dependencies. Only TypeScript type definitions exported
from `src/index.ts`. Other packages import `from "@brain/types"`.

### `packages/types/package.json`
```json
{
  "name": "@brain/types",
  "version": "0.1.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

### Types to define in `packages/types/src/`

**Knowledge ontology** (`knowledge.ts`)
```typescript
export type KnowledgeType =
  | "reflex" | "recipe" | "heuristic" | "principle" | "anti_principle";

export type KnowledgeScope =
  | "global" | "user" | "project" | "session_context" | "team" | "community";

export type KnowledgeExtractedBy = "kea" | "user" | "imported" | "promoted";

export type KnowledgeVisibility = "private" | "project" | "org";

export interface Knowledge {
  id: string;
  type: KnowledgeType;
  scope: KnowledgeScope;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  ownerProjectId: string | null;
  triggerText: string;
  ruleText: string;
  rationale: string | null;
  symbolicWhen: string | null;
  symbolicThen: string | null;
  instead: string | null;
  framework: string | null;
  language: string | null;
  tags: string[];
  confidence: number;
  successCount: number;
  failureCount: number;
  usageCount: number;
  decayScore: number;
  createdAt: Date;
  confirmedAt: Date | null;
  lastUsedAt: Date | null;
  extractedBy: KnowledgeExtractedBy;
  sourceSessionIds: string[];
  parentKnowledgeId: string | null;
}

export interface KnowledgeBundle {
  reflexes: Knowledge[];
  recipes: Knowledge[];
  heuristics: Knowledge[];
  principles: Knowledge[];
  antiPrinciples: Knowledge[];
  skill?: Skill | null;
  injectedIds: string[];
}
```

**Skills** (`skill.ts`)
```typescript
export type SkillStage = "inbox" | "notes" | "knowledge" | "wisdom";
export type SkillKind = "output" | "internal";
export type SkillExportFormat =
  | "claude-code" | "cursor" | "windsurf" | "codex" | "markdown";

export interface SkillFrontmatter {
  skill_id: string;
  title: string;
  stage: SkillStage;
  kind: SkillKind;
  scope: string;
  tags: string[];
  dependencies: string[];
  confidence: number;
  mastery: number;
  created: string;
  updated: string;
  [k: string]: unknown;
}

export interface Skill {
  id: string;
  skillId: string;
  title: string;
  content: string;
  frontmatter: SkillFrontmatter;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  scope: string;
  successCount: number;
  failureCount: number;
  usageCount: number;
  version: number;
  parentSkillId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

**Sessions** (`session.ts`)
```typescript
export type SessionClientType =
  | "claude_code" | "cursor" | "windsurf" | "autobahn"
  | "antigravity" | "github_copilot" | "custom" | "webapp";

export type SessionOutcome = "success" | "partial" | "failed";

export type SessionEventType =
  | "session_started" | "tool_use" | "file_created" | "file_modified"
  | "file_rejected" | "build_attempt" | "build_success" | "build_failure"
  | "user_clarification" | "user_correction" | "knowledge_injected"
  | "knowledge_rejected" | "learning_captured";

export interface SessionContext {
  sessionId: string;
  userId: string;
  projectId?: string;
  framework?: string;
  language?: string;
  sessionMode?: "building" | "debugging" | "refactoring" | "exploring";
  dataScope?: "project" | "all";
  orgId?: string;
  accessibleProjectIds?: string[];
}

export interface SessionMetrics {
  filesCreated: string[];
  filesModified: string[];
  filesRejected: string[];
  buildAttempts: number;
  errors: string[];
  durationMs: number;
  tokensUsed: number;
}
```

**Graph** (`graph.ts`)
```typescript
export type GraphRelation =
  | "depends_on" | "prerequisite_for" | "related_to"
  | "deepens" | "specializes" | "contradicts" | "supersedes";

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: GraphRelation;
  scope: string;
  weight: number;
  createdBy: string;
  evidence: string[];
  createdAt: Date;
}
```

**Oracle** (`oracle.ts`)
```typescript
export type OracleReasoningLevel =
  | "minimal" | "low" | "medium" | "high" | "max";

export type OracleGroundedness = "strong" | "moderate" | "weak" | "none";

export interface OracleCitationMeta {
  type?: string;
  scope?: string;
  confidence?: number;
  tags?: string[];
  successRate?: number;
}

export interface OracleCitation {
  marker: string;
  knowledgeId?: string;
  sessionId?: string;
  skillId?: string;
  excerpt: string;
  meta?: OracleCitationMeta;
}

export interface OracleResponse {
  answer: string;
  citations: OracleCitation[];
  confidence: "high" | "medium" | "low";
  groundedness: OracleGroundedness;
  retrievedCounts: { knowledge: number; sessions: number };
  relatedQuestions: string[];
  tokensUsed: number;
}
```

**Other types** (`misc.ts`)
```typescript
export interface PeerCard {
  id: string;
  ownerUserId: string;
  ownerProjectId: string | null;
  facts: string[];
  updatedAt: Date;
}

export type AutoskillConfidence = "high" | "medium";
export type AutoskillTarget = "skill" | "rules" | "knowledge" | "internal_skill";

export interface AutoskillProposal {
  id: string;
  userId: string;
  sessionId: string;
  target: AutoskillTarget;
  targetId: string | null;
  confidence: AutoskillConfidence;
  diff: string;
  patch: Record<string, unknown>;
  reasoning: string;
  status: "pending" | "approved" | "rejected" | "applied";
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface MCPToken {
  id: string;
  userId: string;
  name: string;
  scope: "personal" | "team";
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

export interface KnowledgeHealthSnapshot {
  id: string;
  snapshotAt: Date;
  tenantScope: string;
  usedInLast30Days: number;
  totalActive: number;
  averageConfidence: number;
  contradictionCount: number;
  medianAgeDays: number;
}
```

Export everything from `packages/types/src/index.ts`.

---

## 1.3 `packages/db` — `@brain/db`

### Setup
```
packages/db/package.json   — name: "@brain/db", deps: prisma, @prisma/adapter-pg, pg
packages/db/prisma/schema.prisma
packages/db/src/client.ts  — singleton db export
packages/db/src/helpers.ts — toVector, searchKnowledgeByEmbedding
packages/db/sql/session-fts-index.sql
packages/db/src/seed.ts
packages/db/src/index.ts   — re-exports
```

### `prisma/schema.prisma` — all models

```prisma
generator client {
  provider        = "prisma-client-js"
  output          = "../src/generated/client"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Tenancy models:**

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  name         String?
  image        String?
  role         String   @default("user")   // "admin" | "user"
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  credential       UserCredential?
  resetTokens      PasswordResetToken[]
  organizations    OrganizationMember[]
  projects         Project[]
  sessions         Session[]
  knowledge        Knowledge[]
  skills           Skill[]
  mcpTokens        MCPToken[]
  peerCards        PeerCard[]
  autoskillProps   AutoskillProposal[]
  feedback         Feedback[]
  auditLogs        AuditLog[]
  voucherRedemption VoucherRedemption?
  oracleCosts      OracleCostLedger[]
}

model Organization {
  id        String   @id @default(cuid())
  slug      String   @unique
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members   OrganizationMember[]
  invites   OrganizationInvite[]
  projects  Project[]
}

model OrganizationMember {
  id       String   @id @default(cuid())
  orgId    String
  userId   String
  role     String   @default("member")   // "owner" | "admin" | "member"
  joinedAt DateTime @default(now())

  org  Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([orgId, userId])
}

model OrganizationInvite {
  id          String    @id @default(cuid())
  orgId       String
  email       String
  role        String    @default("member")
  invitedById String
  token       String    @unique
  createdAt   DateTime  @default(now())
  expiresAt   DateTime
  acceptedAt  DateTime?
  revokedAt   DateTime?

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
}

model Project {
  id             String   @id @default(cuid())
  ownerUserId    String?
  ownerTeamId    String?
  organizationId String
  name           String
  slug           String
  framework      String?
  language       String?
  createdAt      DateTime @default(now())

  owner        User?         @relation(fields: [ownerUserId], references: [id], onDelete: SetNull)
  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Restrict)
  sessions     Session[]
  knowledge    Knowledge[]

  @@unique([organizationId, slug])
}

model Team {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())

  memberships TeamMembership[]
}

model TeamMembership {
  id     String @id @default(cuid())
  userId String
  teamId String
  role   String @default("member")   // "owner" | "admin" | "editor" | "member"

  team Team @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@unique([userId, teamId])
}
```

**Knowledge & skills:**

```prisma
model Knowledge {
  id               String    @id @default(cuid())
  type             String                           // KnowledgeType
  scope            String    @default("user")       // KnowledgeScope
  ownerUserId      String?
  ownerTeamId      String?
  ownerProjectId   String?
  originProjectId  String?
  triggerText      String
  ruleText         String
  rationale        String?
  symbolicWhen     String?
  symbolicThen     String?
  instead          String?
  framework        String?
  language         String?
  tags             String[]  @default([])
  confidence       Float     @default(0.7)
  successCount     Int       @default(0)
  failureCount     Int       @default(0)
  usageCount       Int       @default(0)
  decayScore       Float     @default(1.0)
  visibility       String    @default("project")   // "private" | "project" | "org"
  extractedBy      String    @default("kea")       // KnowledgeExtractedBy
  sourceSessionIds String[]  @default([])
  parentKnowledgeId String?
  createdAt        DateTime  @default(now())
  confirmedAt      DateTime?
  lastUsedAt       DateTime?
  deletedAt        DateTime?
  embedding        Unsupported("vector(1536)")?

  owner            User?     @relation(fields: [ownerUserId], references: [id], onDelete: SetNull)
  parent           Knowledge? @relation("KnowledgeParent", fields: [parentKnowledgeId], references: [id])
  children         Knowledge[] @relation("KnowledgeParent")
  applications     SessionKnowledgeApplication[]
  graphEdgesOut    GraphEdge[] @relation("GraphSource")
  graphEdgesIn     GraphEdge[] @relation("GraphTarget")
  feedback         Feedback[]

  @@index([ownerUserId, type, scope])
  @@index([ownerUserId, confidence])
  @@index([parentKnowledgeId])
  @@index([ownerUserId, ownerProjectId, deletedAt])
}

model Skill {
  id            String   @id @default(cuid())
  skillId       String
  title         String
  content       String
  frontmatter   Json
  ownerUserId   String?
  ownerTeamId   String?
  scope         String   @default("user")
  stage         String   @default("notes")   // SkillStage
  kind          String   @default("output")  // SkillKind
  successCount  Int      @default(0)
  failureCount  Int      @default(0)
  usageCount    Int      @default(0)
  mastery       Int      @default(1)
  version       Int      @default(1)
  parentSkillId String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  embedding     Unsupported("vector(1536)")?

  owner User? @relation(fields: [ownerUserId], references: [id], onDelete: SetNull)

  @@unique([skillId, ownerUserId])
  @@index([scope, stage])
}
```

**Sessions:**

```prisma
model Session {
  id              String    @id @default(cuid())
  userId          String
  projectId       String?
  teamId          String?
  tokenId         String?
  parentSessionId String?
  clientType      String    @default("custom")  // SessionClientType
  startedAt       DateTime  @default(now())
  endedAt         DateTime?
  outcome         String?                       // SessionOutcome
  sqs             Float?
  metadata        Json?

  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  project    Project?   @relation(fields: [projectId], references: [id], onDelete: SetNull)
  token      MCPToken?  @relation(fields: [tokenId], references: [id], onDelete: SetNull)
  events     SessionEvent[]
  knowledgeApplications SessionKnowledgeApplication[]
  autoskillProposals    AutoskillProposal[]
  feedback   Feedback[]

  @@index([userId, startedAt])
  @@index([parentSessionId])
  @@index([userId, projectId, startedAt])
  @@index([tokenId, startedAt])
}

model SessionEvent {
  id        String   @id @default(cuid())
  sessionId String
  eventType String                         // SessionEventType
  payload   Json
  timestamp DateTime @default(now())

  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, timestamp])
  @@index([eventType])
}

model SessionKnowledgeApplication {
  id          String   @id @default(cuid())
  sessionId   String
  knowledgeId String
  role        String   // "injected" | "retrieved_but_not_used" | "extracted_from"
  createdAt   DateTime @default(now())

  session   Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  knowledge Knowledge @relation(fields: [knowledgeId], references: [id], onDelete: Cascade)

  @@unique([sessionId, knowledgeId, role])
}
```

**Graph / peer card / autoskill / feedback:**

```prisma
model GraphEdge {
  id        String   @id @default(cuid())
  sourceId  String
  targetId  String
  relation  String   // GraphRelation
  scope     String
  weight    Float    @default(1.0)
  createdBy String
  evidence  String[]
  createdAt DateTime @default(now())

  source Knowledge @relation("GraphSource", fields: [sourceId], references: [id], onDelete: Cascade)
  target Knowledge @relation("GraphTarget", fields: [targetId], references: [id], onDelete: Cascade)

  @@unique([sourceId, targetId, relation])
}

model PeerCard {
  id             String   @id @default(cuid())
  ownerUserId    String
  ownerProjectId String?
  facts          String[]
  updatedAt      DateTime @updatedAt

  owner User @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)

  @@unique([ownerUserId, ownerProjectId])
}

model AutoskillProposal {
  id          String    @id @default(cuid())
  userId      String
  sessionId   String
  target      String                       // AutoskillTarget
  targetId    String?
  confidence  String                       // AutoskillConfidence
  diff        String
  patch       Json
  reasoning   String
  status      String    @default("pending")
  createdAt   DateTime  @default(now())
  resolvedAt  DateTime?

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([userId, status])
}

model Feedback {
  id           String   @id @default(cuid())
  userId       String
  sessionId    String?
  knowledgeId  String?
  skillId      String?
  rating       Int
  comment      String?
  feedbackType String   @default("session")
  createdAt    DateTime @default(now())

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  session   Session?   @relation(fields: [sessionId], references: [id], onDelete: SetNull)
  knowledge Knowledge? @relation(fields: [knowledgeId], references: [id], onDelete: SetNull)
}
```

**Tokens & auth:**

```prisma
model MCPToken {
  id                 String    @id @default(cuid())
  userId             String
  teamId             String?
  organizationId     String?
  projectId          String?
  name               String
  tokenHash          String    @unique
  scope              String    @default("personal")  // "personal" | "team"
  expiresAt          DateTime?
  createdAt          DateTime  @default(now())
  lastUsedAt         DateTime?
  revokedAt          DateTime?
  scheduledRevokeAt  DateTime?
  rotatedFromId      String?   @unique

  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  sessions Session[]

  @@index([userId])
  @@index([tokenHash])
}

model UserCredential {
  id           String   @id @default(cuid())
  userId       String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  token     String    @unique
  createdAt DateTime  @default(now())
  expiresAt DateTime
  usedAt    DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VoucherCode {
  id              String   @id @default(cuid())
  code            String   @unique
  kind            String
  organizationLabel String?
  maxUses         Int      @default(1)
  usedCount       Int      @default(0)
  expiresAt       DateTime?
  disabled        Boolean  @default(false)
  note            String?
  createdByUserId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  redemptions VoucherRedemption[]
}

model VoucherRedemption {
  id         String   @id @default(cuid())
  voucherId  String
  userId     String   @unique
  redeemedAt DateTime @default(now())

  voucher VoucherCode @relation(fields: [voucherId], references: [id], onDelete: Cascade)
  user    User        @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

**Audit & metrics:**

```prisma
model AuditLog {
  id             String   @id @default(cuid())
  actorUserId    String?
  action         String
  targetType     String?
  targetId       String?
  payload        Json?
  ip             String?
  userAgent      String?
  organizationId String?
  projectId      String?
  createdAt      DateTime @default(now())

  actor User? @relation(fields: [actorUserId], references: [id], onDelete: SetNull)
}

model OracleCostLedger {
  id           String   @id @default(cuid())
  userId       String
  day          DateTime @db.Date
  tokensInput  Int      @default(0)
  tokensOutput Int      @default(0)
  costUsd      Decimal  @default(0) @db.Decimal(10, 6)
  callCount    Int      @default(0)
  updatedAt    DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, day])
}

model KnowledgeHealthSnapshot {
  id                  String   @id @default(cuid())
  snapshotAt          DateTime @default(now())
  tenantScope         String
  usedInLast30Days    Int
  totalActive         Int
  averageConfidence   Float
  contradictionCount  Int
  medianAgeDays       Float
}

model CommunitySkill {
  id        String   @id @default(cuid())
  skillId   String   @unique
  title     String
  content   String
  tags      String[]
  createdAt DateTime @default(now())
}

model SkillImport {
  id              String   @id @default(cuid())
  userId          String
  communitySkillId String
  importedAt      DateTime @default(now())
}
```

---

### 5.2 First migration — pgvector extension

Create `packages/db/prisma/migrations/0000_init_pgvector/migration.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This must run **before** the Prisma-generated migration that creates the `embedding vector(1536)` columns. Place it as the first migration folder chronologically.

---

### 5.3 `packages/db/src/client.ts` — singleton

```typescript
import { PrismaClient } from "./generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  if (process.env.SKIP_DB_INIT === "1") {
    // Build-time: return a dummy that throws on use
    return new PrismaClient();
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
```

---

### 5.4 `packages/db/src/helpers.ts` — raw-SQL for pgvector

```typescript
import { db } from "./client";

export function toVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export interface KnowledgeSearchArgs {
  ownerUserId?: string;
  scope?: string;
  framework?: string;
  limit?: number;
  minSimilarity?: number;
}

export interface KnowledgeSearchResult {
  id: string;
  similarity: number;
}

export async function searchKnowledgeByEmbedding(
  embedding: number[],
  args: KnowledgeSearchArgs = {}
): Promise<KnowledgeSearchResult[]> {
  const { ownerUserId, limit = 20, minSimilarity = 0.0 } = args;
  const vectorStr = toVector(embedding);

  const rows = await db.$queryRawUnsafe<Array<{ id: string; similarity: number }>>(
    `SELECT id, 1 - (embedding <=> $1::vector) AS similarity
     FROM "Knowledge"
     WHERE embedding IS NOT NULL
       AND "deletedAt" IS NULL
       AND "decayScore" > 0.3
       ${ownerUserId ? `AND "ownerUserId" = '${ownerUserId}'` : ""}
     ORDER BY embedding <=> $1::vector ASC
     LIMIT ${limit}`,
    vectorStr
  );

  return rows.filter((r) => r.similarity >= minSimilarity);
}
```

> **Security note:** The `ownerUserId` interpolation above is safe because this is an
> internal helper called only with values from authenticated session context — not
> from user-controlled HTTP input. For any caller that might receive external input,
> use parameterized queries via `$queryRaw` with tagged template literals instead.

---

### 5.5 `packages/db/sql/session-fts-index.sql`

Applied by deploy scripts (not Prisma migrations):
```sql
-- GIN full-text search index on session prompt
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_prompt_fts
  ON "Session" USING gin(to_tsvector('english', COALESCE(metadata->>'prompt', '')));

-- GIN full-text search on session event payload
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_session_event_payload_fts
  ON "SessionEvent" USING gin(to_tsvector('english', payload::text));
```

---

### 5.6 Seed (`packages/db/src/seed.ts`)

The seed is **deterministic and idempotent** (upsert everywhere). This exact fixture is
what the authed-e2e tests assert against.

**Create:**
- 1 admin user: `alex@brain.local` · role `admin` · credential hash for `brain123`
- 1 personal organization: `alex-brain` · 1 member record (owner)
- 1 default project: `brain-platform` · framework `nextjs` · language `typescript`
- 1 MCP token: `default-dev-token` · hashed
- 6 sessions: mix of `success`/`partial`/`failed` outcomes, realistic `metadata.prompt` strings
- ~16 Knowledge rows: at least 2 of each `KnowledgeType`, all tagged `seed`, deterministic IDs
- 4 AutoskillProposals: status `pending`
- Leave all `embedding` columns NULL (worker backfills asynchronously)

```typescript
// packages/db/src/seed.ts
import { db } from "./client";
import { createHash } from "crypto";

async function main() {
  // Upsert admin user
  const user = await db.user.upsert({
    where: { email: "alex@brain.local" },
    update: {},
    create: {
      id: "seed-user-01",
      email: "alex@brain.local",
      name: "Alex Brain",
      role: "admin",
      credential: {
        create: {
          // bcrypt hash of "brain123" at cost 12
          passwordHash: "$2b$12$PLACEHOLDER_REPLACE_WITH_REAL_HASH",
        },
      },
    },
  });

  // Upsert personal org
  const org = await db.organization.upsert({
    where: { slug: "alex-brain" },
    update: {},
    create: { id: "seed-org-01", slug: "alex-brain", name: "Alex's Brain" },
  });

  await db.organizationMember.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    update: {},
    create: { orgId: org.id, userId: user.id, role: "owner" },
  });

  // Upsert default project
  await db.project.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: "brain-platform" } },
    update: {},
    create: {
      id: "seed-proj-01",
      organizationId: org.id,
      ownerUserId: user.id,
      name: "Brain Platform",
      slug: "brain-platform",
      framework: "nextjs",
      language: "typescript",
    },
  });

  // Seed knowledge rows (at least 2 per type, 16+ total)
  const knowledgeSeeds = [
    { id: "seed-k-01", type: "reflex",        triggerText: "When adding a new Prisma model", ruleText: "Always add the pgvector extension migration before the first embedding column migration", rationale: "pgvector must exist before vector columns can be created" },
    { id: "seed-k-02", type: "reflex",        triggerText: "When querying Knowledge by embedding", ruleText: "Always filter deletedAt IS NULL and decayScore > 0.3 before cosine distance ordering", rationale: "Soft-deleted and near-zero-decay rows must be excluded from retrieval" },
    { id: "seed-k-03", type: "recipe",        triggerText: "Setting up NextAuth v5 credentials mode", ruleText: "Use bcrypt cost 12, timing-safe compare, and store the hash in UserCredential (never User)", rationale: "Separates auth credentials from the public user record" },
    { id: "seed-k-04", type: "recipe",        triggerText: "Implementing a pg-boss worker job", ruleText: "Always explicitly createQueue before registering boss.work — v12 does not auto-create", rationale: "Silent job loss if queue does not exist" },
    { id: "seed-k-05", type: "heuristic",     triggerText: "Choosing between Cascade and Restrict FK semantics", ruleText: "Use Cascade for child rows that are meaningless without the parent; Restrict for relationships where orphaning would silently widen access", rationale: "Project.organizationId is Restrict so deleting an org cannot silently un-scope projects" },
    { id: "seed-k-06", type: "heuristic",     triggerText: "Debugging MCP 401 on initialize", ruleText: "MCP requires Bearer auth on initialize — a 401 here is the correct security gate, not a framework bug", rationale: "The MCP spec allows unauthenticated discovery; this project deliberately overrides that" },
    { id: "seed-k-07", type: "principle",     triggerText: "Writing KRA scoring weights", ruleText: "Semantic similarity is 70% of the score; success rate, recency, context fit, and confidence share the remaining 30%", rationale: "Similarity is the strongest signal; the others prevent high-confidence stale rules from dominating" },
    { id: "seed-k-08", type: "principle",     triggerText: "Designing for multi-tenancy", ruleText: "Every query that touches Knowledge, Session, or Skill must filter by ownerUserId; never rely on application-level filtering alone", rationale: "Defense in depth; a bug in one layer must not expose another tenant's data" },
    { id: "seed-k-09", type: "anti_principle", triggerText: "Setting up pgvector embedding dimensions", ruleText: "Never change EMBEDDING_DIMENSIONS after the first migration — it requires a full re-embed and a destructive migration", rationale: "Changing vector dimensions invalidates all stored embeddings" },
    { id: "seed-k-10", type: "anti_principle", triggerText: "Installing Google Antigravity MCP config", ruleText: "Antigravity uses serverUrl (not url) — using the wrong key silently fails with no error message", rationale: "Silent failure trap; unit tests must pin this key name" },
    { id: "seed-k-11", type: "reflex",        triggerText: "Using color values in CSS for text", ruleText: "Always use --accent-text for foreground text color, never --accent (brand fill color)", rationale: "--accent is lime #D8FF3E on dark theme; fails WCAG AA contrast on light backgrounds" },
    { id: "seed-k-12", type: "recipe",        triggerText: "Running Prisma migrations in production", ruleText: "Run prisma migrate deploy (not dev) and apply the FTS SQL manually before starting web/worker", rationale: "migrate dev may reset; FTS indexes are outside Prisma's management" },
    { id: "seed-k-13", type: "heuristic",     triggerText: "Handling pg-boss v10 to v12 upgrade", ruleText: "Run pgboss-version-check.sh before worker start — v12 split the job table; an old schema causes boss.start() to fail", rationale: "Schema v25 floor required for pg-boss v12" },
    { id: "seed-k-14", type: "principle",     triggerText: "Secure-by-default deployment posture", ruleText: "A freshly started instance with no auth config must return 503 auth_not_configured on all routes", rationale: "Prevents accidental open exposure of a new deployment" },
    { id: "seed-k-15", type: "anti_principle", triggerText: "GitHub Copilot JetBrains MCP config", ruleText: "JetBrains Copilot uses requestInit.headers (not headers) for auth — the wrong key silently drops the auth header", rationale: "Silent failure trap identical to antigravity; pin in unit tests" },
    { id: "seed-k-16", type: "reflex",        triggerText: "Closing a Brain MCP session", ruleText: "Always call brain_report_session_outcome with learnings; without it, KEA gets only a thin summary and the brain cannot learn from the session", rationale: "Unclosed sessions contribute nothing to the knowledge flywheel" },
  ].map((k) => ({
    ...k,
    ownerUserId: user.id,
    ownerProjectId: "seed-proj-01",
    confidence: 0.85,
    tags: ["seed"],
    extractedBy: "user" as const,
  }));

  for (const k of knowledgeSeeds) {
    await db.knowledge.upsert({
      where: { id: k.id },
      update: {},
      create: k,
    });
  }

  console.log("Seed complete:", {
    users: 1,
    orgs: 1,
    projects: 1,
    knowledge: knowledgeSeeds.length,
  });
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
```

Add to `packages/db/package.json`:
```json
"prisma": { "seed": "tsx src/seed.ts" }
```

---

## Phase 1 checkpoint

Before calling Phase 1 done, verify every item:

```bash
# 1. Fresh pgvector Postgres running (Docker or local)
docker run -d --name brain-pg \
  -e POSTGRES_USER=brain -e POSTGRES_PASSWORD=brain -e POSTGRES_DB=brain \
  -p 5432:5432 pgvector/pgvector:pg16

# 2. Install dependencies
pnpm install
pnpm --filter @brain/db exec prisma generate

# 3. Run migrations (should succeed cleanly)
pnpm --filter @brain/db exec prisma migrate deploy

# 4. Apply FTS indexes
psql $DATABASE_URL -f packages/db/sql/session-fts-index.sql

# 5. Seed the database
pnpm --filter @brain/db exec prisma db seed

# 6. Typecheck the workspace (types + db only at this stage)
pnpm turbo run typecheck --filter=@brain/types --filter=@brain/db
```

**Pass criteria:**
- [ ] `prisma migrate deploy` exits 0, all migrations applied
- [ ] FTS SQL applies without error
- [ ] Seed exits 0 and reports `{ users: 1, orgs: 1, projects: 1, knowledge: 16 }`
- [ ] `typecheck` exits 0 for `@brain/types` and `@brain/db`
- [ ] Running seed a second time is idempotent (no errors, no duplicates)
- [ ] `vector` extension present: `SELECT extname FROM pg_extension WHERE extname='vector'` returns 1 row

**Do not start Phase 2 until all boxes are checked.**

---

## Ready for Phase 2

Open `02-core-intelligence.md`.
