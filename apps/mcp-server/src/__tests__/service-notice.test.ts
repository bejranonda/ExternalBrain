/**
 * The sunset notice on MCP responses (docs/SUNSET.md). An MCP-only user never
 * sees the web banner; this field is how their agent learns the instance is
 * closing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentServiceNotice, withServiceNotice } from "../service-notice.js";

afterEach(() => {
  delete process.env.SERVICE_SUNSET_AT;
  delete process.env.SERVICE_SUNSET_KIND;
  delete process.env.BRAIN_PUBLIC_HOSTNAME;
});

describe("currentServiceNotice", () => {
  it("is absent unless a sunset is configured", () => {
    expect(currentServiceNotice()).toBeNull();
  });
  it("names the date, the data page and how to disconnect", () => {
    process.env.SERVICE_SUNSET_AT = "2026-12-14T12:00:00Z";
    process.env.SERVICE_SUNSET_KIND = "trial";
    process.env.BRAIN_PUBLIC_HOSTNAME = "brain.example.test";
    const n = currentServiceNotice(new Date("2026-11-20T00:00:00Z"))!;
    expect(n).toContain("trial at brain.example.test ends on Mon, 14 Dec 2026, 12:00 UTC");
    expect(n).toContain("https://brain.example.test/settings/data");
    expect(n).toContain("claude mcp remove brain");
  });
  it("a malformed date yields no notice rather than an error on every call", () => {
    process.env.SERVICE_SUNSET_AT = "mid-December";
    expect(currentServiceNotice()).toBeNull();
  });
});

describe("withServiceNotice", () => {
  it("leaves results alone when there is no notice", () => {
    const r = { ok: true };
    expect(withServiceNotice(r, null)).toBe(r);
  });
  it("puts the notice first, so it is the first thing an agent reads", () => {
    const out = withServiceNotice({ sessionId: "s1", relevantKnowledge: [] }, "closing") as Record<string, unknown>;
    expect(Object.keys(out)[0]).toBe("serviceNotice");
    expect(out).toMatchObject({ serviceNotice: "closing", sessionId: "s1" });
    expect(withServiceNotice([1, 2], "closing")).toEqual({ serviceNotice: "closing", result: [1, 2] });
  });
  it("every tool result and error path in the dispatcher goes through it", () => {
    const src = readFileSync(join(__dirname, "..", "index.ts"), "utf8");
    expect(src).toContain("withServiceNotice(result, currentServiceNotice())");
    expect(src).toMatch(/notice \? `IMPORTANT — \$\{notice\}/);
    expect(src).toMatch(/serviceNotice: \$\{errNotice\}/);
  });
});
