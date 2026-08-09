/**
 * NextAuth v5 — secure-by-default auth.
 *
 * Four mutually exclusive modes, detected at runtime:
 *
 * 1. **Credentials mode (current pilot default):** `ADMIN_USERNAME` +
 *    `ADMIN_PASSWORD_HASH` set. A single admin account logs in with
 *    username + bcrypt-hashed password; all endpoints that require auth
 *    accept that session. This is the phase-1 pilot posture — one
 *    operator, one account, no OAuth App required.
 *
 * 2. **OAuth mode (future pilot invitees):** `AUTH_GITHUB_ID` +
 *    `AUTH_GITHUB_SECRET` + `AUTH_SECRET` are all set. Users sign in
 *    with GitHub. Coexists with mode 1 — both providers render on
 *    `/signin` if both are configured.
 *
 * 3. **Dev-shim mode (explicit opt-in):** `ALLOW_DEV_AUTH=true` is set AND
 *    none of the above. `getCurrentUserId()` returns the `DEV_USER_ID`
 *    env or the first User row. Intended for local development only.
 *    Further guarded against `NODE_ENV=production` (see
 *    `refuseDevShimInProduction()`).
 *
 * 4. **Unconfigured:** none of the above. Every authenticated request
 *    throws `auth_not_configured`. A deployment in this state is
 *    effectively a locked door — the operator has to pick a mode before
 *    any user can reach the app. This is the secure default.
 *
 * The OAuth signIn callback also handles:
 *   - First-time admin bootstrap via `ADMIN_EMAILS` (comma-separated).
 *   - Voucher-code gating for new registrations when
 *     `REGISTRATION_REQUIRES_VOUCHER=true`. A pending voucher code is read
 *     from the `bp_voucher` cookie (set by /signin before the OAuth hop).
 * The Credentials provider doesn't use the signIn callback — it does its
 * own User lookup/create inside `authorize`.
 */
import NextAuth, { type NextAuthConfig, type Session, type User } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { cookies } from "next/headers";
import { envFlag } from "@brain/core/env";
import {
  adminCredentialsConfigured,
  verifyAdminCredentials,
} from "./lib/brain/admin-credentials";

// Prisma is imported lazily inside callbacks — see the top-of-file comment
// in the previous version; same rationale. Next's page-data collection
// evaluates this file server-side and eager PrismaClient init trips on slim
// base images.

/**
 * True when all three GitHub OAuth envs are set.
 *
 * Historical note: this function's name means "GitHub OAuth is configured"
 * specifically. Code paths that need "any sign-in path exists" should use
 * `anySignInConfigured()` below — that's the check that gates rendering
 * of the /signin UI and the pass-through in `getCurrentUserId()`.
 */
export function authConfigured(): boolean {
  return !!(
    process.env.AUTH_GITHUB_ID &&
    process.env.AUTH_GITHUB_SECRET &&
    process.env.AUTH_SECRET
  );
}

/**
 * True when EITHER Credentials OR GitHub OAuth is configured and usable.
 * Used by `getCurrentUserId()` to decide whether to require a real session
 * (and by /signin to decide whether to show any sign-in UI at all).
 */
export function anySignInConfigured(): boolean {
  return adminCredentialsConfigured() || authConfigured();
}

/** Re-export so callers don't have to reach into the helper module. */
export { adminCredentialsConfigured };

/** True when the operator has explicitly opted into the dev-shim path. */
export function devAuthAllowed(): boolean {
  return envFlag("ALLOW_DEV_AUTH", false);
}

/**
 * Compat alias for older call sites. `authEnabled()` == "there is SOME way
 * for a request to be authenticated" — Credentials OR OAuth OR the dev shim.
 */
export function authEnabled(): boolean {
  return anySignInConfigured() || devAuthAllowed();
}

function parseAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
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

