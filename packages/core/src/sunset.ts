/**
 * Service sunset (docs/SUNSET.md) — an instance announcing that it will close.
 *
 * One setting drives every surface: `SERVICE_SUNSET_AT`. While it is set the
 * web app shows a banner and closes signups, every MCP tool response carries a
 * `serviceNotice`, and the worker emails each account at three stages. Unset,
 * nothing changes — the feature is invisible to an instance that is not
 * closing.
 *
 *   SERVICE_SUNSET_AT          ISO instant the instance stops answering
 *   SERVICE_SUNSET_DELETE_AT   ISO instant all data is deleted (default AT + 30 days)
 *   SERVICE_SUNSET_KIND        `trial` (a hosted trial ending) | `closure` (default)
 *
 * Pure: no database, no logger — the MCP server, web and worker all import it,
 * and a malformed value is reported back for the caller to log rather than
 * thrown, so a typo cannot take a running instance down.
 */

export type SunsetKind = "trial" | "closure";
export type SunsetPhase = "notice" | "closed";
export type SunsetEmailStage = "announce" | "week" | "final";

export interface ServiceSunset {
  at: Date;
  deleteAt: Date;
  kind: SunsetKind;
}

export type SunsetParse =
  | { ok: true; sunset: ServiceSunset | null }
  | { ok: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_RETENTION_MS = 30 * DAY_MS;

export const SELF_HOST_REPO_URL = "https://github.com/bejranonda/ExternalBrain";
export const SELF_HOST_GUIDE_URL = `${SELF_HOST_REPO_URL}/blob/main/docs/QUICKSTART.md`;

type Env = Record<string, string | undefined>;

function instant(raw: string | undefined): Date | null | "invalid" {
  const v = raw?.trim();
  if (!v) return null;
  // Date.parse accepts "2026-12-14" and reads it as UTC midnight, which is a
  // reasonable reading of a bare date; anything it cannot read is rejected.
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? "invalid" : new Date(ms);
}

export function parseServiceSunset(env: Env = process.env): SunsetParse {
  const at = instant(env.SERVICE_SUNSET_AT);
  if (at === null) return { ok: true, sunset: null };
  if (at === "invalid") return { ok: false, error: "SERVICE_SUNSET_AT is not a date" };
  const del = instant(env.SERVICE_SUNSET_DELETE_AT);
  if (del === "invalid") return { ok: false, error: "SERVICE_SUNSET_DELETE_AT is not a date" };
  if (del !== null && del < at) {
    return { ok: false, error: "SERVICE_SUNSET_DELETE_AT is before SERVICE_SUNSET_AT" };
  }
  // Strict, like scripts/sunset.sh's renderer: a typo is reported, not
  // quietly worded as the other kind.
  const rawKind = env.SERVICE_SUNSET_KIND?.trim().toLowerCase() || "closure";
  if (rawKind !== "trial" && rawKind !== "closure") {
    return { ok: false, error: "SERVICE_SUNSET_KIND must be trial or closure" };
  }
  const kind: SunsetKind = rawKind;
  return {
    ok: true,
    sunset: { at, deleteAt: del ?? new Date(at.getTime() + DEFAULT_RETENTION_MS), kind },
  };
}

/** The configured sunset, or null when none is set or the setting is malformed. */
export function serviceSunset(env: Env = process.env): ServiceSunset | null {
  const parsed = parseServiceSunset(env);
  return parsed.ok ? parsed.sunset : null;
}

export function sunsetPhase(sunset: ServiceSunset, now: Date = new Date()): SunsetPhase {
  return now < sunset.at ? "notice" : "closed";
}

/**
 * Which notice email is due at `now`: the announcement until a week out, a
 * reminder in the last week, a final one in the last day, nothing after.
 * Each email carries the whole message, so an account first reached in the
 * last week loses nothing by never getting the announcement.
 */
export function sunsetEmailStage(sunset: ServiceSunset, now: Date = new Date()): SunsetEmailStage | null {
  const left = sunset.at.getTime() - now.getTime();
  if (left <= 0) return null;
  if (left <= DAY_MS) return "final";
  if (left <= 7 * DAY_MS) return "week";
  return "announce";
}

/** "Mon, 14 Dec 2026, 12:00 UTC" — unambiguous across the instance's readers. */
export function formatSunsetInstant(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(d);
}

export function formatSunsetDate(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * The text every MCP tool response carries as `serviceNotice`. Written to the
 * agent, not the user: the agent is the only reader, and it is asked to pass
 * the message on once, in the user's language, rather than on every call.
 */
export function sunsetMcpNotice(
  sunset: ServiceSunset,
  opts: { webUrl?: string | null; now?: Date } = {},
): string {
  const host = opts.webUrl ? opts.webUrl.replace(/^https?:\/\//, "") : "this server";
  const what = sunset.kind === "trial" ? `The hosted External Brain trial at ${host}` : `External Brain at ${host}`;
  const when = formatSunsetInstant(sunset.at);
  const dataUrl = opts.webUrl ? `${opts.webUrl}/settings/data` : "Settings → Your data";
  const head =
    sunsetPhase(sunset, opts.now) === "notice"
      ? `${what} ${sunset.kind === "trial" ? "ends" : "closes"} on ${when}.`
      : `${what} ${sunset.kind === "trial" ? "ended" : "closed"} on ${when} and is about to stop answering.`;
  return (
    `${head} Tell the user once, in their language (not on every call): ` +
    `download their knowledge at ${dataUrl} (Markdown for CLAUDE.md/AGENTS.md, ` +
    `or JSON to import into their own Brain). External Brain is open source — ` +
    `they can run their own instance (${SELF_HOST_GUIDE_URL}) and import the JSON there. ` +
    `After that date remove this server from the client (Claude Code: \`claude mcp remove brain\`). ` +
    `All accounts and data are deleted on ${formatSunsetDate(sunset.deleteAt)}.`
  );
}
