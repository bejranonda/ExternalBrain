/**
 * Visual regression baselines for the 6 routed surfaces × 2 viewports × 2 themes (#235).
 *
 * Generates 24 baseline PNGs that subsequent runs diff against. Catches the
 * regression classes the behavior-only specs miss:
 *   - Layout flips after a CSS refactor (margin collapse, flex direction)
 *   - Theme drift (token rename, dark/light divergence)
 *   - Mobile-only overflow / chip wrapping
 *   - Glassmorphism / shadow / gradient regressions (v0.12 overhaul)
 *   - ConnectionStatus / KnowledgeHealth chip color drift (#201)
 *   - Typography hierarchy drift
 *   - Empty-state styling (Phase 6 panels with no data)
 *
 * How to generate baselines (first time, or after an intentional UI change):
 *
 *   PWUPDATE=1 pnpm --filter @brain/web e2e -- visual.spec.ts \
 *     --update-snapshots
 *
 * The PWUPDATE env var unsuspends this spec; without it the suite is
 * skipped so visual specs don't fight with the behavior suite on every
 * `pnpm e2e` invocation. The `--update-snapshots` flag tells playwright
 * to write rather than diff.
 *
 * Pre-requisites for stable baselines:
 *   - Seeded DB (see #236 / `prisma db seed`) so each surface has
 *     deterministic content (16 knowledge rows, 6 sessions, 4 proposals)
 *   - `ALLOW_DEV_AUTH=true` so admin nav surfaces aren't 401-redirected
 *   - Web stack idle (no live KEA / autoskill jobs writing to the DB
 *     mid-snapshot, which is why we wait for `networkidle`)
 *
 * Volatile content (timestamps, generated ids, "X minutes ago" strings)
 * is masked via `data-volatile="timestamp"` / `data-volatile="id"`
 * attributes — adding them to a component is a one-line edit and is
 * tracked in a follow-up to this issue (see #235 Phase 2). Until those
 * attrs are added, expect minor diff noise on relative-time strings.
 *
 * CI integration (#234 / #235 Phase 3) uploads `playwright-report/` as
 * an artifact on failure so the reviewer can inspect the actual vs.
 * expected images side-by-side.
 */
import { test, expect } from "@playwright/test";

// Top-level skip unless PWUPDATE=1 OR the suite is invoked with --grep
// "visual baseline" explicitly. Keeps `pnpm e2e` from generating diffs
// for every dev run, which would flake on font-hinting changes between
// the dev's local machine and CI's container.
test.skip(
  !process.env["PWUPDATE"] && !process.env["RUN_VISUAL"],
  "Visual baselines skipped — set PWUPDATE=1 (to regenerate) or RUN_VISUAL=1 (to diff) to enable. See file header.",
);

const SURFACES = [
  "dashboard",
  "oracle",
  "skills",
  "graph",
  "autoskill",
  "sessions",
] as const;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const THEMES = ["dark", "light"] as const;

test.describe("visual baselines", () => {
  for (const surface of SURFACES) {
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        test(`${surface} · ${vp.name} · ${theme}`, async ({ page }) => {
          await page.setViewportSize({ width: vp.width, height: vp.height });

          // Set theme + suppress onboarding modal before navigation so the
          // first paint already reflects them (avoids a flash that would
          // pollute the snapshot).
          await page.addInitScript((t: string) => {
            window.localStorage.setItem("bp_theme", t);
            window.localStorage.setItem("bp_onboarded", "true");
          }, theme);

          await page.goto(`/#${surface}`);

          // Wait for the routed screen to mount. `data-screen-label` is the
          // contract attribute on the root `<div className="app">` in
          // `apps/web/components/brain/app.tsx`.
          await expect(
            page.locator(`[data-screen-label="${surface}"]`),
          ).toBeVisible({ timeout: 15_000 });

          // Settle network activity so async dashboard fetches complete
          // before the snapshot. networkidle is intentionally chosen over
          // `domcontentloaded` — many surfaces fetch counts / lists after
          // mount.
          await page.waitForLoadState("networkidle");

          await expect(page).toHaveScreenshot(
            `${surface}-${vp.name}-${theme}.png`,
            {
              fullPage: true,
              // Mask any element opted into the volatile contract. Until
              // Phase 2 adds these attrs broadly, mask is mostly a no-op
              // and the maxDiffPixelRatio tolerance below catches the rest.
              mask: [
                page.locator("[data-volatile='timestamp']"),
                page.locator("[data-volatile='id']"),
              ],
              // 1% tolerance absorbs font-hinting / antialiasing drift
              // between dev machine and CI. Tighten once we have real
              // baselines and a stable CI runner.
              maxDiffPixelRatio: 0.01,
            },
          );
        });
      }
    }
  }
});
