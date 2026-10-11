/**
 * Every worker queue that calls an LLM must honour its operator kill-switch.
 *
 * `docs/PRIVACY.md` tells operators that KEA_ENABLED=false / AUTOSKILL_ENABLED
 * =false stop those paths sending session content to a model. Until 2026-10-11
 * the switches were parsed by `envForWorker()` and asserted by env.test.ts —
 * and read by nothing else, so the promise was false (KNOWN_ISSUES §0ay). An
 * env test proves the value parses; only a check at the call site proves it
 * gates anything.
 *
 * Lives in core for the same reason as worker-concurrency.test.ts: the worker
 * package has no test runner, so a spec there would never execute.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(__dirname, "..", "..", "..", "..", "apps", "worker", "src", "index.ts"),
  "utf8",
);
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The body of the `boss.work("<queue>", …)` registration, up to the next one. */
function handlerBody(queue: string): string {
  const reg = new RegExp(`boss\\.work(?:<[^>]*>)?\\(\\s*"${queue.replace(".", "\\.")}"`).exec(code);
  expect(reg, `no boss.work registration for ${queue}`).not.toBeNull();
  const start = reg!.index;
  const next = code.indexOf("boss.work", start + 1);
  return code.slice(start, next === -1 ? undefined : next);
}

const GATED: Array<[queue: string, flag: string]> = [
  ["kea.extract", "KEA_ENABLED"],
  ["kea.cross_extract", "KEA_ENABLED"],
  ["autoskill.run", "AUTOSKILL_ENABLED"],
];

describe("worker LLM kill-switches", () => {
  it.each(GATED)("%s returns early when %s is false", (queue, flag) => {
    const body = handlerBody(queue);
    const gate = body.indexOf(`!env.${flag}`);
    expect(gate, `${queue} never reads env.${flag}`).toBeGreaterThan(-1);
    // The gate must come before the work, or it is a report, not a switch.
    const work = queue === "autoskill.run"
      ? body.indexOf("runForSession")
      : queue === "kea.cross_extract"
        ? body.indexOf("runCrossExtractDaily")
        : body.indexOf("extractFromSession");
    expect(work, `${queue} handler no longer calls its LLM entry point`).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(work);
  });
});
