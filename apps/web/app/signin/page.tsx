import {
  signIn,
  authConfigured,
  adminCredentialsConfigured,
  anySignInConfigured,
  devAuthAllowed,
} from "@/auth";
import { db } from "@brain/db";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkVoucherRateLimit } from "@/lib/brain/vouchers";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ error?: string; voucher?: string; invite?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  // UX-newcomer-pass-3 (iter 26): the previous copy leaked env-var
  // names (ADMIN_USERNAME, ADMIN_PASSWORD_HASH, …) directly at the
  // first-time visitor — operator-only detail. Point the user at the
  // operator without exposing internals; the operator already has the
  // env-var-level recipe in docs/SECURITY.md.
  auth_not_configured:
    "Sign-in isn't set up on this deployment yet. Ask the operator to enable an auth mode — see docs/SECURITY.md for the options.",
  invalid_credentials: "Wrong username or password. Check your entry and try again.",
  voucher_required:
    "A voucher code is required to sign up here. Enter yours below and try again — or ask the person who invited you (or the operator of this Brain) for one.",
  voucher_invalid: "That voucher code isn't valid. Double-check the code with your admin — codes are case-sensitive.",
  voucher_expired: "That voucher code has expired. Ask your admin for a fresh one.",
  voucher_exhausted: "That voucher code has already been used the maximum number of times. Ask your admin for a fresh one.",
  voucher_disabled: "That voucher code has been disabled by an admin. Ask for a new one.",
  voucher_rate_limited:
    "Too many voucher attempts from this address. Wait an hour and try again, or ask your admin for a fresh code.",
  CredentialsSignin: "Wrong username or password. Check your entry and try again.",
  weak_password: "Password must be at least 8 characters. Mix letters, numbers, and symbols for safety.",
  password_mismatch: "Passwords do not match.",
  invite_not_found: "Invite token not found. Check the link and try again.",
  invite_revoked: "This invite has been revoked. Ask the org admin for a new one.",
  invite_expired: "This invite has expired. Ask the org admin for a new one.",
  invite_already_accepted: "This invite has already been used.",
};

/** Fetch invite metadata for the banner — null if invalid/missing token. */
async function getInviteMeta(token: string | undefined) {
  if (!token) return null;
  try {
    const invite = await db.organizationInvite.findUnique({
      where: { token },
      select: {
        email: true,
        acceptedAt: true,
        revokedAt: true,
        expiresAt: true,
        organization: { select: { name: true } },
      },
    });
    if (!invite) return null;
    if (invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) return null;
    return { email: invite.email, orgName: invite.organization.name };
  } catch {
    return null;
  }
}

