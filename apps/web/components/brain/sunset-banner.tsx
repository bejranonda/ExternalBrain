/**
 * The service-sunset notice at the top of every page (docs/SUNSET.md).
 *
 * Rendered from the root layout, so the public pages and the signed-in shell
 * both carry it; renders nothing unless `SERVICE_SUNSET_AT` is set. A server
 * component — the setting is read per request, never inlined into the client
 * bundle at build time (#293).
 *
 * On desktop the shell pins itself to the viewport, so the banner has a fixed
 * height (two lines) and `globals.css` shrinks `.app` by exactly that much;
 * the links sit outside the clamped text so they stay reachable at any width.
 * No `title` on the text: `span[title]` is the app's jargon-tip affordance.
 */
import { serviceSunset, sunsetPhase, SELF_HOST_GUIDE_URL } from "@brain/core/sunset";
import { getServerLang, getServerT } from "@/lib/brain/i18n-server";
import type { Lang } from "@/lib/brain/i18n-dict";

// Thai reads "19:00 น." — the zone name ICU appends ("GMT+7") is not how a
// Thai reader writes a time; the date is in Bangkok time regardless.
const LOCALE: Record<Lang, { locale: string; timeZone: string; zoneName: boolean; suffix: string }> = {
  en: { locale: "en-GB", timeZone: "UTC", zoneName: true, suffix: "" },
  th: { locale: "th-TH", timeZone: "Asia/Bangkok", zoneName: false, suffix: " น." },
  de: { locale: "de-DE", timeZone: "Europe/Berlin", zoneName: true, suffix: "" },
};

export async function SunsetBanner() {
  const sunset = serviceSunset();
  if (!sunset) return null;
  const [t, lang] = await Promise.all([getServerT(), getServerLang()]);
  const { locale, timeZone, zoneName, suffix } = LOCALE[lang];
  const date = new Intl.DateTimeFormat(locale, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone, ...(zoneName ? { timeZoneName: "short" as const } : {}),
  }).format(sunset.at) + suffix;
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
      <span className="sunset-banner-text">{message}</span>
      <span className="sunset-banner-links">
        <a href="/settings/data">{t("sunset.download")}</a>
        <a href={SELF_HOST_GUIDE_URL} target="_blank" rel="noopener noreferrer">{t("sunset.selfHost")} ↗</a>
      </span>
    </aside>
  );
}
