/**
 * GET /api/admin/cost-ledger — last 30 days of Oracle spend across all users.
 *
 * OracleCostLedger has no Prisma relation to User (intentional — we don't
 * want cascade deletes on billing data). We fetch users separately and merge
 * via a Map to keep N+1 queries off the hot path.
 */
import { db } from "@brain/db";
import { authErrorResponse } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";
import { writeAudit } from "@brain/core";

export async function GET(req: Request): Promise<Response> {
  try {
    const { userId: actorId } = await requireAdmin();

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    since.setUTCHours(0, 0, 0, 0);

    const [entries, users] = await Promise.all([
      db.oracleCostLedger.findMany({
        where: { day: { gte: since } },
        orderBy: [{ day: "desc" }, { costUsd: "desc" }],
      }),
      db.user.findMany({
        select: { id: true, email: true },
      }),
    ]);

    const emailById = new Map(users.map((u) => [u.id, u.email]));

    const mapped = entries.map((e) => ({
      userId: e.userId,
      email: emailById.get(e.userId) ?? null,
      day: e.day,
      tokensInput: e.tokensInput,
      tokensOutput: e.tokensOutput,
      costUsd: Number(e.costUsd),
      callCount: e.callCount,
    }));

    void writeAudit({
      actorUserId: actorId,
      action: "admin.cost_ledger_view",
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });

    return Response.json({ entries: mapped });
  } catch (err) {
    return authErrorResponse(err);
  }
}
