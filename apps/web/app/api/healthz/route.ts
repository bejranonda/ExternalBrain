/**
 * Liveness probe. Returns 200 if the process is responsive.
 * Deliberately does NOT touch the DB — readyz does that. This lets
 * orchestrators distinguish "pod alive but DB slow" (readyz fails,
 * healthz passes) from "pod wedged" (both fail).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ ok: true });
}
