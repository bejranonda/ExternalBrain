"use client";

import { useEffect } from "react";

/**
 * Root error boundary — catches uncaught render errors anywhere below
 * the top-level layout. Without this, an exception in any client
 * component (Oracle, Skills, Graph, settings, admin pages) produces
 * Next's default error overlay in dev and a blank/document-default
 * page in prod, breaking the "every surface in two interactions"
 * promise from docs/NAVIGATION.md.
 *
 * Audit FE1 (#103). Per-segment error.tsx files at /admin and /settings
 * isolate failures inside those subtrees so the rest of the app stays
 * navigable.
 *
 * The `digest` Next.js attaches identifies the server-side error log
 * line; surface it so an operator can correlate user reports with
 * server telemetry.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Forward to console so the dev overlay still shows the stack;
    // also reaches Sentry's client SDK if it's been initialized
    // upstream.
    // eslint-disable-next-line no-console
    console.error("[brain-error-boundary]", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 32,
        fontFamily: "var(--font-sans, system-ui)",
        color: "var(--ink, #e5e5e5)",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>
        Something went wrong on this surface
      </h1>
      <p style={{ fontSize: 14, color: "var(--ink-2, #b0b0b0)", margin: 0, maxWidth: 480, textAlign: "center" }}>
        The Brain webapp hit an unexpected error rendering this view.
        You can try again, or navigate to a different surface from the
        rail / bottom nav.
      </p>
      {error.digest ? (
        <p style={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)", color: "var(--ink-4, #6b6b6b)", margin: 0 }}>
          digest: {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        style={{
          padding: "8px 16px",
          fontSize: 13,
          background: "var(--accent, #d8ff3e)",
          color: "var(--accent-ink, #0a0a0b)",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
