/**
 * Oracle retrieval status line — "5 items retrieved · 2 cited".
 *
 * The counts are NOT baked into the dictionary values: each string carries a
 * `{n}` placeholder that is substituted at render time. A dictionary entry has
 * to stay correct for every possible value of the data behind it, so a literal
 * number in a locale string is always a bug waiting to happen.
 */

// ---------------------------------------------------------------------------
// Dictionary entries (English)
// ---------------------------------------------------------------------------

export const en = {
  // Retrieval count. Two plural forms so "1 item retrieved" reads correctly.
  'oracle.status.retrieved_one': '{n} item retrieved',
  'oracle.status.retrieved_other': '{n} items retrieved',

  // Citation count — a SEPARATE key, rendered conditionally, so the segment can
  // be omitted entirely when nothing was cited (rather than showing "0 cited").
  'oracle.status.cited': '{n} cited',

  // Separator lives in the dictionary too: some locales prefer a comma or a
  // full-width middle dot over "·".
  'oracle.status.separator': ' · ',

  // Shown instead of the whole line when retrieval returned nothing.
  'oracle.status.empty': 'No knowledge retrieved',
} as const;

export type OracleStatusKey = keyof typeof en;

// ---------------------------------------------------------------------------
// Interpolation helper (the generic one your `t()` already exposes)
// ---------------------------------------------------------------------------

type Vars = Record<string, string | number>;

export function t(
  dict: Record<string, string>,
  key: string,
  vars?: Vars,
): string {
  const template = dict[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Picks the plural variant, then interpolates. */
function tPlural(
  dict: Record<string, string>,
  baseKey: string,
  n: number,
): string {
  const form = new Intl.PluralRules('en').select(n); // 'one' | 'other'
  const key = `${baseKey}_${form}`;
  return t(dict, key in dict ? key : `${baseKey}_other`, { n });
}

// ---------------------------------------------------------------------------
// Component usage
// ---------------------------------------------------------------------------

/**
 * Composes the line from real counts: "5 items retrieved · 2 cited", or just
 * "5 items retrieved" when nothing was cited, or the empty-state string when
 * nothing was retrieved. The cited segment is a conditional append, not a
 * hard-coded tail on the retrieved string.
 */
export function oracleStatusLine(
  dict: Record<string, string>,
  retrievedCount: number,
  citedCount: number,
): string {
  if (retrievedCount === 0) return t(dict, 'oracle.status.empty');

  const retrieved = tPlural(dict, 'oracle.status.retrieved', retrievedCount);
  if (citedCount === 0) return retrieved;

  return (
    retrieved +
    t(dict, 'oracle.status.separator') +
    t(dict, 'oracle.status.cited', { n: citedCount })
  );
}

// oracleStatusLine(en, 5, 2) -> "5 items retrieved · 2 cited"
// oracleStatusLine(en, 1, 0) -> "1 item retrieved"
// oracleStatusLine(en, 0, 0) -> "No knowledge retrieved"

/*
 * Component usage (lives in a .tsx file):
 *
 *   export function OracleStatusLine({ retrievedCount, citedCount }: Props) {
 *     const dict = useDictionary();
 *     return (
 *       <p className="oracle-status">
 *         {oracleStatusLine(dict, retrievedCount, citedCount)}
 *       </p>
 *     );
 *   }
 *
 * If the cited segment needs its own markup (e.g. a link to the citations),
 * render the pieces instead of the joined string — same keys, same guard:
 *
 *   {tPlural(dict, 'oracle.status.retrieved', retrievedCount)}
 *   {citedCount > 0 && (
 *     <>
 *       {t(dict, 'oracle.status.separator')}
 *       <button onClick={scrollToCitations}>
 *         {t(dict, 'oracle.status.cited', { n: citedCount })}
 *       </button>
 *     </>
 *   )}
 */
