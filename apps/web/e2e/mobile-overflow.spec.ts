import { test, expect } from "@playwright/test";

/**
 * Mobile horizontal-overflow regression net (#60).
 *
 * The v1.4.x end-user review found the signed-in app scrolling sideways on
 * phones: the topbar's flex min-content (switcher + crumbs + search + icons)
 * reached 463px on a 375px viewport and dragged the whole page's scrollWidth
 * with it. The fix (hide crumbs on mobile + clamp .topbar) is CSS-only and
 * trivially regressable — this spec keeps the bug class dead by asserting
 * scrollWidth never exceeds the viewport on the key surfaces.
 */
test.use({ viewport: { width: 375, height: 812 } });

const SURFACES = [
  ["dashboard", "/#dashboard"],
  ["skills", "/#skills"],
  ["sessions", "/#sessions"],
] as const;

test.describe("mobile: no horizontal overflow", () => {
  for (const [name, path] of SURFACES) {
    test(`${name} fits a 375px viewport`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator(".bottom-nav")).toBeVisible({ timeout: 15_000 });
      // Let data panels render — overflow often comes from late content.
      await page.waitForTimeout(1_500);
      const m = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      // +2px tolerance for subpixel rounding across chromium versions.
      expect(m.scrollW, `scrollWidth ${m.scrollW} vs viewport ${m.clientW}`).toBeLessThanOrEqual(
        m.clientW + 2,
      );
    });
  }
});
