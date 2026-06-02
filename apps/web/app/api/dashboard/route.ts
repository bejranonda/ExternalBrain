import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import { buildKnowledgeWhere, buildSessionWhere, buildProposalWhere } from "@brain/core";
import type { DataScope } from "@brain/core";
import type { DashboardStats } from "@/lib/brain/views";

export interface DashboardPayload {
  stats: DashboardStats;
  typeCounts: Array<{ type: string; count: number }>;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const scope: DataScope = url.searchParams.get("scope") === "all" ? "all" : "project";

    const { projectId } = await getActiveProject(userId);
    const oneWeekAgo = new Date(Date.now() - 7 * 86_400_000);

    // Build shared where clauses (typed as any to avoid exactOptionalPropertyTypes
    // incompatibilities between the dynamic OR structure and Prisma's generated types).
     
    const kw = buildKnowledgeWhere(userId, projectId, scope) as any;
     
    const sw = buildSessionWhere(userId, projectId, scope) as any;
     
    const pw = buildProposalWhere(userId, projectId, scope) as any;

    const [
      activeKnowledge,
      sessionsAllTime,
      sessionsWeek,
      pendingProposals,
      recentSessions,
      latestHealth,
      activeWithEmbedding,
      decayedThisWeek,
      typeCountsRaw,
      bundleStats,
    ] = await Promise.all([
      db.knowledge.count({ where: kw }),
      db.session.count({ where: sw }),
      db.session.count({
        where: { ...sw, startedAt: { gte: oneWeekAgo } },
      }),
      db.autoskillProposal.count({
        where: { ...pw, status: "pending" },
      }),
      // Audit R4 (#103): the SQS trend should reflect ENDED sessions
      // only. Without `endedAt: { not: null }`, in-flight sessions
      // (sqs=null, endedAt=null) sneak in and the post-fetch
      // `.reverse()` may park a stale 0 at the most-recent index,
      // making `sqsCurrent` lie. Match what `oracle.ts:170` does for
      // the same query.
      db.session.findMany({
        where: { ...(sw as object), endedAt: { not: null } } as typeof sw,
        orderBy: { endedAt: "desc" },
        take: 12,
        select: { sqs: true, endedAt: true },
      }),
      db.knowledgeHealthSnapshot.findFirst({
        where: { tenantScope: `user:${userId}` },
        orderBy: { snapshotAt: "desc" },
      }),
      db.knowledge.count({
        where: { ...kw, decayScore: { gt: 0.3 } },
      }),
      // Items currently in low-decay state (decayScore <= 0.3). Audit C18
      // (#113): the previous query intersected this with `lastUsedAt >=
      // oneWeekAgo`, which selected items that were both recently-used AND
      // already at low decay — paradoxical, since recent use should *prevent*
      // decay. We don't currently track WHEN an item crossed below 0.3
      // (would need a `decayedAt` column or a snapshot table — filed as
      // schema follow-up in #103). Until then, surfacing "items currently
      // low-decay" is honest and matches the i18n label.
      db.knowledge.count({
        where: { ...kw, decayScore: { lte: 0.3 } },
      }),
      db.knowledge.groupBy({
        by: ["type"],
        where: kw,
        _count: { _all: true },
      }),
      // Bundle hit-rate: of sessions this week that had an injected knowledge
      // application, how many also had a later extracted/outcome application
      // on the same item. Approximation: ratio of sessions with >=1 accepted
      // injection to sessions with any injection.
      db.sessionKnowledgeApplication.groupBy({
        by: ["sessionId", "role"],
        where: {
          session: sw,
        },
        _count: { _all: true },
      }),
    ]);

    const sqsTrend = recentSessions
      .reverse()
      .map((s) => (typeof s.sqs === "number" ? s.sqs / 100 : 0));
    const sqsCurrent = sqsTrend[sqsTrend.length - 1] ?? 0;

    const knowledgeHealth =
      activeKnowledge > 0 ? activeWithEmbedding / activeKnowledge : 0;

    // Sessions that had both an injected and an extracted role are a proxy
    // for "bundle did get used" — the retrieval paid off.
    const bySession = new Map<string, { injected: boolean; extracted: boolean }>();
    for (const r of bundleStats) {
      const b = bySession.get(r.sessionId) ?? { injected: false, extracted: false };
      if (r.role === "injected") b.injected = true;
      if (r.role === "extracted_from") b.extracted = true;
      bySession.set(r.sessionId, b);
    }
    let withInjection = 0;
    let hit = 0;
    for (const b of bySession.values()) {
      if (b.injected) {
        withInjection += 1;
        if (b.extracted) hit += 1;
      }
    }
    const bundleHitRate = withInjection > 0 ? hit / withInjection : 0;

    const stats: DashboardStats = {
      activeKnowledge,
      sessionsAllTime,
      sessionsWeek,
      sqsCurrent,
      sqsTrend,
      pendingProposals,
      knowledgeHealth: latestHealth?.averageConfidence ?? knowledgeHealth,
      contradictions: latestHealth?.contradictionCount ?? 0,
      decayThisWeek: decayedThisWeek,
      bundleHitRate,
    };

    const typeCounts = typeCountsRaw.map((r) => ({
      type: r.type,
       
      count: (r._count as any)._all as number,
    }));

    return Response.json({ stats, typeCounts } satisfies DashboardPayload);
  } catch (err) {
    return authErrorResponse(err);
  }
}
