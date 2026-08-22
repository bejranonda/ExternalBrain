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
import { embedBatchWithProvenance, activeEmbeddingModel } from "@brain/core/embedding";
import { skillEmbeddingText } from "@brain/core/skill-text";

interface Row {
  id: string;
  triggerText: string;
  ruleText: string;
  /** True when the row already had a vector — i.e. this is a re-embed, not a fill. */
  hadVector: boolean;
}

const BATCH_SIZE = 32;

interface SkillRow {
  id: string;
  title: string;
  content: string;
  hadVector: boolean;
}

/**
 * Backfill Skill vectors.
 *
 * Skills went unembedded entirely until 2026-08-22: autoskill created them,
 * `brain_find_skill` filtered on `embedding IS NOT NULL`, and nothing ever
 * wrote one — so semantic skill search could not return a result no matter
 * how many skills existed. Embedding text comes from the shared
 * `skillEmbeddingText()` so this and the create path cannot compose it
 * differently; if they did, every re-embed would silently move the row in
 * vector space.
 */
async function backfillSkills(cap: number): Promise<{ processed: number; reembedded: number }> {
  const model = activeEmbeddingModel();
  let processed = 0;
  let reembedded = 0;

  while (processed < cap) {
    const take = Math.min(BATCH_SIZE, cap - processed);
    const rows = await db.$queryRawUnsafe<SkillRow[]>(
      `
      SELECT id, title, content, ("embedding" IS NOT NULL) AS "hadVector"
      FROM "Skill"
      WHERE embedding IS NULL OR "embeddingModel" IS DISTINCT FROM $1
      ORDER BY (embedding IS NOT NULL), "createdAt" ASC
      LIMIT ${take}
      `,
      model,
    );
    if (rows.length === 0) break;

    const { vectors, model: servedModel } = await embedBatchWithProvenance(
      rows.map((r) => skillEmbeddingText(r)),
    );

    await db.$transaction(
      rows.map((r, i) =>
        db.$executeRawUnsafe(
          `UPDATE "Skill" SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3`,
          toVector(vectors[i]!),
          servedModel,
          r.id,
        ),
      ),
    );

    processed += rows.length;
    reembedded += rows.filter((r) => r.hadVector).length;
  }
  return { processed, reembedded };
}

export async function backfillEmbeddings(opts: { limit?: number } = {}): Promise<{
  processed: number;
  model: string;
  reembedded: number;
  skills: { processed: number; reembedded: number };
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
    // Stamp the model that SERVED this batch, not the configured primary: the
    // chain falls back on transient errors, and marking a fallback-produced
    // vector with the primary's name would exempt it from re-embedding forever.
    const { vectors: vecs, model: servedModel } = await embedBatchWithProvenance(texts);

    await db.$transaction(
      rows.map((r, i) =>
        db.$executeRawUnsafe(
          `UPDATE "Knowledge" SET embedding = $1::vector, "embeddingModel" = $2 WHERE id = $3`,
          toVector(vecs[i]!),
          servedModel,
          r.id,
        ),
      ),
    );

    processed += rows.length;
    reembedded += rows.filter((r) => r.hadVector).length;
  }

  // Skills share the budget rather than getting an unbounded second pass, so
  // one job cannot exceed the caller's limit by doubling it.
  const skills = await backfillSkills(Math.max(0, cap - processed));

  return { processed, model, reembedded, skills };
}

/**
 * How many rows are still on a superseded embedding model.
 *
 * Surfaced so an operator mid-migration can see convergence rather than
 * guessing. Non-zero with a stable count means the backfill is failing.
 *
 * Counts BOTH `Knowledge` and `Skill`. Skills were added to the embedding
 * pipeline on 2026-08-22; this function was widened in the same change,
 * because the alternative — backfilling skills while counting only knowledge —
 * makes `remaining: 0` assert a convergence it never checked, which is exactly
 * the false confidence this counter exists to prevent.
 */
export async function staleEmbeddingCount(): Promise<number> {
  const model = activeEmbeddingModel();
  const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
    `
    SELECT
      (SELECT count(*) FROM "Knowledge"
        WHERE "deletedAt" IS NULL
          AND (embedding IS NULL OR "embeddingModel" IS DISTINCT FROM $1))
      +
      (SELECT count(*) FROM "Skill"
        WHERE embedding IS NULL OR "embeddingModel" IS DISTINCT FROM $1)
      AS n
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
    .then(async ({ processed, model, reembedded, skills }) => {
      log.info(
        {
          processed,
          reembedded,
          skills,
          model,
          remaining: await staleEmbeddingCount(),
        },
        "backfill-embeddings: done",
      );
    })
    .catch((err) => {
      log.fatal({ err }, "backfill-embeddings failed");
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
