/**
 * The worker must stay at pg-boss's default concurrency of one job at a time.
 *
 * Not a style preference. Prod runs on the GLM Coding Plan, whose lower tiers
 * cap concurrent requests at one — a settled operator decision as of
 * 2026-08-22 (KNOWN_ISSUES §0aq). The pg-boss default and that cap match BY
 * ACCIDENT, so adding `teamSize` to "speed up extraction" buys queued 429s
 * rather than throughput, and the symptom (jobs retrying, the Brain learning
 * slowly) points nowhere near the subscription tier.
 *
 * This lives in `@brain/core` rather than `apps/worker` on purpose: the worker
 * package has no `test` script, so a spec placed there would never execute —
 * a gate that guards nothing while looking like it does (§0r). `env-flag.test.ts`
 * already sweeps other packages from here; this follows that precedent.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKER_INDEX = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "worker",
  "src",
  "index.ts",
);

const source = readFileSync(WORKER_INDEX, "utf8");

/** Comments name `teamSize` deliberately; matching them would pass on the docs. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("worker concurrency", () => {
  it("reads the worker source it claims to guard", () => {
    // Guard the guard: a bad path would make every assertion below vacuous.
    expect(source).toMatch(/boss\.work/);
  });

  it("sets no teamSize on any queue — the plan caps concurrency at 1", () => {
    expect(code).not.toMatch(/teamSize/);
  });

  it("keeps the note explaining why, so the next reader has the reason", () => {
    // A bare constraint with no reason gets deleted by whoever finds it
    // inconvenient. The reason is the half that survives.
    expect(source).toMatch(/CONCURRENCY IS DELIBERATELY 1/);
    expect(source).toMatch(/Coding Plan/);
  });
});
