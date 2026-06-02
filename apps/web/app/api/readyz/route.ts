/**
 * Readiness probe. Returns 200 if we can reach Postgres with a trivial
 * query within a short budget (1.5s). Non-200 tells orchestrators to
 * stop routing traffic here until the DB comes back.
 *
 * Does not check LLM providers — those are user-facing failure modes,
 * not process-health ones. A web instance with no LLM connectivity can
 * still serve Dashboard / Skills / Graph / Sessions correctly.
 */
import { db } from "@brain/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 1_500;

export async function GET(): Promise<Response> {
  const deadline = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), TIMEOUT_MS),
  );
  try {
    const res = await Promise.race([
      db.$queryRawUnsafe<Array<{ one: number }>>(`SELECT 1 AS one`),
      deadline,
    ]);
    if (res === "timeout") {
      return Response.json({ ok: false, reason: "db_timeout" }, { status: 503 });
    }
    return Response.json({ ok: true, db: "up" });
  } catch (err) {
    return Response.json(
      { ok: false, reason: "db_error", message: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
