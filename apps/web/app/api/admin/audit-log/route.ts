/**
 * GET /api/admin/audit-log — paginated audit log with optional filters.
 *
 * Query params:
 *   action       — exact match on the action string
 *   actorUserId  — filter by actor
 *   orgId        — filter by organizationId (Phase 3c)
 *   projectId    — filter by projectId (Phase 3c)
 *   limit        — 1..500, default 100
 *
 * Writing an audit entry for this view is intentional — it records when
 * admins browse sensitive audit data (regulatory / insider-threat signal).
 */
import { db } from "@brain/db";
import { authErrorResponse } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";
import { writeAudit } from "@brain/core";

export async function GET(req: Request): Promise<Response> {
  try {
    const { userId: actorId } = await requireAdmin();

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? undefined;
    const actorUserId = url.searchParams.get("actorUserId") ?? undefined;
    const orgId = url.searchParams.get("orgId") ?? undefined;
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const rawLimit = Number(url.searchParams.get("limit") ?? "100");
    const limit = Math.min(Math.max(1, rawLimit), 500);

    const entries = await db.auditLog.findMany({
      where: {
        ...(action ? { action } : {}),
        ...(actorUserId ? { actorUserId } : {}),
        ...(orgId ? { organizationId: orgId } : {}),
        ...(projectId ? { projectId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    void writeAudit({
      actorUserId: actorId,
      action: "admin.audit_log_view",
      payload: { filters: { action, actorUserId, orgId, projectId, limit } },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });

    return Response.json({ entries });
  } catch (err) {
    return authErrorResponse(err);
  }
}
