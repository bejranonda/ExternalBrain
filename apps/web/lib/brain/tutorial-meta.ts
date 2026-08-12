/**
 * Tutorial metadata — pure data, no Node imports.
 *
 * Deliberately split out of `tutorial-content.ts`, which reads files via
 * `node:fs`. `docs/page.tsx` (the /docs index) is a `"use client"` component
 * that needs the title/summary/minutes for each tutorial card, but nothing
 * that imports `node:fs`/`node:path` can be pulled into a client bundle —
 * webpack fails outright ("UnhandledSchemeError: Reading from node:fs is not
 * handled by plugins"), not silently. Keeping this file Node-free means
 * `docs/page.tsx` can import it directly; only the server-only `[slug]/page.tsx`
 * needs `tutorial-content.ts`'s file-reading half.
 */

export interface TutorialMeta {
  /** URL slug — `/docs/tutorials/<slug>`. Matches the source filename prefix. */
  slug: string;
  /** Source filename stem, e.g. "00-quick-start" (without .md / .th.md / .de.md). */
  file: string;
  title: string;
  summary: string;
  minutes: string;
  /**
   * `"get-started"` — a linear onboarding walkthrough, meant to be followed
   * once, start to finish, by someone not yet connected.
   * `"guide"` — a technique for a specific feature, read by someone already
   * connected who wants to do one thing well. Not a prerequisite for
   * anything else.
   *
   * 04 (token management) and 07 (skill types) are NOT tutorials by this
   * definition — 04 is operational reference (scope/rotation/revocation, not
   * a single-sitting walkthrough) and 07 is a concept explainer (a mental
   * model, not a task). Both are still real pages at their same URLs — they
   * just aren't listed in the Tutorials grid on /docs. Instead they're
   * cross-linked as the "go deeper" repoDoc from their matching concept card
   * (tokens → 04, skills → 07) via docs-content.ts, which is where someone
   * looking for that content actually goes first. 06 (troubleshooting)
   * doesn't get a category at all — it's a symptom-lookup reference (every
   * heading is an error message, not a step), and it already has exactly one
   * correct entry point: the "Need help?" footer link on /docs. Listing it a
   * second time as a browsable "tutorial" card would present the same
   * document under two different framings on the same page.
   */
  category: "get-started" | "guide" | "reference";
}

/**
 * Ordered to match `docs/tutorials/README.md`'s own "pick where to start"
 * table — that ordering is the canonical recommendation, not alphabetical.
 * Metadata duplicated from that table rather than parsed from it: parsing a
 * hand-written markdown table for titles/summaries is more fragile than
 * eight lines of TypeScript, for content that changes rarely.
 */
export const TUTORIALS: TutorialMeta[] = [
  {
    slug: "00-quick-start",
    file: "00-quick-start",
    title: "Quick start",
    summary: "Get running right now — token → install → first conversation.",
    minutes: "3 min",
    category: "get-started",
  },
  {
    slug: "01-getting-started",
    file: "01-getting-started",
    title: "Getting started",
    summary: "Wire your AI tool (Claude Code / Cursor / Windsurf) to your Brain, with the reasoning spelled out.",
    minutes: "10 min",
    category: "get-started",
  },
  {
    slug: "02-asking-the-oracle",
    file: "02-asking-the-oracle",
    title: "Asking the Oracle",
    summary: "Ask your Brain questions about your own coding history.",
    minutes: "10 min",
    category: "guide",
  },
  {
    slug: "03-teaching-knowledge",
    file: "03-teaching-knowledge",
    title: "Teaching the Brain",
    summary: "Teach the Brain a new pattern, rule, or preference.",
    minutes: "10 min",
    category: "guide",
  },
  {
    slug: "04-managing-tokens",
    file: "04-managing-tokens",
    title: "Token scope + management",
    summary: "Issue a token scoped to a specific organization or project.",
    minutes: "10 min",
    category: "reference",
  },
  {
    slug: "05-exporting-rules",
    file: "05-exporting-rules",
    title: "Exporting rules",
    summary: "Export your accumulated rules into a project's .claude/ / .cursor/ / AGENTS.md.",
    minutes: "5 min",
    category: "guide",
  },
  {
    slug: "06-troubleshooting",
    file: "06-troubleshooting",
    title: "Troubleshooting",
    summary: 'Diagnose "the Brain doesn\'t seem to be helping."',
    minutes: "as needed",
    category: "reference",
  },
  {
    slug: "07-skill-types-explained",
    file: "07-skill-types-explained",
    title: "Skill types, explained",
    summary: "Understand the skill types (Recipe, Rule of thumb, Reflex…) — no tech background needed.",
    minutes: "10 min",
    category: "reference",
  },
];

export function getTutorialMeta(slug: string): TutorialMeta | undefined {
  return TUTORIALS.find((t) => t.slug === slug);
}
