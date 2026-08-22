/**
 * One composition for skill embedding text.
 *
 * Skills went entirely unembedded until 2026-08-22: autoskill created them,
 * `brain_find_skill` filters on `embedding IS NOT NULL`, and nothing ever
 * wrote a vector — so semantic skill search could not return a result no
 * matter how many skills existed.
 *
 * Now two writers embed skills: the create path in `autoskill.ts` and the
 * worker backfill. They MUST compose the input identically, or re-embedding a
 * row silently moves it in vector space and retrieval changes with nothing
 * failing. The Knowledge side avoids this only by coincidence — its four
 * writers happen to agree on `trigger\nrule` — so here it is a function, and
 * these are the tests that keep it one.
 */
import { describe, it, expect } from "vitest";
import { skillEmbeddingText } from "../skill-text.js";

const FRONTMATTER = `---
skill_id: deploy-runbook
title: Deploy runbook
kind: internal
stage: notes
---
`;

describe("skillEmbeddingText", () => {
  it("leads with the title, so a truncated skill still matches its name", () => {
    const out = skillEmbeddingText({ title: "Deploy runbook", content: "body text" });
    expect(out.startsWith("Deploy runbook")).toBe(true);
  });

  it("strips YAML frontmatter — that is metadata, not meaning", () => {
    const out = skillEmbeddingText({
      title: "Deploy runbook",
      content: `${FRONTMATTER}\nRun DEPLOY_EDGE=false ./scripts/deploy.sh`,
    });
    expect(out).not.toContain("skill_id:");
    expect(out).not.toContain("stage: notes");
    expect(out).toContain("DEPLOY_EDGE=false");
  });

  it("strips autoskill marker comments, which carry no meaning", () => {
    const out = skillEmbeddingText({
      title: "T",
      content: "<!-- autoskill:begin -->\n## improvements\n- thing\n<!-- autoskill:end -->",
    });
    expect(out).not.toContain("autoskill:begin");
    expect(out).toContain("- thing");
  });

  it("truncates a long body rather than refusing to embed it", () => {
    // gemini-embedding-001 caps input around 2048 tokens. Erroring here would
    // make the LARGEST skills the only unfindable ones — the opposite of what
    // this feature is for.
    const out = skillEmbeddingText({ title: "Big", content: "x".repeat(50_000) });
    expect(out.length).toBeLessThan(10_000);
    expect(out.startsWith("Big")).toBe(true);
  });

  it("is deterministic — the same skill always yields the same text", () => {
    // If it were not, every backfill pass would re-embed to a slightly
    // different point and `remaining` would never settle.
    const skill = { title: "Deploy runbook", content: `${FRONTMATTER}\nbody` };
    expect(skillEmbeddingText(skill)).toBe(skillEmbeddingText(skill));
  });

  it("survives a skill with no frontmatter and no markers", () => {
    expect(skillEmbeddingText({ title: "Bare", content: "just prose" })).toBe(
      "Bare\njust prose",
    );
  });
});
