import { describe, expect, it } from "vitest";
import { I18N } from "./i18n-dict";

/**
 * Every key in every locale, both directions, plus matching `{{vars}}`.
 *
 * The `_localeCompleteness` type lock in i18n-dict.ts catches a key missing
 * from th/de, but not one that exists ONLY in th/de (a typo'd or stale key is
 * dead weight the type check accepts), and not a translation that drops or
 * renames a placeholder — `translate()` would then render the sentence with
 * the number silently missing.
 */

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.set(path, v);
    else flatten(v, path, out);
  }
  return out;
}

const vars = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

const en = flatten(I18N.en as unknown as Tree);

describe("locale parity", () => {
  it("has a non-trivial English dictionary (guard against a vacuous sweep)", () => {
    expect(en.size).toBeGreaterThan(400);
  });

  for (const loc of ["th", "de"] as const) {
    const other = flatten(I18N[loc] as unknown as Tree);

    it(`${loc} has every English key`, () => {
      expect([...en.keys()].filter((k) => !other.has(k))).toEqual([]);
    });

    it(`${loc} has no key English lacks`, () => {
      expect([...other.keys()].filter((k) => !en.has(k))).toEqual([]);
    });

    it(`${loc} keeps every {{placeholder}} of the English string`, () => {
      // `{{plural}}` is English grammar ("session{{plural}}"); Thai has no
      // plural suffix and German words it differently, so only it may go.
      const drift = [...en.entries()]
        .filter(([k, v]) => {
          if (!other.has(k)) return false;
          const want = vars(v).filter((n) => n !== "plural");
          const got = vars(other.get(k)!);
          return want.some((n) => !got.includes(n)) || got.some((n) => !vars(v).includes(n));
        })
        .map(([k]) => k);
      expect(drift).toEqual([]);
    });
  }
});
