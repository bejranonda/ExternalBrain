/**
 * Evaluation — Session Quality Score + knowledge health metrics.
 *
 * Without SQS visible, the flywheel is invisible. Ship this in v1.
 * Formula per research/knowledge/06-evaluation-framework.md §4.
 */
import type { SessionMetrics, SessionQualityScore } from "@brain/types";
import { db } from "@brain/db";

export function computeSQS(
  metrics: SessionMetrics & { outcome: "success" | "partial" | "failed" },
): SessionQualityScore {
  const buildSuccess = metrics.outcome === "success" ? 1 : metrics.outcome === "partial" ? 0.5 : 0;
  const userFeedback =
    metrics.userFeedback === "up" ? 1 : metrics.userFeedback === "down" ? 0 : 0.5;

  const totalTouched =
    metrics.filesCreated.length +
    metrics.filesModified.length +
    metrics.filesRejected.length;
  const accepted =
    metrics.filesCreated.length + metrics.filesModified.length;
  const diffAcceptanceRatio = totalTouched === 0 ? 0.5 : accepted / totalTouched;

  // Penalize high build-attempt counts (each extra attempt = 0.1 off)
  const attemptPenalty = Math.min((metrics.buildAttempts - 1) * 0.1, 0.5);
  const clarificationPenalty = Math.min(attemptPenalty, 0.5);

  // Weighted score (0-1), surfaced as 0-100
  const raw =
    0.4 * buildSuccess +
    0.25 * userFeedback +
    0.25 * diffAcceptanceRatio +
    0.1 * (1 - clarificationPenalty);

  return {
    sessionId: "",
    score: Math.round(raw * 100),
    buildSuccess,
    userFeedback,
    diffAcceptanceRatio,
    clarificationPenalty,
    computedAt: new Date(),
  };
}

export async function computeAndStoreSQS(
  sessionId: string,
  metrics: SessionMetrics & { outcome: "success" | "partial" | "failed" },
): Promise<number> {
  const sqs = computeSQS(metrics);
  await db.session.update({
    where: { id: sessionId },
    data: { sqs: sqs.score },
  });
  return sqs.score;
}

// ============================================================
// Retrieval benchmark — NDCG@5
// ============================================================

export function ndcg(relevances: number[], k = 5): number {
  const dcg = relevances
    .slice(0, k)
    .reduce((s, rel, i) => s + rel / Math.log2(i + 2), 0);
  const ideal = [...relevances]
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((s, rel, i) => s + rel / Math.log2(i + 2), 0);
  return ideal === 0 ? 0 : dcg / ideal;
}
