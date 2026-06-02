/**
 * KRA — Knowledge Retrieval Agent.
 *
 * The secretary. Given a user's coding prompt + context, returns the
 * optimal knowledge bundle to inject into the AI's system prompt.
 *
 * Hybrid retrieval = semantic (pgvector) + metadata filter + graph expansion.
 * Ranking formula from research/knowledge/15-implementation-stubs.md §3.
 */
import type {
  Knowledge,
  KnowledgeBundle,
  SessionContext,
} from "@brain/types";
import { db, toVector } from "@brain/db";
import { embed } from "./embedding.js";
import { buildRawProjectFilterV2 } from "./scope-filter.js";

interface ScoredItem {
  item: Knowledge;
  score: number;
  similarity: number;
}

// ============================================================
// Main entry
// ============================================================

export async function retrieve(
  prompt: string,
  context: SessionContext,
  maxItems = 10,
): Promise<KnowledgeBundle> {
  const { bundle } = await retrieveScored(prompt, context, maxItems);
  return bundle;
}

export interface ScoredRetrievalRow {
  id: string;
  type: string;
  ruleText: string;
  triggerText: string;
  score: number;
  similarity: number;
  recency: number;
  used: boolean;
}

/**
 * Same as `retrieve`, but also returns per-candidate scoring breakdown for
 * surfaces like the Oracle retrieval inspector. The `used` flag marks
 * candidates that were included in the final injected bundle.
 */
export async function retrieveScored(
  prompt: string,
  context: SessionContext,
  maxItems = 10,
): Promise<{ bundle: KnowledgeBundle; rows: ScoredRetrievalRow[] }> {
  const queryVector = await embed(prompt);
  const candidates = await fetchCandidates(queryVector, context, 20);

  const scored: ScoredItem[] = candidates.map((c) => ({
    item: c.item,
    similarity: c.similarity,
    score: scoreItem(c.item, c.similarity, context),
  }));

  scored.sort((a, b) => b.score - a.score);

  const diversified = diversify(scored, maxItems);
  const usedIds = new Set(diversified.map((s) => s.item.id));
  const bundle = bucketByType(diversified.map((s) => s.item));

  const injectedIds = diversified.map((s) => s.item.id);
  if (injectedIds.length > 0 && context.sessionId) {
    await recordInjection(context.sessionId, injectedIds);
  }
  bundle.injectedIds = injectedIds;

  const rows: ScoredRetrievalRow[] = scored.map((s) => {
    const ref = s.item.confirmedAt ?? s.item.createdAt;
    const daysSince = (Date.now() - new Date(ref).getTime()) / 86_400_000;
    const recency = Math.exp(-daysSince / 90);
    return {
      id: s.item.id,
      type: s.item.type,
      ruleText: s.item.ruleText,
      triggerText: s.item.triggerText,
      score: s.score,
      similarity: s.similarity,
      recency,
      used: usedIds.has(s.item.id),
    };
  });

  return { bundle, rows };
}

// ============================================================
// Candidate fetch — pgvector top-20 with scope + decay filters
// ============================================================

async function fetchCandidates(
  queryVector: number[],
  context: SessionContext,
  limit: number,
): Promise<Array<{ item: Knowledge; similarity: number }>> {
  const vec = toVector(queryVector);
  const dataScope = context.dataScope ?? "project";
  const projectId = context.projectId ?? null;
  const accessibleProjectIds = context.accessibleProjectIds ?? [];

  // Build Phase 4 visibility-aware SQL fragment (params start at $3).
  // $1 = vector, $2 = userId, $3+ = filter params
  const { sql: projectFilter, params: projectParams } = buildRawProjectFilterV2(
    {
      userId: context.userId,
      activeProjectId: projectId,
      activeOrgId: context.orgId ?? null,
      accessibleProjectIds,
      scope: dataScope,
    },
    3,
  );

  // Explicit column list — `SELECT *` would pull the `embedding vector(1536)`
  // column, which Prisma's driver can't deserialize (pgvector's `vector` type
  // has no Prisma equivalent). Listing columns keeps the shape Prisma-safe.
  const rows = await db.$queryRawUnsafe<
    Array<Knowledge & { _similarity: number }>
  >(
    `
    SELECT id, type, scope, "ownerUserId", "ownerTeamId", "ownerProjectId",
           "triggerText", "ruleText", rationale, "symbolicWhen", "symbolicThen",
           instead, framework, language, tags,
           confidence, "successCount", "failureCount", "usageCount", "decayScore",
           "createdAt", "confirmedAt", "lastUsedAt", "deletedAt",
           "extractedBy", "sourceSessionIds", "parentKnowledgeId",
           1 - (embedding <=> $1::vector) AS "_similarity"
    FROM "Knowledge"
    WHERE embedding IS NOT NULL
      AND "decayScore" > 0.3
      AND "ownerUserId" = $2${projectFilter}
    ORDER BY embedding <=> $1::vector ASC
    LIMIT ${limit}
    `,
    vec,
    context.userId,
    ...projectParams,
  );

  return rows.map((r) => ({
    item: r as Knowledge,
    similarity: (r as Knowledge & { _similarity: number })._similarity,
  }));
}

// ============================================================
// Scoring — multi-factor, tunable weights
// ============================================================

