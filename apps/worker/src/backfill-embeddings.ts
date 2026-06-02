/**
 * Embedding backfill — compute embeddings for Knowledge rows where
 * `embedding IS NULL`. Safe to re-run; idempotent.
 *
 * Usage:
 *   pnpm --filter @brain/worker backfill:embeddings
 *   pnpm --filter @brain/worker backfill:embeddings -- --limit 100
 *
 * Also invoked by the worker on the `embeddings.backfill` schedule.
 */
import { db, toVector } from "@brain/db";
import { embedBatch } from "@brain/core/embedding";

interface Row {
  id: string;
  triggerText: string;
  ruleText: string;
}

const BATCH_SIZE = 32;

export async function backfillEmbeddings(opts: { limit?: number } = {}): Promise<{
  processed: number;
}> {
  const cap = opts.limit ?? 10_000;
  let processed = 0;

  while (processed < cap) {
    const take = Math.min(BATCH_SIZE, cap - processed);
    const rows = await db.$queryRawUnsafe<Row[]>(
      `
      SELECT id, "triggerText", "ruleText"
      FROM "Knowledge"
      WHERE embedding IS NULL
        AND "deletedAt" IS NULL
      ORDER BY "createdAt" ASC
      LIMIT ${take}
      `,
    );
    if (rows.length === 0) break;

    const texts = rows.map((r) => `${r.triggerText}\n${r.ruleText}`);
    const vecs = await embedBatch(texts);

    await db.$transaction(
      rows.map((r, i) =>
        db.$executeRawUnsafe(
          `UPDATE "Knowledge" SET embedding = $1::vector WHERE id = $2`,
          toVector(vecs[i]!),
          r.id,
        ),
      ),
    );

    processed += rows.length;
  }

  return { processed };
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
    .then(({ processed }) => {
      log.info({ processed }, "backfill-embeddings: done");
    })
    .catch((err) => {
      log.fatal({ err }, "backfill-embeddings failed");
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
