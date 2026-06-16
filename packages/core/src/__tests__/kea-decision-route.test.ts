/**
 * Decision routing (spec 2026-06-16 §intake channel 1).
 *
 * In-memory seams (judge/mine/filter/persist via ExtractOpts), same rationale
 * as kea-refine.test.ts: the real filter/persist call embed(), which throws
 * without a provider key in CI.
 */
import { describe, expect, it } from "vitest";
import * as kea from "../kea.js";
import type { Learning } from "../learnings.js";
import type { Knowledge } from "@brain/types";

const decision: Learning = {
  trigger: "choosing the primary datastore for this project",
  rule: "use Postgres + pgvector for the brain, not a separate vector DB",
  rationale: "one datastore, transactional embeddings",
  type: "principle",
  source: "decision",
  confidence: 0.9,
};
const reflex: Learning = {
  trigger: "scaffolding a form in this repo",
  rule: "use react-hook-form with zod resolver, never Formik",
  rationale: "team standard",
  type: "reflex",
  source: "discovery",
  confidence: 0.8,
};

function basePayload(overrides: Partial<kea.KEAInputPayload> = {}): kea.KEAInputPayload {
  return {
    sessionId: "sess-test",
    userId: "user-test",
    projectId: "proj-test",
    prompt: "set up the datastore",
    filesCreated: [],
    filesModified: [],
    buildAttempts: 1,
    errorsEncountered: [],
    finalBuildSuccess: true,
    durationMs: 0,
    tokensUsed: 0,
    ...overrides,
  };
}

function recordingPersist(persistCalls: Array<{ findings: kea.KEAFinding[]; tags: string[] }>) {
  return async (findings: kea.KEAFinding[], _p: kea.KEAInputPayload, tags: string[]) => {
    persistCalls.push({ findings, tags });
    return findings.map(
      (f, i) => ({ id: `mem-${i}`, confidence: f.confidence }) as unknown as Knowledge,
    );
  };
}

describe("decision routing in extractFromSession", () => {
  it("persists decision learnings as project-scoped, decision-tagged, bypassing the judge", async () => {
    const persistCalls: Array<{ findings: kea.KEAFinding[]; tags: string[] }> = [];
    let judgeSaw: Learning[] | null = null;

    const rows = await kea.extractFromSession(
      basePayload({ submittedLearnings: [decision, reflex] }),
      {
        judge: async (ls) => {
          judgeSaw = ls;
          return []; // the non-decision learning produces nothing for this test
        },
        filter: async (findings: kea.KEAFinding[]) => findings,
        persist: recordingPersist(persistCalls),
      },
    );

    // the judge saw only the non-decision learning
    expect(judgeSaw).not.toBeNull();
    expect(judgeSaw!.every((l) => l.source !== "decision")).toBe(true);

    // a persist call carried the decision: project scope + decision tag
    const decisionCall = persistCalls.find((c) => c.tags.includes("decision"));
    expect(decisionCall).toBeTruthy();
    expect(decisionCall!.findings[0]!.scope).toBe("project");
    expect(decisionCall!.findings[0]!.rule).toContain("Postgres");
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("all-decision submissions skip mining entirely but still persist the decision", async () => {
    const persistCalls: Array<{ findings: kea.KEAFinding[]; tags: string[] }> = [];
    let mineCalled = false;
    await kea.extractFromSession(basePayload({ submittedLearnings: [decision] }), {
      judge: async () => [],
      mine: async () => {
        mineCalled = true;
        return [];
      },
      filter: async (findings: kea.KEAFinding[]) => findings,
      persist: recordingPersist(persistCalls),
    });
    expect(mineCalled).toBe(false);
    expect(persistCalls.some((c) => c.tags.includes("decision"))).toBe(true);
  });
});
