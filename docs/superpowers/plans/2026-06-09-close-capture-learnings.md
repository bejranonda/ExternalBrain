# Close-Capture Learnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents submit structured learnings at session close (`brain_report_session_outcome`); KEA validates them ("refine" mode) instead of mining thin summaries — attacking the ~17% per-session yield.

**Architecture:** `report.ts` validates a new optional `learnings[]` (≤5) per-item and persists each as a `SessionEvent{eventType:"learning_captured"}` (no migration). `buildPayload` collects them into `KEAInputPayload.submittedLearnings`. `extractFromSession` routes: submitted → new `refineSubmittedLearnings()` (LLM judge → existing quality filter → existing persist, tagged `close_capture`); none → today's mine path. Judge and mine are dependency-injectable (ESM wrapper rule, GUIDELINES §4).

**Tech Stack:** TypeScript strict, zod, Prisma, vitest (DB-gated guard pattern), pg-boss (unchanged).

**Spec:** `docs/superpowers/specs/2026-06-09-close-capture-learnings-design.md`

---

### Task 1: `Learning` schema + pure validation (`packages/core/src/learnings.ts`)

**Files:**
- Create: `packages/core/src/learnings.ts`
- Create: `packages/core/src/__tests__/learnings.test.ts`
- Modify: `packages/core/src/index.ts` (add export)

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/__tests__/learnings.test.ts
import { describe, expect, it } from "vitest";
import { validateSubmittedLearnings } from "../learnings.js";

const good = {
  trigger: "when scaffolding a React form in this repo",
  rule: "use react-hook-form + zod, not Formik",
  rationale: "Formik abandoned; team standard",
  type: "reflex",
  source: "user_correction",
  confidence: 0.9,
};

