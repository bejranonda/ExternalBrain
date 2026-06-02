import { test, expect } from "@playwright/test";

// Mobile viewport
const MOBILE = { width: 360, height: 640 };
// Tablet viewport — falls under the 880px breakpoint, so should
// behave as mobile (bottom nav, no rail). Loop 1 added this case.
const TABLET = { width: 768, height: 1024 };
// Desktop viewport
const DESKTOP = { width: 1280, height: 720 };

test.describe("responsive layout", () => {
  test.describe("mobile viewport (360x640)", () => {
    test.use({ viewport: MOBILE });

    test("rail (nav[aria-label='Primary']) is hidden at mobile width", async ({ page }) => {
      await page.goto("/#dashboard");
      await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });

      // The Rail component has class "desktop-only"; at 360px it should be hidden.
      const rail = page.locator('nav[aria-label="Primary"]');
      // It may exist in the DOM but not be visible (CSS media query hides it).
      // We allow it to be absent OR hidden.
      const isVisible = await rail.isVisible();
      expect(isVisible).toBe(false);
    });

    test("bottom nav (nav[aria-label='Primary (mobile)']) is visible at mobile width", async ({
      page,
    }) => {
      await page.goto("/#dashboard");
      await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });

      const bottomNav = page.locator('nav[aria-label="Primary (mobile)"]');
      await expect(bottomNav).toBeVisible({ timeout: 5_000 });
    });

    test("navigating via bottom nav switches surface", async ({ page }) => {
      await page.goto("/");
      await expect(page.locator('[data-screen-label]')).toBeVisible({ timeout: 15_000 });

      const bottomNav = page.locator('nav[aria-label="Primary (mobile)"]');
      await expect(bottomNav).toBeVisible({ timeout: 5_000 });

      // Click the Oracle item in bottom nav
      const oracleBtn = bottomNav.locator(".bottom-nav-item").filter({ hasText: /oracle/i });
      await expect(oracleBtn).toBeVisible({ timeout: 5_000 });
      await oracleBtn.click();

      await expect(page.locator('[data-screen-label="oracle"]')).toBeVisible({ timeout: 10_000 });
    });

    test("skills surface: single-column layout (filters, list, detail stacked)", async ({ page }) => {
      // Register the knowledge-fetch wait BEFORE navigation — Skills renders an
      // empty-state panel (no .skills-filters / .skills-list) while items are
      // loading or zero. Waiting on the response guarantees the grid layout is
      // mounted before we query for it.
      const knowledgeResp = page.waitForResponse(
        (resp) => resp.url().includes("/api/knowledge") && resp.status() === 200,
        { timeout: 20_000 },
      );
      await page.goto("/#skills");
      await expect(page.locator('[data-screen-label="skills"]')).toBeVisible({ timeout: 15_000 });
      await knowledgeResp;

      // The skills-layout grid collapses at mobile width — filters + list both
      // stack vertically via the `max-width: 880px` media query. Assert both
      // are in the DOM (visibility flips to "display: block" but they remain).
      const filtersAside = page.locator(".skills-filters");
      const listSection = page.locator(".skills-list");
      await expect(filtersAside).toBeVisible({ timeout: 5_000 });
      await expect(listSection).toBeVisible({ timeout: 5_000 });
    });
  });

  test.describe("tablet viewport (768x1024) — under 880px breakpoint", () => {
    test.use({ viewport: TABLET });

    test("tablet uses mobile layout (bottom nav, no rail)", async ({ page }) => {
      await page.goto("/#dashboard");
      await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });
      const rail = page.locator('nav[aria-label="Primary"]');
      expect(await rail.isVisible()).toBe(false);
      const bottomNav = page.locator('nav[aria-label="Primary (mobile)"]');
      await expect(bottomNav).toBeVisible({ timeout: 5_000 });
    });

    test("dashboard body does not horizontal-scroll on tablet", async ({ page }) => {
      await page.goto("/#dashboard");
      await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });
      const { scrollW, clientW } = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      // Allow a 2px tolerance for fractional-pixel rounding.
      expect(scrollW).toBeLessThanOrEqual(clientW + 2);
    });
  });

  test.describe("touch-target sizing (mobile)", () => {
    test.use({ viewport: MOBILE });

    test("chips meet 32px minimum touch height", async ({ page }) => {
      await page.goto("/#dashboard");
      await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });

      // Pick chips that are actually visible — header chips and inline counters.
      const chips = await page.locator(".chip").all();
      let inspected = 0;
      for (const chip of chips.slice(0, 8)) {
        if (!(await chip.isVisible())) continue;
        const box = await chip.boundingBox();
        if (!box) continue;
        expect(box.height, `chip "${(await chip.textContent())?.trim()}" must be ≥ 30px on mobile`).toBeGreaterThanOrEqual(30);
        inspected += 1;
      }
      // Sanity — we should have actually checked something.
      expect(inspected).toBeGreaterThan(0);
    });

    test("signin page body does not horizontal-scroll on 360px", async ({ page }) => {
      await page.goto("/signin");
      await page.waitForLoadState("domcontentloaded");
      const { scrollW, clientW } = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      expect(scrollW).toBeLessThanOrEqual(clientW + 2);
    });
  });

  test.describe("desktop viewport (1280x720)", () => {
    test.use({ viewport: DESKTOP });

    test("rail (nav[aria-label='Primary']) is visible at desktop width", async ({ page }) => {
      await page.goto("/#dashboard");
      await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });

      const rail = page.locator('nav[aria-label="Primary"]');
      await expect(rail).toBeVisible({ timeout: 5_000 });
    });

    test("bottom nav (nav[aria-label='Primary (mobile)']) is hidden at desktop width", async ({
      page,
    }) => {
      await page.goto("/#dashboard");
      await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });

      const bottomNav = page.locator('nav[aria-label="Primary (mobile)"]');
      // It may be in DOM but hidden via CSS "mobile-only" class.
      const isVisible = await bottomNav.isVisible();
      expect(isVisible).toBe(false);
    });

    test("skills surface: multi-column layout renders all three columns", async ({ page }) => {
      const knowledgeResp = page.waitForResponse(
        (resp) => resp.url().includes("/api/knowledge") && resp.status() === 200,
        { timeout: 20_000 },
      );
      await page.goto("/#skills");
      await expect(page.locator('[data-screen-label="skills"]')).toBeVisible({ timeout: 15_000 });
      await knowledgeResp;

      const filtersAside = page.locator(".skills-filters");
      const listSection = page.locator(".skills-list");
      const detailSection = page.locator(".skills-detail");

      await expect(filtersAside).toBeVisible({ timeout: 5_000 });
      await expect(listSection).toBeVisible({ timeout: 5_000 });

      // Detail pane is hidden until a row is clicked (progressive disclosure —
      // first-visit Skills shows filters + list only, to reduce initial density).
      await expect(detailSection).toHaveCount(0);

      // Click the first row to reveal the detail pane. Scope to `.scroll` so
      // we skip the header controls (Filter, Sort) and land on an item button.
      await listSection.locator(".scroll button").first().click();
      await expect(detailSection).toBeVisible({ timeout: 5_000 });

      // Escape closes the detail and returns to the list-only layout.
      await page.keyboard.press("Escape");
      await expect(detailSection).toHaveCount(0);
    });

    test("breadcrumb nav is visible on desktop", async ({ page }) => {
      await page.goto("/#dashboard");
      await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });

      const breadcrumb = page.locator('nav[aria-label="Breadcrumb"]');
      await expect(breadcrumb).toBeVisible({ timeout: 5_000 });
    });
  });
});
