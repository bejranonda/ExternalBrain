/**
 * In-app tutorial rendering — serves the SAME markdown that ships in
 * `docs/tutorials/` on GitHub, rather than maintaining a second, structured
 * copy the way `docs-content.ts` does for concept pages.
 *
 * That's a deliberate departure from the concept-page pattern, not an
 * oversight: `ConceptView` has no table or code-block support (plain <p>/<li>
 * text, no markdown parsing, one short monospace callout per section — see
 * concept-view.tsx). Tutorials are exactly the content that pattern can't
 * carry — install commands, per-client tables, troubleshooting tables. So
 * this module feeds real markdown to `react-markdown` + `remark-gfm` (already
 * a dependency, already used by `oracle.tsx` for citation-wrapped answers)
 * instead of forcing tutorial content into a shape built for something else.
 *
 * No filesystem reads at runtime, deliberately — see
 * `tutorial-content.generated.ts`'s header for why: this app's root layout
 * reads a cookie, which forces every route to render per-request rather than
 * as a cached static file (KNOWN_ISSUES.md), so a runtime `readFileSync`
 * would run on every live request, in a container that never gets `docs/`
 * copied into its runtime image. Content is baked into the bundle at build
 * time instead, by `scripts/generate-tutorial-content.ts` (apps/web's
 * `prebuild` step).
 */
import type { Lang } from "./i18n";
import { getTutorialMeta } from "./tutorial-meta";
import { TUTORIAL_MARKDOWN } from "./tutorial-content.generated";

export { TUTORIALS, getTutorialMeta } from "./tutorial-meta";
export type { TutorialMeta } from "./tutorial-meta";

/**
 * Only `00-quick-start` has TH/DE today; 01–07 are English-only. Falls back
 * to the English entry per-tutorial, same policy as
 * `docs-content.ts::getDoc()` — a missing translation degrades to English,
 * never a 404 or empty page.
 */
export function readTutorialMarkdown(
  lang: Lang,
  slug: string,
): { content: string; isTranslated: boolean } | null {
  const meta = getTutorialMeta(slug);
  if (!meta) return null;

  if (lang !== "en") {
    const localized = TUTORIAL_MARKDOWN[`${meta.file}.${lang}`];
    if (localized !== undefined) return { content: localized, isTranslated: true };
  }

  const en = TUTORIAL_MARKDOWN[`${meta.file}.en`];
  if (en === undefined) return null;
  return { content: en, isTranslated: lang === "en" };
}
