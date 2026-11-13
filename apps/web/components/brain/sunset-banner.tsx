/**
 * The service-sunset notice at the top of every page (docs/SUNSET.md).
 *
 * Rendered from the root layout, so the public pages and the signed-in shell
 * both carry it; renders nothing unless `SERVICE_SUNSET_AT` is set. A server
 * component — the setting is read per request, never inlined into the client
 * bundle at build time (#293).
 *
 * On desktop the shell pins itself to the viewport, so the banner has a fixed
 * height and `globals.css` shrinks `.app` by exactly that much; the links sit
 * outside the truncating text so they stay reachable at any width.
 */
import { serviceSunset, sunsetPhase, SELF_HOST_GUIDE_URL } from "@brain/core/sunset";
import { getServerLang, getServerT } from "@/lib/brain/i18n-server";
import type { Lang } from "@/lib/brain/i18n-dict";

const LOCALE: Record<Lang, { locale: string; timeZone: string }> = {
  en: { locale: "en-GB", timeZone: "UTC" },
  th: { locale: "th-TH", timeZone: "Asia/Bangkok" },
  de: { locale: "de-DE", timeZone: "Europe/Berlin" },
};

export async function SunsetBanner() {
  const sunset = serviceSunset();
  if (!sunset) return null;
  const [t, lang] = await Promise.all([getServerT(), getServerLang()]);
  const { locale, timeZone } = LOCALE[lang];
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone, timeZoneName: "short",
  }).format(sunset.at);
  const deleteDate = new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", year: "numeric", timeZone,
  }).format(sunset.deleteAt);
  const ended = sunsetPhase(sunset) === "closed";
  const key = sunset.kind === "trial"
    ? (ended ? "sunset.bannerTrialEnded" : "sunset.bannerTrial")
    : (ended ? "sunset.bannerClosureEnded" : "sunset.bannerClosure");
  const message = t(key, { date, deleteDate });

  return (
    <aside className="sunset-banner" aria-label={t("sunset.label")}>
      <span className="sunset-banner-text" title={message}>{message}</span>
      <span className="sunset-banner-links">
        <a href="/settings/data">{t("sunset.download")}</a>
        <a href={SELF_HOST_GUIDE_URL} target="_blank" rel="noopener noreferrer">{t("sunset.selfHost")} ↗</a>
      </span>
    </aside>
  );
}
