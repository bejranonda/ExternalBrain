import type { Metadata } from "next";
import Link from "next/link";
import { LocalePicker } from "@/components/brain/locale-picker";

export const metadata: Metadata = {
  title: "Documentation — External Brain",
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
      {/* Locale switcher — /docs is now translated (TH/DE), so it joins the
          other unauth surfaces in offering the picker. #59. */}
      <LocalePicker />
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <Link
          href="/"
          // `/` 307-redirects to the user's org/project app root, so the RSC
          // prefetch aborts (ERR_ABORTED in the network panel on every /docs
          // load). Nothing to prefetch for a redirect — turn it off.
          prefetch={false}
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
