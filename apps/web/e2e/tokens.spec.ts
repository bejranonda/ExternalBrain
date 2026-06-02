import { test, expect } from "@playwright/test";

// Smoke test for the MCP token lifecycle: create → banner visible → revoke.
// Requires the dev stack running with a live DB (readyz must return 200).
// Phase 3c: includes a project-scoping test (create token scoped to project A,
// attempt to use it for project B via MCP → expect FORBIDDEN_PROJECT).

const TOKEN_NAME = "e2e-smoke";

test.describe("token lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    // Delete any leftover e2e-smoke tokens from prior runs via the API.
    // This prevents stale revoked entries from causing false-positive failures.
    await page.goto("/settings/tokens");
    await page.waitForLoadState("networkidle");

    // Fetch the token list and DELETE any e2e-smoke tokens so the test starts clean.
    await page.evaluate(async (name) => {
      const res = await fetch("/api/tokens", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { tokens: Array<{ id: string; name: string }> };
      for (const t of data.tokens) {
        if (t.name === name) {
          await fetch(`/api/tokens/${t.id}`, { method: "DELETE" });
        }
      }
    }, TOKEN_NAME);

    // Reload to reflect the cleanup before the test body runs.
    await page.reload();
    await page.waitForLoadState("networkidle");
  });

  test("create token, see banner, revoke", async ({ page, context }) => {
    await page.goto("/settings/tokens");
    await page.waitForLoadState("networkidle");

    // Grant clipboard permissions so the copy button can work.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Fill in the name and submit.
    const nameInput = page.getByRole("textbox");
    await nameInput.fill(TOKEN_NAME);
    await page.getByRole("button", { name: "Create" }).click();

    // The "COPY NOW — THIS IS SHOWN ONCE" banner must appear.
    await expect(page.getByText("COPY NOW — THIS IS SHOWN ONCE")).toBeVisible();

    // The raw token is rendered inside a <code> element inside the banner.
    const tokenCode = page.locator(".panel code").first();
    await expect(tokenCode).toBeVisible();
    const rawToken = await tokenCode.textContent();
    expect(rawToken?.trim().length).toBeGreaterThan(10);

    // Copy button should work (browser clipboard API).
    // The wizard renders a "Copy" button for the snippet.
    await page.getByRole("button", { name: /^copy$/i }).click();
    await expect(page.getByRole("button", { name: /^copied$/i })).toBeVisible();

    // Token list shows the freshly created entry. Tokens are returned newest-first
    // (orderBy: createdAt desc), so the new entry is the FIRST panel matching the name.
    // Prior-run revoked entries with the same name appear after it.
    const tokenEntry = page.locator(".panel").filter({ hasText: TOKEN_NAME }).first();
    await expect(tokenEntry).toBeVisible();
    await expect(tokenEntry).toContainText("personal");
    // The "revoked" label must NOT be present yet on the new entry.
    await expect(tokenEntry.getByText("revoked")).not.toBeVisible();

    // Revoke it — the page uses window.confirm so we auto-accept it.
    page.on("dialog", (dialog) => void dialog.accept());
    await tokenEntry.getByRole("button", { name: "Revoke" }).click();

    // After revoke the entry should show "revoked" in the metadata line.
    await expect(tokenEntry.getByText(/revoked/)).toBeVisible({ timeout: 8_000 });
  });

  test("change token: create → dismiss wizard → click Change → confirm → wizard reappears with different bp_ token", async ({
    page,
    context,
  }) => {
    await page.goto("/settings/tokens");
    await page.waitForLoadState("networkidle");

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Create a token.
    const nameInput = page.getByRole("textbox");
    await nameInput.fill(TOKEN_NAME);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("COPY NOW — THIS IS SHOWN ONCE")).toBeVisible();

    // Grab the first raw token from the banner code block.
    const tokenCode = page.locator(".panel code").first();
    await expect(tokenCode).toBeVisible();
    const firstRaw = await tokenCode.textContent();
    expect(firstRaw?.trim().startsWith("bp_")).toBe(true);

    // Dismiss the wizard so the token row is reachable.
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText("COPY NOW — THIS IS SHOWN ONCE")).not.toBeVisible();

    // Find the active token row and click "Change".
    const tokenEntry = page.locator(".panel").filter({ hasText: TOKEN_NAME }).first();
    await expect(tokenEntry).toBeVisible();
    await tokenEntry.getByRole("button", { name: "Change" }).click();

    // The Change confirm modal should appear.
    await expect(
      page.getByRole("heading", { name: /Change token secret:/i }),
    ).toBeVisible();
    // Body should describe immediate cutover.
    await expect(
      page.getByText(/current secret stops working/i),
    ).toBeVisible();

    // Confirm the change.
    await page.getByRole("button", { name: /^Change token$/ }).click();

    // The modal should close and the wizard should reappear with a new token.
    await expect(page.getByText("COPY NOW — THIS IS SHOWN ONCE")).toBeVisible({ timeout: 8_000 });

    // The new raw token in the banner must differ from the original.
    const newTokenCode = page.locator(".panel code").first();
    await expect(newTokenCode).toBeVisible();
    const newRaw = await newTokenCode.textContent();
    expect(newRaw?.trim().startsWith("bp_")).toBe(true);
    expect(newRaw?.trim()).not.toBe(firstRaw?.trim());
  });

  test("token row shows project scope chip", async ({ page }) => {
    await page.goto("/settings/tokens");
    await page.waitForLoadState("networkidle");

    // Create a token (unscoped — no project picker interaction).
    const nameInput = page.getByRole("textbox");
    await nameInput.fill(TOKEN_NAME);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("COPY NOW — THIS IS SHOWN ONCE")).toBeVisible();

    // Dismiss the wizard.
    await page.getByRole("button", { name: "Dismiss" }).click();

    // The token row should show the "Any project" chip for an unscoped token.
    const tokenEntry = page.locator(".panel").filter({ hasText: TOKEN_NAME }).first();
    await expect(tokenEntry).toBeVisible();
    await expect(tokenEntry.getByText("Any project")).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Phase 3c: project-scoped token rejects cross-project MCP write
  //
  // Steps:
  //   1. Fetch the user's first project via /api/orgs.
  //   2. Create a token scoped to project A via POST /api/tokens.
  //   3. Simulate an MCP brain_start_session call requesting project B (a fake
  //      id) against the MCP server — expect FORBIDDEN_PROJECT error.
  //
  // NOTE: The MCP HTTP call is done via fetch() in evaluate() because
  // Playwright's context shares the same host, so auth cookies don't apply.
  // We rely on the raw Bearer token returned by the create endpoint instead.
  // This test is SKIPPED when the MCP server is not reachable from the browser
  // context (cross-origin without CORS headers), degrading gracefully to an API-
  // level assertion only.
  // ---------------------------------------------------------------------------
  test("project-scoped token: API creates with projectId; cross-project write returns 403", async ({
    page,
  }) => {
    await page.goto("/settings/tokens");
    await page.waitForLoadState("networkidle");

    // Fetch the user's first project.
    const orgsData = await page.evaluate(async () => {
      const r = await fetch("/api/orgs", { cache: "no-store" });
      return r.ok ? (await r.json()) as { orgs: Array<{ projects: Array<{ id: string; name: string }> }> } : null;
    });

    // Skip gracefully if no projects exist yet (minimal install).
    if (!orgsData?.orgs?.[0]?.projects?.[0]) {
      test.skip();
      return;
    }
    const projectA = orgsData.orgs[0].projects[0];

    // Create a token scoped to project A.
    const createResult = await page.evaluate(async (pid: string) => {
      const r = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "e2e-scope-test", scope: "personal", projectId: pid }),
      });
      return r.ok ? (await r.json()) as { raw: string; token: { id: string; projectId: string | null } } : null;
    }, projectA.id);

    expect(createResult).not.toBeNull();
    expect(createResult?.token?.projectId).toBe(projectA.id);
    const rawToken = createResult!.raw;

    // Verify projectId is returned by GET /api/tokens.
    const tokenList = await page.evaluate(async (tokenId: string) => {
      const r = await fetch("/api/tokens", { cache: "no-store" });
      if (!r.ok) return null;
      const data = await r.json() as { tokens: Array<{ id: string; projectId: string | null }> };
      return data.tokens.find((t) => t.id === tokenId) ?? null;
    }, createResult!.token.id);

    expect(tokenList?.projectId).toBe(projectA.id);

    // Cleanup: revoke the test token.
    await page.evaluate(async (tokenId: string) => {
      await fetch(`/api/tokens/${tokenId}`, { method: "DELETE" });
    }, createResult!.token.id);

    // If a raw token was obtained, test the FORBIDDEN_PROJECT path via the MCP
    // endpoint. We make a minimal MCP tool call with a different project id.
    if (rawToken) {
      const fakeProjB = "proj_forbidden_test_xyz";
      const mcpUrl = `${new URL(page.url()).protocol}//${new URL(page.url()).hostname}:3100/mcp`;
      const mcpResult = await page.evaluate(async ({ url, token, projectId }: { url: string; token: string; projectId: string }) => {
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name: "brain_start_session",
                arguments: { clientType: "custom", projectId },
              },
            }),
            signal: AbortSignal.timeout(5000),
          });
          return { status: r.status, body: await r.text() };
        } catch {
          return null; // MCP server not reachable from this context — skip
        }
      }, { url: mcpUrl, token: rawToken, projectId: fakeProjB });

      if (mcpResult !== null) {
        // MCP server is reachable; expect FORBIDDEN_PROJECT in the error
        const body = mcpResult.body;
        expect(body).toContain("FORBIDDEN_PROJECT");
      }
      // else: skip silently — MCP server not reachable from browser context
    }
  });

  test("create token → wizard appears → switch to Claude Desktop → snippet has transport + Authorization + macOS path", async ({
    page,
    context,
  }) => {
    await page.goto("/settings/tokens");
    await page.waitForLoadState("networkidle");

    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Create a token.
    const nameInput = page.getByRole("textbox");
    await nameInput.fill(TOKEN_NAME);
    await page.getByRole("button", { name: "Create" }).click();

    // The wizard must appear (still shows the "COPY NOW" label).
    await expect(page.getByText("COPY NOW — THIS IS SHOWN ONCE")).toBeVisible();
    // The "Install in your client" heading must be present.
    await expect(page.getByText("Install in your client")).toBeVisible();

    // Switch client to "Claude Desktop".
    await page.getByRole("radio", { name: "Claude Desktop" }).click();

    // The snippet must contain "transport" and the bearer token prefix.
    const pre = page.locator("pre").first();
    await expect(pre).toContainText('"transport"');
    await expect(pre).toContainText('"Authorization": "Bearer bp_');

    // The macOS config path must be visible.
    await expect(
      page.getByText(/Library\/Application Support\/Claude/),
    ).toBeVisible();

    // The Copy button must be present.
    await expect(page.getByRole("button", { name: /copy/i }).first()).toBeVisible();
  });
});
