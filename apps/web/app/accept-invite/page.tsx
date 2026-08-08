/**
 * /accept-invite — Accept an org invite by token.
 *
 * Server-rendered page.
 *
 * Flow:
 *  - Signed-in user: POST /api/invites/accept → redirect to /settings/projects
 *  - Signed-out user: redirect to /signin?callbackUrl=/accept-invite?token=...
 */
"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { LocalePicker } from "@/components/brain/locale-picker";
import { useT } from "@/lib/brain/i18n";

function AcceptInviteInner() {
  const t = useT();
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("No invite token found in the URL. Check the link and try again.");
      return;
    }

    // Attempt to accept
    setStatus("loading");

    void (async () => {
      try {
        const res = await fetch("/api/invites/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        });

        if (res.status === 401) {
          // Not signed in — redirect to sign-in with invite token so the
          // user can sign up (if new) or sign in (if existing).
          router.replace(`/signin?invite=${encodeURIComponent(token)}`);
          return;
        }

        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }

        setStatus("success");
        setMessage("You have been added to the organization. Redirecting…");

        // Redirect to projects page after a brief moment
        window.setTimeout(() => {
          router.replace("/settings/projects");
        }, 1500);
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Failed to accept invite.");
      }
    })();
  }, [token, router]);

  const containerStyle: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg)",
    color: "var(--ink)",
    fontFamily: "inherit",
  };

  const cardStyle: React.CSSProperties = {
    background: "var(--bg-elev-1)",
    border: "1px solid var(--line)",
    borderRadius: 12,
    padding: "32px 40px",
    maxWidth: 440,
    width: "100%",
    textAlign: "center",
  };

  return (
    <main style={containerStyle}>
      <LocalePicker />
      <div style={cardStyle}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>{t("auth.inviteTitle")}</h1>

        {status === "idle" && (
          <p style={{ color: "var(--ink-3)", fontSize: 14 }}>{t("auth.preparing")}</p>
        )}

        {status === "loading" && (
          <p style={{ color: "var(--ink-3)", fontSize: 14 }}>{t("auth.accepting")}</p>
        )}

        {status === "success" && (
          <p style={{ color: "var(--accent-text)", fontSize: 14 }}>{message}</p>
        )}

        {status === "error" && (
          <>
            <p
              style={{
                color: "#e05252",
                fontSize: 14,
                marginBottom: 16,
              }}
            >
              {message}
            </p>
            <a
              href="/"
              style={{
                fontSize: 13,
                color: "var(--ink-2)",
                textDecoration: "underline",
              }}
            >{t("auth.goToBrain")}</a>
          </>
        )}
      </div>
    </main>
  );
}

export default function AcceptInvitePage() {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg)",
            color: "var(--ink-3)",
            fontSize: 14,
          }}
        >{t("auth.loading")}</div>
      }
    >
      <AcceptInviteInner />
    </Suspense>
  );
}
