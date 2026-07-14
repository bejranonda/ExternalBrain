# Meeting Transcript Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in project member can paste a meeting transcript into a new `meetings` surface in the webapp shell, review LLM-extracted decisions/action-items/open-questions (with assignee dropdowns and decision-supersession suggestions), and confirm each one into the Brain via the existing teach path — no new database tables.

**Architecture:** Stateless extraction (`POST /api/meetings/extract`, flag-gated, rate-limited) returns candidates to browser React state; nothing persists until the user confirms an item, which then calls the existing (two small extensions needed) `POST /api/knowledge`. History is derived by querying already-taught rows tagged `meeting:<date-slug>` via a new `tagPrefix` filter on the existing `GET /api/knowledge`.

**Tech Stack:** TypeScript strict, Next.js App Router (client components + Route Handlers), Prisma (no schema change), zod, vitest (core unit + db-guarded integration tests), Playwright (flag-gated e2e).

**Spec:** `docs/superpowers/specs/2026-07-13-meeting-transcript-upload-design.md`

## Global Constraints

- **NO Prisma migration.** Verify `git diff <base>..HEAD --stat -- packages/db/prisma/migrations` is empty before every merge in this program.
- **Flag default OFF**: `MEETING_UPLOAD_ENABLED`, `boolish(false)` in `packages/core/src/env.ts`'s `WebExtra` block. Deployed behavior must be byte-identical to today until the operator flips it.
- **Any new env var MUST also be added to `deploy/docker-compose.yml`'s `web` service `environment:` allowlist** — `.env` alone is silently ignored at runtime. This exact mistake shipped once already on this V2 program (2026-07-09) and is now a standing GUIDELINES/KNOWN_ISSUES lesson; do not repeat it.
- **Semantic retrieval is owner-scoped in this codebase** (`kra.ts`'s `fetchCandidates`, Oracle's `buildContext` — both hard-filter `ownerUserId = caller`). Decisions are shared team knowledge; a supersession search MUST NOT reuse those owner-scoped functions as-is — see Task 5.
- **This app is a single-page shell with hash-based surface switching**, not per-surface Next.js routes — `apps/web/lib/brain/routes.ts`'s `ROUTES` array + `apps/web/components/brain/app.tsx`'s `screens` object, not a new `app/meetings/page.tsx`.
- **Webapp code has no unit-test convention** (confirmed: no `*.test.ts` files under `apps/web`) — webapp verification is Playwright e2e only, and CI wires e2e specs via an **explicit file list** in `.github/workflows/*.yml`, not a glob. A spec existing in the repo is not evidence it runs (this bit a previous PR in this same program on 2026-07-10) — Task 8 must confirm the new spec is actually invoked, not just exist.
- Package boundary: `types → db → core → (mcp-server | web | worker)`.
- Conventional Commits. Branch `feature/meeting-transcript-upload` off `main`.
- Local gates cannot run in this checkout (Node 18, no pnpm) — rely on CI; hand-verify cross-file references (imports, exported names) before pushing.

---

### Task 1: `POST /api/knowledge` accepts `action_item` + `supersedesKnowledgeId`

**Files:**
- Modify: `apps/web/app/api/knowledge/route.ts`
- Test: `apps/web/app/api/knowledge/route.test.ts` (new — first unit test file for this route; mirror the db-guard pattern from `packages/core/src/__tests__/action-items.test.ts`)

**Interfaces:**
- Produces: `POST /api/knowledge` accepts `type: "action_item"` in `createSchema`; accepts optional `supersedesKnowledgeId: string`, which calls `supersedeKnowledge(db, { newId, supersededId, userId })` from `@brain/core` after creation, mirroring `apps/mcp-server/src/tools/teach.ts`'s existing MCP behavior.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/app/api/knowledge/route.test.ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { ensureDefaultProject } from "@brain/core";
import { POST } from "./route.js";

const dbReachable = await db.$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);
const guard = dbReachable ? describe : describe.skip;

// getCurrentUserId() reads the request's session; route handlers in this
// app resolve auth via cookies, which a bare `POST` unit call can't fake.
// Mock the auth seam the same way the route imports it.
import * as authLib from "@/lib/brain/auth";
import { vi } from "vitest";

