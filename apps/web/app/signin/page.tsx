import {
  signIn,
  authConfigured,
  adminCredentialsConfigured,
  anySignInConfigured,
  devAuthAllowed,
  registrationRequiresVoucher,
} from "@/auth";
import { db } from "@brain/db";
import { hashSecret } from "@brain/core/secret-hash";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkVoucherRateLimit } from "@/lib/brain/vouchers";
import { LocalePicker } from "@/components/brain/locale-picker";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    error?: string;
    voucher?: string;
    invite?: string;
    mode?: string;
    callbackUrl?: string;
    next?: string;
  }>;
}

/**
 * Restrict post-login redirect to a same-origin relative path. Both `next`
 * (welcome-flow.tsx) and `callbackUrl` (settings/layout.tsx, Auth.js's own
 * convention) are accepted; without this validation a client-supplied
 * absolute/protocol-relative URL would be an open redirect after sign-in.
 */
function safeRedirect(raw: string | undefined): string {
  if (!raw) return "/";
  // Reject backslashes anywhere, not just a leading "//" or "://" — the
  // WHATWG URL parser's relative-slash state treats "/" and "\"
  // interchangeably when detecting a new authority for special schemes
  // (http/https), so "/\evil.com" resolves identically to "//evil.com":
  // both hand "evil.com" to the parser as the new host. CodeRabbit review
  // finding (PR #164) — this app has no legitimate route with a backslash.
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("://") ||
    raw.includes("\\")
  ) {
    return "/";
  }
  return raw;
}

/**
 * Origin for this container to call its OWN route handlers.
 *
 * These two server actions POST to the app's own API. They used to build the
 * URL as `NEXTAUTH_URL ?? AUTH_URL ?? "http://localhost:3000"`, which is wrong
 * twice over:
 *
 *   - `NEXTAUTH_URL` is the Auth.js **v4** name and was checked FIRST, despite
 *     this repo running v5 and wiring only `AUTH_URL`.
 *   - `AUTH_URL` is required to be the exact browser-facing origin
 *     (.env.example says so), so in production the container called itself
 *     back out through Caddy — needing self-egress and split-horizon DNS, both
 *     of which a locked-down host commonly denies.
 *
 * Loopback is what this actually wants: same process, no TLS, no DNS, no
 * egress. `INTERNAL_SELF_ORIGIN` is the escape hatch if a deployment ever
 * puts the route handlers somewhere else.
 */
