import { describe, it, expect } from "vitest";
import type { Knowledge, SessionContext } from "@brain/types";
import { ndcg } from "../evaluation.js";
import {
  rankByCosine,
  rankByKra,
  runBenchmark,
  type BenchmarkCase,
} from "../retrieval-benchmark.js";

const NOW = Date.UTC(2026, 0, 1);

function makeKnowledge(over: Partial<Knowledge> & { id: string }): Knowledge {
  return {
    type: "reflex",
    scope: "user",
    ownerUserId: "u1",
    ownerTeamId: null,
    ownerProjectId: null,
    triggerText: "t",
    ruleText: "r",
    rationale: null,
    symbolicWhen: null,
    symbolicThen: null,
    instead: null,
    framework: null,
    language: null,
    tags: [],
    confidence: 0.5,
    successCount: 0,
    failureCount: 0,
    usageCount: 0,
    decayScore: 1,
    createdAt: new Date(NOW),
    confirmedAt: null,
    lastUsedAt: null,
    extractedBy: "kea",
    sourceSessionIds: [],
    parentKnowledgeId: null,
    ...over,
  };
}

const ctx: SessionContext = { sessionId: "s1", userId: "u1" };

describe("ndcg", () => {
  it("is 1.0 for a perfect ranking", () => {
    expect(ndcg([1, 1, 0, 0], 5)).toBeCloseTo(1, 10);
  });

  it("is 0 when nothing is relevant (ideal DCG is 0)", () => {
    expect(ndcg([0, 0, 0], 5)).toBe(0);
  });

  it("matches the hand-computed value for a mis-ordered ranking", () => {
    // relevances [1,0,1] -> DCG = 1/log2(2) + 0 + 1/log2(4) = 1 + 0.5 = 1.5
    // ideal [1,1,0]      -> 1/log2(2) + 1/log2(3) = 1 + 0.63093 = 1.63093
    // NDCG = 1.5 / 1.63093 = 0.91972
    expect(ndcg([1, 0, 1], 3)).toBeCloseTo(0.91972, 4);
  });

  it("respects the cutoff k", () => {
    // Only the top-2 count; the relevant item at rank 3 is ignored.
    expect(ndcg([0, 0, 1], 2)).toBe(0);
  });
});

describe("rankByCosine", () => {
  it("orders candidates by similarity descending", () => {
    const cands = [
      { item: makeKnowledge({ id: "a" }), similarity: 0.3 },
      { item: makeKnowledge({ id: "b" }), similarity: 0.9 },
      { item: makeKnowledge({ id: "c" }), similarity: 0.6 },
    ];
    expect(rankByCosine(cands)).toEqual(["b", "c", "a"]);
  });
});

describe("rankByKra", () => {
  it("promotes a proven rule over a fresh one at equal similarity", () => {
    const cands = [
      { item: makeKnowledge({ id: "fresh", successCount: 0, failureCount: 0 }), similarity: 0.9 },
      { item: makeKnowledge({ id: "proven", successCount: 10, failureCount: 0 }), similarity: 0.9 },
    ];
    expect(rankByKra(cands, ctx, NOW)).toEqual(["proven", "fresh"]);
  });
});

describe("runBenchmark", () => {
  it("scores a perfect pool as NDCG 1.0 for both rankers", () => {
    const cases: BenchmarkCase[] = [
      {
        query: "q",
        context: ctx,
        relevant: ["rel"],
        candidates: [
          { item: makeKnowledge({ id: "rel" }), similarity: 0.95 },
          { item: makeKnowledge({ id: "noise" }), similarity: 0.2 },
        ],
      },
    ];
    const r = runBenchmark(cases, { now: NOW });
    expect(r.n).toBe(1);
    expect(r.cosineNdcg).toBeCloseTo(1, 10);
    expect(r.kraNdcg).toBeCloseTo(1, 10);
    expect(r.delta).toBeCloseTo(0, 10);
  });

  it("shows KRA beating cosine when a proven rule is a hair less similar", () => {
    // Non-relevant "a" has slightly higher cosine (0.91) so the baseline ranks
    // it first; the relevant, heavily-proven "b" (0.90) is demoted by cosine but
    // promoted by KRA's success-rate tie-breaker. KRA should recover NDCG 1.0.
    const cases: BenchmarkCase[] = [
      {
        query: "q",
        context: ctx,
        relevant: ["b"],
        candidates: [
          { item: makeKnowledge({ id: "a", successCount: 0, failureCount: 0 }), similarity: 0.91 },
          { item: makeKnowledge({ id: "b", successCount: 10, failureCount: 0 }), similarity: 0.9 },
        ],
      },
    ];
    const r = runBenchmark(cases, { now: NOW });
    // cosine ranking [a,b] -> relevances [0,1] -> NDCG@5 = 1/log2(3) = 0.63093
    expect(r.cosineNdcg).toBeCloseTo(0.63093, 4);
    expect(r.kraNdcg).toBeCloseTo(1, 10);
    expect(r.delta).toBeGreaterThan(0);
  });

  it("skips cases whose relevant ids never made it into the pool", () => {
    const cases: BenchmarkCase[] = [
      {
        query: "unusable",
        context: ctx,
        relevant: ["missing"],
        candidates: [{ item: makeKnowledge({ id: "x" }), similarity: 0.9 }],
      },
    ];
    const r = runBenchmark(cases, { now: NOW });
    expect(r.n).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.cosineNdcg).toBe(0);
  });
});
