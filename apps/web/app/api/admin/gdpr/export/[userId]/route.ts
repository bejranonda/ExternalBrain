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
 */
import { db } from "@brain/db";
import { authErrorResponse } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";
import { writeAudit } from "@brain/core";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    const { userId: actorId } = await requireAdmin();
    const { userId } = await params;

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    // Fetch everything in parallel — no sequential dependency between tables.
    const [
      knowledge,
      sessions,
      sessionEvents,
      skills,
      peerCards,
      autoskillProposals,
      feedback,
      mcpTokens,
      costLedger,
      sessionKnowledgeApplications,
    ] = await Promise.all([
      db.knowledge.findMany({
        where: { ownerUserId: userId },
        // Exclude embedding — it's a vector blob, not human-readable personal data.
        select: {
          id: true, type: true, scope: true, ownerUserId: true,
          triggerText: true, ruleText: true, rationale: true,
          tags: true, confidence: true, successCount: true,
          failureCount: true, usageCount: true, decayScore: true,
          framework: true, language: true, createdAt: true,
          confirmedAt: true, lastUsedAt: true, deletedAt: true,
          parentKnowledgeId: true, extractedBy: true,
        },
      }),
      db.session.findMany({ where: { userId } }),
      db.sessionEvent.findMany({
        where: { session: { userId } },
      }),
      db.skill.findMany({ where: { ownerUserId: userId } }),
      db.peerCard.findMany({ where: { ownerUserId: userId } }),
      db.autoskillProposal.findMany({ where: { userId } }),
      db.feedback.findMany({ where: { userId } }),
      db.mCPToken.findMany({
        where: { userId },
        select: {
          id: true, name: true, scope: true, teamId: true,
          createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true,
          // tokenHash intentionally omitted — one-way hash, no personal data value
        },
      }),
      db.oracleCostLedger.findMany({ where: { userId } }),
      db.sessionKnowledgeApplication.findMany({
        where: { session: { userId } },
      }),
    ]);

    void writeAudit({
      actorUserId: actorId,
      action: "admin.gdpr_export",
      targetType: "user",
      targetId: userId,
      payload: { userId },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });

    return Response.json({
      user,
      knowledge,
      sessions,
      sessionEvents,
      skills,
      peerCards,
      autoskillProposals,
      feedback,
      mcpTokens,
      costLedger,
      sessionKnowledgeApplications,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
