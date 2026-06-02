import { test, expect } from "@playwright/test";

/**
 * Sign-out flow — validates the /signout page renders and the server-action
 * form submits without NextAuth's "server configuration" error.
 *
 * In the E2E stack (dev-shim mode, ALLOW_DEV_AUTH=true) there's no real
 * session to end, so this test doesn't verify the full signOut semantics —
 * it verifies the page renders, the form is present, and submitting it
 * does not 5xx. The real OAuth signout is covered at SECURITY.md
 * troubleshooting + a manual smoke on a configured deployment.
 */
test.describe("sign-out flow", () => {
  test("/signout renders the confirmation page with a submit button", async ({ page }) => {
    const res = await page.goto("/signout");
    expect(res?.status() ?? 0).toBeLessThan(500);

    // Page header + submit button should both be visible.
    await expect(page.getByText(/sign out\?/i)).toBeVisible();
    const button = page.getByRole("button", { name: /^sign out$/i });
    await expect(button).toBeVisible();
  });

  test("/signout has a Cancel link back to /", async ({ page }) => {
    await page.goto("/signout");
    const cancel = page.getByRole("link", { name: /cancel/i });
    await expect(cancel).toBeVisible();
    await expect(cancel).toHaveAttribute("href", "/");
  });

  test("submitting /signout does not produce a 5xx", async ({ page }) => {
    await page.goto("/signout");

    // Capture the POST response to the server action.
    const responses: number[] = [];
    page.on("response", (r) => {
      if (r.request().method() === "POST") responses.push(r.status());
    });

    await page.getByRole("button", { name: /^sign out$/i }).click();
    // The server action either redirects (3xx) or lands on the eventual
    // target (2xx). Any 5xx is the bug we just fixed.
    await page.waitForLoadState("domcontentloaded");
    for (const s of responses) {
      expect(s).toBeLessThan(500);
    }
  });

  test("submitting /signout never lands on /undefined", async ({ page }) => {
    // Regression test for the 2026-04-23 pilot-VM report: NextAuth v5
    // signOut({redirectTo:"/signin"}) redirected to the literal string
    // "/undefined" because a callbackUrl form field was missing. Fix:
    // signOut({redirect:false}) + explicit next/navigation redirect.
    //
    // In dev-shim mode (ALLOW_DEV_AUTH=true) there's no session to clear,
    // so the exact post-signout destination is ambiguous — we may stay on
    // /signout, land on /signin, or bounce to /. The invariant we MUST hold
    // is that we never land on anything containing the literal "/undefined".
    await page.goto("/signout");

    const responses: Array<{ status: number; location: string | null }> = [];
    page.on("response", (r) => {
      responses.push({
        status: r.status(),
        location: r.headers()["location"] ?? null,
      });
    });

    await page.getByRole("button", { name: /^sign out$/i }).click();
    await page.waitForLoadState("networkidle", { timeout: 10_000 });

    // No 5xx anywhere in the chain.
    for (const r of responses) {
      expect(r.status).toBeLessThan(500);
    }
    // No response's Location header redirected to /undefined.
    for (const r of responses) {
      if (r.location) expect(r.location).not.toContain("/undefined");
    }
    // Final browser URL never contains the literal "/undefined" segment.
    const finalUrl = page.url();
    expect(finalUrl).not.toMatch(/\/undefined(\b|\?|#|\/|$)/);
  });
});
