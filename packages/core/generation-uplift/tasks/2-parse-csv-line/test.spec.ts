import { describe, expect, it } from "vitest";
import { parseCsvLine } from "./solution.js";

describe("parseCsvLine", () => {
  it("splits plain unquoted fields on commas", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside quoted fields intact", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("unescapes a doubled double-quote inside a quoted field to one literal quote", () => {
    expect(parseCsvLine('a,"she said ""hi""",c')).toEqual([
      "a",
      'she said "hi"',
      "c",
    ]);
  });
});
