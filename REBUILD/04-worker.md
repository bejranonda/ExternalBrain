# Phase 4 — Worker: `apps/worker`

> **Before starting:** Phase 3 checkpoint must be green (MCP auth invariant verified).
> This is Phase 4 of 6. The worker is the intelligence pipeline — it drains the jobs
> enqueued by the MCP server and runs the nightly maintenance crons.

---

## Agent prompt (copy this verbatim to start Phase 4)

```
Phase 3 is complete (MCP auth invariant passes). Now build Phase 4: apps/worker.

The worker runs pg-boss background jobs: KEA extraction, autoskill proposals,
embeddings backfill, session cleanup, and nightly maintenance (decay, consolidation,
health snapshots).

CRITICAL INVARIANT: pg-boss v12 requires schema version ≥ 25. A DB last touched by
pg-boss v10 will cause boss.start() to fail. Ship a pgboss-version-check.sh script
that must run before the worker starts.

Implement all 9 jobs with their cron schedules. Stop at the Phase 4 checkpoint.

Spec: REBUILD/04-worker.md
```

---

## 4.1 Package setup

```
apps/worker/
  package.json
  src/
    index.ts        — startup, pg-boss init, queue registration, cron schedules
    jobs/
      kea-extract.ts
      autoskill-run.ts
      kea-cross-extract.ts
      session-sweep.ts
      evolution-decay.ts
      evolution-consolidate.ts
      evolution-obsolescence.ts
      evolution-health-snapshot.ts
      embeddings-backfill.ts
```

```json
// apps/worker/package.json
{
  "name": "worker",
  "scripts": {
    "dev":       "tsx watch src/index.ts",
    "start":     "node dist/index.js",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@brain/core":  "workspace:*",
    "@brain/db":    "workspace:*",
    "@brain/types": "workspace:*",
    "pg-boss":      "^12.0.0",
    "zod":          "^4.0.0"
  }
}
```

---

## 4.2 pg-boss startup (`src/index.ts`)

```typescript
import PgBoss from "pg-boss";
import { envForWorker } from "@brain/core";
import { getLogger } from "@brain/core";

const env    = envForWorker();
const logger = getLogger("worker");

async function main() {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: process.env.PG_BOSS_SCHEMA ?? "pgboss",
  });

  await boss.start();
  logger.info("pg-boss started");

  // REQUIRED: explicitly create every queue before registering handlers
  // pg-boss v12 does NOT auto-create queues
  const queues = [
    "kea.extract",
    "autoskill.run",
    "kea.cross_extract",
    "session.sweep_abandoned",
    "evolution.decay",
    "evolution.consolidate",
    "evolution.detect-obsolescence",
    "evolution.health-snapshot",
    "embeddings.backfill",
  ];
  for (const q of queues) {
    await boss.createQueue(q);
  }

  // Register job handlers
  await boss.work("kea.extract",       { teamSize: 2 }, handleKEAExtract);
  await boss.work("autoskill.run",     { teamSize: 2 }, handleAutoskill);
  await boss.work("kea.cross_extract", { teamSize: 1 }, handleCrossExtract);
  await boss.work("session.sweep_abandoned", { teamSize: 1 }, handleSessionSweep);
  await boss.work("evolution.decay",         { teamSize: 1 }, handleDecay);
  await boss.work("evolution.consolidate",   { teamSize: 1 }, handleConsolidate);
  await boss.work("evolution.detect-obsolescence",  { teamSize: 1 }, handleObsolescence);
  await boss.work("evolution.health-snapshot",      { teamSize: 1 }, handleHealthSnapshot);
  await boss.work("embeddings.backfill", { teamSize: 1 }, handleEmbeddingsBackfill);

  // Cron schedules (UTC)
  await boss.schedule("kea.cross_extract",            "0 6 * * *",   {});
  await boss.schedule("session.sweep_abandoned",       "0 7 * * *",   {});
  await boss.schedule("evolution.decay",               "0 2 * * *",   {});
  await boss.schedule("evolution.consolidate",         "0 3 * * *",   {});
  await boss.schedule("evolution.detect-obsolescence", "0 4 * * 0",   {}); // Sunday
  await boss.schedule("evolution.health-snapshot",     "0 5 * * 0",   {}); // Sunday
  await boss.schedule("embeddings.backfill",           "*/10 * * * *", {});

  logger.info("All jobs registered and crons scheduled");

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received — stopping pg-boss gracefully");
    await boss.stop({ graceful: true });
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Worker startup failed:", err);
  process.exit(1);
});
```

---

## 4.3 Job definitions

### Job payloads (zod schemas — validate at handler boundary)

```typescript
const KEAExtractPayload   = z.object({ sessionId: z.string(), userId: z.string() });
const AutoskillPayload    = z.object({ sessionId: z.string(), userId: z.string() });
const EmptyPayload        = z.object({});
```

