/**
 * POST /api/knowledge/:id/fork-to-project
 *
 * Pull an org-shared Knowledge row down into a specific project as a local
 * override. The new row:
 *   - Has the same triggerText / ruleText / rationale / type / etc.
 *   - ownerProjectId = target project (body.projectId or active project)
 *   - ownerUserId    = current user
 *   - visibility     = "project"
 *   - parentKnowledgeId = source.id        (fork chain)
 *   - originProjectId   = source.originProjectId  (preserve full chain)
 *
 * Guards:
 *   - Source row must be reachable: visibility="org" AND source's ownerProjectId
 *     must be in the same org as the target project.
 *   - Target project must be in the same org as the source project.
 *   - User must be a member of that org.
 *
 * Body: { projectId?: string }  — defaults to active project when omitted.
 *
 * Audit: knowledge.fork_to_project with { sourceId, newId, projectId }
 */
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import { toKnowledgeItemView } from "@/lib/brain/views";
import { writeAudit, getAccessibleProjectIds } from "@brain/core";

const bodySchema = z.object({
  projectId: z.string().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

    // Parse body (projectId is optional)
    let rawBody: Record<string, unknown> = {};
    try {
      rawBody = (await req.json()) as Record<string, unknown>;
    } catch {
      // empty body is fine
    }
    const { projectId: bodyProjectId } = bodySchema.parse(rawBody);

    // Resolve target project
    const active = await getActiveProject(userId);
    const targetProjectId = bodyProjectId ?? active.projectId;

    // Load source row
    const source = await db.knowledge.findUnique({ where: { id } });
    if (!source || source.deletedAt) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // V2 security (review 2026-07-10, finding 1): tasks never travel across
    // projects — mirrors the promote guard; belt and suspenders since an
    // org-visible action_item should no longer exist at all.
    if (source.type === "action_item") {
      return Response.json(
        {
          error: "invalid_type",
          hint: "Action items are project-bound tasks and cannot be forked to another project.",
        },
        { status: 422 },
      );
    }

    const sourceWithVis = source as typeof source & {
      visibility: string;
      originProjectId: string | null;
    };

    if (sourceWithVis.visibility !== "org") {
      return Response.json(
        {
          error: "not_org_visible",
          hint: `Only org-visible rows can be forked into a project. This row has visibility="${sourceWithVis.visibility}".`,
        },
        { status: 422 },
      );
    }

    if (!source.ownerProjectId) {
      return Response.json(
        {
          error: "no_source_project",
          hint: "The source row has no ownerProjectId and cannot be forked by project.",
        },
        { status: 422 },
      );
    }

    // Verify source belongs to an org the current user is a member of,
    // and that the target project is in the same org.
    const sourceProject = await db.project.findUnique({
      where: { id: source.ownerProjectId },
      select: { organizationId: true },
    });
    if (!sourceProject) {
      return Response.json({ error: "source_project_not_found" }, { status: 404 });
    }

    const targetProject = await db.project.findUnique({
      where: { id: targetProjectId },
      select: { organizationId: true },
    });
    if (!targetProject) {
      return Response.json({ error: "target_project_not_found" }, { status: 404 });
    }

    if (sourceProject.organizationId !== targetProject.organizationId) {
      return Response.json(
        {
          error: "cross_org_fork",
          hint: "Source and target projects must be in the same organization.",
        },
        { status: 422 },
      );
    }

    // Verify the user is a member of that org and can see the source row.
    const accessibleIds = await getAccessibleProjectIds(
      db,
      userId,
      sourceProject.organizationId,
    );
    if (!accessibleIds.includes(source.ownerProjectId)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    // Create the forked row
    const forked = await db.knowledge.create({
      data: {
        type: source.type,
        scope: source.scope,
        ownerUserId: userId,
        ownerProjectId: targetProjectId,
        triggerText: source.triggerText,
        ruleText: source.ruleText,
        rationale: source.rationale,
        tags: source.tags,
        confidence: Math.max(0.5, source.confidence - 0.1),
        extractedBy: "user",
        parentKnowledgeId: source.id,
         
        visibility: "project" as any,
        // Preserve the full lineage chain
         
        originProjectId: (sourceWithVis.originProjectId ?? source.ownerProjectId) as any,
      },
    });

    void writeAudit({
      actorUserId: userId,
      action: "knowledge.fork_to_project",
      targetType: "knowledge",
      targetId: forked.id,
      payload: {
        sourceId: id,
        newId: forked.id,
        projectId: targetProjectId,
      },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });

    return Response.json({ item: toKnowledgeItemView(forked) }, { status: 201 });
  } catch (err) {
    return authErrorResponse(err);
  }
}
