/**
 * PATCH  /api/admin/vouchers/[id]  — enable/disable, update maxUses/expiry/note
 * DELETE /api/admin/vouchers/[id]  — hard delete (cascades redemptions)
 */
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";
import { writeAudit } from "@brain/core";

const patchSchema = z.object({
  disabled: z.boolean().optional(),
  maxUses: z.number().int().positive().max(10_000).optional(),
  expiresAt: z.string().datetime().nullish(),
  note: z.string().max(500).nullish(),
  organizationLabel: z.string().max(120).nullish(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { userId: actorId } = await requireAdmin();
    const { id } = await params;
    const body = patchSchema.parse(await req.json());

    const existing = await db.voucherCode.findUnique({ where: { id } });
    if (!existing) return Response.json({ error: "not_found" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (body.disabled !== undefined) data["disabled"] = body.disabled;
    if (body.maxUses !== undefined) {
      if (body.maxUses < existing.usedCount) {
        return Response.json(
          { error: "maxUses_below_usedCount", usedCount: existing.usedCount },
          { status: 400 },
        );
      }
      data["maxUses"] = body.maxUses;
    }
    if (body.expiresAt !== undefined) {
      data["expiresAt"] = body.expiresAt ? new Date(body.expiresAt) : null;
    }
    if (body.note !== undefined) data["note"] = body.note;
    if (body.organizationLabel !== undefined) data["organizationLabel"] = body.organizationLabel;

    const updated = await db.voucherCode.update({ where: { id }, data });

    await writeAudit({
      actorUserId: actorId,
      action: "voucher.update",
      targetType: "voucher",
      targetId: id,
      payload: { changes: Object.keys(data), before: { disabled: existing.disabled, maxUses: existing.maxUses } },
    });

    return Response.json({ voucher: updated });
  } catch (err) {
    return authErrorResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { userId: actorId } = await requireAdmin();
    const { id } = await params;
    const existing = await db.voucherCode.findUnique({ where: { id } });
    if (!existing) return Response.json({ error: "not_found" }, { status: 404 });

    await db.voucherCode.delete({ where: { id } });

    await writeAudit({
      actorUserId: actorId,
      action: "voucher.delete",
      targetType: "voucher",
      targetId: id,
      payload: { code: existing.code, kind: existing.kind },
    });

    return Response.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err);
  }
}
