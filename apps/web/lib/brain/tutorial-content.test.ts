import { describe, expect, it } from "vitest";
import { TUTORIALS } from "./tutorial-meta";
import { readTutorialMarkdown } from "./tutorial-content";

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
