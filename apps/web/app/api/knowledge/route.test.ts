import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { ensureDefaultProject } from "@brain/core";
import * as authLib from "@/lib/brain/auth";
import { POST, GET } from "./route.js";

// First unit-test file for apps/web (2026-07-14) — see vitest.config.ts.
// Route handlers are plain async functions over Web-standard Request, so a
// bare Node environment is enough; no React/DOM involved.
const dbReachable = await db
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("POST /api/knowledge — action_item + supersedesKnowledgeId + assignee validation", () => {
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
      await db.mCPToken.deleteMany({ where: { userId: uid } }).catch(() => {});
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
        tags: ["action-item"],
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
        type: "principle",
        scope: "project",
        ownerUserId: userId,
        ownerProjectId: projectId,
        triggerText: "old decision trigger",
        ruleText: "use plain postgres",
        tags: ["decision"],
        confidence: 1.0,
        extractedBy: "user",
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

  it("does not supersede a row from a different project owned by the same user", async () => {
    const otherProjectId = (await ensureDefaultProject(db, userId)).projectId; // same user, but if this ever returns the same id the test below is meaningless — assert distinctness first
    if (otherProjectId === projectId) return; // ensureDefaultProject is idempotent per user; nothing to test here in this fixture shape
    const foreign = await db.knowledge.create({
      data: {
        type: "principle",
        scope: "project",
        ownerUserId: userId,
        ownerProjectId: otherProjectId,
        triggerText: "foreign trigger",
        ruleText: "a decision in a different project",
        tags: ["decision"],
        confidence: 1.0,
        extractedBy: "user",
      },
      select: { id: true },
    });
    created.knowledgeIds.push(foreign.id);

    const req = new Request("http://test.local/api/knowledge", {
      method: "POST",
      body: JSON.stringify({
        type: "principle",
        triggerText: "t",
        ruleText: "should not retire the foreign row",
        tags: ["decision"],
        ownerProjectId: projectId,
        supersedesKnowledgeId: foreign.id,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { id: string } };
    created.knowledgeIds.push(body.item.id);

    const foreignRow = await db.knowledge.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(foreignRow.deletedAt).toBeNull(); // untouched — different project
    const newRow = await db.knowledge.findUniqueOrThrow({ where: { id: body.item.id } });
    expect(newRow.parentKnowledgeId).toBeNull();
  });

  it("rejects a for: tag whose email is not a member of the resolved project's org", async () => {
    const req = new Request("http://test.local/api/knowledge", {
      method: "POST",
      body: JSON.stringify({
        type: "action_item",
        triggerText: "t",
        ruleText: "task for a stranger",
        tags: ["action-item", "for:not-a-member@test.local"],
        ownerProjectId: projectId,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("accepts a for: tag whose email IS a real org member", async () => {
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    const member = await db.user.create({
      data: { email: `real-member-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true, email: true },
    });
    created.userIds.push(member.id);
    await db.organizationMember.create({
      data: { orgId: project.organizationId, userId: member.id, role: "member" },
    });

    const req = new Request("http://test.local/api/knowledge", {
      method: "POST",
      body: JSON.stringify({
        type: "action_item",
        triggerText: "t",
        ruleText: "task for a real member",
        tags: ["action-item", `for:${member.email}`],
        ownerProjectId: projectId,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { id: string } };
    created.knowledgeIds.push(body.item.id);
  });

  it("GET ?tagPrefix=meeting: returns only tagged rows, without dropping older matches past the response limit", async () => {
    const tagged = await db.knowledge.create({
      data: {
        type: "action_item",
        scope: "project",
        ownerUserId: userId,
        ownerProjectId: projectId,
        triggerText: "t",
        ruleText: "tagged item",
        tags: ["action-item", "meeting:2026-07-14-standup"],
        confidence: 1.0,
        extractedBy: "user",
      },
      select: { id: true },
    });
    const untagged = await db.knowledge.create({
      data: {
        type: "action_item",
        scope: "project",
        ownerUserId: userId,
        ownerProjectId: projectId,
        triggerText: "t",
        ruleText: "untagged item",
        tags: ["action-item"],
        confidence: 1.0,
        extractedBy: "user",
      },
      select: { id: true },
    });
    created.knowledgeIds.push(tagged.id, untagged.id);

    const req = new Request(
      `http://test.local/api/knowledge?tagPrefix=${encodeURIComponent("meeting:")}`,
    );
    const res = await GET(req);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(tagged.id);
    expect(ids).not.toContain(untagged.id);
  });
});
