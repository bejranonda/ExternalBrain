/**
 * The text a Skill is embedded from — one definition, used by every writer.
 *
 * This exists because the same mistake is cheap to make twice: if the create
 * path and the backfill compose their input differently, re-embedding a row
 * silently moves it in vector space, and retrieval quietly changes without
 * anything failing. The Knowledge side got this right only by coincidence —
 * all four of its writers happen to use `trigger\nrule` — and that coincidence
 * is not a design. Here it is a function, so the agreement is enforced.
 */

/** Frontmatter is metadata, not meaning — strip it before embedding. */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Autoskill wraps its managed bullets in HTML comment markers. They carry no
 * semantic content and would otherwise dilute short skills.
 */
const AUTOSKILL_MARKERS = /<!--\s*autoskill:(?:begin|end)\s*-->/gi;

/**
 * Character budget for the embedded body.
 *
 * `gemini-embedding-001` accepts ~2048 tokens; at a conservative ~4 chars per
 * token that is roughly 8k characters, and we stay under it. Truncation is
 * deliberate rather than an error: a skill longer than this is still worth
 * finding by its opening, and refusing to embed it would make the largest
 * skills the only unfindable ones — the opposite of useful.
 */
const MAX_BODY_CHARS = 6000;

/**
 * Compose the embedding input for a skill.
 *
 * Title first: it is the highest-signal line and survives truncation, so a
 * long skill still matches on what it is called.
 */
export function skillEmbeddingText(skill: {
  title: string;
  content: string;
}): string {
  const body = skill.content
    .replace(FRONTMATTER, "")
    .replace(AUTOSKILL_MARKERS, "")
    .trim()
    .slice(0, MAX_BODY_CHARS);
  return `${skill.title}\n${body}`.trim();
}
