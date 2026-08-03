import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { logEvent } from "../tools/log-event.js";
import { reportSessionOutcome } from "../tools/report.js";
import { startSession } from "../tools/start-session.js";
import { teachKnowledge } from "../tools/teach.js";
import { retrieveKnowledge } from "../tools/retrieve.js";
import { sessionSearch } from "../tools/session-search.js";
import { readResource } from "../resources.js";
import { ensureDefaultProject, ensureNamedProject, BrainError } from "@brain/core";

/**
 * Regression net for the IDOR cluster fixed in audit C3-C6 (issue #106).
 *
 * Every MCP tool that accepts a caller-supplied `sessionId` or `projectId`
 * must verify the resource belongs to the authenticated user before
 * mutating. Without that, any authenticated MCP user could:
 *
 * - inject events into another user's session (pollutes KEA)
 * - close another user's session and tamper with its outcome/SQS
 * - bump successCount/failureCount on another user's Knowledge
 * - tag a session/knowledge against a project they don't own
 *
 * These tests mint two real User rows (Alice + Bob), open a session as
 * Alice, then exercise each tool with `auth = Bob` and assert the
 * mutation is rejected with NOT_FOUND or FORBIDDEN_PROJECT. Skipped if
 * the DB is unreachable so CI without a stack still passes.
 */

interface Fixture {
  alice: { userId: string; sessionId: string; projectId: string; knowledgeId: string };
  bob: { userId: string; projectId: string };
}

async function reachable(): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function mintFixture(): Promise<Fixture> {
  const aliceEmail = `idor-alice-${randomBytes(8).toString("hex")}@example.test`;
  const bobEmail = `idor-bob-${randomBytes(8).toString("hex")}@example.test`;

  const alice = await db.user.create({
    data: { email: aliceEmail, name: "Alice IDOR" },
    select: { id: true },
  });
  const bob = await db.user.create({
    data: { email: bobEmail, name: "Bob IDOR" },
    select: { id: true },
  });

  const aliceProject = await ensureDefaultProject(db, alice.id);
  const bobProject = await ensureDefaultProject(db, bob.id);

  const aliceSession = await db.session.create({
    data: {
      userId: alice.id,
      projectId: aliceProject.projectId,
      clientType: "custom",
      metadata: {},
    },
    select: { id: true },
  });

  const aliceKnowledge = await db.knowledge.create({
    data: {
      type: "heuristic",
      scope: "user",
      ownerUserId: alice.id,
      ownerProjectId: aliceProject.projectId,
      triggerText: "alice-trigger-idor",
      ruleText: "alice-rule-idor",
      confidence: 1.0,
      extractedBy: "user",
    },
    select: { id: true, successCount: true },
  });

  return {
    alice: {
      userId: alice.id,
      sessionId: aliceSession.id,
      projectId: aliceProject.projectId,
      knowledgeId: aliceKnowledge.id,
    },
    bob: { userId: bob.id, projectId: bobProject.projectId },
  };
}

async function teardown(fix: Fixture): Promise<void> {
  // Order matters: clear children before users.
  await db.sessionEvent
    .deleteMany({ where: { sessionId: fix.alice.sessionId } })
    .catch(() => {});
  await db.session
    .deleteMany({ where: { userId: { in: [fix.alice.userId, fix.bob.userId] } } })
    .catch(() => {});
  await db.knowledge
    .deleteMany({ where: { ownerUserId: { in: [fix.alice.userId, fix.bob.userId] } } })
    .catch(() => {});
  // ensureDefaultProject created an Organization + Project + member row per user.
  // Find the personal orgs by membership and delete them (cascade clears members
  // and projects). Organization has no ownerUserId — discover via member rows.
  const memberRows = await db.organizationMember.findMany({
    where: { userId: { in: [fix.alice.userId, fix.bob.userId] } },
    select: { orgId: true },
  });
  const orgIds = [...new Set(memberRows.map((m) => m.orgId))];
  if (orgIds.length > 0) {
    await db.organizationMember
      .deleteMany({ where: { orgId: { in: orgIds } } })
      .catch(() => {});
    await db.project.deleteMany({ where: { organizationId: { in: orgIds } } }).catch(() => {});
    await db.organization.deleteMany({ where: { id: { in: orgIds } } }).catch(() => {});
  }
  await db.user
    .deleteMany({ where: { id: { in: [fix.alice.userId, fix.bob.userId] } } })
    .catch(() => {});
}

