/**
 * Unit tests for Oracle groundedness + retrievedCounts helpers,
 * and for mapCitations + citation meta enrichment.
 *
 * These are pure-function tests — no DB, no LLM, no embeddings.
 */
import { describe, expect, it } from "vitest";
import { groundednessFrom, retrievedCountsFrom, mapCitations, buildTaskBlock } from "../oracle.js";
import type { RetrievedKnowledge, RetrievedSession } from "../oracle.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKRows(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({ id: `k${i}` }));
}

function makeSRows(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({ id: `s${i}` }));
}

// ---------------------------------------------------------------------------
// groundednessFrom
// ---------------------------------------------------------------------------

describe("groundednessFrom", () => {
  it('returns "none" when both knowledge and sessions are empty', () => {
    expect(groundednessFrom([], [])).toBe("none");
  });

  it('returns "weak" for 1 knowledge row and no sessions', () => {
    expect(groundednessFrom(makeKRows(1), [])).toBe("weak");
  });

  it('returns "weak" for 2 knowledge rows and no sessions', () => {
    expect(groundednessFrom(makeKRows(2), [])).toBe("weak");
  });

  it('returns "weak" for 0 knowledge rows but sessions present', () => {
    expect(groundednessFrom([], makeSRows(3))).toBe("weak");
  });

  it('returns "moderate" for 3 knowledge rows and no sessions', () => {
    expect(groundednessFrom(makeKRows(3), [])).toBe("moderate");
  });

  it('returns "moderate" for 5 knowledge rows and no sessions', () => {
    expect(groundednessFrom(makeKRows(5), [])).toBe("moderate");
  });

  it('returns "moderate" for 1 knowledge row and sessions (mix)', () => {
    expect(groundednessFrom(makeKRows(1), makeSRows(2))).toBe("moderate");
  });

  it('returns "moderate" for 2 knowledge rows and sessions (mix)', () => {
    expect(groundednessFrom(makeKRows(2), makeSRows(5))).toBe("moderate");
  });

  it('returns "strong" for exactly 6 knowledge rows', () => {
    expect(groundednessFrom(makeKRows(6), [])).toBe("strong");
  });

  it('returns "strong" for 12 knowledge rows (upper limit)', () => {
    expect(groundednessFrom(makeKRows(12), [])).toBe("strong");
  });

  it('returns "strong" for 6 knowledge rows with sessions', () => {
    expect(groundednessFrom(makeKRows(6), makeSRows(10))).toBe("strong");
  });

  it("knowledge count is the primary driver — 10 knowledge overrides 0 sessions", () => {
    expect(groundednessFrom(makeKRows(10), [])).toBe("strong");
  });
});

// ---------------------------------------------------------------------------
// retrievedCountsFrom
// ---------------------------------------------------------------------------

