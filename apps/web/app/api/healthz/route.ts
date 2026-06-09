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
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({
    ok: true,
    version: process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "dev",
  });
}
