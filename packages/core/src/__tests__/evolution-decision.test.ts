import { describe, it, expect } from "vitest";
import { isDecayExempt } from "../evolution.js";
import { DECISION_TAG } from "../learnings.js";

describe("decay exemption for decisions", () => {
  it("exempts decision-tagged rows", () => {
    expect(isDecayExempt([DECISION_TAG])).toBe(true);
    expect(isDecayExempt(["close_capture", DECISION_TAG])).toBe(true);
  });
  it("does not exempt ordinary rows", () => {
    expect(isDecayExempt([])).toBe(false);
    expect(isDecayExempt(["close_capture"])).toBe(false);
  });
});
