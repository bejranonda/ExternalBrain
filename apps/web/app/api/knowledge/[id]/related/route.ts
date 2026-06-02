import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";

export interface RelatedNodeView {
  id: string;
  relation: string;
  direction: "out" | "in";
  type: "recipe" | "heuristic" | "principle" | "reflex" | "anti";
  title: string;
}

function mapType(t: string): RelatedNodeView["type"] {
  if (t === "anti_principle") return "anti";
  if (t === "heuristic" || t === "principle" || t === "reflex") return t;
  return "recipe";
}

function firstSentence(s: string): string {
  const first = s.split(/[.!?\n]/)[0] ?? s;
  return first.length > 70 ? first.slice(0, 70) + "…" : first;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

    const own = await db.knowledge.findUnique({
      where: { id },
      select: { ownerUserId: true },
    });
    if (!own) return Response.json({ error: "not_found" }, { status: 404 });
    if (own.ownerUserId !== userId) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    const edges = await db.graphEdge.findMany({
      where: { OR: [{ sourceId: id }, { targetId: id }] },
      take: 50,
    });

    const otherIds = Array.from(
      new Set(edges.flatMap((e) => [e.sourceId, e.targetId]).filter((x) => x !== id)),
    );
    const others = await db.knowledge.findMany({
      where: { id: { in: otherIds } },
      select: { id: true, ruleText: true, type: true },
    });
    const byId = new Map(others.map((o) => [o.id, o]));

    const items: RelatedNodeView[] = edges.map((e) => {
      const isOut = e.sourceId === id;
      const otherId = isOut ? e.targetId : e.sourceId;
      const other = byId.get(otherId);
      return {
        id: otherId,
        relation: e.relation,
        direction: isOut ? "out" : "in",
        type: other ? mapType(other.type) : "recipe",
        title: other ? firstSentence(other.ruleText) : otherId,
      };
    });

    return Response.json({ items });
  } catch (err) {
    return authErrorResponse(err);
  }
}
