import { describe, expect, it } from "vitest";
import { resolveDocLink } from "./resolve-doc-link";

describe("resolveDocLink", () => {
  it("rewrites a same-folder tutorial link to its in-app route", () => {
    expect(resolveDocLink("./01-getting-started.md")).toEqual({
      href: "/docs/tutorials/01-getting-started",
      external: false,
    });
  });

  it("preserves a heading anchor on a same-folder link", () => {
    expect(resolveDocLink("./06-troubleshooting.md#cant-sign-in")).toEqual({
      href: "/docs/tutorials/06-troubleshooting#cant-sign-in",
      external: false,
    });
  });

  it("collapses a language-suffixed source link to the one slug route", () => {
    expect(resolveDocLink("./00-quick-start.th.md")).toEqual({
      href: "/docs/tutorials/00-quick-start",
      external: false,
    });
    expect(resolveDocLink("./00-quick-start.de.md")).toEqual({
      href: "/docs/tutorials/00-quick-start",
      external: false,
    });
  });

  it("sends a parent-folder doc (no in-app route) to GitHub instead of 404ing", () => {
    expect(resolveDocLink("../USING_BRAIN.md")).toEqual({
      href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/USING_BRAIN.md",
      external: true,
    });
  });

  it("preserves a heading anchor on a parent-folder GitHub link", () => {
    expect(resolveDocLink("../HOW_IT_WORKS.md#step-3--bob-wires-claude-code-to-the-brain")).toEqual({
      href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/HOW_IT_WORKS.md#step-3--bob-wires-claude-code-to-the-brain",
      external: true,
    });
  });

  it("passes an absolute http(s) link through unchanged, marked external", () => {
    expect(resolveDocLink("https://example.com/x")).toEqual({
      href: "https://example.com/x",
      external: true,
    });
  });

  it("treats an uppercase scheme as external", () => {
    expect(resolveDocLink("HTTPS://example.com/x")).toEqual({
      href: "HTTPS://example.com/x",
      external: true,
    });
  });

  it("treats a protocol-relative URL as external", () => {
    expect(resolveDocLink("//example.com/x")).toEqual({
      href: "//example.com/x",
      external: true,
    });
  });

  it("does not treat a merely http-prefixed word as external", () => {
    expect(resolveDocLink("http-not-a-url")).toEqual({
      href: "http-not-a-url",
      external: false,
    });
  });

  it("passes an in-app absolute path through unchanged, not external", () => {
    expect(resolveDocLink("/settings/tokens")).toEqual({
      href: "/settings/tokens",
      external: false,
    });
  });
});
