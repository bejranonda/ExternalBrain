"use client";

import { createContext, useContext } from "react";
import { I18N, translate, type Lang, type Vars } from "./i18n-dict";

// Re-exported so every existing `from "@/lib/brain/i18n"` import keeps working.
export { I18N, translate };
export type { Lang, Vars };


export const LangContext = createContext<Lang>("en");
export function useLang() {
  return useContext(LangContext);
}

/**
 * Setter side of the locale context. Provided by <LangProvider> (root layout)
 * so any surface — including the unauth ones (/signin, /welcome, …) that live
 * outside the authed app shell — can switch language. Defaults to a no-op so
 * components rendered without a provider degrade gracefully.
 */
export const SetLangContext = createContext<(lang: Lang) => void>(() => {});
export function useSetLang() {
  return useContext(SetLangContext);
}
export function useT() {
  const lang = useLang();
  return (path: string, vars?: Vars) => translate(lang, path, vars);
}

