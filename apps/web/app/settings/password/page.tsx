"use client";

/**
 * /settings/password — Change password for credential-based accounts.
 *
 * Only meaningful for users who have a UserCredential row (signed up via
 * invite or set a password previously). The API returns 409 no_credential
 * for OAuth-only users; we surface a friendly message.
 */

import { useState } from "react";

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
      setErrorMsg("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus("error");
      setErrorMsg("Passwords do not match.");
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

      const data = (await res.json()) as { error?: string };
      if (data.error === "NO_CREDENTIAL") {
        setErrorMsg(
          "Your account doesn't have a password credential. You signed in via GitHub or the admin path — password change isn't available.",
        );
      } else if (data.error === "WRONG_PASSWORD") {
        setErrorMsg("Current password is incorrect.");
      } else if (data.error === "WEAK_PASSWORD") {
        setErrorMsg("New password must be at least 8 characters.");
      } else {
        setErrorMsg("Failed to change password. Try again.");
      }
      setStatus("error");
    } catch {
      setErrorMsg("Network error. Try again.");
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
          ← Settings
        </a>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "16px 0 4px" }}>
          Change password
        </h1>
        <p style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 28 }}>
          Only available for accounts that signed up via invite link. OAuth
          accounts (GitHub) don&apos;t have a Brain password.
        </p>

        {status === "ok" && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 6,
              background: "rgba(122,162,247,0.08)",
              border: "1px solid rgba(122,162,247,0.25)",
              color: "var(--accent, #7aa2f7)",
              fontSize: 13,
              marginBottom: 20,
            }}
          >
            Password changed successfully.
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
              <span style={labelStyle}>Current password</span>
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
              <span style={labelStyle}>New password</span>
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
              <span style={labelStyle}>Confirm new password</span>
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
            {status === "saving" ? "Saving…" : "Change password"}
          </button>
        </form>
      </div>
    </main>
  );
}
