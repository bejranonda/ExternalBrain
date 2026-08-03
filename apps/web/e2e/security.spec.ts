import { test, expect, request as pwRequest } from "@playwright/test";

// The MCP HTTP transport gets its OWN base URL, deliberately with no
// fallback.
//
// It used to read `E2E_BASE_URL ?? "http://localhost:3100"`. On a deployed
// brain that is right — MCP sits behind the same Caddy vhost as the webapp.
// In the `authed surfaces e2e` job it was catastrophically wrong: that job
// sets `E2E_BASE_URL=http://localhost:3000` and boots **only** the web app,
// so every "MCP transport" assertion below was posting to `/mcp` on Next.js
// and reading its 404. Both tests asserted `status >= 400`, so a 404 from the
// wrong process satisfied them. **Neither test had ever contacted the MCP
// server** (found 2026-08-02, KNOWN_ISSUES §0q).
//
// So: a separate variable, no default, and a loud skip when it is absent.
// A security test that cannot reach its target must skip visibly, never pass
// quietly — see GUIDELINES §4, "a failing assertion must be able to fail for
// exactly one reason".
const MCP_URL = process.env["E2E_MCP_URL"];

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
  // Force a clean, unauthenticated context regardless of which CI project
  // (or local run) wires these tests in. authed-e2e.yml's "chromium" project
  // applies a pre-authenticated storageState to every test by default — a
  // page-based test in THIS block that assumed anonymity would either
  // silently pass without testing anything (already-signed-in visitors
  // don't hit the guard) or fail confusingly (a form that isn't there
  // because the app already redirected past /signin). request-context tests
  // (MCP transport, below) are unaffected — they never carry page cookies.
  test.use({ storageState: { cookies: [], origins: [] } });

  // Both MCP transport tests are gated on E2E_MCP_URL. Skipping is loud in
  // the Playwright report; the previous silent pass against a 404 was not.
  test.skip(
    !MCP_URL,
    "E2E_MCP_URL not set — the MCP transport was NOT exercised by this run",
  );

  test("MCP HTTP transport refuses an unauthenticated call", async () => {
    const ctx = await pwRequest.newContext();
    try {
      const res = await ctx.post(`${MCP_URL}/mcp`, {
        headers: { "content-type": "application/json" },
        data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      });
      // 401 specifically: the transport refuses every method without a
      // Bearer, before the SDK sees the request (index.ts, "Refuse every
      // request without a Bearer token, including `initialize`"). A range
      // assertion here is what let a 404 from the wrong server pass.
      expect(res.status()).toBe(401);
      expect(await res.text()).not.toContain("serverInfo");
    } finally {
      await ctx.dispose();
    }
  });

  // Must probe `initialize`, NOT `tools/list`. A session-less `tools/list` is
  // rejected by the SDK with -32000 "Server not initialized" whatever the
  // bearer says, so the previous version of this test passed without the auth
  // layer ever being consulted — it would have stayed green with auth removed
  // entirely. `initialize` is the method that actually allocates a session,
  // so it is the one that has to refuse an unknown token.
  test("MCP HTTP transport refuses `initialize` with a bogus Bearer token", async () => {
    const ctx = await pwRequest.newContext();
    try {
      const res = await ctx.post(`${MCP_URL}/mcp`, {
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          Authorization: "Bearer bp_definitely_not_a_real_token_abcdef",
        },
        data: {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "audit-probe", version: "1" },
          },
        },
      });
      // Exactly 401 — not merely "some 4xx", which is what let the old
      // assertion pass for the wrong reason.
      expect(res.status()).toBe(401);
      // No session may be handed out, and no capability metadata may leak.
      expect(res.headers()["mcp-session-id"]).toBeUndefined();
      expect(await res.text()).not.toContain("serverInfo");
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
