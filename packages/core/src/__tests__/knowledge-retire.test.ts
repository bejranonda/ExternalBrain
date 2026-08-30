/**
 * brain_retire_knowledge — the first MCP verb that removes rather than adds.
 *
 * This is a real-DB integration test, not a mock. The property being tested
 * is authorization — "did the visibility predicate actually deny access" —
 * and that is exactly the class of thing a hand-mocked Prisma client gives
 * false confidence about: a mock returns what the test author assumed the
 * query would return, not what `buildKnowledgeWhereV2` actually computes.
 * Mirrors the guard pattern in kea-audit-writes.test.ts: skip cleanly when
 * the DB is unreachable rather than failing every environment without one.
 *
 * The scope decision under test — an agent can retire ANY row it could read,
 * not only rows it owns — was made explicit by the operator on 2026-08-30
 * specifically because a hallucinating agent retiring a teammate's decision
 * is now possible. These tests exist to pin exactly where that line sits:
 * visible-to-you is retirable, everything else is not, and nothing is ever
 * hard-deleted regardless of which branch fires.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { retireKnowledgeById } from "../knowledge-retire.js";

const dbReachable = await db.user.count().then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

function uid(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

guard("retireKnowledgeById", () => {
  const cleanup = {
    knowledgeIds: [] as string[],
    projectIds: [] as string[],
    orgIds: [] as string[],
    userIds: [] as string[],
  };

  async function makeUser() {
    const u = await db.user.create({
      data: { email: `${uid("retire-test")}@test.local` },
      select: { id: true },
    });
    cleanup.userIds.push(u.id);
    return u.id;
  }

  async function makeOrgWithMembers(memberUserIds: string[]) {
    const org = await db.organization.create({
      data: { slug: uid("org"), name: "Retire Test Org" },
      select: { id: true },
    });
    cleanup.orgIds.push(org.id);
    for (const userId of memberUserIds) {
      await db.organizationMember.create({
        data: { orgId: org.id, userId, role: "member" },
      });
    }
    return org.id;
  }

  async function makeProject(orgId: string, ownerUserId: string) {
    const p = await db.project.create({
      data: {
        organizationId: orgId,
        ownerUserId,
        name: uid("proj"),
        slug: uid("proj-slug"),
      },
      select: { id: true },
    });
    cleanup.projectIds.push(p.id);
    return p.id;
  }

  async function makeKnowledge(opts: {
    ownerUserId: string;
    ownerProjectId?: string | null;
    visibility: "private" | "project" | "org";
    tags?: string[];
  }) {
    const k = await db.knowledge.create({
      data: {
        type: "reflex",
        triggerText: "test trigger " + uid("t"),
        ruleText: "test rule " + uid("r"),
        ownerUserId: opts.ownerUserId,
        ownerProjectId: opts.ownerProjectId ?? null,
        visibility: opts.visibility,
        tags: opts.tags ?? [],
      },
      select: { id: true },
    });
    cleanup.knowledgeIds.push(k.id);
    return k.id;
  }

  afterAll(async () => {
    // Children first — Knowledge has no FK-cascade guarantee onto these test
    // rows, and Project→Organization is Restrict (see schema.prisma), so
    // deletion order matters or cleanup itself fails loudly.
    for (const id of cleanup.knowledgeIds) {
      await db.knowledge.delete({ where: { id } }).catch(() => {});
    }
    for (const id of cleanup.projectIds) {
      await db.project.delete({ where: { id } }).catch(() => {});
    }
    for (const id of cleanup.orgIds) {
      await db.organization.delete({ where: { id } }).catch(() => {});
    }
    for (const id of cleanup.userIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
    await db.$disconnect().catch(() => {});
  });

  it("retires the caller's own private row with no org lookup needed", async () => {
    const user = await makeUser();
    const id = await makeKnowledge({ ownerUserId: user, visibility: "private" });

    const result = await retireKnowledgeById(db, { id, actorUserId: user });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.wasOwnRow).toBe(true);
      expect(result.snapshot.id).toBe(id);
    }
    const row = await db.knowledge.findUnique({ where: { id }, select: { deletedAt: true } });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("FORBIDS retiring another user's PRIVATE row even in the same org+project", async () => {
    const owner = await makeUser();
    const attacker = await makeUser();
    const org = await makeOrgWithMembers([owner, attacker]);
    const project = await makeProject(org, owner);
    const id = await makeKnowledge({
      ownerUserId: owner,
      ownerProjectId: project,
      visibility: "private",
    });

    const result = await retireKnowledgeById(db, { id, actorUserId: attacker });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("FORBIDDEN");
    const row = await db.knowledge.findUnique({ where: { id }, select: { deletedAt: true } });
    expect(row?.deletedAt).toBeNull();
  });

  it("ALLOWS retiring a teammate's ORG-shared row — the explicit widening under test", async () => {
    const owner = await makeUser();
    const teammate = await makeUser();
    const org = await makeOrgWithMembers([owner, teammate]);
    const project = await makeProject(org, owner);
    const id = await makeKnowledge({
      ownerUserId: owner,
      ownerProjectId: project,
      visibility: "org",
      tags: ["decision"],
    });

    const result = await retireKnowledgeById(db, {
      id,
      actorUserId: teammate,
      reason: "test: cleaning up a duplicate decision",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.wasOwnRow).toBe(false);
      // The snapshot must carry enough to re-teach it if this was a mistake.
      expect(result.snapshot.ruleText).toBeTruthy();
      expect(result.snapshot.visibility).toBe("org");
    }
  });

  it("FORBIDS retiring an org-shared row from a DIFFERENT org — membership must be real, not assumed", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const ownerOrg = await makeOrgWithMembers([owner]);
    // outsider belongs to a DIFFERENT org entirely.
    await makeOrgWithMembers([outsider]);
    const project = await makeProject(ownerOrg, owner);
    const id = await makeKnowledge({
      ownerUserId: owner,
      ownerProjectId: project,
      visibility: "org",
    });

    const result = await retireKnowledgeById(db, { id, actorUserId: outsider });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("FORBIDDEN");
  });

  it("FORBIDS retiring a PROJECT-visibility row for a non-member of that org", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const org = await makeOrgWithMembers([owner]);
    const project = await makeProject(org, owner);
    const id = await makeKnowledge({
      ownerUserId: owner,
      ownerProjectId: project,
      visibility: "project",
    });

    const result = await retireKnowledgeById(db, { id, actorUserId: outsider });
    expect(result.ok).toBe(false);
  });

  it("treats an ALREADY-RETIRED row as NOT_FOUND, not a second success", async () => {
    const user = await makeUser();
    const id = await makeKnowledge({ ownerUserId: user, visibility: "private" });
    const first = await retireKnowledgeById(db, { id, actorUserId: user });
    expect(first.ok).toBe(true);

    const second = await retireKnowledgeById(db, { id, actorUserId: user });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND for an id that never existed", async () => {
    const user = await makeUser();
    const result = await retireKnowledgeById(db, { id: "nonexistent-id", actorUserId: user });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_FOUND");
  });

  it("NEVER hard-deletes — the row is always still SELECTable after retirement", async () => {
    const user = await makeUser();
    const id = await makeKnowledge({ ownerUserId: user, visibility: "private" });
    await retireKnowledgeById(db, { id, actorUserId: user });
    const row = await db.knowledge.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("writes a full-content AuditLog snapshot BEFORE the row is gone from view", async () => {
    const user = await makeUser();
    const id = await makeKnowledge({ ownerUserId: user, visibility: "private" });
    await retireKnowledgeById(db, { id, actorUserId: user, reason: "test reason" });

    const audit = await db.auditLog.findFirst({
      where: { action: "knowledge.retire", targetId: id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    const payload = audit?.payload as { snapshot?: { ruleText?: string }; reason?: string } | null;
    expect(payload?.snapshot?.ruleText).toBeTruthy();
    expect(payload?.reason).toBe("test reason");
  });

  it("flags retiredSomeoneElsesRow in the audit payload only when it's true", async () => {
    const owner = await makeUser();
    const teammate = await makeUser();
    const org = await makeOrgWithMembers([owner, teammate]);
    const project = await makeProject(org, owner);
    const id = await makeKnowledge({ ownerUserId: owner, ownerProjectId: project, visibility: "org" });

    await retireKnowledgeById(db, { id, actorUserId: teammate });

    const audit = await db.auditLog.findFirst({
      where: { action: "knowledge.retire", targetId: id },
      orderBy: { createdAt: "desc" },
    });
    const payload = audit?.payload as { retiredSomeoneElsesRow?: boolean } | null;
    expect(payload?.retiredSomeoneElsesRow).toBe(true);
  });
});
