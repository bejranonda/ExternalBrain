/**
 * Connection-status endpoint — proves end-to-end wiring for the user.
 *
 * Returns three things the user needs to validate that their machine is
 * actually talking to this Brain and that knowledge is being captured:
 *
 *   1. Per-token heartbeat — list of the user's active tokens with the
 *      `lastUsedAt` timestamp the auth gate bumps on every authenticated
 *      MCP call. A token is "live" if used in the last 5 minutes. Each
 *      token also carries its own 24h sessions/events count (issue #166).
 *   2. Aggregate ingestion counters (24h) — sessions started, events
 *      received, knowledge items extracted. These remain user-wide so
 *      historical sessions (pre-#166, tokenId NULL) still get counted.
 *   3. KEA queue depth — best-effort raw count from pg-boss. Returns null
 *      if the pgboss schema isn't reachable, so the UI degrades gracefully.
 */
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";

export interface ConnectionStatusToken {
  id: string;
  name: string;
  lastUsedAt: string | null;
  /** True iff lastUsedAt is within LIVE_WINDOW_MS. */
  live: boolean;
  /** Sessions started by this token in the last 24h (issue #166). */
  sessions24h: number;
  /** Events ingested via this token in the last 24h (issue #166). */
  events24h: number;
}

export interface ConnectionStatusPayload {
  tokens: ConnectionStatusToken[];
  liveTokenCount: number;
  totalActiveTokens: number;
  sessions24h: number;
  events24h: number;
  knowledgeExtracted24h: number;
  /** null when the pg-boss schema is unreachable. */
  keaQueueDepth: number | null;
  generatedAt: string;
}

const LIVE_WINDOW_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export async function GET(): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const now = new Date();
    const since24h = new Date(now.getTime() - DAY_MS);
    const liveCutoff = new Date(now.getTime() - LIVE_WINDOW_MS);

    // ── Tokens (active only) ──
    const tokenRows = await db.mCPToken.findMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, name: true, lastUsedAt: true },
      orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    });

    // ── Aggregate counters (user-wide; covers historical sessions
    //    where tokenId is NULL) and per-token grouped counts (#166). ──
    const tokenIds = tokenRows.map((t) => t.id);
    const [sessions24h, events24h, knowledgeExtracted24h, perTokenSessions, perTokenEvents] =
      await Promise.all([
        db.session.count({
          where: { userId, startedAt: { gte: since24h } },
        }),
        db.sessionEvent.count({
          where: { session: { userId }, timestamp: { gte: since24h } },
        }),
        db.knowledge.count({
          where: { ownerUserId: userId, createdAt: { gte: since24h } },
        }),
        tokenIds.length > 0
          ? db.session.groupBy({
              by: ["tokenId"],
              where: {
                userId,
                tokenId: { in: tokenIds },
                startedAt: { gte: since24h },
              },
              _count: { _all: true },
            })
          : Promise.resolve([]),
        tokenIds.length > 0
          ? db.sessionEvent.groupBy({
              by: ["sessionId"],
              where: {
                session: { userId, tokenId: { in: tokenIds } },
                timestamp: { gte: since24h },
              },
              _count: { _all: true },
            })
          : Promise.resolve([]),
      ]);

    // Build session→token lookup so per-token event counts can be summed.
    // Cheap because we only fetch sessions whose events came back above.
    const eventSessionIds = perTokenEvents.map((e) => e.sessionId);
    const eventSessions =
      eventSessionIds.length > 0
        ? await db.session.findMany({
            where: { id: { in: eventSessionIds }, userId },
            select: { id: true, tokenId: true },
          })
        : [];
    const sessionToToken = new Map<string, string | null>(
      eventSessions.map((s) => [s.id, s.tokenId]),
    );
    const eventsByToken = new Map<string, number>();
    for (const row of perTokenEvents) {
      const tid = sessionToToken.get(row.sessionId);
      if (!tid) continue;
      eventsByToken.set(tid, (eventsByToken.get(tid) ?? 0) + row._count._all);
    }
    const sessionsByToken = new Map<string, number>();
    for (const row of perTokenSessions) {
      if (!row.tokenId) continue;
      sessionsByToken.set(row.tokenId, row._count._all);
    }

    const tokens: ConnectionStatusToken[] = tokenRows.map((t) => ({
      id: t.id,
      name: t.name,
      lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
      live: t.lastUsedAt !== null && t.lastUsedAt >= liveCutoff,
      sessions24h: sessionsByToken.get(t.id) ?? 0,
      events24h: eventsByToken.get(t.id) ?? 0,
    }));
    const liveTokenCount = tokens.filter((t) => t.live).length;

    // ── KEA queue depth (best-effort) ──
    let keaQueueDepth: number | null = null;
    try {
      const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
        `select count(*)::bigint as count
           from pgboss.job
          where name = 'kea.extract'
            and state in ('created','active','retry')`,
      );
      const c = rows[0]?.count;
      keaQueueDepth = c != null ? Number(c) : 0;
    } catch {
      // pgboss schema not present or not readable from this role — degrade.
      keaQueueDepth = null;
    }

    const payload: ConnectionStatusPayload = {
      tokens,
      liveTokenCount,
      totalActiveTokens: tokens.length,
      sessions24h,
      events24h,
      knowledgeExtracted24h,
      keaQueueDepth,
      generatedAt: now.toISOString(),
    };

    return Response.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
