/**
 * Org members see a teammate's project and sessions — but only the rules they
 * could read anyway. Both surfaces joined SessionKnowledgeApplication →
 * knowledge and returned `ruleText` for every row, so a teammate's private
 * rules leaked to the whole org; and the session-detail org branch filtered
 * OrganizationMember by a field that does not exist (`organizationId`, not
 * `orgId`), so every non-owner got a 500. `tsc` passed both: Prisma's generic
 * args skip excess-property checks on nested `where` (KNOWN_ISSUES §0ay).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import * as authLib from "@/lib/brain/auth";
import { GET as getProject } from "./route.js";
import { GET as getSession } from "../../sessions/[id]/route.js";

const dbReachable = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("project + session detail respect knowledge visibility for teammates", () => {
  const tag = randomBytes(5).toString("hex");
  let ownerId: string, mateId: string, outsiderId: string;
  let orgId: string, projectId: string, sessionId: string;
  let privateId: string, sharedId: string;

  beforeAll(async () => {
    const mk = async (n: string) =>
      (await db.user.create({ data: { email: `vis-${n}-${tag}@test.local` } })).id;
    ownerId = await mk("owner");
    mateId = await mk("mate");
    outsiderId = await mk("outsider");
    orgId = (await db.organization.create({ data: { slug: `vis-${tag}`, name: "Vis org" } })).id;
    await db.organizationMember.createMany({
      data: [
        { orgId, userId: ownerId, role: "owner" },
        { orgId, userId: mateId, role: "member" },
      ],
    });
    projectId = (
      await db.project.create({ data: { organizationId: orgId, name: "Shared", slug: `shared-${tag}` } })
    ).id;
    sessionId = (
      await db.session.create({ data: { userId: ownerId, projectId, clientType: "custom" } })
    ).id;
    const rule = (visibility: string, text: string) =>
      db.knowledge.create({
        data: {
          type: "reflex",
          triggerText: `t-${text}`,
          ruleText: text,
          ownerUserId: ownerId,
          ownerProjectId: projectId,
          visibility,
        },
      });
    privateId = (await rule("private", "OWNER-PRIVATE-RULE")).id;
    sharedId = (await rule("project", "PROJECT-SHARED-RULE")).id;
    await db.sessionKnowledgeApplication.createMany({
      data: [
        { sessionId, knowledgeId: privateId, role: "injected" },
        { sessionId, knowledgeId: sharedId, role: "injected" },
      ],
    });
  });

  afterAll(async () => {
    await db.sessionKnowledgeApplication.deleteMany({ where: { sessionId } }).catch(() => {});
    await db.knowledge.deleteMany({ where: { id: { in: [privateId, sharedId] } } }).catch(() => {});
    await db.session.deleteMany({ where: { id: sessionId } }).catch(() => {});
    await db.project.deleteMany({ where: { id: projectId } }).catch(() => {});
    await db.organization.deleteMany({ where: { id: orgId } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: [ownerId, mateId, outsiderId] } } }).catch(() => {});
    vi.restoreAllMocks();
    await db.$disconnect().catch(() => {});
  });

  const as = (uid: string) => vi.spyOn(authLib, "getCurrentUserId").mockResolvedValue(uid);
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const rules = (body: { injected: Array<{ ruleText: string }> }) =>
    body.injected.map((k) => k.ruleText).sort();

  it("a teammate's project view omits the owner's private rule", async () => {
    as(mateId);
    const res = await getProject(new Request("http://t/api/projects/x"), params(projectId));
    expect(res.status).toBe(200);
    expect(rules(await res.json())).toEqual(["PROJECT-SHARED-RULE"]);
  });

  it("the owner's project view still shows both", async () => {
    as(ownerId);
    const res = await getProject(new Request("http://t/api/projects/x"), params(projectId));
    expect(rules(await res.json())).toEqual(["OWNER-PRIVATE-RULE", "PROJECT-SHARED-RULE"]);
  });

  it("a teammate can open the session (was a 500) and sees only readable rules", async () => {
    as(mateId);
    const res = await getSession(new Request("http://t/api/sessions/x"), params(sessionId));
    expect(res.status).toBe(200);
    expect(rules(await res.json())).toEqual(["PROJECT-SHARED-RULE"]);
  });

  it("the session owner sees every rule their session touched", async () => {
    as(ownerId);
    const res = await getSession(new Request("http://t/api/sessions/x"), params(sessionId));
    expect(rules(await res.json())).toEqual(["OWNER-PRIVATE-RULE", "PROJECT-SHARED-RULE"]);
  });

  it("a non-member gets 403 on both, not 500", async () => {
    as(outsiderId);
    expect((await getProject(new Request("http://t/api/projects/x"), params(projectId))).status).toBe(403);
    expect((await getSession(new Request("http://t/api/sessions/x"), params(sessionId))).status).toBe(403);
  });
});
