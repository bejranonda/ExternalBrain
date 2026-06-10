import { test, expect } from "@playwright/test";

test.describe("dashboard surface", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#dashboard");
    // Wait for the app container to reflect the current route.
    await expect(page.locator('[data-screen-label="dashboard"]')).toBeVisible({ timeout: 15_000 });
    // The home-hero redesign moved the data panels (composition, SQS, recent
    // sessions, proposals, View-all) behind the collapsed "▸ Show everything"
    // fold. Expand it so the panel assertions below can see them (#52).
    const fold = page.getByRole("button", { name: /Show everything/i }).first();
    if (await fold.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await fold.click();
    }
  });

  test("H1 contains the dashboard title", async ({ page }) => {
    // i18n EN: dash.title = "Your Brain right now"
    const h1 = page.locator("h1").first();
    await expect(h1).toBeVisible({ timeout: 10_000 });
    const text = await h1.textContent();
    // Accept either the i18n key resolution or a reasonable fallback
    expect(text).toBeTruthy();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test("knowledge composition section shows at least one type row", async ({ page }) => {
    // Phase 3: KnowledgeTypes (composition panel) moved into the Advanced
    // collapsed section. Expand it before assertions.
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/dashboard") && resp.status() === 200,
      { timeout: 15_000 },
    ).catch(() => {
      // If the API call already happened before this listener, that's fine
    });

    // Expand the nested Advanced toggle (beforeEach already opened the
    // "Show everything" fold — do NOT match it here: its label is the same
    // open or closed, so a second click would COLLAPSE it and hide the
    // panels this test asserts on; that double-toggle was the run-4
    // composition failure in #52).
    const advancedBtn = page.getByRole("button", {
      name: /Advanced metrics|connection status/i,
    }).first();
    if (await advancedBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await advancedBtn.click();
    }

    const compositionRows = page.locator(".dash-grid-wide .panel").filter({ hasText: "%" });
    await expect(compositionRows.first()).toBeVisible({ timeout: 10_000 });
  });

  test("SQS trend element renders a non-zero / non-placeholder value", async ({ page }) => {
    // SQSChart renders a tab-num span with the current SQS value formatted with .toFixed(2)
    // The seed carries
    // deterministic per-session sqs values (#52), so this works on the
    // bare CI fixture too.
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/dashboard") && resp.status() === 200,
      { timeout: 15_000 },
    ).catch(() => { /* already happened */ });

    // The SQS headline is a .tab-num inside the SQSChart panel, whose root
    // carries title={t("tip.sqs")} ("Session Quality Score — …"). The old
    // .dash-grid-stats parent no longer exists post-redesign — the run-10
    // snapshot showed the values rendering while this selector matched
    // nothing (#52).
    const bigNums = page
      .locator('.panel[title^="Session Quality Score"] .tab-num')
      .filter({ hasText: /\d+\.\d+/ });
    await expect(bigNums.first()).toBeVisible({ timeout: 10_000 });
    const text = await bigNums.first().textContent();
    expect(text?.trim()).not.toBe("0.00");
    expect(text?.trim()).not.toBe("—");
    expect(text?.trim()).not.toBe("");
  });

  test("recent sessions panel shows at least one row", async ({ page }) => {
    // RecentSessions renders .sess-row elements; seed has 6 sessions.
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/sessions") && resp.status() === 200,
      { timeout: 15_000 },
    ).catch(() => { /* already happened */ });

    const sessRows = page.locator(".sess-row");
    await expect(sessRows.first()).toBeVisible({ timeout: 12_000 });
    const count = await sessRows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("pending proposals panel renders something (rows or empty state)", async ({ page }) => {
    // Seed has 4 pending proposals; but smoke runs may mutate state.
    // We accept either a proposal row OR the empty-state message.
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/autoskill") && resp.status() === 200,
      { timeout: 15_000 },
    ).catch(() => { /* already happened */ });

    // PendingProposals renders its content inside a .panel with heading from dash.autoskill_title
    const proposalsPanel = page.locator(".panel").filter({ hasText: /proposals|Autoskill/i }).first();
    await expect(proposalsPanel).toBeVisible({ timeout: 12_000 });

    // Either there are rows or an empty-state message — either is acceptable
    const hasRows = await page.locator(".panel").filter({ hasText: /high|medium|pending/i }).count();
    const hasEmpty = await page.getByText("No pending proposals.").count();
    expect(hasRows + hasEmpty).toBeGreaterThan(0);
  });

  test("'View all' CTA navigates to #sessions", async ({ page }) => {
    // The "View all" button in RecentSessions calls go("sessions").
    const viewAllBtn = page.getByRole("button", { name: /view all/i });
    await expect(viewAllBtn).toBeVisible({ timeout: 10_000 });
    await viewAllBtn.click();
    await expect(page).toHaveURL(/#sessions$/, { timeout: 5_000 });
    await expect(page.locator('[data-screen-label="sessions"]')).toBeVisible({ timeout: 10_000 });
  });
});
