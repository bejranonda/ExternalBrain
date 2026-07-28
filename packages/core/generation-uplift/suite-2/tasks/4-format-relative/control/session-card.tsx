// Server Component on purpose: the relative label is computed once during the
// server render and shipped as static HTML. A client component computing
// `Date.now()` during render would hydrate against a different clock and
// produce a mismatch.

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const RELATIVE_UNITS: ReadonlyArray<readonly [number, Intl.RelativeTimeFormatUnit]> = [
  [YEAR, 'year'],
  [MONTH, 'month'],
  [WEEK, 'week'],
  [DAY, 'day'],
  [HOUR, 'hour'],
  [MINUTE, 'minute'],
  [1, 'second'],
];

function formatRelative(from: Date, now: Date, locale?: string): string {
  const seconds = Math.round((from.getTime() - now.getTime()) / 1000);
  const magnitude = Math.abs(seconds);

  if (magnitude < 45) return 'just now';

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const [size, unit] = RELATIVE_UNITS.find(([threshold]) => magnitude >= threshold) ?? [1, 'second'];

  return formatter.format(Math.round(seconds / size), unit);
}

export interface SessionCardProps {
  title: string;
  /** ISO-8601 timestamp, e.g. "2026-07-26T09:12:00.000Z". */
  startedAt: string;
  /** BCP-47 tag; defaults to the runtime locale. */
  locale?: string;
}

export function SessionCard({ title, startedAt, locale }: SessionCardProps) {
  const started = new Date(startedAt);
  const valid = !Number.isNaN(started.getTime());

  return (
    <article className="session-card">
      <h3 className="session-card__title">{title}</h3>
      {valid ? (
        <time className="session-card__time" dateTime={started.toISOString()} title={started.toISOString()}>
          {formatRelative(started, new Date(), locale)}
        </time>
      ) : (
        <span className="session-card__time session-card__time--unknown">Unknown date</span>
      )}
    </article>
  );
}

export default SessionCard;
