/**
 * Close-capture refine mode (spec 2026-06-09).
 *
 * Routing tests are fully in-memory: judge/mine/filter/persist are injected
 * via ExtractOpts because (a) the inner functions are bound at module load
 * (ESM wrapper rule, GUIDELINES §4 — vi.spyOn can't intercept them) and
 * (b) the real filter + persist call embed(), which throws without a
 * provider key in CI (EMBEDDING_NO_PROVIDER).
 *
 * The buildPayload collection test is DB-gated (mints a real session +
 * learning_captured events; no embed on that path).
 */
import { describe, expect, it, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import * as kea from "../kea.js";
import { LEARNING_EVENT_TYPE } from "../learnings.js";
import type { Knowledge } from "@brain/types";

const learning = {
  trigger: "when adding a worker job in this repo",
  rule: "create the pg-boss queue explicitly before schedule() — pg-boss 10+ requires it",
  rationale: "schedule() on a missing queue throws at boot",
  type: "recipe" as const,
  source: "discovery" as const,
  confidence: 0.9,
};

const judgeFinding: kea.KEAFinding = {
  type: "recipe",
  scope: "user",
  trigger: learning.trigger,
  rule: learning.rule,
  rationale: learning.rationale,
  confidence: 0.9,
};

function basePayload(overrides: Partial<kea.KEAInputPayload> = {}): kea.KEAInputPayload {
  return {
    sessionId: "sess-test",
    userId: "user-test",
    prompt: "add a worker job",
    filesCreated: [],
    filesModified: [],
    buildAttempts: 1,
    errorsEncountered: [],
    finalBuildSuccess: true,
    durationMs: 0,
    tokensUsed: 0,
    ...overrides,
  };
}

/** In-memory seams: filter passes everything through, persist records its args. */
function recordingSeams() {
  const calls = { persistedFindings: [] as kea.KEAFinding[], persistedTags: [] as string[] };
  const seams = {
    filter: async (findings: kea.KEAFinding[]) => findings,
    persist: async (findings: kea.KEAFinding[], _payload: kea.KEAInputPayload, tags: string[]) => {
      calls.persistedFindings = findings;
      calls.persistedTags = tags;
      return findings.map(
        (f, i) => ({ id: `mem-${i}`, confidence: f.confidence }) as unknown as Knowledge,
      );
    },
  };
  return { calls, seams };
}

describe("extractFromSession routing (in-memory seams)", () => {
  it("submitted learnings → judge runs, mine does not, persist gets close_capture tag", async () => {
    const { calls, seams } = recordingSeams();
    let mineCalled = false;
    const persisted = await kea.extractFromSession(
      basePayload({ submittedLearnings: [learning] }),
      {
        ...seams,
        judge: async (ls) => {
          expect(ls).toHaveLength(1);
          return [judgeFinding];
        },
        mine: async () => {
          mineCalled = true;
          return [];
        },
      },
    );
    expect(mineCalled).toBe(false);
    expect(persisted).toHaveLength(1);
    expect(calls.persistedTags).toEqual(["close_capture"]);
  });

  it("clamps judge confidence to 0.95 before the quality gate", async () => {
    const { calls, seams } = recordingSeams();
    await kea.extractFromSession(basePayload({ submittedLearnings: [learning] }), {
      ...seams,
      judge: async () => [{ ...judgeFinding, confidence: 1.0 }],
      mine: async () => [],
    });
    expect(calls.persistedFindings[0]!.confidence).toBeLessThanOrEqual(0.95);
  });

  it("falls back to mine (no close_capture tag) when the judge throws", async () => {
    const { calls, seams } = recordingSeams();
    let mineCalled = false;
    await kea.extractFromSession(basePayload({ submittedLearnings: [learning] }), {
      ...seams,
      judge: async () => {
        throw new Error("provider down");
      },
      mine: async () => {
        mineCalled = true;
        return [judgeFinding];
      },
    });
    expect(mineCalled).toBe(true);
    expect(calls.persistedTags).toEqual([]);
  });

  it("no submitted learnings → mine runs, judge never called", async () => {
    const { seams } = recordingSeams();
    let judgeCalled = false;
    let mineCalled = false;
    await kea.extractFromSession(basePayload(), {
      ...seams,
      judge: async () => {
        judgeCalled = true;
        return [];
      },
      mine: async () => {
        mineCalled = true;
        return [];
      },
    });
    expect(judgeCalled).toBe(false);
    expect(mineCalled).toBe(true);
  });
});

// ============================================================
// buildPayload collects learning_captured events — DB-gated.
// ============================================================

const dbReachable = await db.user
  .count()
  .then(() => true)
  .catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("buildPayload — learning_captured collection (integration)", () => {
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

  const metrics = {
    filesCreated: [],
    filesModified: [],
    filesRejected: [],
    buildAttempts: 1,
    errors: [],
    knowledgeUsed: [],
    durationMs: 0,
    tokensUsed: 0,
  };

  it("collects valid learning events and drops a malformed one", async () => {
    const u = await db.user.create({
      data: { email: `kea-refine-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    created.userIds.push(u.id);
    const s = await db.session.create({
      data: { userId: u.id, clientType: "claude_code", outcome: "success", endedAt: new Date() },
      select: { id: true },
    });
    created.sessionIds.push(s.id);
    await db.sessionEvent.createMany({
      data: [
        { sessionId: s.id, eventType: LEARNING_EVENT_TYPE, payload: learning },
        // Malformed (rule too short) — must be dropped by re-validation.
        { sessionId: s.id, eventType: LEARNING_EVENT_TYPE, payload: { ...learning, rule: "short" } },
      ],
    });

    const payload = await kea.buildPayload(s.id, metrics);
    expect(payload.submittedLearnings).toHaveLength(1);
    expect(payload.submittedLearnings![0]!.rule).toContain("pg-boss");
  });

  it("session without learning events → submittedLearnings absent", async () => {
    const u = await db.user.create({
      data: { email: `kea-refine-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    created.userIds.push(u.id);
    const s = await db.session.create({
      data: { userId: u.id, clientType: "claude_code", outcome: "success", endedAt: new Date() },
      select: { id: true },
    });
    created.sessionIds.push(s.id);

    const payload = await kea.buildPayload(s.id, metrics);
    expect(payload.submittedLearnings).toBeUndefined();
  });
});
