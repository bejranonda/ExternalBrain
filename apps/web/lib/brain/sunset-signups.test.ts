/**
 * A closing instance takes no new accounts (docs/SUNSET.md) — by any path
 * that creates one. The first version gated four and called that "all";
 * review found a fifth (`/api/onboard/claim`, live on the reference
 * instance). So the list is no longer written down: the sweep below finds
 * every call site that can create a User and requires the gate in it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { db } from "@brain/db";
import * as authModule from "@/auth";

vi.mock("./email-ownership", async (orig) => ({
  ...(await orig<typeof import("./email-ownership")>()),
  githubVerifiedPrimaryEmail: async () => github.email,
}));
const github = vi.hoisted(() => ({ email: "" }));

const close = () => vi.stubEnv("SERVICE_SUNSET_AT", "2026-12-14T12:00:00Z");
afterEach(() => vi.unstubAllEnvs());

const WEB = join(__dirname, "..", "..");
function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (["node_modules", ".next", "e2e", "generated"].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}
// Where a User row is born, and why each exemption is not a signup.
const EXEMPT: Record<string, string> = {
  "lib/brain/vouchers.ts": "defines claimVoucher; every caller is swept instead",
  "auth.ts": "the operator's own ADMIN_USERNAME login — not a signup",
};

describe("every account-creating call site checks signupsClosed()", () => {
  it("sweep", () => {
    const sites = sources(WEB)
      .map((f) => ({ f: relative(WEB, f), src: readFileSync(f, "utf8") }))
      .filter(({ src }) => /\.user\.create\(|claimVoucher\(\{/.test(src));
    expect(sites.length).toBeGreaterThanOrEqual(5);
    const ungated = sites.filter(({ f, src }) => !(f in EXEMPT) && !src.includes("signupsClosed()")).map(({ f }) => f);
    expect(ungated, "creates a User without the sunset gate").toEqual([]);
  });
});

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
  it("POST /api/onboard/claim → 403 service_closing (agentic onboarding on)", async () => {
    close();
    vi.stubEnv("AGENTIC_ONBOARDING", "true");
    const { POST } = await import("@/app/api/onboard/claim/route");
    const res = await POST(
      new Request("http://localhost/api/onboard/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voucher: "ANY", email: "agent@test.local" }),
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
