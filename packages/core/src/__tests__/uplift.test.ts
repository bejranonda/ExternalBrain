/**
 * Unit tests for Generation Uplift v2 pure helpers.
 *
 * No LLM calls, no DB, no network. All judge interactions are mocked at the
 * function-input boundary — we test the prompt-builder output and the
 * parser's ability to handle valid, markdown-wrapped, and malformed JSON.
 *
 * Coverage:
 *   - judgePromptBuilder: correct structure, anonymisation, citation stripping
 *   - parseJudgeResponse: valid JSON, markdown fence, malformed, out-of-range
 *   - stripCitationMarkers: various marker formats
 *   - summarize: mean, median, win-rate, per-category, out-of-domain
 */
import { describe, expect, it } from "vitest";
import {
  judgePromptBuilder,
  parseJudgeResponse,
  stripCitationMarkers,
  summarize,
  type ScoredResult,
} from "../uplift.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<ScoredResult> = {}): ScoredResult {
  return {
    id: "q-test-001",
    category: "react",
    question: "How do I scaffold a form?",
    expectsBrainContent: true,
    withBrainScore: 2,
    withoutBrainScore: 1,
    rationale: "Assistant A cited project rules; B was generic.",
    aWasBrain: true,
    ...overrides,
  };
}

function makeSummarizeOpts() {
  return {
    timestamp: "2026-04-25T12:00:00.000Z",
    judgeModel: "claude-opus-4-7",
    oracleModel: "glm-5.1",
    inDomainCount: 32,
    partialCount: 10,
    outOfDomainCount: 10,
  };
}

// ---------------------------------------------------------------------------
// stripCitationMarkers
// ---------------------------------------------------------------------------

describe("stripCitationMarkers", () => {
  it("removes [^K1] markers", () => {
    expect(stripCitationMarkers("Use react-hook-form [^K1] and zod.")).toBe(
      "Use react-hook-form  and zod.",
    );
  });

  it("removes [^S1] session markers", () => {
    expect(stripCitationMarkers("See your session [^S3].")).toBe("See your session .");
  });

  it("removes double-digit markers", () => {
    expect(stripCitationMarkers("Source [^K12] and [^S10].")).toBe("Source  and .");
  });

  it("handles text with no markers unchanged", () => {
    expect(stripCitationMarkers("No markers here.")).toBe("No markers here.");
  });

  it("removes multiple markers in the same string", () => {
    const input = "Rule [^K1] applies [^K2] and session [^S1] confirms it.";
    const out = stripCitationMarkers(input);
    expect(out).not.toContain("[^K");
    expect(out).not.toContain("[^S");
  });
});

// ---------------------------------------------------------------------------
// judgePromptBuilder
// ---------------------------------------------------------------------------

describe("judgePromptBuilder", () => {
  it("includes the question verbatim", () => {
    const prompt = judgePromptBuilder(
      "How do I verify a Stripe webhook?",
      "Answer A content",
      "Answer B content",
    );
    expect(prompt).toContain("How do I verify a Stripe webhook?");
  });

  it("includes both answers", () => {
    const prompt = judgePromptBuilder("Q?", "Answer A content", "Answer B content");
    expect(prompt).toContain("Answer A content");
    expect(prompt).toContain("Answer B content");
  });

  it("strips citation markers from answer A before building prompt", () => {
    const prompt = judgePromptBuilder(
      "Q?",
      "Use react-hook-form [^K1] always.",
      "Generic answer",
    );
    expect(prompt).not.toContain("[^K1]");
    expect(prompt).toContain("Use react-hook-form");
  });

  it("strips citation markers from answer B before building prompt", () => {
    const prompt = judgePromptBuilder(
      "Q?",
      "Generic answer",
      "Use zod [^K2] for validation [^S1].",
    );
    expect(prompt).not.toContain("[^K2]");
    expect(prompt).not.toContain("[^S1]");
    expect(prompt).toContain("Use zod");
  });

  it("contains the 0-3 scoring rubric", () => {
    const prompt = judgePromptBuilder("Q?", "A", "B");
    expect(prompt).toContain("0-3");
    expect(prompt).toContain("grounded");
  });

  it("instructs the judge to output STRICT JSON", () => {
    const prompt = judgePromptBuilder("Q?", "A", "B");
    expect(prompt).toContain("STRICT JSON");
    expect(prompt).toContain("scoreA");
    expect(prompt).toContain("scoreB");
  });

  it("labels the two answers as Assistant A and Assistant B", () => {
    const prompt = judgePromptBuilder("Q?", "Answer A content", "Answer B content");
    expect(prompt).toContain("Assistant A:");
    expect(prompt).toContain("Assistant B:");
  });
});