guard("POST /api/knowledge — action_item + supersedesKnowledgeId", () => {
  const created = { userIds: [] as string[], knowledgeIds: [] as string[] };
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    const u = await db.user.create({
      data: { email: `knowledge-route-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    created.userIds.push(u.id);
    userId = u.id;
    projectId = (await ensureDefaultProject(db, userId)).projectId;
    vi.spyOn(authLib, "getCurrentUserId").mockResolvedValue(userId);
  });

  afterAll(async () => {
    await db.knowledge.deleteMany({ where: { id: { in: created.knowledgeIds } } }).catch(() => {});
    for (const uid of created.userIds) {
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    vi.restoreAllMocks();
    await db.$disconnect().catch(() => {});
  });

  it("creates an action_item row", async () => {
    const req = new Request("http://test.local/api/knowledge", {
      method: "POST",
      body: JSON.stringify({
        type: "action_item",
        triggerText: "sprint planning 2026-07-14",
        ruleText: "fix the staging database",
        tags: ["action-item", "for:someone@test.local"],
        ownerProjectId: projectId,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { id: string } };
    created.knowledgeIds.push(body.item.id);
    const row = await db.knowledge.findUniqueOrThrow({ where: { id: body.item.id } });
    expect(row.type).toBe("action_item");
  });

  it("supersedesKnowledgeId retires the old row and links parentKnowledgeId", async () => {
    const old = await db.knowledge.create({
      data: {
        type: "principle", scope: "project", ownerUserId: userId, ownerProjectId: projectId,
        triggerText: "old decision trigger", ruleText: "use plain postgres",
        tags: ["decision"], confidence: 1.0, extractedBy: "user",
      },
      select: { id: true },
    });
    created.knowledgeIds.push(old.id);

    const req = new Request("http://test.local/api/knowledge", {
      method: "POST",
      body: JSON.stringify({
        type: "principle",
        triggerText: "new decision trigger",
        ruleText: "use postgres with timescale",
        tags: ["decision"],
        ownerProjectId: projectId,
        supersedesKnowledgeId: old.id,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { id: string } };
    created.knowledgeIds.push(body.item.id);

    const oldRow = await db.knowledge.findUniqueOrThrow({ where: { id: old.id } });
    expect(oldRow.deletedAt).not.toBeNull();
    const newRow = await db.knowledge.findUniqueOrThrow({ where: { id: body.item.id } });
    expect(newRow.parentKnowledgeId).toBe(old.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (relying on CI — this checkout has no local pnpm): push to a scratch branch and check the CI unit-test job. Expected: FAIL — `type.enum` rejects `"action_item"`, and `supersedesKnowledgeId` is stripped by zod's default `.parse()` behavior (unknown keys silently dropped, not an error, so the second test fails on `newRow.parentKnowledgeId` being `null`).

- [ ] **Step 3: Implement**

In `apps/web/app/api/knowledge/route.ts`, find the `createSchema` (currently `type: z.enum(["recipe", "heuristic", "principle", "reflex", "anti_principle"])`) and the `POST` handler's creation block:

```typescript
const createSchema = z.object({
  type: z.enum(["recipe", "heuristic", "principle", "reflex", "anti_principle", "action_item"]),
  triggerText: z.string().min(1),
  ruleText: z.string().min(1),
  rationale: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  scope: z.enum(["user", "project", "team", "global"]).default("user"),
  confidence: z.number().min(0).max(1).default(0.7),
  ownerProjectId: z.string().optional(),
  supersedesKnowledgeId: z.string().optional(),
});
```

Add `supersedeKnowledge` to the existing `@brain/core` import list in this file, then after the existing `db.knowledge.create({...})` call (before the `writeAudit` call), insert:

```typescript
    if (body.supersedesKnowledgeId) {
      await supersedeKnowledge(db, {
        newId: row.id,
        supersededId: body.supersedesKnowledgeId,
        userId,
      });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Push and check CI. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/knowledge/route.ts apps/web/app/api/knowledge/route.test.ts
git commit -m "feat(web): POST /api/knowledge accepts action_item + supersedesKnowledgeId"
```

---

### Task 2: `GET /api/knowledge` accepts `tagPrefix`

**Files:**
- Modify: `apps/web/app/api/knowledge/route.ts`
- Test: `apps/web/app/api/knowledge/route.test.ts` (extend)

**Interfaces:**
- Consumes: existing `buildKnowledgeWhereV2` composition already in this route's `GET` handler.
- Produces: `GET /api/knowledge?tagPrefix=meeting:` filters to rows where any tag starts with the given prefix, combined via `AND` with the existing `type`/`scope`/`visibility` filters.

- [ ] **Step 1: Write the failing test**

Add to the same `describe` block in `route.test.ts` (import `GET` alongside `POST`):

```typescript
  it("GET ?tagPrefix=meeting: returns only tagged rows", async () => {
    const tagged = await db.knowledge.create({
      data: {
        type: "action_item", scope: "project", ownerUserId: userId, ownerProjectId: projectId,
        triggerText: "t", ruleText: "tagged item",
        tags: ["action-item", "meeting:2026-07-14-standup"],
        confidence: 1.0, extractedBy: "user",
      },
      select: { id: true },
    });
    const untagged = await db.knowledge.create({
      data: {
        type: "action_item", scope: "project", ownerUserId: userId, ownerProjectId: projectId,
        triggerText: "t", ruleText: "untagged item",
        tags: ["action-item"],
        confidence: 1.0, extractedBy: "user",
      },
      select: { id: true },
    });
    created.knowledgeIds.push(tagged.id, untagged.id);

    const req = new Request("http://test.local/api/knowledge?tagPrefix=meeting%3A");
    const res = await GET(req);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(tagged.id);
    expect(ids).not.toContain(untagged.id);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `tagPrefix` param is currently ignored, both rows returned.

- [ ] **Step 3: Implement**

In the `GET` handler, after the existing `const type = url.searchParams.get("type");` line, add:

```typescript
    const tagPrefix = url.searchParams.get("tagPrefix");
```

Find where `baseWhere` (from `buildKnowledgeWhereV2`) is combined with the `type` filter into the final Prisma `where` clause passed to `db.knowledge.findMany`. Wrap it in an `AND` array that conditionally includes a tag-prefix filter. Prisma's `Json`/array `tags` field (`String[]`) supports `hasSome`, but a prefix match needs raw filtering since Prisma has no "array element startsWith" operator — fetch candidate rows via the existing where clause, then filter by prefix in application code (the endpoint already caps `limit` at 500, so this is a bounded, cheap in-memory filter, not a scale concern):

```typescript
    let rows = await db.knowledge.findMany({
      where: finalWhere, // existing variable name — verify against the file
      orderBy: [{ createdAt: "desc" }],
      take: limit,
    });
    if (tagPrefix) {
      rows = rows.filter((r) => r.tags.some((t) => t.startsWith(tagPrefix)));
    }
```

(Locate the exact existing variable name for the Prisma `where` object and the `findMany` call in this file — do not introduce a second query; splice the filter into the existing query result before it's mapped to `toKnowledgeItemView`.)

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/knowledge/route.ts apps/web/app/api/knowledge/route.test.ts
git commit -m "feat(web): GET /api/knowledge accepts tagPrefix filter"
```

---

### Task 3: env flags + compose allowlist

**Files:**
- Modify: `packages/core/src/env.ts`
- Modify: `.env.example`
- Modify: `deploy/docker-compose.yml`
- Test: `packages/core/src/__tests__/env.test.ts` (extend)

**Interfaces:**
- Produces: `envForWeb().MEETING_UPLOAD_ENABLED: boolean` (default `false`); `envForWeb().RATE_LIMIT_MEETING_EXTRACT_PER_DAY: number` (default `20`).

- [ ] **Step 1: Write the failing test**

```typescript
  it("meeting-upload flags default off / rate-limited", () => {
    setEnv({ DATABASE_URL: "postgresql://x" });
    expect(envForWeb().MEETING_UPLOAD_ENABLED).toBe(false);
    expect(envForWeb().RATE_LIMIT_MEETING_EXTRACT_PER_DAY).toBe(20);

    setEnv({
      DATABASE_URL: "postgresql://x",
      MEETING_UPLOAD_ENABLED: "true",
      RATE_LIMIT_MEETING_EXTRACT_PER_DAY: "5",
    });
    expect(envForWeb().MEETING_UPLOAD_ENABLED).toBe(true);
    expect(envForWeb().RATE_LIMIT_MEETING_EXTRACT_PER_DAY).toBe(5);
  });
```

Add `"MEETING_UPLOAD_ENABLED"` and `"RATE_LIMIT_MEETING_EXTRACT_PER_DAY"` to the `KEEP` array at the top of `env.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — zod schema doesn't know these keys, `envForWeb()` throws or returns `undefined` for them (depending on strict mode; either way the assertion fails).

- [ ] **Step 3: Implement**

In `packages/core/src/env.ts`'s `WebExtra` object, alongside `RATE_LIMIT_ORACLE_PER_DAY: intFrom(100),`:

```typescript
  RATE_LIMIT_MEETING_EXTRACT_PER_DAY: intFrom(20),
```

and alongside `ORACLE_ENABLED: boolish(true),`:

```typescript
  // V2.0 meeting-transcript-upload webapp surface (spec 2026-07-13) — dark
  // until the operator flips it. New LLM-cost-incurring surface, decoupled
  // from the rest of V2 (which is deterministic/zero-cost).
  MEETING_UPLOAD_ENABLED: boolish(false),
```

In `.env.example`, in the `# --- Feature flags ---` block near `MCP_ENABLED`:

```bash
MEETING_UPLOAD_ENABLED="false"            # WIRED — /meetings extraction endpoint returns 503 when false
RATE_LIMIT_MEETING_EXTRACT_PER_DAY="20"   # per-user daily cap on transcript extraction calls
```

In `deploy/docker-compose.yml`, find the `web` service's `environment:` block (where `ORACLE_ENABLED: ${ORACLE_ENABLED:-true}` and `V2_ORACLE_TASKS: ${V2_ORACLE_TASKS:-false}` live) and add:

```yaml
      MEETING_UPLOAD_ENABLED: ${MEETING_UPLOAD_ENABLED:-false}
      RATE_LIMIT_MEETING_EXTRACT_PER_DAY: ${RATE_LIMIT_MEETING_EXTRACT_PER_DAY:-20}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/env.ts packages/core/src/__tests__/env.test.ts .env.example deploy/docker-compose.yml
git commit -m "feat: MEETING_UPLOAD_ENABLED + rate-limit flags (dark, compose allowlist included)"
```

---

### Task 4: `meeting-extract.ts` — pure extraction core

**Files:**
- Create: `packages/core/src/meeting-extract.ts`
- Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/src/__tests__/meeting-extract.test.ts`

**Interfaces:**
- Consumes: `callLLMText`, `LLMDeps` from `./llm.js`.
- Produces:
  - `ExtractedDecision = { triggerText: string; ruleText: string; rationale: string; instead: string }`
  - `ExtractedActionItem = { triggerText: string; ruleText: string; assigneeGuessEmail: string | null; blocker: boolean; kind: "action-item" | "open-question" }`
  - `ExtractedMeeting = { decisions: ExtractedDecision[]; actionItems: ExtractedActionItem[] }`
  - `buildExtractionPrompt(transcript: string): string`
  - `parseExtractionResponse(raw: string): ExtractedMeeting`
  - `extractMeeting(transcript: string, model: string, deps?: LLMDeps): Promise<ExtractedMeeting>`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/__tests__/meeting-extract.test.ts
import { describe, expect, it } from "vitest";
import type { LLMDeps } from "../llm.js";
import {
  buildExtractionPrompt,
  parseExtractionResponse,
  extractMeeting,
} from "../meeting-extract.js";

describe("buildExtractionPrompt", () => {
  it("embeds the transcript verbatim", () => {
    const prompt = buildExtractionPrompt("Anna: staging DB is broken.");
    expect(prompt).toContain("Anna: staging DB is broken.");
  });
});

describe("parseExtractionResponse", () => {
  it("parses a well-formed response", () => {
    const raw = JSON.stringify({
      decisions: [{ trigger: "reporting store", rule: "use postgres+timescale", rationale: "time-bucketed queries", instead: "plain postgres" }],
      actionItems: [{ trigger: "sprint planning", rule: "fix staging db", assigneeGuessEmail: "ben@test.local", blocker: true, kind: "action-item" }],
    });
    const out = parseExtractionResponse(raw);
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]!.ruleText).toBe("use postgres+timescale");
    expect(out.actionItems).toHaveLength(1);
    expect(out.actionItems[0]!.blocker).toBe(true);
  });

  it("strips markdown fences", () => {
    const raw = "```json\n" + JSON.stringify({ decisions: [], actionItems: [] }) + "\n```";
    const out = parseExtractionResponse(raw);
    expect(out.decisions).toEqual([]);
    expect(out.actionItems).toEqual([]);
  });

  it("fails soft to empty arrays on malformed JSON", () => {
    const out = parseExtractionResponse("not json at all");
    expect(out).toEqual({ decisions: [], actionItems: [] });
  });

  it("fails soft when a field is the wrong shape", () => {
    const raw = JSON.stringify({ decisions: "not an array", actionItems: [] });
    const out = parseExtractionResponse(raw);
    expect(out.decisions).toEqual([]);
  });

  it("drops individual malformed items without dropping the whole batch", () => {
    const raw = JSON.stringify({
      decisions: [],
      actionItems: [
        { trigger: "t", rule: "valid one", assigneeGuessEmail: null, blocker: false, kind: "action-item" },
        { trigger: "t" }, // missing rule — invalid
      ],
    });
    const out = parseExtractionResponse(raw);
    expect(out.actionItems).toHaveLength(1);
    expect(out.actionItems[0]!.ruleText).toBe("valid one");
  });
});

describe("extractMeeting", () => {
  function recordingDeps(response: string): { deps: LLMDeps; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        anthropic: async (p) => { calls.push(`anthropic:${p.length}`); return response; },
        openai: async (p) => { calls.push(`openai:${p.length}`); return response; },
        dashscope: async (p) => { calls.push(`dashscope:${p.length}`); return response; },
      },
    };
  }

  it("dispatches to the given model family and returns parsed output", async () => {
    const response = JSON.stringify({ decisions: [], actionItems: [] });
    const { deps, calls } = recordingDeps(response);
    const out = await extractMeeting("a transcript", "qwen3-coder", deps);
    expect(calls[0]).toMatch(/^dashscope:/);
    expect(out).toEqual({ decisions: [], actionItems: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `meeting-extract.ts` does not exist yet.

- [ ] **Step 3: Implement**

```typescript
// packages/core/src/meeting-extract.ts
/**
 * Stateless meeting-transcript extraction (spec 2026-07-13). Pure
 * prompt-build / response-parse core, mirroring kea.ts's runLLM/parseFindings
 * pattern — the LLM call itself goes through the shared callLLMText seam so
 * this stays unit-testable without a provider key (GUIDELINES §4, "Testing
 * LLM-backed units").
 *
 * Deliberately does NOT write to the database. The caller (the
 * /api/meetings/extract route) owns turning confirmed items into Knowledge
 * rows via the existing teach path — this module only extracts + parses.
 */
import { callLLMText, type LLMDeps } from "./llm.js";

export interface ExtractedDecision {
  triggerText: string;
  ruleText: string;
  rationale: string;
  instead: string;
}

export interface ExtractedActionItem {
  triggerText: string;
  ruleText: string;
  assigneeGuessEmail: string | null;
  blocker: boolean;
  kind: "action-item" | "open-question";
}

export interface ExtractedMeeting {
  decisions: ExtractedDecision[];
  actionItems: ExtractedActionItem[];
}

const SYSTEM_PROMPT = `You are extracting structured content from a meeting transcript for a team knowledge base.

Extract two kinds of things:
1. DECISIONS — settled choices the team made ("we'll use X", "not Y").
2. ACTION ITEMS and OPEN QUESTIONS — concrete to-dos with an owner, or
   unresolved questions raised in the meeting.

Do NOT invent content. If the transcript has no decisions, return an empty
decisions array. If it has no action items or open questions, return an
empty actionItems array. Only extract what is actually stated.

Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "decisions": [
    { "trigger": "when this decision applies", "rule": "the decision as stated", "rationale": "why, as argued in the meeting", "instead": "the rejected alternative, if any, else empty string" }
  ],
  "actionItems": [
    { "trigger": "context or deadline", "rule": "the task or question, imperative", "assigneeGuessEmail": "best-guess email if the transcript states one, else null", "blocker": true or false, "kind": "action-item" or "open-question" }
  ]
}`;

export function buildExtractionPrompt(transcript: string): string {
  return `MEETING TRANSCRIPT:\n${transcript}\n\nExtract now.`;
}

function isValidDecision(d: unknown): d is { trigger: string; rule: string; rationale?: string; instead?: string } {
  if (typeof d !== "object" || d === null) return false;
  const r = d as Record<string, unknown>;
  return typeof r["trigger"] === "string" && typeof r["rule"] === "string";
}

function isValidActionItem(
  a: unknown,
): a is { trigger: string; rule: string; assigneeGuessEmail?: string | null; blocker?: boolean; kind?: string } {
  if (typeof a !== "object" || a === null) return false;
  const r = a as Record<string, unknown>;
  return typeof r["trigger"] === "string" && typeof r["rule"] === "string";
}

export function parseExtractionResponse(raw: string): ExtractedMeeting {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null) return { decisions: [], actionItems: [] };
    const p = parsed as Record<string, unknown>;

    const decisions: ExtractedDecision[] = Array.isArray(p["decisions"])
      ? p["decisions"]
          .filter(isValidDecision)
          .map((d) => ({
            triggerText: d.trigger,
            ruleText: d.rule,
            rationale: d.rationale ?? "",
            instead: d.instead ?? "",
          }))
      : [];

    const actionItems: ExtractedActionItem[] = Array.isArray(p["actionItems"])
      ? p["actionItems"]
          .filter(isValidActionItem)
          .map((a) => ({
            triggerText: a.trigger,
            ruleText: a.rule,
            assigneeGuessEmail: a.assigneeGuessEmail ?? null,
            blocker: a.blocker === true,
            kind: a.kind === "open-question" ? "open-question" : "action-item",
          }))
      : [];

    return { decisions, actionItems };
  } catch {
    return { decisions: [], actionItems: [] };
  }
}

export async function extractMeeting(
  transcript: string,
  model: string,
  deps?: LLMDeps,
): Promise<ExtractedMeeting> {
  const userPrompt = buildExtractionPrompt(transcript);
  const text = await callLLMText(
    userPrompt,
    { model, systemPrompt: SYSTEM_PROMPT, maxTokens: 2048 },
    deps as LLMDeps, // callLLMText's default param covers the production (deps=undefined) call site
  );
  return parseExtractionResponse(text);
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `packages/core/src/index.ts`, alongside `export * as actionItems from "./action-items.js";`:

```typescript
export * as meetingExtract from "./meeting-extract.js";
export type { ExtractedMeeting, ExtractedDecision, ExtractedActionItem } from "./meeting-extract.js";
```

```bash
git add packages/core/src/meeting-extract.ts packages/core/src/__tests__/meeting-extract.test.ts packages/core/src/index.ts
git commit -m "feat(core): meeting-extract — pure prompt-build/parse core for transcript extraction"
```

---

### Task 5: project-wide decision-supersession candidate search

**Files:**
- Modify: `packages/core/src/meeting-extract.ts`
- Test: `packages/core/src/__tests__/meeting-extract.test.ts` (extend, db-guarded)

**Interfaces:**
- Consumes: `db` from `@brain/db`, `toVector` from `@brain/db`, `embed` from `./embedding.js`, `buildRawProjectFilterV2` from `./scope-filter.js`.
- Produces: `findSupersessionCandidates(opts: { ruleText: string; projectId: string; accessibleProjectIds?: string[]; limit?: number }): Promise<Array<{ id: string; ruleText: string; similarity: number }>>`

- [ ] **Step 1: Write the failing test**

Append to `meeting-extract.test.ts`, following the db-guard pattern from `action-items.test.ts`:

```typescript
import { db } from "@brain/db";
import { ensureDefaultProject } from "../org.js";
import { findSupersessionCandidates } from "../meeting-extract.js";

const dbReachable2 = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const guard2 = dbReachable2 ? describe : describe.skip;

guard2("findSupersessionCandidates — project-wide, not owner-scoped", () => {
  const created = { userIds: [] as string[], knowledgeIds: [] as string[] };
  let creatorId: string;
  let otherUserId: string;
  let projectId: string;
  let otherProjectDecisionId: string;
  let sameProjectByOtherUserId: string;

  beforeAll(async () => {
    creatorId = (await db.user.create({ data: { email: `sup-a-${randomBytes(6).toString("hex")}@test.local` }, select: { id: true } })).id;
    otherUserId = (await db.user.create({ data: { email: `sup-b-${randomBytes(6).toString("hex")}@test.local` }, select: { id: true } })).id;
    created.userIds.push(creatorId, otherUserId);
    projectId = (await ensureDefaultProject(db, creatorId)).projectId;
    const otherProjectId = (await ensureDefaultProject(db, otherUserId)).projectId;

    // A decision taught by a DIFFERENT user, in the SAME project — this is
    // the case owner-scoped search (kra.candidatesForPrompt) would miss.
    const row = await db.knowledge.create({
      data: {
        type: "principle", scope: "project", ownerUserId: otherUserId, ownerProjectId: projectId,
        triggerText: "reporting store choice", ruleText: "use plain postgres for reporting",
        tags: ["decision"], confidence: 1.0, extractedBy: "user",
      },
      select: { id: true },
    });
    sameProjectByOtherUserId = row.id;
    created.knowledgeIds.push(row.id);
    await db.$executeRawUnsafe(
      `UPDATE "Knowledge" SET embedding = $1::vector WHERE id = $2`,
      `[${new Array(1536).fill(0.001).join(",")}]`,
      row.id,
    );

    const foreign = await db.knowledge.create({
      data: {
        type: "principle", scope: "project", ownerUserId: otherUserId, ownerProjectId: otherProjectId,
        triggerText: "unrelated", ruleText: "an unrelated foreign-project decision",
        tags: ["decision"], confidence: 1.0, extractedBy: "user",
      },
      select: { id: true },
    });
    otherProjectDecisionId = foreign.id;
    created.knowledgeIds.push(foreign.id);
    await db.$executeRawUnsafe(
      `UPDATE "Knowledge" SET embedding = $1::vector WHERE id = $2`,
      `[${new Array(1536).fill(0.001).join(",")}]`,
      foreign.id,
    );
  });

  afterAll(async () => {
    await db.knowledge.deleteMany({ where: { id: { in: created.knowledgeIds } } }).catch(() => {});
    for (const uid of created.userIds) await db.user.delete({ where: { id: uid } }).catch(() => {});
    await db.$disconnect().catch(() => {});
  });

  it("finds a decision taught by a DIFFERENT user in the same project", async () => {
    const candidates = await findSupersessionCandidates({
      ruleText: "use postgres with timescale for reporting",
      projectId,
    });
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain(sameProjectByOtherUserId);
    expect(ids).not.toContain(otherProjectDecisionId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `findSupersessionCandidates` does not exist. (Note: this test needs a real embedding provider to run the `embed()` call inside the function meaningfully, OR — since CI has no embedding key — the function must still execute the SQL shape correctly even against a manually-seeded flat embedding, per the same pattern used in `action-items.test.ts`'s exclusion test. If `embed()` throws in keyless CI, wrap the test to skip gracefully the same way, or inject a fixed query vector — verify against how other tests in this repo handle the no-embedding-key CI case before finalizing this step.)

- [ ] **Step 3: Implement**

Add to `packages/core/src/meeting-extract.ts`:

```typescript
import { db, toVector } from "@brain/db";
import { embed } from "./embedding.js";
import { buildRawProjectFilterV2 } from "./scope-filter.js";

export interface SupersessionCandidate {
  id: string;
  ruleText: string;
  similarity: number;
}

/**
 * Search for existing decisions this extracted decision might replace —
 * DELIBERATELY project-wide, not owner-scoped. kra.ts's fetchCandidates and
 * Oracle's buildContext both hard-filter `ownerUserId = caller`, which is
 * correct for personal rule retrieval but wrong here: decisions are shared
 * team knowledge, and the decision being superseded may have been taught by
 * any project member, not just the person reviewing this extraction. See
 * GUIDELINES §7 / the 2026-07-10 security-review lesson: cross-user
 * features must be designed on deterministic/explicit-scope paths, not by
 * reusing an owner-scoped retrieval function.
 */
export async function findSupersessionCandidates(opts: {
  ruleText: string;
  projectId: string;
  accessibleProjectIds?: string[];
  limit?: number;
}): Promise<SupersessionCandidate[]> {
  const vec = toVector(await embed(opts.ruleText));
  const { sql: projectFilter, params: projectParams } = buildRawProjectFilterV2(
    {
      userId: "", // unused by the project-scope branch when activeProjectId is set; see scope-filter.ts
      activeProjectId: opts.projectId,
      activeOrgId: null,
      accessibleProjectIds: opts.accessibleProjectIds ?? [],
      scope: "project",
    },
    2,
  );
  const rows = await db.$queryRawUnsafe<Array<{ id: string; ruleText: string; _similarity: number }>>(
    `
    SELECT id, "ruleText", 1 - (embedding <=> $1::vector) AS "_similarity"
    FROM "Knowledge"
    WHERE embedding IS NOT NULL
      AND "deletedAt" IS NULL
      AND 'decision' = ANY(tags)
      ${projectFilter}
    ORDER BY embedding <=> $1::vector ASC
    LIMIT ${opts.limit ?? 5}
    `,
    vec,
    ...projectParams,
  );
  return rows.map((r) => ({ id: r.id, ruleText: r.ruleText, similarity: r._similarity }));
}
```

**Verify before finalizing:** `buildRawProjectFilterV2`'s project-scope branch (`scope: "project"`, `activeProjectId` set) — confirm from `scope-filter.ts` whether it references `userId` at all in that branch (the `§0-user context` branch does, the project branch may not). If it does reference `userId` even in the project branch, this function needs a real `userId` parameter threaded through from the caller (the API route has one) rather than the empty-string placeholder above — read `scope-filter.ts`'s `buildRawProjectFilterV2` in full before finalizing this step and adjust the signature to accept `userId: string` if the SQL actually uses `$` params tied to it.

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS (after resolving the userId question from Step 3's verification note).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/meeting-extract.ts packages/core/src/__tests__/meeting-extract.test.ts
git commit -m "feat(core): project-wide decision-supersession search (deliberately not owner-scoped)"
```

---

### Task 6: `POST /api/meetings/extract` route

**Files:**
- Create: `apps/web/app/api/meetings/extract/route.ts`
- Test: `apps/web/app/api/meetings/extract/route.test.ts`

**Interfaces:**
- Consumes: `meetingExtract.extractMeeting`, `meetingExtract.findSupersessionCandidates` from `@brain/core`; `listOrgMembers`, `requireOrgMember` from `@brain/core`; `getCurrentUserId`, `getActiveProject` from `@/lib/brain/auth` / `@/lib/brain/active-project`; `rateLimitCheck` from `@brain/core`; `envForWeb` from `@brain/core`.
- Produces: `POST /api/meetings/extract` → `{ decisions: Array<ExtractedDecision & { supersedes: SupersessionCandidate | null }>, actionItems: ExtractedActionItem[], members: Array<{ email: string; name: string | null }> }`, or `503` when the flag is off, `429` when rate-limited.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/app/api/meetings/extract/route.test.ts
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { ensureDefaultProject, _resetEnvCache } from "@brain/core";
import * as authLib from "@/lib/brain/auth";

const dbReachable = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("POST /api/meetings/extract", () => {
  const created = { userIds: [] as string[] };
  let userId: string;

  beforeAll(async () => {
    const u = await db.user.create({
      data: { email: `meetings-route-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    created.userIds.push(u.id);
    userId = u.id;
    await ensureDefaultProject(db, userId);
    vi.spyOn(authLib, "getCurrentUserId").mockResolvedValue(userId);
  });

  afterAll(async () => {
    for (const uid of created.userIds) await db.user.delete({ where: { id: uid } }).catch(() => {});
    vi.restoreAllMocks();
    delete process.env["MEETING_UPLOAD_ENABLED"];
    _resetEnvCache();
    await db.$disconnect().catch(() => {});
  });

  it("returns 503 when the flag is off", async () => {
    delete process.env["MEETING_UPLOAD_ENABLED"];
    _resetEnvCache();
    const { POST } = await import("./route.js");
    const req = new Request("http://test.local/api/meetings/extract", {
      method: "POST",
      body: JSON.stringify({ transcript: "hello" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// apps/web/app/api/meetings/extract/route.ts
import { z } from "zod";
import { db } from "@brain/db";
import {
  envForWeb,
  meetingExtract,
  listOrgMembers,
  rateLimitCheck,
  memoryStore,
} from "@brain/core";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";

const bodySchema = z.object({
  transcript: z.string().min(1).max(50_000),
});

function clientKey(userId: string): string {
  return `meeting-extract:${userId}`;
}

export async function POST(req: Request): Promise<Response> {
  try {
    if (!envForWeb().MEETING_UPLOAD_ENABLED) {
      return Response.json(
        { error: { code: "NOT_ENABLED", message: "Meeting upload is not enabled on this deployment." } },
        { status: 503 },
      );
    }

    const userId = await getCurrentUserId();
    const body = bodySchema.parse(await req.json());
    const { projectId, orgId } = await getActiveProject(userId);

    const limit = { windowMs: 86_400_000, max: envForWeb().RATE_LIMIT_MEETING_EXTRACT_PER_DAY };
    const rl = await rateLimitCheck(memoryStore, clientKey(userId), limit, Date.now());
    if (!rl.allowed) {
      return Response.json(
        { error: { code: "RATE_LIMITED", message: "Daily meeting-extraction limit reached." } },
        { status: 429 },
      );
    }

    const model = process.env["MEETING_EXTRACT_MODEL"] ?? process.env["KEA_MODEL"] ?? "qwen3-coder";
    const extracted = await meetingExtract.extractMeeting(body.transcript, model);

    const decisionsWithSupersession = await Promise.all(
      extracted.decisions.map(async (d) => {
        const candidates = await meetingExtract
          .findSupersessionCandidates({ ruleText: d.ruleText, projectId, limit: 1 })
          .catch(() => []);
        return { ...d, supersedes: candidates[0] ?? null };
      }),
    );

    const members = orgId ? await listOrgMembers(db, orgId) : [];

    return Response.json({
      decisions: decisionsWithSupersession,
      actionItems: extracted.actionItems,
      members: members.map((m) => ({ email: m.email, name: m.name })),
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
```

**Verify before finalizing:** confirm `rateLimitCheck`'s exact signature and `memoryStore`'s export name against `apps/web/proxy.ts`'s actual usage (read the full call site, not just the grep snippet from context-gathering) — the shape above is inferred from a partial read and may need adjusting to match the real `Limit`/`Store` types exported from `@brain/core`. Confirm `getActiveProject`'s return shape actually includes `orgId` (verify against `apps/web/lib/brain/active-project.ts`).

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/meetings/extract/route.ts apps/web/app/api/meetings/extract/route.test.ts
git commit -m "feat(web): POST /api/meetings/extract — flag-gated, rate-limited extraction endpoint"
```

---

### Task 7: `meetings` surface — wire into the shell

**Files:**
- Modify: `apps/web/lib/brain/routes.ts`
- Modify: `apps/web/components/brain/app.tsx`
- Modify: `apps/web/components/brain/shell.tsx`
- Modify: `apps/web/lib/brain/i18n.ts`

**Interfaces:**
- Consumes: nothing new yet (component itself is Task 8) — this task adds the *route slot* so Task 8's component has somewhere to render.
- Produces: `Route` type includes `"meetings"`; keyboard shortcut `8`; nav rail entries (desktop + mobile) visible only when a capability check passes (see below).

- [ ] **Step 1:** In `apps/web/lib/brain/routes.ts`, add `"meetings"` to the `ROUTES` array and `"8": "meetings"` to `KEY_MAP`.

- [ ] **Step 2:** In `apps/web/components/brain/app.tsx`, add `import { Meetings } from "./meetings";` (component created in Task 8 — this import will fail to resolve until then; acceptable within one feature branch, not across a merge) and add `meetings: <Meetings />,` to the `screens` object.

- [ ] **Step 3:** In `apps/web/components/brain/shell.tsx`, find both nav-item arrays (the desktop one starting `{ id: "dashboard", ... }` around the `Rail` component, and the second one for the mobile/bottom-nav variant). Add to each, after the `decisions` entry:

```typescript
    { id: "meetings", label: t("nav.meetings"), icon: "meetings", kbd: "8",
      hint: t("nav.hints.meetings") },
```

(Match the exact object shape already used by sibling entries in each array — some use `kbd`, confirm the mobile array's entries do or don't before copying that field verbatim.)

- [ ] **Step 4:** Check whether `icon: "meetings"` needs a corresponding SVG/icon-map entry (grep `shell.tsx` or a sibling icons file for how `icon: "decisions"` resolves to a rendered glyph) and add one following the same pattern — reuse an existing generic icon (e.g. the same glyph as "sessions" or a simple document icon) rather than commissioning new art for a v1 flagged-off feature.

- [ ] **Step 5:** In `apps/web/lib/brain/i18n.ts`, find the EN block's `dashboard: "Dashboard",` line and the corresponding `hints: { dashboard: ... }` sub-object. Add `meetings: "Meetings",` and a hint string to the EN block, and matching entries to the DE and TH blocks (grep each block for `decisions:` as the insertion anchor — it's the most recently added nav entry and will be physically adjacent in all three blocks).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/brain/routes.ts apps/web/components/brain/app.tsx apps/web/components/brain/shell.tsx apps/web/lib/brain/i18n.ts
git commit -m "feat(web): wire meetings surface into the shell (route, nav, i18n)"
```

(No isolated test for this task — it's glue code verified by Task 8's e2e spec, which needs the nav entry to exist to navigate to the surface at all.)

---

### Task 8: `Meetings` component — paste, review, history

**Files:**
- Create: `apps/web/components/brain/meetings.tsx`
- Create: `apps/web/e2e/meetings.spec.ts`
- Modify: `.github/workflows/authed-e2e.yml`

**Interfaces:**
- Consumes: `POST /api/meetings/extract` (Task 6), `POST /api/knowledge` (Task 1), `GET /api/knowledge?tagPrefix=meeting:` (Task 2).
- Produces: the `Meetings` component imported by `app.tsx` (Task 7).

- [ ] **Step 1:** Read `apps/web/components/brain/teach.tsx` in full immediately before writing this component — it's the closest existing precedent for "a form that POSTs to `/api/knowledge`" (submit handler shape, error display, loading state) and this component should match its conventions exactly rather than invent new ones.

- [ ] **Step 2:** Implement `apps/web/components/brain/meetings.tsx` as a client component with three pieces of state: `mode: "paste" | "review" | "history"`, `transcript: string`, and `candidates: { decisions: ...; actionItems: ... } | null`. Structure:

```typescript
"use client";

import { useState } from "react";
import { useT } from "@/lib/brain/i18n";

interface DecisionCandidate {
  triggerText: string;
  ruleText: string;
  rationale: string;
  instead: string;
  supersedes: { id: string; ruleText: string; similarity: number } | null;
}

interface ActionItemCandidate {
  triggerText: string;
  ruleText: string;
  assigneeGuessEmail: string | null;
  blocker: boolean;
  kind: "action-item" | "open-question";
}

interface Member {
  email: string;
  name: string | null;
}

interface ExtractResponse {
  decisions: DecisionCandidate[];
  actionItems: ActionItemCandidate[];
  members: Member[];
}

export function Meetings() {
  const t = useT();
  const [mode, setMode] = useState<"paste" | "review" | "history">("paste");
  const [transcript, setTranscript] = useState("");
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [taught, setTaught] = useState<Set<number>>(new Set());
  const [decisionSupersedeConfirmed, setDecisionSupersedeConfirmed] = useState<Set<number>>(new Set());
  const [actionItemAssignee, setActionItemAssignee] = useState<Record<number, string>>({});

  async function handleExtract(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/meetings/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `Extraction failed (${res.status})`);
      }
      const data = (await res.json()) as ExtractResponse;
      if (data.decisions.length === 0 && data.actionItems.length === 0) {
        setError(
          "Didn't find any decisions, action items, or open questions in this text — try pasting the raw transcript, or use + Teach a skill for one-off facts.",
        );
        return;
      }
      setResult(data);
      setMode("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setLoading(false);
    }
  }

  const meetingTag = `meeting:${meetingDate}`;

  async function teachDecision(index: number): Promise<void> {
    if (!result) return;
    const d = result.decisions[index]!;
    const supersedes = decisionSupersedeConfirmed.has(index) ? d.supersedes : null;
    const res = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "principle",
        scope: "project",
        triggerText: d.triggerText,
        ruleText: d.ruleText,
        rationale: d.rationale || undefined,
        tags: ["decision", meetingTag],
        ...(supersedes ? { supersedesKnowledgeId: supersedes.id } : {}),
      }),
    });
    if (res.ok) setTaught((prev) => new Set(prev).add(index));
  }

  async function teachActionItem(index: number): Promise<void> {
    if (!result) return;
    const a = result.actionItems[index]!;
    const assignee = actionItemAssignee[index] ?? a.assigneeGuessEmail ?? "";
    const tags = [
      a.kind === "open-question" ? "open-question" : "action-item",
      meetingTag,
      ...(a.blocker ? ["blocker"] : []),
      ...(assignee ? [`for:${assignee.toLowerCase()}`] : []),
    ];
    const res = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "action_item",
        scope: "project",
        triggerText: a.triggerText,
        ruleText: a.ruleText,
        tags,
      }),
    });
    if (res.ok) setTaught((prev) => new Set(prev).add(1000 + index)); // offset to share the Set with decisions
  }

  return (
    <div className="meetings-surface">
      <h1>{t("nav.meetings")}</h1>

      <div className="tabs">
        <button onClick={() => setMode("paste")} aria-current={mode === "paste"}>Paste</button>
        {result && <button onClick={() => setMode("review")} aria-current={mode === "review"}>Review</button>}
        <button onClick={() => setMode("history")} aria-current={mode === "history"}>History</button>
      </div>

      {mode === "paste" && (
        <div>
          <label>
            Meeting date
            <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} />
          </label>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste the meeting transcript or notes here…"
            rows={16}
          />
          {error && <div role="alert">{error}</div>}
          <button onClick={handleExtract} disabled={loading || transcript.trim().length === 0}>
            {loading ? "Extracting…" : "Extract"}
          </button>
        </div>
      )}

      {mode === "review" && result && (
        <div>
          <h2>Decisions</h2>
          {result.decisions.map((d, i) => (
            <div key={i} data-testid={`decision-card-${i}`}>
              <p>{d.ruleText}</p>
              {d.instead && <p>Not: {d.instead}</p>}
              {d.supersedes && (
                <label>
                  <input
                    type="checkbox"
                    checked={decisionSupersedeConfirmed.has(i)}
                    onChange={(e) =>
                      setDecisionSupersedeConfirmed((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(i); else next.delete(i);
                        return next;
                      })
                    }
                  />
                  Replaces: "{d.supersedes.ruleText}"
                </label>
              )}
              <button onClick={() => teachDecision(i)} disabled={taught.has(i)}>
                {taught.has(i) ? "✓ Taught" : "Teach"}
              </button>
            </div>
          ))}

          <h2>Action Items &amp; Open Questions</h2>
          {result.actionItems.map((a, i) => (
            <div key={i} data-testid={`action-item-card-${i}`}>
              {a.blocker && <span>BLOCKER</span>}
              <p>{a.ruleText}</p>
              <select
                value={actionItemAssignee[i] ?? a.assigneeGuessEmail ?? ""}
                onChange={(e) => setActionItemAssignee((prev) => ({ ...prev, [i]: e.target.value }))}
              >
                <option value="">— unassigned —</option>
                {result.members.map((m) => (
                  <option key={m.email} value={m.email}>{m.name ?? m.email}</option>
                ))}
              </select>
              <button onClick={() => teachActionItem(i)} disabled={taught.has(1000 + i)}>
                {taught.has(1000 + i) ? "✓ Taught" : "Teach"}
              </button>
            </div>
          ))}
        </div>
      )}

      {mode === "history" && <MeetingHistory />}
    </div>
  );
}

function MeetingHistory() {
  const [rows, setRows] = useState<Array<{ id: string; ruleText: string; tags: string[] }> | null>(null);

  useState(() => {
    fetch("/api/knowledge?tagPrefix=meeting%3A")
      .then((r) => r.json())
      .then((data: { items: Array<{ id: string; body: string; tags: string[] }> }) =>
        setRows(data.items.map((i) => ({ id: i.id, ruleText: i.body, tags: i.tags }))),
      )
      .catch(() => setRows([]));
  });

  if (rows === null) return <p>Loading…</p>;
  if (rows.length === 0) return <p>No meetings imported yet.</p>;

  const byMeeting = new Map<string, typeof rows>();
  for (const row of rows) {
    const tag = row.tags.find((t) => t.startsWith("meeting:")) ?? "meeting:unknown";
    byMeeting.set(tag, [...(byMeeting.get(tag) ?? []), row]);
  }

  return (
    <div>
      {Array.from(byMeeting.entries()).map(([tag, items]) => (
        <div key={tag}>
          <h3>{tag.slice("meeting:".length)}</h3>
          <ul>{items.map((i) => <li key={i.id}>{i.ruleText}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}
```

**Verify before finalizing:** `useT()`'s exact call signature (confirmed used as `t("nav.meetings")` elsewhere — matches `shell.tsx`'s usage already read); confirm `GET /api/knowledge`'s response shape actually has `.items[].body` (matching `toKnowledgeItemView`'s `body: k.ruleText` field observed in Task-gathering) rather than `.ruleText` directly — read `views.ts`'s full `KnowledgeItemView` type before finalizing the history-tab mapping.

- [ ] **Step 3: Write the flag-gated e2e spec**

```typescript
// apps/web/e2e/meetings.spec.ts
import { test, expect } from "@playwright/test";

test.describe("meetings surface", () => {
  test.skip(
    process.env["MEETING_UPLOAD_ENABLED"] !== "true",
    "Flag-gated — set MEETING_UPLOAD_ENABLED=true to run.",
  );

  test("paste → extract → review → teach a decision", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /meetings/i }).click();
    await page.getByPlaceholder(/paste the meeting transcript/i).fill(
      "Sprint planning. Anna: we'll use Postgres with Timescale for the reporting store, not plain Postgres, because queries are time-bucketed. Ben: I'll fix the staging database, it's blocking everything.",
    );
    await page.getByRole("button", { name: /^extract$/i }).click();
    await expect(page.getByTestId("decision-card-0")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("decision-card-0").getByRole("button", { name: /teach/i }).click();
    await expect(page.getByTestId("decision-card-0").getByRole("button", { name: /taught/i })).toBeVisible();
  });
});
```

- [ ] **Step 4: Wire the spec into CI's file list**

In `.github/workflows/authed-e2e.yml`, add `"web/e2e/meetings.spec.ts"` to the existing `playwright test` file-argument list (the same list Task-gathering found `security.spec.ts` had been missing from on 2026-07-10 — do not repeat that gap). Since this spec's tests all `test.skip` unless `MEETING_UPLOAD_ENABLED=true`, and CI does not set that flag, the spec will show as **skipped**, not passing — this is expected and correct for a dark-launched feature; verify via the CI run log that the test is *listed as skipped*, not silently absent, exactly as done for the 2026-07-10 fix.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/brain/meetings.tsx apps/web/e2e/meetings.spec.ts .github/workflows/authed-e2e.yml
git commit -m "feat(web): meetings surface — paste/review/history UI + flag-gated e2e"
```

---

### Task 9: docs sweep

**Files:**
- Modify: `docs/protocols/meeting-miner.md`
- Modify: `docs/REST_API.md`
- Modify: `docs/KNOWN_ISSUES.md`
- Modify: `docs/GUIDELINES.md`

- [ ] **Step 1:** In `docs/protocols/meeting-miner.md`, add one paragraph near the top: the `/meetings` webapp surface (flag-gated, `MEETING_UPLOAD_ENABLED`) is now an alternative front door running the same underlying teach calls this protocol describes — useful without an agent handy, or for a single quick import.

- [ ] **Step 2:** In `docs/REST_API.md`, document `POST /api/meetings/extract` (request/response shape from Task 6) and the two `POST`/`GET /api/knowledge` extensions from Tasks 1–2 (`action_item` type, `supersedesKnowledgeId`, `tagPrefix`).

- [ ] **Step 3:** In `docs/KNOWN_ISSUES.md`, add an entry under a new `§0o` (following the `§0n` numbering from the 2026-07-10 first-time-user review): this feature closes the exact gap `§0n`'s "Known imprecision" and the operator's 2026-07-12 live question both surfaced — record it as done, flag-gated, with the enable steps (env var + compose allowlist, per the standing lesson).

- [ ] **Step 4:** In `docs/GUIDELINES.md` §7, add one line to the existing "semantic retrieval is owner-scoped" principle (already recorded from the 2026-07-10 security review) noting `findSupersessionCandidates` as the second precedent for a deliberately project-wide (not owner-scoped) query, alongside `action-items.ts`.

- [ ] **Step 5: Commit**

```bash
git add docs/protocols/meeting-miner.md docs/REST_API.md docs/KNOWN_ISSUES.md docs/GUIDELINES.md
git commit -m "docs: sweep for meeting-transcript-upload (protocol note, REST_API, KNOWN_ISSUES, GUIDELINES)"
```

---

### Task 10: PR, CI, merge, release, deploy (dark)

- [ ] **Step 1:** Push the branch, open one PR covering Tasks 1–9 (or split if CI feedback on an early push reveals a task should land independently — judgment call at execution time, not prescribed here).
- [ ] **Step 2:** Watch CI to green. Read CodeRabbit's inline comments if it runs; if it doesn't run within a reasonable window, treat that as a signal to request an independent review pass before merging (per the 2026-07-10 precedent, where CodeRabbit's absence on a security-adjacent PR was treated as "not yet reviewed," not "approved").
- [ ] **Step 3:** Verify `git diff main..HEAD --stat -- packages/db/prisma/migrations` is empty before merge.
- [ ] **Step 4:** Merge on green CI (autonomous-CD policy B).
- [ ] **Step 5:** Cut the next minor release (`./scripts/release.sh vX.Y.0 --publish`) and deploy (`./scripts/deploy.sh`).
- [ ] **Step 6:** Post-deploy: confirm `/api/healthz` reports the new version, and that `MEETING_UPLOAD_ENABLED` is absent/false in prod (dark launch — deployed behavior must be unchanged until the operator explicitly flips the flag).
- [ ] **Step 7:** Report the release URL and deploy result to the operator, along with the exact enable steps (env var in `.env` + compose allowlist confirmation + reload) for when they're ready to flip it on.

## Self-Review

- **Spec coverage:** §2 goal 1 (extract 3 kinds) → Task 4; §2 goal 2 (review before commit) → Task 8's review-mode UI; §2 goal 3 (existing teach path) → Tasks 1, 8; §2 goal 4 (history, no new persistence) → Tasks 2, 8; §3 architecture (stateless, Approach B) → Tasks 4–8 collectively; §4a–4c components → Tasks 4, 6, 7–8 respectively; §4d docs → Task 9; §5 security (project-scoped, rate-limited) → Tasks 5–6; §6 rollout (flag off, no migration, compose allowlist) → Task 3, Task 10; §7 testing → each task's own test step + Task 8 Step 4's CI-wiring verification. No gaps found.
- **Placeholder scan:** none — every step has real, complete code. Three explicit "verify before finalizing" notes (Tasks 5, 6, 8) are not placeholders; they're honest flags where full context wasn't confirmed during planning (a function signature two layers deep, a response-shape field name) — each names exactly what to check and why, which is the required behavior when a plan author hasn't verified every transitive dependency firsthand.
- **Type consistency:** `ExtractedDecision`/`ExtractedActionItem`/`ExtractedMeeting` (Task 4) match the shapes consumed in Task 6's route and Task 8's component; `SupersessionCandidate` (Task 5) matches the `supersedes` field Task 6 attaches and Task 8 renders; `action_item`/`supersedesKnowledgeId` (Task 1) match exactly what Task 8's `teachDecision`/`teachActionItem` send. Checked consistent.
