/**
 * Run the retrieval benchmark against an exported fixture (2026-07-02).
 *
 * Offline and DB-free: reads a fixture JSON (see export-retrieval-fixture.ts),
 * re-ranks each case by raw cosine and by the production KRA score, and prints
 * mean NDCG@k for both plus the delta.
 *
 *   pnpm --filter @brain/core exec tsx scripts/run-retrieval-benchmark.ts fixture.json
 *
 * NOTE: scripts/ is outside the tsconfig `include` (not typechecked by CI). The
 * math it calls (retrieval-benchmark.ts) IS typechecked and unit-tested.
 */
import { readFileSync } from "node:fs";
import { runBenchmark, type BenchmarkCase } from "../src/retrieval-benchmark.js";

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: run-retrieval-benchmark.ts <fixture.json>");
    process.exit(2);
  }
  const cases = JSON.parse(readFileSync(path, "utf8")) as BenchmarkCase[];
  const k = Number(process.env.BENCHMARK_K ?? 5);
  const r = runBenchmark(cases, { k });

  const pct = (x: number) => x.toFixed(4);
  console.log(`\nRetrieval benchmark — NDCG@${r.k}`);
  console.log(`  cases scored : ${r.n}  (skipped ${r.skipped}: no relevant id in pool)`);
  console.log(`  cosine (base): ${pct(r.cosineNdcg)}`);
  console.log(`  KRA (prod)   : ${pct(r.kraNdcg)}`);
  const sign = r.delta >= 0 ? "+" : "";
  console.log(`  delta        : ${sign}${pct(r.delta)}  (KRA - cosine)\n`);

  if (r.n === 0) {
    console.error("No scorable cases — fixture has no relevant ids in any pool.");
    process.exit(1);
  }
}

main();
