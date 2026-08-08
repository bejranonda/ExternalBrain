import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { I18N, translate } from "./i18n-dict";

/**
 * A page that shows the language picker must actually translate.
 *
 * `/signin`, `/forgot-password`, `/reset-password` and `/accept-invite` all
 * rendered `<LocalePicker />` while every string on them was a hardcoded
 * English literal. Clicking EN/TH/DE moved the highlight, set the cookie and
 * updated `<html lang>` — and changed not one word of copy. Five of the six
 * surfaces carrying the picker were in that state; only `/welcome` worked,
 * because it is the one whose text lives in a client component.
 *
 * Proven at the artifact level before the fix: `/signin` returned an identical
 * 20883 bytes for `bp_lang=en`, `th` and `de`, differing only in the `<html
 * lang>` attribute.
 *
 * Per-page review cannot see this — each page looks fine in isolation, and the
 * picker is genuinely present. The gap is between "offers the control" and
 * "responds to it", so the check has to range over every page that offers it.
 */

const APP = join(__dirname, "..", "..", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/^(page|layout)\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Files that render the picker, with the source of whatever they render. */
function pickerPages(): { rel: string; src: string }[] {
  return walk(APP)
    .map((f) => ({ rel: relative(APP, f), src: readFileSync(f, "utf8") }))
    .filter(({ src }) => src.includes("<LocalePicker"));
}

/**
 * Resolve the components a page imports from our own component dir, so a page
 * that delegates its copy (like /welcome → WelcomeFlow) counts as translated.
 */
function translatesSomewhere(src: string): boolean {
  if (/\buseT\(\)/.test(src) || /getServerT\(\)/.test(src)) return true;
  // The docs surfaces translate through their own registry rather than the
  // key dictionary: `const lang = useLang()` then `getDoc(lang, …)` /
  // `getDocsChrome(lang)`. Requiring useT() specifically would have failed
  // them for using a different — and equally working — mechanism, which is
  // asserting the nearest signal instead of the property. What matters is
  // that the rendered copy varies with the language, so accept a resolved
  // `lang` being passed into something.
  if (/\buseLang\(\)/.test(src) && /\(\s*lang\s*[,)]/.test(src)) return true;
  const comps = [...src.matchAll(/from "@\/components\/brain\/([a-z0-9-]+)"/g)].map(
    (m) => m[1]!,
  );
  return comps.some((c) => {
    try {
      const s = readFileSync(join(__dirname, "..", "..", "components", "brain", `${c}.tsx`), "utf8");
      return /\buseT\(\)/.test(s);
    } catch {
      return false;
    }
  });
}

describe("locale coverage", () => {
  const pages = pickerPages();

  it("finds the picker surfaces (guard against a vacuous sweep)", () => {
    // A selector that silently matched nothing would pass every assertion
    // below while checking zero pages.
    expect(pages.length).toBeGreaterThanOrEqual(5);
  });

  for (const { rel, src } of pages) {
    it(`${rel} translates its copy`, () => {
      expect(
        translatesSomewhere(src),
        `${rel} renders <LocalePicker /> but never calls useT()/getServerT(), ` +
          `so switching language changes nothing on it`,
      ).toBe(true);
    });
  }
});

/**
 * Namespaces whose surfaces are reachable by someone who is NOT signed in,
 * with the minimum key count that proves the namespace wasn't gutted.
 *
 * These get the strictest sweep because an anonymous visitor cannot work
 * around a missing translation by switching to a page that has one — /signin
 * and /start are frequently the only two pages they will ever see.
 */
const UNAUTH_NAMESPACES: ReadonlyArray<{ ns: string; minKeys: number; probe: string }> = [
  { ns: "auth", minKeys: 30, probe: "auth.signIn" },
  { ns: "start", minKeys: 18, probe: "start.title" },
];

for (const { ns, minKeys, probe } of UNAUTH_NAMESPACES) {
  describe(`${ns} namespace`, () => {
    const locales = ["en", "th", "de"] as const;
    const enKeys = Object.keys(
      (I18N.en as unknown as Record<string, Record<string, string>>)[ns] ?? {},
    );

    it("exists and is non-trivial", () => {
      expect(enKeys.length).toBeGreaterThanOrEqual(minKeys);
    });

    for (const loc of locales) {
      it(`${loc} defines every ${ns} key`, () => {
        const dict = (I18N[loc] as unknown as Record<string, Record<string, string>>)[ns] ?? {};
        const missing = enKeys.filter((k) => !(k in dict));
        expect(missing).toEqual([]);
      });

      if (loc !== "en") {
        it(`${loc} is actually translated, not copied from English`, () => {
          // A locale that falls back to the English string for everything passes
          // a "key exists" check while delivering no translation at all.
          const dict = (I18N[loc] as unknown as Record<string, Record<string, string>>)[ns]!;
          const en = (I18N.en as unknown as Record<string, Record<string, string>>)[ns]!;
          const identical = enKeys.filter((k) => dict[k] === en[k]);
          // Proper nouns / short tokens may legitimately match; most must not.
          expect(identical.length).toBeLessThan(enKeys.length * 0.2);
        });
      }
    }

    it("resolves a real string per locale rather than echoing the key", () => {
      for (const loc of locales) {
        const v = translate(loc, probe);
        expect(v).not.toBe(probe);
        expect(v.trim().length).toBeGreaterThan(0);
      }
    });
  });
}
