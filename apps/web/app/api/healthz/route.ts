/**
 * Liveness probe. Returns 200 if the process is responsive.
 * Deliberately does NOT touch the DB — readyz does that. This lets
 * orchestrators distinguish "pod alive but DB slow" (readyz fails,
 * healthz passes) from "pod wedged" (both fail).
 *
 * `version` is the build's `git describe` (baked via NEXT_PUBLIC_APP_VERSION
 * — same source as the rail footer). The prod-drift workflow compares it to
 * `main` so a fixed-on-main-but-not-deployed gap gets flagged instead of
 * sitting invisible (the v1.2.x stale-deploy #418 lesson). Disclosing the
 * running version on a liveness probe is deliberate: the repo is public, so
 * the tag reveals nothing an attacker can't read from the source.
 *
 * `environment` is this deployment's own declaration of which tier it is
 * ("production" | "dev" | anything an operator sets). It exists because a
 * version number alone cannot answer "did I just measure the right box?" —
 * and for months, nobody could. `BRAIN_DEPLOY_URL` pointed at the dev host,
 * so the prod-drift watchdog reported dev's version under a "Production is
 * running X" title and looked healthy the entire time (KNOWN_ISSUES §0al).
 * The watchdog now asserts this field equals the tier it intends to watch,
 * which turns that misconfiguration from silent into a red run.
 *
 * Two deliberate choices:
 *  - It is a SEPARATE variable, not the existing `ENVIRONMENT`. On the live
 *    prod host `.env` carries `ENVIRONMENT=dev` as a leftover label — reusing
 *    it would have made the guard confidently declare production to be dev,
 *    i.e. reproduce the exact bug it exists to catch, one layer deeper.
 *  - It reports a tier label, never the hostname. The repo intentionally does
 *    not publish its deployment hostname, and this value ends up in public
 *    workflow logs and issue bodies; "production" discloses nothing.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({
    ok: true,
    version: process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "dev",
    // Absent (rather than guessed) when unset: the watchdog treats a missing
    // value as "cannot verify" and refuses to report drift, which fails safe.
    // Defaulting it to "production" would restore the false confidence.
    environment: process.env.BRAIN_DEPLOY_ENV?.trim() || null,
  });
}
