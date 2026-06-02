/**
 * Format an ISO timestamp as a short relative-time string for UI surfaces.
 *
 * Branches:
 *   <60s   → "just now"
 *   <60m   → "Nm ago"
 *   <24h   → "Nh ago"
 *   <30d   → "Nd ago"
 *   ≥30d   → "Mmm D" (locale month, numeric day)
 *
 * Falls back to the input string when `iso` is unparseable so callers
 * never blank a row because of upstream bad data.
 *
 * `now` defaults to `Date.now()`; the parameter exists so tests can pin
 * the clock and so callers can pre-compute a render-batch timestamp.
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diffMs = now - then;
  // Floor (not round) so "59 minutes ago" never rounds up to "1h ago".
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(then));
}
