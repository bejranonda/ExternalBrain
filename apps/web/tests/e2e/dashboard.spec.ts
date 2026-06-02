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

test("dashboard home renders hero + reveals everything panel", async ({ page, context, baseURL }) => {
  await injectAuthCookie(context, baseURL!);
  await page.goto("/");

  await expect(page.locator("body")).toContainText(/your brain right now/i);
  await expect(page.locator("body")).toContainText(/this week:/i);

  // Hero has 3 panel cards. Be lenient — accept any link.panel or .panel descendant.
  const panelCount = await page.locator("a.panel, .panel").count();
  expect(panelCount).toBeGreaterThanOrEqual(3);

  // Reveal the "everything" expansion.
  const showEverything = page.getByText(/show everything/i).first();
  await showEverything.click();

  // After expansion, one of "Your projects" or "Your recent work" should appear.
  await expect(
    page.locator("body").filter({ hasText: /your projects|your recent work/i })
  ).toBeVisible({ timeout: 10_000 });
});
