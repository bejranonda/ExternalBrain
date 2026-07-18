import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import {
  buildKnowledgeWhereV2,
  writeAudit,
  getAccessibleProjectIds,
  userCanAccessProject,
} from "@brain/core";
import type { DataScope } from "@brain/core";
import { toKnowledgeItemView } from "@/lib/brain/views";
import { validateForTagAssignee } from "@/lib/brain/assignee-validation";

export async function GET(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    // No array-element-startsWith operator in Prisma's query DSL for String[]
    // columns, so this filters in application code after fetch. Applied
    // AFTER the DB query returns but BEFORE the response-facing `limit` is
    // enforced (see below) — filtering after limit would silently drop
    // older matching rows whenever the newest `limit` rows happen not to
    // carry the prefix (2026-07-14 review finding).
    const tagPrefix = url.searchParams.get("tagPrefix");
    const scopeParam = url.searchParams.get("scope");
    // "all" is the data-scope opt-out; anything else is treated as a knowledge-row
    // scope filter (e.g. ?scope=user) — not as the data-scope toggle.
    const dataScope: DataScope = scopeParam === "all" ? "all" : "project";

    // Phase 4 visibility filter: ?visibility=private|project|org
    const visibilityParam = url.searchParams.get("visibility");

    const activeProject = await getActiveProject(userId);
    const { projectId, orgId } = activeProject;

    // Fetch accessible project IDs in this org for V2 org-visibility support.
    const accessibleProjectIds = await getAccessibleProjectIds(db, userId, orgId);

     
    const baseWhere = buildKnowledgeWhereV2({
      userId,
      activeProjectId: projectId,
      activeOrgId: orgId,
      accessibleProjectIds,
      scope: dataScope,
    }) as any;

    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

    // Merge optional type / knowledge-row-scope / visibility filters.
    const knowledgeScopeValues = ["user", "project", "team", "global", "community"];
    const extras: Record<string, unknown> = {};
    if (type) extras.type = type;
    if (scopeParam && knowledgeScopeValues.includes(scopeParam)) {
      extras.scope = scopeParam;
    }
    if (visibilityParam && ["private", "project", "org"].includes(visibilityParam)) {
      extras.visibility = visibilityParam;
    }

    // For the AND-wrapped shape from V2, merge extras into the first AND clause.
    let finalWhere: unknown;
    if (
      "AND" in baseWhere &&
      Array.isArray(baseWhere.AND) &&
      Object.keys(extras).length > 0
    ) {
      const [first, ...rest] = baseWhere.AND as [object, ...object[]];
      finalWhere = { AND: [{ ...first, ...extras }, ...rest] };
    } else {
      finalWhere = Object.keys(extras).length > 0 ? { ...baseWhere, ...extras } : baseWhere;
    }

    // Default sort prioritises high-confidence + recently-used; ?sort=recent
    // flips to createdAt-desc so the dashboard's LatestInsight card can ask
    // for "the newest extracted row" without a separate endpoint.
    const sortParam = url.searchParams.get("sort");
    const orderBy =
      sortParam === "recent"
        ? ([{ createdAt: "desc" as const }])
        : ([{ confidence: "desc" as const }, { lastUsedAt: "desc" as const }]);

    if (tagPrefix) {
      // Bounded candidate pool independent of the response-facing `limit` —
      // fetch first, filter by prefix, THEN slice to `limit`. `total` in
      // this branch reflects the filtered count so pagination UI (if any
      // caller relies on it) isn't misleading.
      const CANDIDATE_POOL_CAP = 2000;
      const candidates = await db.knowledge.findMany({
        where: finalWhere as never,
        orderBy,
        take: CANDIDATE_POOL_CAP,
      });
      const filtered = candidates.filter((r) => r.tags.some((t) => t.startsWith(tagPrefix)));
      return Response.json({
        items: filtered.slice(0, limit).map(toKnowledgeItemView),
        total: filtered.length,
      });
    }

    const [rows, total] = await Promise.all([

      db.knowledge.findMany({
        where: finalWhere as never,
        orderBy,
        take: limit,
      }),

      db.knowledge.count({ where: finalWhere as never }),
    ]);

    return Response.json({
      items: rows.map(toKnowledgeItemView),
      total,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}

const createSchema = z.object({
  type: z.enum(["recipe", "heuristic", "principle", "reflex", "anti_principle", "action_item"]),
  triggerText: z.string().min(1),
  ruleText: z.string().min(1),
  rationale: z.string().nullable().optional(),
  instead: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  scope: z.enum(["user", "project", "team", "global"]).default("user"),
  confidence: z.number().min(0).max(1).default(0.7),
  ownerProjectId: z.string().optional(),
  supersedesKnowledgeId: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const body = createSchema.parse(await req.json());

    // Default ownerProjectId to the active project when not explicitly provided.
    // When the caller supplies an explicit ownerProjectId, verify they have
    // access to it — without this check, a user could create knowledge tagged
    // to another user's project (the row's ownerUserId is still the caller,
    // but the projectId pollutes that project's listings).
    let resolvedProjectId: string | null = body.ownerProjectId ?? null;
    if (resolvedProjectId) {
      const ok = await userCanAccessProject(db, userId, resolvedProjectId);
      if (!ok) {
        return Response.json(
          { error: { code: "FORBIDDEN_PROJECT", message: "project not found or access denied" } },
          { status: 403 },
        );
      }
    } else {
      const active = await getActiveProject(userId);
      resolvedProjectId = active.projectId;
    }

    if (body.type === "action_item") {
      const assigneeCheck = await validateForTagAssignee(body.tags, resolvedProjectId);
      if (!assigneeCheck.ok) {
        return Response.json(assigneeCheck.body, { status: assigneeCheck.status });
      }
    }

    // Create + (optional) supersede happen in one transaction: as separately
    // committed writes, a failure between them would leave the new row live
    // without retiring the old one — defeating the point of supersession,
    // since the Oracle would then cite both (2026-07-14 review finding).
    // Supersede logic is inlined here (not calling the shared
    // supersedeKnowledge helper) so this stays inside the transaction using
    // `tx` directly, without depending on tx's type being assignable to
    // supersedeKnowledge's plain-PrismaClient parameter.
    const row = await db.$transaction(async (tx) => {
      const created = await tx.knowledge.create({
        data: {
          type: body.type,
          scope: body.scope,
          ownerUserId: userId,
          ownerProjectId: resolvedProjectId,
          triggerText: body.triggerText,
          ruleText: body.ruleText,
          rationale: body.rationale ?? null,
          instead: body.instead ?? null,
          tags: body.tags,
          confidence: body.confidence,
          extractedBy: "user",
        },
      });

      if (body.supersedesKnowledgeId) {
        const target = await tx.knowledge.findFirst({
          where: {
            id: body.supersedesKnowledgeId,
            ownerUserId: userId,
            deletedAt: null,
            ...(resolvedProjectId ? { ownerProjectId: resolvedProjectId } : {}),
          },
          select: { id: true },
        });
        if (target) {
          await tx.knowledge.update({
            where: { id: target.id },
            data: { deletedAt: new Date() },
          });
          await tx.knowledge.update({
            where: { id: created.id },
            data: { parentKnowledgeId: target.id },
          });
        }
      }

      return created;
    });

    void writeAudit({
      actorUserId: userId,
      action: "knowledge.create",
      targetType: "knowledge",
      targetId: row.id,
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });
    return Response.json({ item: toKnowledgeItemView(row) }, { status: 201 });
  } catch (err) {
    return authErrorResponse(err);
  }
}
