"use client";

import { useCallback, useEffect, useState } from "react";
import type { Lang } from "./i18n";

export type Theme = "dark" | "light";
export type AccentKey = "lime" | "violet" | "coral" | "blue";
export type Density = "spacious" | "balanced" | "dense";

export interface TweakState {
  theme: Theme;
  accent: AccentKey;
  density: Density;
  language: Lang;
}

export const ACCENTS: Record<AccentKey, { c: string; ink: string }> = {
  lime: { c: "#D8FF3E", ink: "#0A0A0B" },
  violet: { c: "#C5A8FF", ink: "#0A0A0B" },
  coral: { c: "#FF9571", ink: "#0A0A0B" },
  blue: { c: "#7EC8FF", ink: "#0A0A0B" },
};

export const DEFAULT_TWEAKS: TweakState = {
  theme: "dark",
  accent: "lime",
  density: "balanced",
  language: "en",
};

const STORAGE_KEY = "bp_tweaks";

export function applyTweaks(state: TweakState) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", state.theme);
  root.setAttribute("lang", state.language);
  root.setAttribute("data-density", state.density);
  const a = ACCENTS[state.accent] ?? ACCENTS.lime;
  root.style.setProperty("--accent", a.c);
  root.style.setProperty("--accent-ink", a.ink);
  root.style.setProperty("--accent-soft", `${a.c}24`);
  root.style.setProperty("--accent-wash", `${a.c}10`);
}

export function useTweaks(): [TweakState, (patch: Partial<TweakState>) => void] {
  const [state, setState] = useState<TweakState>(DEFAULT_TWEAKS);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TweakState>;
        // Validate language against the current Lang union — anything
        // unrecognised (forward-compat) falls back to the user's previous
        // setting or DEFAULT_TWEAKS.
        const VALID_LANGS: ReadonlyArray<"en" | "th" | "de"> = ["en", "th", "de"];
        const lang =
          parsed.language && VALID_LANGS.includes(parsed.language)
            ? parsed.language
            : DEFAULT_TWEAKS.language;
        const merged: TweakState = { ...DEFAULT_TWEAKS, ...parsed, language: lang };
        setState(merged);
        applyTweaks(merged);
        return;
      }
    } catch {
      /* ignore malformed state */
    }
    applyTweaks(DEFAULT_TWEAKS);
  }, []);

  const update = useCallback((patch: Partial<TweakState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / private mode */
      }
      applyTweaks(next);
      return next;
    });
  }, []);

  return [state, update];
}
