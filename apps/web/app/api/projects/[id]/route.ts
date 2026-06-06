/**
 * GET /api/projects/:id    — value summary: skills retrieved into & extracted out of all sessions
 * PATCH /api/projects/:id  — rename / re-slug (project owner or org owner only)
 * DELETE /api/projects/:id — hard delete (refuse if project has data or is the user's only project)
 */
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import {
  isOrgOwner,
  requireOrgMember,
  slugify,
  uniqueSlugInOrg,
  writeAudit,
} from "@brain/core";

interface AggregatedKnowledgeView {
  id: string;
  type: string;
  triggerText: string;
  ruleText: string;
  hitCount: number;        // how many sessions in this project applied this knowledge in this role
  lastAppliedAt: string;   // ISO of the most recent application across the project
}

/**
 * Aggregates SessionKnowledgeApplication rows across every session in the
 * project, split by role. Hot-path: filters on (projectId, role) via the
 * existing (userId, projectId, startedAt) session index — no new index needed.
 * Returns a per-knowledge roll-up so the panel can render one row per skill
 * with a hit count instead of N duplicate rows.
 */
async function buildProjectValue(projectId: string): Promise<{
  injected: AggregatedKnowledgeView[];
  extracted: AggregatedKnowledgeView[];
  totals: { sessionCount: number; injectedCount: number; extractedCount: number };
}> {
  // Pull every (knowledge, role, createdAt) tuple for sessions in this
  // project. The dataset is bounded by the project's session count, and
  // every row materializes a knowledge join anyway — there's no cheaper
  // shape than the row scan + in-memory grouping below for typical org
  // sizes (≤ a few thousand applications per project).
  const applications = await db.sessionKnowledgeApplication.findMany({
    where: {
      session: { projectId },
      knowledge: { deletedAt: null },
    },
    select: {
      role: true,
      createdAt: true,
      knowledge: {
        select: { id: true, type: true, triggerText: true, ruleText: true },
      },
    },
  });

  const sessionCount = await db.session.count({ where: { projectId } });

  const inj = new Map<string, AggregatedKnowledgeView>();
  const ext = new Map<string, AggregatedKnowledgeView>();

  for (const a of applications) {
    const bucket = a.role === "injected" ? inj : a.role === "extracted_from" ? ext : null;
    if (!bucket) continue;
    const existing = bucket.get(a.knowledge.id);
    if (existing) {
      existing.hitCount += 1;
      if (a.createdAt.toISOString() > existing.lastAppliedAt) {
        existing.lastAppliedAt = a.createdAt.toISOString();
      }
    } else {
      bucket.set(a.knowledge.id, {
        id: a.knowledge.id,
        type: a.knowledge.type,
        triggerText: a.knowledge.triggerText,
        ruleText: a.knowledge.ruleText,
        hitCount: 1,
        lastAppliedAt: a.createdAt.toISOString(),
      });
    }
  }

  // Sort by hit count desc, then by recency — most-relevant first.
  const sortFn = (a: AggregatedKnowledgeView, b: AggregatedKnowledgeView) =>
    b.hitCount - a.hitCount || b.lastAppliedAt.localeCompare(a.lastAppliedAt);

  const injected = [...inj.values()].sort(sortFn);
  const extracted = [...ext.values()].sort(sortFn);

  return {
    injected,
    extracted,
    totals: {
      sessionCount,
      injectedCount: injected.length,
      extractedCount: extracted.length,
    },
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

    const project = await db.project.findUnique({
      where: { id },
      select: {
        id: true,
        slug: true,
        name: true,
        organizationId: true,
        framework: true,
        language: true,
        createdAt: true,
      },
    });

    if (!project) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // Authorize: any org member can see the project's value summary —
    // mirrors the session-detail policy (members already see each
    // other's sessions through the org-shared scope).
    await requireOrgMember(db, userId, project.organizationId);

    const { injected, extracted, totals } = await buildProjectValue(project.id);

    return Response.json({
      project: {
        id: project.id,
        slug: project.slug,
        name: project.name,
        organizationId: project.organizationId,
        framework: project.framework,
        language: project.language,
        createdAt: project.createdAt.toISOString(),
      },
      injected,
      extracted,
      totals,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  slug: z.string().min(1).max(120).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;
    const body = patchSchema.parse(await req.json());

    const project = await db.project.findUnique({
      where: { id },
      select: { id: true, ownerUserId: true, organizationId: true, slug: true, name: true },
    });

    if (!project) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // Only the project owner or org owner may rename/re-slug.
    const isProjectOwner = project.ownerUserId === userId;
    const isOrgOwnerResult = await isOrgOwner(db, userId, project.organizationId);

    if (!isProjectOwner && !isOrgOwnerResult) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    // Build slug: if caller sent a slug, use it; else derive from new name.
    let newSlug = project.slug;
    if (body.slug) {
      newSlug = await uniqueSlugInOrg(db, project.organizationId, slugify(body.slug), id);
    } else if (body.name) {
      newSlug = await uniqueSlugInOrg(db, project.organizationId, slugify(body.name), id);
    }

    const updated = await db.project.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        slug: newSlug,
      },
      select: { id: true, slug: true, name: true, organizationId: true },
    });

    void writeAudit({
      actorUserId: userId,
      action: "project.update",
      targetType: "project",
      targetId: id,
      payload: { name: body.name, slug: newSlug },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });

    return Response.json({ project: updated });
  } catch (err) {
    return authErrorResponse(err);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

    const project = await db.project.findUnique({
      where: { id },
      select: {
        id: true,
        ownerUserId: true,
        organizationId: true,
        _count: {
          select: {
            knowledge: { where: { deletedAt: null } },
            sessions: true,
          },
        },
      },
    });

    if (!project) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // Only the project owner or org owner may delete.
    const isProjectOwner = project.ownerUserId === userId;
    const orgOwner = await isOrgOwner(db, userId, project.organizationId);

    if (!isProjectOwner && !orgOwner) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    // `?withData=true` cascades: delete the project's sessions + knowledge too.
    // Without it, refuse a non-empty project — a plain delete would orphan the
    // data (the schema sets projectId NULL on delete, it does not cascade).
    const withData = new URL(req.url).searchParams.get("withData") === "true";
    const knowledgeCount = project._count.knowledge ?? 0;
    const sessionCount = project._count.sessions ?? 0;
    const hasData = knowledgeCount > 0 || sessionCount > 0;
    if (hasData && !withData) {
      return Response.json(
        {
          error: "project_not_empty",
          message: "Project still has knowledge or sessions. Transfer or delete the data first.",
          knowledge: knowledgeCount,
          sessions: sessionCount,
        },
        { status: 409 },
      );
    }

    // Refuse if this is the user's only project (they need at least one).
    const userProjectCount = await db.project.count({
      where: {
        organizationId: project.organizationId,
        ownerUserId: userId,
      },
    });
    if (userProjectCount <= 1) {
      return Response.json(
        { error: "last_project", message: "Cannot delete your only project." },
        { status: 409 },
      );
    }

    // Cascade the project's data (sessions + knowledge) and remove the project
    // in one transaction, so a failure on the final delete can't leave the
    // project in a partially-deleted state. Their dependents — session events,
    // knowledge applications, graph edges — cascade in the DB.
    await db.$transaction(async (tx) => {
      if (hasData && withData) {
        await tx.session.deleteMany({ where: { projectId: id } });
        await tx.knowledge.deleteMany({ where: { ownerProjectId: id } });
      }
      await tx.project.delete({ where: { id } });
    });

    void writeAudit({
      actorUserId: userId,
      action: "project.delete",
      targetType: "project",
      targetId: id,
      payload: withData
        ? { withData: true, deletedKnowledge: knowledgeCount, deletedSessions: sessionCount }
        : {},
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });

    return Response.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err);
  }
}
