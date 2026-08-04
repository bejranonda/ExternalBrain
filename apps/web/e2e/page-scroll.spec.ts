import { test, expect } from "@playwright/test";

/**
 * Standalone pages must be able to scroll (2026-08-04).
 *
 * `globals.css` carried `body { overflow: hidden; height: 100vh }` for the
 * SPA shell — which pins ITSELF to 100vh via `.app` and scrolls inside its own
 * `.scroll` panes, so the rule was redundant there. Everywhere else it was a
 * trap: `/settings/*`, `/admin/*`, `/signin`, `/welcome`, `/docs` and the
 * invite/password pages all render straight into `<body>` with no `.scroll`
 * wrapper, so anything past one viewport height was unreachable — no
 * scrollbar, no keyboard scroll, no way down.
 *
 * Reported against `/settings/tokens` by an operator whose account had 9
 * tokens and could only see the first two.
 *
 * Two assertions, because either alone is weak:
 *
 *  1. The CSS invariant — `overflow-y` on <body> must not be `hidden`. Cheap,
 *     deterministic, and names the exact regression.
 *  2. A behavioural check with SYNTHETIC content, so it does not depend on the
 *     fixture happening to have enough rows to overflow. A fixture-dependent
 *     scroll test passes for the wrong reason on a small seed — the failure
 *     mode this whole audit kept finding.
 *
 * `overflow-x: hidden` is deliberately still expected: the horizontal half of
 * the old rule is what `mobile-overflow.spec.ts` (#60) relies on.
 */

const STANDALONE_PAGES = [
  "/settings/tokens",
  "/settings/projects",
  "/admin",
];

for (const path of STANDALONE_PAGES) {
  test(`${path} is vertically scrollable`, async ({ page }) => {
    const res = await page.goto(path);
    // Some pages redirect by role/config; only assert on ones we actually land on.
    test.skip(!res || res.status() >= 400, `${path} not reachable in this fixture`);

    const overflowY = await page.evaluate(
      () => getComputedStyle(document.body).overflowY,
    );
    expect(overflowY, `body overflow-y on ${path}`).not.toBe("hidden");

    // Behavioural: make the document taller than the viewport, then prove the
    // page actually moves. Independent of how much seed data exists.
    const scrolled = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.height = "3000px";
      probe.setAttribute("data-scroll-probe", "");
      document.body.appendChild(probe);
      window.scrollTo(0, 500);
      const y = window.scrollY;
      probe.remove();
      window.scrollTo(0, 0);
      return y;
    });
    expect(scrolled, `${path} did not scroll when content exceeded the viewport`).toBeGreaterThan(0);
  });
}

// The counterpart risk: freeing <body> must not let the shell scroll the
// DOCUMENT as well as its inner panes — that strands the rail (which lives in
// a `height:100vh` `.app` anchored at the document top) somewhere mid-page.
//
// The first version of this test checked only `/`, i.e. the DASHBOARD, and
// passed — while `#skills` was broken in production. A shell test that visits
// one surface tests one surface: the failure lives in whichever pane lets its
// content escape, so every surface has to be walked.
const SHELL_SURFACES = ["", "#skills", "#sessions", "#decisions", "#dashboard"];

for (const hash of SHELL_SURFACES) {
  test(`the SPA shell pins itself to the viewport on ${hash || "(default)"}`, async ({ page }) => {
    const res = await page.goto(`/${hash}`);
    test.skip(!res || res.status() >= 400, "shell not reachable in this fixture");
    await page.waitForSelector(".app", { timeout: 30_000 });
    // Let the surface's data land — overflow usually arrives with content.
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => ({
      docH: document.documentElement.scrollHeight,
      winH: window.innerHeight,
      railBottom: (() => {
        const r = document.querySelector(".rail");
        return r ? Math.round(r.getBoundingClientRect().bottom) : null;
      })(),
    }));
    // Allow a pixel of rounding slack.
    expect(
      m.docH,
      `shell document height ${m.docH} vs viewport ${m.winH} on ${hash || "(default)"}`,
    ).toBeLessThanOrEqual(m.winH + 1);
    // Directly assert the reported symptom: the rail must end at the bottom of
    // the viewport, not partway down a taller document.
    if (m.railBottom !== null) {
      expect(
        m.railBottom,
        `rail bottom ${m.railBottom} should sit at the viewport bottom ${m.winH}`,
      ).toBeGreaterThan(m.winH - 80);
    }
  });
}
