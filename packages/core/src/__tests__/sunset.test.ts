/**
 * Service sunset (docs/SUNSET.md): the one setting every surface reads, and
 * the email it sends. Pure — no database.
 */
import { describe, expect, it } from "vitest";
import {
  parseServiceSunset,
  serviceSunset,
  sunsetEmailStage,
  sunsetMcpNotice,
  sunsetPhase,
} from "../sunset.js";
import { serviceSunsetEmail } from "../email-templates.js";

const AT = "2026-12-14T12:00:00Z";
const at = new Date(AT);
const DAY = 24 * 60 * 60 * 1000;
const before = (ms: number) => new Date(at.getTime() - ms);

describe("parseServiceSunset", () => {
  it("is off when unset or blank", () => {
    expect(parseServiceSunset({})).toEqual({ ok: true, sunset: null });
    expect(parseServiceSunset({ SERVICE_SUNSET_AT: "  " })).toEqual({ ok: true, sunset: null });
  });
  it("defaults deletion to 30 days after and the kind to closure", () => {
    const s = serviceSunset({ SERVICE_SUNSET_AT: AT })!;
    expect(s.at.toISOString()).toBe("2026-12-14T12:00:00.000Z");
    expect(s.deleteAt.toISOString()).toBe("2027-01-13T12:00:00.000Z");
    expect(s.kind).toBe("closure");
  });
  it("reads an explicit deletion date and the trial kind", () => {
    const s = serviceSunset({ SERVICE_SUNSET_AT: AT, SERVICE_SUNSET_DELETE_AT: "2027-02-01T00:00:00Z", SERVICE_SUNSET_KIND: "Trial" })!;
    expect(s.deleteAt.toISOString()).toBe("2027-02-01T00:00:00.000Z");
    expect(s.kind).toBe("trial");
  });
  it("reports a malformed setting instead of silently ignoring or throwing", () => {
    expect(parseServiceSunset({ SERVICE_SUNSET_AT: "14.12.2026" }).ok).toBe(false);
    expect(parseServiceSunset({ SERVICE_SUNSET_AT: AT, SERVICE_SUNSET_DELETE_AT: "soon" }).ok).toBe(false);
    expect(parseServiceSunset({ SERVICE_SUNSET_AT: AT, SERVICE_SUNSET_DELETE_AT: "2026-12-01T00:00:00Z" }))
      .toEqual({ ok: false, error: "SERVICE_SUNSET_DELETE_AT is before SERVICE_SUNSET_AT" });
    expect(serviceSunset({ SERVICE_SUNSET_AT: "not a date" })).toBeNull();
    expect(parseServiceSunset({ SERVICE_SUNSET_AT: AT, SERVICE_SUNSET_KIND: "trail" }).ok).toBe(false);
  });
});

describe("sunsetEmailStage", () => {
  const s = serviceSunset({ SERVICE_SUNSET_AT: AT })!;
  it.each([
    [before(30 * DAY), "announce"],
    [before(7 * DAY + 1), "announce"],
    [before(7 * DAY), "week"],
    [before(2 * DAY), "week"],
    [before(DAY), "final"],
    [before(60_000), "final"],
    [at, null],
    [new Date(at.getTime() + DAY), null],
  ] as const)("at %s → %s", (now, stage) => {
    expect(sunsetEmailStage(s, now)).toBe(stage);
  });
  it("phase flips exactly at the sunset instant", () => {
    expect(sunsetPhase(s, before(1))).toBe("notice");
    expect(sunsetPhase(s, at)).toBe("closed");
  });
});

describe("sunsetMcpNotice", () => {
  const trial = serviceSunset({ SERVICE_SUNSET_AT: AT, SERVICE_SUNSET_KIND: "trial" })!;
  it("tells the agent what to pass on, once", () => {
    const n = sunsetMcpNotice(trial, { webUrl: "https://brain.example.test", now: before(DAY * 3) });
    expect(n).toContain("The hosted External Brain trial at brain.example.test ends on Mon, 14 Dec 2026, 12:00 UTC");
    expect(n).toContain("once");
    expect(n).toContain("https://brain.example.test/settings/data");
    expect(n).toContain("claude mcp remove brain");
    expect(n).toContain("docs/QUICKSTART.md");
    expect(n).toContain("13 January 2027");
  });
  it("switches tense once the instant has passed", () => {
    expect(sunsetMcpNotice(trial, { now: at })).toContain("ended on");
  });
});

describe("serviceSunsetEmail", () => {
  const base = {
    kind: "trial" as const,
    sunsetAt: AT,
    deleteAt: "2027-01-13T12:00:00Z",
    webUrl: "https://brain.example.test",
    guideUrl: "https://github.com/x/y/blob/main/docs/QUICKSTART.md",
  };
  it("subjects name the stage", () => {
    expect(serviceSunsetEmail({ ...base, stage: "announce" }).subject).toBe("Your External Brain trial ends on 14 December 2026");
    expect(serviceSunsetEmail({ ...base, stage: "week" }).subject).toBe("7 days left: your External Brain trial ends on 14 December 2026");
    expect(serviceSunsetEmail({ ...base, stage: "final" }).subject).toMatch(/^Tomorrow:/);
    expect(serviceSunsetEmail({ ...base, kind: "closure", stage: "announce" }).subject).toBe("External Brain closes on 14 December 2026");
  });
  it("carries English, Thai and German, each with the data link and local time", () => {
    const { html, text } = serviceSunsetEmail({ ...base, stage: "announce" });
    for (const lang of ["en", "th", "de"]) expect(html).toContain(`lang="${lang}"`);
    expect(html.match(/href="https:\/\/brain\.example\.test\/settings\/data"/g)).toHaveLength(3);
    expect(text).toContain("13:00 Berlin, 19:00 Bangkok");
    expect(text).toContain("19:00 น. (เวลาประเทศไทย)");
    expect(text).toContain("13:00 Uhr (MEZ)");
    expect(text).toContain("claude mcp remove brain");
    expect(text).toContain("13 January 2027");
    expect(text).toContain("13 มกราคม 2570");
    expect(text).toContain("13. Januar 2027");
  });
  it("adds a reminder line only to the later stages", () => {
    expect(serviceSunsetEmail({ ...base, stage: "announce" }).text).not.toContain("A reminder");
    expect(serviceSunsetEmail({ ...base, stage: "week" }).text).toContain("A reminder: 7 days left.");
    expect(serviceSunsetEmail({ ...base, stage: "final" }).text).toContain("the trial ends tomorrow");
  });
});