// ---------------------------------------------------------------------------
// parseJudgeResponse
// ---------------------------------------------------------------------------

describe("parseJudgeResponse", () => {
  it("parses valid JSON with integer scores", () => {
    const result = parseJudgeResponse(
      '{"scoreA": 3, "scoreB": 1, "rationale": "A cited project rules."}',
    );
    expect(result).toEqual({ scoreA: 3, scoreB: 1, rationale: "A cited project rules." });
  });

  it("parses JSON wrapped in markdown code fences", () => {
    const raw = '```json\n{"scoreA":2,"scoreB":1,"rationale":"B was vague."}\n```';
    const result = parseJudgeResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.scoreA).toBe(2);
    expect(result!.scoreB).toBe(1);
  });

  it("parses JSON wrapped in plain code fences", () => {
    const raw = "```\n{\"scoreA\":2,\"scoreB\":0,\"rationale\":\"A was better.\"}\n```";
    const result = parseJudgeResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.scoreA).toBe(2);
  });

  it("returns null for malformed JSON", () => {
    expect(parseJudgeResponse("{scoreA: 2, scoreB: 1}")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseJudgeResponse("")).toBeNull();
  });

  it("returns null when scores are missing", () => {
    expect(parseJudgeResponse('{"rationale": "missing scores"}')).toBeNull();
  });

  it("clamps scores above 3 to 3", () => {
    const result = parseJudgeResponse(
      '{"scoreA": 5, "scoreB": 1, "rationale": "overflow"}',
    );
    expect(result!.scoreA).toBe(3);
  });

  it("clamps scores below 0 to 0", () => {
    const result = parseJudgeResponse(
      '{"scoreA": -1, "scoreB": 2, "rationale": "underflow"}',
    );
    expect(result!.scoreA).toBe(0);
  });

  it("rounds fractional scores", () => {
    const result = parseJudgeResponse(
      '{"scoreA": 2.7, "scoreB": 1.2, "rationale": "fractional"}',
    );
    expect(result!.scoreA).toBe(3);
    expect(result!.scoreB).toBe(1);
  });

  it("handles missing rationale gracefully", () => {
    const result = parseJudgeResponse('{"scoreA": 2, "scoreB": 1}');
    expect(result).not.toBeNull();
    expect(result!.rationale).toBe("");
  });
});

// ---------------------------------------------------------------------------
// summarize — basic stats
// ---------------------------------------------------------------------------

describe("summarize — mean and median", () => {
  it("computes correct mean for a simple set", () => {
    const results: ScoredResult[] = [
      makeResult({ withBrainScore: 3, withoutBrainScore: 1 }),
      makeResult({ id: "q-2", withBrainScore: 1, withoutBrainScore: 1 }),
    ];
    const s = summarize(results, makeSummarizeOpts());
    expect(s.meanWithBrain).toBeCloseTo(2.0);
    expect(s.meanWithoutBrain).toBeCloseTo(1.0);
  });

  it("computes correct median for odd-length array", () => {
    const results: ScoredResult[] = [
      makeResult({ withBrainScore: 1, withoutBrainScore: 0 }),
      makeResult({ id: "q-2", withBrainScore: 2, withoutBrainScore: 1 }),
      makeResult({ id: "q-3", withBrainScore: 3, withoutBrainScore: 2 }),
    ];
    const s = summarize(results, makeSummarizeOpts());
    expect(s.medianWithBrain).toBe(2);
    expect(s.medianWithoutBrain).toBe(1);
  });

  it("computes correct median for even-length array", () => {
    const results: ScoredResult[] = [
      makeResult({ withBrainScore: 1, withoutBrainScore: 0 }),
      makeResult({ id: "q-2", withBrainScore: 3, withoutBrainScore: 2 }),
    ];
    const s = summarize(results, makeSummarizeOpts());
    expect(s.medianWithBrain).toBe(2); // (1+3)/2
    expect(s.medianWithoutBrain).toBe(1); // (0+2)/2
  });
});

