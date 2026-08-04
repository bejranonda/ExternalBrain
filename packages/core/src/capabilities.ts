/**
 * MCP token capabilities.
 *
 * The primitive proposed *instead of* partitioning `Skill` by project
 * (KNOWN_ISSUES §0q): when the worry is "a contractor's token can read my
 * skills", the answer is to bound what the token may do, not to reshape the
 * data model. One column, no backfill, and it generalises to every read
 * surface added later.
 *
 * ## The empty-array contract
 *
 * `capabilities = []` means **unrestricted**. That is what makes this safe on
 * a live table — every token that existed before the column keeps exactly the
 * authority it had, and there is no ambiguous value to backfill. A non-empty
 * array is an allow-list.
 *
 * Deliberately *not* a deny-list: with a deny-list, every capability added in
 * future silently becomes permitted on every existing restricted token. An
 * allow-list fails closed as the surface grows, which is the direction you
 * want a security primitive to fail.
 *
 * ## What is NOT restrictable, and why
 *
 * The session-lifecycle tools — `brain_start_session`, `brain_log_event`,
 * `brain_report_session_outcome`, and the project tools — carry no capability.
 * A token that cannot open a session is not a token; restricting them would
 * produce a credential that authenticates and can do nothing, which is a
 * confusing way to spell "revoked". Scope restriction there is
 * `MCPToken.projectId`'s job (§12.21).
 */

/** Capability slugs. Add here AND wire the check, or the slug is a no-op. */
export const CAPABILITIES = ["knowledge", "skills", "sessions", "oracle"] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Human-facing labels for the token UI. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  knowledge: "Read & teach knowledge",
  skills: "Read skills",
  sessions: "Search past sessions",
  oracle: "Ask the Oracle (billed)",
};

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Does a token holding `granted` may exercise `needed`?
 *
 * Empty `granted` → unrestricted → always true. This is the single place that
 * decision is made; every caller must go through it rather than testing
 * `.includes()` directly, or the empty-means-unrestricted contract ends up
 * reimplemented (and eventually mis-implemented) per call site.
 */
export function hasCapability(granted: string[], needed: Capability): boolean {
  if (granted.length === 0) return true;
  return granted.includes(needed);
}

/** Drop unknown slugs — the API accepts user input and the DB column is free-form TEXT[]. */
export function sanitizeCapabilities(input: unknown): Capability[] {
  if (!Array.isArray(input)) return [];
  const out = input.filter((v): v is Capability => typeof v === "string" && isCapability(v));
  // De-dupe so `["skills","skills"]` cannot make an allow-list look longer
  // than it is in the UI.
  return [...new Set(out)];
}
