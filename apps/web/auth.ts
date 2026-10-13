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
 * The Credentials provider does its own User lookup/create inside
 * `authorize`, but NextAuth still runs the signIn callback for it afterwards
 * — so provider-specific logic there must check `account.provider`.
 */
import NextAuth, { CredentialsSignin, type NextAuthConfig, type Session, type User } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { envFlag } from "@brain/core/env";
import GitHub from "next-auth/providers/github";
import { clientIpFrom } from "./lib/brain/client-ip";
import { checkLoginRateLimit, LOGIN_RATE_LIMITED } from "./lib/brain/login-rate-limit";
import {
  adminCredentialsConfigured,
  verifyAdminCredentials,
} from "./lib/brain/admin-credentials";
import {
  jwtCallback,
  registrationRequiresVoucher,
  signInCallback,
} from "./lib/brain/auth-callbacks";

export { registrationRequiresVoucher };

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

class LoginRateLimited extends CredentialsSignin {
  override code = LOGIN_RATE_LIMITED;
}

class EmailUnconfirmed extends CredentialsSignin {
  override code = "email_unconfirmed";
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
          async authorize(credentials, request): Promise<User | null> {
            const username = String(credentials?.username ?? "").trim();
            const password = String(credentials?.password ?? "");
            if (!username || !password) return null;

            // Before bcrypt, so a throttled guess costs us nothing either.
            if (!(await checkLoginRateLimit(clientIpFrom(request.headers), username))) {
              throw new LoginRateLimited();
            }

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
                if (existing.emailVerifiedAt === null) {
                  // A row with the operator's address that nobody proved was
                  // registered by someone else (§0bb): evict them — their
                  // password, tokens and sessions — before promoting it.
                  const { proveEmailOwnership } = await import("./lib/brain/email-ownership");
                  await db.$transaction(async (tx) => {
                    await proveEmailOwnership(tx, existing.id);
                    await tx.userCredential.deleteMany({ where: { userId: existing.id } });
                    await tx.user.update({
                      where: { id: existing.id },
                      data: { role: "admin", emailConfirmRequired: false },
                    });
                  });
                } else if (existing.role !== "admin") {
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
                  emailVerifiedAt: new Date(),
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
              select: {
                id: true,
                email: true,
                name: true,
                emailConfirmRequired: true,
                emailVerifiedAt: true,
              },
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
            // Only after the password matched, so this says nothing about an
            // address to someone who doesn't hold the account's password.
            const { emailConfirmPending } = await import("./lib/brain/email-confirm");
            if (emailConfirmPending(user)) throw new EmailUnconfirmed();

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
          // No adapter (JWT sessions), so NextAuth itself links nothing; the
          // signIn callback below decides which User row a GitHub login gets,
          // and only adopts a row whose email has been proven (§0az).
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
    signIn: signInCallback,
    jwt: jwtCallback,
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
