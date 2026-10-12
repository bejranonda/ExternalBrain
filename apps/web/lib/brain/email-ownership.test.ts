/**
 * Pre-account takeover (KNOWN_ISSUES §0az). Every signup path stores the email
 * it was given without proving it, and GitHub sign-in adopted any row with a
 * matching email — so whoever registered an address first owned the account
 * its real owner later signed into, with a password, MCP tokens and sessions
 * still in hand. The suite walks the attack end to end.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { hashSecret } from "@brain/core/secret-hash";

const github = vi.hoisted(() => ({ verified: null as string | null }));
vi.mock("./email-ownership", async (orig) => ({
  ...(await orig<typeof import("./email-ownership")>()),
  githubVerifiedPrimaryEmail: async () => github.verified,
}));

const { githubVerifiedPrimaryEmail, proveEmailOwnership, sessionStillValid } =
  await vi.importActual<typeof import("./email-ownership")>("./email-ownership");

describe("githubVerifiedPrimaryEmail", () => {
  const fake = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("returns the primary address when GitHub verified it", async () => {
    const f = fake(200, [
      { email: "Alt@x.dev", primary: false, verified: true },
      { email: "Me@X.dev", primary: true, verified: true },
    ]);
    expect(await githubVerifiedPrimaryEmail("t", f)).toBe("me@x.dev");
  });
  it("refuses an unverified primary even when a secondary is verified", async () => {
    const f = fake(200, [
      { email: "victim@x.dev", primary: true, verified: false },
      { email: "me@x.dev", primary: false, verified: true },
    ]);
    expect(await githubVerifiedPrimaryEmail("t", f)).toBeNull();
  });
  it("fails closed on an API error or a malformed body", async () => {
    expect(await githubVerifiedPrimaryEmail("t", fake(401, { message: "Bad" }))).toBeNull();
    expect(await githubVerifiedPrimaryEmail("t", fake(200, { not: "an array" }))).toBeNull();
    const boom = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await githubVerifiedPrimaryEmail("t", boom)).toBeNull();
  });
});

const dbReachable = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("pre-account takeover, end to end", () => {
  const tag = randomBytes(5).toString("hex");
  const victimEmail = `victim-${tag}@test.local`;
  let squatId: string;
  let plantedTokenId: string;
  let signIn: typeof import("./auth-callbacks").signInCallback;
  let jwtCb: typeof import("./auth-callbacks").jwtCallback;

  const callSignIn = (email: string) =>
    signIn({
      user: { email, name: "GitHub Name" },
      account: { provider: "github", type: "oauth", providerAccountId: "1", access_token: "gh" },
    } as Parameters<typeof signIn>[0]);

  beforeAll(async () => {
    vi.stubEnv("REGISTRATION_REQUIRES_VOUCHER", "false");
    ({ signInCallback: signIn, jwtCallback: jwtCb } = await import("./auth-callbacks"));

    // The attacker registers the victim's address first (any signup path:
    // none proves the email) and mints an MCP token on it.
    squatId = (await db.user.create({ data: { email: victimEmail } })).id;
    plantedTokenId = (
      await db.mCPToken.create({
        data: { userId: squatId, name: "planted", tokenHash: `h-${tag}`, scope: "personal" },
      })
    ).id;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.mCPToken.deleteMany({ where: { userId: squatId } });
    await db.passwordResetToken.deleteMany({ where: { userId: squatId } });
    await db.userCredential.deleteMany({ where: { userId: squatId } });
    await db.user.deleteMany({ where: { email: { contains: tag } } });
  });

  it("a password login still passes — NextAuth runs signIn for credentials too", async () => {
    // Regression: the GitHub gates once applied to every provider, which
    // refused every password sign-in (caught in pre-deploy browser testing).
    github.verified = null;
    const user = { email: victimEmail, id: squatId };
    const out = await signIn({
      user,
      account: { provider: "admin-credentials", type: "credentials", providerAccountId: squatId },
    } as Parameters<typeof signIn>[0]);
    expect(out).toBe(true);
    expect(user.id).toBe(squatId);
    const row = await db.user.findUniqueOrThrow({ where: { id: squatId } });
    expect(row.emailVerifiedAt).toBeNull(); // a password proves nothing about the inbox
  });

  it("refuses a GitHub login whose primary email GitHub has not verified", async () => {
    github.verified = null;
    expect(await callSignIn(victimEmail)).toBe("/signin?error=github_email_unverified");
  });

  it("does NOT hand the victim's GitHub login the attacker's pre-registered row", async () => {
    github.verified = victimEmail;
    expect(await callSignIn(victimEmail)).toBe("/signin?error=account_email_unverified");
    const row = await db.user.findUniqueOrThrow({ where: { id: squatId } });
    expect(row.emailVerifiedAt).toBeNull();
  });

  it("the attacker's session is live before the victim proves the inbox", async () => {
    const token = await jwtCb({ token: {}, user: { id: squatId } } as Parameters<typeof jwtCb>[0]);
    expect(token).not.toBeNull();
    const refreshed = await jwtCb({ token: token! } as Parameters<typeof jwtCb>[0]);
    expect(refreshed).not.toBeNull();
  });

  it("the victim's reset (first proof) evicts the attacker: token revoked, session dead", async () => {
    const attackerSession = await jwtCb({
      token: {},
      user: { id: squatId },
    } as Parameters<typeof jwtCb>[0]);
    await new Promise((r) => setTimeout(r, 5));

    const raw = randomBytes(16).toString("hex");
    await db.passwordResetToken.create({
      data: { userId: squatId, tokenHash: hashSecret(raw), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    const { POST } = await import("@/app/api/auth/reset-password/route");
    const res = await POST(
      new Request("http://local/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: raw, newPassword: "victim-owns-it-now" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, tokensRevoked: 1 });

    const planted = await db.mCPToken.findUniqueOrThrow({ where: { id: plantedTokenId } });
    expect(planted.revokedAt).not.toBeNull();
    expect(await jwtCb({ token: attackerSession! } as Parameters<typeof jwtCb>[0])).toBeNull();
    const row = await db.user.findUniqueOrThrow({ where: { id: squatId } });
    expect(row.emailVerifiedAt).not.toBeNull();
  });

  it("after the proof, GitHub sign-in links to the now-owned account", async () => {
    github.verified = victimEmail;
    const user = { email: victimEmail, name: "GitHub Name", id: "" };
    const out = await signIn({
      user,
      account: { provider: "github", type: "oauth", providerAccountId: "1", access_token: "gh" },
    } as Parameters<typeof signIn>[0]);
    expect(out).toBe(true);
    expect(user.id).toBe(squatId);
  });

  it("a later reset on a verified account keeps the owner's tokens", async () => {
    const keep = await db.mCPToken.create({
      data: { userId: squatId, name: "owner agent", tokenHash: `k-${tag}`, scope: "personal" },
    });
    const proof = await proveEmailOwnership(db, squatId);
    expect(proof).toEqual({ firstProof: false, tokensRevoked: 0 });
    expect((await db.mCPToken.findUniqueOrThrow({ where: { id: keep.id } })).revokedAt).toBeNull();
  });

  it("a brand-new GitHub user is created already verified", async () => {
    const email = `fresh-${tag}@test.local`;
    github.verified = email;
    expect(await callSignIn(email)).toBe(true);
    const row = await db.user.findUniqueOrThrow({ where: { email } });
    expect(row.emailVerifiedAt).not.toBeNull();
  });

  it("sessionStillValid: unknown user has none; no revocation means valid", async () => {
    expect(await sessionStillValid(`missing-${tag}`, Date.now())).toBe(false);
    const u = await db.user.create({ data: { email: `plain-${tag}@test.local` } });
    expect(await sessionStillValid(u.id, 0)).toBe(true);
  });
});

guard("invite signup does not grant an org to an unproven account", () => {
  const tag = randomBytes(5).toString("hex");
  const email = `invitee-${tag}@test.local`;
  let orgId: string, inviteId: string, raw: string;

  beforeAll(async () => {
    await db.user.create({ data: { email } }); // pre-registered by someone else
    const inviter = await db.user.create({ data: { email: `inviter-${tag}@test.local` } });
    orgId = (await db.organization.create({ data: { slug: `inv-${tag}`, name: "Inv" } })).id;
    raw = randomBytes(16).toString("hex");
    inviteId = (
      await db.organizationInvite.create({
        data: {
          orgId,
          email,
          role: "member",
          invitedById: inviter.id,
          tokenHash: hashSecret(raw),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await db.organizationInvite.deleteMany({ where: { orgId } });
    await db.organizationMember.deleteMany({ where: { orgId } });
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { email: { contains: tag } } });
  });

  it("refuses with invite_account_unverified and leaves the invite unused", async () => {
    const { POST } = await import("@/app/api/invites/signup/route");
    const res = await POST(
      new Request("http://local/api/invites/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: raw, name: "Invitee", password: "whatever-123" }),
      }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "invite_account_unverified" });
    expect(await db.organizationMember.count({ where: { orgId } })).toBe(0);
    const invite = await db.organizationInvite.findUniqueOrThrow({ where: { id: inviteId } });
    expect(invite.acceptedAt).toBeNull();
  });
});
