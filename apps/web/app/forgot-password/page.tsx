/**
 * /forgot-password
 *
 * Server-rendered page. Single email input + submit button.
 * Calls POST /api/auth/forgot-password, then shows a generic
 * "check your email" message regardless of whether the address
 * was found (prevents enumeration).
 */
import { redirect } from "next/navigation";
import { LocalePicker } from "@/components/brain/locale-picker";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ sent?: string }>;
}

export default async function ForgotPasswordPage({ searchParams }: Props) {
  const params = await searchParams;
  const sent = params.sent === "1";

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
        {/* UX-newcomer-pass-3 (iter 23): match the h1 + tagline pattern
            from the signin page for visual consistency. */}
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0, letterSpacing: "-0.01em" }}>
          Reset your password
        </h1>
        {sent ? (
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
              <strong style={{ color: "var(--ink, #ececf0)" }}>Check your email.</strong>
              <br />
              If an account with that address exists, we sent a password reset link.
              The link expires in 1 hour.
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-4, #6b6d7a)", lineHeight: 1.5 }}>
              Did not receive it?{" "}
              <a href="/forgot-password" style={{ color: "var(--accent, #7aa2f7)", textDecoration: "none" }}>
                Try again
              </a>
              {" "}&mdash;{" "}
              <a href="/signin" style={{ color: "var(--accent, #7aa2f7)", textDecoration: "none" }}>
                Back to sign in
              </a>
            </div>
          </>
        ) : (
          // ── Form state ────────────────────────────────────────────────
          <>
            <div style={{ fontSize: 13, color: "var(--ink-3, #9a9cab)", marginBottom: 20 }}>
              Enter your account email and we&apos;ll send a password reset link.
            </div>

            <form
              action={async (formData: FormData) => {
                "use server";
                const email = String(formData.get("email") ?? "").trim();
                if (!email) redirect("/forgot-password");

                const baseUrl =
                  process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";

                await fetch(`${baseUrl}/api/auth/forgot-password`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ email }),
                }).catch(() => {
                  // Best-effort — show "sent" regardless of network error
                });

                redirect("/forgot-password?sent=1");
              }}
            >
              <label style={{ display: "block", marginBottom: 18 }}>
                <span style={labelSpan}>Email address</span>
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
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
                Send reset link
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
