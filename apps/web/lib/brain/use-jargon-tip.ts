"use client";

import { useEffect } from "react";

/**
 * Native title="…" attributes are unreliable on touch devices: iOS Safari
 * ignores them entirely, Android long-press is inconsistent. Phase 7
 * jargon tooltips (MCP, SQS, KEA, NDCG, model, ingest queue) become
 * dead UI on phones unless we add a tap path.
 *
 * This hook attaches one delegated click listener that toggles a
 * data-tip-open attribute on jargon spans, which CSS turns into a
 * positioned ::after popover rendering attr(title). Pointer-quality
 * UAs still get the native hover tooltip + dotted underline; touch
 * UAs get the same content via tap.
 */
export function useJargonTipReveal() {
  useEffect(() => {
    const SKIP_CLASSES = ["chip", "dot", "live-dot"];

    const isJargonSpan = (el: Element | null): el is HTMLSpanElement => {
      if (!(el instanceof HTMLSpanElement)) return false;
      if (!el.hasAttribute("title")) return false;
      for (const c of SKIP_CLASSES) if (el.classList.contains(c)) return false;
      return true;
    };

    const closeAll = (except?: Element | null) => {
      document
        .querySelectorAll('span[data-tip-open="true"]')
        .forEach((el) => {
          if (el !== except) el.removeAttribute("data-tip-open");
        });
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const tip = target?.closest("span[title]") ?? null;
      if (isJargonSpan(tip)) {
        const open = tip.getAttribute("data-tip-open") === "true";
        closeAll(open ? null : tip);
        if (!open) tip.setAttribute("data-tip-open", "true");
        return;
      }
      closeAll();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAll();
    };

    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
}
