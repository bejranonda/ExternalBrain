/**
 * Oracle retrieval status line — dictionary entries + render snippet.
 *
 * Renders as: "5 items retrieved · 2 cited"  (or just "5 items retrieved"
 * when nothing was cited, and "1 item retrieved · 1 cited" in the singular).
 *
 * Invariant: no count ever lives inside a dictionary string. Every number
 * arrives as a `{count}` substitution interpolated at render time, and the
 * "cited" half is a separate trailing key behind a conditional render — so a
 * future reader of the dictionary can never find a stale hard-coded number.
 */

// ---------------------------------------------------------------------------
// 1. Dictionary entries (apps/web/lib/brain/i18n.ts — `en` locale object)
//    Add the same four keys to every supported locale (de, th) when landing
//    this for real; the shapes below are the English source strings.
// ---------------------------------------------------------------------------

export const en = {
  // ... existing keys ...

  'oracle.status.retrieved': '{count} items retrieved',
  'oracle.status.retrieved.one': '1 item retrieved',
  'oracle.status.cited': '{count} cited',
  'oracle.status.separator': ' · ',
} as const;

// ---------------------------------------------------------------------------
// 2. Types + the interpolating `t()` the dictionary is read through.
//    (In the real repo these already exist in lib/brain/i18n.ts — reproduced
//    here only so this file is self-contained and typechecks standalone.)
// ---------------------------------------------------------------------------

export type MessageKey = keyof typeof en;

type Vars = Record<string, string | number>;

export function t(key: MessageKey, vars?: Vars): string {
  const template: string = en[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

// `useT()` is the client-component wrapper that binds the active locale and
// returns a `t` with the identical signature.
declare function useT(): typeof t;

// ---------------------------------------------------------------------------
// 3. Component snippet — rendering with real counts.
// ---------------------------------------------------------------------------

interface OracleStatusLineProps {
  retrievedCount: number;
  citedCount: number;
}

export function oracleStatusLine(
  translate: typeof t,
  { retrievedCount, citedCount }: OracleStatusLineProps,
): string {
  const retrieved =
    retrievedCount === 1
      ? translate('oracle.status.retrieved.one')
      : translate('oracle.status.retrieved', { count: retrievedCount });

  // Conditional trailing segment: the "· N cited" half only exists when the
  // Oracle actually cited something, so the separator never dangles.
  return citedCount > 0
    ? retrieved +
        translate('oracle.status.separator') +
        translate('oracle.status.cited', { count: citedCount })
    : retrieved;
}

/*
// JSX usage inside the Oracle answer panel:

export function OracleStatusLine({ retrievedCount, citedCount }: OracleStatusLineProps) {
  const t = useT();
  return (
    <p className="text-xs text-muted-foreground" data-testid="oracle-status-line">
      {oracleStatusLine(t, { retrievedCount, citedCount })}
    </p>
  );
}

// <OracleStatusLine retrievedCount={5} citedCount={2} />  ->  "5 items retrieved · 2 cited"
// <OracleStatusLine retrievedCount={1} citedCount={1} />  ->  "1 item retrieved · 1 cited"
// <OracleStatusLine retrievedCount={5} citedCount={0} />  ->  "5 items retrieved"
*/
