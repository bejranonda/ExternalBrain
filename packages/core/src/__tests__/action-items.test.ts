/**
 * V2.0 action items (spec 2026-07-07 §4b) — db-guarded integration tests.
 *
 * Pins the contract:
 *   (1) addressed listing: only rows tagged `for:<caller email>` in the
 *       active project, blockers first, then oldest-first
 *   (2) cross-project isolation: an assignee tag in another project never
 *       leaks into this project's listing
 *   (3) resolve retires only action_item rows inside the caller's project
 *       scope — never rules, never other projects' tasks
 *   (4) formatting marks blockers / open questions and carries the id the
 *       agent needs for `resolvedActionItemIds`
 *
 * Skipped when no DB is reachable (same guard as start-inject.test.ts).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { ensureDefaultProject } from "../org.js";
import {
  formatActionItemsForInjection,
  listOpenActionItemsFor,
  listProjectActionItems,
  resolveActionItems,
} from "../action-items.js";

const dbReachable = await db.$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("action-items (V2.0)", () => {
  const rand = randomBytes(6).toString("hex");
  const assigneeEmail = `assignee-${rand}@test.local`;
  const created = { userIds: [] as string[], knowledgeIds: [] as string[] };

  let creatorId: string;
  let assigneeId: string;
  let projectId: string;
  let otherProjectId: string;
  let olderId: string;
  let blockerId: string;
  let otherAssigneeId: string;
  let otherProjectItemId: string;
  let ruleId: string;

  async function mintUser(email: string): Promise<string> {
    const u = await db.user.create({ data: { email }, select: { id: true } });
    created.userIds.push(u.id);
    return u.id;
  }

  async function mintActionItem(data: {
    projectId: string;
    tags: string[];
    ruleText: string;
    createdAt?: Date;
    type?: string;
  }): Promise<string> {
    const row = await db.knowledge.create({
      data: {
        type: data.type ?? "action_item",
        scope: "project",
        ownerUserId: creatorId,
        ownerProjectId: data.projectId,
        triggerText: "meeting context",
        ruleText: data.ruleText,
        tags: data.tags,
        confidence: 1.0,
        extractedBy: "user",
        visibility: "project",
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
      },
      select: { id: true },
    });
    created.knowledgeIds.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    creatorId = await mintUser(`creator-${rand}@test.local`);
    assigneeId = await mintUser(assigneeEmail);
    projectId = (await ensureDefaultProject(db, creatorId)).projectId;
    otherProjectId = (await ensureDefaultProject(db, assigneeId)).projectId;

    olderId = await mintActionItem({
      projectId,
      tags: ["action-item", `for:${assigneeEmail}`],
      ruleText: "update the deployment runbook",
      createdAt: new Date(Date.now() - 3 * 86_400_000),
    });
    blockerId = await mintActionItem({
      projectId,
      tags: ["action-item", `for:${assigneeEmail}`, "blocker", "meeting:2026-07-07-sprint"],
      ruleText: "unblock the staging database",
    });
    otherAssigneeId = await mintActionItem({
      projectId,
      tags: ["action-item", "for:someone-else@test.local"],
      ruleText: "someone else's task",
    });
    otherProjectItemId = await mintActionItem({
      projectId: otherProjectId,
      tags: ["action-item", `for:${assigneeEmail}`],
      ruleText: "task in another project",
    });
    ruleId = await mintActionItem({
      projectId,
      type: "principle",
      tags: [`for:${assigneeEmail}`],
      ruleText: "a rule that must never be retired via resolve",
    });
  });

  afterAll(async () => {
    await db.knowledge
      .deleteMany({ where: { id: { in: created.knowledgeIds } } })
      .catch(() => {});
    for (const uid of created.userIds) {
      await db.mCPToken.deleteMany({ where: { userId: uid } }).catch(() => {});
      await db.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await db.$disconnect().catch(() => {});
  });

  it("addressed listing: blocker first, then oldest; no other assignees, no other projects", async () => {
    const items = await listOpenActionItemsFor({
      userId: assigneeId,
      email: assigneeEmail.toUpperCase(), // case-insensitive addressing
      projectId,
    });
    expect(items.map((i) => i.id)).toEqual([blockerId, olderId]);
    expect(items.map((i) => i.id)).not.toContain(otherAssigneeId);
    expect(items.map((i) => i.id)).not.toContain(otherProjectItemId);
  });

  it("project listing includes all open items in the project only", async () => {
    const items = await listProjectActionItems({
      userId: creatorId,
      projectId,
    });
    const ids = items.map((i) => i.id);
    expect(ids).toContain(blockerId);
    expect(ids).toContain(olderId);
    expect(ids).toContain(otherAssigneeId);
    expect(ids).not.toContain(otherProjectItemId);
    expect(ids).not.toContain(ruleId); // type filter: rules are not tasks
  });

  it("formats blockers, open questions, meeting origin, and ids", () => {
    const out = formatActionItemsForInjection([
      {
        id: "k1",
        ruleText: "unblock the staging database",
        triggerText: "sprint planning",
        tags: ["action-item", "blocker", "meeting:2026-07-07-sprint"],
        createdAt: new Date(),
      },
      {
        id: "k2",
        ruleText: "who owns the auth migration?",
        triggerText: "",
        tags: ["open-question"],
        createdAt: new Date(),
      },
    ]);
    expect(out).toContain("## Your Open Action Items");
    expect(out).toContain("[BLOCKER] unblock the staging database — sprint planning (meeting:2026-07-07-sprint) [id: k1]");
    expect(out).toContain("[OPEN QUESTION] who owns the auth migration? [id: k2]");
    expect(formatActionItemsForInjection([])).toBe("");
  });

  it("resolve retires only project-scoped action items; rules and foreign projects are untouched", async () => {
    // Attempt to resolve: one real item + a rule + a foreign-project item.
    const count = await resolveActionItems({
      ids: [olderId, ruleId, otherProjectItemId],
      userId: assigneeId,
      projectId,
    });
    expect(count).toBe(1);

    const after = await listOpenActionItemsFor({
      userId: assigneeId,
      email: assigneeEmail,
      projectId,
    });
    expect(after.map((i) => i.id)).toEqual([blockerId]);

    const rule = await db.knowledge.findUniqueOrThrow({
      where: { id: ruleId },
      select: { deletedAt: true },
    });
    expect(rule.deletedAt).toBeNull();
    const foreign = await db.knowledge.findUniqueOrThrow({
      where: { id: otherProjectItemId },
      select: { deletedAt: true },
    });
    expect(foreign.deletedAt).toBeNull();

    expect(await resolveActionItems({ ids: [], userId: assigneeId, projectId })).toBe(0);
  });
});
