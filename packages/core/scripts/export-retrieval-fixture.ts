/**
 * Export a retrieval-benchmark fixture from live telemetry (2026-07-02).
 *
 * The honesty problem the previous benchmarks had was an author-written
 * fixture (see docs/VALIDATION.md). This script sidesteps that: the relevance
 * label is not an opinion, it is the platform's own usage signal —
 * knowledge that was *injected* into a session that then *succeeded*.
 *
 * For each such session it captures the real candidate pool (kra.ts
 * `candidatesForPrompt`), so the offline harness re-ranks the exact set
 * production would have ranked.
 *
 *   pnpm --filter @brain/core exec tsx scripts/export-retrieval-fixture.ts > fixture.json
 *
 * NOTE: scripts/ is outside the tsconfig `include`, so this is NOT typechecked
 * by CI and should be reviewed before trusting it. Prompts are REAL USER TEXT —
 * anonymize the output, or restrict `WHERE` to a non-client org, before
 * publishing any fixture derived from a live host.
 */
import { db } from "@brain/db";
import { candidatesForPrompt } from "../src/kra.js";
import type { BenchmarkCase } from "../src/retrieval-benchmark.js";

const POOL_SIZE = Number(process.env.BENCHMARK_POOL_SIZE ?? 20);

async function main(): Promise<void> {
  // injected-into-a-session-that-succeeded == the weak relevance label.
  const apps = await db.sessionKnowledgeApplication.findMany({
    where: { role: "injected", session: { outcome: "success" } },
    select: {
      sessionId: true,
      knowledgeId: true,
      session: {
        select: { metadata: true, userId: true, projectId: true },
      },
    },
  });

  // Group by session: one query, its relevant knowledge ids.
  const bySession = new Map<
    string,
    { query: string; userId: string; projectId: string | null; relevant: string[] }
  >();
  for (const a of apps) {
    const meta = a.session.metadata as { prompt?: string } | null;
    const query = meta?.prompt?.trim();
    if (!query) continue; // no stored prompt -> unusable
    const row = bySession.get(a.sessionId) ?? {
      query,
      userId: a.session.userId,
      projectId: a.session.projectId,
      relevant: [],
    };
    row.relevant.push(a.knowledgeId);
    bySession.set(a.sessionId, row);
  }

  const cases: BenchmarkCase[] = [];
  for (const [, row] of bySession) {
    const context = {
      sessionId: "benchmark",
      userId: row.userId,
      projectId: row.projectId ?? undefined,
      dataScope: "all" as const,
    };
    const candidates = await candidatesForPrompt(row.query, context, POOL_SIZE);
    cases.push({
      query: row.query, // anonymize before publishing
      context,
      relevant: row.relevant,
      candidates,
    });
  }

  process.stdout.write(JSON.stringify(cases, null, 2) + "\n");
  process.stderr.write(
    `[export-fixture] ${cases.length} cases from ${bySession.size} sessions\n`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
