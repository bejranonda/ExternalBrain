/**
 * GET /api/orgs/:orgId/members — list all org members (any member can read)
 */
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { requireOrgMember, listOrgMembers } from "@brain/core";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { orgId } = await params;

    // Any member may read the list
    await requireOrgMember(db, userId, orgId);

    const members = await listOrgMembers(db, orgId);

    return Response.json({ members });
  } catch (err) {
    return authErrorResponse(err);
  }
}