// ---------------------------------------------------------------------------
// summarize — win-rate
// ---------------------------------------------------------------------------

describe("summarize — win-rate", () => {
  it("computes correct win / loss / tie rates", () => {
    // 2 wins, 1 loss, 1 tie
    const results: ScoredResult[] = [
      makeResult({ withBrainScore: 3, withoutBrainScore: 1 }), // win
      makeResult({ id: "q-2", withBrainScore: 2, withoutBrainScore: 0 }), // win
      makeResult({ id: "q-3", withBrainScore: 1, withoutBrainScore: 2 }), // loss
      makeResult({ id: "q-4", withBrainScore: 1, withoutBrainScore: 1 }), // tie
    ];
    const s = summarize(results, makeSummarizeOpts());
    expect(s.winRateWithBrain).toBeCloseTo(0.5);
    expect(s.winRateWithoutBrain).toBeCloseTo(0.25);
    expect(s.tieRate).toBeCloseTo(0.25);
  });

  it("returns zero rates for empty results", () => {
    const s = summarize([], makeSummarizeOpts());
    expect(s.winRateWithBrain).toBe(0);
    expect(s.winRateWithoutBrain).toBe(0);
    expect(s.tieRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// summarize — per-category breakdown
// ---------------------------------------------------------------------------

describe("summarize — per-category", () => {
  it("groups in-domain results by category", () => {
    const results: ScoredResult[] = [
      makeResult({ category: "react", withBrainScore: 3, withoutBrainScore: 1, expectsBrainContent: true }),
      makeResult({ id: "q-2", category: "react", withBrainScore: 1, withoutBrainScore: 1, expectsBrainContent: true }),
      makeResult({ id: "q-3", category: "auth", withBrainScore: 2, withoutBrainScore: 0, expectsBrainContent: true }),
    ];
    const s = summarize(results, makeSummarizeOpts());
    expect(s.perCategory["react"]).toBeDefined();
    expect(s.perCategory["auth"]).toBeDefined();
    expect(s.perCategory["react"]!.n).toBe(2);
    expect(s.perCategory["auth"]!.n).toBe(1);
    expect(s.perCategory["react"]!.meanWithBrain).toBeCloseTo(2.0);
  });

  it("excludes out-of-domain results from per-category", () => {
    const results: ScoredResult[] = [
      makeResult({ category: "other", withBrainScore: 2, withoutBrainScore: 2, expectsBrainContent: false }),
    ];
    const s = summarize(results, makeSummarizeOpts());
    // out-of-domain results should not appear in perCategory
    expect(Object.keys(s.perCategory)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// summarize — out-of-domain sanity check
// ---------------------------------------------------------------------------

describe("summarize — out-of-domain", () => {
  it("computes out-of-domain stats separately", () => {
    const results: ScoredResult[] = [
      makeResult({ withBrainScore: 2, withoutBrainScore: 1, expectsBrainContent: true }),
      makeResult({ id: "q-ood", category: "other", withBrainScore: 1, withoutBrainScore: 1, expectsBrainContent: false }),
    ];
    const s = summarize(results, makeSummarizeOpts());
    expect(s.outOfDomainMeanWithBrain).toBeCloseTo(1.0);
    expect(s.outOfDomainMeanWithoutBrain).toBeCloseTo(1.0);
    expect(s.outOfDomainDelta).toBeCloseTo(0.0);
  });

  it("reports non-zero delta when Brain scores higher on out-of-domain (bias signal)", () => {
    const results: ScoredResult[] = [
      makeResult({ id: "q-ood-1", category: "other", withBrainScore: 3, withoutBrainScore: 1, expectsBrainContent: false }),
      makeResult({ id: "q-ood-2", category: "other", withBrainScore: 2, withoutBrainScore: 1, expectsBrainContent: false }),
    ];
    const s = summarize(results, makeSummarizeOpts());
    expect(s.outOfDomainDelta).toBeGreaterThan(0.3);
  });
});
