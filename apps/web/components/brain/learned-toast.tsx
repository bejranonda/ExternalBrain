"use client";

import { useEffect, useState } from "react";
import type { Route } from "@/lib/brain/routes";
import { useNewExtractions } from "@/lib/brain/use-new-extractions";

const AUTO_DISMISS_MS = 12_000;

/**
 * Floating toast that fires on dashboard mount when KEA has extracted
 * knowledge the user hasn't seen yet. Surfaces the otherwise-invisible
 * value loop — without this, users have to refresh /skills hoping to
 * notice what Brain learned.
 *
 * Renders nothing when there's nothing new (count === 0). Auto-dismisses
 * after 12s; user can close via [×] or jump to /#skills via the CTA.
 */
export function LearnedToast({ go }: { go: (r: Route) => void }) {
  const { count, latestRuleText, dismiss } = useNewExtractions();
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (count === 0) return;
    // Slide-in: defer the "visible" flip by a tick so the initial
    // off-screen transform paints first, then transitions in.
    const showT = window.setTimeout(() => setVisible(true), 20);
    const dismissT = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(() => dismiss(), 220);
    }, AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(showT);
      window.clearTimeout(dismissT);
    };
  }, [count, dismiss]);

  if (!mounted || count === 0 || !latestRuleText) return null;

  const preview =
    latestRuleText.length > 120
      ? `${latestRuleText.slice(0, 117).trimEnd()}…`
      : latestRuleText;

  return (
    <div
      role="status"
      aria-live="polite"
      className="learned-toast"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 200, // var(--z-toast)
        maxWidth: 360,
        background: "var(--bg-elev-2, #1a1a1a)",
        border: "1px solid color-mix(in oklab, var(--violet) 35%, var(--line))",
        borderRadius: 8,
        boxShadow:
          "0 10px 30px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.18)",
        padding: "12px 14px",
        transform: visible ? "translateY(0)" : "translateY(20px)",
        opacity: visible ? 1 : 0,
        transition: "transform 200ms ease-out, opacity 200ms ease-out",
        fontSize: 13,
        lineHeight: 1.45,
        color: "var(--ink-2)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color: "var(--violet)",
            fontSize: 14,
            lineHeight: 1.3,
            flexShrink: 0,
          }}
        >
          ✨
        </span>
        <strong
          style={{
            color: "var(--ink)",
            fontWeight: 500,
            flex: 1,
          }}
        >
          Brain learned something new
        </strong>
        <button
          type="button"
          onClick={() => {
            setVisible(false);
            window.setTimeout(() => dismiss(), 220);
          }}
          aria-label="Dismiss"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--ink-3)",
            cursor: "pointer",
            padding: 0,
            fontSize: 16,
            lineHeight: 1,
            marginLeft: 4,
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          color: "var(--ink-3)",
          fontStyle: "italic",
          marginBottom: 10,
          // Clamp visually; long rule text wraps but the preview is
          // already trimmed to ~120 chars above.
          overflowWrap: "anywhere",
        }}
      >
        &ldquo;{preview}&rdquo;
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{
            fontSize: 12,
            height: 26,
            color: "var(--violet)",
            borderColor:
              "color-mix(in oklab, var(--violet) 30%, var(--line))",
          }}
          onClick={() => {
            setVisible(false);
            dismiss();
            go("skills");
          }}
        >
          Open Skills →
        </button>
      </div>
      <style jsx>{`
        @media (max-width: 720px) {
          .learned-toast {
            left: 16px !important;
            right: 16px !important;
            bottom: 84px !important;
            max-width: none !important;
          }
        }
      `}</style>
    </div>
  );
}
