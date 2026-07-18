/**
 * Knowledge stats helpers — update usage/outcome counters and compute the
 * per-rule effectiveness score that powers the Skills effectiveness badge
 * and the "Most useful rules" dashboard card.
 *
 * All DB operations are best-effort: callers catch and log errors rather than
 * propagating them to the user-facing response.
 */
import type { PrismaClient } from "@brain/db";

// ─────────────────────────────────────────────
//  Bulk bump helpers (single-round-trip each)
// ─────────────────────────────────────────────

/**
 * Increment usageCount and update lastUsedAt for every Knowledge row that
 * appeared as a citation in an Oracle answer.
 *
 * Best-effort — called after the Oracle response is already on the wire, so
 * errors here must never propagate to the client.
 */
export async function bulkBumpKnowledgeUsage(
  db: PrismaClient,
  knowledgeIds: string[],
): Promise<void> {
  if (knowledgeIds.length === 0) return;
  await db.knowledge.updateMany({
    where: { id: { in: knowledgeIds } },
    data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}

/**
 * Retire a superseded decision and link its successor (spec 2026-06-16 §5).
 * Reuses parentKnowledgeId lineage; soft-deletes the predecessor so KRA stops
 * serving it. Ownership-checked, and — since 2026-07-14 — optionally
 * project-checked too: without `args.projectId`, a caller could retire a row
 * from a DIFFERENT project the same user happens to own knowledge in.
 * `projectId` is optional so pre-existing callers keep their current
 * behavior; new callers (the REST teach path, the meeting-upload feature)
 * should always pass it. Returns false (no throw) when the target is
 * missing, not owned, or (when checked) in the wrong project — capture of
 * the new decision must never fail on this.
 */
export async function supersedeKnowledge(
  db: PrismaClient,
  args: { newId: string; supersededId: string; userId: string; projectId?: string },
): Promise<boolean> {
  const target = await db.knowledge.findFirst({
    where: {
      id: args.supersededId,
      ownerUserId: args.userId,
      deletedAt: null,
      ...(args.projectId ? { ownerProjectId: args.projectId } : {}),
    },
    select: { id: true, ownerUserId: true },
  });
  if (!target) return false;
  await db.knowledge.update({
    where: { id: args.supersededId },
    data: { deletedAt: new Date() },
  });
  await db.knowledge.update({
    where: { id: args.newId },
    data: { parentKnowledgeId: args.supersededId },
  });
  return true;
}

/**
 * After a session outcome is reported, bump successCount or failureCount for
 * every Knowledge row that was applied (injected) during that session.
 *
 * Looks up the Knowledge IDs via SessionKnowledgeApplication rows so the
 * MCP reporter only needs to pass the sessionId + success flag.
 */
export async function bulkBumpKnowledgeOutcome(
  db: PrismaClient,
  sessionId: string,
  success: boolean,
): Promise<void> {
  // Find which Knowledge rows were injected into this session.
  const applications = await db.sessionKnowledgeApplication.findMany({
    where: { sessionId, role: "injected" },
    select: { knowledgeId: true },
  });
  const ids = applications
    .map((a) => a.knowledgeId)
    .filter((id): id is string => id !== null);
  if (ids.length === 0) return;

  if (success) {
    await db.knowledge.updateMany({
      where: { id: { in: ids } },
      data: { successCount: { increment: 1 } },
    });
  } else {
    await db.knowledge.updateMany({
      where: { id: { in: ids } },
      data: { failureCount: { increment: 1 } },
    });
  }
}

// ─────────────────────────────────────────────
//  Derived effectiveness score
// ─────────────────────────────────────────────

/**
 * Compute the effectiveness score for a Knowledge row.
 *
 * Returns a value in 0..1 when there are ≥ 3 outcomes, or -1 (the
 * "insufficient data" sentinel) when fewer than 3 outcomes have been recorded.
 *
 * The sentinel -1 is rendered as "— Untested" or "— Insufficient data" in the
 * UI so the user is never shown a misleading percentage from small samples.
 */
export function effectivenessScore(k: {
  successCount: number;
  failureCount: number;
  usageCount: number;
}): number {
  const total = k.successCount + k.failureCount;
  if (total < 3) return -1; // insufficient data
  return k.successCount / total;
}

// ─────────────────────────────────────────────
//  Top-rules query (for the dashboard card)
// ─────────────────────────────────────────────

export interface TopRuleRow {
  id: string;
  title: string;
  type: string;
  score: number; // 0..1
  outcomes: number; // successCount + failureCount
  usageCount: number;
}

/**
 * Return the top-N Knowledge rows by effectiveness score, filtered to rows
 * with at least `minOutcomes` (default 5) recorded outcomes.
 *
 * Fetches all eligible rows for the user/project scope and sorts in-process
 * (no raw SQL needed — the filter ensures a small result set).
 */
export async function getTopRules(
  db: PrismaClient,
  opts: {
    userId: string;
    projectId?: string;
    limit?: number;
    minOutcomes?: number;
  },
): Promise<TopRuleRow[]> {
  const { userId, projectId, limit = 5, minOutcomes = 5 } = opts;

  const rows = await db.knowledge.findMany({
    where: {
      ownerUserId: userId,
      deletedAt: null,
      ...(projectId ? { ownerProjectId: projectId } : {}),
    },
    select: {
      id: true,
      ruleText: true,
      type: true,
      successCount: true,
      failureCount: true,
      usageCount: true,
    },
    orderBy: { successCount: "desc" },
    // Fetch more than limit so we can filter by minOutcomes in-process
    take: limit * 20,
  });

  return rows
    .filter((r) => r.successCount + r.failureCount >= minOutcomes)
    .map((r) => {
      const total = r.successCount + r.failureCount;
      const score = total >= 3 ? r.successCount / total : -1;
      const firstLine = r.ruleText.split(/[.!?\n]/)[0] ?? r.ruleText;
      return {
        id: r.id,
        title: firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine,
        type: r.type,
        score,
        outcomes: total,
        usageCount: r.usageCount,
      };
    })
    .filter((r) => r.score >= 0) // drop insufficient-data rows
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
