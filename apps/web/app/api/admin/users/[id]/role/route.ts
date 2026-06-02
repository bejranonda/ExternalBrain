/**
 * PATCH /api/admin/users/[id]/role — promote/demote a user.
 *
 * Requires admin role. Writes an AuditLog row on every change. Refuses to
 * demote the last remaining admin — a deployment with zero admins becomes
 * unrecoverable through the UI; only ADMIN_EMAILS env + a fresh sign-in can
 * recreate one. The "last admin" check is a soft guard, not a promise: an
 * operator with DB access can still revoke via SQL.
 */
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, AuthError } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";
import { writeAudit } from "@brain/core";

const bodySchema = z.object({
  role: z.enum(["admin", "user"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { userId: actorId } = await requireAdmin();
    const { id } = await params;
    const body = bodySchema.parse(await req.json());

    const target = await db.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true },
    });
    if (!target) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (target.role === body.role) {
      return Response.json({ user: target, changed: false });
    }

    // Guard: don't leave the deployment with zero admins.
    if (target.role === "admin" && body.role === "user") {
      const adminCount = await db.user.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        throw new AuthError(
          "last_admin_cannot_be_demoted — promote someone else first",
          409,
        );
      }
    }

    const updated = await db.user.update({
      where: { id },
      data: { role: body.role },
      select: { id: true, email: true, role: true },
    });

    await writeAudit({
      actorUserId: actorId,
      action: "admin.role_change",
      targetType: "user",
      targetId: id,
      payload: {
        email: target.email,
        from: target.role,
        to: body.role,
        selfChange: actorId === id,
      },
    });

    return Response.json({ user: updated, changed: true });
  } catch (err) {
    return authErrorResponse(err);
  }
}
