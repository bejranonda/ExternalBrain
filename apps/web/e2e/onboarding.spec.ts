import { test, expect } from "@playwright/test";

/**
 * Onboarding modal — the first-run 5-step walkthrough.
 *
 * Previously both tests here were `.fixme`'d to no-ops: the modal only
 * mounts when the app shell renders (needs auth) AND knowledgeCount === 0,
 * and the old approach had neither — `page.goto("/")` with an empty cookie
 * jar redirected to /signin, so the shell never appeared. With the auth
 * setup project (e2e/auth.setup.ts) the session is now present; here we
 * keep those cookies, clear the `bp_onboarded` flag, and mock all three
 * count endpoints `useCounts()` reads so knowledgeCount resolves to 0 and
 * the modal auto-opens.
 *
 * Requires E2E_ADMIN_PASSWORD (the auth setup gate). Skipped otherwise.
 */

const ZERO_DASHBOARD = {
  stats: {
    activeKnowledge: 0,
    sessionsWeek: 0,
    sessionsAllTime: 0,
    pendingProposals: 0,
    sqsCurrent: 0,
    sqsTrend: [],
    knowledgeHealth: 0,
    bundleHitRate: 0,
    contradictions: 0,
    decayThisWeek: 0,
  },
  typeCounts: [],
};
const EMPTY_LIST = { items: [], total: 0, nextCursor: null };

test.describe("onboarding modal", () => {
  test.skip(
    !process.env["E2E_ADMIN_PASSWORD"],
    "Authenticated spec — set E2E_ADMIN_PASSWORD (see e2e/auth.setup.ts).",
  );

  test.beforeEach(async ({ page }) => {
    // Keep the auth cookies from the setup project, but drop the
    // bp_onboarded flag so the modal's auto-open condition can fire.
    await page.addInitScript(() => window.localStorage.removeItem("bp_onboarded"));

    // useCounts() reads skills from /api/dashboard (activeKnowledge) with a
    // fallback to /api/knowledge?limit=1 (total), and proposals from
    // /api/autoskill/proposals. Mock all three to zero so knowledgeCount===0
    // AND loaded===true (the modal gates on `ready && knowledgeCount===0`).
    await page.route("**/api/dashboard*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZERO_DASHBOARD) }),
    );
    await page.route("**/api/knowledge*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_LIST) }),
    );
    await page.route("**/api/autoskill/proposals*", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EMPTY_LIST) }),
    );
  });

  test("5-step walkthrough navigates forward and back", async ({ page }) => {
    await page.goto("/");

    const modal = page.locator('[role="dialog"][aria-label="Onboarding"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    // Step 1
    await expect(modal).toContainText("Welcome to your Brain");
    await expect(modal).toContainText("STEP 1 OF 5");

    const next = modal.getByRole("button", { name: /^next$/i });

    // Step 2
    await next.click();
    await expect(modal).toContainText("STEP 2 OF 5");
    await expect(modal).toContainText("Create a token for your AI tool");

    // Step 3
    await next.click();
    await expect(modal).toContainText("STEP 3 OF 5");
    await expect(modal).toContainText("Wire Claude Code");

    // Step 4
    await next.click();
    await expect(modal).toContainText("STEP 4 OF 5");
    await expect(modal).toContainText("Teach your first skill");

    // Back to step 3
    await modal.getByRole("button", { name: /back/i }).click();
    await expect(modal).toContainText("STEP 3 OF 5");

    // Forward to step 5
    await next.click();
    await next.click();
    await expect(modal).toContainText("STEP 5 OF 5");
    await expect(modal).toContainText("Ask the Oracle");

    // Done closes the modal and persists bp_onboarded
    await modal.getByRole("button", { name: /^done$/i }).click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    expect(await page.evaluate(() => window.localStorage.getItem("bp_onboarded"))).toBe("true");
  });

  test("Skip closes the modal and sets bp_onboarded", async ({ page }) => {
    await page.goto("/");

    const modal = page.locator('[role="dialog"][aria-label="Onboarding"]');
    await expect(modal).toBeVisible({ timeout: 15_000 });

    await modal.locator('button[aria-label="Skip onboarding"]').click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    expect(await page.evaluate(() => window.localStorage.getItem("bp_onboarded"))).toBe("true");
  });
});
