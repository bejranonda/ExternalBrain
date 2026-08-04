/**
 * GET /api/admin/queue-health — is the background pipeline actually working?
 *
 * A dead-letter queue nobody reads is the same defect it was meant to fix.
 * Before v2.11.0 an exhausted job moved to `failed` in `pgboss.job` and
 * stopped existing as far as the platform was concerned: no surface, no cron
 * check, no alert. This is the reader.
 *
 * Modelled on `/api/admin/backup-status`, and for the same reason — the
 * three-week silent backup failure (KNOWN_ISSUES §0f) was solved by a status
 * endpoint plus an admin tile, because a failure with no surface is
 * indistinguishable from success.
 *
 * Two signals:
 *   1. **Dead-letter depth + age.** Anything here is work that was retried to
 *      exhaustion and lost. `warn` fires on the first entry — unlike backups
 *      there is no "acceptable staleness"; one dead job is already a fact
 *      someone should see.
 *   2. **Per-queue failed counts (24 h).** Catches the shape where jobs fail
 *      and retry successfully — invisible in the DLQ, but a rising failure
 *      rate is the early warning that precedes the first dead letter.
 *
 * Auth: platform admin only.
 */
import { db } from "@brain/db";
import { authErrorResponse } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";

export const dynamic = "force-dynamic";

/** Must match DEAD_LETTER_QUEUE in apps/worker/src/index.ts. */
const DLQ = "dlq";

interface QueueRow {
  name: string;
  failed24h: number;
}

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();

    // pg-boss owns its schema, so this is raw SQL by necessity. The schema
    // name comes from env, never from the request — it is interpolated, so it
    // must never become caller-controlled.
    const schema = (process.env.PG_BOSS_SCHEMA ?? "pgboss").replace(
      /[^a-zA-Z0-9_]/g,
      "",
    );

    const [dlq] = await db.$queryRawUnsafe<
      Array<{ depth: bigint; oldest: Date | null }>
    >(
      `SELECT count(*)::bigint AS depth, min(created_on) AS oldest
         FROM "${schema}".job
        WHERE name = $1 AND state < 'completed'`,
      DLQ,
    );

    const failedRows = await db.$queryRawUnsafe<
      Array<{ name: string; failed24h: bigint }>
    >(
      `SELECT name, count(*)::bigint AS "failed24h"
         FROM "${schema}".job
        WHERE state = 'failed'
          AND created_on > now() - interval '24 hours'
        GROUP BY name
        ORDER BY 2 DESC`,
    );

    const depth = Number(dlq?.depth ?? 0);
    const oldest = dlq?.oldest ?? null;
    const oldestAgeSeconds = oldest
      ? Math.max(0, Math.floor((Date.now() - new Date(oldest).getTime()) / 1000))
      : null;

    const queues: QueueRow[] = failedRows
      .filter((r) => r.name !== DLQ)
      .map((r) => ({ name: r.name, failed24h: Number(r.failed24h) }));

    return Response.json({
      // One dead letter is already worth surfacing — there is no threshold
      // below which losing a user's extraction is fine.
      ok: depth === 0,
      deadLetter: { queue: DLQ, depth, oldestAgeSeconds },
      failedLast24h: queues,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
