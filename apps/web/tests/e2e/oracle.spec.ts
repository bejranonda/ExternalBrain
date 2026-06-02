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

test("oracle accepts a question and returns an answer with sources", async ({ page, context, baseURL }) => {
  await injectAuthCookie(context, baseURL!);
  await page.goto("/#oracle");

  await expect(page.locator("body")).toContainText(/oracle/i);

  const input = page.getByPlaceholder(/ask anything/i).first();
  await expect(input).toBeVisible({ timeout: 10_000 });

  await input.fill("what is brain platform");
  await input.press("Enter");

  // Wait for an answer — citations card OR "Sources" header indicates a real reply.
  await expect(
    page.locator(".oracle-citation-card").or(page.getByText(/sources/i).first())
  ).toBeVisible({ timeout: 30_000 });
});
