import { test, expect } from "@playwright/test";

test.describe("tweaks panel", () => {
  test.beforeEach(async ({ page }) => {
    // Start fresh so tweaks from prior tests don't bleed in.
    // Also set bp_onboarded so the Onboarding modal never blocks the Settings button —
    // the Onboarding shows when knowledgeCount === 0 (can happen transiently during API
    // fetch), and its scrim intercepts pointer events while visible.
    await page.addInitScript(() => {
      try {
        window.localStorage.removeItem("bp_tweaks");
        window.localStorage.setItem("bp_onboarded", "true");
      } catch {
        /* ignore */
      }
    });
    await page.goto("/#dashboard");
    await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });
  });

  async function openTweaks(page: import("@playwright/test").Page) {
    // The settings icon button in the topbar opens Tweaks.
    // aria-label is from i18n app.settings = "Settings"
    const settingsBtn = page.locator('button[aria-label="Settings"]').first();
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
    await settingsBtn.click();

    // Tweaks renders as role="dialog" with aria-label from i18n tweaks.title = "Tweaks"
    const tweaksPanel = page.locator('[role="dialog"][aria-label="Tweaks"]');
    await expect(tweaksPanel).toBeVisible({ timeout: 5_000 });
    return tweaksPanel;
  }

  test("open tweaks from topbar settings icon", async ({ page }) => {
    const tweaksPanel = await openTweaks(page);
    await expect(tweaksPanel).toBeVisible({ timeout: 5_000 });
  });

  test("switch theme from dark to light: data-theme attribute updates", async ({ page }) => {
    const tweaksPanel = await openTweaks(page);

    // Theme segment: "Dark" and "Light" buttons
    const lightBtn = tweaksPanel.locator(".tweak-seg button").filter({ hasText: /light/i });
    await expect(lightBtn).toBeVisible({ timeout: 5_000 });
    await lightBtn.click();

    // document.documentElement.dataset.theme should now be "light"
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(theme).toBe("light");
  });

  test("switch accent from lime to violet: --accent CSS variable updates", async ({ page }) => {
    const tweaksPanel = await openTweaks(page);

    // Accent swatches render as .tweak-swatch buttons with aria-label="Accent <key>"
    const violetSwatch = tweaksPanel.locator('button[aria-label="Accent violet"]');
    await expect(violetSwatch).toBeVisible({ timeout: 5_000 });
    await violetSwatch.click();

    // Read the --accent CSS variable from the document root
    const accent = await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    );
    // ACCENTS.violet.c = "#C5A8FF"
    expect(accent.toLowerCase()).toBe("#c5a8ff");
  });

  test("switch language to TH: rail labels change from EN", async ({ page }) => {
    // First record the current EN label for "Dashboard"
    const rail = page.locator('nav[aria-label="Primary"]');
    await expect(rail).toBeVisible({ timeout: 5_000 });
    const enLabel = await rail.locator(".rail-item").filter({ hasText: /dashboard/i }).first().textContent();

    const tweaksPanel = await openTweaks(page);

    // Click ไทย (TH) language button
    const thBtn = tweaksPanel.locator(".tweak-seg button").filter({ hasText: /ไทย/i });
    await expect(thBtn).toBeVisible({ timeout: 5_000 });
    await thBtn.click();

    // Allow React i18n context to propagate
    await page.waitForTimeout(500);

    // The rail should now show the TH label for dashboard: "แดชบอร์ด"
    const thLabel = await rail.locator(".rail-item").first().textContent();
    expect(thLabel).not.toBe(enLabel);

    // Restore to EN. After switching to TH the dialog aria-label becomes the TH
    // translation ("ปรับแต่ง"), so tweaksPanel no longer resolves. Find the EN
    // button directly — its label is hardcoded "EN" (not i18n-translated) and it
    // is the first button in the language .tweak-seg row.
    const enBtn = page.locator(".tweaks .tweak-seg button").first();
    await expect(enBtn).toBeVisible({ timeout: 5_000 });
    await enBtn.click();
  });

  test("close panel via Escape and verify bp_tweaks persists in localStorage", async ({ page }) => {
    const tweaksPanel = await openTweaks(page);

    // Make a change — switch to light theme
    const lightBtn = tweaksPanel.locator(".tweak-seg button").filter({ hasText: /light/i });
    await lightBtn.click();

    // Verify bp_tweaks is written to localStorage immediately on change.
    // The Tweaks component calls localStorage.setItem on every onChange, so the
    // value is present before the panel is even closed.
    const storedBeforeClose = await page.evaluate(() => window.localStorage.getItem("bp_tweaks"));
    expect(storedBeforeClose).toBeTruthy();

    const parsedBeforeClose = JSON.parse(storedBeforeClose!) as { theme?: string };
    expect(parsedBeforeClose.theme).toBe("light");

    // Press Escape to close — the write should have already happened (no "Save" step).
    await page.keyboard.press("Escape");
    await expect(tweaksPanel).not.toBeVisible({ timeout: 5_000 });

    // Verify the DOM reflects the persisted theme (applied via applyTweaks on change).
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    expect(theme).toBe("light");
  });
});
