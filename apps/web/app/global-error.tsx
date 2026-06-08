"use client";

import { useEffect } from "react";

/**
 * Last-resort error boundary — fires when even the root layout fails
 * to render. Renders its own <html>/<body> because the layout it
 * usually inherits from is the thing that broke.
 *
 * Audit FE1 (#103). Pairs with `error.tsx` at the same level: per-route
 * errors are caught by the segment boundary; only catastrophic
 * layout-level failures fall through to this one.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[brain-global-error-boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 32,
          fontFamily: "system-ui",
          background: "#0a0a0b",
          color: "#e5e5e5",
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>
          External Brain — fatal error
        </h1>
        <p style={{ fontSize: 14, color: "#b0b0b0", margin: 0, maxWidth: 480, textAlign: "center" }}>
          The webapp could not render. Reloading may help; if the error
          persists, check the server logs for the digest below.
        </p>
        {error.digest ? (
          <p style={{ fontSize: 11, fontFamily: "monospace", color: "#6b6b6b", margin: 0 }}>
            digest: {error.digest}
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "8px 16px",
            fontSize: 13,
            background: "#d8ff3e",
            color: "#0a0a0b",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
