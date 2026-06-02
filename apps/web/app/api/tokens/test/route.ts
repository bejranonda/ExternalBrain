import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { writeAudit } from "@brain/core";

const bodySchema = z.object({
  tokenId: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const body = bodySchema.parse(await req.json());
    const { tokenId } = body;

    const row = await db.mCPToken.findUnique({
      where: { id: tokenId },
      select: {
        userId: true,
        revokedAt: true,
        expiresAt: true,
        scheduledRevokeAt: true,
      },
    });

    // Return 404 for both not-found and wrong-owner to avoid leaking existence.
    if (!row || row.userId !== userId) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const now = new Date();
    let status: string;
    let payload: Record<string, unknown>;

    if (row.revokedAt !== null) {
      // Explicitly revoked.
      status = "revoked";
      payload = { tokenId, status };
      void writeAudit({
        actorUserId: userId,
        action: "token.test",
        targetType: "token",
        targetId: tokenId,
        payload,
        ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      });
      return Response.json({ ok: false, reason: "revoked" });
    }

    if (row.expiresAt !== null && row.expiresAt <= now) {
      // Past the expiry wall.
      status = "expired";
      payload = { tokenId, status };
      void writeAudit({
        actorUserId: userId,
        action: "token.test",
        targetType: "token",
        targetId: tokenId,
        payload,
        ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      });
      return Response.json({
        ok: false,
        reason: "expired",
        expiresAt: row.expiresAt.toISOString(),
      });
    }

    if (row.scheduledRevokeAt !== null && row.scheduledRevokeAt <= now) {
      // Grace window already past — old rotation token is effectively dead.
      status = "scheduled-revoke";
      payload = { tokenId, status };
      void writeAudit({
        actorUserId: userId,
        action: "token.test",
        targetType: "token",
        targetId: tokenId,
        payload,
        ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
      });
      return Response.json({
        ok: false,
        reason: "scheduled-revoke",
        scheduledRevokeAt: row.scheduledRevokeAt.toISOString(),
      });
    }

    // All checks passed — token is active.
    status = "active";
    payload = { tokenId, status };
    void writeAudit({
      actorUserId: userId,
      action: "token.test",
      targetType: "token",
      targetId: tokenId,
      payload,
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });
    return Response.json({ ok: true, status: "active" });
  } catch (err) {
    return authErrorResponse(err);
  }
}
