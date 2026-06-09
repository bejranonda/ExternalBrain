import { test, expect } from "@playwright/test";

// Routes ordered by keyboard shortcut 1..6 — matches KEY_MAP in lib/brain/routes.ts.
// `label` is the VISIBLE rail text — it diverges from the hash where the
// vocabulary cleanup renamed a surface (autoskill → "Proposals"). Asserting
// the label keeps this spec honest against the locked glossary (#52).
const SURFACES = [
  { key: "1", hash: "dashboard", label: "Dashboard" },
  { key: "2", hash: "oracle", label: "Oracle" },
  { key: "3", hash: "skills", label: "Skills" },
  { key: "4", hash: "graph", label: "Graph" },
  { key: "5", hash: "autoskill", label: "Proposals" },
  { key: "6", hash: "sessions", label: "Sessions" },
] as const;

test.describe("navigation rail", () => {
  test("home page renders all 6 rail items", async ({ page }) => {
    await page.goto("/");
    // In dev-shim mode the app loads directly; in auth mode it redirects to /signin then back.
    // Either way we end up at / with the BrainApp mounted.
    const rail = page.locator("nav.rail");
    await expect(rail).toBeVisible();

    for (const s of SURFACES) {
      // Each surface has a rail-item button; check by its visible label.
      await expect(
        rail.locator(`button[class*="rail-item"]`).filter({ hasText: s.label }),
      ).toBeVisible({ timeout: 5_000 });
    }
  });

  test("number keys 1..6 update the URL hash", async ({ page }) => {
    await page.goto("/");
    // Wait for the app shell to hydrate.
    await expect(page.locator("nav.rail")).toBeVisible();

    // BrainApp attaches its global `keydown` listener inside useEffect. The
    // listener isn't live until React has committed the effect, which happens
    // after the shell paints. Retry the first press until the URL reflects it,
    // so we never race the hydration window.
    await expect(async () => {
      await page.keyboard.press(SURFACES[0]!.key);
      await expect(page).toHaveURL(new RegExp(`#${SURFACES[0]!.hash}$`));
    }).toPass({ timeout: 5_000 });

    for (const s of SURFACES.slice(1)) {
      await page.keyboard.press(s.key);
      await expect(page).toHaveURL(new RegExp(`#${s.hash}$`));
    }
  });

  test("/signin redirects to / in dev-shim mode", async ({ page }) => {
    const resp = await page.goto("/signin");
    // When auth is disabled the page redirects; when auth is enabled we get the sign-in UI.
    // We only assert the dev-shim path (no AUTH_* set → redirect to /).
    if (resp?.url().includes("/signin")) {
      // Auth is enabled in this environment — skip the assertion.
      test.skip();
    } else {
      expect(page.url()).toMatch(/\/$/);
    }
  });
});
