import { describe, expect, it } from "vitest";
import { formatBytes } from "./solution.js";

describe("formatBytes", () => {
  it("formats zero and unit boundaries in base 1024", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
  });

  it("throws a RangeError for negative input instead of returning a garbage string", () => {
    expect(() => formatBytes(-1)).toThrow(RangeError);
  });
});
