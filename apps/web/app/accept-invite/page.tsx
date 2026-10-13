/**
 * /accept-invite — Accept an org invite by token.
 *
 * Client page (reads `?token=` via useSearchParams).
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
import { I18N, useT } from "@/lib/brain/i18n";
import { apiErrorMessage, type Translate } from "@/lib/brain/api-error";

type InviteFailure = { kind: "no_token" } | { kind: "api"; code: unknown; status?: number };

// Same guard as /signin's errorKeyKnown: the code comes off the wire, so only
// an own key of the English table may be looked up. acceptOrgInvite throws
// BrainError codes (INVITE_EXPIRED, …) and a bare NOT_FOUND for a bad token.
function inviteFailureMessage(t: Translate, f: InviteFailure): string {
  if (f.kind === "no_token") return t("auth.inviteNoToken");
  if (typeof f.code === "string") {
    const key = f.code === "NOT_FOUND" ? "invite_not_found" : f.code.toLowerCase();
    if (key.startsWith("invite_") && Object.hasOwn(I18N.en.auth.errors, key)) {
      return t(`auth.errors.${key}`);
    }
  }
  return apiErrorMessage(t, f.code, f.status);
}

function AcceptInviteInner() {
  const t = useT();
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [failure, setFailure] = useState<InviteFailure | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setFailure({ kind: "no_token" });
      return;
    }

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
          const data = (await res.json().catch(() => ({}))) as { error?: unknown };
          setFailure({ kind: "api", code: data.error, status: res.status });
          setStatus("error");
          return;
        }

        setStatus("success");

        window.setTimeout(() => {
          router.replace("/settings/projects");
        }, 1500);
      } catch {
        setFailure({ kind: "api", code: undefined });
        setStatus("error");
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
          <p role="status" style={{ color: "var(--accent-text)", fontSize: 14 }}>
            {t("auth.inviteAccepted")}
          </p>
        )}

        {status === "error" && failure && (
          <>
            <p
              role="alert"
              style={{
                color: "#e05252",
                fontSize: 14,
                marginBottom: 16,
              }}
            >
              {inviteFailureMessage(t, failure)}
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
