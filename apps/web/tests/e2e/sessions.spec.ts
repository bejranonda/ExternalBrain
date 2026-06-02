import { test, expect, type BrowserContext } from "@playwright/test";

async function injectAuthCookie(ctx: BrowserContext, baseURL: string) {
  const cookie = process.env["E2E_AUTH_COOKIE"];
  if (!cookie) throw new Error("Set E2E_AUTH_COOKIE env var (name=value)");
  const [name, ...rest] = cookie.split("=");
  await ctx.addCookies([
    {
      name: name.trim(),
      value: rest.join("=").trim(),
      domain: new URL(baseURL).hostname,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

test("sessions tab lists rows or empty-state, drill-down opens detail", async ({ page, context, baseURL }) => {
  await injectAuthCookie(context, baseURL!);
  await page.goto("/#sessions");

  await expect(page.locator("body")).toContainText(/sessions/i);

  // Either a session row OR an empty-state is acceptable — fresh brains have no data.
  const rows = page.locator("table tbody tr, [data-testid='session-row']");
  const rowCount = await rows.count();

  if (rowCount === 0) {
    await expect(
      page.locator("body").filter({ hasText: /no sessions|nothing yet|get started/i })
    ).toBeVisible();
    return;
  }

  // Drill into the first row and assert the detail panel surfaced something.
  await rows.first().click();
  await expect(
    page.locator("body").filter({ hasText: /brain helped you|this session|outcome/i })
  ).toBeVisible({ timeout: 10_000 });
});
