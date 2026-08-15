"use client";

import { ThemeToggle } from "@/components/brain/theme-toggle";
import { useLang, useSetLang, type Lang } from "@/lib/brain/i18n";

const OPTIONS: ReadonlyArray<{ code: Lang; label: string; aria: string }> = [
  { code: "en", label: "EN", aria: "English" },
  { code: "th", label: "ไทย", aria: "ภาษาไทย (Thai)" },
  { code: "de", label: "DE", aria: "Deutsch (German)" },
];

/**
 * Minimal locale switcher for the unauth surfaces (#3). Fixed top-right so it
 * sits clear of the centered auth/onboarding cards without needing per-page
 * layout work. The authed app keeps its own picker in the tweaks panel.
 */
export function LocalePicker() {
  const lang = useLang();
  const setLang = useSetLang();
  return (
    <div
      // Hosts BOTH unauth controls (theme + language). One fixed pill rather
      // than two fixed elements: a second element would have to hard-code
      // this one's width into its `right` offset, which silently overlaps the
      // moment either control changes size. The outer element is therefore no
      // longer a "Language" group — the language buttons keep their own.
      aria-label="Display settings"
      role="group"
      style={{
        position: "fixed",
        top: 14,
        right: 14,
        display: "flex",
        gap: 2,
        zIndex: 50,
        padding: 2,
        borderRadius: 8,
        background: "var(--bg-elev-1, #171820)",
        border: "1px solid var(--line, #23242c)",
      }}
    >
      <ThemeToggle />
      {/* Hairline divider so the two control types read as distinct. */}
      <span
        aria-hidden="true"
        style={{
          width: 1,
          alignSelf: "stretch",
          background: "var(--line, #23242c)",
          margin: "0 2px",
        }}
      />
      <span
        role="group"
        aria-label="Language"
        style={{ display: "flex", gap: 2 }}
      >
        {OPTIONS.map((o) => {
          const active = lang === o.code;
          return (
            <button
              key={o.code}
              type="button"
              lang={o.code}
              aria-label={o.aria}
              aria-pressed={active}
              onClick={() => setLang(o.code)}
              style={{
                appearance: "none",
                cursor: "pointer",
                fontSize: 12,
                lineHeight: 1,
                padding: "6px 8px",
                borderRadius: 6,
                border: "none",
                background: active ? "var(--accent, #D8FF3E)" : "transparent",
                color: active
                  ? "var(--accent-ink, #0A0A0B)"
                  : "var(--ink-3, #9a9cab)",
                fontWeight: active ? 600 : 500,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}
