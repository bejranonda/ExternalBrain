/**
 * /reset-password?token=<token>
 *
 * Server-rendered. Validates token presence + non-expiry before rendering.
 * Shows form: new password + confirm, submits to POST /api/auth/reset-password.
 * On success → "Password reset. You can now sign in."
 */
import { redirect } from "next/navigation";
import { db } from "@brain/db";
import { LocalePicker } from "@/components/brain/locale-picker";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ token?: string; error?: string; success?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_token: "This link is invalid, expired, or has already been used. Request a new one.",
  weak_password: "Password must be at least 8 characters.",
  password_mismatch: "Passwords do not match.",
  server_error: "Something went wrong. Please try again.",
};

async function getTokenValidity(token: string): Promise<{ valid: boolean }> {
  if (!token) return { valid: false };
  try {
    const row = await db.passwordResetToken.findUnique({
      where: { token },
      select: { expiresAt: true, usedAt: true },
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) return { valid: false };
    return { valid: true };
  } catch {
    return { valid: false };
  }
}

export default async function ResetPasswordPage({ searchParams }: Props) {
  const params = await searchParams;
  const token = params.token ?? "";
  const errorKey = params.error ?? "";
  const success = params.success === "1";

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: "var(--font-mono, ui-monospace), monospace",
    background: "var(--bg, #0d0e11)",
    color: "var(--ink, #ececf0)",
    border: "1px solid var(--line, #23242c)",
    borderRadius: 6,
    boxSizing: "border-box",
  };

  const labelSpan: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--ink-4, #6b6d7a)",
    marginBottom: 6,
  };

  // If no token present, redirect to forgot-password
  if (!token && !success) {
    redirect("/forgot-password");
  }

  // Validate token (unless showing success screen)
  const { valid } = success ? { valid: true } : await getTokenValidity(token);

  const errorMessage = ERROR_MESSAGES[errorKey] ?? (errorKey ? "An error occurred." : "");

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
        <div style={{ fontSize: 20, fontWeight: 500, marginBottom: 6 }}>
          External Brain
        </div>

        {success ? (
          // ── Success state ──────────────────────────────────────────────
          <>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-3, #9a9cab)",
                marginBottom: 20,
                padding: "12px 14px",
                background: "rgba(122,162,247,0.07)",
                border: "1px solid rgba(122,162,247,0.25)",
                borderRadius: 6,
                lineHeight: 1.6,
              }}
            >
              <strong style={{ color: "var(--ink, #ececf0)" }}>Password reset.</strong>
              <br />
              Your new password is active. You can now sign in.
            </div>
            <a
              href="/signin"
              style={{
                display: "inline-block",
                padding: "10px 22px",
                background: "var(--accent, #7aa2f7)",
                color: "var(--accent-ink, #0d0e11)",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Go to sign in
            </a>
          </>
        ) : !valid ? (
          // ── Invalid / expired token ────────────────────────────────────
          <>
            <div
              style={{
                fontSize: 13,
                color: "var(--warn, #d97757)",
                marginBottom: 20,
                padding: "12px 14px",
                background: "rgba(217,119,87,0.08)",
                border: "1px solid rgba(217,119,87,0.3)",
                borderRadius: 6,
                lineHeight: 1.6,
              }}
            >
              This reset link is invalid, expired, or has already been used.
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-4, #6b6d7a)", lineHeight: 1.5 }}>
              <a href="/forgot-password" style={{ color: "var(--accent, #7aa2f7)", textDecoration: "none" }}>
                Request a new reset link
              </a>
              {" "}&mdash;{" "}
              <a href="/signin" style={{ color: "var(--accent, #7aa2f7)", textDecoration: "none" }}>
                Back to sign in
              </a>
            </div>
          </>
        ) : (
          // ── Reset form ─────────────────────────────────────────────────
          <>
            <div style={{ fontSize: 13, color: "var(--ink-3, #9a9cab)", marginBottom: 16 }}>
              Choose a new password for your account.
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
                const t = String(formData.get("token") ?? "").trim();
                const newPassword = String(formData.get("newPassword") ?? "");
                const confirm = String(formData.get("confirmPassword") ?? "");

                if (!t) redirect("/forgot-password");

                if (newPassword.length < 8) {
                  redirect(`/reset-password?token=${encodeURIComponent(t)}&error=weak_password`);
                }
                if (newPassword !== confirm) {
                  redirect(`/reset-password?token=${encodeURIComponent(t)}&error=password_mismatch`);
                }

                const baseUrl =
                  process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

                const res = await fetch(`${baseUrl}/api/auth/reset-password`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ token: t, newPassword }),
                });

                if (!res.ok) {
                  const data = (await res.json().catch(() => ({}))) as { error?: string };
                  const errKey = data.error ?? "server_error";
                  redirect(`/reset-password?token=${encodeURIComponent(t)}&error=${errKey}`);
                }

                redirect("/reset-password?success=1");
              }}
            >
              <input type="hidden" name="token" value={token} />

              <label style={{ display: "block", marginBottom: 14 }}>
                <span style={labelSpan}>New password</span>
                <input
                  type="password"
                  name="newPassword"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  style={inputStyle}
                />
              </label>

              <label style={{ display: "block", marginBottom: 18 }}>
                <span style={labelSpan}>Confirm new password</span>
                <input
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  style={inputStyle}
                />
              </label>

              <button
                type="submit"
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  background: "var(--accent, #7aa2f7)",
                  color: "var(--accent-ink, #0d0e11)",
                  border: "0",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Reset password
              </button>
            </form>

            <div style={{ fontSize: 12, color: "var(--ink-4, #6b6d7a)", marginTop: 16, lineHeight: 1.5 }}>
              <a href="/signin" style={{ color: "var(--accent, #7aa2f7)", textDecoration: "none" }}>
                Back to sign in
              </a>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
