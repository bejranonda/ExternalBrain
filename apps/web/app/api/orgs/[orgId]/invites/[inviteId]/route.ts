/**
 * DELETE /api/orgs/:orgId/invites/:inviteId — revoke a pending invite
 * Owner/admin only.
 */
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { revokeOrgInvite, writeAudit } from "@brain/core";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; inviteId: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { orgId, inviteId } = await params;

    // revokeOrgInvite enforces privilege internally
    await revokeOrgInvite(db, userId, inviteId);

    await writeAudit({
      actorUserId: userId,
      action: "org.invite.revoke",
      targetType: "orgInvite",
      targetId: inviteId,
      payload: { orgId },
    });

    return Response.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err);
  }
}
