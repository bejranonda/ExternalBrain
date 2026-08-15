"use client";

import { useTweaks } from "@/lib/brain/tweaks";

/**
 * Light/dark switch for the unauthenticated surfaces.
 *
 * Why it exists: `<Tweaks>` — the only component with theme buttons — mounts
 * exclusively in the signed-in shell (`components/brain/app.tsx`). Since the
 * first-visit default became light (`KNOWLEDGE.md §12.33`), a visitor who
 * wants dark had no way to get it without creating an account
 * (`KNOWN_ISSUES` — "Anonymous visitors have no way to switch theme").
 *
 * It deliberately reuses `useTweaks()` rather than writing `data-theme`
 * directly, so the anon toggle and the authed panel are ONE source of truth:
 * the choice persists to the same `bp_tweaks` localStorage key and is still
 * there after sign-in. A bespoke writer here would have produced a theme that
 * silently reset the moment you logged in.
 *
 * Rendered inside `<LocalePicker>`'s existing fixed pill rather than as a
 * second fixed element — that avoids hard-coding one control's width into the
 * other's `right` offset (a layout coupling that breaks the moment either
 * changes), and it reaches every unauth surface without touching eight pages.
 */
export function ThemeToggle() {
  const [tweaks, setTweaks] = useTweaks();
  const isDark = tweaks.theme === "dark";
  const next = isDark ? "light" : "dark";

  return (
    <button
      type="button"
      // Not aria-pressed: this is a two-way switch, not a toggle that is
      // on or off — the label states what clicking will do.
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => setTweaks({ theme: next })}
      style={{
        appearance: "none",
        cursor: "pointer",
        fontSize: 12,
        lineHeight: 1,
        padding: "6px 8px",
        borderRadius: 6,
        border: "none",
        background: "transparent",
        color: "var(--ink-3, #9a9cab)",
        display: "flex",
        alignItems: "center",
      }}
    >
      {/* Inline SVG, not an emoji: emoji render at wildly different sizes and
          baselines across platforms, and this sits in a 20px-tall pill. */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {isDark ? (
          // Currently dark → offer sun.
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </>
        ) : (
          // Currently light → offer moon.
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        )}
      </svg>
    </button>
  );
}
