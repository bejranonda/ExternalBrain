import { test, expect } from "@playwright/test";

// No auth cookie needed — the sign-in page should render for anyone.
test("sign-in page renders", async ({ page }) => {
  const response = await page.goto("/signin");
  expect(response?.ok()).toBeTruthy();
  // Be lenient about exact copy — page may say "Sign in", "Sign In", or similar.
  await expect(page.locator("body")).toContainText(/sign\s*in/i);
});
