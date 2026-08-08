import { cookies } from "next/headers";
import { translate, type Lang, type Vars } from "./i18n-dict";

/**
 * Server-side translation for the auth surfaces.
 *
 * `/signin`, `/forgot-password`, `/reset-password` and `/accept-invite` are
 * async **server** components — they use server actions and fetch invite
 * metadata before rendering — so they cannot call `useT()`, which is a client
 * hook reading React context. Until this existed they had no route to the
 * dictionary at all, and every string on them was a hardcoded English literal
 * while the language picker sat in the corner doing nothing.
 *
 * Resolution matches the root layout exactly (same cookie, same fallback), so
 * `<html lang>` and the page copy can never disagree about the language.
 *
 * Pairs with `router.refresh()` in `LangProvider`: the cookie decides what the
 * server renders, and the refresh is what makes a switch take effect without a
 * manual reload.
 */
export async function getServerLang(): Promise<Lang> {
  const raw = (await cookies()).get("bp_lang")?.value;
  return raw === "th" || raw === "de" ? raw : "en";
}

/**
 * `const t = await getServerT();` then `t("auth.signIn")` — same call shape as
 * the client `useT()`, so the two surfaces read alike.
 */
export async function getServerT(): Promise<(path: string, vars?: Vars) => string> {
  const lang = await getServerLang();
  return (path: string, vars?: Vars) => translate(lang, path, vars);
}
