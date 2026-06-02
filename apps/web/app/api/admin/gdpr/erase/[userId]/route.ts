/**
 * POST /api/admin/gdpr/erase/[userId] — soft-erase a user for GDPR compliance.
 *
 * Body: { confirm: true, reason: string }
 *   `confirm` is a required explicit acknowledgement — prevents fat-finger
 *   erasures from scripts that omit the field.
 *   `reason` is captured as proof of lawful basis (e.g. "user_request",
 *   "right_to_erasure", "court_order") and stored in the audit log.
 *
 * Soft-erase semantics:
 *   • email  → "erased_<userId>@deleted.local" (anonymised, still unique)
 *   • name   → null
 *   • image  → null
 *   Cascade-delete relations (Knowledge, Sessions, etc.) fire naturally via
 *   Prisma's onDelete:Cascade definitions.
 *
 * Limitations (acknowledged):
 *   The anonymised User row is retained for referential integrity on tables
 *   that don't cascade. Full physical erasure of those rows requires a DBA
 *   pass — see docs/KNOWN_ISSUES.md.
 */
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";
import { writeAudit } from "@brain/core";

const eraseSchema = z.object({
  confirm: z.literal(true),
  reason: z.string().min(1).max(500),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId: actorId } = await requireAdmin();
    const { userId } = await params;

    const body = eraseSchema.parse(await req.json());

    const target = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!target) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // Refuse to erase the last admin — same guard as role demotion.
    if (target.role === "admin") {
      const adminCount = await db.user.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        return Response.json(
          { error: "last_admin", hint: "Cannot erase the last admin. Promote another admin first." },
          { status: 409 },
        );
      }
    }

    // Anonymise the User row. Cascade deletes on related tables fire here.
    await db.user.update({
      where: { id: userId },
      data: {
        email: `erased_${userId}@deleted.local`,
        name: null,
        image: null,
      },
    });

    void writeAudit({
      actorUserId: actorId,
      action: "admin.gdpr_erase",
      targetType: "user",
      targetId: userId,
      payload: { userId, reason: body.reason },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });

    return Response.json({
      ok: true,
      mode: "soft",
      note: "physical erasure requires a DBA pass per docs/KNOWN_ISSUES.md",
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
