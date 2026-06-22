"use client";

import Link from "next/link";

interface InfoDotProps {
  /** One-line plain-English definition shown as the native tooltip. */
  tip: string;
  /** Concept slug to deep-link into /docs/concepts/<slug>. Optional —
   *  omit for terms with no dedicated concept page. */
  conceptSlug?: string;
  /** The term being defined; prefixes the accessible label. */
  term: string;
}

const dotStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 14,
  height: 14,
  marginLeft: 4,
  borderRadius: 7,
  border: "1px solid var(--line)",
  color: "var(--ink-3)",
  fontSize: 9,
  fontWeight: 600,
  lineHeight: 1,
  cursor: "help",
  verticalAlign: "middle",
  textDecoration: "none",
};

/**
 * Inline, term-level "?" affordance. Distinct from the page-level
 * HelpPopover: this explains a single word where it appears (a badge, a
 * column header) and optionally links to the matching concept doc.
 *
 * Keyboard-focusable; carries the definition in title + aria-label. When
 * conceptSlug is set it links to the concept page; otherwise a tooltipped
 * <span>.
 */
export function InfoDot({ tip, conceptSlug, term }: InfoDotProps) {
  const label = `${term}: ${tip}`;
  if (conceptSlug) {
    return (
      <Link
        href={`/docs/concepts/${conceptSlug}`}
        title={label}
        aria-label={`${label} — read more`}
        style={dotStyle}
      >
        ?
      </Link>
    );
  }
  return (
    <span role="note" title={label} aria-label={label} style={dotStyle}>
      ?
    </span>
  );
}
