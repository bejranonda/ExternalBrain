import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Documentation — Brain Platform",
};

/**
 * Shared layout for /docs and /docs/concepts/* — keeps header, sidebar
 * navigation, and back-link consistent. Doesn't reuse the main app shell
 * because docs are intentionally calmer (no rail counts, no live status,
 * no command palette) — it's a reading surface, not a working surface.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--font-sans)",
        padding: "32px 24px 80px",
      }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <Link
          href="/"
          className="mono"
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            textDecoration: "none",
            display: "inline-block",
            marginBottom: 24,
          }}
        >
          ← back to Brain
        </Link>
        {children}
      </div>
    </main>
  );
}
