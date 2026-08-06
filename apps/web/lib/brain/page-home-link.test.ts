import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every page must offer a way back to the app.
 *
 * Named after the bug class, not the page that exposed it. `/settings/org`
 * shipped with no route home at all: the affordance was hand-rolled in four
 * sibling pages, so the fifth author simply didn't know it was expected, and
 * a user who navigated there had only the browser Back button. `/settings/
 * password` meanwhile pointed somewhere different from its siblings.
 *
 * The fix moved ownership into `settings/layout.tsx` (matching `admin/` and
 * `docs/`, which already did this). This test is what keeps it there: it walks
 * every `page.tsx` and requires a home link on the page OR on any ancestor
 * layout, so a new page under a nav-owning layout passes for free and a new
 * top-level section fails until it provides one.
 *
 * Deliberately source-level (no DB, no browser) so it runs unconditionally in
 * CI — 20 of 31 Playwright specs are referenced by no workflow (KNOWN_ISSUES
 * §0r), which makes an e2e-only guard indistinguishable from no guard.
 */

const APP_DIR = join(__dirname, "..", "..", "app");

/** Routes with no "home" to return to, or that never render UI. */
const EXEMPT = new Set([
  "", // app/page.tsx — this IS home
  "signin", // pre-auth: home would bounce straight back here
  "signup",
  "signout",
  "forgot-password",
  "reset-password",
  "accept-invite", // reached from an emailed link, pre-membership
  "settings", // redirect-only shim (redirect("/settings/tokens")), renders nothing
  // Renders <BrainApp>, the full SPA shell with the navigation rail — this is
  // the application itself scoped to a project, not a subpage you escape from.
  "[orgSlug]/[projectSlug]",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

/** A link to "/" in this file, in any of the forms the codebase uses. */
function hasHomeLink(file: string): boolean {
  const src = readFileSync(file, "utf8");
  return /href=["']\/["']|href=\{["']\/["']\}/.test(src);
}

/**
 * Local components the file imports (`@/…` or relative), resolved to paths.
 *
 * Needed because a page often delegates its whole UI to one component — the
 * home link then lives there, not in the page. Checking only page + layouts
 * reported /welcome as broken when `welcome-flow.tsx` carries the link. One
 * level of indirection covers the pattern this app actually uses; going
 * deeper would start asserting about shared leaf components.
 */
function localImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const WEB_ROOT = join(__dirname, "..", "..");
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+["'](@\/[^"']+|\.\.?\/[^"']+)["']/g)) {
    const spec = m[1]!;
    const base = spec.startsWith("@/")
      ? join(WEB_ROOT, spec.slice(2))
      : join(dirname(file), spec);
    for (const ext of [".tsx", ".ts"]) {
      try {
        if (statSync(base + ext).isFile()) {
          out.push(base + ext);
          break;
        }
      } catch {
        /* not this extension */
      }
    }
  }
  return out;
}

/** Walk up from a page to APP_DIR, collecting layout.tsx files. */
function ancestorLayouts(pageFile: string): string[] {
  const layouts: string[] = [];
  let dir = dirname(pageFile);
  for (;;) {
    const candidate = join(dir, "layout.tsx");
    try {
      if (statSync(candidate).isFile()) layouts.push(candidate);
    } catch {
      /* no layout at this level */
    }
    if (dir === APP_DIR) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return layouts;
}

const pages = walk(APP_DIR);

describe("every page offers a way home", () => {
  it("finds the app's pages (guards against a broken glob)", () => {
    // A walker that silently matches nothing would make every assertion below
    // vacuously pass — the failure mode this repo hit with glob('*') before.
    expect(pages.length).toBeGreaterThan(10);
  });

  for (const page of pages) {
    const route = relative(APP_DIR, dirname(page)).replace(/\\/g, "/");
    if (EXEMPT.has(route)) continue;

    it(`/${route} links home (itself or via an ancestor layout)`, () => {
      const sources = [
        page,
        ...ancestorLayouts(page),
        ...localImports(page),
      ];
      const covered = sources.some(hasHomeLink);
      expect(
        covered,
        `No link to "/" found in /${route} or any ancestor layout. ` +
          `Add the nav to the section's layout.tsx rather than the page, ` +
          `so sibling pages inherit it.`,
      ).toBe(true);
    });
  }
});
