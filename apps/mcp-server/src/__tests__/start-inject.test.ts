/**
 * Inject-at-open (spec 2026-06-11, #64). Pins the CI-provable properties:
 *
 * (1) FAIL-SOFT: with a prompt but no embedding provider (exactly the CI
 *     env), retrieval fails internally and the session STILL opens normally
 *     with no `relevantKnowledge` field — opening a session must never
 *     block on retrieval.
 * (2) No prompt → no retrieval attempt (no SessionKnowledgeApplication rows).
 *
 * The happy path (real embeddings → relevantKnowledge + injection rows) is
 * validated live post-deploy, like close-capture was.
 */
import { describe, expect, it, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { startSession } from "../tools/start-session.js";

const dbReachable = await db.user
  .count()
  .then(() => true)
  .catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("brain_start_session inject-at-open", () => {
  const created = { userIds: [] as string[], sessionIds: [] as string[] };

  afterAll(async () => {
    for (const sid of created.sessionIds) {
      await db.sessionKnowledgeApplication.deleteMany({ where: { sessionId: sid } }).catch(() => {});
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
      data: { email: `start-inject-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    created.userIds.push(u.id);
    return u.id;
  }

  // AuthContext types tokenId as non-null string, but Session.tokenId is a
  // nullable column and the handler writes it through verbatim — null is the
  // honest value for a test session with no real MCPToken row (a fake string
  // would violate the FK).
  const authFor = (userId: string) =>
    ({ userId, projectId: null, tokenId: null }) as unknown as Parameters<
      typeof startSession.handler
    >[1];

  it("fail-soft: prompt + no embedding provider → session opens, no relevantKnowledge", async () => {
    const userId = await mintUser();
    const res = (await startSession.handler(
      { clientType: "claude_code", prompt: "add a pg-boss worker job for nightly digests" },
      authFor(userId),
    )) as { sessionId: string; relevantKnowledge?: unknown };
    created.sessionIds.push(res.sessionId);

    expect(res.sessionId).toBeTruthy();
    expect(res.relevantKnowledge).toBeUndefined();

    const row = await db.session.findUniqueOrThrow({ where: { id: res.sessionId } });
    expect(row.userId).toBe(userId);
    const events = await db.sessionEvent.count({
      where: { sessionId: res.sessionId, eventType: "session_started" },
    });
    expect(events).toBe(1);
  });

  it("no prompt → no retrieval attempted (no application rows)", async () => {
    const userId = await mintUser();
    const res = (await startSession.handler(
      { clientType: "claude_code" },
      authFor(userId),
    )) as { sessionId: string; relevantKnowledge?: unknown };
    created.sessionIds.push(res.sessionId);

    expect(res.relevantKnowledge).toBeUndefined();
    const apps = await db.sessionKnowledgeApplication.count({
      where: { sessionId: res.sessionId },
    });
    expect(apps).toBe(0);
  });
});
