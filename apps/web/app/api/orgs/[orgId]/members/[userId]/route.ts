/**
 * PATCH /api/orgs/:orgId/members/:userId — change a member's role
 * DELETE /api/orgs/:orgId/members/:userId — remove a member
 *
 * Both require the caller to be owner or admin (enforced inside core helpers).
 */
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { setOrgMemberRole, removeOrgMember, writeAudit } from "@brain/core";

const patchSchema = z.object({
  role: z.enum(["owner", "admin", "member"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
): Promise<Response> {
  try {
    const callerUserId = await getCurrentUserId();
    const { orgId, userId: targetUserId } = await params;

    const body = patchSchema.parse(await req.json());

    await setOrgMemberRole(db, callerUserId, orgId, targetUserId, body.role);

    await writeAudit({
      actorUserId: callerUserId,
      action: "org.member.role",
      targetType: "orgMember",
      targetId: targetUserId,
      payload: { orgId, newRole: body.role },
    });

    return Response.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ orgId: string; userId: string }> },
): Promise<Response> {
  try {
    const callerUserId = await getCurrentUserId();
    const { orgId, userId: targetUserId } = await params;

    await removeOrgMember(db, callerUserId, orgId, targetUserId);

    await writeAudit({
      actorUserId: callerUserId,
      action: "org.member.remove",
      targetType: "orgMember",
      targetId: targetUserId,
      payload: { orgId },
    });

    return Response.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err);
  }
}
