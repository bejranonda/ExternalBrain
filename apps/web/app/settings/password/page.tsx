"use client";

/**
 * /settings/password — Change password for credential-based accounts.
 *
 * Only meaningful for users who have a UserCredential row (signed up via
 * invite or set a password previously). The API returns 409 no_credential
 * for OAuth-only users; we surface a friendly message.
 */

import { useState } from "react";
import { useT } from "@/lib/brain/i18n";
import { apiErrorMessage } from "@/lib/brain/api-error";

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
  display: "block",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 13,
  background: "var(--bg)",
  color: "var(--ink)",
  width: "100%",
  fontFamily: "var(--font-mono, ui-monospace), monospace",
};

const fieldStyle: React.CSSProperties = { marginBottom: 16 };

export default function ChangePasswordPage() {
  const t = useT();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");

    if (newPassword.length < 8) {
      setStatus("error");
      setErrorMsg(t("apiErrors.weak_password"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus("error");
      setErrorMsg(t("auth.errors.password_mismatch"));
      return;
    }

    setStatus("saving");
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (res.ok) {
        setStatus("ok");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      setErrorMsg(
        res.status >= 500 ? t("password.failed") : apiErrorMessage(t, data.error, res.status),
      );
      setStatus("error");
    } catch {
      setErrorMsg(t("apiErrors.network"));
      setStatus("error");
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--ink)",
        padding: "40px 24px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <a
          href="/settings/tokens"
          style={{ fontSize: 13, color: "var(--ink-3)", textDecoration: "none" }}
        >
          {t("password.back")}
        </a>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "16px 0 4px" }}>
          {t("password.title")}
        </h1>
        <p style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 28 }}>
          {t("password.intro")}
        </p>

        {status === "ok" && (
          <div
            role="status"
            style={{
              padding: "10px 14px",
              borderRadius: 6,
              background: "rgba(122,162,247,0.08)",
              border: "1px solid rgba(122,162,247,0.25)",
              color: "var(--accent-text, #7aa2f7)",
              fontSize: 13,
              marginBottom: 20,
            }}
          >
            {t("password.changed")}
          </div>
        )}

        {status === "error" && errorMsg && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              borderRadius: 6,
              background: "rgba(217,119,87,0.08)",
              border: "1px solid var(--warn, #d97757)",
              color: "var(--warn, #d97757)",
              fontSize: 13,
              marginBottom: 20,
            }}
          >
            {errorMsg}
          </div>
        )}

        <form
          onSubmit={(e) => { void handleSubmit(e); }}
          style={{
            background: "var(--bg-elev-1)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "24px",
          }}
        >
          <div style={fieldStyle}>
            <label>
              <span style={labelStyle}>{t("password.current")}</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
                style={inputStyle}
              />
            </label>
          </div>

          <div style={fieldStyle}>
            <label>
              <span style={labelStyle}>{t("auth.newPassword")}</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                style={inputStyle}
              />
            </label>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label>
              <span style={labelStyle}>{t("auth.confirmNewPassword")}</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                style={inputStyle}
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={status === "saving"}
            style={{
              padding: "9px 20px",
              background: "var(--accent, #7aa2f7)",
              color: "var(--accent-ink, #0d0e11)",
              border: "none",
              borderRadius: 7,
              fontSize: 13,
              fontWeight: 500,
              cursor: status === "saving" ? "wait" : "pointer",
              opacity: status === "saving" ? 0.7 : 1,
            }}
          >
            {status === "saving" ? t("common.saving") : t("password.submit")}
          </button>
        </form>
      </div>
    </main>
  );
}
