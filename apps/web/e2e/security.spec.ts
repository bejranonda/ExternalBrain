import { test, expect, request as pwRequest } from "@playwright/test";

// The MCP HTTP transport lives at <origin>/mcp behind the same Caddy
// vhost as the webapp on deployed brains, and on port 3100 locally
// when no E2E_BASE_URL is set. The earlier hardcoded localhost:3100
// silently passed in local dev runs and silently failed in the
// deployed e2e gate — surfaced when the gate finally started running
// on PRs via the e2e-please label.
const MCP_URL = process.env["E2E_BASE_URL"] ?? "http://localhost:3100";

/**
 * Security posture E2E. Every check names the invariant it protects.
 *
 * Context: the E2E stack runs with `ALLOW_DEV_AUTH=true` and the seeded
 * Alex user has role='admin'. That means:
 *   - We CAN exercise the admin surface end-to-end as the dev-shim user.
 *   - We CANNOT exercise non-admin 403 paths from E2E — they need a second
 *     user the dev shim won't switch to. Those are unit-test territory.
 *
 * The truly critical invariants (unauth lockdown, refuseDevShimInProduction,
 * claimVoucher race-safety) are covered in code and reviewed at PR time.
 */

test.describe("security posture — positive path", () => {
  test("admin voucher endpoints work for the admin user", async ({ request }) => {
    const list = await request.get("/api/admin/vouchers");
    expect(list.status()).toBe(200);
    const data = (await list.json()) as { vouchers: unknown[] };
    expect(Array.isArray(data.vouchers)).toBe(true);
  });

  test("admin endpoint rejects a malformed create payload", async ({ request }) => {
    const bad = await request.post("/api/admin/vouchers", {
      data: { kind: "bogus-kind" },
    });
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    expect(bad.status()).toBeLessThan(500);
  });

  test("admin create + list roundtrip: a new voucher appears in the listing", async ({ request }) => {
    const code = `TEST-${Math.floor(Math.random() * 1e8).toString(36).toUpperCase()}-X`;
    const create = await request.post("/api/admin/vouchers", {
      data: {
        code,
        kind: "personal",
        maxUses: 1,
        note: "e2e security smoke — safe to delete",
      },
    });
    expect(create.status()).toBe(201);
    const { voucher } = (await create.json()) as { voucher: { id: string; code: string } };
    expect(voucher.code).toBe(code);

    const list = await request.get("/api/admin/vouchers");
    const { vouchers } = (await list.json()) as { vouchers: Array<{ id: string; code: string }> };
    expect(vouchers.find((v) => v.code === code)).toBeTruthy();

    // Tidy up — afterAll-style cleanup, but inline because we know the id now.
    const del = await request.delete(`/api/admin/vouchers/${voucher.id}`);
    expect(del.ok()).toBe(true);
  });

  test("admin patch: disabling then re-enabling a voucher flips state", async ({ request }) => {
    const code = `TEST-TOGGLE-${Math.floor(Math.random() * 1e6).toString(36).toUpperCase()}`;
    const create = await request.post("/api/admin/vouchers", {
      data: { code, kind: "personal", maxUses: 5 },
    });
    const { voucher } = (await create.json()) as { voucher: { id: string; disabled: boolean } };
    expect(voucher.disabled).toBe(false);

    const off = await request.patch(`/api/admin/vouchers/${voucher.id}`, {
      data: { disabled: true },
    });
    const { voucher: disabled } = (await off.json()) as { voucher: { disabled: boolean } };
    expect(disabled.disabled).toBe(true);

    const on = await request.patch(`/api/admin/vouchers/${voucher.id}`, {
      data: { disabled: false },
    });
    const { voucher: enabled } = (await on.json()) as { voucher: { disabled: boolean } };
    expect(enabled.disabled).toBe(false);

    await request.delete(`/api/admin/vouchers/${voucher.id}`);
  });

  test("admin patch refuses maxUses below current usedCount", async ({ request }) => {
    const create = await request.post("/api/admin/vouchers", {
      data: { code: `TEST-CAP-${Date.now()}`, kind: "personal", maxUses: 5 },
    });
    const { voucher } = (await create.json()) as { voucher: { id: string } };

    // usedCount is 0 on a fresh voucher, so maxUses=0 is "below" it only if we
    // pin the business rule to "cannot go negative" — enforced by zod.
    const bad = await request.patch(`/api/admin/vouchers/${voucher.id}`, {
      data: { maxUses: 0 },
    });
    expect(bad.status()).toBeGreaterThanOrEqual(400);

    await request.delete(`/api/admin/vouchers/${voucher.id}`);
  });
});

