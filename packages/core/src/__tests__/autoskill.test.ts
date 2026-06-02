/**
 * Pure-function unit tests for autoskill.
 *
 * These tests do NOT touch the database or the embedding API. They cover the
 * scoring, tier mapping, quality filter, signal detection, and the
 * append-to-autoskill-block helper.
 *
 * Integration tests (DB + embeddings) live under __tests__/integration and
 * run in a separate suite.
 */
import { describe, expect, it } from "vitest";
import {
  scoreSignal,
  tierForScore,
  passesQualityFilter,
  detectSignals,
  appendToAutoskillBlock,
  type Signal,
} from "../autoskill.js";

const NOW = new Date("2026-04-21T12:00:00Z");

function makeSignal(partial: Partial<Signal>): Signal {
  return {
    kind: "correction_single",
    snippet: "test snippet that is long enough to pass length check",
    occurrences: 1,
    lastSeenAt: NOW,
    evidence: [],
    ...partial,
  };
}

// ============================================================
// scoreSignal
// ============================================================

describe("scoreSignal", () => {
  it("explicit correction = 5 points", () => {
    expect(scoreSignal(makeSignal({ kind: "correction_explicit" }))).toBe(5);
  });

  it("explicit correction with ≥3 occurrences gets +2 repetition bonus = 7", () => {
    expect(
      scoreSignal(
        makeSignal({ kind: "correction_explicit", occurrences: 3 }),
      ),
    ).toBe(7);
  });

  it("explicit correction with 5 occurrences still 7 (no extra after 3)", () => {
    expect(
      scoreSignal(
        makeSignal({ kind: "correction_explicit", occurrences: 5 }),
      ),
    ).toBe(7);
  });

  it("repeated correction = 3 points", () => {
    expect(scoreSignal(makeSignal({ kind: "correction_repeated" }))).toBe(3);
  });

  it("single correction = 2 points", () => {
    expect(scoreSignal(makeSignal({ kind: "correction_single" }))).toBe(2);
  });

  it("approval = 1 point", () => {
    expect(scoreSignal(makeSignal({ kind: "approval" }))).toBe(1);
  });
});

// ============================================================
// tierForScore
// ============================================================

describe("tierForScore", () => {
  it.each([
    [10, "high"],
    [8, "high"],
    [7, "high"],
  ])("score %i → high", (score, expected) => {
    expect(tierForScore(score)).toBe(expected);
  });

  it.each([
    [6, "medium"],
    [4, "medium"],
    [3, "medium"],
    [2, "medium"],
    [0, "medium"],
  ])("score %i → medium (LOW is filtered upstream)", (score, expected) => {
    expect(tierForScore(score)).toBe(expected);
  });

  it("boundary: 7 is HIGH, 6 is MEDIUM", () => {
    expect(tierForScore(7)).toBe("high");
    expect(tierForScore(6)).toBe("medium");
  });
});

// ============================================================
// passesQualityFilter
// ============================================================

describe("passesQualityFilter", () => {
  const scored = (overrides: Partial<Signal> & { score?: number }) => ({
    ...makeSignal(overrides),
    score: overrides.score ?? 5,
  });

  it("rejects snippets shorter than 15 chars", () => {
    expect(passesQualityFilter(scored({ snippet: "too short" }))).toBe(false);
  });

  it("rejects short snippets containing generic phrases", () => {
    expect(
      passesQualityFilter(
        scored({ snippet: "follow best practices please" }),
      ),
    ).toBe(false);
  });

  it("accepts long detailed snippet that mentions a generic phrase", () => {
    // Long-form rules are allowed even if they happen to use words like
    // "best practice" — the filter only kicks in for short, vague rules.
    const longDetailed =
      "Always use react-hook-form with zod for form validation, instead of " +
      "wiring useState/onChange manually — this is our project's best practice.";
    expect(passesQualityFilter(scored({ snippet: longDetailed }))).toBe(true);
  });

  it("rejects local-scope snippets without future-tense", () => {
    expect(
      passesQualityFilter(
        scored({ snippet: "Use Tailwind here, this case only" }),
      ),
    ).toBe(false);
  });

  it("accepts local-scope snippets that also assert future-tense", () => {
    expect(
      passesQualityFilter(
        scored({
          snippet: "Here we always use Tailwind, never CSS modules",
        }),
      ),
    ).toBe(true);
  });

  it("rejects single corrections without future-tense language", () => {
    expect(
      passesQualityFilter(
        scored({
          kind: "correction_single",
          snippet: "Use the Button component from shadcn for this dialog",
        }),
      ),
    ).toBe(false);
  });

  it("accepts single corrections that include future-tense", () => {
    expect(
      passesQualityFilter(
        scored({
          kind: "correction_single",
          snippet: "We always use the Button component from shadcn",
        }),
      ),
    ).toBe(true);
  });

  it("rejects approvals scoring below 4", () => {
    expect(
      passesQualityFilter(
        scored({
          kind: "approval",
          score: 1,
          snippet: "perfect, exactly what I wanted, keep it",
        }),
      ),
    ).toBe(false);
  });

  it("accepts approvals scoring ≥4 (cross-session bumped)", () => {
    expect(
      passesQualityFilter(
        scored({
          kind: "approval",
          score: 4,
          snippet: "perfect, exactly what I wanted, keep it",
        }),
      ),
    ).toBe(true);
  });
});

