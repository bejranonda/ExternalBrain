/**
 * Signup confirmation (KNOWN_ISSUES §0bb). With email delivery configured, a
 * self-registered account cannot sign in with its password until the emailed
 * link is used; without it, nothing changes.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "@brain/db";
import { hashSecret } from "@brain/core/secret-hash";
import * as authModule from "@/auth";

const sent = vi.hoisted(() => ({ links: [] as string[] }));
vi.mock("@brain/core", async (orig) => ({
  ...(await orig<typeof import("@brain/core")>()),
  sendEmail: vi.fn(async (args: { text: string }) => {
    const m = args.text.match(/https?:\/\/\S+confirm-email\?token=\S+/);
    if (m) sent.links.push(m[0]);
    return { ok: true, messageId: "test" };
  }),
}));
vi.mock("next/headers", async (orig) => ({
  ...(await orig<typeof import("next/headers")>()),
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}` })),
}));

const { confirmEmailToken, emailConfirmPending } = await import("./email-confirm");
const { POST: register } = await import("@/app/api/auth/register/route");

const withEmail = () => {
  process.env.EMAIL_PROVIDER = "resend";
  process.env.EMAIL_API_KEY = "test-key";
};
const withoutEmail = () => {
  process.env.EMAIL_PROVIDER = "disabled";
  delete process.env.EMAIL_API_KEY;
};

describe("emailConfirmPending", () => {
  afterEach(withoutEmail);
  it("holds only for a flagged, unverified account while email is configured", () => {
    withEmail();
    expect(emailConfirmPending({ emailConfirmRequired: true, emailVerifiedAt: null })).toBe(true);
    expect(emailConfirmPending({ emailConfirmRequired: true, emailVerifiedAt: new Date() })).toBe(false);
    expect(emailConfirmPending({ emailConfirmRequired: false, emailVerifiedAt: null })).toBe(false);
  });
  it("lifts when the operator removes the email provider, so pending accounts are not stranded", () => {
    withoutEmail();
    expect(emailConfirmPending({ emailConfirmRequired: true, emailVerifiedAt: null })).toBe(false);
  });
});

describe("credentials sign-in checks the gate after the password", () => {
  it("auth.ts refuses a pending account only once the password matched", () => {
    const src = readFileSync(join(__dirname, "../../auth.ts"), "utf8");
    const verify = src.indexOf("await verifyUserCredential(db, user.id, password)");
    const gate = src.indexOf("if (emailConfirmPending(user)) throw new EmailUnconfirmed()");
    expect(verify).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(verify);
  });
});

const dbReachable = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("register → confirm, end to end", () => {
  const tag = randomBytes(5).toString("hex");
  const emails: string[] = [];
  const password = randomBytes(12).toString("base64url");

  afterEach(withoutEmail);
  afterAll(async () => {
    const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = users.map((u) => u.id);
    const orgs = await db.organizationMember.findMany({ where: { userId: { in: ids } }, select: { orgId: true } });
    const orgIds = orgs.map((o) => o.orgId);
    await db.project.deleteMany({ where: { organizationId: { in: orgIds } } });
    await db.organizationMember.deleteMany({ where: { orgId: { in: orgIds } } });
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  });

  const signup = async (email: string, voucher?: string) => {
    emails.push(email);
    vi.mocked(authModule.adminCredentialsConfigured).mockReturnValue(true);
    vi.mocked(authModule.registrationRequiresVoucher).mockReturnValue(voucher !== undefined);
    const res = await register(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, ...(voucher ? { voucher } : {}) }),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const tokenOf = (link: string) => new URL(link).searchParams.get("token") ?? "";

  it("with email configured: no sign-in redirect, a link is sent, the account is pending", async () => {
    withEmail();
    sent.links.length = 0;
    const email = `confirm-${tag}@test.local`;
    const { status, body } = await signup(email);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, confirmRequired: true, emailSent: true });
    expect(body.redirectTo).toBeUndefined();
    expect(sent.links).toHaveLength(1);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailConfirmRequired).toBe(true);
    expect(emailConfirmPending(user)).toBe(true);
    // Only the hash is stored.
    const raw = tokenOf(sent.links[0]!);
    expect(await db.emailConfirmToken.count({ where: { tokenHash: raw } })).toBe(0);
    expect(await db.emailConfirmToken.count({ where: { tokenHash: hashSecret(raw) } })).toBe(1);
  });

  it("the link confirms once: the address is proven and the gate lifts", async () => {
    withEmail();
    const email = `confirm-${tag}@test.local`;
    const raw = tokenOf(sent.links[0]!);
    // Two clicks racing: exactly one wins.
    const [a, b] = await Promise.all([confirmEmailToken(raw), confirmEmailToken(raw)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.emailConfirmRequired).toBe(false);
    expect(emailConfirmPending(user)).toBe(false);
    expect(await confirmEmailToken(raw)).toEqual({ ok: false, error: "invalid_token" });
  });

  it("an expired or unknown link is refused and proves nothing", async () => {
    withEmail();
    sent.links.length = 0;
    const email = `expired-${tag}@test.local`;
    await signup(email);
    const raw = tokenOf(sent.links[0]!);
    await db.emailConfirmToken.updateMany({
      where: { tokenHash: hashSecret(raw) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await confirmEmailToken(raw)).toEqual({ ok: false, error: "expired_token" });
    expect(await confirmEmailToken("not-a-real-token")).toEqual({ ok: false, error: "invalid_token" });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(emailConfirmPending(user)).toBe(true);
  });

  it("the voucher path is gated the same way", async () => {
    withEmail();
    sent.links.length = 0;
    const code = `CONF${tag}`.toUpperCase();
    await db.voucherCode.create({ data: { code, kind: "personal", maxUses: 1 } });
    try {
      const email = `voucher-${tag}@test.local`;
      const { status, body } = await signup(email, code);
      expect(status).toBe(200);
      expect(body).toMatchObject({ confirmRequired: true });
      expect(sent.links).toHaveLength(1);
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      expect(emailConfirmPending(user)).toBe(true);
    } finally {
      await db.voucherCode.deleteMany({ where: { code } });
    }
  });

  it("without email configured: registration signs straight in, as before", async () => {
    withoutEmail();
    const email = `open-${tag}@test.local`;
    const { status, body } = await signup(email);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, redirectTo: "/" });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailConfirmRequired).toBe(false);
  });
});
