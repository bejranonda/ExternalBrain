/**
 * The SECOND door for agent-written knowledge text.
 *
 * v2.19.3 stopped `brain_teach_knowledge` storing leaked tool-call markup, but
 * that is only one of two ways agent-authored text becomes Knowledge. The
 * other is `brain_report_session_outcome.learnings`, which persists as
 * `learning_captured` events and is then promoted into `Knowledge` by KEA's
 * refine mode — so corrupted text arriving that way is served back to future
 * agents as fact in exactly the same way, and the first fix did not cover it.
 *
 * That is the repo's recurring one-rule-N-doors shape (GUIDELINES §4), caught
 * this time before it cost anything rather than after.
 *
 * Dropping rather than rejecting is deliberate here: `learnings.ts` owes the
 * caller a contract that a malformed learning never blocks the outcome
 * report, because an unclosed session teaches nothing at all.
 */
import { describe, it, expect } from "vitest";
import { validateSubmittedLearnings } from "../learnings.js";
import { hasLeakedMarkup, LEAKED_MARKUP } from "../text-guards.js";

function learning(over: Partial<Record<string, unknown>> = {}) {
  return {
    trigger: "when validating agent-submitted learnings at session close",
    rule: "drop items whose text carries leaked tool-call markup rather than persisting them",
    rationale: "corrupted text is promoted into Knowledge and served back as fact",
    type: "reflex",
    source: "discovery",
    ...over,
  };
}

describe("learnings markup guard", () => {
  it("keeps a clean learning", () => {
    const r = validateSubmittedLearnings([learning()]);
    expect(r.valid).toHaveLength(1);
    expect(r.droppedMarkup).toBe(0);
  });

  it("drops a learning whose rationale carries leaked markup", () => {
    // The exact shape observed on prod 2026-08-23.
    const r = validateSubmittedLearnings([
      learning({
        rationale: 'hid the crash for months.</rationale>\n<parameter name="tags">["x"]',
      }),
    ]);
    expect(r.valid).toHaveLength(0);
    expect(r.droppedMarkup).toBe(1);
  });

  it("checks trigger and rule too, not just rationale", () => {
    for (const field of ["trigger", "rule"] as const) {
      const bad = field === "trigger"
        ? { trigger: "when something happens</trigger><parameter name=\"x\">y" }
        : { rule: "do the thing every time it matters</rule><parameter name=\"x\">y" };
      const r = validateSubmittedLearnings([learning(bad)]);
      expect(r.droppedMarkup, field).toBe(1);
    }
  });

  it("counts markup drops SEPARATELY from shape-invalid drops", () => {
    // The remedies differ: an invalid item has the wrong shape; a markup item
    // is a mis-typed call whose later parameters were probably swallowed and
    // should be re-sent. Collapsing them would lose that distinction.
    const r = validateSubmittedLearnings([
      learning(),
      learning({ rationale: 'x</rationale>' }),
      { type: "reflex" }, // structurally invalid
    ]);
    expect(r.valid).toHaveLength(1);
    expect(r.droppedMarkup).toBe(1);
    expect(r.droppedInvalid).toBe(1);
  });

  it("never throws — a malformed learning must not block the outcome report", () => {
    // An unclosed session teaches nothing at all, which is strictly worse
    // than losing one learning.
    expect(() =>
      validateSubmittedLearnings([learning({ rationale: "</rationale>" }), null, 42]),
    ).not.toThrow();
  });

  it("does not fire on legitimate prose about code", () => {
    for (const ok of [
      "prefer Array<string> over any[]",
      "the <Skills/> component renders Knowledge rows",
      "use `a < b`, not a.lessThan(b)",
      "HTML comments <!-- like this --> bound autoskill blocks",
    ]) {
      expect(hasLeakedMarkup(ok), ok).toBe(false);
      expect(validateSubmittedLearnings([learning({ rationale: ok })]).valid, ok).toHaveLength(1);
    }
  });

  it("exposes ONE predicate for both doors", () => {
    // brain_teach_knowledge and this path must agree forever. Two copies of
    // the regex would drift the way every duplicated rule in this repo has.
    expect(LEAKED_MARKUP.test('a</rationale>')).toBe(true);
    expect(hasLeakedMarkup(undefined)).toBe(false);
    expect(hasLeakedMarkup(null)).toBe(false);
  });
});