// ============================================================
// detectSignals
// ============================================================

describe("detectSignals", () => {
  it("returns empty array on no events", () => {
    expect(detectSignals([])).toEqual([]);
  });

  it("classifies always/never correction as explicit", () => {
    const out = detectSignals([
      {
        eventType: "user_correction",
        payload: { reason: "Always use 2-space indentation" },
        timestamp: NOW,
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("correction_explicit");
    expect(out[0]!.occurrences).toBe(1);
  });

  it("groups duplicate corrections and bumps occurrences", () => {
    const out = detectSignals([
      {
        eventType: "user_correction",
        payload: { reason: "Use cn() not clsx" },
        timestamp: NOW,
      },
      {
        eventType: "file_rejected",
        payload: { reason: "use cn() not clsx" },
        timestamp: NOW,
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.occurrences).toBe(2);
    expect(out[0]!.kind).toBe("correction_repeated");
  });

  it("ignores events with no extractable text", () => {
    const out = detectSignals([
      {
        eventType: "user_correction",
        payload: { foo: "bar" },
        timestamp: NOW,
      },
    ]);
    expect(out).toEqual([]);
  });

  it("treats user_clarification events as approval signals", () => {
    const out = detectSignals([
      {
        eventType: "user_clarification",
        payload: { text: "yes that's right, perfect" },
        timestamp: NOW,
      },
    ]);
    expect(out.some((s) => s.kind === "approval")).toBe(true);
  });
});

// ============================================================
// appendToAutoskillBlock
// ============================================================

describe("appendToAutoskillBlock", () => {
  it("bootstraps a new block at end of file", () => {
    const out = appendToAutoskillBlock(
      "# My Skill\n\nbody text\n",
      "style",
      "Use 2-space indentation",
    );
    expect(out).toContain("<!-- autoskill:begin -->");
    expect(out).toContain("<!-- autoskill:end -->");
    expect(out).toContain("## style");
    expect(out).toContain("- Use 2-space indentation");
  });

  it("appends a new bullet under existing section", () => {
    const seed = `# Skill

<!-- autoskill:begin -->
## style
- Use 2-space indentation
<!-- autoskill:end -->
`;
    const out = appendToAutoskillBlock(seed, "style", "Use single quotes");
    expect(out).toContain("- Use 2-space indentation");
    expect(out).toContain("- Use single quotes");
    // Only one section header
    expect(out.match(/## style/g)).toHaveLength(1);
  });

  it("creates a new section when section header missing", () => {
    const seed = `# Skill

<!-- autoskill:begin -->
## style
- Use 2-space indentation
<!-- autoskill:end -->
`;
    const out = appendToAutoskillBlock(seed, "testing", "Co-locate tests");
    expect(out).toContain("## style");
    expect(out).toContain("## testing");
    expect(out).toContain("- Co-locate tests");
  });

  it("is idempotent — appending the same bullet twice is a no-op", () => {
    const seed = `# Skill

<!-- autoskill:begin -->
## style
- Use 2-space indentation
<!-- autoskill:end -->
`;
    const once = appendToAutoskillBlock(seed, "style", "Use 2-space indentation");
    const twice = appendToAutoskillBlock(once, "style", "Use 2-space indentation");
    expect(once).toBe(seed);
    expect(twice).toBe(seed);
  });

  it("preserves content outside the block", () => {
    const seed = `# Skill

User edits before the block.

<!-- autoskill:begin -->
## style
- A
<!-- autoskill:end -->

User edits after the block.
`;
    const out = appendToAutoskillBlock(seed, "style", "B");
    expect(out).toContain("User edits before the block.");
    expect(out).toContain("User edits after the block.");
    expect(out).toContain("- A");
    expect(out).toContain("- B");
  });
});