### Job table

| Job name | Trigger | Retry | Expire | Singleton key |
|----------|---------|-------|--------|---------------|
| `kea.extract` | Session close (enqueued by MCP) | 3 / exponential backoff | 600s | `kea.extract:<sessionId>` |
| `autoskill.run` | Session close (enqueued by MCP) | 3 / exponential backoff | 600s | `autoskill.run:<sessionId>` |
| `kea.cross_extract` | Cron `0 6 * * *` | 1 | 3600s | (singleton via schedule) |
| `session.sweep_abandoned` | Cron `0 7 * * *` | 1 | 600s | — |
| `evolution.decay` | Cron `0 2 * * *` | 2 / backoff | 1800s | — |
| `evolution.consolidate` | Cron `0 3 * * *` | 2 / backoff | 1800s | — |
| `evolution.detect-obsolescence` | Cron `0 4 * * 0` | 2 | 1800s | — |
| `evolution.health-snapshot` | Cron `0 5 * * 0` | 1 | 600s | — |
| `embeddings.backfill` | Cron `*/10 * * * *` | 1 | 600s | (singleton via schedule) |

---

## 4.4 Job handlers

### `kea-extract.ts`

```typescript
export async function handleKEAExtract(job: Job) {
  const { sessionId, userId } = KEAExtractPayload.parse(job.data);

  try {
    const result = await extractFromSession({ sessionId, userId });
    logger.info({ sessionId, ...result }, "kea.extract complete");
  } catch (err) {
    // Prisma P2025 = record not found (session was deleted) — treat as terminal success
    if (isPrismaNotFound(err)) {
      logger.warn({ sessionId }, "session not found — skipping kea.extract");
      return; // do not throw; pg-boss will not retry
    }
    throw err; // re-throw for pg-boss retry
  }
}

function isPrismaNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code: string }).code === "P2025"
  );
}
```

### `autoskill-run.ts`

```typescript
export async function handleAutoskill(job: Job) {
  const { sessionId, userId } = AutoskillPayload.parse(job.data);
  await runForSession(sessionId, userId);
}
```

### `kea-cross-extract.ts`

```typescript
export async function handleCrossExtract(_job: Job) {
  const windowSize = Number(process.env.CROSS_SESSION_WINDOW ?? 20);
  await runCrossExtractDaily({ windowSize });
}
```

### `session-sweep.ts`

Close sessions that have been open for >24h without an outcome:

```typescript
export async function handleSessionSweep(_job: Job) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await db.session.updateMany({
    where: {
      endedAt:  null,
      startedAt: { lt: cutoff },
    },
    data: {
      endedAt: new Date(),
      outcome: "failed",
      metadata: { abandoned: true },
    },
  });
  logger.info({ count: result.count }, "session.sweep_abandoned complete");
}
```

### `evolution-decay.ts`

```typescript
export async function handleDecay(_job: Job) {
  const result = await decayUnused();
  logger.info(result, "evolution.decay complete");
}
```

### `evolution-consolidate.ts`

```typescript
export async function handleConsolidate(_job: Job) {
  const result = await consolidateDuplicates();
  logger.info(result, "evolution.consolidate complete");
}
```

### `evolution-obsolescence.ts`

```typescript
export async function handleObsolescence(_job: Job) {
  await detectObsolescence();
}
```

### `evolution-health-snapshot.ts`

```typescript
export async function handleHealthSnapshot(_job: Job) {
  await snapshotKnowledgeHealth();
}
```

### `embeddings-backfill.ts`

```typescript
export async function handleEmbeddingsBackfill(_job: Job) {
  const BATCH_SIZE = 32;
  const MAX_PER_RUN = 256;
  let processed = 0;

  while (processed < MAX_PER_RUN) {
    // Fetch next batch of Knowledge rows with NULL embeddings
    const batch = await db.$queryRaw<Array<{ id: string; triggerText: string; ruleText: string }>>`
      SELECT id, "triggerText", "ruleText"
      FROM "Knowledge"
      WHERE embedding IS NULL
        AND "deletedAt" IS NULL
      ORDER BY "createdAt" ASC
      LIMIT ${BATCH_SIZE}
    `;

    if (batch.length === 0) break;

    // Embed in batch
    const texts = batch.map((r) => `${r.triggerText}\n${r.ruleText}`);
    const vectors = await embedBatch(texts);

    // Update each row
    for (let i = 0; i < batch.length; i++) {
      const vec = toVector(vectors[i]);
      await db.$executeRaw`
        UPDATE "Knowledge"
        SET embedding = ${vec}::vector
        WHERE id = ${batch[i].id}
      `;
    }

    // Also backfill Skills
    const skillBatch = await db.$queryRaw<Array<{ id: string; title: string; content: string }>>`
      SELECT id, title, content
      FROM "Skill"
      WHERE embedding IS NULL
      ORDER BY "createdAt" ASC
      LIMIT ${BATCH_SIZE}
    `;

    if (skillBatch.length > 0) {
      const skillTexts = skillBatch.map((s) => `${s.title}\n${s.content.slice(0, 500)}`);
      const skillVectors = await embedBatch(skillTexts);
      for (let i = 0; i < skillBatch.length; i++) {
        const vec = toVector(skillVectors[i]);
        await db.$executeRaw`
          UPDATE "Skill" SET embedding = ${vec}::vector WHERE id = ${skillBatch[i].id}
        `;
      }
    }

    processed += batch.length;
  }

  logger.info({ processed }, "embeddings.backfill complete");
}
```