const providers: NextAuthConfig["providers"] = [
  // Credentials provider — primary sign-in path for the phase-1 pilot.
  // `authorize` does the bcrypt verify AND the lookup-or-create of the
  // matching `User` row so the rest of the app (role gates, MCPToken
  // issuance, audit log) sees a stable User.id. We don't route through
  // the OAuth `signIn` callback — that path is GitHub-only.
  ...(adminCredentialsConfigured()
    ? [
        CredentialsProvider({
          id: "admin-credentials",
          name: "Admin login",
          credentials: {
            username: { label: "Username", type: "text" },
            password: { label: "Password", type: "password" },
          },
          async authorize(credentials): Promise<User | null> {
            const username = String(credentials?.username ?? "").trim();
            const password = String(credentials?.password ?? "");
            if (!username || !password) return null;

            // Lazy import to avoid build-time Prisma init.
            const { db } = await import("@brain/db");

            // ── Path 1: env-based admin credentials ──────────────────────
            const adminResult = await verifyAdminCredentials(username, password);
            if (adminResult.ok) {
              const existing = await db.user.findUnique({
                where: { email: adminResult.email },
              });
              if (existing) {
                // Ensure role is admin — promote if a previously-non-admin row
                // has a matching email.
                if (existing.role !== "admin") {
                  await db.user.update({
                    where: { id: existing.id },
                    data: { role: "admin" },
                  });
                }
                // Eagerly bootstrap personal org + default project (idempotent).
                try {
                  const { ensurePersonalOrg, ensureDefaultProject } = await import("@brain/core");
                  await ensurePersonalOrg(db, existing.id);
                  await ensureDefaultProject(db, existing.id);
                } catch (e) {
                  console.error("[auth] credentials ensurePersonalOrg/ensureDefaultProject failed:", e);
                }
                return {
                  id: existing.id,
                  email: existing.email,
                  name: existing.name,
                } as User;
              }
              const created = await db.user.create({
                data: {
                  email: adminResult.email,
                  name: adminResult.name,
                  role: "admin",
                },
              });
              try {
                const { ensurePersonalOrg, ensureDefaultProject } = await import("@brain/core");
                await ensurePersonalOrg(db, created.id);
                await ensureDefaultProject(db, created.id);
              } catch (e) {
                console.error("[auth] credentials ensurePersonalOrg/ensureDefaultProject failed for new admin:", e);
              }
              return {
                id: created.id,
                email: created.email,
                name: created.name,
              } as User;
            }

            // ── Path 2: per-user email + password ─────────────────────────
            // Treat `username` as an email address. Look up the User row,
            // then check the UserCredential bcrypt hash.
            //
            // Audit W2 (#103): when no User row exists, return null
            // *after* running a dummy verify so the response time
            // doesn't reveal whether the email is registered. The
            // verifyUserCredential function flattens its own no-cred
            // timing path (W1); we just need to make sure we always
            // call it.
            const email = username.toLowerCase();
            const user = await db.user.findUnique({
              where: { email },
              select: { id: true, email: true, name: true },
            });
            const { verifyUserCredential } = await import("./lib/brain/user-credentials");
            if (!user) {
              // Run a dummy verify against a synthetic userId so timing
              // matches the credential-found path.
              await verifyUserCredential(db, "user_does_not_exist", password);
              return null;
            }

            const ok = await verifyUserCredential(db, user.id, password);
            if (!ok) return null;

            return {
              id: user.id,
              email: user.email,
              name: user.name,
            } as User;
          },
        }),
      ]
    : []),
  // GitHub OAuth — secondary, only rendered on /signin when configured.
  // Currently dormant on the phase-1 pilot deployment.
  ...(authConfigured()
    ? [
        GitHub({
          clientId: process.env.AUTH_GITHUB_ID!,
          clientSecret: process.env.AUTH_GITHUB_SECRET!,
          allowDangerousEmailAccountLinking: true,
        }),
      ]
    : []),
];

export const config: NextAuthConfig = {
  providers,
  session: { strategy: "jwt" },
  // Trust the incoming host header. Required on any non-localhost deployment
  // (pilot VM on an IP, production behind Caddy, etc.) — without it NextAuth
  // returns "There was a problem with the server configuration" on /api/auth/*.
  // The env var `AUTH_TRUST_HOST=true` is the preferred knob; setting it here
  // defensively covers deployments that forgot to set the env.
  trustHost: true,
  pages: {
    signIn: "/signin",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const email = user.email.toLowerCase();
      const { db } = await import("@brain/db");

      const existing = await db.user.findUnique({ where: { email } });
      const adminEmails = parseAdminEmails();
      const shouldBeAdmin = adminEmails.has(email);

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
    },
    async jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.userId && typeof token.userId === "string") {
        (session as Session & { userId?: string }).userId = token.userId;
        if (session.user) session.user.id = token.userId;
      }
      return session;
    },
  },
};

 
const next: any = NextAuth(config);
export const handlers: { GET: (req: Request) => Promise<Response>; POST: (req: Request) => Promise<Response> } =
  next.handlers;
export const signIn: (...args: unknown[]) => Promise<unknown> = next.signIn;
// NextAuth v5 signOut accepts an options object. We narrow to the two
// properties we actually use — `redirect: false` (our pattern; we handle
// the redirect ourselves via next/navigation) and `redirectTo` (legacy
// callsites; not recommended on our stack — see app/signout/page.tsx).
export const signOut: (
  options?: { redirect?: boolean; redirectTo?: string },
) => Promise<unknown> = next.signOut;
export const auth: () => Promise<Session | null> = next.auth;
