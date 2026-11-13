/**
 * GET /api/admin/gdpr/export/[userId] — full GDPR data bundle for one user.
 *
 * Returns the user's complete personal data as JSON: every row across all
 * tables associated with the userId. `tokenHash` is excluded from MCPToken
 * as it's a one-way hash of a credential — it holds no personal data value
 * and including it would expose a brute-force surface.
 *
 * Embedding vectors are excluded from Knowledge rows — they're high-dimensional
 * floats derived from the text, not independently personal, and bloat the
 * export massively.
 *
 * The bundle is built by `lib/brain/user-data.ts`, shared with the user's own
 * `/api/me/export`, so both hand out the same document.
 */
import { authErrorResponse } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";
import { writeAudit } from "@brain/core";
import { auditIpFrom } from "@/lib/brain/client-ip";
import { buildUserDataBundle } from "@/lib/brain/user-data";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId: actorId } = await requireAdmin();
    const { userId } = await params;

    const bundle = await buildUserDataBundle(userId);
    if (!bundle) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    void writeAudit({
      actorUserId: actorId,
      action: "admin.gdpr_export",
      targetType: "user",
      targetId: userId,
      payload: { userId },
      ip: auditIpFrom(req.headers),
      userAgent: req.headers.get("user-agent") ?? null,
    });

    return Response.json(bundle);
  } catch (err) {
    return authErrorResponse(err);
  }
}
