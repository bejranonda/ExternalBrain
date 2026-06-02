import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import { buildProposalWhere } from "@brain/core";
import type { DataScope } from "@brain/core";
import { toProposalView } from "@/lib/brain/views";

export async function GET(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const status = url.searchParams.get("status") ?? "pending";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const dataScope: DataScope =
      url.searchParams.get("scope") === "all" ? "all" : "project";

    const { projectId } = await getActiveProject(userId);
     
    const pw = buildProposalWhere(userId, projectId, dataScope) as any;

    const rows = await db.autoskillProposal.findMany({
      where: status === "all" ? pw : { ...pw, status },
      orderBy: [{ confidence: "asc" }, { createdAt: "desc" }],
      take: limit,
    });

    return Response.json({
      proposals: rows.map(toProposalView),
      total: rows.length,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
