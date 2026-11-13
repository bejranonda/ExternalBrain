/**
 * A closing instance takes no new accounts (docs/SUNSET.md) — by any of the
 * four paths that create one. Asserted across all of them, since a gate on
 * three of four is a gate that does not hold.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@brain/db";
import * as authModule from "@/auth";

vi.mock("./email-ownership", async (orig) => ({
  ...(await orig<typeof import("./email-ownership")>()),
  githubVerifiedPrimaryEmail: async () => github.email,
}));
const github = vi.hoisted(() => ({ email: "" }));

const close = () => vi.stubEnv("SERVICE_SUNSET_AT", "2026-12-14T12:00:00Z");
afterEach(() => vi.unstubAllEnvs());

describe("registration routes refuse while a sunset is configured", () => {
  it("POST /api/auth/register → 403 service_closing", async () => {
    close();
    vi.mocked(authModule.adminCredentialsConfigured).mockReturnValue(true);
    const { POST } = await import("@/app/api/auth/register/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new@test.local", password: "long-enough-pw", voucher: "X" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "service_closing" });
  });
  it("POST /api/invites/signup → 403 service_closing", async () => {
    close();
    const { POST } = await import("@/app/api/invites/signup/route");
    const res = await POST(new Request("http://localhost/api/invites/signup", { method: "POST", body: "{}" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "service_closing" });
  });
  it("the sign-in page hides the registration form and link while closed", () => {
    const src = readFileSync(join(__dirname, "../../app/signin/page.tsx"), "utf8");
    expect(src).toContain("const closed = signupsClosed();");
    expect(src).toMatch(/showRegisterForm =\s+credentialsAllowed && params\.mode === "register" && !showSignupForm && !closed/);
    expect(src).toContain("{credentialsAllowed && !closed && (");
  });
});

const dbReachable = await db.user.count().then(() => true).catch(() => false);
(dbReachable ? describe : describe.skip)("first GitHub sign-in while closed", () => {
  const tag = randomBytes(5).toString("hex");
  let signIn: typeof import("./auth-callbacks").signInCallback;
  const call = (email: string) =>
    signIn({
      user: { email, name: "N" },
      account: { provider: "github", type: "oauth", providerAccountId: "1", access_token: "gh" },
    } as Parameters<typeof signIn>[0]);

  beforeAll(async () => {
    ({ signInCallback: signIn } = await import("./auth-callbacks"));
  });
  afterAll(async () => {
    const users = await db.user.findMany({ where: { email: { contains: tag } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const orgs = await db.organizationMember.findMany({ where: { userId: { in: ids } }, select: { orgId: true } });
    const orgIds = orgs.map((o) => o.orgId);
    await db.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("a new account is refused even with open registration", async () => {
    close();
    vi.stubEnv("REGISTRATION_REQUIRES_VOUCHER", "false");
    github.email = `new-${tag}@test.local`;
    expect(await call(github.email)).toBe("/signin?error=service_closing");
    expect(await db.user.count({ where: { email: github.email } })).toBe(0);
  });
  it("an existing account still signs in", async () => {
    close();
    github.email = `old-${tag}@test.local`;
    await db.user.create({ data: { email: github.email, emailVerifiedAt: new Date() } });
    expect(await call(github.email)).toBe(true);
  });
  it("the operator listed in ADMIN_EMAILS can still bootstrap in", async () => {
    close();
    github.email = `admin-${tag}@test.local`;
    vi.stubEnv("ADMIN_EMAILS", github.email);
    expect(await call(github.email)).toBe(true);
  });
});
