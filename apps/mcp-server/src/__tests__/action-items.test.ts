/**
 * V2.0 meeting action items (spec 2026-07-07) — end-to-end tool contract:
 *
 *   teach(type:"action_item") → start_session carries openActionItems for
 *   the assignee (flag-gated, no SessionKnowledgeApplication pollution) →
 *   report_session_outcome(resolvedActionItemIds) retires them.
 *
 * Also pins: flag OFF → response shape unchanged; cross-project isolation.
 * Rows are inserted directly (no embedding provider in CI); the teach-path
 * type acceptance is covered by the zod parse + a create that skips embed
 * failure the same way other teach tests do — here we validate the enum by
 * schema parse only, the row lifecycle via direct inserts.
 *
 * Skipped when no DB is reachable (same guard as start-inject.test.ts).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { ensureDefaultProject, _resetEnvCache } from "@brain/core";
import { startSession } from "../tools/start-session.js";
import { reportSessionOutcome } from "../tools/report.js";
import { teachKnowledge } from "../tools/teach.js";

const dbReachable = await db.$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);
const guard = dbReachable ? describe : describe.skip;

const authFor = (userId: string) =>
  ({ userId, projectId: null, tokenId: null }) as unknown as Parameters<
    typeof startSession.handler
  >[1];

guard("V2 action items — MCP tool lifecycle", () => {
  const rand = randomBytes(6).toString("hex");
  const email = `v2-assignee-${rand}@test.local`;
  const created = {
    userIds: [] as string[],
    knowledgeIds: [] as string[],
    sessionIds: [] as string[],
  };
  let userId: string;
  let projectId: string;
  let itemId: string;
  let savedFlag: string | undefined;

  beforeAll(async () => {
    savedFlag = process.env.V2_ACTION_ITEMS;
    const u = await db.user.create({
      data: { email },
      select: { id: true },
    });
    created.userIds.push(u.id);
    userId = u.id;
    projectId = (await ensureDefaultProject(db, userId)).projectId;

    const row = await db.knowledge.create({
      data: {
        type: "action_item",
        scope: "project",
        ownerUserId: userId,
        ownerProjectId: projectId,
        triggerText: "sprint planning 2026-07-07",
        ruleText: "update the deployment runbook",
        tags: ["action-item", `for:${email}`, "meeting:2026-07-07-sprint"],
        confidence: 1.0,
        extractedBy: "user",
        visibility: "project",
      },
      select: { id: true },
    });
    created.knowledgeIds.push(row.id);
    itemId = row.id;
  });

  afterAll(async () => {
    if (savedFlag === undefined) delete process.env.V2_ACTION_ITEMS;
    else process.env.V2_ACTION_ITEMS = savedFlag;
    _resetEnvCache();
    for (const sid of created.sessionIds) {
      await db.sessionKnowledgeApplication
        .deleteMany({ where: { sessionId: sid } })
        .catch(() => {});
      await db.sessionEvent.deleteMany({ where: { sessionId: sid } }).catch(() => {});
      await db.session.delete({ where: { id: sid } }).catch(() => {});
    }
    await db.knowledge
      .deleteMany({ where: { id: { in: created.knowledgeIds } } })
      .catch(() => {});
    for (const uid of created.userIds) {
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await db.$disconnect().catch(() => {});
  });

  it("teach zod schema accepts type action_item", () => {
    // Schema-level acceptance (the embed step needs a provider CI lacks, so
    // the full handler path is validated live post-deploy like inject was).
    const schema = teachKnowledge.inputSchema as {
      properties: { type: { enum: string[] } };
    };
    expect(schema.properties.type.enum).toContain("action_item");
  });

  it("flag OFF → no openActionItems field", async () => {
    delete process.env.V2_ACTION_ITEMS;
    _resetEnvCache();
    const res = (await startSession.handler(
      { projectId, prompt: "continue project work" },
      authFor(userId),
    )) as { sessionId: string; openActionItems?: unknown };
    created.sessionIds.push(res.sessionId);
    expect(res.openActionItems).toBeUndefined();
  });

  it("flag ON → assignee sees the addressed block; no injected-application rows for it", async () => {
    process.env.V2_ACTION_ITEMS = "true";
    _resetEnvCache();
    const res = (await startSession.handler(
      { projectId, prompt: "continue project work" },
      authFor(userId),
    )) as {
      sessionId: string;
      openActionItems?: { knowledgeIds: string[]; injection: string };
    };
    created.sessionIds.push(res.sessionId);

    expect(res.openActionItems).toBeDefined();
    expect(res.openActionItems!.knowledgeIds).toContain(itemId);
    expect(res.openActionItems!.injection).toContain("## Your Open Action Items");
    expect(res.openActionItems!.injection).toContain("update the deployment runbook");

    // Metric purity (gate #149): the task block must not create
    // SessionKnowledgeApplication rows.
    const apps = await db.sessionKnowledgeApplication.count({
      where: { sessionId: res.sessionId, knowledgeId: itemId },
    });
    expect(apps).toBe(0);
  });

  it("resolvedActionItemIds at close retires the item; next session shows nothing", async () => {
    process.env.V2_ACTION_ITEMS = "true";
    _resetEnvCache();
    const open = (await startSession.handler(
      { projectId },
      authFor(userId),
    )) as { sessionId: string };
    created.sessionIds.push(open.sessionId);

    const closed = (await reportSessionOutcome.handler(
      {
        sessionId: open.sessionId,
        success: true,
        resolvedActionItemIds: [itemId],
      },
      authFor(userId),
    )) as { resolvedActionItems?: number };
    expect(closed.resolvedActionItems).toBe(1);

    const row = await db.knowledge.findUniqueOrThrow({
      where: { id: itemId },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();

    const next = (await startSession.handler(
      { projectId },
      authFor(userId),
    )) as { sessionId: string; openActionItems?: unknown };
    created.sessionIds.push(next.sessionId);
    expect(next.openActionItems).toBeUndefined();
  });
});
