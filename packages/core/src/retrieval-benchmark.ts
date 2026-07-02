/**
 * Retrieval benchmark — NDCG@5, KRA-weighted ranking vs a raw-cosine baseline.
 *
 * This is the executable half of docs/VALIDATION.md. It is deliberately PURE:
 * it takes a fixture of already-fetched candidates (each carrying its cosine
 * similarity) and re-ranks them two ways, so the harness runs offline and in
 * CI with no DB or embedding calls. The live-DB half — turning telemetry into
 * a fixture — is scripts/export-retrieval-fixture.ts.
 *
 * It reuses kra.ts `scoreItem` directly rather than copying the formula: the
 * whole point is to measure the ranking production actually uses, so a
 * re-implementation would prove nothing the moment `WEIGHTS` drift.
 *
 * What it can and cannot show (see docs/VALIDATION.md for the full caveats):
 *   - It measures re-ranking quality over a fixed candidate pool. It cannot
 *     measure a *miss* — relevant knowledge the candidate fetch never surfaced.
 *   - Relevance here is a weak proxy label (telemetry: injected-into-a-session-
 *     that-succeeded), not ground truth. It beats author opinion, not a human.
 */
import type { Knowledge, SessionContext } from "@brain/types";
import { scoreItem } from "./kra.js";
import { ndcg } from "./evaluation.js";

export interface BenchmarkCandidate {
  item: Knowledge;
  /** Cosine similarity `1 - (embedding <=> query)`, as fetched by kra.ts. */
  similarity: number;
}

export interface BenchmarkCase {
  query: string;
  context: SessionContext;
  candidates: BenchmarkCandidate[];
  /** Knowledge ids treated as relevant for this query (binary relevance). */
  relevant: string[];
}

export interface BenchmarkResult {
  /** Cases that actually measured something (>=1 relevant id in the pool). */
  n: number;
  /** Cases dropped because no relevant id was present in the candidate pool. */
  skipped: number;
  k: number;
  /** Mean NDCG@k for the raw-cosine baseline. */
  cosineNdcg: number;
  /** Mean NDCG@k for the production KRA ranking. */
  kraNdcg: number;
  /** kraNdcg - cosineNdcg. Positive = KRA's re-ranking helps. */
  delta: number;
  perCase: Array<{ query: string; cosine: number; kra: number }>;
}

/** Rank candidate ids by raw cosine similarity, descending. */
export function rankByCosine(candidates: BenchmarkCandidate[]): string[] {
  return [...candidates]
    .sort((a, b) => b.similarity - a.similarity)
    .map((c) => c.item.id);
}

/** Rank candidate ids by the production KRA score, descending. */
export function rankByKra(
  candidates: BenchmarkCandidate[],
  context: SessionContext,
  now: number = Date.now(),
): string[] {
  return [...candidates]
    .map((c) => ({
      id: c.item.id,
      score: scoreItem(c.item, c.similarity, context, now),
    }))
    .sort((a, b) => b.score - a.score)
    .map((c) => c.id);
}

/** Binary-relevance NDCG@k for one ranking. */
function ndcgForRanking(
  rankedIds: string[],
  relevant: Set<string>,
  k: number,
): number {
  const relevances = rankedIds.map((id) => (relevant.has(id) ? 1 : 0));
  return ndcg(relevances, k);
}

export function runBenchmark(
  cases: BenchmarkCase[],
  opts: { k?: number; now?: number } = {},
): BenchmarkResult {
  const k = opts.k ?? 5;
  const now = opts.now ?? Date.now();

  let cosineSum = 0;
  let kraSum = 0;
  let skipped = 0;
  const perCase: BenchmarkResult["perCase"] = [];

  for (const c of cases) {
    const inPool = new Set(c.candidates.map((x) => x.item.id));
    const relevant = new Set(c.relevant.filter((id) => inPool.has(id)));
    // A case only measures re-ranking if at least one relevant item is actually
    // in the pool. Otherwise every ranker scores 0 (NDCG's ideal DCG is 0) and
    // the case is noise, not signal — count it as skipped, don't average it in.
    if (relevant.size === 0) {
      skipped++;
      continue;
    }
    const cosine = ndcgForRanking(rankByCosine(c.candidates), relevant, k);
    const kra = ndcgForRanking(rankByKra(c.candidates, c.context, now), relevant, k);
    cosineSum += cosine;
    kraSum += kra;
    perCase.push({ query: c.query, cosine, kra });
  }

  const n = perCase.length;
  const cosineNdcg = n === 0 ? 0 : cosineSum / n;
  const kraNdcg = n === 0 ? 0 : kraSum / n;
  return {
    n,
    skipped,
    k,
    cosineNdcg,
    kraNdcg,
    delta: kraNdcg - cosineNdcg,
    perCase,
  };
}
