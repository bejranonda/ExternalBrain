import { describe, expect, it } from "vitest";
import { formatRelative } from "../format-relative.js";

const NOW = Date.parse("2026-05-24T12:00:00Z");

describe("formatRelative", () => {
  it("returns 'just now' for <60s ago", () => {
    expect(formatRelative("2026-05-24T11:59:30Z", NOW)).toBe("just now");
  });
  it("returns Nm ago for <60min", () => {
    expect(formatRelative("2026-05-24T11:48:00Z", NOW)).toBe("12m ago");
  });
  it("returns Nh ago for <24h", () => {
    expect(formatRelative("2026-05-24T09:00:00Z", NOW)).toBe("3h ago");
  });
  it("returns Nd ago for <30d", () => {
    expect(formatRelative("2026-05-22T12:00:00Z", NOW)).toBe("2d ago");
  });
  it("returns 'MMM D' date for ≥30d", () => {
    const out = formatRelative("2026-04-12T12:00:00Z", NOW);
    expect(out).toMatch(/^Apr\s+12$/);
  });
  it("returns the input string unchanged when unparseable", () => {
    expect(formatRelative("not-a-date", NOW)).toBe("not-a-date");
  });
});
