/**
 * Prisma client singleton.
 *
 * Use this across the monorepo:
 *   import { db } from "@brain/db";
 *
 * The singleton protects against the connection-storm that hot-reloaders
 * cause in Next.js dev mode.
 *
 * Build-time stub: when `SKIP_DB_INIT=1`, `db` is an empty object that
 * satisfies the `PrismaClient` type but throws on any access. Used during
 * `next build` page-data collection (Alpine / standalone) — Next imports
 * every route handler to read exported metadata, and on the first
 * `new PrismaClient()` in the Alpine image the engine init fails because
 * the standalone trace doesn't include the generated client path. The
 * build-time stub skips the constructor entirely; runtime containers
 * never set the flag and get a real client.
 */
// Generated client lives under `src/generated/client/` (see
// packages/db/prisma/schema.prisma `output`). Importing from there rather
// than the `@prisma/client` facade avoids pnpm's hardlink-from-store path
// that silently stubs the generated files in Alpine Docker builds.
import { PrismaClient } from "./generated/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
export { Prisma } from "./generated/client/index.js";

const globalForPrisma = globalThis as unknown as {
  __brainPrisma?: PrismaClient;
};

function makeClient(): PrismaClient {
  if (process.env.SKIP_DB_INIT === "1") {
    const handler: ProxyHandler<object> = {
      get() {
        throw new Error(
          "db is unavailable during build (SKIP_DB_INIT=1). If you hit this at runtime, unset SKIP_DB_INIT.",
        );
      },
    };
    return new Proxy({}, handler) as PrismaClient;
  }
  // Prisma 7+: connection is supplied via an adapter, not via
  // `datasource.url` in the schema. The adapter wraps node-postgres so
  // the engine is replaced at the driver layer (also unblocks edge runtimes).
  //
  // We construct the adapter eagerly with whatever DATABASE_URL is present.
  // If it's empty, the underlying pg client will fail on first query —
  // matching the Prisma-5 behaviour (lazy connection failure) so tests
  // that import @brain/db without ever using it still load cleanly.
  const url = process.env.DATABASE_URL ?? "";
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });
}

export const db: PrismaClient = globalForPrisma.__brainPrisma ?? makeClient();

if (process.env.NODE_ENV !== "production" && process.env.SKIP_DB_INIT !== "1") {
  globalForPrisma.__brainPrisma = db;
}

export type * from "./generated/client/index.js";

// ============================================================
// pgvector helpers — Prisma doesn't yet natively support vector()
// ============================================================

/**
 * Format a JS number[] for use in a raw SQL pgvector literal.
 *   const sql = Prisma.sql`SET embedding = ${toVector(v)}::vector`;
 */
export function toVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Run semantic similarity search against Knowledge.embedding.
 * Returns rows with an attached `_similarity` (cosine, 0-1).
 *
 * Prefer this helper over hand-writing raw SQL in callers.
 */
export async function searchKnowledgeByEmbedding(
  embedding: number[],
  opts: {
    ownerUserId?: string;
    scope?: string[];
    framework?: string;
    limit?: number;
    minSimilarity?: number;
  } = {},
) {
  const limit = opts.limit ?? 20;
  const vec = toVector(embedding);

  // pgvector distance `<=>` is cosine distance; similarity = 1 - distance
  const rows = await db.$queryRawUnsafe<
    Array<Record<string, unknown> & { _similarity: number }>
  >(
    `
    SELECT id, type, scope, "ruleText", "triggerText", rationale,
           confidence, "successCount", "failureCount", "usageCount",
           "decayScore", framework, language, tags,
           1 - (embedding <=> $1::vector) AS "_similarity"
    FROM "Knowledge"
    WHERE embedding IS NOT NULL
      AND "deletedAt" IS NULL
      ${opts.ownerUserId ? `AND "ownerUserId" = $2` : ""}
      ${opts.framework ? `AND framework = $3` : ""}
      AND "decayScore" > 0.3
    ORDER BY embedding <=> $1::vector ASC
    LIMIT ${limit}
    `,
    vec,
    opts.ownerUserId,
    opts.framework,
  );

  const minSim = opts.minSimilarity ?? 0.0;
  return rows.filter((r: { _similarity: number }) => r._similarity >= minSim);
}
