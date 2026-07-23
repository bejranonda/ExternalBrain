import { describe, expect, it } from "vitest";
import { safeJsonParse } from "./solution.js";

describe("safeJsonParse", () => {
  it("parses a valid JSON string", () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 });
  });

  it("returns the fallback for a malformed JSON string", () => {
    expect(safeJsonParse("{not json", "fallback")).toBe("fallback");
  });

  it("returns the fallback for non-string input, without coercing it into JSON", () => {
    // JSON.parse(42) would silently coerce to "42" and "succeed" with 42.
    // A safe parser must treat non-string input as an automatic fallback.
    expect(safeJsonParse(42, "fallback")).toBe("fallback");
    expect(safeJsonParse(null, "fallback")).toBe("fallback");
    expect(safeJsonParse(undefined, "fallback")).toBe("fallback");
  });
});
