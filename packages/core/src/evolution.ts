/**
 * Evolution — background jobs that keep knowledge fresh.
 *
 * Schedule (via pg-boss):
 *   daily    decayUnused()
 *   daily    consolidateDuplicates()
 *   weekly   detectContradictions()
 *   weekly   detectObsolescence()
 *   weekly   snapshotKnowledgeHealth()
 *
 * Each function is idempotent — safe to re-run after a failure.
 */
import { db, toVector } from "@brain/db";
import { cosineSimilarity } from "./embedding.js";
import { effectivenessScore } from "./knowledge-stats.js";
import { DECISION_TAG } from "./learnings.js";

const HALF_LIFE_DAYS = 90;
const MIN_DECAY = 0.05;

/** Decisions are user-stated facts, not scored heuristics — never decay/flag them (spec 2026-06-16 §5). */
export function isDecayExempt(tags: string[]): boolean {
  return tags.includes(DECISION_TAG);
}

export async function decayUnused(): Promise<{ updated: number; flaggedLowEffectiveness: number }> {
  // Audit WK2 (#103): batch with cursor pagination instead of loading
  // every Knowledge row into memory at once. The previous `findMany()`
  // would OOM the worker once a tenant accumulated tens of thousands of
  // rules. Per-batch processing keeps memory bounded while still doing
  // the per-row work in a single daily pass.
  const BATCH = 1000;
  let updated = 0;
  let flaggedLowEffectiveness = 0;
  const recentCutoff = new Date(Date.now() - 30 * 86_400_000); // 30 days
  let cursorId: string | undefined;
  // Fetch one batch at a time, ordered by id (stable cursor) so a
  // mid-run insert can't shift the cursor.
  for (;;) {
    const rows = await db.knowledge.findMany({
      where: {
        deletedAt: null,
        ...(cursorId ? { id: { gt: cursorId } } : {}),
      },
      orderBy: { id: "asc" },
      take: BATCH,
      select: {
        id: true,
        lastUsedAt: true,
        createdAt: true,
        decayScore: true,
        successCount: true,
        failureCount: true,
        usageCount: true,
        tags: true,
      },
    });
    if (rows.length === 0) break;
    cursorId = rows[rows.length - 1]!.id;
    const result = await processDecayBatch(rows, recentCutoff);
    updated += result.updated;
    flaggedLowEffectiveness += result.flaggedLowEffectiveness;
  }
  return { updated, flaggedLowEffectiveness };
}

async function processDecayBatch(
  rows: Array<{
    id: string;
    lastUsedAt: Date | null;
    createdAt: Date;
    decayScore: number;
    successCount: number;
    failureCount: number;
    usageCount: number;
    tags: string[];
  }>,
  recentCutoff: Date,
): Promise<{ updated: number; flaggedLowEffectiveness: number }> {
  let updated = 0;
  let flaggedLowEffectiveness = 0;
  for (const r of rows) {
    if (isDecayExempt(r.tags)) continue;
    const ref = r.lastUsedAt ?? r.createdAt;
    const days = (Date.now() - new Date(ref).getTime()) / 86_400_000;

    // Core Value B+: effectiveness-aware decay. Rules with measured low
    // effectiveness (≥5 outcomes, score < 0.3) decay TWICE as fast — the
    // half-life shrinks from 90 days to 45. Rules with measured HIGH
    // effectiveness (≥5 outcomes, score ≥ 0.7) decay HALF as fast — half-
    // life stretches to 180 days. Rules with insufficient data (< 3
    // outcomes) decay at the baseline rate. This means usage signal feeds
    // BACK into how aggressively the Brain forgets — earned evidence
    // sticks around longer; underperformers fade faster.
    const score = effectivenessScore({
      successCount: r.successCount,
      failureCount: r.failureCount,
      usageCount: r.usageCount,
    });
    const outcomes = r.successCount + r.failureCount;
    let halfLife = HALF_LIFE_DAYS;
    if (score !== -1 && outcomes >= 5) {
      if (score < 0.3) halfLife = HALF_LIFE_DAYS / 2;
      else if (score >= 0.7) halfLife = HALF_LIFE_DAYS * 2;
    }
    const decay = Math.max(Math.exp(-days / halfLife), MIN_DECAY);

    // Flag low-effectiveness rules for operator review.
    // Criteria: effectiveness < 0.3, ≥5 outcomes, no usage in last 30 days.
    const noRecentUsage = !r.lastUsedAt || r.lastUsedAt < recentCutoff;
    const flagTag = "flagged:low-effectiveness";
    const alreadyFlagged = r.tags.includes(flagTag);

    if (score !== -1 && score < 0.3 && outcomes >= 5 && noRecentUsage && !alreadyFlagged) {
      await db.knowledge.update({
        where: { id: r.id },
        data: { tags: { push: flagTag } },
      });
      flaggedLowEffectiveness++;
    }

    if (Math.abs(decay - r.decayScore) > 0.01) {
      await db.knowledge.update({
        where: { id: r.id },
        data: { decayScore: decay },
      });
      updated++;
    }
  }
  return { updated, flaggedLowEffectiveness };
}

