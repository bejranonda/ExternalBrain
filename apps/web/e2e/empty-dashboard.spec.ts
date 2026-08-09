import { test, expect } from "@playwright/test";

/**
 * Empty-state dashboard — the brand-new-user view (zero knowledge).
 *
 * Coverage gap flagged by the 2026-05-29 audit: every other dashboard spec
 * assumes a populated seed, so a regression that broke the first-time view
 * (the EmptyBrainCallout hero + guided-tour CTA, instead of a row of "0 / 0
 * / 0" tiles that read as broken) would pass CI green. This spec mocks the
 * dashboard to zero and asserts the empty hero renders — and that the
 * populated-state widgets do NOT.
 *
 * Requires E2E_ADMIN_PASSWORD (auth setup gate). Skipped otherwise.
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

test.describe("empty-state dashboard", () => {
  test.skip(
    !process.env["E2E_ADMIN_PASSWORD"],
    "Authenticated spec — set E2E_ADMIN_PASSWORD (see e2e/auth.setup.ts).",
  );

  test.beforeEach(async ({ page }) => {
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

  test("zero-knowledge user sees the guided empty hero, not a broken zero dashboard", async ({ page }) => {
    await page.goto("/#dashboard");

    const screen = page.locator('[data-screen-label="dashboard"]');
    await expect(screen).toBeVisible({ timeout: 15_000 });

    // Empty-state subtitle + the primary get-started CTA.
    //
    // Target changed 2026-08-09: /welcome → the quick-start tutorial.
    // /welcome is now post-install verification only, so pointing a user with
    // an EMPTY brain at it showed them a "waiting for your first session"
    // spinner and no way to install anything — the exact dead end this spec
    // exists to prevent.
    await expect(page.getByText("Your Brain is just getting started", { exact: false })).toBeVisible();
    const guided = page.getByRole("link", { name: /get started|guided tour/i });
    await expect(guided).toBeVisible();
    await expect(guided).toHaveAttribute("href", "/docs/tutorials/00-quick-start");

    // The populated-state hero must NOT render for an empty brain — this is
    // the regression the spec guards (empty state silently falling back to
    // the dense "0/0/0" dashboard that reads as broken to a newcomer).
    await expect(page.getByText("This week:", { exact: false })).toHaveCount(0);
  });
});
