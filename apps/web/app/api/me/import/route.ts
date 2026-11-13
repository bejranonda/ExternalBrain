/**
 * POST /api/me/import — read an External Brain JSON export into this account.
 *
 * Body: the file `/api/me/export?format=json` produced, on this instance or
 * another. Only knowledge is imported; rules land in projects of the same
 * name (created on demand), and a rule already present is skipped, so
 * importing the same file twice adds nothing.
 */
import { rateLimitCheck, writeAudit } from "@brain/core";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { auditIpFrom } from "@/lib/brain/client-ip";
import { getRateLimitStore } from "@/lib/brain/rate-limit-store";
import { importUserData } from "@/lib/brain/user-data";

export const dynamic = "force-dynamic";

const LIMIT = { name: "me_import", max: 5, windowMs: 60 * 60 * 1000 };
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();

    const gate = await rateLimitCheck(await getRateLimitStore(), `me_import:${userId}`, LIMIT, Date.now());
    if (!gate.ok) return Response.json({ error: "rate_limited" }, { status: 429 });

    if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) {
      return Response.json({ error: "import_too_large" }, { status: 413 });
    }
    const raw = await req.text();
    if (raw.length > MAX_BYTES) return Response.json({ error: "import_too_large" }, { status: 413 });
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "invalid_export" }, { status: 400 });
    }

    const outcome = await importUserData(userId, body);
    if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });

    void writeAudit({
      actorUserId: userId,
      action: "user.data_import",
      targetType: "user",
      targetId: userId,
      payload: { imported: outcome.imported, duplicates: outcome.duplicates, skipped: outcome.skipped },
      ip: auditIpFrom(req.headers),
      userAgent: req.headers.get("user-agent") ?? null,
    });
    return Response.json(outcome);
  } catch (err) {
    return authErrorResponse(err);
  }
}
