import { describe, expect, it } from "vitest";
import { detectFormat, detectTarget, renderManifest, type RulesBundle } from "../exporter.js";

describe("exporter / detectTarget", () => {
  it("pulls the filename out of a target:* tag", () => {
    expect(detectTarget(["autoskill", "rules-export", "target:.claude/rules/react.md"])).toBe(
      ".claude/rules/react.md",
    );
  });
  it("falls back to AGENTS.md when no target tag is present", () => {
    expect(detectTarget(["autoskill", "rules-export"])).toBe("AGENTS.md");
  });
});

describe("exporter / detectFormat", () => {
  it.each([
    [".claude/rules/foo.md", "claude"],
    [".cursor/rules/bar.md", "cursor"],
    [".cursorrules", "cursor"],
    [".windsurfrules", "windsurf"],
    ["AGENTS.md", "agents"],
    ["docs/guide.md", "markdown"],
  ])("maps %s → %s", (path, expected) => {
    expect(detectFormat(path)).toBe(expected);
  });
});

describe("exporter / renderManifest", () => {
  it("concatenates files with FILE: headers", () => {
    const bundle: RulesBundle = {
      generatedAt: "2026-04-21T00:00:00Z",
      userId: "u1",
      files: [
        { path: "AGENTS.md", format: "agents", sourceIds: ["a"], content: "hello" },
        { path: ".claude/rules/react.md", format: "claude", sourceIds: ["b", "c"], content: "world" },
      ],
    };
    const out = renderManifest(bundle);
    expect(out).toContain("FILE: AGENTS.md (agents, 1 rule)");
    expect(out).toContain("FILE: .claude/rules/react.md (claude, 2 rules)");
    expect(out).toContain("hello");
    expect(out).toContain("world");
  });
});
