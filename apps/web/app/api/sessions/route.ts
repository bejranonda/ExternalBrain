import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import { buildSessionWhere } from "@brain/core";
import type { DataScope } from "@brain/core";
import { toSessionView } from "@/lib/brain/views";

const OUTCOME_MAP: Record<string, string> = {
  accepted: "success",
  partial: "partial",
  rejected: "failed",
};

export async function GET(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const outcome = url.searchParams.get("outcome");
    const client = url.searchParams.get("client");
    const cursor = url.searchParams.get("cursor");
    const dataScope: DataScope =
      url.searchParams.get("scope") === "all" ? "all" : "project";

    const mappedOutcome = outcome ? OUTCOME_MAP[outcome] ?? outcome : undefined;
    const { projectId } = await getActiveProject(userId);
     
    const baseWhere = buildSessionWhere(userId, projectId, dataScope) as any;

    const where = {
      ...baseWhere,
      ...(mappedOutcome ? { outcome: mappedOutcome } : {}),
      ...(client ? { clientType: client } : {}),
    };

    const [rows, total] = await Promise.all([
      db.session.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { project: { select: { name: true } } },
      }),
      db.session.count({ where }),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    const ids = page.map((r) => r.id);
    const apps = ids.length
      ? await db.sessionKnowledgeApplication.groupBy({
          by: ["sessionId", "role"],
          where: { sessionId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const counts = new Map<string, { injected: number; extracted: number }>();
    for (const a of apps) {
      const c = counts.get(a.sessionId) ?? { injected: 0, extracted: 0 };
      if (a.role === "injected") c.injected = a._count._all;
      if (a.role === "extracted_from") c.extracted = a._count._all;
      counts.set(a.sessionId, c);
    }

    return Response.json({
      sessions: page.map((r) => {
        const c = counts.get(r.id) ?? { injected: 0, extracted: 0 };
        return toSessionView({
          ...r,
          _injectedCount: c.injected,
          _extractedCount: c.extracted,
        });
      }),
      total,
      nextCursor,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
