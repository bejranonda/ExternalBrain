/**
 * Grading harness for the generation-uplift benchmark (#126).
 *
 * The task suite's `test.spec.ts` files are written against vitest (matching
 * every other test in this repo). This checkout has no local pnpm/vitest
 * (documented limitation — Node 18, no node_modules), and the deployed
 * worker container has `tsx` + Node 20 but not vitest either. Rather than
 * install a new dependency mid-benchmark, this script re-implements the
 * SAME assertions each `test.spec.ts` makes, using only `node:assert` and
 * real timers (short waits) in place of vitest's fake-timer API — the
 * behavior under test is identical; only the mechanics of waiting for a
 * timer to fire differ. Anyone with a working pnpm install can also just
 * run the committed `test.spec.ts` files directly against each arm's
 * `solution.ts` with real vitest; this script exists so the benchmark could
 * actually run in this constrained environment.
 *
 * Run with: tsx grade.ts
 */
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type CaseResult = { name: string; pass: boolean; error?: string };

async function loadSolution(taskDir: string, arm: "control" | "treatment") {
  const p = path.join(taskDir, arm, "solution.ts");
  return import(pathToFileURL(p).href);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCase(name: string, fn: () => void | Promise<void>): Promise<CaseResult> {
  try {
    await fn();
    return { name, pass: true };
  } catch (err) {
    return { name, pass: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- Task 1: debounce ------------------------------------------------
async function gradeDebounce(taskDir: string, arm: "control" | "treatment") {
  const mod = await loadSolution(taskDir, arm);
  const cases: CaseResult[] = [];

  cases.push(
    await runCase("only invokes fn once, with the latest args, after the wait", async () => {
      const calls: unknown[][] = [];
      const debounced = mod.debounce((...args: unknown[]) => calls.push(args), 30);
      debounced("a");
      await sleep(10);
      debounced("b");
      await sleep(10);
      debounced("c");
      await sleep(60);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], ["c"]);
    }),
  );

  cases.push(
    await runCase("exposes a cancel() that clears the pending invocation", async () => {
      let called = false;
      const debounced = mod.debounce(() => {
        called = true;
      }, 30) as ((...a: unknown[]) => void) & { cancel?: () => void };
      debounced();
      assert.equal(typeof debounced.cancel, "function");
      debounced.cancel?.();
      await sleep(60);
      assert.equal(called, false);
    }),
  );

  return cases;
}

// ---- Task 2: parseCsvLine --------------------------------------------
async function gradeParseCsvLine(taskDir: string, arm: "control" | "treatment") {
  const mod = await loadSolution(taskDir, arm);
  const cases: CaseResult[] = [];

  cases.push(
    await runCase("splits plain unquoted fields on commas", () => {
      assert.deepEqual(mod.parseCsvLine("a,b,c"), ["a", "b", "c"]);
    }),
  );
  cases.push(
    await runCase("keeps commas inside quoted fields intact", () => {
      assert.deepEqual(mod.parseCsvLine('a,"b,c",d'), ["a", "b,c", "d"]);
    }),
  );
  cases.push(
    await runCase("unescapes a doubled double-quote to one literal quote", () => {
      assert.deepEqual(mod.parseCsvLine('a,"she said ""hi""",c'), [
        "a",
        'she said "hi"',
        "c",
      ]);
    }),
  );

  return cases;
}

// ---- Task 3: retryWithBackoff ----------------------------------------
class MyError extends Error {}

async function gradeRetryWithBackoff(taskDir: string, arm: "control" | "treatment") {
  const mod = await loadSolution(taskDir, arm);
  const cases: CaseResult[] = [];

  cases.push(
    await runCase("returns immediately if fn resolves on the first try", async () => {
      let calls = 0;
      const result = await mod.retryWithBackoff(
        async () => {
          calls += 1;
          return "ok";
        },
        { maxAttempts: 3, baseDelayMs: 1 },
      );
      assert.equal(result, "ok");
      assert.equal(calls, 1);
    }),
  );

  cases.push(
    await runCase("eventually resolves after some failures", async () => {
      let calls = 0;
      const result = await mod.retryWithBackoff(
        async () => {
          calls += 1;
          if (calls < 3) throw new MyError("transient");
          return "recovered";
        },
        { maxAttempts: 5, baseDelayMs: 1 },
      );
      assert.equal(result, "recovered");
      assert.equal(calls, 3);
    }),
  );

  cases.push(
    await runCase("rejects with the ORIGINAL error after exhausting all attempts", async () => {
      const original = new MyError("boom");
      let calls = 0;
      await assert.rejects(
        mod.retryWithBackoff(
          async () => {
            calls += 1;
            throw original;
          },
          { maxAttempts: 3, baseDelayMs: 1 },
        ),
        (err: unknown) => err === original,
      );
      assert.equal(calls, 3);
    }),
  );

  return cases;
}

// ---- Task 4: LRUCache --------------------------------------------------
async function gradeLruCache(taskDir: string, arm: "control" | "treatment") {
  const mod = await loadSolution(taskDir, arm);
  const cases: CaseResult[] = [];

  cases.push(
    await runCase("stores and retrieves values", () => {
      const cache = new mod.LRUCache(2);
      cache.set("a", 1);
      assert.equal(cache.get("a"), 1);
      assert.equal(cache.get("missing"), undefined);
    }),
  );

  cases.push(
    await runCase("evicts the least-recently-used entry when over capacity", () => {
      const cache = new mod.LRUCache(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.set("c", 3);
      assert.equal(cache.get("a"), undefined);
      assert.equal(cache.get("b"), 2);
      assert.equal(cache.get("c"), 3);
    }),
  );

  cases.push(
    await runCase("get() refreshes recency, protecting a key from eviction", () => {
      const cache = new mod.LRUCache(2);
      cache.set("a", 1);
      cache.set("b", 2);
      cache.get("a");
      cache.set("c", 3);
      assert.equal(cache.get("a"), 1);
      assert.equal(cache.get("b"), undefined);
      assert.equal(cache.get("c"), 3);
    }),
  );

  return cases;
}

// ---- Task 5: safeJsonParse ---------------------------------------------
async function gradeSafeJsonParse(taskDir: string, arm: "control" | "treatment") {
  const mod = await loadSolution(taskDir, arm);
  const cases: CaseResult[] = [];

  cases.push(
    await runCase("parses a valid JSON string", () => {
      assert.deepEqual(mod.safeJsonParse('{"a":1}', null), { a: 1 });
    }),
  );
  cases.push(
    await runCase("returns the fallback for malformed JSON", () => {
      assert.equal(mod.safeJsonParse("{not json", "fallback"), "fallback");
    }),
  );
  cases.push(
    await runCase("returns the fallback for non-string input without coercing it", () => {
      assert.equal(mod.safeJsonParse(42, "fallback"), "fallback");
      assert.equal(mod.safeJsonParse(null, "fallback"), "fallback");
      assert.equal(mod.safeJsonParse(undefined, "fallback"), "fallback");
    }),
  );

  return cases;
}

// ---- Task 6: formatBytes -----------------------------------------------
async function gradeFormatBytes(taskDir: string, arm: "control" | "treatment") {
  const mod = await loadSolution(taskDir, arm);
  const cases: CaseResult[] = [];

  cases.push(
    await runCase("formats zero and unit boundaries in base 1024", () => {
      assert.equal(mod.formatBytes(0), "0 B");
      assert.equal(mod.formatBytes(1024), "1 KB");
      assert.equal(mod.formatBytes(1048576), "1 MB");
    }),
  );
  cases.push(
    await runCase("throws RangeError for negative input", () => {
      assert.throws(() => mod.formatBytes(-1), RangeError);
    }),
  );

  return cases;
}

// ---- Runner -------------------------------------------------------------
const TASKS: Array<{
  dir: string;
  grade: (taskDir: string, arm: "control" | "treatment") => Promise<CaseResult[]>;
}> = [
  { dir: "1-debounce", grade: gradeDebounce },
  { dir: "2-parse-csv-line", grade: gradeParseCsvLine },
  { dir: "3-retry-with-backoff", grade: gradeRetryWithBackoff },
  { dir: "4-lru-cache", grade: gradeLruCache },
  { dir: "5-safe-json-parse", grade: gradeSafeJsonParse },
  { dir: "6-format-bytes", grade: gradeFormatBytes },
];

async function main() {
  const root = path.join(__dirname, "..", "tasks");
  const summary: Array<{ task: string; arm: string; pass: boolean; cases: CaseResult[] }> = [];

  for (const task of TASKS) {
    for (const arm of ["control", "treatment"] as const) {
      const taskDir = path.join(root, task.dir);
      const cases = await task.grade(taskDir, arm);
      const pass = cases.every((c) => c.pass);
      summary.push({ task: task.dir, arm, pass, cases });
      console.log(`\n${task.dir} / ${arm}: ${pass ? "PASS" : "FAIL"}`);
      for (const c of cases) {
        console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}${c.error ? ` -- ${c.error}` : ""}`);
      }
    }
  }

  console.log("\n=== Summary ===");
  const controlPass = summary.filter((s) => s.arm === "control" && s.pass).length;
  const treatmentPass = summary.filter((s) => s.arm === "treatment" && s.pass).length;
  console.log(`control:   ${controlPass}/${TASKS.length}`);
  console.log(`treatment: ${treatmentPass}/${TASKS.length}`);
  console.log("\n" + JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
