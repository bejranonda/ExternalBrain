/**
 * Embedding backfill — compute embeddings for Knowledge rows that have none,
 * OR whose vector was produced by a different embedding model than the one
 * currently configured. Safe to re-run; idempotent.
 *
 * Why the model check matters: vectors from different models are not
 * comparable (measured cosine similarity for the same sentence across
 * gemini-embedding-001 and gemini-embedding-2-preview: -0.024). This job used
 * to select only `embedding IS NULL`, so switching models left every existing
 * row on the old model forever — a silently mixed index where new query
 * vectors score ~0 against all prior knowledge, returning nothing relevant
 * and raising no error. Re-embedding stale rows is what makes an embedding
 * model change a supported operation rather than a data-loss event.
 *
 * Usage:
 *   pnpm --filter @brain/worker backfill:embeddings
 *   pnpm --filter @brain/worker backfill:embeddings -- --limit 100
 *
 * Also invoked by the worker on the `embeddings.backfill` schedule.
 */
import { db, toVector } from "@brain/db";
import { embedBatch, activeEmbeddingModel } from "@brain/core/embedding";

interface Row {
  id: string;
  triggerText: string;
  ruleText: string;
  /** True when the row already had a vector — i.e. this is a re-embed, not a fill. */
  hadVector: boolean;
}

const BATCH_SIZE = 32;

export async function backfillEmbeddings(opts: { limit?: number } = {}): Promise<{
  processed: number;
  model: string;
  reembedded: number;
}> {
  const cap = opts.limit ?? 10_000;
  const model = activeEmbeddingModel();
  let processed = 0;
  let reembedded = 0;

  while (processed < cap) {
    const take = Math.min(BATCH_SIZE, cap - processed);
    // Missing vectors first (a row with no embedding is invisible to
    // retrieval), then rows stranded on a superseded model. `IS DISTINCT
    // FROM` rather than `<>` so pre-column NULLs count as stale.
    const rows = await db.$queryRawUnsafe<Row[]>(
      `
      SELECT id, "triggerText", "ruleText", ("embedding" IS NOT NULL) AS "hadVector"
      FROM "Knowledge"
      WHERE "deletedAt" IS NULL
        AND (embedding IS NULL OR "embeddingModel" IS DISTINCT FROM $1)
      ORDER BY (embedding IS NOT NULL), "createdAt" ASC
      LIMIT ${take}
      `,
      model,
    );
    if (rows.length === 0) break;

    const texts = rows.map((r) => `${r.triggerText}\n${r.ruleText}`);
    const vecs = await embedBatch(texts);

    await db.$transaction(
      rows.map((r, i) =>
        db.$executeRawUnsafe(
          `UPDATE "Knowledge" SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3`,
          toVector(vecs[i]!),
          model,
          r.id,
        ),
      ),
    );

    processed += rows.length;
    reembedded += rows.filter((r) => r.hadVector).length;
  }

  return { processed, model, reembedded };
}

/**
 * How many rows are still on a superseded embedding model.
 *
 * Surfaced so an operator mid-migration can see convergence rather than
 * guessing. Non-zero with a stable count means the backfill is failing.
 *
 * ⚠️ Counts `Knowledge` only. `Skill.embeddingModel` exists for symmetry, but
 * as of 2026-08-18 **nothing writes `Skill.embedding`** — there is no skill
 * embedding path to keep converged, so including skills here would report
 * permanent staleness for rows that are never meant to have vectors. If skill
 * embedding is ever implemented, this function and `backfillEmbeddings` must
 * both be widened in the same change: otherwise `remaining: 0` will claim a
 * convergence it never checked, which is exactly the false-confidence failure
 * this counter exists to prevent.
 */
export async function staleEmbeddingCount(): Promise<number> {
  const model = activeEmbeddingModel();
  const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `
    SELECT count(*) AS n FROM "Knowledge"
    WHERE "deletedAt" IS NULL
      AND (embedding IS NULL OR "embeddingModel" IS DISTINCT FROM $1)
    `,
    model,
  );
  return Number(rows[0]?.n ?? 0);
}

function parseFlag(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const raw = process.argv[i + 1];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const limit = parseFlag("limit");
  const { getLogger } = await import("@brain/core");
  const log = getLogger("worker");
  backfillEmbeddings(limit === undefined ? {} : { limit })
    .then(async ({ processed, model, reembedded }) => {
      log.info(
        { processed, reembedded, model, remaining: await staleEmbeddingCount() },
        "backfill-embeddings: done",
      );
    })
    .catch((err) => {
      log.fatal({ err }, "backfill-embeddings failed");
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