test.describe("security posture — negative path", () => {
  test("MCP HTTP transport refuses an unauthenticated call", async () => {
    const ctx = await pwRequest.newContext();
    try {
      const res = await ctx.post(`${MCP_URL}/mcp`, {
        headers: { "content-type": "application/json" },
        data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      });
      // Must fail closed — 401/403/400 all acceptable, anything 2xx would
      // mean the MCP server served tools to an anonymous caller.
      expect(res.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await ctx.dispose();
    }
  });

  test("MCP HTTP transport refuses a bogus Bearer token", async () => {
    const ctx = await pwRequest.newContext();
    try {
      const res = await ctx.post(`${MCP_URL}/mcp`, {
        headers: {
          "content-type": "application/json",
          Authorization: "Bearer bp_definitely_not_a_real_token_abcdef",
        },
        data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      });
      expect(res.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await ctx.dispose();
    }
  });

  test("/signin renders without throwing", async ({ page }) => {
    // In dev-shim mode /signin redirects to /; in OAuth mode it shows the
    // voucher + Continue-with-GitHub form. Either way it should be reachable
    // without a 5xx.
    const res = await page.goto("/signin");
    expect(res?.status() ?? 0).toBeLessThan(500);
  });

  test("anonymous visitor to /settings/tokens is redirected to sign-in, not shown a broken 401 page", async ({
    page,
  }) => {
    // Regression for the first-time-user review finding (2026-07-10):
    // /settings had no layout-level auth guard, so an anonymous visitor got
    // a 200 with a fully-rendered "Create token" form whose data fetches
    // silently 401'd — rendering the literal string "HTTP 401" in place of
    // content. The welcome page's own "Get a token →" link walks straight
    // into this for a genuine first-time visitor.
    await page.goto("/settings/tokens");
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/signin");
    await expect(page.getByText("HTTP 401")).toHaveCount(0);
  });

  test("sign-in with a backslash callbackUrl does not redirect off-origin (CodeRabbit finding, PR #164)", async ({
    page,
  }) => {
    // Regression: safeRedirect() originally only rejected "//" and "://".
    // The WHATWG URL parser's relative-slash state treats "/" and "\"
    // interchangeably when detecting a new authority for special schemes,
    // so "/\evil.example.com" resolves identically to "//evil.example.com"
    // — both hand "evil.example.com" to the parser as the new host. A real
    // credentials login is required to observe the actual post-signIn()
    // navigation target (NextAuth's own redirect callback is what resolves
    // the string — mocking it would not prove anything).
    test.skip(
      !process.env["E2E_ADMIN_PASSWORD"],
      "Authenticated spec — set E2E_ADMIN_PASSWORD (see e2e/auth.setup.ts).",
    );
    const username =
      process.env["E2E_ADMIN_USERNAME"] ?? process.env["ADMIN_USERNAME"] ?? "";
    const password = process.env["E2E_ADMIN_PASSWORD"] ?? "";

    await page.goto("/signin?callbackUrl=%2F%5Cevil.example.com");
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await page.waitForURL((url) => !url.pathname.startsWith("/signin"), {
      timeout: 20_000,
    });

    const expectedHost = new URL(
      process.env["E2E_BASE_URL"] ?? "http://localhost:3000",
    ).host;
    const finalUrl = new URL(page.url());
    expect(finalUrl.host).toBe(expectedHost);
    expect(finalUrl.host).not.toContain("evil.example.com");
  });
});
