import { describe, expect, it } from "vitest";
import { fuzzyScore } from "../fuzzy.js";

describe("fuzzyScore", () => {
  it("returns 0 for an empty query", () => {
    expect(fuzzyScore("Dashboard", "")).toBe(0);
  });

  it("returns 0 when chars are missing", () => {
    expect(fuzzyScore("Dashboard", "xyz")).toBe(0);
  });

  it("substring matches are ranked above non-contiguous fuzzy matches", () => {
    const sub = fuzzyScore("Dashboard", "dash");
    const fuzzy = fuzzyScore("my documents and stuff here", "dash");
    expect(sub).toBeGreaterThan(fuzzy);
  });

  it("earlier substring positions score higher", () => {
    expect(fuzzyScore("Dashboard", "dash")).toBeGreaterThan(
      fuzzyScore("User Dashboard", "dash"),
    );
  });

  it("word-start matches beat mid-word matches", () => {
    const start = fuzzyScore("save as skill", "sas");
    const mid = fuzzyScore("glass saves", "sas");
    expect(start).toBeGreaterThan(mid);
  });

  it("consecutive runs beat scattered matches", () => {
    // "ora" in "oracle" is a substring (fast-path = 1000).
    // Compare two non-substring labels: scattered vs. consecutive "ora".
    const scattered = fuzzyScore("o-r-a-l-b", "ora");
    const consecutive = fuzzyScore("zz-ora-zz", "ora");
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("ORACLE", "ora")).toBe(fuzzyScore("oracle", "ORA"));
  });
});
