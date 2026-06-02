/**
 * PATCH /api/tokens/[id]/scope — change a token's organization + project
 * scope without rotating the secret.
 *
 * Body: { organizationId?: string | null; projectId?: string | null }
 *   - organizationId: the org to scope this token to. null = unscoped
 *     (any org the user is a member of). Must be an org the caller is a
 *     member of when set.
 *   - projectId: the project. null = any project (within the chosen org).
 *     When set, must belong to the resolved org.
 *
 * Response: { token: TokenSummary } with the updated row.
 *
 * Audit: writes a `token.scope_change` row carrying the before / after
 * values, IP, user-agent. Awaited (matches W6).
 */
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { writeAudit, ensurePersonalOrg } from "@brain/core";

const bodySchema = z
  .object({
    organizationId: z.string().nullable().optional(),
    projectId: z.string().nullable().optional(),
  })
  .refine((o) => "organizationId" in o || "projectId" in o, {
    message: "must specify at least one of organizationId / projectId",
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await req.json());
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const existing = await db.mCPToken.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        organizationId: true,
        projectId: true,
        revokedAt: true,
        scheduledRevokeAt: true,
      },
    });
    if (!existing) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (existing.userId !== userId) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (existing.revokedAt) {
      return Response.json(
        { error: "revoked", message: "Cannot change scope on a revoked token" },
        { status: 409 },
      );
    }

    // Resolve target org:
    //   - explicit value wins (including explicit null → fallback to personal).
    //   - omitted (key not in body) keeps the existing org.
    let targetOrgId: string;
    if ("organizationId" in body) {
      if (body.organizationId === null) {
        const personal = await ensurePersonalOrg(db, userId);
        targetOrgId = personal.orgId;
      } else if (body.organizationId) {
        const member = await db.organizationMember.findUnique({
          where: { orgId_userId: { orgId: body.organizationId, userId } },
          select: { id: true },
        });
        if (!member) {
          return Response.json(
            { error: "forbidden", message: "Organization not found or not accessible" },
            { status: 403 },
          );
        }
        targetOrgId = body.organizationId;
      } else {
        // Treat empty string as null.
        const personal = await ensurePersonalOrg(db, userId);
        targetOrgId = personal.orgId;
      }
    } else {
      targetOrgId = existing.organizationId ?? (await ensurePersonalOrg(db, userId)).orgId;
    }

    // Resolve target project:
    //   - explicit null clears the scope (token can write to any project in the org).
    //   - explicit non-null must belong to targetOrgId AND the user must have access.
    //   - omitted keeps the existing project (subject to the org-membership rule
    //     below: if we changed the org, an existing project that no longer
    //     matches gets cleared).
    let targetProjectId: string | null;
    if ("projectId" in body) {
      if (body.projectId === null || !body.projectId) {
        targetProjectId = null;
      } else {
        const project = await db.project.findFirst({
          where: {
            id: body.projectId,
            organizationId: targetOrgId,
            organization: { members: { some: { userId } } },
          },
          select: { id: true },
        });
        if (!project) {
          return Response.json(
            {
              error: "forbidden",
              message:
                "Project not found, not accessible, or doesn't belong to the selected organization",
            },
            { status: 403 },
          );
        }
        targetProjectId = body.projectId;
      }
    } else {
      // Keep existing — but if org changed, validate that the existing
      // project is still in scope; otherwise null it out.
      if (existing.projectId && existing.organizationId !== targetOrgId) {
        targetProjectId = null;
      } else {
        targetProjectId = existing.projectId;
      }
    }

    const updated = await db.mCPToken.update({
      where: { id },
      data: {
        organizationId: targetOrgId,
        projectId: targetProjectId,
      },
      select: {
        id: true,
        name: true,
        scope: true,
        organizationId: true,
        projectId: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    await writeAudit({
      actorUserId: userId,
      action: "token.scope_change",
      targetType: "token",
      targetId: id,
      payload: {
        before: {
          organizationId: existing.organizationId ?? null,
          projectId: existing.projectId ?? null,
        },
        after: {
          organizationId: updated.organizationId ?? null,
          projectId: updated.projectId ?? null,
        },
      },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
      orgId: targetOrgId,
      projectId: targetProjectId,
    });

    return Response.json({ token: updated });
  } catch (err) {
    return authErrorResponse(err);
  }
}
