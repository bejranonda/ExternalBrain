/**
 * GET  /api/admin/vouchers          — list with usage stats
 * POST /api/admin/vouchers          — create
 *
 * Requires admin role. All mutations write AuditLog rows.
 */
import { randomInt } from "node:crypto";
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";
import { writeAudit } from "@brain/core";

function generateCode(prefix = "PILOT"): string {
  // Short, uppercase, unambiguous (no O/I/0/1). 4-char suffix = 1.3M codes
  // per prefix before collision probability matters.
  // Uses node:crypto randomInt (CSPRNG, no modulo bias) — Math.random's
  // xorshift128+ state is recoverable from a few outputs, which would let
  // an attacker who observes two voucher codes predict subsequent ones.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[randomInt(alphabet.length)];
  }
  return `${prefix}-${out.slice(0, 4)}-${out.slice(4)}`;
}

export async function GET(_req: Request): Promise<Response> {
  try {
    await requireAdmin();
    const rows = await db.voucherCode.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        code: true,
        kind: true,
        organizationLabel: true,
        maxUses: true,
        usedCount: true,
        expiresAt: true,
        disabled: true,
        note: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return Response.json({ vouchers: rows });
  } catch (err) {
    return authErrorResponse(err);
  }
}

const createSchema = z.object({
  code: z.string().min(4).max(64).optional(),
  kind: z.enum(["personal", "organization"]).default("personal"),
  organizationLabel: z.string().max(120).nullish(),
  maxUses: z.number().int().positive().max(10_000).default(1),
  expiresAt: z.string().datetime().nullish(), // ISO 8601
  note: z.string().max(500).nullish(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const { userId: actorId } = await requireAdmin();
    const body = createSchema.parse(await req.json());

    const desired = (body.code ?? generateCode(body.kind === "organization" ? "ORG" : "PILOT"))
      .trim()
      .toUpperCase();

    const created = await db.voucherCode.create({
      data: {
        code: desired,
        kind: body.kind,
        organizationLabel: body.organizationLabel ?? null,
        maxUses: body.maxUses,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        note: body.note ?? null,
        createdByUserId: actorId,
      },
    });

    await writeAudit({
      actorUserId: actorId,
      action: "voucher.create",
      targetType: "voucher",
      targetId: created.id,
      payload: {
        code: created.code,
        kind: created.kind,
        maxUses: created.maxUses,
        organizationLabel: created.organizationLabel,
      },
    });

    return Response.json({ voucher: created }, { status: 201 });
  } catch (err) {
    return authErrorResponse(err);
  }
}
