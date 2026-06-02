import { createHash, randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { writeAudit } from "@brain/core";

/**
 * POST /api/tokens/:id/change
 *
 * In-place secret swap: replaces the tokenHash on the SAME row.
 * - Same id, name, scope, userId, teamId, expiresAt, createdAt.
 * - No grace period, no rotatedFromId. Old secret stops working immediately.
 * - Use this for "I think this token leaked NOW" scenarios.
 * - For a no-disruption swap with a grace period, use POST .../rotate instead.
 *
 * 409 if: already revoked, pending rotation, or past hard expiry.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

    const row = await db.mCPToken.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        scheduledRevokeAt: true,
        expiresAt: true,
        name: true,
        scope: true,
        teamId: true,
        organizationId: true,
        projectId: true,
        createdAt: true,
      },
    });

    if (!row) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (row.userId !== userId) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    if (row.revokedAt !== null) {
      return Response.json(
        { error: "token_already_revoked", code: "TOKEN_ALREADY_REVOKED" },
        { status: 409 },
      );
    }
    if (row.scheduledRevokeAt !== null) {
      return Response.json(
        {
          error: "rotation_already_pending",
          code: "ROTATION_ALREADY_PENDING",
          message:
            "Cancel or wait for the pending rotation to settle before changing the secret.",
        },
        { status: 409 },
      );
    }
    if (row.expiresAt !== null && row.expiresAt <= new Date()) {
      return Response.json(
        { error: "token_expired", code: "TOKEN_EXPIRED" },
        { status: 409 },
      );
    }

    // bp_ prefix + 32 bytes base64url ≈ 45 chars — same as token.create.
    const raw = `bp_${randomBytes(32).toString("base64url")}`;
    const tokenHash = createHash("sha256").update(raw).digest("hex");

    const updated = await db.mCPToken.update({
      where: { id },
      data: { tokenHash },
      select: {
        id: true,
        name: true,
        scope: true,
        createdAt: true,
        expiresAt: true,
        scheduledRevokeAt: true,
        rotatedFromId: true,
      },
    });

    void writeAudit({
      actorUserId: userId,
      action: "token.change",
      targetType: "token",
      targetId: id,
      // raw token intentionally excluded — only safe metadata logged
      payload: { tokenId: id, projectId: row.projectId ?? null },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
      orgId: row.organizationId ?? null,
      projectId: row.projectId ?? null,
    });

    // `raw` is returned ONCE on change — never stored, never retrievable again.
    return Response.json({ token: updated, raw }, { status: 200 });
  } catch (err) {
    return authErrorResponse(err);
  }
}
