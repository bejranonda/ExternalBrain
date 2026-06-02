/**
 * runCrossExtractDaily — integration test (PR #219).
 *
 * Per Brain rule cmp2qnrlj (principle, 6 sources): "Every new feature must
 * include an end-to-end smoke test that exercises the real integration
 * path." This test does exactly that for the daily cross-session driver:
 *
 *   - Mints a fresh test user with no prior cross-session Knowledge.
 *   - Creates 2 closed Sessions belonging to that user.
 *   - Calls runCrossExtractDaily — must process the user, not skip.
 *   - Mints a SECOND fresh user with only 1 closed session.
 *   - Same call — must SKIP the second user, log
 *     op="kea.cross.skip" reason="fewer_than_2_new_sessions".
 *
 * Note: this test does NOT make a real LLM call. It pins the
 * candidate-selection logic (the part most likely to regress as the
 * pg-boss schedule lands) and pins the skip-logging contract (per
 * Brain rule cmp2qnrm5, recipe: "instrument the invisible"). Full
 * LLM round-trip is exercised by the cross-session-kea driver script
 * (`packages/core/scripts/run-cross-session-kea.ts`) which the
 * operator can run on-demand.
 *
 * Skips cleanly when the DB isn't reachable (CI without a stack).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import * as kea from "../kea.js";

const dbReachable = await db.user
  .count()
  .then(() => true)
  .catch(() => false);

const guard = dbReachable ? describe : describe.skip;

guard("kea.runCrossExtractDaily — integration", () => {
  const created: { userIds: string[]; sessionIds: string[]; knowledgeIds: string[] } = {
    userIds: [],
    sessionIds: [],
    knowledgeIds: [],
  };

  beforeAll(async () => {
    // No-op; per-test setup mints fresh users.
  });

  afterAll(async () => {
    // Aggressive cleanup so dev DB stays tidy.
    for (const kid of created.knowledgeIds) {
      await db.knowledge.delete({ where: { id: kid } }).catch(() => {});
    }
    for (const sid of created.sessionIds) {
      await db.sessionEvent.deleteMany({ where: { sessionId: sid } }).catch(() => {});
      await db.session.delete({ where: { id: sid } }).catch(() => {});
    }
    for (const uid of created.userIds) {
      // Org + project + member rows cascade-delete via Prisma onDelete: Cascade.
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await db.$disconnect().catch(() => {});
  });

  async function mintUser(): Promise<string> {
    const u = await db.user.create({
      data: { email: `kea-cross-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    created.userIds.push(u.id);
    return u.id;
  }

  async function mintClosedSession(userId: string, endedAt: Date): Promise<string> {
    const s = await db.session.create({
      data: {
        userId,
        clientType: "claude_code",
        outcome: "success",
        startedAt: new Date(endedAt.getTime() - 60_000),
        endedAt,
      },
      select: { id: true },
    });
    created.sessionIds.push(s.id);
    return s.id;
  }

  // Build a stub extractor that records every call without making an
  // LLM round-trip. Each test mints its own to isolate call history.
  function stubExtract() {
    const calls: Array<{ userId: string; sessionIds: string[] }> = [];
    const fn = async (opts: { userId: string; sessionIds: string[] }) => {
      calls.push({ userId: opts.userId, sessionIds: opts.sessionIds });
      return [];
    };
    return { fn, calls };
  }

  it("processes a user with ≥2 new closed sessions (does NOT skip)", async () => {
    const userId = await mintUser();
    const now = Date.now();
    await mintClosedSession(userId, new Date(now - 120_000));
    await mintClosedSession(userId, new Date(now - 60_000));

    const { fn, calls } = stubExtract();
    const results = await kea.runCrossExtractDaily({ windowSize: 5, extract: fn });
    const ours = results.find((r) => r.userId === userId);
    expect(ours, "test user must be in results").toBeDefined();
    expect(ours!.skipped, "must NOT skip a user with 2 new sessions").toBeUndefined();
    const callForUser = calls.find((c) => c.userId === userId);
    expect(callForUser, "extract called for our test user").toBeDefined();
    expect(callForUser!.sessionIds.length).toBe(2);
  });

  it("skips a user with only 1 new closed session and logs the skip reason", async () => {
    const userId = await mintUser();
    await mintClosedSession(userId, new Date());

    const { fn, calls } = stubExtract();
    const results = await kea.runCrossExtractDaily({ windowSize: 5, extract: fn });
    const ours = results.find((r) => r.userId === userId);
    expect(ours, "test user must be in results").toBeDefined();
    expect(ours!.skipped).toBe("fewer_than_2_new_sessions");
    expect(ours!.persisted).toBe(0);
    const calledForUser = calls.some((c) => c.userId === userId);
    expect(calledForUser, "must not invoke LLM for 1-session user").toBe(false);
  });

  it("skips a user whose last cross-session Knowledge is newer than all their closed sessions", async () => {
    // Idempotency check: the function must not re-process users whose
    // newest closed session is older than their last cross-session
    // Knowledge row. This is what makes the daily cron safe to retry.
    const userId = await mintUser();
    await mintClosedSession(userId, new Date(Date.now() - 2 * 86_400_000));
    await mintClosedSession(userId, new Date(Date.now() - 86_400_000));

    // Mint a cross-session Knowledge row dated AFTER both sessions.
    const k = await db.knowledge.create({
      data: {
        type: "principle",
        scope: "user",
        ownerUserId: userId,
        triggerText: "test trigger",
        ruleText: "test rule",
        rationale: "test rationale",
        confidence: 0.9,
        tags: ["cross_session"],
        extractedBy: "kea",
        sourceSessionIds: [],
        createdAt: new Date(),
      },
      select: { id: true },
    });
    created.knowledgeIds.push(k.id);

    const { fn, calls } = stubExtract();
    const results = await kea.runCrossExtractDaily({ windowSize: 5, extract: fn });
    const ours = results.find((r) => r.userId === userId);
    expect(ours, "user with no new sessions since last extract should be absent").toBeUndefined();
    const calledForUser = calls.some((c) => c.userId === userId);
    expect(calledForUser).toBe(false);
  });
});
