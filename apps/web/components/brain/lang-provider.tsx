"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LangContext, SetLangContext, type Lang } from "@/lib/brain/i18n";

const VALID = ["en", "th", "de"] as const;
function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (VALID as readonly string[]).includes(v);
}

/**
 * App-wide locale provider, mounted at the root layout so EVERY surface
 * (including the unauth ones — /signin, /welcome, /forgot-password,
 * /reset-password, /accept-invite — which render outside the authed app shell)
 * has a working LangContext + a way to switch language. Closes #3.
 *
 * Hydration safety: `initial` is resolved server-side from the `bp_lang`
 * cookie and passed in as a prop, so the first client render uses the exact
 * same value the server rendered → no React #418. localStorage (`bp_tweaks`,
 * the authed app's source of truth) is only consulted AFTER mount, in the
 * effect below — never during the first render. This mirrors the mount-gating
 * pattern used by useEnvLabel / WelcomeFlow elsewhere.
 */
export function LangProvider({
  initial,
  children,
}: {
  initial: Lang;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(initial);
  const router = useRouter();

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    // Persist for the next request's SSR (cookie) and keep the authed app's
    // localStorage store in sync so a choice made here survives sign-in.
    try {
      document.cookie = `bp_lang=${next};path=/;max-age=31536000;samesite=lax`;
    } catch {
      /* cookies disabled */
    }
    try {
      const raw = window.localStorage.getItem("bp_tweaks");
      const t = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      t.language = next;
      window.localStorage.setItem("bp_tweaks", JSON.stringify(t));
    } catch {
      /* quota / private mode */
    }
    try {
      document.documentElement.setAttribute("lang", next);
    } catch {
      /* no document */
    }
    // Re-render the SERVER components with the new cookie.
    //
    // Updating the context only re-renders client components. The auth
    // surfaces (/signin, /forgot-password, /reset-password, /accept-invite)
    // are async server components that read `bp_lang` at request time, so
    // without this their markup keeps the previous language until a manual
    // reload — the picker highlights the new choice and nothing else changes.
    // That was half of why the switcher looked broken; see KNOWN_ISSUES §0af.
    router.refresh();
  }, [router]);

  // Post-mount reconcile: a returning user may have a language saved in
  // localStorage before the cookie ever existed. Adopt it (and write the
  // cookie) so their choice wins on subsequent loads. Runs after the first
  // paint, so it can never desync SSR from the initial hydration.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("bp_tweaks");
      const t = raw ? (JSON.parse(raw) as { language?: unknown }) : null;
      if (t && isLang(t.language) && t.language !== initial) setLang(t.language);
    } catch {
      /* ignore */
    }
  }, [initial, setLang]);

  return (
    <LangContext.Provider value={lang}>
      <SetLangContext.Provider value={setLang}>{children}</SetLangContext.Provider>
    </LangContext.Provider>
  );
}
