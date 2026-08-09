"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a ```mermaid fenced block as an actual diagram.
 *
 * mermaid is DOM-dependent (document/window, dagre layout, SVG APIs) and is
 * NOT SSR-safe — it must never be imported at module scope in a file that
 * could be pulled into the server bundle. This component is `"use client"`
 * AND dynamically imports the library itself inside `useEffect`, so the
 * ~several-hundred-KB package is only fetched by a browser that actually
 * scrolls to a tutorial containing a diagram, not bundled into every route
 * that imports TutorialView.
 *
 * SECURITY (`ref.current.innerHTML = svg` below): this sets HTML from a
 * string, which is exactly the pattern that produces XSS when the string is
 * attacker-influenced. It is not here, for two independent reasons, and both
 * must keep holding for this to stay safe:
 *
 *  1. **Provenance.** `code` traces back through TutorialView → the
 *     server-rendered page → `tutorial-content.generated.ts`, which is
 *     baked from `docs/tutorials/*.md` at BUILD time by
 *     scripts/generate-tutorial-content.mjs. No request parameter, form
 *     field, database row, or other runtime input reaches this component.
 *     Never wire it to anything that does — a diagram source that a user
 *     can influence turns this into a real injection point regardless of
 *     mermaid's own sanitization.
 *  2. **mermaid's own sanitizer.** `securityLevel: "strict"` (set below,
 *     explicitly rather than trusting the library default) makes mermaid
 *     sanitize label/text content and disallow script-bearing constructs
 *     before it ever produces the SVG string — a second, independent layer
 *     on top of (1), not a substitute for it.
 *
 * DOMPurify was considered and rejected: mermaid's output is generated SVG
 * from its own sanitized grammar, not arbitrary externally-sourced HTML, so
 * running a general-purpose HTML sanitizer over it adds a dependency without
 * closing a gap that `securityLevel: "strict"` doesn't already close.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // One id per mount, not per render — mermaid registers diagrams by id and
  // a changing id on every render would leak registrations.
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
        const { svg } = await mermaid.render(idRef.current, code);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (err) {
        // A malformed diagram must not blank the page — fall back to the
        // raw fenced text so the content is still readable, and log why.
        if (!cancelled) setError(err instanceof Error ? err.message : "render failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <pre
        className="mono"
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          background: "var(--bg-elev-1)",
          border: "1px solid var(--warn, #d97757)",
          borderRadius: 6,
          padding: "14px 16px",
          margin: "0 0 16px",
          overflowX: "auto",
        }}
        title={`Diagram failed to render: ${error}`}
      >
        {code}
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      style={{
        margin: "0 0 16px",
        padding: "16px",
        background: "var(--bg-elev-1)",
        border: "1px solid var(--line)",
        borderRadius: 6,
        overflowX: "auto",
        // mermaid's default theme uses --bg-elev-1 tokens loosely at best;
        // "neutral" (set above) reads correctly on both light and dark
        // without per-token overrides.
        display: "flex",
        justifyContent: "center",
      }}
    />
  );
}
