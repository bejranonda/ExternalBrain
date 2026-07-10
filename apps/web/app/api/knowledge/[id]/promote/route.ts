/**
 * POST /api/knowledge/:id/promote
 *
 * Elevate a project-local Knowledge row to org visibility so all projects
 * in the org can see it.
 *
 * Guards:
 *   - Must own the row (ownerUserId === current user).
 *   - Current visibility must be "project".
 *   - ownerProjectId must be non-null (personal rows without a project cannot
 *     be promoted — they have no org anchor).
 *
 * Effect:
 *   - visibility   → "org"
 *   - originProjectId → current ownerProjectId  (audit trail of origin project)
 *
 * Audit: knowledge.promote with { knowledgeId, fromProjectId, toOrgVisibility: true }
 */
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { toKnowledgeItemView } from "@/lib/brain/views";
import { writeAudit } from "@brain/core";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

    const row = await db.knowledge.findUnique({ where: { id } });
    if (!row || row.deletedAt) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (row.ownerUserId !== userId) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    // V2 security (review 2026-07-10, finding 1): action items are tasks
    // addressed to people inside ONE project — the project boundary is their
    // isolation line by spec. Org promotion would broadcast meeting content
    // (assignee, task text) into every other project's Oracle task block.
    if (row.type === "action_item") {
      return Response.json(
        {
          error: "invalid_type",
          hint: "Action items are project-bound tasks and cannot be promoted to org visibility.",
        },
        { status: 422 },
      );
    }

    const rowWithVisibility = row as typeof row & { visibility: string; originProjectId: string | null };

    if (rowWithVisibility.visibility !== "project") {
      return Response.json(
        {
          error: "invalid_visibility",
          hint: `Row visibility is "${rowWithVisibility.visibility}"; only "project" rows can be promoted.`,
        },
        { status: 422 },
      );
    }
    if (!row.ownerProjectId) {
      return Response.json(
        {
          error: "no_project",
          hint: "This row has no ownerProjectId; only project-scoped rows can be promoted to org.",
        },
        { status: 422 },
      );
    }

    const updated = await db.knowledge.update({
      where: { id },
      data: {
         
        visibility: "org" as any,
         
        originProjectId: row.ownerProjectId as any,
      },
    });

    void writeAudit({
      actorUserId: userId,
      action: "knowledge.promote",
      targetType: "knowledge",
      targetId: id,
      payload: {
        knowledgeId: id,
        fromProjectId: row.ownerProjectId,
        toOrgVisibility: true,
      },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });

    return Response.json({ item: toKnowledgeItemView(updated) });
  } catch (err) {
    return authErrorResponse(err);
  }
}