const live = await reachable();
const guard = live ? describe : describe.skip;
let fix: Fixture | null = null;

guard("MCP cross-user isolation (IDOR fix #106)", () => {
  beforeAll(async () => {
    fix = await mintFixture();
  });

  afterAll(async () => {
    if (fix) await teardown(fix);
    await db.$disconnect().catch(() => {});
  });

  const bobAuth = () => ({
    userId: fix!.bob.userId,
    tokenId: "test-token",
    teamId: null as string | null,
    projectId: null as string | null,
    organizationId: null as string | null,
    scope: "personal" as const,
  });

  /** Bob, on a token bound to Bob's own project. */
  const bobScopedAuth = () => ({ ...bobAuth(), projectId: fix!.bob.projectId });

  it("brain_log_event rejects another user's sessionId (NOT_FOUND)", async () => {
    await expect(
      logEvent.handler(
        {
          sessionId: fix!.alice.sessionId,
          eventType: "tool_use",
          payload: { tool: "test" },
        },
        bobAuth(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("brain_report_session_outcome rejects another user's sessionId (NOT_FOUND)", async () => {
    await expect(
      reportSessionOutcome.handler(
        {
          sessionId: fix!.alice.sessionId,
          success: true,
          knowledgeUsed: [],
        },
        bobAuth(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("brain_report_session_outcome's knowledgeUsed bump is scoped to caller's ownerUserId", async () => {
    // Bob calls report on his own session, but lists Alice's knowledge id.
    // The session-ownership check above kicks in first when the sessionId
    // isn't his — but if Bob crafts a valid call against his own session,
    // the bump must still skip Alice's knowledge row.
    const bobSession = await db.session.create({
      data: {
        userId: fix!.bob.userId,
        projectId: fix!.bob.projectId,
        clientType: "custom",
        metadata: {},
      },
      select: { id: true },
    });
    try {
      const before = await db.knowledge.findUnique({
        where: { id: fix!.alice.knowledgeId },
        select: { successCount: true },
      });
      // The report handler enqueues pg-boss jobs at the end. The
      // singleton boss client may not be reachable in test environments
      // without a started worker schema; either way, the knowledge
      // counter update happens BEFORE enqueue, so we don't care if the
      // call ultimately rejects — we just need to verify the counter
      // wasn't bumped on Alice's row.
      await reportSessionOutcome
        .handler(
          {
            sessionId: bobSession.id,
            success: true,
            knowledgeUsed: [fix!.alice.knowledgeId],
          },
          bobAuth(),
        )
        .catch(() => {
          /* enqueue path is best-effort here; tested separately */
        });
      const after = await db.knowledge.findUnique({
        where: { id: fix!.alice.knowledgeId },
        select: { successCount: true },
      });
      expect(after?.successCount).toBe(before?.successCount);
    } finally {
      await db.session.deleteMany({ where: { id: bobSession.id } }).catch(() => {});
    }
  });

  it("brain_start_session rejects unscoped-token call with foreign projectId (FORBIDDEN_PROJECT)", async () => {
    await expect(
      startSession.handler(
        { clientType: "custom", projectId: fix!.alice.projectId },
        bobAuth(),
      ),
    ).rejects.toBeInstanceOf(BrainError);
  });

  // ── Read-path scope enforcement (P2-H2) ────────────────────────────────
  //
  // The write tools above have rejected a foreign projectId since Phase 3c.
  // Every read tool ignored the token's binding entirely until 2026-08-03:
  // `brain_retrieve_knowledge` took the project from CLIENT INPUT and never
  // compared it, so a token labelled "scoped to project X" could read every
  // project its owner had. Not a cross-tenant leak — kra.ts hard-pins
  // ownerUserId — but the scope was a promise only half kept.

  it("brain_retrieve_knowledge rejects a scoped token asking for a foreign project", async () => {
    await expect(
      retrieveKnowledge.handler(
        { prompt: "anything", context: { projectId: fix!.alice.projectId } },
        bobScopedAuth(),
      ),
    ).rejects.toThrow(/FORBIDDEN_PROJECT/);
  });

  it("brain_retrieve_knowledge lets a scoped token PAST the gate for its OWN project", async () => {
    // What's under test is the scope check, not retrieval. CI has no
    // embedding provider, so kra.retrieve throws downstream — asserting the
    // whole call resolves would make this test about the CI environment
    // instead of about the boundary. Assert we get past the gate: whatever
    // happens next, it must not be FORBIDDEN_PROJECT.
    const outcome = await retrieveKnowledge
      .handler(
        { prompt: "anything", context: { projectId: fix!.bob.projectId } },
        bobScopedAuth(),
      )
      .then(() => null)
      .catch((e: unknown) => e);
    if (outcome !== null) {
      expect(String(outcome)).not.toMatch(/FORBIDDEN_PROJECT/);
    }
  });

  // These two need a SECOND project owned by Bob. Asserting that Bob's scoped
  // token can't see ALICE's session would be vacuous — both queries already
  // filter `userId`, so it could never appear regardless of project scope.
  // The property under test is confinement WITHIN one owner's account, which
  // is exactly what P2-H2 was about, so the fixture has to contain a row that
  // an unscoped token WOULD return.
  it("brain_session_search on a scoped token hides the owner's OTHER project", async () => {
    const other = await ensureNamedProject(db, fix!.bob.userId, `idor-other-${randomBytes(4).toString("hex")}`);
    const otherSession = await db.session.create({
      data: {
        userId: fix!.bob.userId,
        projectId: other.projectId,
        clientType: "custom",
        metadata: { prompt: "zzscopeprobe distinctive haystack token" },
      },
      select: { id: true },
    });
    try {
      const unscoped = (await sessionSearch.handler(
        { query: "zzscopeprobe" },
        bobAuth(),
      )) as { sessions: Array<{ id: string }> };
      // Control: without scope the row IS reachable. If this fails the test
      // below proves nothing.
      expect(unscoped.sessions.map((r) => r.id)).toContain(otherSession.id);

      const scoped = (await sessionSearch.handler(
        { query: "zzscopeprobe" },
        bobScopedAuth(),
      )) as { sessions: Array<{ id: string }> };
      expect(scoped.sessions.map((r) => r.id)).not.toContain(otherSession.id);
    } finally {
      await db.session.deleteMany({ where: { id: otherSession.id } }).catch(() => {});
    }
  });

  it("brain://user/recent-sessions on a scoped token hides the owner's OTHER project", async () => {
    const other = await ensureNamedProject(db, fix!.bob.userId, `idor-res-${randomBytes(4).toString("hex")}`);
    const otherSession = await db.session.create({
      data: { userId: fix!.bob.userId, projectId: other.projectId, clientType: "custom" },
      select: { id: true },
    });
    try {
      const unscoped = (await readResource(
        "brain://user/recent-sessions",
        bobAuth(),
      )) as { contents: Array<{ text: string }> };
      expect(unscoped.contents[0]!.text).toContain(otherSession.id); // control

      const scoped = (await readResource(
        "brain://user/recent-sessions",
        bobScopedAuth(),
      )) as { contents: Array<{ text: string }> };
      expect(scoped.contents[0]!.text).not.toContain(otherSession.id);
    } finally {
      await db.session.deleteMany({ where: { id: otherSession.id } }).catch(() => {});
    }
  });

  it("brain_teach_knowledge rejects unscoped-token call with foreign projectId (FORBIDDEN_PROJECT)", async () => {
    await expect(
      teachKnowledge.handler(
        {
          type: "heuristic",
          trigger: "x".repeat(10),
          rule: "y".repeat(15),
          projectId: fix!.alice.projectId,
        },
        bobAuth(),
      ),
    ).rejects.toBeInstanceOf(BrainError);
  });
});
