/**
 * `recordInjection` writes "injected" rows only into the caller's own session.
 *
 * Both retrieval doors (MCP `brain_retrieve_knowledge`, web
 * `/api/knowledge/retrieve`) take `sessionId` from the request body. Before
 * the ownership check, any user could plant injection rows in someone else's
 * session — rows that drive that user's outcome bumps at close and show the
 * planted rule on their session page (KNOWN_ISSUES §0ay).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { recordInjection } from "../kra.js";

const live = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const guard = live ? describe : describe.skip;

guard("recordInjection session ownership", () => {
  const tag = randomBytes(5).toString("hex");
  let aliceId: string, bobId: string, aliceSession: string, bobRule: string;

  beforeAll(async () => {
    aliceId = (await db.user.create({ data: { email: `inj-a-${tag}@test.local` } })).id;
    bobId = (await db.user.create({ data: { email: `inj-b-${tag}@test.local` } })).id;
    aliceSession = (await db.session.create({ data: { userId: aliceId, clientType: "custom" } })).id;
    bobRule = (
      await db.knowledge.create({
        data: { type: "reflex", triggerText: "t", ruleText: `BOB-PLANTED-${tag}`, ownerUserId: bobId },
      })
    ).id;
  });

  afterAll(async () => {
    await db.sessionKnowledgeApplication.deleteMany({ where: { sessionId: aliceSession } }).catch(() => {});
    await db.knowledge.deleteMany({ where: { id: bobRule } }).catch(() => {});
    await db.session.deleteMany({ where: { id: aliceSession } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: [aliceId, bobId] } } }).catch(() => {});
    await db.$disconnect().catch(() => {});
  });

  it("refuses to write into a session the caller does not own", async () => {
    await recordInjection(aliceSession, bobId, [bobRule]);
    expect(await db.sessionKnowledgeApplication.count({ where: { sessionId: aliceSession } })).toBe(0);
  });

  it("still records into the caller's own session", async () => {
    await recordInjection(aliceSession, aliceId, [bobRule]);
    expect(await db.sessionKnowledgeApplication.count({ where: { sessionId: aliceSession } })).toBe(1);
  });
});
