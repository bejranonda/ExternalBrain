import { test, expect } from "@playwright/test";

/**
 * First-time-user orientation layer (2026-06-22).
 *
 * Covers the new orientation surfaces:
 *   1. /docs index lists the three new concept cards.
 *   2. The three new concept pages render (no 404, no leaked "undefined").
 *   3. The dashboard AgentPromptsCard shows for a zero-session user, copies a
 *      prompt, and stays dismissed across reload.
 *
 * Parts 1–2 are true anon (public /docs). Part 3 needs auth — gated on
 * E2E_ADMIN_PASSWORD like empty-dashboard.spec.ts, and mocks the dashboard to
 * zero so the empty-state branch (where the card lives) renders deterministically.
 */

test.describe("orientation docs (anon)", () => {
  test.use({ storageState: undefined });

  test("docs index lists the new concept cards", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.getByRole("heading", { name: "Using Brain from your agent" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Graph", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Decisions", exact: true })).toBeVisible();
  });

  test("new concept pages render without 404 or undefined", async ({ page }) => {
    for (const [slug, heading] of [
      ["using-from-your-agent", "Using Brain from your agent"],
      ["graph", "Graph"],
      ["decisions", "Decisions"],
    ] as const) {
      await page.goto(`/docs/concepts/${slug}`);
      await expect(page.locator("h1").first()).toHaveText(heading);
      const body = await page.locator("body").innerText();
      expect(body, slug).not.toContain("undefined");
    }
  });

  test("agent-prompts page shows a literal prompt callout", async ({ page }) => {
    await page.goto("/docs/concepts/using-from-your-agent");
    await expect(
      page.getByText("Do you have a connection to the Brain?", { exact: false }),
    ).toBeVisible();
  });
});

test.describe("dashboard agent-prompts card", () => {
  test.skip(
    !process.env["E2E_ADMIN_PASSWORD"],
    "Authenticated spec — set E2E_ADMIN_PASSWORD (see e2e/auth.setup.ts).",
  );

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

  test("shows for a zero-session user, copies a prompt, and stays dismissed", async ({ page }) => {
    await page.goto("/#dashboard");
    await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });

    // Start from a known-clean dismiss state (the auth storageState could carry
    // a stale flag). Clear once, then reload so the card mounts expanded. We do
    // NOT use addInitScript — it would re-run on the later reload and wipe the
    // flag we set when dismissing, defeating the persistence assertion.
    await page.evaluate(() => window.localStorage.removeItem("bp_agent_prompts_dismissed"));
    await page.reload();
    await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });

    // Expanded card: a literal prompt + a Copy button are present.
    const prompt = page.getByText("Do you have a connection to the Brain?", { exact: false });
    await expect(prompt).toBeVisible();
    const copyBtn = page.getByRole("button", { name: /copy/i }).first();
    await expect(copyBtn).toBeVisible();

    // Dismiss hides the expanded card.
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(prompt).toHaveCount(0);

    // Persists across reload — collapsed link replaces the expanded card.
    await page.reload();
    await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Do you have a connection to the Brain?", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /talk to your brain/i })).toBeVisible();
  });
});
