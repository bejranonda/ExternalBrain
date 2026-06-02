/**
 * Explicit sign-out page. Replaces the naive <form action="/api/auth/signout">
 * in user-menu.tsx which 500'd on non-localhost deployments because NextAuth's
 * default signout POST expects a CSRF token.
 *
 * Two-step server action (2026-04-23, after the `/undefined` redirect report):
 *   1. `signOut({ redirect: false })` — clear the session cookie; do NOT let
 *      NextAuth handle the redirect. Its internal redirect logic constructs
 *      a URL from AUTH_URL + callbackUrl form field; when the form field is
 *      absent (as in a no-args server action) the callbackUrl reads as
 *      `undefined` and NextAuth redirects to the literal string "/undefined".
 *   2. `redirect("/signin")` — do the redirect ourselves to a known-good path.
 *
 * NextAuth v5 propagates redirect() as a thrown NEXT_REDIRECT; don't wrap in
 * try/catch.
 */
import { signOut } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function SignOutPage() {
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
          width: "min(380px, 92vw)",
          padding: "28px 24px",
          borderRadius: 12,
          background: "var(--bg-elev-1, #171820)",
          border: "1px solid var(--line, #23242c)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 6 }}>Sign out?</div>
        <div style={{ fontSize: 13, color: "var(--ink-3, #9a9cab)", marginBottom: 22 }}>
          Your session will end on this device. Your Brain data stays on the server.
        </div>
        <form
          action={async () => {
            "use server";
            // signOut clears the session. `redirect: false` prevents NextAuth
            // from doing its own redirect to a potentially-undefined target.
            await signOut({ redirect: false });
            // Explicit redirect to a path we control. Throws NEXT_REDIRECT;
            // the server action machinery propagates it to the client.
            redirect("/signin");
          }}
        >
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
            Sign out
          </button>
        </form>
        <a
          href="/"
          style={{
            display: "inline-block",
            marginTop: 14,
            fontSize: 12,
            color: "var(--ink-3, #9a9cab)",
            textDecoration: "none",
          }}
        >
          Cancel
        </a>
      </div>
    </main>
  );
}
