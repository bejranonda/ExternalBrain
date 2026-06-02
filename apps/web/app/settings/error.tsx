"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[brain-settings-error]", error);
  }, [error]);
  return (
    <div style={{ padding: 32, color: "var(--ink, #e5e5e5)", fontFamily: "var(--font-sans, system-ui)" }}>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Settings page failed to render</h2>
      {error.digest ? (
        <p style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "var(--ink-4, #6b6b6b)" }}>
          digest: {error.digest}
        </p>
      ) : null}
      <button type="button" onClick={reset} style={{ marginTop: 12, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>
        Retry
      </button>
    </div>
  );
}
