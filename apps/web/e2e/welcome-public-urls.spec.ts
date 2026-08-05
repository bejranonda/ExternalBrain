import { test, expect } from "@playwright/test";

// Regression: #293 — /welcome rendered Cursor/Windsurf/Other MCP snippets
// with `${hostname}:3100/mcp` baked in. On any deployment where MCP is on
// a different subdomain (the canonical prod topology) those URLs were
// unreachable. Fixed via server-injected BRAIN_*_PUBLIC_HOSTNAME (#297)
// and `export const dynamic = "force-dynamic"` (#299) so the env is read
// at request time, not frozen at Docker build time.
//
// What this guards:
//   1. Anon access to /welcome doesn't show "Couldn't reach Brain" (#294)
//   2. Snippets for Cursor/Windsurf/Other resolve to a URL that:
//      - matches BRAIN_MCP_PUBLIC_HOSTNAME when E2E_EXPECTED_MCP_HOST is set
//      - does NOT contain :3100 when the test is run against any URL other
//        than http://localhost (the Docker-baked default would slip past
//        the previous tests because they hit localhost where :3100 is real)
//
// Run via:
//   pnpm --filter @brain/web exec playwright test e2e/welcome-public-urls.spec.ts
// Against a deployed brain:
//   E2E_BASE_URL=https://brain-dev.example.com \
//   E2E_EXPECTED_MCP_HOST=mcp.brain-dev.example.com \
//   pnpm --filter @brain/web exec playwright test e2e/welcome-public-urls.spec.ts

// 2026-08-05: the #293 fix and this spec were both scoped to /welcome, but
// the token install wizard and the onboarding modal resolved their MCP URLs
// the same brittle way (`${hostname}:3100`) from client components that
// could not read the deploy env at all. Same bug, two more surfaces,
// invisible here because this spec named a page instead of the bug class.
//
// This file runs in the ANON job (.github/workflows/onboarding-e2e.yml), so
// it must not contain anything requiring a signed-in session — an authed
// assertion added here fails with `auth_not_configured`. The wizard
// counterpart therefore lives in e2e/tokens.spec.ts, and the
// locale-independent guard for the whole class is the source-level test in
// lib/brain/public-urls.test.ts, which runs unconditionally.

const EXPECTED_HOST = process.env["E2E_EXPECTED_MCP_HOST"]?.trim();

test.describe("welcome public URLs (#293, #294)", () => {
  // Defeat the storageState that pre-marks bp_onboarded — we want a true
  // anon visit to /welcome with no app-state preconditions.
  test.use({ storageState: undefined });

  test("unauthenticated /welcome doesn't show \"Couldn't reach Brain\"", async ({ page }) => {
    await page.goto("/welcome");
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("Couldn't reach Brain");
    // The fixed copy should be visible OR the user is already signed in
    // (and the page shows "Waiting for first session…"). Either is fine —
    // the bug is the red-herring connection error in unauth state.
  });

  test("each tool snippet renders a reachable MCP URL", async ({ page, baseURL }) => {
    await page.goto("/welcome");

    const variants = ["cursor", "windsurf", "other"] as const;
    for (const variant of variants) {
      const radio = page.locator(`input[type=radio][value="${variant}"]`);
      await radio.click();
      const text = await page.locator("body").innerText();
      const urls = text.match(/https?:\/\/[^\s'"]+\/mcp/g) ?? [];
      expect(
        urls.length,
        `expected at least one MCP URL in ${variant} snippet`,
      ).toBeGreaterThan(0);

      for (const url of urls) {
        // When running against anything other than bare localhost, the
        // brittle ${host}:3100 fallback must NOT appear — that was the
        // #293 bug. Allow it on localhost because that's the legit dev
        // path (no nginx, port 3100 is real).
        const baseIsLocalhost = (baseURL ?? "").includes("localhost");
        if (!baseIsLocalhost) {
          expect(url, `${variant}: snippet still contains :3100`).not.toContain(":3100");
        }
        if (EXPECTED_HOST) {
          expect(
            url,
            `${variant}: snippet host doesn't match E2E_EXPECTED_MCP_HOST`,
          ).toContain(EXPECTED_HOST);
        }
      }
    }
  });
});
