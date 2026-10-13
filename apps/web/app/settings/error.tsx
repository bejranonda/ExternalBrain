"use client";

import { useEffect } from "react";
import { useT } from "@/lib/brain/i18n";

/**
 * /settings segment error boundary. Audit FE1 (#103). Pairs with the
 * /admin error boundary for tree isolation.
 */
export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[brain-settings-error]", error);
  }, [error]);
  return (
    <div
      role="alert"
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px",
        color: "var(--ink, #e5e5e5)",
        fontFamily: "var(--font-sans, system-ui)",
      }}
    >
      <h2 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 8px" }}>{t("errorPage.settingsTitle")}</h2>
      <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 12px", lineHeight: 1.55 }}>
        {t("errorPage.settingsBody")}
      </p>
      {error.digest ? (
        <p style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "var(--ink-4, #6b6b6b)", margin: "0 0 12px" }}>
          {t("errorPage.reference", { digest: error.digest })}
        </p>
      ) : null}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" style={{ fontSize: 13 }} onClick={reset}>
          {t("errorPage.tryAgain")}
        </button>
        <a href="/" className="btn btn-ghost" style={{ fontSize: 13, textDecoration: "none" }}>
          {t("errorPage.backHome")}
        </a>
      </div>
    </div>
  );
}
