import { describe, it, expect } from "vitest";
import { formatForInjection } from "../formatter.js";
import { DECISION_TAG } from "../learnings.js";
import type { Knowledge, KnowledgeBundle } from "@brain/types";

function k(partial: Partial<Knowledge> = {}): Knowledge {
  const base: Knowledge = {
    id: "k1",
    type: "principle",
    scope: "project",
    ownerUserId: "u1",
    ownerTeamId: null,
    ownerProjectId: "p1",
    triggerText: "t",
    ruleText: "use Postgres",
    rationale: null,
    symbolicWhen: null,
    symbolicThen: null,
    instead: "Mongo",
    framework: null,
    language: null,
    tags: [],
    confidence: 1,
    successCount: 0,
    failureCount: 0,
    usageCount: 0,
    decayScore: 1,
    createdAt: new Date(0),
    confirmedAt: null,
    lastUsedAt: null,
    extractedBy: "user",
    sourceSessionIds: [],
    parentKnowledgeId: null,
  };
  return { ...base, ...partial };
}

const empty: KnowledgeBundle = {
  reflexes: [],
  recipes: [],
  heuristics: [],
  principles: [],
  antiPrinciples: [],
  injectedIds: [],
};

describe("formatForInjection — decisions section", () => {
  it("renders decision-tagged rows under a Decisions heading, not Coding Principles", () => {
    const bundle: KnowledgeBundle = {
      ...empty,
      principles: [
        k({ id: "d1", ruleText: "use Postgres", tags: [DECISION_TAG] }),
        k({ id: "p1", ruleText: "prefer pure functions", tags: [] }),
      ],
    };
    const out = formatForInjection(bundle);
    expect(out).toContain("## Decisions in this project");
    const decisionsIdx = out.indexOf("## Decisions in this project");
    const principlesIdx = out.indexOf("### Your Coding Principles");
    expect(decisionsIdx).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("use Postgres")).toBeGreaterThan(decisionsIdx);
    if (principlesIdx >= 0) {
      expect(out.indexOf("prefer pure functions")).toBeGreaterThan(principlesIdx);
    }
  });

  it("omits the decisions section when there are none", () => {
    const out = formatForInjection({ ...empty, principles: [k({ tags: [] })] });
    expect(out).not.toContain("## Decisions in this project");
  });

  it("a decision authored by one user renders for any consumer of the project bundle", () => {
    // KRA's scope filter (scope-filter tests) already guarantees a project-scoped
    // row reaches every project member; here we prove the formatter surfaces it
    // regardless of which user authored it.
    const bundle: KnowledgeBundle = {
      ...empty,
      principles: [
        k({ id: "d1", ownerUserId: "AUTHOR", ruleText: "deploy via scripts/deploy.sh", tags: [DECISION_TAG] }),
      ],
    };
    const out = formatForInjection(bundle);
    expect(out).toContain("## Decisions in this project");
    expect(out).toContain("deploy via scripts/deploy.sh");
  });
});
