/**
 * GET /api/orgs/:orgId/audit-log — org-scoped audit log for org owners/admins.
 *
 * This is the org-member-accessible counterpart to GET /api/admin/audit-log.
 * It is pre-filtered to the caller's org and does NOT require platform-admin.
 * Only org owners and admins may call it (members get 403).
 *
 * Query params:
 *   action       — filter by action string
 *   limit        — 1..200, default 100
 */
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { requireOrgMember } from "@brain/core";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { orgId } = await params;

    // Require at least org-member access; admin/owner check below.
    const membership = await requireOrgMember(db, userId, orgId);

    // Only owners and admins may read the audit log.
    if (membership.role === "member") {
      return Response.json({ error: "org_admin_required" }, { status: 403 });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? undefined;
    const rawLimit = Number(url.searchParams.get("limit") ?? "100");
    const limit = Math.min(Math.max(1, rawLimit), 200);

    const entries = await db.auditLog.findMany({
      where: {
        organizationId: orgId,
        ...(action ? { action } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return Response.json({ entries });
  } catch (err) {
    return authErrorResponse(err);
  }
}
