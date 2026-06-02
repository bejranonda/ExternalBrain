/**
 * GET /api/sessions/:id
 *
 * Returns the session's basic fields plus the lists of Knowledge items
 * the session interacted with — split by role:
 *
 *   - injected:       skills the AI tool retrieved INTO this session
 *                     (the "what the Brain helped with" half)
 *   - extracted_from: skills KEA pulled OUT of this session
 *                     (the "what the Brain learned" half)
 *
 * Auth: the caller must own the session, OR be a member of the org that
 * owns the session's project (org-shared scope). Soft-deleted Knowledge
 * rows are excluded — we surface what the user can actually act on.
 */
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { extractPrompt } from "@/lib/brain/views";

interface KnowledgeRow {
  id: string;
  type: string;
  triggerText: string;
  ruleText: string;
}

interface AppliedKnowledgeView extends KnowledgeRow {
  appliedAt: string;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

    const session = await db.session.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            id: true,
            slug: true,
            name: true,
            organizationId: true,
          },
        },
      },
    });

    if (!session) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // Authorize: own the session, or share an org with the session's
    // project. The `OR` keeps personal sessions (no projectId) reachable
    // for their owner without an org-membership probe.
    const isOwner = session.userId === userId;
    let isOrgMember = false;
    if (!isOwner && session.project?.organizationId) {
      const member = await db.organizationMember.findFirst({
        where: { userId, organizationId: session.project.organizationId },
        select: { id: true },
      });
      isOrgMember = !!member;
    }
    if (!isOwner && !isOrgMember) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    const applications = await db.sessionKnowledgeApplication.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        createdAt: true,
        knowledge: {
          select: {
            id: true,
            type: true,
            triggerText: true,
            ruleText: true,
            deletedAt: true,
          },
        },
      },
    });

    const injected: AppliedKnowledgeView[] = [];
    const extracted: AppliedKnowledgeView[] = [];
    for (const a of applications) {
      if (a.knowledge.deletedAt) continue;
      const view: AppliedKnowledgeView = {
        id: a.knowledge.id,
        type: a.knowledge.type,
        triggerText: a.knowledge.triggerText,
        ruleText: a.knowledge.ruleText,
        appliedAt: a.createdAt.toISOString(),
      };
      if (a.role === "injected") injected.push(view);
      else if (a.role === "extracted_from") extracted.push(view);
    }

    return Response.json({
      session: {
        id: session.id,
        prompt: extractPrompt(session.metadata),
        clientType: session.clientType,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
        outcome: session.outcome,
        sqs: session.sqs,
        projectName: session.project?.name ?? null,
        projectSlug: session.project?.slug ?? null,
      },
      injected,
      extracted,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