---

## 4.5 pg-boss version check script

Create `scripts/pgboss-version-check.sh`:

```bash
#!/usr/bin/env bash
# Verify the pgboss schema version meets the v12 minimum (schema version 25)
# Run this BEFORE starting the worker

set -euo pipefail

SCHEMA="${PG_BOSS_SCHEMA:-pgboss}"

if ! command -v psql &>/dev/null; then
  echo "pgboss-version-check: psql not found, skipping version check"
  exit 0
fi

VERSION=$(psql "$DATABASE_URL" -tAc \
  "SELECT version FROM \"${SCHEMA}\".version ORDER BY version DESC LIMIT 1" 2>/dev/null || echo "0")

MINIMUM=25

if [ "${VERSION:-0}" -lt "$MINIMUM" ]; then
  echo "ERROR: pgboss schema version $VERSION is below minimum $MINIMUM."
  echo "  This usually means the database was last used with pg-boss v10 or earlier."
  echo "  Action required: run the pg-boss migration manually or reset the pgboss schema."
  exit 1
fi

echo "pgboss-version-check: schema version $VERSION >= $MINIMUM — OK"
```

Add to worker's Dockerfile / entrypoint: run this before starting the worker process.

---

## 4.6 Sentry integration (optional)

```typescript
// In src/index.ts, before main()
if (process.env.SENTRY_DSN) {
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
}
```

---

## Phase 4 checkpoint

Run these with a real pgvector Postgres and the worker started:

```bash
# Start the full stack (db + mcp + worker)
# Then run a session through the MCP server and watch the worker drain it

# 1. Typecheck
pnpm turbo run typecheck --filter=worker

# 2. Start worker (separate terminal)
pnpm --filter=worker dev

# 3. Via the MCP server, open and close a session with learnings
# brain_start_session → brain_report_session_outcome (with 1 learning)

# 4. Verify kea.extract drained
psql $DATABASE_URL -c "
  SELECT id, name, completedon
  FROM pgboss.job
  WHERE name = 'kea.extract'
  ORDER BY createdon DESC LIMIT 3;
"
# Expected: at least 1 row with completedon set

# 5. Verify Knowledge row was created
psql $DATABASE_URL -c "
  SELECT id, type, \"triggerText\", confidence
  FROM \"Knowledge\"
  WHERE 'seed' != ANY(tags)
  ORDER BY \"createdAt\" DESC LIMIT 3;
"

# 6. Verify embeddings backfill fills NULL vectors
# Manually set one embedding to NULL, wait 10 minutes, check it's filled
psql $DATABASE_URL -c "
  UPDATE \"Knowledge\" SET embedding = NULL WHERE id = 'seed-k-01';
"
# Wait for next cron tick or trigger manually:
# psql $DATABASE_URL -c "INSERT INTO pgboss.job(name,data) VALUES('embeddings.backfill','{}'::jsonb)"
# Then check:
psql $DATABASE_URL -c "SELECT id, embedding IS NOT NULL as has_embedding FROM \"Knowledge\" WHERE id = 'seed-k-01';"
# Expected: has_embedding = true

# 7. Verify pg-boss version check
scripts/pgboss-version-check.sh
# Expected: "schema version N >= 25 — OK"
```

**Pass criteria:**
- [ ] `typecheck` exits 0
- [ ] `kea.extract` job drains after a session close (completedon is set)
- [ ] At least one `Knowledge` row is created by KEA after a session with learnings
- [ ] `embeddings.backfill` fills NULL embedding columns within one cron tick (10 min)
- [ ] `pgboss-version-check.sh` exits 0 on a fresh DB
- [ ] Worker shuts down cleanly on `SIGTERM` (pg-boss graceful stop)
- [ ] Prisma `P2025` error on a deleted session does NOT cause job retry

**Do not start Phase 5 until all boxes are checked.**

---

## Ready for Phase 5

Open `05-web-app.md`.
