import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { ensureDefaultProject } from "@brain/core";
import * as authLib from "@/lib/brain/auth";
import { PATCH } from "./route.js";

// First test file for PATCH /api/knowledge/:id — follows the db-guard +
// vi.spyOn(getCurrentUserId) pattern established by
// apps/web/app/api/knowledge/route.test.ts (Task 1).
const dbReachable = await db
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("PATCH /api/knowledge/:id — for: tag membership validation (I3)", () => {
  const created = { userIds: [] as string[], knowledgeIds: [] as string[] };
  let userId: string;
  let projectId: string;
  let memberEmail: string;

  beforeAll(async () => {
    const u = await db.user.create({
      data: { email: `knowledge-patch-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    created.userIds.push(u.id);
    userId = u.id;
    projectId = (await ensureDefaultProject(db, userId)).projectId;
    vi.spyOn(authLib, "getCurrentUserId").mockResolvedValue(userId);

    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    const member = await db.user.create({
      data: { email: `patch-real-member-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true, email: true },
    });
    created.userIds.push(member.id);
    memberEmail = member.email;
    await db.organizationMember.create({
      data: { orgId: project.organizationId, userId: member.id, role: "member" },
    });
  });

  afterAll(async () => {
    await db.knowledge.deleteMany({ where: { id: { in: created.knowledgeIds } } }).catch(() => {});
    for (const uid of created.userIds) {
      await db.mCPToken.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    vi.restoreAllMocks();
    await db.$disconnect().catch(() => {});
  });

  async function createActionItem(): Promise<string> {
    const row = await db.knowledge.create({
      data: {
        type: "action_item",
        scope: "project",
        ownerUserId: userId,
        ownerProjectId: projectId,
        triggerText: "sprint planning",
        ruleText: "fix the staging database",
        tags: ["action-item"],
        confidence: 0.7,
        extractedBy: "user",
      },
      select: { id: true },
    });
    created.knowledgeIds.push(row.id);
    return row.id;
  }

  it("rejects a PATCH that sets a for: tag whose email is not a member of the row's org", async () => {
    const id = await createActionItem();
    const req = new Request(`http://test.local/api/knowledge/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ tags: ["action-item", "for:not-a-member@test.local"] }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ASSIGNEE");

    // Row must be untouched — the invalid tag was never written.
    const row = await db.knowledge.findUniqueOrThrow({ where: { id } });
    expect(row.tags).toEqual(["action-item"]);
  });

  it("accepts a PATCH that sets a for: tag whose email IS a real org member", async () => {
    const id = await createActionItem();
    const req = new Request(`http://test.local/api/knowledge/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ tags: ["action-item", `for:${memberEmail}`] }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);

    const row = await db.knowledge.findUniqueOrThrow({ where: { id } });
    expect(row.tags).toContain(`for:${memberEmail.toLowerCase()}`);
  });

  it("does not apply the for: check to non-action_item rows", async () => {
    const principle = await db.knowledge.create({
      data: {
        type: "principle",
        scope: "project",
        ownerUserId: userId,
        ownerProjectId: projectId,
        triggerText: "t",
        ruleText: "some principle",
        tags: ["decision"],
        confidence: 0.7,
        extractedBy: "user",
      },
      select: { id: true },
    });
    created.knowledgeIds.push(principle.id);

    const req = new Request(`http://test.local/api/knowledge/${principle.id}`, {
      method: "PATCH",
      // Not a real for: assignee, but the row isn't an action_item, so the
      // membership check must not fire.
      body: JSON.stringify({ tags: ["decision", "for:not-a-member@test.local"] }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: principle.id }) });
    expect(res.status).toBe(200);
  });
});
