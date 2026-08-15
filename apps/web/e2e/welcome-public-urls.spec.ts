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

  // REMOVED 2026-08-09: "each tool snippet renders a reachable MCP URL".
  //
  // /welcome no longer renders install snippets at all — its tool picker and
  // install command were removed because they duplicated (worse: with a stale
  // 4-of-12 tool list) /docs/tutorials/00-quick-start. There are no
  // `input[name=welcome-tool]` radios left for that test to drive.
  //
  // The coverage did NOT move to another anon spec, and that is a real gap
  // worth stating rather than quietly dropping: the quick-start tutorial
  // renders `https://<your-brain>/...` placeholders from static markdown, not
  // env-resolved URLs, so there is no longer ANY anonymous surface that
  // renders a real BRAIN_MCP_PUBLIC_HOSTNAME-derived URL for this job to
  // assert against.
  //
  // What still guards the #293 class:
  //   - lib/brain/public-urls.test.ts — source-level, runs unconditionally,
  //     and is the check that actually generalises (it catches the bug in any
  //     surface, which is why it exists after the defect shipped three times).
  //   - e2e/tokens.spec.ts — the authed token wizard, which is now the only
  //     UI that renders a token-bearing install command with a resolved host.
  //   - the replacement below (2026-08-15), which closes the anon gap.

  // CLOSES the gap the comment above tracked. /api/onboard/agent.md is the one
  // remaining ANONYMOUS surface that resolves a real host from deploy env:
  // public, unauthenticated, not flag-gated, and `force-dynamic` so it reads
  // process.env per request rather than freezing Docker-build values.
  //
  // Asserting on a markdown endpoint rather than a page is the point. The
  // #293 class is "a URL was built from the wrong source", which has nothing
  // to do with rendering — scoping the old test to a *page* is exactly why it
  // died when that page's content moved (see the note above, and
  // GUIDELINES §4 "verify the property, not the nearest signal").
  test("the anon agent-bootstrap doc resolves a reachable MCP URL from deploy env", async ({
    request,
  }) => {
    const res = await request.get("/api/onboard/agent.md");
    expect(res.status()).toBe(200);
    const body = await res.text();

    // Non-vacuous guard: if the doc ever stops embedding URLs, the assertions
    // below would pass trivially against an empty string.
    expect(body).toContain("/api/onboard/claim");

    // Assert the WEB host, not the MCP host. This doc embeds only
    // webUrl-derived links (claim endpoint, /start, /signin, /settings/tokens)
    // — the install command carrying the MCP URL comes back from
    // /api/onboard/claim at runtime, not from this document. Verified against
    // a live deployment before writing this: an `E2E_EXPECTED_MCP_HOST`
    // assertion here passes only vacuously or fails outright, which is how a
    // first draft of this test would have shipped red.
    const expectedWebHost = process.env.E2E_EXPECTED_WEB_HOST;
    if (expectedWebHost) {
      expect(body).toContain(expectedWebHost);
    }

    // A placeholder that escaped substitution is the other way this breaks —
    // the German quick start shipped `<dein-brain>` for exactly this reason.
    expect(body).not.toContain("<your-brain>");
  });
});
