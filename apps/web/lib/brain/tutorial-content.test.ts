import { describe, expect, it } from "vitest";
import { TUTORIALS } from "./tutorial-meta";
import { readTutorialMarkdown, withResolvedHost } from "./tutorial-content";

/**
 * `pnpm turbo run build` passing proves the generated file exists and is
 * syntactically valid TS — it does NOT prove every tutorial actually has
 * content, or that the EN-fallback for untranslated tutorials works. A
 * generator that silently wrote an empty object would still pass typecheck
 * and build; this is the test that would catch that (§0r: existing ≠ correct).
 */
describe("generated tutorial content is complete", () => {
  it("covers a non-trivial number of tutorials (guard against a vacuous generator)", () => {
    expect(TUTORIALS.length).toBeGreaterThanOrEqual(8);
  });

  for (const t of TUTORIALS) {
    it(`${t.slug} resolves real English content`, () => {
      const result = readTutorialMarkdown("en", t.slug);
      expect(result, `${t.slug} should have baked EN content`).not.toBeNull();
      expect(result!.content.length).toBeGreaterThan(200);
      expect(result!.isTranslated).toBe(true);
    });
  }

  it("00-quick-start has real TH and DE translations, not an EN fallback", () => {
    const th = readTutorialMarkdown("th", "00-quick-start");
    const de = readTutorialMarkdown("de", "00-quick-start");
    expect(th?.isTranslated).toBe(true);
    expect(de?.isTranslated).toBe(true);
    // Genuinely different text, not the same EN string returned twice.
    const en = readTutorialMarkdown("en", "00-quick-start");
    expect(th!.content).not.toBe(en!.content);
    expect(de!.content).not.toBe(en!.content);
  });

  it("degrades untranslated tutorials to English rather than 404ing", () => {
    // 01-07 have no .th.md/.de.md source files (only 00 does) — this is the
    // fallback path, not an error path.
    const th = readTutorialMarkdown("th", "01-getting-started");
    expect(th).not.toBeNull();
    expect(th!.isTranslated).toBe(false);
    expect(th!.content).toBe(readTutorialMarkdown("en", "01-getting-started")!.content);
  });

  it("returns null for an unknown slug rather than throwing", () => {
    expect(readTutorialMarkdown("en", "not-a-real-tutorial")).toBeNull();
  });
});

describe("<your-brain> host substitution", () => {
  it("replaces every occurrence with the resolved host, protocol stripped", () => {
    const content = "Open https://<your-brain>/start and fetch https://<your-brain>/api/x.";
    expect(withResolvedHost(content, "https://brain.autobahn.bot")).toBe(
      "Open https://brain.autobahn.bot/start and fetch https://brain.autobahn.bot/api/x.",
    );
  });

  it("leaves the placeholder untouched when no host is configured", () => {
    // Local dev / an instance with no BRAIN_PUBLIC_HOSTNAME set. A visible
    // placeholder is more honest than silently substituting "undefined".
    expect(withResolvedHost("<your-brain>", undefined)).toBe("<your-brain>");
  });

  it("is a no-op on content with no placeholder", () => {
    expect(withResolvedHost("no placeholder here", "https://brain.autobahn.bot")).toBe(
      "no placeholder here",
    );
  });
});

describe("tutorial categorisation (2026-08-09 /docs reorg)", () => {
  it("has at least one get-started and one guide tutorial (guard against a vacuous grid)", () => {
    // A category typo that left a grid empty would still typecheck and
    // build — this is the check that would catch it.
    expect(TUTORIALS.filter((t) => t.category === "get-started").length).toBeGreaterThan(0);
    expect(TUTORIALS.filter((t) => t.category === "guide").length).toBeGreaterThan(0);
  });

  it("keeps reference material (04, 06, 07) out of both browsable grids", () => {
    // These three are real pages at their same URLs, cross-linked from
    // concept cards (04, 07) or the "Need help?" footer (06) instead of
    // being peer-listed next to "Quick start" — see tutorial-meta.ts's
    // TutorialMeta.category doc comment for the full reasoning.
    const reference = ["04-managing-tokens", "06-troubleshooting", "07-skill-types-explained"];
    for (const slug of reference) {
      const t = TUTORIALS.find((x) => x.slug === slug);
      expect(t?.category, slug).toBe("reference");
    }
  });

  it("keeps the two onboarding walkthroughs as get-started", () => {
    for (const slug of ["00-quick-start", "01-getting-started"]) {
      const t = TUTORIALS.find((x) => x.slug === slug);
      expect(t?.category, slug).toBe("get-started");
    }
  });
});
