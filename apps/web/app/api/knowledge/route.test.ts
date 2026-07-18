import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { ensureDefaultProject, ensureNamedProject } from "@brain/core";
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
    const body = (await res.json()) as { item: { id: string; parentKnowledgeId: string | null } };
    created.knowledgeIds.push(body.item.id);

    // The response body itself must reflect the post-supersede state, not a
    // stale pre-update snapshot — regression test for the transaction
    // returning the wrong object (2026-07-17 CodeRabbit finding).
    expect(body.item.parentKnowledgeId).toBe(old.id);

    const oldRow = await db.knowledge.findUniqueOrThrow({ where: { id: old.id } });
    expect(oldRow.deletedAt).not.toBeNull();
    const newRow = await db.knowledge.findUniqueOrThrow({ where: { id: body.item.id } });
    expect(newRow.parentKnowledgeId).toBe(old.id);
  });

  it("does not supersede a row from a different project owned by the same user", async () => {
    // ensureDefaultProject is per-user idempotent — calling it again returns
    // the SAME project as `projectId` above, which would make this test
    // trivially pass without exercising cross-project exclusion at all
    // (2026-07-17 CodeRabbit finding). ensureNamedProject, keyed by a
    // distinct name, genuinely creates a second project for this user.
    const otherProjectId = (await ensureNamedProject(db, userId, "Second Project")).projectId;
    expect(otherProjectId).not.toBe(projectId);
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

    // Clean up the extra project immediately, not deferred to afterAll:
    // getActiveProject's no-cookie fallback (this file's vitest.setup.ts
    // permanently stubs cookies() to report none) picks `projects[0]` from
    // an un-ordered Prisma query — leaving a second real project on this
    // shared `userId` would make every later GET test's active-project
    // resolution depend on unspecified row order. Deleting it restores the
    // single-project fixture the rest of this suite assumes.
    await db.project.delete({ where: { id: otherProjectId } });
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

  it("rejects when one of two for: tags is not a member (validateForTagAssignee must check ALL for: tags, not just the first)", async () => {
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    const member = await db.user.create({
      data: { email: `multi-tag-member-${randomBytes(6).toString("hex")}@test.local` },
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
        ruleText: "task for two people, second one invalid",
        tags: ["action-item", `for:${member.email}`, "for:not-a-member@test.local"],
        ownerProjectId: projectId,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("accepts two for: tags when both ARE real org members — the route must not assume the UI only ever sends one", async () => {
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    const memberA = await db.user.create({
      data: { email: `multi-tag-a-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true, email: true },
    });
    const memberB = await db.user.create({
      data: { email: `multi-tag-b-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true, email: true },
    });
    created.userIds.push(memberA.id, memberB.id);
    await db.organizationMember.create({
      data: { orgId: project.organizationId, userId: memberA.id, role: "member" },
    });
    await db.organizationMember.create({
      data: { orgId: project.organizationId, userId: memberB.id, role: "member" },
    });

    const req = new Request("http://test.local/api/knowledge", {
      method: "POST",
      body: JSON.stringify({
        type: "action_item",
        triggerText: "t",
        ruleText: "task for two real members",
        tags: ["action-item", `for:${memberA.email}`, `for:${memberB.email}`],
        ownerProjectId: projectId,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { id: string } };
    created.knowledgeIds.push(body.item.id);
    const row = await db.knowledge.findUniqueOrThrow({ where: { id: body.item.id } });
    expect(row.tags).toContain(`for:${memberA.email.toLowerCase()}`);
    expect(row.tags).toContain(`for:${memberB.email.toLowerCase()}`);
  });

  it("canonicalizes a mixed-case for: tag email to lowercase in the PERSISTED row, not just at validation time", async () => {
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    const member = await db.user.create({
      data: { email: `mixed-case-member-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true, email: true },
    });
    created.userIds.push(member.id);
    await db.organizationMember.create({
      data: { orgId: project.organizationId, userId: member.id, role: "member" },
    });
    // member.email is already all-lowercase (hex + "@test.local") — flip the
    // case of the first character so the submitted tag genuinely differs
    // from the canonical lowercase form.
    const mixedCaseTag = `for:${member.email[0]!.toUpperCase()}${member.email.slice(1)}`;

    const req = new Request("http://test.local/api/knowledge", {
      method: "POST",
      body: JSON.stringify({
        type: "action_item",
        triggerText: "t",
        ruleText: "task for a mixed-case email",
        tags: ["action-item", mixedCaseTag],
        ownerProjectId: projectId,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { id: string } };
    created.knowledgeIds.push(body.item.id);
    const row = await db.knowledge.findUniqueOrThrow({ where: { id: body.item.id } });
    // packages/core/src/action-items.ts's listOpenActionItemsFor does an
    // exact-match `tags: { has: for:${email.toLowerCase()} }` lookup — a
    // persisted mixed-case tag would never surface to its assignee.
    expect(row.tags).toContain(`for:${member.email.toLowerCase()}`);
    expect(row.tags).not.toContain(mixedCaseTag);
  });

  it("persists `instead` on create, mirroring how `rationale` is already handled", async () => {
    const req = new Request("http://test.local/api/knowledge", {
      method: "POST",
      body: JSON.stringify({
        type: "principle",
        triggerText: "reporting store choice",
        ruleText: "use postgres with timescale",
        rationale: "time-bucketed queries",
        instead: "plain postgres",
        tags: ["decision"],
        ownerProjectId: projectId,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { id: string } };
    created.knowledgeIds.push(body.item.id);
    const row = await db.knowledge.findUniqueOrThrow({ where: { id: body.item.id } });
    expect(row.instead).toBe("plain postgres");
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

  it(
    "GET ?tagPrefix still finds a match beyond the old single-batch 2000-row candidate-pool cap",
    async () => {
      // Push a real match past the OLD CANDIDATE_POOL_CAP (2000, single
      // fetch) by inserting enough higher-confidence filler rows ahead of it
      // in sort order (default order is confidence desc) — proves the fixed
      // paginated scan (route.ts's tagPrefix branch) finds it where the old
      // single-batch fetch would have silently dropped it.
      const FILLER_MARKER = "filler-overflow-test";
      const FILLER_COUNT = 2001;
      await db.knowledge.createMany({
        data: Array.from({ length: FILLER_COUNT }, (_, i) => ({
          type: "action_item",
          scope: "project",
          ownerUserId: userId,
          ownerProjectId: projectId,
          triggerText: "t",
          ruleText: `filler ${i}`,
          tags: [FILLER_MARKER],
          confidence: 1.0,
          extractedBy: "user",
        })),
      });

      try {
        const overflow = await db.knowledge.create({
          data: {
            type: "action_item",
            scope: "project",
            ownerUserId: userId,
            ownerProjectId: projectId,
            triggerText: "t",
            ruleText: "overflow match, sorts after every filler row",
            // Lower confidence than every filler row (1.0) and every other
            // fixture in this suite (>= 0.7) — guarantees this row sorts
            // last under the default confidence-desc order, i.e. well past
            // position 2000.
            tags: ["action-item", "meeting:2026-07-17-overflow"],
            confidence: 0.05,
            extractedBy: "user",
          },
          select: { id: true },
        });
        created.knowledgeIds.push(overflow.id);

        const req = new Request(
          `http://test.local/api/knowledge?tagPrefix=${encodeURIComponent("meeting:")}`,
        );
        const res = await GET(req);
        const body = (await res.json()) as { items: Array<{ id: string }> };
        const ids = body.items.map((i) => i.id);
        expect(ids).toContain(overflow.id);
      } finally {
        // Clean up immediately rather than deferring to afterAll's small id
        // list — 2001 filler rows would otherwise leak into every other
        // test's project scope for the rest of this suite.
        await db.knowledge.deleteMany({ where: { tags: { has: FILLER_MARKER } } });
      }
    },
    30_000,
  );
});
