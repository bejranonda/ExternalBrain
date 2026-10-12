/**
 * NextAuth `signIn` / `jwt` callbacks, kept apart from `auth.ts` so they can be
 * tested: `auth.ts` calls `NextAuth()` at module scope, which cannot load under
 * vitest, so every test mocks it — and the account-linking logic inside went
 * untested, which is how pre-account takeover shipped (KNOWN_ISSUES §0az).
 */
import type { NextAuthConfig } from "next-auth";
import { cookies } from "next/headers";
import { envFlag } from "@brain/core/env";

type Callbacks = Required<NonNullable<NextAuthConfig["callbacks"]>>;

function parseAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS || "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

export function registrationRequiresVoucher(): boolean {
  // Default true — a secure-by-default posture for a multi-tenant platform.
  // Governs BOTH the GitHub-OAuth signup path (signIn callback below) and the
  // email+password self-service registration endpoint (/api/auth/register), so
  // the operator has a single knob for "is open signup allowed here".
  //
  // `envFlag` rather than a local comparison: this flag is ALSO declared
  // `boolish(true)` in the core env schema, and two parsers for one flag
  // disagree eventually. It also makes a typo (`falsch`) keep the safe default
  // instead of silently opening public signup.
  return envFlag("REGISTRATION_REQUIRES_VOUCHER", true);
}

export const signInCallback: Callbacks["signIn"] = async ({ user, account }) => {
  if (!user.email) return false;
  const email = user.email.toLowerCase();
  const { db } = await import("@brain/db");
  const { githubVerifiedPrimaryEmail } = await import("./email-ownership");

  // NextAuth runs this callback for EVERY provider, credentials included —
  // `authorize` has already resolved that login to its own row, so only the
  // GitHub path decides account ownership by email. (An older comment in
  // auth.ts said credentials skip this callback; gating everything on GitHub
  // inputs locked every password login out in pre-deploy testing.)
  const isGithub = account?.provider === "github";

  // GitHub's email is the account key, so it must be one GitHub has
  // verified — otherwise a GitHub user could claim any address by adding it
  // unverified.
  if (isGithub) {
    const verified = account.access_token
      ? await githubVerifiedPrimaryEmail(account.access_token)
      : null;
    if (verified !== email) return "/signin?error=github_email_unverified";
  }

  const existing = await db.user.findUnique({ where: { email } });
  const adminEmails = parseAdminEmails();
  const shouldBeAdmin = adminEmails.has(email);

  // An existing row whose email was never proven may have been registered
  // by someone else in advance (pre-account takeover, §0az). Adopting it
  // would hand the real owner an account a stranger still holds a
  // password, tokens and sessions for. They prove the inbox first via
  // forgot-password, which evicts all of that; then GitHub links.
  if (isGithub && existing && existing.emailVerifiedAt === null) {
    return "/signin?error=account_email_unverified";
  }

  if (existing) {
    // Existing user — refresh profile + promote to admin if their email
    // is now in ADMIN_EMAILS and they weren't already. NEVER demote via
    // this path; demotion requires explicit admin action in the admin UI.
    const patch: Record<string, unknown> = {};
    if (user.name) patch["name"] = user.name;
    if (user.image) patch["image"] = user.image;
    if (shouldBeAdmin && existing.role !== "admin") patch["role"] = "admin";
    if (Object.keys(patch).length > 0) {
      await db.user.update({ where: { id: existing.id }, data: patch });
    }
    user.id = existing.id;
    // Eagerly ensure the personal org + default project exist for this
    // user. Both helpers are idempotent — safe on every sign-in. We do
    // this here (rather than lazily in getActiveProject) so that the
    // first-run defaults are ready before the user lands on the dashboard.
    try {
      const { ensurePersonalOrg, ensureDefaultProject } = await import("@brain/core");
      await ensurePersonalOrg(db, existing.id);
      await ensureDefaultProject(db, existing.id);
    } catch (e) {
      // Never fail sign-in for a bootstrap error — log and continue.
      console.error("[auth] ensurePersonalOrg/ensureDefaultProject failed:", e);
    }
    return true;
  }

  // New user — enforce voucher gate unless the first admin is signing in.
  // First admin is special: an operator listed in ADMIN_EMAILS can always
  // bootstrap themselves in without a voucher (otherwise chicken-and-egg).
  if (registrationRequiresVoucher() && !shouldBeAdmin) {
    const cookieStore = await cookies();
    const voucherCode = cookieStore.get("bp_voucher")?.value?.trim();
    if (!voucherCode) {
      // Redirect back to /signin with an error. NextAuth's signIn return
      // "false" produces a generic error; we use the errorPage query param
      // to surface a specific message.
      return "/signin?error=voucher_required";
    }

    // Validate + reserve the voucher. `claimVoucher()` is atomic: it
    // checks validity, increments usedCount, creates the VoucherRedemption
    // row, and returns the User it created. Failure returns an explicit
    // reason so the signin page can show it.
    const { claimVoucher } = await import("@/lib/brain/vouchers");
    const result = await claimVoucher({
      code: voucherCode,
      email,
      name: user.name ?? null,
      image: user.image ?? null,
      ...(isGithub ? ({ emailVerified: true } as const) : {}),
      ...(shouldBeAdmin ? ({ roleIfAdmin: "admin" } as const) : {}),
    });
    if (!result.ok) {
      return `/signin?error=voucher_${result.reason}`;
    }
    user.id = result.userId;
    return true;
  }

  // Either voucher gate is off, or this is an operator-bootstrap signin.
  const created = await db.user.create({
    data: {
      email,
      name: user.name ?? null,
      image: user.image ?? null,
      role: shouldBeAdmin ? "admin" : "user",
      ...(isGithub ? { emailVerifiedAt: new Date() } : {}),
    },
  });
  user.id = created.id;
  // Bootstrap the personal org + default project for the brand-new user.
  try {
    const { ensurePersonalOrg, ensureDefaultProject } = await import("@brain/core");
    await ensurePersonalOrg(db, created.id);
    await ensureDefaultProject(db, created.id);
  } catch (e) {
    console.error("[auth] ensurePersonalOrg/ensureDefaultProject failed for new user:", e);
  }
  return true;
};

export const jwtCallback: Callbacks["jwt"] = async ({ token, user }) => {
  if (user?.id) {
    token.userId = user.id;
    // `iat` is re-stamped on every refresh, so it cannot say when the
    // person actually signed in; this claim survives refreshes.
    token.authAt = Date.now();
    return token;
  }
  if (typeof token.userId === "string") {
    const { sessionStillValid } = await import("./email-ownership");
    const authAt =
      typeof token.authAt === "number" ? token.authAt : (token.iat ?? 0) * 1000;
    // null clears the session cookie — a password reset (or first proof of
    // the email) signs out every session that predates it.
    if (!(await sessionStillValid(token.userId, authAt))) return null;
  }
  return token;
};
