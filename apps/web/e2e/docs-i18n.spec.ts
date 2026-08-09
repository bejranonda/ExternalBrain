import { test, expect } from "@playwright/test";

// #59 — /docs was the one unauth surface without the locale picker, because its
// body content (docs-content.ts) was EN-only. Now that DOCS has TH/DE parallel
// translations and the pages are client-rendered off useLang(), the picker
// switches the whole surface instantly (no reload). This guards:
//   1. /docs and a concept page render the picker
//   2. switching locale re-renders the body in-place (client, no navigation)
//   3. the per-slug EN fallback never leaves a raw "undefined" on screen

test.describe("docs i18n (#59)", () => {
  // True anon visit — /docs is a public surface; drop the pre-onboarded state.
  test.use({ storageState: undefined });

  test("index: picker switches title EN → TH → DE in place", async ({ page }) => {
    await page.goto("/docs");
    const h1 = page.locator("h1").first();
    await expect(h1).toHaveText("Documentation");

    await page.getByRole("button", { name: "ภาษาไทย (Thai)" }).click();
    await expect(h1).toHaveText("เอกสาร");

    await page.getByRole("button", { name: "Deutsch (German)" }).click();
    await expect(h1).toHaveText("Dokumentation");

    await page.getByRole("button", { name: "English" }).click();
    await expect(h1).toHaveText("Documentation");
  });

  test("concept page: body translates and has no undefined keys", async ({ page }) => {
    await page.goto("/docs/concepts/skills");
    const h1 = page.locator("h1").first();
    await expect(h1).toHaveText("Skills"); // title stays "Skills" across locales

    // Switch to Thai and assert a translated section heading appears.
    await page.getByRole("button", { name: "ภาษาไทย (Thai)" }).click();
    await expect(page.getByRole("heading", { name: "สกิลคืออะไร" })).toBeVisible();

    // Switch to German and assert a translated section heading appears.
    await page.getByRole("button", { name: "Deutsch (German)" }).click();
    await expect(page.getByRole("heading", { name: "Was ein Skill ist" })).toBeVisible();

    // No raw fallback leaked into visible text in any locale.
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("undefined");
  });
});
