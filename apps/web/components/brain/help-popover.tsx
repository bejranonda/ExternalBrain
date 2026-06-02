"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

export interface HelpContent {
  /** "What this surface is" — one short sentence. */
  what: string;
  /** "What you do here" — bulleted list. Keep each item short and verb-led. */
  whatToDo: string[];
  /** Optional "Related" links — labels with click handlers (parent supplies routing). */
  related?: Array<{ label: string; onClick: () => void }>;
  /** Optional doc URL — opens in a new tab if provided. */
  docHref?: string;
}

interface HelpPopoverProps {
  content: HelpContent;
  /** aria-label for the trigger button. Defaults to "Help". */
  triggerLabel?: string;
}

/**
 * Persistent micro-help button rendered in the corner of a route header.
 * Click toggles a popover with three sections (What / What to do / Related).
 *
 * Designed for the user persona who lands cold on a surface and needs to
 * answer "what is this and what should I do here?" without reading docs.
 *
 * Closes on outside click + Escape. Stateless — content is supplied by the
 * surface that mounts it.
 */
export function HelpPopover({ content, triggerLabel = "What is this page?" }: HelpPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className="icon-btn"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={triggerLabel}
        onClick={() => setOpen((v) => !v)}
        style={{
          /* 28×28 keeps the visual weight modest while giving a more
             generous tap target than the previous 22×22. Inner glyph
             also bumped 12 → 14 to be unambiguously legible. */
          width: 28,
          height: 28,
          padding: 0,
          borderRadius: 14,
          color: open ? "var(--ink)" : "var(--ink-2)",
          border: "1px solid var(--line)",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>?</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={triggerLabel}
          className="panel"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 360,
            maxWidth: "calc(100vw - 24px)",
            // Bumped from 50 → var(--z-popover, 60) so it stacks ABOVE
            // the cmdk-scrim (z 100? no — popovers should be below modal
            // scrim so opening a modal hides the popover correctly). 60
            // is the canonical popover layer; modals at 100 still win.
            zIndex: 60,
            padding: "14px 16px",
            background: "var(--bg-elev-1)",
            border: "1px solid var(--line)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            What this is
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.55, color: "var(--ink)" }}>
            {content.what}
          </p>

          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            What you do here
          </div>
          <ul
            style={{
              margin: "0 0 14px",
              padding: "0 0 0 20px",
              fontSize: 14,
              lineHeight: 1.55,
              color: "var(--ink-2)",
            }}
          >
            {content.whatToDo.map((item, i) => (
              <li key={i} style={{ marginBottom: 5 }}>
                {item}
              </li>
            ))}
          </ul>

          {(content.related?.length ?? 0) > 0 || content.docHref ? (
            <>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--ink-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                Related
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {content.related?.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 11, height: 22 }}
                    onClick={() => {
                      r.onClick();
                      setOpen(false);
                    }}
                  >
                    {r.label}
                  </button>
                ))}
                {content.docHref && (
                  // Internal /docs links open in same tab for SPA-like
                  // navigation; external (http://) links open in a new tab.
                  <a
                    className="btn btn-ghost"
                    style={{ fontSize: 13, height: 26, lineHeight: "24px", padding: "0 10px" }}
                    href={content.docHref}
                    {...(content.docHref.startsWith("http")
                      ? { target: "_blank", rel: "noopener" }
                      : {})}
                  >
                    {content.docHref.startsWith("http") ? "Docs ↗" : "Read more →"}
                  </a>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
