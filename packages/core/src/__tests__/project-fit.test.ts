/**
 * The fallback funnels knowledge into the wrong project by design.
 *
 * `resolveProjectForCall` picks `projects[0]`, oldest-first, which is the
 * auto-created "Default" for essentially every user — and the hint that
 * reported it said "pass projectName" without listing a single name. These
 * tests pin the two properties that make the replacement useful: it names the
 * candidates, and it only calls something a match when it has a reason it can
 * show.
 */
import { describe, it, expect } from "vitest";
import {
  suggestProjects,
  fallbackHint,
  SUGGESTION_THRESHOLD,
} from "../project-fit.js";

const PROJECTS = [
  { id: "p_default", name: "Default", framework: null, language: null },
  { id: "p_eb", name: "External Brain", framework: "nextjs", language: "typescript" },
  { id: "p_api", name: "Payments API", framework: "fastify", language: "typescript" },
];

describe("suggestProjects", () => {
  it("never recommends the project the call already fell back to", () => {
    // Recommending what you just did is noise, and it is the whole reason the
    // exclusion is passed in rather than special-cased on the name "Default".
    const out = suggestProjects(PROJECTS, { language: "typescript" }, {
      excludeProjectId: "p_default",
    });
    expect(out.map((s) => s.projectId)).not.toContain("p_default");
  });

  it("ranks a framework+language match above a language-only match", () => {
    const out = suggestProjects(PROJECTS, {
      framework: "nextjs",
      language: "typescript",
    }, { excludeProjectId: "p_default" });
    expect(out[0]?.projectId).toBe("p_eb");
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });

  it("treats a name appearing in the task text as the strongest signal", () => {
    // A caller who names the project in the prompt has already told you the
    // answer — they just did not put it in the parameter.
    const out = suggestProjects(PROJECTS, {
      text: "audit the docs for the External Brain repo",
    }, { excludeProjectId: "p_default" });
    expect(out[0]?.projectId).toBe("p_eb");
    expect(out[0]!.score).toBeGreaterThanOrEqual(SUGGESTION_THRESHOLD);
  });

  it("does NOT let language alone clear the threshold", () => {
    // "typescript" matches most projects here and distinguishes nothing.
    // A confident suggestion from a non-distinguishing signal is how you
    // train a caller to stop reading suggestions.
    const out = suggestProjects(PROJECTS, { language: "typescript" }, {
      excludeProjectId: "p_default",
    });
    expect(out[0]!.score).toBeLessThan(SUGGESTION_THRESHOLD);
  });

  it("never matches the name 'Default' on the word 'default' in prose", () => {
    const out = suggestProjects(PROJECTS, {
      text: "the default fallback picks the oldest project",
    });
    expect(out.find((s) => s.projectId === "p_default")!.score).toBe(0);
  });

  it("requires a word boundary, so a short name can't match inside a word", () => {
    const out = suggestProjects(
      [{ id: "p_api", name: "API", framework: null, language: null }],
      { text: "a rapid change to the therapy module" },
    );
    expect(out[0]!.score).toBe(0);
  });

  it("ignores a name shorter than 3 chars entirely", () => {
    const out = suggestProjects(
      [{ id: "p_x", name: "eb", framework: null, language: null }],
      { text: "eb eb eb" },
    );
    expect(out[0]!.score).toBe(0);
  });

  it("is deterministic — ties break by name, not by input order", () => {
    // The `[0]` fallback resolved differently between consecutive calls until
    // getUserProjects was given an explicit order; a ranker that reorders ties
    // arbitrarily would reintroduce exactly that.
    const a = suggestProjects(PROJECTS, {}, {});
    const b = suggestProjects([...PROJECTS].reverse(), {}, {});
    expect(a.map((s) => s.name)).toEqual(b.map((s) => s.name));
  });

  it("returns a why for every candidate, including non-matches", () => {
    for (const s of suggestProjects(PROJECTS, { framework: "nextjs" }, {})) {
      expect(s.why).toBeTruthy();
    }
  });

  it("survives a user with no other projects", () => {
    expect(
      suggestProjects([{ id: "p_default", name: "Default" }], {}, {
        excludeProjectId: "p_default",
      }),
    ).toEqual([]);
  });
});

describe("fallbackHint", () => {
  it("names the candidate projects — the old hint named none", () => {
    // An agent cannot pass a projectName it was never shown.
    const hint = fallbackHint(
      "Default",
      suggestProjects(PROJECTS, {}, { excludeProjectId: "p_default" }),
    );
    expect(hint).toContain("External Brain");
    expect(hint).toContain("Payments API");
  });

  it("recommends one project when a signal clears the threshold", () => {
    const hint = fallbackHint(
      "Default",
      suggestProjects(
        PROJECTS,
        { text: "docs audit for External Brain", framework: "nextjs" },
        { excludeProjectId: "p_default" },
      ),
    );
    expect(hint).toContain('projectName: "External Brain"');
    expect(hint).toMatch(/matches .*name appears/);
  });

  it("only LISTS when nothing clears the threshold — no false confidence", () => {
    const hint = fallbackHint(
      "Default",
      suggestProjects(PROJECTS, { language: "typescript" }, {
        excludeProjectId: "p_default",
      }),
    );
    expect(hint).not.toContain("This looks like it belongs in");
    expect(hint).toContain("pass projectName on the call");
  });

  it("still says scoping is per-call, which is the actual trap", () => {
    const hint = fallbackHint("Default", []);
    expect(hint).toMatch(/NOT inherited from brain_start_session/);
  });

  it("degrades to the plain hint for a user with one project", () => {
    expect(fallbackHint("Default", [])).toContain('Filed under "Default"');
  });
});
