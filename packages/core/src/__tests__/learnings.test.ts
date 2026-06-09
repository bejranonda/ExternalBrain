import { describe, expect, it } from "vitest";
import { validateSubmittedLearnings } from "../learnings.js";

const good = {
  trigger: "when scaffolding a React form in this repo",
  rule: "use react-hook-form + zod, not Formik",
  rationale: "Formik abandoned; team standard",
  type: "reflex",
  source: "user_correction",
  confidence: 0.9,
};

describe("validateSubmittedLearnings", () => {
  it("accepts a valid learning unchanged (confidence kept)", () => {
    const { valid, droppedInvalid, droppedOverflow } = validateSubmittedLearnings([good]);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.confidence).toBe(0.9);
    expect(droppedInvalid).toBe(0);
    expect(droppedOverflow).toBe(0);
  });

  it("drops invalid items without throwing, counts them", () => {
    const { valid, droppedInvalid } = validateSubmittedLearnings([
      good,
      { trigger: 42, rule: "x" }, // wrong types
      { ...good, type: "not_a_type" }, // bad enum
      "garbage", // not even an object
    ]);
    expect(valid).toHaveLength(1);
    expect(droppedInvalid).toBe(3);
  });

  it("caps at 5 items, counts overflow", () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ ...good, rule: `${good.rule} v${i}` }));
    const { valid, droppedOverflow } = validateSubmittedLearnings(eight);
    expect(valid).toHaveLength(5);
    expect(droppedOverflow).toBe(3);
  });

  it("clamps confidence to [0, 0.95] and defaults missing confidence to 0.7", () => {
    const { valid } = validateSubmittedLearnings([
      { ...good, confidence: 1.0 },
      { ...good, confidence: undefined },
    ]);
    expect(valid[0]!.confidence).toBe(0.95);
    expect(valid[1]!.confidence).toBe(0.7);
  });
});
