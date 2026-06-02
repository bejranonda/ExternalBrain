import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import { buildKnowledgeWhere } from "@brain/core";
import type { DataScope } from "@brain/core";

export interface GraphNodeView {
  id: string;
  label: string;
  type: "recipe" | "heuristic" | "principle" | "reflex" | "anti";
  deg: number;
  confidence: number;
  uses: number;
  successRate: number;
  firstSeen: string;
  lastUsed: string | null;
  scope: string;
}

export interface GraphEdgeView {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

export interface GraphPayload {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
}

function mapType(t: string): GraphNodeView["type"] {
  if (t === "anti_principle") return "anti";
  if (t === "heuristic" || t === "principle" || t === "reflex") return t;
  return "recipe";
}

function firstSentence(s: string): string {
  const first = s.split(/[.!?\n]/)[0] ?? s;
  return first.length > 60 ? first.slice(0, 60) + "…" : first;
}

export async function GET(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const dataScope: DataScope =
      url.searchParams.get("scope") === "all" ? "all" : "project";

    const { projectId } = await getActiveProject(userId);
     
    const kw = buildKnowledgeWhere(userId, projectId, dataScope) as any;

    const knowledge = await db.knowledge.findMany({
      where: kw,
      select: {
        id: true,
        type: true,
        scope: true,
        ruleText: true,
        confidence: true,
        usageCount: true,
        successCount: true,
        failureCount: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { confidence: "desc" },
      take: 300,
    });

    const ids = knowledge.map((k) => k.id);

    const edgeRows = ids.length
      ? await db.graphEdge.findMany({
          where: {
            OR: [{ sourceId: { in: ids } }, { targetId: { in: ids } }],
          },
          select: {
            sourceId: true,
            targetId: true,
            relation: true,
            weight: true,
          },
          take: 2000,
        })
      : [];

    const degree = new Map<string, number>();
    for (const e of edgeRows) {
      degree.set(e.sourceId, (degree.get(e.sourceId) ?? 0) + 1);
      degree.set(e.targetId, (degree.get(e.targetId) ?? 0) + 1);
    }

    const nodes: GraphNodeView[] = knowledge.map((k) => {
      const totalApplied = k.successCount + k.failureCount;
      const successRate = totalApplied > 0 ? k.successCount / totalApplied : 0;
      return {
        id: k.id,
        label: firstSentence(k.ruleText),
        type: mapType(k.type),
        deg: degree.get(k.id) ?? 0,
        confidence: k.confidence,
        uses: k.usageCount,
        successRate,
        firstSeen: k.createdAt.toISOString().slice(0, 10),
        lastUsed: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        scope: k.scope,
      };
    });

    const edges: GraphEdgeView[] = edgeRows.map((e) => ({
      source: e.sourceId,
      target: e.targetId,
      relation: e.relation,
      weight: e.weight,
    }));

    return Response.json({ nodes, edges } satisfies GraphPayload);
  } catch (err) {
    return authErrorResponse(err);
  }
}