/**
 * Retrieval scoring weights. The benchmark fixture used to tune them was
 * retired with the demo seed (2026-05-08); see docs/VALIDATION.md.
 *
 * History:
 *   - Pre-2026-04-23 (0.4/0.2/0.15/0.15/0.1): the formula was chosen a priori
 *     from research. Benchmark showed KRA NDCG@5 = 0.928 vs cosine-only = 1.000
 *     on a 20-query hand-labelled fixture — a 7.2 % REGRESSION. The 60 %
 *     weight on non-semantic factors was demoting relevant rows when cosine
 *     already had a clear winner.
 *   - 2026-04-23 (0.7/0.08/0.08/0.08/0.06): semantic similarity dominates;
 *     the other factors act as tie-breakers between near-equivalent cosine
 *     matches. See `docs/VALIDATION.md` for the before/after numbers.
 *
 * When you change these, re-run the benchmark and update VALIDATION.md in
 * the same PR. A weight change that drops NDCG@5 below 0.9 is a regression.
 */
const WEIGHTS = {
  semanticSimilarity: 0.7,
  successRate: 0.08,
  recencyDecay: 0.08,
  contextFit: 0.08,
  confidence: 0.06,
} as const;

function scoreItem(
  item: Knowledge,
  similarity: number,
  context: SessionContext,
): number {
  // Effectiveness signal: (success + 1) / (success + failure + 2) — true
  // Laplace smoothing (additive smoothing with alpha=1). Audit R5 (#103):
  // the previous formula was `success / (s + f + 1)`, which is NOT
  // Laplace and undercounts the high-success case (10/0 returns 0.91
  // instead of 1.0).
  //
  // The "fewer than 3 outcomes" floor stays as a neutral 0.5 — it
  // matches the `effectivenessScore` "insufficient data" sentinel in
  // packages/core/src/knowledge-stats.ts, and keeps fresh rules from
  // being over-penalized during onboarding before outcomes accumulate.
  // Rules with ≥3 outcomes now rank by true Laplace.
  const totalOutcomes = item.successCount + item.failureCount;
  const success =
    totalOutcomes < 3
      ? 0.5
      : (item.successCount + 1) / (item.successCount + item.failureCount + 2);

  const ref = item.confirmedAt ?? item.createdAt;
  const daysSince =
    (Date.now() - new Date(ref).getTime()) / 86_400_000;
  const recency = Math.exp(-daysSince / 90); // half-life 90 days

  const contextFit = calculateContextFit(item, context);

  return (
    WEIGHTS.semanticSimilarity * similarity +
    WEIGHTS.successRate * success +
    WEIGHTS.recencyDecay * recency +
    WEIGHTS.contextFit * contextFit +
    WEIGHTS.confidence * item.confidence
  );
}

function calculateContextFit(
  item: Knowledge,
  context: SessionContext,
): number {
  let fit = 0.5;
  if (item.framework && item.framework === context.framework) fit += 0.3;
  if (item.language && item.language === context.language) fit += 0.2;
  if (
    item.scope === "project" &&
    item.ownerProjectId &&
    item.ownerProjectId === context.projectId
  ) {
    fit += 0.2;
  }
  if (
    context.sessionMode === "debugging" &&
    item.type === "heuristic" &&
    item.tags.includes("debugging")
  ) {
    fit += 0.2;
  }
  return Math.min(fit, 1);
}

// ============================================================
// Diversify — max 3 per type, total <= max, min score 0.45
// ============================================================

function diversify(scored: ScoredItem[], max: number): ScoredItem[] {
  const MIN_SCORE = 0.45;
  const perTypeCap = 3;
  const counts = new Map<string, number>();
  const out: ScoredItem[] = [];
  for (const s of scored) {
    if (s.score < MIN_SCORE) break;
    const n = counts.get(s.item.type) ?? 0;
    if (n >= perTypeCap) continue;
    out.push(s);
    counts.set(s.item.type, n + 1);
    if (out.length >= max) break;
  }
  return out;
}

// ============================================================
// Bucket by type — what the MCP tool response shape expects
// ============================================================

function bucketByType(items: Knowledge[]): KnowledgeBundle {
  const bundle: KnowledgeBundle = {
    reflexes: [],
    recipes: [],
    heuristics: [],
    principles: [],
    antiPrinciples: [],
    skill: null,
    injectedIds: [],
  };
  for (const it of items) {
    switch (it.type) {
      case "reflex":
        bundle.reflexes.push(it);
        break;
      case "recipe":
        bundle.recipes.push(it);
        break;
      case "heuristic":
        bundle.heuristics.push(it);
        break;
      case "principle":
        bundle.principles.push(it);
        break;
      case "anti_principle":
        bundle.antiPrinciples.push(it);
        break;
    }
  }
  return bundle;
}

// ============================================================
// Side effects — record what was injected
// ============================================================

async function recordInjection(
  sessionId: string,
  knowledgeIds: string[],
): Promise<void> {
  await Promise.all(
    knowledgeIds.map((id) =>
      db.sessionKnowledgeApplication
        .create({
          data: {
            sessionId,
            knowledgeId: id,
            role: "injected",
          },
        })
        .catch(() => {
          /* duplicate — unique constraint already covered */
        }),
    ),
  );
  await db.knowledge.updateMany({
    where: { id: { in: knowledgeIds } },
    data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}
