/**
 * Oracle status line — "N items retrieved · M cited"
 *
 * Dictionary entries live in the centralised per-locale dictionary object.
 * Only the English entries are given here; other locales copy the same keys.
 */

// ---------------------------------------------------------------------------
// Dictionary entries (en)
// ---------------------------------------------------------------------------

export const en = {
  // ...existing keys

  /** Singular / plural halves are separate keys so locales can diverge. */
  'oracle.status.retrieved.one': '{count} item retrieved',
  'oracle.status.retrieved.other': '{count} items retrieved',
  'oracle.status.cited': '{count} cited',

  /** Joins the two halves; the separator is part of the string so RTL and
   *  locales that prefer a comma can override it. */
  'oracle.status.line': '{retrieved} · {cited}',

  /** Shown when retrieval returned nothing at all. */
  'oracle.status.empty': 'No knowledge retrieved',

  // ...existing keys
} as const;

// ---------------------------------------------------------------------------
// Rendering with real counts
// ---------------------------------------------------------------------------

type Dict = typeof en;
type Key = keyof Dict;

/** Whatever the app already uses — shown here for completeness. */
declare function t<K extends Key>(
  key: K,
  vars?: Record<string, string | number>,
): string;

export function OracleStatusLine({
  retrievedCount,
  citedCount,
}: {
  retrievedCount: number;
  citedCount: number;
}) {
  if (retrievedCount === 0) {
    return <p className="text-sm text-muted-foreground">{t('oracle.status.empty')}</p>;
  }

  const retrieved = t(
    retrievedCount === 1
      ? 'oracle.status.retrieved.one'
      : 'oracle.status.retrieved.other',
    { count: retrievedCount },
  );
  const cited = t('oracle.status.cited', { count: citedCount });

  return (
    <p className="text-sm text-muted-foreground">
      {t('oracle.status.line', { retrieved, cited })}
    </p>
  );
}

// OracleStatusLine({ retrievedCount: 5, citedCount: 2 }) -> "5 items retrieved · 2 cited"
// OracleStatusLine({ retrievedCount: 1, citedCount: 0 }) -> "1 item retrieved · 0 cited"
