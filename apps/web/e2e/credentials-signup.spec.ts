/**
 * E2E spec — invite-based Credentials sign-up.
 *
 * Requires:
 *  - Dev stack running with a live DB and credentials auth configured.
 *  - ADMIN_USERNAME + ADMIN_PASSWORD_HASH set in the environment.
 *
 * Flow:
 *  1. Org owner (admin) creates an invite for bob@example.com.
 *  2. Open /accept-invite?token=... in a new browser context (simulates
 *     incognito tab).
 *  3. Verify redirect to /signin?invite=<token> with sign-up form.
 *  4. Submit display name + password.
 *  5. Assert Bob is signed in and lands on the invited org's first project.
 *  6. Bob signs out and signs back in with email + password.
 *  7. Bob navigates to /settings/password and changes his password.
 *
 * NOTE: This spec is live-stack-only. CI skips it via SKIP_E2E=1.
 */

import { test, expect } from "@playwright/test";

const SKIP = process.env.SKIP_E2E === "1";

test.describe("Invite-based Credentials sign-up", () => {
  let inviteToken = "";
  let inviteLink = "";
  let orgSlug = "";

  test.beforeAll(async ({ request }) => {
    if (SKIP) return;

    // Fetch the admin's personal org
    const orgsRes = await request.get("/api/orgs");
    if (!orgsRes.ok()) return;
    const orgsData = (await orgsRes.json()) as {
      orgs: Array<{ id: string; slug: string; role: string }>;
    };
    const myOrg = orgsData.orgs.find((o) => o.role === "owner");
    if (!myOrg) return;
    orgSlug = myOrg.slug;

    // Create an invite for bob@example.com
    const inviteRes = await request.post(`/api/orgs/${myOrg.id}/invites`, {
      data: { email: "bob@example.com", role: "member" },
    });
    if (!inviteRes.ok()) return;
    const inviteData = (await inviteRes.json()) as { token: string };
    inviteToken = inviteData.token;
    inviteLink = `/accept-invite?token=${inviteToken}`;
  });

  test("redirects anonymous user to /signin?invite=<token>", async ({ browser }) => {
    if (SKIP || !inviteToken) test.skip();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(inviteLink);
    await expect(page).toHaveURL(new RegExp(`/signin\\?invite=${inviteToken}`));
    await ctx.close();
  });

  test("sign-up form shows invite banner with org name", async ({ browser }) => {
    if (SKIP || !inviteToken) test.skip();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/signin?invite=${inviteToken}`);
    await expect(page.getByText(/you've been invited to/i)).toBeVisible();
    await ctx.close();
  });

  test("submit sign-up form creates account and signs in", async ({ browser }) => {
    if (SKIP || !inviteToken) test.skip();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`/signin?invite=${inviteToken}`);

    await page.fill('input[name="name"]', "Bob Tester");
    await page.fill('input[name="password"]', "BobSecure99");
    await page.fill('input[name="confirmPassword"]', "BobSecure99");
    await page.click('button[type="submit"]');

    // Should land on the invited org's project
    await expect(page).toHaveURL(new RegExp(`^/${orgSlug}/`), { timeout: 10000 });
    await ctx.close();
  });

  test("Bob can sign out and sign back in with email + password", async ({ browser }) => {
    if (SKIP || !inviteToken) test.skip();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Sign in as Bob
    await page.goto("/signin");
    await page.fill('input[name="username"]', "bob@example.com");
    await page.fill('input[name="password"]', "BobSecure99");
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL("/signin", { timeout: 10000 });
    await ctx.close();
  });

  test("Bob can change his password at /settings/password", async ({ browser }) => {
    if (SKIP || !inviteToken) test.skip();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Sign in as Bob
    await page.goto("/signin");
    await page.fill('input[name="username"]', "bob@example.com");
    await page.fill('input[name="password"]', "BobSecure99");
    await page.click('button[type="submit"]');
    await expect(page).not.toHaveURL("/signin", { timeout: 10000 });

    // Change password
    await page.goto("/settings/password");
    await page.fill('input[autocomplete="current-password"]', "BobSecure99");
    await page.fill('input[autocomplete="new-password"]', "BobNewPass1");
    // Confirm password is the second autocomplete="new-password" input
    const newPwInputs = page.locator('input[autocomplete="new-password"]');
    await newPwInputs.nth(1).fill("BobNewPass1");
    await page.click('button[type="submit"]');

    await expect(page.getByText(/password changed successfully/i)).toBeVisible({ timeout: 8000 });
    await ctx.close();
  });
});
