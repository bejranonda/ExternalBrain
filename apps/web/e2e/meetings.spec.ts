import { test, expect } from "@playwright/test";

// Flag-gated (MEETING_UPLOAD_ENABLED) — dark-launched (spec 2026-07-13).
// CI does not set the flag, so every test here shows as SKIPPED, not
// passing/absent — verify via the CI run log, same as the 2026-07-10
// security.spec.ts fix this mirrors.
test.describe("meetings surface", () => {
  test.skip(
    process.env["MEETING_UPLOAD_ENABLED"] !== "true",
    "Flag-gated — set MEETING_UPLOAD_ENABLED=true to run.",
  );

  test("paste → extract → review → teach a decision", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /meetings/i }).click();
    await page.getByPlaceholder(/paste the meeting transcript/i).fill(
      "Sprint planning. Anna: we'll use Postgres with Timescale for the reporting store, not plain Postgres, because queries are time-bucketed. Ben: I'll fix the staging database, it's blocking everything.",
    );
    await page.getByRole("button", { name: /^extract$/i }).click();
    await expect(page.getByTestId("decision-card-0")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("decision-card-0").getByRole("button", { name: /teach/i }).click();
    await expect(page.getByTestId("decision-card-0").getByRole("button", { name: /taught/i })).toBeVisible();
  });
});
