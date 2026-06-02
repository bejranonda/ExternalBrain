import { test as setup, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

/**
 * Playwright auth setup — signs in once and persists the session so the
 * authenticated specs (dashboard, skills, sessions, onboarding, …) can
 * actually render the app shell instead of bouncing to /signin.
 *
 * Why this exists: before it, every authenticated spec did `page.goto("/")`
 * with an empty cookie jar, got a 307 → /signin, and never reached the
 * shell. Endpoint route-mocking couldn't fix that — the redirect happens
 * server-side before any client fetch. The audit (2026-05-29) correctly
 * called the authenticated suite "theater" for this reason; the onboarding
 * specs were `.fixme`'d to no-ops because the modal could never mount.
 *
 * Credentials come from env so no secret is committed:
 *   E2E_ADMIN_USERNAME  (defaults to ADMIN_USERNAME if set)
 *   E2E_ADMIN_PASSWORD  (required — the plaintext admin password)
 *
 * Run:
 *   E2E_ADMIN_PASSWORD=… E2E_BASE_URL=https://brain-dev.example.com \
 *     pnpm exec playwright test
 *
 * The saved state lands in e2e/.auth/admin.json (gitignored) and is wired
 * as a dependency of the authenticated projects in playwright.config.ts.
 */

export const AUTH_FILE = path.join(__dirname, ".auth", "admin.json");

setup("authenticate as admin", async ({ page }) => {
  const username =
    process.env["E2E_ADMIN_USERNAME"] ?? process.env["ADMIN_USERNAME"] ?? "";
  const password = process.env["E2E_ADMIN_PASSWORD"] ?? "";

  if (!password) {
    throw new Error(
      "E2E_ADMIN_PASSWORD is not set. Authenticated specs cannot run without " +
        "it. Set E2E_ADMIN_PASSWORD (and optionally E2E_ADMIN_USERNAME) to the " +
        "admin credentials and re-run. See e2e/auth.setup.ts.",
    );
  }
  if (!username) {
    throw new Error(
      "E2E_ADMIN_USERNAME (or ADMIN_USERNAME) is not set. See e2e/auth.setup.ts.",
    );
  }

  await page.goto("/signin");

  // The credentials form posts via a server action; fill by stable
  // name attributes (input[name="username"|"password"]) and submit.
  await page.fill('input[name="username"]', username);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  // A successful sign-in redirects to "/". Wait for the app shell to render
  // (data-screen-label is set on the root of BrainApp) rather than a fixed
  // timeout, so this is robust to container cold-starts.
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), {
    timeout: 20_000,
  });
  await expect(page.locator("[data-screen-label]")).toBeVisible({
    timeout: 20_000,
  });

  // Suppress the first-run onboarding modal by default — its scrim
  // intercepts pointer events and would break every authenticated spec.
  // Specs explicitly about onboarding clear this in their own setup.
  await page.evaluate(() => window.localStorage.setItem("bp_onboarded", "true"));

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});
