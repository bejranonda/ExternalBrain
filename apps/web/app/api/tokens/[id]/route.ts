import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { writeAudit } from "@brain/core";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;
    const row = await db.mCPToken.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!row) return Response.json({ error: "not_found" }, { status: 404 });
    if (row.userId !== userId) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    await db.mCPToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    // Audit W6 (#103): await the audit write — token revocation must
    // be audited atomically with the revoke itself, not best-effort.
    await writeAudit({
      actorUserId: userId,
      action: "token.revoke",
      targetType: "token",
      targetId: id,
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err);
  }
}