export default async function SignIn({ searchParams }: Props) {
  const params = await searchParams;
  const errorKey = params.error ?? "";
  const errorMessage = ERROR_MESSAGES[errorKey] ?? (errorKey ? "Sign-in failed. Try again." : "");
  const inviteToken = params.invite ?? "";

  // Dev-shim mode (no real auth configured, ALLOW_DEV_AUTH=true): the shell
  // resolves the dev user as "the first User row", so it only works once a
  // user exists. With an empty DB, redirect("/") bounces straight back here
  // (`/` can't resolve a user → redirects to /signin) → infinite loop. Only
  // hand off to the shell when a user actually exists; otherwise fall through
  // and render a bootstrap notice instead of looping.
  let devShimNeedsBootstrap = false;
  if (!anySignInConfigured() && devAuthAllowed()) {
    const userCount = await db.user.count().catch(() => 0);
    if (userCount > 0) {
      redirect("/");
    }
    devShimNeedsBootstrap = true;
  }

  const credentialsAllowed = adminCredentialsConfigured();
  const oauthAllowed = authConfigured();
  const anyAllowed = credentialsAllowed || oauthAllowed;

  // If we have an invite token, fetch the invite metadata for the sign-up form.
  const inviteMeta = inviteToken ? await getInviteMeta(inviteToken) : null;
  const showSignupForm = !!inviteToken && !!inviteMeta;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg, #0d0e11)",
        color: "var(--ink, #ececf0)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "24px 16px",
      }}
    >
      <div
        style={{
          width: "min(440px, 92vw)",
          padding: "32px 28px",
          borderRadius: 12,
          background: "var(--bg-elev-1, #171820)",
          border: "1px solid var(--line, #23242c)",
        }}
      >
        {/* UX-newcomer-pass-3 (iter 22): the previous header was a single
            "External Brain" line. A first-time visitor lands here with no
            context — make this an actual h1 + tagline so they know what
            they're signing into. */}
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0, letterSpacing: "-0.01em" }}>
          External Brain
        </h1>
        <div style={{ fontSize: 13, color: "var(--ink-3, #9a9cab)", marginTop: 4, marginBottom: 18 }}>
          The shared memory layer for your AI coding sessions.
        </div>

        {showSignupForm ? (
          // ── Invite sign-up form ──────────────────────────────────────────
          <>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-3, #9a9cab)",
                marginBottom: 16,
                padding: "10px 12px",
                background: "rgba(122,162,247,0.07)",
                border: "1px solid rgba(122,162,247,0.25)",
                borderRadius: 6,
                lineHeight: 1.5,
              }}
            >
              You&apos;ve been invited to <strong>{inviteMeta.orgName}</strong>. Set your password
              below to join.
            </div>

            {errorMessage && (
              <div
                role="alert"
                style={{
                  padding: "10px 12px",
                  marginBottom: 18,
                  border: "1px solid var(--warn, #d97757)",
                  borderRadius: 6,
                  background: "rgba(217, 119, 87, 0.08)",
                  color: "var(--warn, #d97757)",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                {errorMessage}
              </div>
            )}

            <form
              action={async (formData: FormData) => {
                "use server";
                const name = String(formData.get("name") ?? "").trim();
                const password = String(formData.get("password") ?? "");
                const confirmPassword = String(formData.get("confirmPassword") ?? "");
                const token = String(formData.get("inviteToken") ?? "").trim();

                if (!name || !password || !token) {
                  redirect(`/signin?invite=${encodeURIComponent(token)}&error=invalid_credentials`);
                }
                if (password.length < 8) {
                  redirect(`/signin?invite=${encodeURIComponent(token)}&error=weak_password`);
                }
                if (password !== confirmPassword) {
                  redirect(`/signin?invite=${encodeURIComponent(token)}&error=password_mismatch`);
                }

                // POST to /api/invites/signup
                const res = await fetch(
                  `${process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "http://localhost:3000"}/api/invites/signup`,
                  {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ token, name, password }),
                  },
                );

                if (!res.ok) {
                  const data = (await res.json()) as { error?: string };
                  const errKey = data.error ?? "invalid_credentials";
                  redirect(`/signin?invite=${encodeURIComponent(token)}&error=${errKey}`);
                }

                const { redirectTo, existingUser } = (await res.json()) as {
                  redirectTo: string;
                  existingUser?: boolean;
                };

                if (existingUser) {
                  // User already exists — sign in with existing credentials.
                  redirect(`/signin?invite=${encodeURIComponent(token)}&error=invite_already_accepted`);
                }

                // Sign in with the just-created credentials.
                const inviteEmailFetched = inviteMeta.email;
                try {
                  await signIn("admin-credentials", {
                    username: inviteEmailFetched,
                    password,
                    redirectTo: redirectTo ?? "/",
                  });
                } catch (err) {
                  if ((err as { message?: string })?.message?.includes("NEXT_REDIRECT")) {
                    throw err;
                  }
                  redirect(redirectTo ?? "/");
                }
              }}
            >
              <input type="hidden" name="inviteToken" value={inviteToken} />

              <label style={{ display: "block", marginBottom: 14 }}>
                <span style={labelSpanStyle}>Email</span>
                <input
                  type="email"
                  value={inviteMeta.email}
                  readOnly
                  style={{ ...inputStyle, opacity: 0.6, cursor: "default" }}
                />
              </label>

              <label style={{ display: "block", marginBottom: 14 }}>
                <span style={labelSpanStyle}>Display name</span>
                <input
                  type="text"
                  name="name"
                  autoComplete="name"
                  required
                  style={inputStyle}
                />
              </label>

              <label style={{ display: "block", marginBottom: 14 }}>
                <span style={labelSpanStyle}>Password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  style={inputStyle}
                />
              </label>

              <label style={{ display: "block", marginBottom: 18 }}>
                <span style={labelSpanStyle}>Confirm password</span>
                <input
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  style={inputStyle}
                />
              </label>

              <button type="submit" style={primaryBtnStyle}>
                Create account &amp; join {inviteMeta.orgName}
              </button>
            </form>

            <div style={{ fontSize: 12, color: "var(--ink-4, #6b6d7a)", marginTop: 14, lineHeight: 1.5 }}>
              Already have an account?{" "}
              <a href="/signin" style={{ color: "var(--accent, #7aa2f7)", textDecoration: "none" }}>
                Sign in instead
              </a>
            </div>
          </>
        ) : (
          // ── Normal sign-in form ──────────────────────────────────────────
          <>
            <div style={{ fontSize: 13, color: "var(--ink-3, #9a9cab)", marginBottom: 20 }}>
              {/* UX-newcomer-pass-3 (iter 21): the previous copy was
                  utilitarian — just naming the auth mechanism. Pair the
                  auth-mode hint with a one-liner so a first-time visitor
                  understands the value proposition. */}
              {credentialsAllowed
                ? "Sign in to access your Brain — the skills and sessions it's learning from your AI work."
                : oauthAllowed
                  ? "Sign in with GitHub to access your Brain. New users need a voucher code from an admin."
                  : devShimNeedsBootstrap
                    ? "Dev-auth is enabled, but this Brain has no users yet."
                    : "Sign-in is not configured on this deployment. Ask the operator to enable a sign-in mode."}
            </div>

            {devShimNeedsBootstrap && (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--ink-3, #9a9cab)",
                  padding: "12px 14px",
                  marginBottom: 18,
                  background: "var(--bg, #0d0e11)",
                  border: "1px dashed var(--line, #23242c)",
                  borderRadius: 6,
                  lineHeight: 1.6,
                }}
              >
                <code>ALLOW_DEV_AUTH=true</code> signs you in as the first user
                row, but the database is empty. Create that first user, then
                reload:
                <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                  <li>seed it: <code>pnpm --filter @brain/db exec prisma db seed</code>, or</li>
                  <li>point <code>DEV_USER_ID</code> at an existing user id, or</li>
                  <li>configure real auth (<code>ADMIN_USERNAME</code> + <code>ADMIN_PASSWORD_HASH</code>, or GitHub OAuth).</li>
                </ul>
              </div>
            )}

            {errorMessage && (
              <div
                role="alert"
                style={{
                  padding: "10px 12px",
                  marginBottom: 18,
                  border: "1px solid var(--warn, #d97757)",
                  borderRadius: 6,
                  background: "rgba(217, 119, 87, 0.08)",
                  color: "var(--warn, #d97757)",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                {errorMessage}
              </div>
            )}

            {credentialsAllowed && (
              <form
                action={async (formData: FormData) => {
                  "use server";
                  const username = String(formData.get("username") ?? "").trim();
                  const password = String(formData.get("password") ?? "");
                  if (!username || !password) {
                    redirect("/signin?error=invalid_credentials");
                  }
                  try {
                    await signIn("admin-credentials", {
                      username,
                      password,
                      redirectTo: "/",
                    });
                  } catch (err) {
                    // NextAuth throws NEXT_REDIRECT on success — don't catch those.
                    if ((err as { message?: string })?.message?.includes("NEXT_REDIRECT")) {
                      throw err;
                    }
                    redirect("/signin?error=invalid_credentials");
                  }
                }}
              >
                <label style={{ display: "block", marginBottom: 14 }}>
                  <span style={labelSpanStyle}>
                    Username or email
                  </span>
                  <input
                    type="text"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: "block", marginBottom: 6 }}>
                  <span style={labelSpanStyle}>Password</span>
                  <input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    style={inputStyle}
                  />
                </label>

                <div style={{ textAlign: "right", marginBottom: 18 }}>
                  <a
                    href="/forgot-password"
                    style={{ fontSize: 12, color: "var(--accent, #7aa2f7)", textDecoration: "none" }}
                  >
                    Forgot password?
                  </a>
                </div>

                <button type="submit" style={primaryBtnStyle}>
                  Sign in
                </button>
              </form>
            )}

            {oauthAllowed && (
              <form
                action={async (formData: FormData) => {
                  "use server";
                  const code = String(formData.get("voucher") ?? "").trim();
                  if (code) {
                    const hdrs = await headers();
                    const xff = hdrs.get("x-forwarded-for");
                    const ip = xff ? xff.split(",")[0]!.trim() : "local";
                    const gate = await checkVoucherRateLimit(ip);
                    if (!gate.ok) {
                      redirect("/signin?error=voucher_rate_limited");
                    }
                    const jar = await cookies();
                    jar.set("bp_voucher", code, {
                      httpOnly: true,
                      sameSite: "lax",
                      secure: process.env.NODE_ENV === "production",
                      maxAge: 10 * 60,
                      path: "/",
                    });
                  }
                  await signIn("github", { redirectTo: "/" });
                }}
                style={credentialsAllowed ? { marginTop: 24, paddingTop: 20, borderTop: "1px dashed var(--line, #23242c)" } : {}}
              >
                {credentialsAllowed && (
                  <div
                    style={{
                      fontSize: 12,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "var(--ink-4, #6b6d7a)",
                      marginBottom: 12,
                    }}
                  >
                    Or sign in with GitHub
                  </div>
                )}
                <label style={{ display: "block", marginBottom: 14 }}>
                  <span style={labelSpanStyle}>
                    Voucher code{" "}
                    <span style={{ textTransform: "none", letterSpacing: 0 }}>
                      — required for new GitHub accounts
                    </span>
                  </span>
                  <input
                    type="text"
                    name="voucher"
                    placeholder="e.g. PILOT-2026-A1B2"
                    autoComplete="off"
                    spellCheck={false}
                    style={inputStyle}
                  />
                </label>

                <button
                  type="submit"
                  style={{
                    width: "100%",
                    padding: "10px 16px",
                    background: credentialsAllowed ? "transparent" : "var(--accent, #7aa2f7)",
                    color: credentialsAllowed ? "var(--ink, #ececf0)" : "var(--accent-ink, #0d0e11)",
                    border: credentialsAllowed ? "1px solid var(--line, #23242c)" : "0",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Continue with GitHub
                </button>
              </form>
            )}

            {!anyAllowed && !devShimNeedsBootstrap && (
              <div
                style={{
                  fontSize: 13,
                  color: "var(--ink-3, #9a9cab)",
                  padding: "12px 14px",
                  background: "var(--bg, #0d0e11)",
                  border: "1px dashed var(--line, #23242c)",
                  borderRadius: 6,
                  lineHeight: 1.6,
                }}
              >
                The operator needs to set one of these before sign-in works:
                <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
                  <li>
                    <code>ADMIN_USERNAME</code> + <code>ADMIN_PASSWORD_HASH</code>{" "}
                    (credentials mode — current pilot), or
                  </li>
                  <li>
                    <code>AUTH_GITHUB_ID</code> + <code>AUTH_GITHUB_SECRET</code> +{" "}
                    <code>AUTH_SECRET</code> (OAuth mode), or
                  </li>
                  <li>
                    <code>ALLOW_DEV_AUTH=true</code> (local / VPN-only dev).
                  </li>
                </ul>
              </div>
            )}

            {/* #295 — onboarding affordance. A first-time visitor with no
                account otherwise sees a login wall with no path forward.
                The explainer reuses voucher-required language so it stays
                consistent if the operator later flips to OAUTH mode. */}
            {anyAllowed && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--ink-4, #6b6d7a)",
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: "1px dashed var(--line, #23242c)",
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: "var(--ink-3, #9a9cab)", fontWeight: 500 }}>
                  Don&apos;t have an account?
                </strong>{" "}
                Brain is invite-only on this deployment. Ask the person who
                invited you (or the operator of this Brain) for an invite
                link — they can send one from <code>/admin</code>.
              </div>
            )}

            <div style={{ fontSize: 12, color: "var(--ink-4, #6b6d7a)", marginTop: 16, lineHeight: 1.5 }}>
              Your session lives on this device. Your Brain data stays in this
              deployment.
            </div>
          </>
        )}
      </div>
    </main>
  );
}

// ── Shared style constants ──────────────────────────────────────────────────

const labelSpanStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-4, #6b6d7a)",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: 13,
  fontFamily: "var(--font-mono, ui-monospace), monospace",
  background: "var(--bg, #0d0e11)",
  color: "var(--ink, #ececf0)",
  border: "1px solid var(--line, #23242c)",
  borderRadius: 6,
};

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  background: "var(--accent, #7aa2f7)",
  color: "var(--accent-ink, #0d0e11)",
  border: "0",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
};
