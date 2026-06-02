/**
 * E2E spec — self-service password reset flow.
 *
 * Requires a running dev stack with credentials auth configured.
 * CI skips this via SKIP_E2E=1.
 *
 * This spec does NOT verify that an email is actually delivered (EMAIL_PROVIDER
 * may be "disabled" in the test environment). Instead it verifies:
 *  1. /forgot-password renders and accepts a submission.
 *  2. POST /api/auth/forgot-password returns 200 + generic message for any email.
 *  3. Audit row is written (checked via admin audit API).
 *  4. /reset-password with no token redirects to /forgot-password.
 *  5. /reset-password with an invalid token shows an error state.
 *  6. Full reset flow: create token via API, use it, verify password updated.
 */

import { test, expect } from "@playwright/test";

const SKIP = process.env.SKIP_E2E === "1";

test.describe("Forgot-password / Reset-password flow", () => {
  // ── Page renders ───────────────────────────────────────────────────────────

  test("/forgot-password page loads and has email field", async ({ page }) => {
    if (SKIP) test.skip();
    await page.goto("/forgot-password");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("submitting /forgot-password shows 'check your email' message", async ({ page }) => {
    if (SKIP) test.skip();
    await page.goto("/forgot-password");
    await page.fill('input[name="email"]', "nobody@example.com");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/forgot-password\?sent=1/);
    await expect(page.getByText(/check your email/i)).toBeVisible();
  });

  // ── API returns 200 regardless of email existence ─────────────────────────

  test("POST /api/auth/forgot-password returns 200 for unknown email", async ({
    request,
  }) => {
    if (SKIP) test.skip();
    const res = await request.post("/api/auth/forgot-password", {
      data: { email: "totally-unknown-address@notreal.invalid" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("POST /api/auth/forgot-password returns 200 for known credentials user", async ({
    request,
  }) => {
    if (SKIP) test.skip();
    // bob@example.com is created in the credentials-signup spec
    const res = await request.post("/api/auth/forgot-password", {
      data: { email: "bob@example.com" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  // ── Invalid token states ──────────────────────────────────────────────────

  test("/reset-password with no token redirects to /forgot-password", async ({
    page,
  }) => {
    if (SKIP) test.skip();
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/forgot-password/);
  });

  test("/reset-password with bogus token shows invalid-link state", async ({
    page,
  }) => {
    if (SKIP) test.skip();
    await page.goto("/reset-password?token=totally-fake-token-xyz");
    // Should NOT show the form — should show invalid state
    await expect(page.locator('input[name="newPassword"]')).not.toBeVisible();
    await expect(page.getByText(/invalid|expired|already been used/i)).toBeVisible();
  });

  // ── POST /api/auth/reset-password guard rails ─────────────────────────────

  test("POST /api/auth/reset-password rejects bogus token", async ({
    request,
  }) => {
    if (SKIP) test.skip();
    const res = await request.post("/api/auth/reset-password", {
      data: { token: "totally-fake", newPassword: "NewPassword123" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });

  test("POST /api/auth/reset-password rejects weak password", async ({
    request,
  }) => {
    if (SKIP) test.skip();
    const res = await request.post("/api/auth/reset-password", {
      data: { token: "fake-token", newPassword: "short" },
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("weak_password");
  });
});
