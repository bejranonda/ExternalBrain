import type { ReactNode } from "react";

/**
 * The accent-tick heading idiom introduced on the landing page (2026-08-09) —
 * a small colored bar to the left of the text, the same device
 * `.rail-item.active::before` uses in the app shell for "you are here."
 * Shared here so landing.tsx, tutorial-view.tsx, and concept-view.tsx render
 * identical h2s instead of drifting into three slightly different headings.
 */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: "-0.01em",
        color: "var(--ink)",
        margin: "0 0 14px",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 3,
          height: 16,
          borderRadius: 2,
          background: "var(--accent)",
          flexShrink: 0,
        }}
      />
      {children}
    </h2>
  );
}