describe("retrievedCountsFrom", () => {
  it("returns { knowledge: 0, sessions: 0 } for empty inputs", () => {
    expect(retrievedCountsFrom([], [])).toEqual({ knowledge: 0, sessions: 0 });
  });

  it("counts knowledge rows correctly", () => {
    expect(retrievedCountsFrom(makeKRows(5), [])).toEqual({
      knowledge: 5,
      sessions: 0,
    });
  });

  it("counts session rows correctly", () => {
    expect(retrievedCountsFrom([], makeSRows(3))).toEqual({
      knowledge: 0,
      sessions: 3,
    });
  });

  it("sums knowledge and sessions independently", () => {
    expect(retrievedCountsFrom(makeKRows(7), makeSRows(4))).toEqual({
      knowledge: 7,
      sessions: 4,
    });
  });

  it("returns exact counts even at the boundary values", () => {
    expect(retrievedCountsFrom(makeKRows(1), makeSRows(1))).toEqual({
      knowledge: 1,
      sessions: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// groundednessFrom × retrievedCountsFrom — combined property tests
// ---------------------------------------------------------------------------

describe("groundedness and counts are consistent", () => {
  it("none groundedness always has zero counts", () => {
    const counts = retrievedCountsFrom([], []);
    const g = groundednessFrom([], []);
    expect(g).toBe("none");
    expect(counts.knowledge + counts.sessions).toBe(0);
  });

  it("strong groundedness always has knowledge >= 6", () => {
    const k = makeKRows(8);
    const counts = retrievedCountsFrom(k, []);
    const g = groundednessFrom(k, []);
    expect(g).toBe("strong");
    expect(counts.knowledge).toBeGreaterThanOrEqual(6);
  });

  it("moderate groundedness with knowledge 3-5 is consistent", () => {
    for (let n = 3; n <= 5; n++) {
      const k = makeKRows(n);
      const counts = retrievedCountsFrom(k, []);
      const g = groundednessFrom(k, []);
      expect(g).toBe("moderate");
      expect(counts.knowledge).toBe(n);
    }
  });
});

// ---------------------------------------------------------------------------
// mapCitations — citation meta enrichment
// ---------------------------------------------------------------------------

/** Minimal RetrievedKnowledge factory */
function makeKRow(overrides: Partial<RetrievedKnowledge> = {}): RetrievedKnowledge {
  return {
    id: "k-test-id",
    type: "recipe",
    triggerText: "When building a React form",
    ruleText: "Use react-hook-form + zod",
    rationale: null,
    confidence: 0.9,
    successCount: 8,
    failureCount: 2,
    usageCount: 15,
    lastUsedAt: new Date("2026-04-22T10:00:00Z"),
    tags: [],
    _similarity: 0.85,
    ...overrides,
  };
}

/** Minimal RetrievedSession factory */
function makeSRow(overrides: Partial<RetrievedSession> = {}): RetrievedSession {
  return {
    id: "s-test-id",
    clientType: "claude_code",
    startedAt: new Date("2026-04-23T08:00:00Z"),
    endedAt: new Date("2026-04-23T09:00:00Z"),
    outcome: "success",
    sqs: 85,
    metadata: { prompt: "Build a login form" },
    project: { name: "thaisim2026" },
    ...overrides,
  };
}

describe("mapCitations — knowledge meta", () => {
  it("populates meta for a knowledge citation matched by marker", () => {
    const answer = "Use react-hook-form [^K1] for this.";
    const k = makeKRow();
    const citations = mapCitations(answer, [k], []);
    expect(citations).toHaveLength(1);
    const c = citations[0]!;
    expect(c.knowledgeId).toBe("k-test-id");
    expect(c.meta).toBeDefined();
    expect(c.meta!.knowledgeType).toBe("recipe");
    expect(c.meta!.triggerText).toBe("When building a React form");
    expect(c.meta!.usageCount).toBe(15);
    expect(c.meta!.lastUsedAt).toBe("2026-04-22T10:00:00.000Z");
  });

  it("computes effectiveness correctly from successCount/failureCount", () => {
    const answer = "See [^K1].";
    const k = makeKRow({ successCount: 8, failureCount: 2 });
    const citations = mapCitations(answer, [k], []);
    const eff = citations[0]!.meta!.effectiveness!;
    expect(eff).toBeCloseTo(0.8, 5); // 8/(8+2) = 0.8
  });

  it("returns effectiveness=-1 sentinel when fewer than 3 outcomes", () => {
    const answer = "See [^K1].";
    const k = makeKRow({ successCount: 1, failureCount: 0, usageCount: 3 });
    const citations = mapCitations(answer, [k], []);
    expect(citations[0]!.meta!.effectiveness).toBe(-1);
  });

  it("computes outcomes = successCount + failureCount", () => {
    const answer = "[^K1] is the rule.";
    const k = makeKRow({ successCount: 5, failureCount: 3 });
    const citations = mapCitations(answer, [k], []);
    expect(citations[0]!.meta!.outcomes).toBe(8);
  });

  it("flags isDecision when the knowledge row carries the decision tag", () => {
    const answer = "We use Postgres [^K1].";
    const decided = mapCitations(answer, [makeKRow({ tags: ["decision"] })], []);
    expect(decided[0]!.meta!.isDecision).toBe(true);
    const plain = mapCitations(answer, [makeKRow({ tags: [] })], []);
    expect(plain[0]!.meta!.isDecision).toBeUndefined();
  });

  it("sets lastUsedAt to undefined when lastUsedAt is null", () => {
    const answer = "[^K1].";
    const k = makeKRow({ lastUsedAt: null });
    const citations = mapCitations(answer, [k], []);
    expect(citations[0]!.meta!.lastUsedAt).toBeUndefined();
  });

  it("preserves the knowledge type through the meta shape", () => {
    const answer = "[^K1].";
    const k = makeKRow({ type: "anti_principle" });
    const citations = mapCitations(answer, [k], []);
    expect(citations[0]!.meta!.knowledgeType).toBe("anti_principle");
  });

  it("meta is undefined when knowledge index is out of range", () => {
    // Marker K2 but only one knowledge row (index 0)
    const answer = "[^K2] cites a deleted row.";
    const k = makeKRow();
    const citations = mapCitations(answer, [k], []);
    expect(citations).toHaveLength(0);
  });

  it("does not duplicate citations when the same marker appears twice", () => {
    const answer = "[^K1] and again [^K1].";
    const citations = mapCitations(answer, [makeKRow()], []);
    expect(citations).toHaveLength(1);
  });
});

describe("mapCitations — session meta", () => {
  it("populates session meta for a session citation", () => {
    const answer = "Session [^S1] shows this.";
    const s = makeSRow();
    const citations = mapCitations(answer, [], [s]);
    expect(citations).toHaveLength(1);
    const c = citations[0]!;
    expect(c.sessionId).toBe("s-test-id");
    expect(c.meta).toBeDefined();
    expect(c.meta!.projectName).toBe("thaisim2026");
    expect(c.meta!.sessionStartedAt).toBe("2026-04-23T08:00:00.000Z");
    expect(c.meta!.sessionOutcome).toBe("success");
    expect(c.meta!.clientType).toBe("claude_code");
  });

  it('maps outcome "partial" to "failure"', () => {
    const answer = "[^S1].";
    const s = makeSRow({ outcome: "partial" });
    const citations = mapCitations(answer, [], [s]);
    expect(citations[0]!.meta!.sessionOutcome).toBe("failure");
  });

  it('maps outcome "failed" to "failure"', () => {
    const answer = "[^S1].";
    const s = makeSRow({ outcome: "failed" });
    const citations = mapCitations(answer, [], [s]);
    expect(citations[0]!.meta!.sessionOutcome).toBe("failure");
  });

  it('maps outcome null to "unknown"', () => {
    const answer = "[^S1].";
    const s = makeSRow({ outcome: null });
    const citations = mapCitations(answer, [], [s]);
    expect(citations[0]!.meta!.sessionOutcome).toBe("unknown");
  });

  it("sets projectName to undefined when project is null", () => {
    const answer = "[^S1].";
    const s = makeSRow({ project: null });
    const citations = mapCitations(answer, [], [s]);
    expect(citations[0]!.meta!.projectName).toBeUndefined();
  });

  it("session meta is absent when index is out of range", () => {
    const answer = "[^S3] cites missing session.";
    const citations = mapCitations(answer, [], [makeSRow()]);
    expect(citations).toHaveLength(0);
  });
});

describe("mapCitations — mixed knowledge and session", () => {
  it("handles mixed K and S markers in one answer", () => {
    const answer = "Rule [^K1] from session [^S1].";
    const citations = mapCitations(answer, [makeKRow()], [makeSRow()]);
    expect(citations).toHaveLength(2);
    const byId = new Map(citations.map((c) => [c.knowledgeId ?? c.sessionId, c]));
    expect(byId.get("k-test-id")!.meta!.knowledgeType).toBe("recipe");
    expect(byId.get("s-test-id")!.meta!.sessionOutcome).toBe("success");
  });
});

// ---------------------------------------------------------------------------
// buildTaskBlock — V2.0 OPEN TASKS rendering (spec 2026-07-07 §4c)
// ---------------------------------------------------------------------------

describe("buildTaskBlock", () => {
  const NOW = Date.parse("2026-07-07T12:00:00Z");
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000);

  it("renders blocker marker, kind, assignee, and staleness", () => {
    const block = buildTaskBlock(
      [
        {
          ruleText: "unblock the staging database",
          tags: ["action-item", "blocker", "for:dev@test.local"],
          createdAt: daysAgo(1),
        },
        {
          ruleText: "who owns the auth migration?",
          tags: ["open-question", "for:pm@test.local"],
          createdAt: daysAgo(20),
        },
        {
          ruleText: "update the runbook",
          tags: ["action-item"],
          createdAt: daysAgo(2),
        },
      ],
      NOW,
    );
    const lines = block.split("\n");
    expect(lines[0]).toBe(
      "- [BLOCKER] (task) unblock the staging database — assignee: dev@test.local",
    );
    expect(lines[1]).toBe(
      "- (open question) who owns the auth migration? — assignee: pm@test.local [stale >14d]",
    );
    expect(lines[2]).toBe(
      "- (task) update the runbook — assignee: unassigned",
    );
  });

  it("returns empty string for no tasks", () => {
    expect(buildTaskBlock([], NOW)).toBe("");
  });

  it("14 days exactly is not stale; beyond is", () => {
    const on = buildTaskBlock(
      [{ ruleText: "x", tags: [], createdAt: daysAgo(14) }],
      NOW,
    );
    expect(on).not.toContain("[stale >14d]");
    const past = buildTaskBlock(
      [{ ruleText: "x", tags: [], createdAt: daysAgo(15) }],
      NOW,
    );
    expect(past).toContain("[stale >14d]");
  });
});
