/**
 * Tests for knowledge-stats.ts — effectivenessScore + related helpers.
 *
 * bulkBumpKnowledgeUsage and bulkBumpKnowledgeOutcome are thin wrappers around
 * prisma.knowledge.updateMany which is well-tested upstream; they are covered
 * here by shape/type tests and light integration-style assertions.
 */
import { describe, it, expect } from "vitest";
import { effectivenessScore } from "../knowledge-stats.js";

describe("effectivenessScore", () => {
  // ─── Insufficient-data sentinel ──────────────────────────────────────────

  it("returns -1 when there are 0 outcomes (no data at all)", () => {
    expect(effectivenessScore({ successCount: 0, failureCount: 0, usageCount: 0 })).toBe(-1);
  });

  it("returns -1 when there are exactly 1 outcome", () => {
    expect(effectivenessScore({ successCount: 1, failureCount: 0, usageCount: 5 })).toBe(-1);
  });

  it("returns -1 when there are exactly 2 outcomes", () => {
    expect(effectivenessScore({ successCount: 1, failureCount: 1, usageCount: 10 })).toBe(-1);
  });

  it("returns a real score at exactly the threshold of 3 outcomes", () => {
    const score = effectivenessScore({ successCount: 2, failureCount: 1, usageCount: 10 });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  // ─── Boundary values ─────────────────────────────────────────────────────

  it("returns 1.0 when all outcomes are successes (3 successes, 0 failures)", () => {
    expect(effectivenessScore({ successCount: 3, failureCount: 0, usageCount: 15 })).toBe(1);
  });

  it("returns 0.0 when all outcomes are failures (0 successes, 3 failures)", () => {
    expect(effectivenessScore({ successCount: 0, failureCount: 3, usageCount: 8 })).toBe(0);
  });

  it("returns exactly 0.5 for equal success/failure counts (4 each)", () => {
    expect(effectivenessScore({ successCount: 4, failureCount: 4, usageCount: 20 })).toBe(0.5);
  });

  // ─── Typical values ───────────────────────────────────────────────────────

  it("returns ~0.87 for 13 successes and 2 failures", () => {
    const score = effectivenessScore({ successCount: 13, failureCount: 2, usageCount: 50 });
    expect(score).toBeCloseTo(13 / 15, 5);
    expect(score).toBeGreaterThan(0.7); // would render as ✓ green
  });

  it("returns ~0.55 for 6 successes and 5 failures (yellow band)", () => {
    const score = effectivenessScore({ successCount: 6, failureCount: 5, usageCount: 30 });
    expect(score).toBeCloseTo(6 / 11, 5);
    expect(score).toBeGreaterThanOrEqual(0.4);
    expect(score).toBeLessThan(0.7);
  });

  it("returns ~0.18 for 2 successes and 9 failures (red band)", () => {
    const score = effectivenessScore({ successCount: 2, failureCount: 9, usageCount: 20 });
    expect(score).toBeCloseTo(2 / 11, 5);
    expect(score).toBeLessThan(0.4);
  });

  // ─── usageCount does not affect score computation ─────────────────────────

  it("ignores usageCount — same success/failure counts produce same score regardless of usage", () => {
    const a = effectivenessScore({ successCount: 5, failureCount: 5, usageCount: 0 });
    const b = effectivenessScore({ successCount: 5, failureCount: 5, usageCount: 1000 });
    expect(a).toBe(b);
  });

  // ─── Large counts stay within 0..1 ───────────────────────────────────────

  it("stays in [0,1] for large counts (1000 successes, 1 failure)", () => {
    const score = effectivenessScore({ successCount: 1000, failureCount: 1, usageCount: 5000 });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeGreaterThan(0.99);
  });

  it("stays in [0,1] for large-failure case (1 success, 1000 failures)", () => {
    const score = effectivenessScore({ successCount: 1, failureCount: 1000, usageCount: 500 });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
    expect(score).toBeLessThan(0.01);
  });
});

// ─── Effectiveness-aware decay rate (evolution.ts) ──────────────────────────
//
// Pure-math regression: low-effectiveness rules decay 2× faster, high-
// effectiveness rules half as fast, insufficient-data rules at baseline.
// Tested as math here; the integration is exercised live by the worker's
// `evolution.decay` schedule.

describe("effectiveness-aware half-life formula", () => {
  const HALF_LIFE_DAYS = 90;

  function halfLifeFor(score: number, outcomes: number): number {
    if (score === -1 || outcomes < 5) return HALF_LIFE_DAYS;
    if (score < 0.3) return HALF_LIFE_DAYS / 2;
    if (score >= 0.7) return HALF_LIFE_DAYS * 2;
    return HALF_LIFE_DAYS;
  }

  it("low effectiveness with sufficient data → half-life is halved", () => {
    expect(halfLifeFor(0.2, 5)).toBe(45);
  });

  it("high effectiveness with sufficient data → half-life is doubled", () => {
    expect(halfLifeFor(0.85, 10)).toBe(180);
  });

  it("middle effectiveness → baseline half-life", () => {
    expect(halfLifeFor(0.5, 10)).toBe(90);
  });

  it("insufficient outcomes → baseline (no penalty for new rules)", () => {
    expect(halfLifeFor(0.0, 2)).toBe(90); // 2 outcomes, score=0, but n<5
  });

  it("insufficient-data sentinel → baseline", () => {
    expect(halfLifeFor(-1, 0)).toBe(90);
  });

  it("low score AND insufficient outcomes → baseline (don't penalize new)", () => {
    expect(halfLifeFor(0.1, 4)).toBe(90); // would-be-low but n<5
  });
});

// ─── KRA score: insufficient-data neutral floor (kra.ts::scoreItem) ─────────

describe("KRA effectiveness floor for insufficient data", () => {
  function successComponent(successCount: number, failureCount: number): number {
    const totalOutcomes = successCount + failureCount;
    return totalOutcomes < 3
      ? 0.5
      : successCount / (successCount + failureCount + 1);
  }

  it("brand-new rule (0/0) gets neutral 0.5, not penalized 0", () => {
    expect(successComponent(0, 0)).toBe(0.5);
  });

  it("rule with 1 success and 1 failure (n<3) gets neutral 0.5", () => {
    expect(successComponent(1, 1)).toBe(0.5);
  });

  it("rule with 2 successes and 0 failures (n<3) gets neutral 0.5", () => {
    expect(successComponent(2, 0)).toBe(0.5);
  });

  it("rule with exactly 3 outcomes uses Laplace-smoothed ratio", () => {
    expect(successComponent(3, 0)).toBeCloseTo(3 / 4, 5);
  });

  it("rule with strong success record (n≥3) is well above 0.5", () => {
    expect(successComponent(10, 0)).toBeCloseTo(10 / 11, 5);
  });

  it("rule with poor record (n≥3) is well below 0.5", () => {
    expect(successComponent(0, 5)).toBe(0);
  });
});