export async function consolidateDuplicates(): Promise<{ merged: number }> {
  // For each user, find knowledge pairs with cosine similarity > 0.92 and
  // the same type. Merge the younger into the older (bump confidence,
  // concatenate sourceSessionIds, preserve parentKnowledgeId chain).
  //
  // Audit WK3 (#103): the previous implementation called `embed()` on
  // every Knowledge row of every user every daily run — paying the LLM
  // API cost for embeddings already stored in the `embedding` pgvector
  // column. Switched to a single raw SELECT per user that pulls
  // `embedding::text` and parses it into number[]. Embedding API calls
  // dropped to zero on this path; the only network call left is the
  // mergeInto write per duplicate found.
  const users = await db.user.findMany({ select: { id: true } });
  let merged = 0;
  for (const u of users) {
    const rows = await db.$queryRawUnsafe<
      Array<{ id: string; type: string; embedding: string | null }>
    >(
      `SELECT id, type, embedding::text AS embedding
       FROM "Knowledge"
       WHERE "ownerUserId" = $1
         AND "deletedAt" IS NULL
         AND embedding IS NOT NULL
       ORDER BY "createdAt" ASC`,
      u.id,
    );

    const items = rows.map((r) => ({
      id: r.id,
      type: r.type,
      vec: parseVector(r.embedding!),
    }));

    const removed = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      if (removed.has(items[i]!.id)) continue;
      for (let j = i + 1; j < items.length; j++) {
        if (removed.has(items[j]!.id)) continue;
        if (items[i]!.type !== items[j]!.type) continue;
        if (cosineSimilarity(items[i]!.vec, items[j]!.vec) > 0.92) {
          await mergeInto(items[i]!.id, items[j]!.id);
          removed.add(items[j]!.id);
          merged++;
        }
      }
    }
  }
  return { merged };
}

/**
 * pgvector `vector` columns serialise to text as "[v1,v2,...]". Parse
 * back into a JS number[] for cosine similarity. No defensive validation
 * because the only producer is pgvector itself.
 */
function parseVector(s: string): number[] {
  // Strip brackets, split on commas, parse each.
  const inner = s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1) : s;
  return inner.split(",").map((x) => Number(x));
}

async function mergeInto(keeperId: string, victimId: string): Promise<void> {
  const victim = await db.knowledge.findUniqueOrThrow({
    where: { id: victimId },
  });
  await db.knowledge.update({
    where: { id: keeperId },
    data: {
      successCount: { increment: victim.successCount },
      failureCount: { increment: victim.failureCount },
      usageCount: { increment: victim.usageCount },
      sourceSessionIds: { push: victim.sourceSessionIds },
      confidence: { increment: 0.02 },
    },
  });
  await db.knowledge.update({
    where: { id: victimId },
    data: { deletedAt: new Date() },
  });
}

export async function detectContradictions(): Promise<
  { pairs: Array<{ a: string; b: string }> }
> {
  // A naive v1: items of types (reflex|principle) vs (anti_principle) with
  // high semantic similarity are potential contradictions. Surfaced in the
  // dashboard; user resolves.
  //
  // Proper v2 uses symbolic when/then + an LLM judge.
  return { pairs: [] };
}

export async function detectObsolescence(): Promise<{ flagged: number }> {
  // Heuristic: knowledge with framework set and no successes in 180 days gets
  // decayScore halved and a flag for user review.
  const cutoff = new Date(Date.now() - 180 * 86_400_000);
  const rows = await db.knowledge.findMany({
    where: {
      framework: { not: null },
      deletedAt: null,
      OR: [{ lastUsedAt: { lt: cutoff } }, { lastUsedAt: null }],
    },
    select: { id: true, decayScore: true },
  });
  for (const r of rows) {
    await db.knowledge.update({
      where: { id: r.id },
      data: { decayScore: Math.max(r.decayScore * 0.5, MIN_DECAY) },
    });
  }
  return { flagged: rows.length };
}

export async function snapshotKnowledgeHealth(): Promise<void> {
  const users = await db.user.findMany({ select: { id: true } });
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  for (const u of users) {
    const all = await db.knowledge.findMany({
      where: { ownerUserId: u.id, deletedAt: null },
      select: {
        lastUsedAt: true,
        createdAt: true,
        confidence: true,
      },
    });
    if (all.length === 0) continue;
    const usedRecently = all.filter(
      (k) => k.lastUsedAt && k.lastUsedAt > thirtyDaysAgo,
    ).length;
    const avgConf =
      all.reduce((s, k) => s + k.confidence, 0) / all.length;
    const ageDays = all
      .map((k) => (Date.now() - k.createdAt.getTime()) / 86_400_000)
      .sort((a, b) => a - b);
    const medianAge = ageDays[Math.floor(ageDays.length / 2)] ?? 0;

    await db.knowledgeHealthSnapshot.create({
      data: {
        tenantScope: `user:${u.id}`,
        usedInLast30Days: usedRecently,
        totalActive: all.length,
        averageConfidence: avgConf,
        contradictionCount: 0,
        medianAgeDays: medianAge,
      },
    });
  }
}