describe("validateSubmittedLearnings", () => {
  it("accepts a valid learning unchanged (confidence kept)", () => {
    const { valid, droppedInvalid, droppedOverflow } = validateSubmittedLearnings([good]);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.confidence).toBe(0.9);
    expect(droppedInvalid).toBe(0);
    expect(droppedOverflow).toBe(0);
  });

  it("drops invalid items without throwing, counts them", () => {
    const { valid, droppedInvalid } = validateSubmittedLearnings([
      good,
      { trigger: 42, rule: "x" },              // wrong types
      { ...good, type: "not_a_type" },          // bad enum
      "garbage",                                // not even an object
    ]);
    expect(valid).toHaveLength(1);
    expect(droppedInvalid).toBe(3);
  });

  it("caps at 5 items, counts overflow", () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ ...good, rule: `${good.rule} v${i}` }));
    const { valid, droppedOverflow } = validateSubmittedLearnings(eight);
    expect(valid).toHaveLength(5);
    expect(droppedOverflow).toBe(3);
  });

  it("clamps confidence to [0, 0.95] and defaults missing confidence to 0.7", () => {
    const { valid } = validateSubmittedLearnings([
      { ...good, confidence: 1.0 },
      { ...good, confidence: undefined },
    ]);
    expect(valid[0]!.confidence).toBe(0.95);
    expect(valid[1]!.confidence).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brain/core exec vitest run src/__tests__/learnings.test.ts`
Expected: FAIL — `Cannot find module '../learnings.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/learnings.ts
/**
 * Close-capture learnings (#close-capture spec, 2026-06-09).
 *
 * Agents submit distilled (trigger, rule, rationale) learnings at session
 * close via `brain_report_session_outcome.learnings`. This module owns the
 * shape + the per-item validation used by BOTH the MCP tool handler (persist
 * as SessionEvents) and KEA's refine mode. Per-item `safeParse` because a
 * malformed learning must never block the outcome report — the feedback loop
 * always closes.
 */
import { z } from "zod";

export const LEARNING_EVENT_TYPE = "learning_captured";
export const MAX_LEARNINGS_PER_SESSION = 5;
/** Agent self-estimates are advisory — never persisted above this. */
export const MAX_SUBMITTED_CONFIDENCE = 0.95;

export const LearningSchema = z.object({
  trigger: z.string().min(10).max(500),
  rule: z.string().min(20).max(2000),
  rationale: z.string().min(1).max(2000),
  type: z.enum(["reflex", "recipe", "heuristic", "principle", "anti_principle"]),
  source: z.enum(["user_correction", "decision", "discovery"]),
  confidence: z.number().min(0).max(1).optional(),
});

export type Learning = z.infer<typeof LearningSchema> & { confidence: number };

export interface ValidatedLearnings {
  valid: Learning[];
  droppedInvalid: number;
  droppedOverflow: number;
}

export function validateSubmittedLearnings(raw: unknown[]): ValidatedLearnings {
  const droppedOverflow = Math.max(0, raw.length - MAX_LEARNINGS_PER_SESSION);
  const valid: Learning[] = [];
  let droppedInvalid = 0;
  for (const item of raw.slice(0, MAX_LEARNINGS_PER_SESSION)) {
    const parsed = LearningSchema.safeParse(item);
    if (!parsed.success) {
      droppedInvalid++;
      continue;
    }
    valid.push({
      ...parsed.data,
      confidence: Math.min(parsed.data.confidence ?? 0.7, MAX_SUBMITTED_CONFIDENCE),
    });
  }
  return { valid, droppedInvalid, droppedOverflow };
}
```

Note: the min-length floors (trigger ≥10, rule ≥20) mirror `applyQualityFilter` in `kea.ts` so structurally-hopeless items die at the door.

- [ ] **Step 4: Export from the package index**

In `packages/core/src/index.ts`, add alongside the existing exports:

```ts
export * from "./learnings.js";
```

(If `index.ts` uses named re-export style instead of `export *`, match it: `export { LearningSchema, validateSubmittedLearnings, LEARNING_EVENT_TYPE, MAX_LEARNINGS_PER_SESSION, MAX_SUBMITTED_CONFIDENCE, type Learning, type ValidatedLearnings } from "./learnings.js";`)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @brain/core exec vitest run src/__tests__/learnings.test.ts`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/learnings.ts packages/core/src/__tests__/learnings.test.ts packages/core/src/index.ts
git commit -m "feat(core): Learning schema + per-item validation for close-capture"
```

---

### Task 2: KEA refine mode (`packages/core/src/kea.ts`)

**Files:**
- Modify: `packages/core/src/kea.ts` (payload type ~line 23, `extractFromSession` ~line 112, `callOpenAI`/`callDashScope` ~lines 567/585, `persist` ~line 715, `buildPayload` ~line 782)
- Create: `packages/core/src/__tests__/kea-refine.test.ts`

- [ ] **Step 1: Write the failing test**

Follows the `kea-cross-extract.test.ts` conventions: DB-gated guard, minted user/session, injected functions instead of real LLM calls, aggressive cleanup.

```ts
// packages/core/src/__tests__/kea-refine.test.ts
/**
 * Close-capture refine mode (spec 2026-06-09).
 *
 * Pins: (1) sessions WITH learning_captured events route to the injected
 * judge (mine never called); (2) judge output flows through the existing
 * quality filter + persist, tagged close_capture; (3) judge failure falls
 * back to the injected mine fn; (4) sessions WITHOUT learnings use mine.
 * No real LLM calls — judge/mine are injected (ESM wrapper rule,
 * GUIDELINES §4).
 */
import { describe, expect, it, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import * as kea from "../kea.js";
import { LEARNING_EVENT_TYPE } from "../learnings.js";

const dbReachable = await db.user.count().then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("kea refine mode — integration", () => {
  const created = { userIds: [] as string[], sessionIds: [] as string[], knowledgeIds: [] as string[] };

  afterAll(async () => {
    for (const kid of created.knowledgeIds) {
      await db.sessionKnowledgeApplication.deleteMany({ where: { knowledgeId: kid } }).catch(() => {});
      await db.knowledge.delete({ where: { id: kid } }).catch(() => {});
    }
    for (const sid of created.sessionIds) {
      await db.sessionEvent.deleteMany({ where: { sessionId: sid } }).catch(() => {});
      await db.session.delete({ where: { id: sid } }).catch(() => {});
    }
    for (const uid of created.userIds) {
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await db.$disconnect().catch(() => {});
  });

  async function mintUser(): Promise<string> {
    const u = await db.user.create({
      data: { email: `kea-refine-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    created.userIds.push(u.id);
    return u.id;
  }

  async function mintClosedSession(userId: string, withLearning: boolean): Promise<string> {
    const s = await db.session.create({
      data: {
        userId,
        clientType: "claude_code",
        outcome: "success",
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
      },
      select: { id: true },
    });
    created.sessionIds.push(s.id);
    if (withLearning) {
      await db.sessionEvent.create({
        data: {
          sessionId: s.id,
          eventType: LEARNING_EVENT_TYPE,
          payload: {
            trigger: "when adding a worker job in this repo",
            rule: "create the pg-boss queue explicitly before schedule() — pg-boss 10+ requires it",
            rationale: "schedule() on a missing queue throws at boot",
            type: "recipe",
            source: "discovery",
            confidence: 0.9,
          },
        },
      });
    }
    return s.id;
  }

  const judgeFinding = {
    type: "recipe" as const,
    scope: "user" as const,
    trigger: "when adding a worker job in this repo",
    rule: "create the pg-boss queue explicitly before schedule() — pg-boss 10+ requires it",
    rationale: "schedule() on a missing queue throws at boot",
    confidence: 0.9,
  };

  it("routes submitted learnings to the judge and persists with close_capture tag; mine never called", async () => {
    const userId = await mintUser();
    const sessionId = await mintClosedSession(userId, true);
    const payload = await kea.buildPayload(sessionId, {
      filesCreated: [], filesModified: [], filesRejected: [],
      buildAttempts: 1, errors: [], knowledgeUsed: [], durationMs: 0, tokensUsed: 0,
    });
    expect(payload.submittedLearnings).toHaveLength(1);

    let mineCalled = false;
    const persisted = await kea.extractFromSession(payload, {
      judge: async () => [judgeFinding],
      mine: async () => { mineCalled = true; return []; },
    });
    for (const k of persisted) created.knowledgeIds.push(k.id);

    expect(mineCalled).toBe(false);
    expect(persisted).toHaveLength(1);
    const row = await db.knowledge.findUniqueOrThrow({ where: { id: persisted[0]!.id } });
    expect(row.tags).toContain("close_capture");
    expect(row.extractedBy).toBe("kea");
  });

  it("clamps judge confidence to 0.95 before the quality gate", async () => {
    const userId = await mintUser();
    const sessionId = await mintClosedSession(userId, true);
    const payload = await kea.buildPayload(sessionId, {
      filesCreated: [], filesModified: [], filesRejected: [],
      buildAttempts: 1, errors: [], knowledgeUsed: [], durationMs: 0, tokensUsed: 0,
    });
    const persisted = await kea.extractFromSession(payload, {
      judge: async () => [{ ...judgeFinding, rule: `${judgeFinding.rule} (clamp case)`, confidence: 1.0 }],
      mine: async () => [],
    });
    for (const k of persisted) created.knowledgeIds.push(k.id);
    expect(persisted[0]!.confidence).toBeLessThanOrEqual(0.95);
  });

  it("falls back to mine when the judge throws", async () => {
    const userId = await mintUser();
    const sessionId = await mintClosedSession(userId, true);
    const payload = await kea.buildPayload(sessionId, {
      filesCreated: [], filesModified: [], filesRejected: [],
      buildAttempts: 1, errors: [], knowledgeUsed: [], durationMs: 0, tokensUsed: 0,
    });
    let mineCalled = false;
    const persisted = await kea.extractFromSession(payload, {
      judge: async () => { throw new Error("provider down"); },
      mine: async () => { mineCalled = true; return []; },
    });
    expect(mineCalled).toBe(true);
    expect(persisted).toHaveLength(0);
  });

  it("sessions without learnings use mine, never the judge", async () => {
    const userId = await mintUser();
    const sessionId = await mintClosedSession(userId, false);
    const payload = await kea.buildPayload(sessionId, {
      filesCreated: [], filesModified: [], filesRejected: [],
      buildAttempts: 1, errors: [], knowledgeUsed: [], durationMs: 0, tokensUsed: 0,
    });
    expect(payload.submittedLearnings ?? []).toHaveLength(0);
    let judgeCalled = false;
    await kea.extractFromSession(payload, {
      judge: async () => { judgeCalled = true; return []; },
      mine: async () => [],
    });
    expect(judgeCalled).toBe(false);
  });
});
```

Heads-up for the implementer: the persist path calls `embed()`. If `embed` throws without an embedding key in the test env, check how the existing DB-gated tests get green in CI (`.github/workflows/ci.yml` sets only `DATABASE_URL`); if embedding is unavailable there, follow whatever pattern `kea-cross-extract.test.ts` uses — it avoids persist by pinning pre-persist logic. In that case make `judge`-output assertions via a third injectable seam: pass `persist` through opts too, OR assert on the refine return value with an in-memory persist stub. Decide by reading how CI handles `embed` — do NOT ship a test that needs a live embedding key.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brain/core exec vitest run src/__tests__/kea-refine.test.ts`
Expected: FAIL — `submittedLearnings` missing from payload type / `extractFromSession` takes 1 argument

- [ ] **Step 3: Implement — payload type + buildPayload collection**

In `KEAInputPayload` (kea.ts ~line 23), add:

```ts
  /** Close-capture learnings the agent submitted at session close (spec 2026-06-09). */
  submittedLearnings?: Learning[] | undefined;
```

with `import { LEARNING_EVENT_TYPE, MAX_SUBMITTED_CONFIDENCE, validateSubmittedLearnings, type Learning } from "./learnings.js";` at the top.

In `buildPayload` (~line 795), after computing `prompt`, add:

```ts
  // Close-capture: collect agent-submitted learnings persisted by
  // report_session_outcome as learning_captured events. Re-validated here
  // (not just at capture) so a hand-inserted event can't bypass the shape.
  const submitted = validateSubmittedLearnings(
    session.events
      .filter((e) => e.eventType === LEARNING_EVENT_TYPE)
      .map((e) => e.payload),
  ).valid;
```

and in the returned object:

```ts
    ...(submitted.length > 0 ? { submittedLearnings: submitted } : {}),
```

- [ ] **Step 4: Implement — refine prompt + judge + routing**

Add near `CROSS_SESSION_SYSTEM_PROMPT`:

```ts
const REFINE_SYSTEM_PROMPT = `You are KEA (Knowledge Extraction Agent) in REFINE mode.

The coding agent that just finished a session has SUBMITTED candidate learnings
it distilled from its own context. Your job is to VALIDATE each candidate — not
to mine new ones:
- KEEP a candidate only if it is durable (true beyond this one task) and
  specific (names a concrete trigger and rule, not generic advice).
- Normalize wording into one crisp trigger + rule + rationale.
- You may LOWER a confidence you find inflated; never raise it.
- DROP candidates that are session-trivia, generic best practice, or vague.

Return JSON only:
{
  "findings": [
    {
      "type": "reflex|recipe|heuristic|principle|anti_principle",
      "scope": "user",
      "trigger": "...",
      "rule": "...",
      "rationale": "...",
      "confidence": 0.0-1.0
    }
  ]
}
If nothing survives, return {"findings": []}.`;
```

Add the injectable seams + default judge:

```ts
export type RefineJudge = (
  learnings: Learning[],
  payload: KEAInputPayload,
) => Promise<KEAFinding[]>;

/** Default judge — same cheap-model family dispatch as runLLM, refine prompt. */
async function defaultRefineJudge(
  learnings: Learning[],
  payload: KEAInputPayload,
): Promise<KEAFinding[]> {
  const model = process.env.KEA_REFINE_MODEL ?? process.env.KEA_MODEL ?? "qwen3-coder";
  const userPrompt =
    `SESSION CONTEXT (for judging durability):\n` +
    JSON.stringify({ prompt: payload.prompt, framework: payload.framework, language: payload.language }, null, 2) +
    `\n\nSUBMITTED CANDIDATES:\n${JSON.stringify(learnings, null, 2)}\n\nValidate now.`;
  if (model.startsWith("claude")) {
    return callAnthropic(userPrompt, { model, systemPrompt: REFINE_SYSTEM_PROMPT });
  }
  if (model.startsWith("qwen") || model.startsWith("glm")) {
    return callDashScope(userPrompt, model, REFINE_SYSTEM_PROMPT);
  }
  return callOpenAI(userPrompt, model, REFINE_SYSTEM_PROMPT);
}
```

Extend `callOpenAI` and `callDashScope` (~lines 567/585) with a third parameter `systemPrompt: string = SYSTEM_PROMPT` and replace the hardcoded `SYSTEM_PROMPT` reference inside each body with the parameter. (`callAnthropic` already accepts `opts.systemPrompt`.)

Add `refineSubmittedLearnings` next to `extractFromSession`:

```ts
async function refineSubmittedLearnings(
  payload: KEAInputPayload,
  learnings: Learning[],
  judge: RefineJudge,
): Promise<KEAFinding[]> {
  const findings = await judge(learnings, payload);
  // The judge may lower but never raise: clamp to the submission ceiling.
  return findings.map((f) => ({
    ...f,
    confidence: Math.min(f.confidence, MAX_SUBMITTED_CONFIDENCE),
  }));
}
```

Rewrite `extractFromSession` to route (keeping the existing funnel/audit, with new fields):

```ts
export interface ExtractOpts {
  /** Test seams (ESM wrapper rule, GUIDELINES §4). Production never sets these. */
  judge?: RefineJudge;
  mine?: (payload: KEAInputPayload) => Promise<KEAFinding[]>;
}

export async function extractFromSession(
  payload: KEAInputPayload,
  opts: ExtractOpts = {},
): Promise<Knowledge[]> {
  const submitted = payload.submittedLearnings ?? [];
  const mineFn = opts.mine ?? runLLM;
  let mode: "refine" | "mine" = submitted.length > 0 ? "refine" : "mine";
  let findings: KEAFinding[];

  if (mode === "refine") {
    try {
      findings = await refineSubmittedLearnings(payload, submitted, opts.judge ?? defaultRefineJudge);
    } catch (err) {
      // Spec: a provider blip must never lose the session — mine instead.
      getLogger("kea", { stream: "stdout" }).warn(
        { op: "kea.refine_fallback", sessionId: payload.sessionId, err: err instanceof Error ? err.message : String(err) },
        "kea.refine_fallback",
      );
      mode = "mine";
      findings = await mineFn(payload);
    }
  } else {
    findings = await mineFn(payload);
  }

  const filtered = await applyQualityFilter(findings, payload.userId);
  const persisted = await persist(filtered, payload, mode === "refine" ? ["close_capture"] : []);
  getLogger("kea", { stream: "stdout" }).info(
    {
      op: "kea.funnel",
      sessionId: payload.sessionId,
      mode,
      submitted: submitted.length,
      llmFindings: findings.length,
      filterPassed: filtered.length,
      persisted: persisted.length,
    },
    "kea.funnel",
  );
  await writeAudit({
    action: "kea.extract_session",
    actorUserId: payload.userId,
    targetType: "Session",
    targetId: payload.sessionId,
    payload: {
      mode,
      submitted: submitted.length,
      llmFindings: findings.length,
      filterPassed: filtered.length,
      persisted: persisted.length,
      model: process.env.KEA_MODEL ?? "qwen3-coder",
    },
    ...(payload.projectId ? { projectId: payload.projectId } : {}),
  });
  return persisted;
}
```

Extend `persist` (~line 715) with a third parameter `tags: string[] = []` and use it in the `tags:` field of `tx.knowledge.create` (replacing the hardcoded `tags: []`). `applyQualityFilter` caps at 3 findings — that stays: refine submits ≤5, persists ≤3 best; acceptable per spec precision-first stance.

- [ ] **Step 5: Run the new test + the existing kea tests**

Run: `pnpm --filter @brain/core exec vitest run src/__tests__/kea-refine.test.ts src/__tests__/kea-cross-extract.test.ts src/__tests__/kea-audit-writes.test.ts`
Expected: all pass (cross-extract + audit-writes prove no regression in the untouched paths)

- [ ] **Step 6: Typecheck the workspace**

Run: `pnpm turbo run typecheck`
Expected: pass (catches the worker's `kea.extractFromSession(payload)` single-arg call — still valid since `opts` defaults)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/kea.ts packages/core/src/__tests__/kea-refine.test.ts
git commit -m "feat(core): KEA refine mode — validate agent-submitted learnings instead of mining"
```

---

### Task 3: Capture in `brain_report_session_outcome` (`apps/mcp-server/src/tools/report.ts`)

**Files:**
- Modify: `apps/mcp-server/src/tools/report.ts`
- Create: `apps/mcp-server/src/__tests__/report-learnings.test.ts`

- [ ] **Step 1: Write the failing test**

Direct handler test (no live server needed), DB-gated like the core tests. Check the `ToolDef` handler's auth parameter type in `apps/mcp-server/src/tools/index.ts` first and import/cast accordingly.

```ts
// apps/mcp-server/src/__tests__/report-learnings.test.ts
/**
 * Close-capture at session close (spec 2026-06-09). Pins:
 * (1) valid learnings persist as learning_captured SessionEvents;
 * (2) invalid items are dropped WITHOUT failing the outcome report;
 * (3) >5 items are capped; (4) omitting the field changes nothing.
 */
import { describe, expect, it, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { reportSessionOutcome } from "../tools/report.js";

const dbReachable = await db.user.count().then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

const goodLearning = {
  trigger: "when adding a worker job in this repo",
  rule: "create the pg-boss queue explicitly before schedule() — pg-boss 10+ requires it",
  rationale: "schedule() on a missing queue throws at boot",
  type: "recipe",
  source: "discovery",
  confidence: 0.9,
};

guard("report_session_outcome learnings capture", () => {
  const created = { userIds: [] as string[], sessionIds: [] as string[] };

  afterAll(async () => {
    for (const sid of created.sessionIds) {
      await db.sessionEvent.deleteMany({ where: { sessionId: sid } }).catch(() => {});
      await db.session.delete({ where: { id: sid } }).catch(() => {});
    }
    for (const uid of created.userIds) {
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await db.$disconnect().catch(() => {});
  });

  async function mintOpenSession(): Promise<{ userId: string; sessionId: string }> {
    const u = await db.user.create({
      data: { email: `report-learn-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    created.userIds.push(u.id);
    const s = await db.session.create({
      data: { userId: u.id, clientType: "claude_code" },
      select: { id: true },
    });
    created.sessionIds.push(s.id);
    return { userId: u.id, sessionId: s.id };
  }

  // Cast matches the handler's auth param — adjust to the actual AuthContext type.
  const authFor = (userId: string) => ({ userId }) as Parameters<typeof reportSessionOutcome.handler>[1];

  it("persists valid learnings as learning_captured events", async () => {
    const { userId, sessionId } = await mintOpenSession();
    await reportSessionOutcome.handler(
      { sessionId, success: true, learnings: [goodLearning] },
      authFor(userId),
    );
    const events = await db.sessionEvent.findMany({
      where: { sessionId, eventType: "learning_captured" },
    });
    expect(events).toHaveLength(1);
    expect((events[0]!.payload as { rule?: string }).rule).toContain("pg-boss");
  });

  it("drops invalid items but still closes the session (outcome report never blocked)", async () => {
    const { userId, sessionId } = await mintOpenSession();
    await reportSessionOutcome.handler(
      { sessionId, success: true, learnings: [goodLearning, { trigger: 42 }, "junk"] },
      authFor(userId),
    );
    const events = await db.sessionEvent.count({
      where: { sessionId, eventType: "learning_captured" },
    });
    expect(events).toBe(1);
    const row = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.outcome).toBe("success");
    expect(row.endedAt).not.toBeNull();
  });

  it("caps at 5 learnings", async () => {
    const { userId, sessionId } = await mintOpenSession();
    const eight = Array.from({ length: 8 }, (_, i) => ({ ...goodLearning, rule: `${goodLearning.rule} v${i}` }));
    await reportSessionOutcome.handler(
      { sessionId, success: true, learnings: eight },
      authFor(userId),
    );
    const events = await db.sessionEvent.count({
      where: { sessionId, eventType: "learning_captured" },
    });
    expect(events).toBe(5);
  });

  it("no learnings field → no events, current behaviour intact", async () => {
    const { userId, sessionId } = await mintOpenSession();
    await reportSessionOutcome.handler({ sessionId, success: false }, authFor(userId));
    const events = await db.sessionEvent.count({
      where: { sessionId, eventType: "learning_captured" },
    });
    expect(events).toBe(0);
  });
});
```

Heads-up: the handler enqueues pg-boss jobs at the end inside its own try/catch ("job dropped" log path), so no pg-boss instance is needed. If the handler computes SQS via a helper that requires events, the minted bare session works — it already tolerates zero events (sweeper-closed sessions take this path).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brain/mcp-server exec vitest run src/__tests__/report-learnings.test.ts`
Expected: first test FAILS — 0 `learning_captured` events (field silently ignored today; zod `.parse` on an object with unknown key `learnings` does not throw — zod strips unknown keys by default)

- [ ] **Step 3: Implement the capture**

In `apps/mcp-server/src/tools/report.ts`:

Add import:

```ts
import { validateSubmittedLearnings, LEARNING_EVENT_TYPE, MAX_LEARNINGS_PER_SESSION } from "@brain/core";
```

Extend `inputShape` (the field stays loose on purpose — per-item validation happens in `validateSubmittedLearnings`, so one malformed item can't fail the whole `.parse`):

```ts
  learnings: z.array(z.unknown()).optional(),
```

Extend the JSON `inputSchema.properties` (after `tokensUsed`):

```ts
      learnings: {
        type: "array",
        maxItems: 5,
        description:
          "0-5 durable learnings you distilled from this session — ESPECIALLY user corrections and rejected approaches. Each: { trigger, rule, rationale, type: reflex|recipe|heuristic|principle|anti_principle, source: user_correction|decision|discovery, confidence? }. Invalid items are dropped without failing the call.",
        items: {
          type: "object",
          required: ["trigger", "rule", "rationale", "type", "source"],
          properties: {
            trigger: { type: "string", description: "When does this apply? e.g. 'when scaffolding a React form in this repo'" },
            rule: { type: "string", description: "The rule to follow, specific to this codebase/team" },
            rationale: { type: "string", description: "Why — what happens otherwise" },
            type: { type: "string", enum: ["reflex", "recipe", "heuristic", "principle", "anti_principle"] },
            source: { type: "string", enum: ["user_correction", "decision", "discovery"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
```

In the handler, AFTER the ownership check and BEFORE the kea/autoskill enqueue block (the worker rebuilds the payload from DB, so events must exist before the job runs), add:

```ts
    // Close-capture (spec 2026-06-09): persist agent-submitted learnings as
    // events so KEA's refine mode can validate them. Per-item validation —
    // a malformed learning must never block the outcome report.
    if (input.learnings && input.learnings.length > 0) {
      const { valid, droppedInvalid, droppedOverflow } = validateSubmittedLearnings(input.learnings);
      if (valid.length > 0) {
        await db.sessionEvent.createMany({
          data: valid.map((l) => ({
            sessionId: input.sessionId,
            eventType: LEARNING_EVENT_TYPE,
            payload: l,
          })),
        });
      }
      log.info(
        {
          op: "report.learnings_captured",
          sessionId: input.sessionId,
          submitted: input.learnings.length,
          captured: valid.length,
          droppedInvalid,
          droppedOverflow,
          cap: MAX_LEARNINGS_PER_SESSION,
        },
        "report.learnings_captured",
      );
    }
```

- [ ] **Step 4: Run the new test + the tool-catalog test**

Run: `pnpm --filter @brain/mcp-server exec vitest run src/__tests__/report-learnings.test.ts src/__tests__/tools-catalog.test.ts`
Expected: all pass (tools-catalog proves the schema extension didn't break the published catalog)

- [ ] **Step 5: Commit**

```bash
git add apps/mcp-server/src/tools/report.ts apps/mcp-server/src/__tests__/report-learnings.test.ts
git commit -m "feat(mcp): accept learnings[] at session close, persist as learning_captured events"
```

---

### Task 4: Elicitation text (light-A)

**Files:**
- Modify: `apps/mcp-server/src/index.ts` (the `instructions:` string, ~line 67)
- Modify: `apps/mcp-server/src/tools/report.ts` (tool `description`)
- Modify: `apps/mcp-server/src/tools/log-event.ts` (tool `description`)

- [ ] **Step 1: Update the report tool description**

Replace the `description` in `report.ts` with:

```ts
  description:
    "Report the outcome of a coding session after completion. Must be called after the user accepts/rejects generated code. Include `learnings` (0-5): the durable rules you discovered this session — ESPECIALLY anything the user corrected or rejected ('we use X not Y here'). Distill each as {trigger, rule, rationale}. Enables the Brain's feedback loop (confidence updates + autoskill proposals).",
```

- [ ] **Step 2: Update the log-event tool description**

Replace the `description` in `log-event.ts` with:

```ts
  description:
    "Log an event during a coding session. Events feed KEA and autoskill. Call frequently — do NOT batch. ALWAYS log user_correction (the user changed your approach) and knowledge_rejected (an injected skill didn't apply) the moment they happen — these drive the Brain's confidence loop. Safe to call from a background thread.",
```

- [ ] **Step 3: Extend the server `instructions`**

In `apps/mcp-server/src/index.ts`, find the `instructions:` string and append one sentence (keep the existing reconnect guidance intact):

```
When you call brain_report_session_outcome, include `learnings`: 0-5 durable rules you distilled from the session — especially user corrections and rejected approaches — each as {trigger, rule, rationale, type, source}. This is how the Brain learns; a session closed without learnings only gets mined from a thin summary.
```

- [ ] **Step 4: Run the catalog test + typecheck**

Run: `pnpm --filter @brain/mcp-server exec vitest run src/__tests__/tools-catalog.test.ts && pnpm turbo run typecheck`
Expected: pass

- [ ] **Step 5: Commit**

```bash
git add apps/mcp-server/src/index.ts apps/mcp-server/src/tools/report.ts apps/mcp-server/src/tools/log-event.ts
git commit -m "feat(mcp): elicit close-capture learnings + in-the-moment correction events"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/MCP_TOOLS.md` (the `brain_report_session_outcome` section + `brain_log_event` event list)
- Modify: `docs/HOW_IT_WORKS.md` (the extraction step)

- [ ] **Step 1: MCP_TOOLS.md** — in the `brain_report_session_outcome` parameter table/section, document the `learnings` field (shape, 0–5 cap, per-item validation, dropped-not-fatal semantics) and note the new `learning_captured` event type + `close_capture` knowledge tag. Match the doc's existing format exactly.

- [ ] **Step 2: HOW_IT_WORKS.md** — where the doc describes "a background worker mines sessions into typed skills", add 2–3 sentences: agents can now submit distilled learnings at close; KEA validates instead of mines (refine mode); the mine path remains for sessions without learnings.

- [ ] **Step 3: Commit**

```bash
git add docs/MCP_TOOLS.md docs/HOW_IT_WORKS.md
git commit -m "docs: close-capture learnings — tool field, event type, refine mode"
```

---

### Task 6: Gates + PR

- [ ] **Step 1: Full workspace gates**

Run: `pnpm turbo run typecheck && pnpm turbo run test && pnpm turbo run build`
Expected: all pass

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feat/close-capture-learnings
gh pr create --title "feat: close-capture learnings — capture-at-close + KEA validate-not-mine" \
  --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-06-09-close-capture-learnings-design.md.

## Problem
Per-session KEA yield is ~17% (documented in kea.ts): the brain only sees what
agents volunteer, and agents rarely emit mid-session events. The high-signal
moments (corrections, rejected approaches) never arrive.

## What
- `brain_report_session_outcome` gains optional `learnings[]` (0-5, per-item
  validated, NEVER blocks the outcome report) → persisted as
  `learning_captured` SessionEvents (no migration).
- KEA refine mode: sessions with submitted learnings get a cheap LLM
  validate/normalize pass (judge), then the EXISTING quality filter + persist
  (same ≥0.7 gate + cosine dedup), tagged `close_capture`. Judge failure falls
  back to the mine path. Sessions without learnings: unchanged.
- Funnel/audit gain `mode`/`submitted` so yield is queryable split by source.
- Elicitation: server instructions + tool descriptions now ask for learnings at
  close and in-the-moment correction events.

## Test plan
- ✅ Pure validation unit tests (cap, clamp, per-item drop).
- ✅ DB-gated integration: refine routing, close_capture tag, confidence clamp,
  judge-failure fallback, mine path untouched (injected judge/mine — no real
  LLM calls, per the ESM wrapper rule).
- ✅ Handler contract test: with/without field, >5 cap, invalid-item drop with
  outcome still closing.
- ⬜ CI: typecheck · test · build + fresh-DB migrate (no migration expected).
- ⬜ Post-deploy: close a real session with learnings, verify
  `kea.funnel mode=refine` in worker logs and a `close_capture`-tagged
  Knowledge row.
EOF
)"
```

- [ ] **Step 3: Merge on green CI** (repo flow: PR → required checks → merge to main)

---

## Self-review notes

- **Spec coverage:** capture protocol → Task 3; persistence-as-events → Task 3; payload collection → Task 2 Step 3; refine + routing + fallback + clamp + tag → Task 2; funnel/audit mode fields → Task 2 Step 4; elicitation → Task 4; never-block guarantee → Task 1 (per-item safeParse) + Task 3 test 2; measurement → funnel fields + post-deploy check in PR test plan. No gaps.
- **Type consistency:** `Learning` (learnings.ts) flows into `KEAInputPayload.submittedLearnings` and `RefineJudge`; judge returns `KEAFinding[]` (existing type) so `applyQualityFilter`/`persist` are reused unmodified except `persist`'s new `tags` param.
- **Known seam to verify at implementation time:** how CI handles `embed()` in DB-gated tests (flagged inline in Task 2 Step 1).
