import { repoDocUrl } from "@/lib/brain/version";

/**
 * Tutorial source markdown is written for two audiences: GitHub's file
 * viewer (relative `./NN-slug.md` links, correct there) and the in-app
 * renderer, which serves each tutorial at `/docs/tutorials/NN-slug` — no
 * `.md`, no per-language file. Left un-rewritten, every "Where next" /
 * "See Tutorial N" link 404s in the app — confirmed live (2026-08-10):
 * `/docs/tutorials/01-getting-started.md` → 404, `/docs/tutorials/01-getting-started` → 200.
 * Rather than maintain two link syntaxes in the source `.md` files, this
 * rewrites at render time so the source stays GitHub-correct.
 */
export function resolveDocLink(href: string): { href: string; external: boolean } {
  // Same-folder tutorial link, any language suffix: ./04-managing-tokens.md,
  // ./04-managing-tokens.th.md, ./04-managing-tokens.de.md — the in-app
  // language switch is a toolbar toggle, not a separate route, so a
  // language-suffixed source link still resolves to the one slug page.
  const sameFolder = href.match(/^\.\/(\d\d-[\w-]+)(?:\.(?:th|de))?\.md(#.*)?$/);
  if (sameFolder) return { href: `/docs/tutorials/${sameFolder[1]}${sameFolder[2] ?? ""}`, external: false };

  // A doc one level up (docs/USING_BRAIN.md, docs/CLIENTS.md,
  // docs/HOW_IT_WORKS.md, …) has no in-app route at all — send it to the
  // GitHub source instead of rewriting to a page that doesn't exist.
  const parentDoc = href.match(/^\.\.\/([\w-]+)\.md(#.*)?$/);
  if (parentDoc) return { href: repoDocUrl(`docs/${parentDoc[1]}.md`) + (parentDoc[2] ?? ""), external: true };

  // `startsWith("http")` would both false-positive on "http-not-a-url" and
  // false-negative on "HTTPS://…" / protocol-relative "//example.com" —
  // the latter would silently open in the current tab instead of a new one
  // (CodeRabbit, PR #236). Matches an optional case-insensitive http(s):
  // scheme followed by "//", or a bare "//".
  return { href, external: /^(https?:)?\/\//i.test(href) };
}