function selfOrigin(): string {
  return (
    process.env.INTERNAL_SELF_ORIGIN ??
    `http://127.0.0.1:${process.env.PORT ?? "3000"}`
  );
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
  // Codes are normalised with .trim().toUpperCase() before every lookup
  // (lib/brain/vouchers.ts::normalize), so capitalisation and stray spaces
  // are NOT the cause — the old copy said "case-sensitive" and sent stuck
  // users down the one dead end that cannot be the problem.
  voucher_invalid: "That voucher code isn't valid. Check for a typo, or ask your admin to confirm the code (capitalisation and surrounding spaces don't matter).",
  voucher_expired: "That voucher code has expired. Ask your admin for a fresh one.",
  voucher_exhausted: "That voucher code has already been used the maximum number of times. Ask your admin for a fresh one.",
  voucher_disabled: "That voucher code has been disabled by an admin. Ask for a new one.",
  voucher_rate_limited:
    "Too many voucher attempts from this address. Wait an hour and try again, or ask your admin for a fresh code.",
  CredentialsSignin: "Wrong username or password. Check your entry and try again.",
  weak_password: "Password must be at least 8 characters. Mix letters, numbers, and symbols for safety.",
  password_mismatch: "Passwords do not match.",
  email_taken:
    "An account with that email already exists. Sign in instead, or reset your password if you've forgotten it.",
  rate_limited:
    "Too many sign-up attempts from this address. Wait an hour and try again.",
  registration_failed: "Couldn't create your account. Try again, or ask the operator for help.",
  registration_unavailable:
    "Self-service sign-up isn't enabled on this deployment. Ask the operator for an invite.",
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
      where: { tokenHash: hashSecret(token) },
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
  const postLoginRedirect = safeRedirect(params.callbackUrl ?? params.next);

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

  // Self-service registration (#new-user-onboarding). Only meaningful when the
  // credentials provider is configured — that's what lets the just-created
  // email+password account sign in afterwards (per-user credential path in
  // auth.ts). The voucher field is required unless the operator opened signup
  // via REGISTRATION_REQUIRES_VOUCHER=false.
  const voucherRequiredForSignup = registrationRequiresVoucher();
  const showRegisterForm =
    credentialsAllowed && params.mode === "register" && !showSignupForm;

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
      <LocalePicker />
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
                // No try/catch here previously: a rejected fetch (DNS, TLS,
                // egress block) surfaced as Next's generic error boundary on
                // the account-creation step — a blank wall at the worst
                // possible moment. `registration_failed` has real copy.
                let res: Response;
                try {
                  res = await fetch(`${selfOrigin()}/api/invites/signup`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ token, name, password }),
                  });
                } catch {
                  redirect(
                    `/signin?invite=${encodeURIComponent(token)}&error=registration_failed`,
                  );
                }

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
              <a href="/signin" style={{ color: "var(--accent-text, #7aa2f7)", textDecoration: "none" }}>
                Sign in instead
              </a>
            </div>
          </>
        ) : showRegisterForm ? (
          // ── Self-service registration form ───────────────────────────────
          <>
            <div style={{ fontSize: 13, color: "var(--ink-3, #9a9cab)", marginBottom: 16, lineHeight: 1.5 }}>
              Create your account. You&apos;ll get your own personal Brain — a
              private workspace you can start using right away, and add
              teammates to later.
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
                const email = String(formData.get("email") ?? "").trim();
                const password = String(formData.get("password") ?? "");
                const confirmPassword = String(formData.get("confirmPassword") ?? "");
                const voucher = String(formData.get("voucher") ?? "").trim();

                if (!email || !password) {
                  redirect("/signin?mode=register&error=invalid_credentials");
                }
                if (password.length < 8) {
                  redirect("/signin?mode=register&error=weak_password");
                }
                if (password !== confirmPassword) {
                  redirect("/signin?mode=register&error=password_mismatch");
                }

                let res: Response;
                try {
                  res = await fetch(`${selfOrigin()}/api/auth/register`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      email,
                      password,
                      ...(voucher ? { voucher } : {}),
                    }),
                  });
                } catch {
                  redirect("/signin?mode=register&error=registration_failed");
                }

                if (!res.ok) {
                  const data = (await res.json().catch(() => ({}))) as { error?: string };
                  redirect(`/signin?mode=register&error=${data.error ?? "registration_failed"}`);
                }

                const { redirectTo } = (await res.json()) as { redirectTo?: string };

                // Sign in with the just-created credentials.
                try {
                  await signIn("admin-credentials", {
                    username: email,
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
              <label style={{ display: "block", marginBottom: 14 }}>
                <span style={labelSpanStyle}>Email</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
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

              <label style={{ display: "block", marginBottom: voucherRequiredForSignup ? 14 : 18 }}>
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

              {voucherRequiredForSignup && (
                <label style={{ display: "block", marginBottom: 18 }}>
                  <span style={labelSpanStyle}>
                    Voucher code{" "}
                    <span style={{ textTransform: "none", letterSpacing: 0 }}>
                      — required to sign up here
                    </span>
                  </span>
                  <input
                    type="text"
                    name="voucher"
                    placeholder="e.g. PILOT-2026-A1B2"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    style={inputStyle}
                  />
                </label>
              )}

              <button type="submit" style={primaryBtnStyle}>
                Create account
              </button>
            </form>

            {voucherRequiredForSignup && (
              <div style={{ fontSize: 12, color: "var(--ink-4, #6b6d7a)", marginTop: 12, lineHeight: 1.5 }}>
                Don&apos;t have a voucher? Ask the person who invited you, or the
                operator of this Brain, for one.
              </div>
            )}

            <div style={{ fontSize: 12, color: "var(--ink-4, #6b6d7a)", marginTop: 14, lineHeight: 1.5 }}>
              Already have an account?{" "}
              <a href="/signin" style={{ color: "var(--accent-text, #7aa2f7)", textDecoration: "none" }}>
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
                      redirectTo: postLoginRedirect,
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
                    style={{ fontSize: 12, color: "var(--accent-text, #7aa2f7)", textDecoration: "none" }}
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
                  await signIn("github", { redirectTo: postLoginRedirect });
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
                When credentials sign-in is configured, offer self-service
                registration (voucher-gated unless the operator opened it).
                Otherwise (OAuth-only) keep the invite-link explainer. */}
            {credentialsAllowed && (
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
                <a href="/signin?mode=register" style={{ color: "var(--accent-text, #7aa2f7)", textDecoration: "none" }}>
                  Create one
                </a>
                {voucherRequiredForSignup
                  ? " — you'll need a voucher code from the operator."
                  : "."}
              </div>
            )}

            {!credentialsAllowed && anyAllowed && (
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
                New GitHub users need a voucher code from the operator — enter
                it above when you continue with GitHub.
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
