/**
 * POST /api/invites/accept — accept an org invite by token.
 *
 * Body: { token: string }
 * Caller must be authenticated (session userId is used).
 * On success, adds the user to the org and returns { orgId }.
 */
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { acceptOrgInvite, writeAudit } from "@brain/core";

const bodySchema = z.object({
  token: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const body = bodySchema.parse(await req.json());

    const { orgId } = await acceptOrgInvite(db, userId, body.token);

    await writeAudit({
      actorUserId: userId,
      action: "org.invite.accept",
      targetType: "organization",
      targetId: orgId,
      payload: { orgId },
    });

    return Response.json({ orgId });
  } catch (err) {
    return authErrorResponse(err);
  }
}
