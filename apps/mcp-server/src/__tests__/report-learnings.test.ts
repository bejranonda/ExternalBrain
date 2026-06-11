/**
 * Close-capture at session close (spec 2026-06-09). Pins:
 * (1) valid learnings persist as learning_captured SessionEvents;
 * (2) invalid items are dropped WITHOUT failing the outcome report;
 * (3) >5 items are capped; (4) omitting the field changes nothing.
 *
 * Direct handler test (no live MCP server). DB-gated like the core tests.
 * The handler's pg-boss enqueue is wrapped in its own try/catch ("job
 * dropped" path), so no pg-boss instance is needed.
 */
import { describe, expect, it, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { reportSessionOutcome } from "../tools/report.js";

const dbReachable = await db.user
  .count()
  .then(() => true)
  .catch(() => false);
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
      await db.sessionKnowledgeApplication.deleteMany({ where: { sessionId: sid } }).catch(() => {});
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

  const authFor = (userId: string) =>
    ({ userId }) as Parameters<typeof reportSessionOutcome.handler>[1];

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
    const eight = Array.from({ length: 8 }, (_, i) => ({
      ...goodLearning,
      rule: `${goodLearning.rule} v${i}`,
    }));
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

  // Ask-back nudge (#64 follow-up): the hint steers the agent toward
  // brain_teach_knowledge when the highest-value knowledge is about to
  // evaporate; it must never appear when learnings were submitted.
  it("failed close without learnings → strong teach-knowledge hint", async () => {
    const { userId, sessionId } = await mintOpenSession();
    const res = (await reportSessionOutcome.handler(
      { sessionId, success: false },
      authFor(userId),
    )) as { hint?: string };
    expect(res.hint).toMatch(/brain_teach_knowledge/);
    expect(res.hint).toMatch(/unsuccessfully/);
  });

  it("successful close without learnings → gentle hint; with learnings → none", async () => {
    const a = await mintOpenSession();
    const resA = (await reportSessionOutcome.handler(
      { sessionId: a.sessionId, success: true },
      authFor(a.userId),
    )) as { hint?: string };
    expect(resA.hint).toMatch(/brain_teach_knowledge/);
    expect(resA.hint).not.toMatch(/unsuccessfully/);

    const b = await mintOpenSession();
    const resB = (await reportSessionOutcome.handler(
      { sessionId: b.sessionId, success: true, learnings: [goodLearning] },
      authFor(b.userId),
    )) as { hint?: string };
    expect(resB.hint).toBeUndefined();
  });
});
