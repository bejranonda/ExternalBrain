"use client";

import { useEffect } from "react";

/**
 * /admin segment error boundary. Audit FE1 (#103). Isolates admin-tree
 * errors so a broken admin page doesn't bring down the rest of the
 * app — users without admin role never reach this branch anyway, but
 * an admin hitting an exception here gets a useful retry rather than
 * a blank screen.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[brain-admin-error]", error);
  }, [error]);
  return (
    <div style={{ padding: 32, color: "var(--ink, #e5e5e5)", fontFamily: "var(--font-sans, system-ui)" }}>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Admin surface failed to render</h2>
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
