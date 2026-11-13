/**
 * Your data, out and back in (docs/SUNSET.md): the user's own export is the
 * operator's GDPR bundle, and importing it into another account restores the
 * rules — once, however many times the file is imported.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { ensureNamedProject } from "@brain/core";
import * as authLib from "@/lib/brain/auth";
import { buildUserDataBundle, importUserData, renderKnowledgeMarkdown, EXPORT_FORMAT } from "./user-data";

const dbReachable = await db.user.count().then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("user data export → import", () => {
  const tag = randomBytes(5).toString("hex");
  let from: string;
  let to: string;

  beforeAll(async () => {
    from = (await db.user.create({ data: { email: `from-${tag}@test.local` } })).id;
    to = (await db.user.create({ data: { email: `to-${tag}@test.local` } })).id;
    const { projectId } = await ensureNamedProject(db, from, `Alpha ${tag}`);
    const base = { ownerUserId: from, ownerProjectId: projectId, extractedBy: "user" };
    await db.knowledge.createMany({
      data: [
        { ...base, type: "principle", scope: "project", triggerText: "when deploying", ruleText: "take a dump first", rationale: "rollback", confidence: 0.9, tags: ["decision"] },
        { ...base, type: "anti_principle", triggerText: "when testing", ruleText: "do not hit prod", instead: "use the scratch DB", failureCount: 2, successCount: 5 },
        { ...base, type: "reflex", triggerText: "retired rule", ruleText: "gone", deletedAt: new Date() },
        { ...base, type: "action_item", triggerText: "meeting to-do", ruleText: "call Bob" },
      ],
    });
    await db.mCPToken.create({ data: { userId: from, name: "t", tokenHash: `hash-${tag}`, scope: "personal" } });
  });
  afterAll(async () => {
    const users = [from, to].filter(Boolean);
    const orgs = await db.organizationMember.findMany({ where: { userId: { in: users } }, select: { orgId: true } });
    const orgIds = orgs.map((o) => o.orgId);
    await db.knowledge.deleteMany({ where: { ownerUserId: { in: users } } });
    await db.mCPToken.deleteMany({ where: { userId: { in: users } } });
    await db.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
  });

  it("the bundle is complete, marked, and carries no secret material", async () => {
    const b = (await buildUserDataBundle(from))!;
    expect(b.format).toBe(EXPORT_FORMAT);
    expect(b.knowledge).toHaveLength(4);
    expect(b.projects.map((p) => p.name)).toEqual([`Alpha ${tag}`]);
    const raw = JSON.stringify(b);
    expect(raw).not.toContain(`hash-${tag}`);
    expect(raw).not.toContain("embedding\"");
  });

  it("Markdown lists the live rules by project and leaves retired ones out", async () => {
    const md = renderKnowledgeMarkdown((await buildUserDataBundle(from))!);
    expect(md).toContain(`## Alpha ${tag}`);
    expect(md).toContain("- **When** when deploying: take a dump first");
    expect(md).toContain("  - Why: rollback");
    expect(md).toContain("- **Avoid** when testing: do not hit prod");
    expect(md).toContain("  - Instead: use the scratch DB");
    expect(md).not.toContain("gone");
  });

  it("imports the live rules into a project of the same name, and only once", async () => {
    const file = JSON.parse(JSON.stringify(await buildUserDataBundle(from)));
    const first = await importUserData(to, file);
    expect(first).toMatchObject({ ok: true, imported: 2, duplicates: 0, skipped: 2 });
    const rows = await db.knowledge.findMany({ where: { ownerUserId: to }, include: { project: true } });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.project?.name).toBe(`Alpha ${tag}`);
      expect(r.extractedBy).toBe("imported");
      expect(r.tags).toContain("imported");
      expect(r.visibility).toBe("project");
    }
    const anti = rows.find((r) => r.type === "anti_principle")!;
    expect([anti.failureCount, anti.successCount, anti.instead]).toEqual([2, 5, "use the scratch DB"]);
    expect(await importUserData(to, file)).toMatchObject({ ok: true, imported: 0, duplicates: 2 });
  });

  it("refuses anything that is not an export", async () => {
    expect(await importUserData(to, { hello: "world" })).toEqual({ ok: false, error: "invalid_export" });
    expect(await importUserData(to, { format: "something-else", knowledge: [] })).toEqual({ ok: false, error: "invalid_export" });
  });

  it("GET /api/me/export serves the caller's own data as a download", async () => {
    vi.spyOn(authLib, "getCurrentUserId").mockResolvedValue(from);
    const { GET } = await import("@/app/api/me/export/route");
    const md = await GET(new Request("http://localhost/api/me/export?format=md"));
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(md.headers.get("content-disposition")).toMatch(/attachment; filename="external-brain-\d{4}-\d{2}-\d{2}\.md"/);
    const json = await GET(new Request("http://localhost/api/me/export"));
    const body = (await json.json()) as { user: { id: string } };
    expect(body.user.id).toBe(from);
  });

  it("POST /api/me/import rejects a non-JSON body", async () => {
    vi.spyOn(authLib, "getCurrentUserId").mockResolvedValue(to);
    const { POST } = await import("@/app/api/me/import/route");
    const res = await POST(new Request("http://localhost/api/me/import", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_export" });
  });
});
