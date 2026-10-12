/**
 * "Knowledge leaves when new knowledge replaces it" (v2.23.0). Teaching a
 * corrected decision with `supersedesKnowledgeId` pointing at a TEAMMATE'S
 * org-shared decision used to report `superseded: false` and leave the old
 * one active — supersede only ever touched the caller's own rows. Now the
 * teach is the replacement, so it retires the old row through the retire
 * path (visibility check + audit snapshot). A row the caller cannot see is
 * still untouched.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { teachKnowledge } from "../tools/teach.js";

// Teach embeds the rule; no provider key in CI. The vector's content is
// irrelevant to supersession.
vi.mock("@brain/core", async (orig) => {
  const real = await orig<typeof import("@brain/core")>();
  return {
    ...real,
    embedding: {
      ...real.embedding,
      embedWithProvenance: async () => ({ vector: new Array(1536).fill(0.01), model: "test-stub" }),
    },
  };
});

const dbReachable = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("brain_teach_knowledge supersedes a teammate's decision", () => {
  const tag = randomBytes(5).toString("hex");
  let ownerId: string, mateId: string, orgId: string, projectId: string;

  const auth = (userId: string) => ({
    userId,
    tokenId: "test-token",
    teamId: null as string | null,
    projectId: null as string | null,
    organizationId: null as string | null,
    scope: "personal" as const,
    capabilities: [] as string[],
  });

  beforeAll(async () => {
    ownerId = (await db.user.create({ data: { email: `sup-owner-${tag}@test.local` } })).id;
    mateId = (await db.user.create({ data: { email: `sup-mate-${tag}@test.local` } })).id;
    orgId = (await db.organization.create({ data: { slug: `sup-${tag}`, name: "Sup" } })).id;
    await db.organizationMember.createMany({
      data: [
        { orgId, userId: ownerId, role: "owner" },
        { orgId, userId: mateId, role: "member" },
      ],
    });
    projectId = (
      await db.project.create({ data: { organizationId: orgId, name: "Sup", slug: `sup-${tag}` } })
    ).id;
  });

  afterAll(async () => {
    await db.knowledge.deleteMany({ where: { ownerUserId: { in: [ownerId, mateId] } } });
    await db.project.deleteMany({ where: { id: projectId } });
    await db.organizationMember.deleteMany({ where: { orgId } });
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, mateId] } } });
  });

  const decision = (visibility: "org" | "private") =>
    db.knowledge.create({
      data: {
        type: "principle",
        triggerText: `choosing an HTTP client ${tag}`,
        ruleText: "Use axios",
        ownerUserId: ownerId,
        ownerProjectId: projectId,
        visibility,
        scope: "project",
        tags: ["decision"],
      },
      select: { id: true },
    });

  it("replaces the teammate's org decision in one call, with lineage", async () => {
    const old = await decision("org");
    const res = (await teachKnowledge.handler(
      {
        type: "principle",
        trigger: `choosing an HTTP client ${tag}`,
        rule: "Use the shared fetch wrapper",
        scope: "project",
        tags: ["decision"],
        projectId,
        supersedesKnowledgeId: old.id,
      },
      auth(mateId),
    )) as { id: string; superseded?: boolean };

    expect(res.superseded).toBe(true);
    const oldRow = await db.knowledge.findUniqueOrThrow({ where: { id: old.id } });
    expect(oldRow.deletedAt).not.toBeNull();
    const newRow = await db.knowledge.findUniqueOrThrow({ where: { id: res.id } });
    expect(newRow.parentKnowledgeId).toBe(old.id);
    const audit = await db.auditLog.findFirst({
      where: { action: "knowledge.retire", targetId: old.id },
    });
    expect((audit?.payload as { replacedById?: string } | null)?.replacedById).toBe(res.id);
  });

  it("leaves a teammate's PRIVATE row alone and says so", async () => {
    const secret = await decision("private");
    const res = (await teachKnowledge.handler(
      {
        type: "principle",
        trigger: `choosing an HTTP client ${tag}`,
        rule: "Try to override a private rule",
        scope: "project",
        tags: ["decision"],
        projectId,
        supersedesKnowledgeId: secret.id,
      },
      auth(mateId),
    )) as { superseded?: boolean; supersedeHint?: string };

    expect(res.superseded).toBe(false);
    expect(res.supersedeHint).toMatch(/still ACTIVE/);
    const row = await db.knowledge.findUniqueOrThrow({ where: { id: secret.id } });
    expect(row.deletedAt).toBeNull();
  });
});
