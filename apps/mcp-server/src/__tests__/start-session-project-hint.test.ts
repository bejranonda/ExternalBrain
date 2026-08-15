/**
 * brain_start_session project visibility + fallback hint (docs: AGENTS.md
 * "Working with the Brain" / plan token-install-breezy-backus).
 *
 * Pins two CI-provable properties:
 * (1) A brand-new user with no explicit projectId/projectName lands on a
 *     lazily-created "Default" project, and the response carries
 *     `project.source === "default_created"` plus a `hint` steering them
 *     toward brain_create_project / projectName.
 * (2) An explicit `projectName` resolves without a hint — `project.source`
 *     is "explicit" and `hint` is absent.
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

guard("brain_start_session project visibility + hint", () => {
  const created = { userIds: [] as string[], sessionIds: [] as string[] };

  afterAll(async () => {
    for (const sid of created.sessionIds) {
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
      data: { email: `start-hint-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    created.userIds.push(u.id);
    return u.id;
  }

  const authFor = (userId: string) =>
    ({ userId, projectId: null, tokenId: null }) as unknown as Parameters<
      typeof startSession.handler
    >[1];

  it("no projectId/projectName → falls back to Default, project.source + hint present", async () => {
    const userId = await mintUser();
    const res = (await startSession.handler(
      { clientType: "claude_code" },
      authFor(userId),
    )) as {
      sessionId: string;
      project?: { id: string; name: string; source: string };
      hint?: string;
    };
    created.sessionIds.push(res.sessionId);

    expect(res.project?.source).toBe("default_created");
    expect(res.project?.name).toBe("Default");
    expect(res.hint).toMatch(/brain_create_project|projectName/);
  });

  it("one real project, no projectName → falls back but does NOT nag", async () => {
    // The anti-nag rule: a solo user whose single project is their own named
    // one isn't making a mistake by omitting projectName. Hinting on every
    // session would train them to ignore the field entirely.
    const userId = await mintUser();
    const first = (await startSession.handler(
      { clientType: "claude_code", projectName: `solo-${randomBytes(4).toString("hex")}` },
      authFor(userId),
    )) as { sessionId: string };
    created.sessionIds.push(first.sessionId);

    const second = (await startSession.handler(
      { clientType: "claude_code" },
      authFor(userId),
    )) as {
      sessionId: string;
      project?: { name: string; source: string };
      hint?: string;
    };
    created.sessionIds.push(second.sessionId);

    expect(second.project?.source).toBe("first_project_fallback");
    expect(second.hint).toBeUndefined();
  });

  it("explicit projectName → resolves without a fallback hint", async () => {
    const userId = await mintUser();
    const res = (await startSession.handler(
      { clientType: "claude_code", projectName: `real-project-${randomBytes(4).toString("hex")}` },
      authFor(userId),
    )) as {
      sessionId: string;
      project?: { id: string; name: string; source: string };
      hint?: string;
    };
    created.sessionIds.push(res.sessionId);

    expect(res.project?.source).toBe("explicit");
    expect(res.hint).toBeUndefined();
  });
});
