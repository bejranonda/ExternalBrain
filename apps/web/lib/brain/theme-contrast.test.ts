import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Status inks must stay readable as TEXT on every light surface.
 *
 * The light theme overrode the background and ink ramps but never the status
 * colours, so the dark theme's pastels (#F5C451 warn, #F58B7D bad, …) became
 * text on near-white at 1.4–2.3:1 — every sign-in error banner, warning chip
 * and status line failed WCAG AA, on production, unnoticed (KNOWN_ISSUES §0ay).
 * This reads the tokens from globals.css and checks the ratio itself, so a
 * future palette tweak cannot quietly reintroduce it.
 */
const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `no ${selector} block in globals.css`).toBeGreaterThan(-1);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]!] = m[2]!;
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
};

describe("light-theme status tokens meet WCAG AA as text", () => {
  const light = block('[data-theme="light"]');
  const surfaces = ["--bg", "--bg-elev-1", "--bg-elev-2"] as const;
  const inks = ["--ok", "--warn", "--bad", "--cool", "--violet"] as const;

  it("the light theme defines every status ink (not inherited from dark)", () => {
    expect(inks.filter((t) => !light[t])).toEqual([]);
  });

  it.each(inks)("%s ≥ 4.5:1 on every light surface", (ink) => {
    for (const s of surfaces) {
      expect(contrast(light[ink]!, light[s]!), `${ink} ${light[ink]} on ${s} ${light[s]}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
