/**
 * Background worker — runs KEA extraction, autoskill, decay, consolidation.
 *
 * Scheduling via pg-boss. One process handles all job classes; scale
 * horizontally by running additional workers.
 */
import { createServer } from "node:http";
import { PgBoss } from "pg-boss";
import { z } from "zod";
import { kea, autoskill, evolution, envForWorker, getLogger, withRequest, shortId, captureError } from "@brain/core";
import { db } from "@brain/db";
import { backfillEmbeddings } from "./backfill-embeddings.js";

// Audit WK6 (#103): validate job payloads at the worker boundary. The
// MCP tool that enqueues these (apps/mcp-server/src/tools/report.ts)
// validates its own input, but anything else that lands in pgboss.job
// (raw psql insert during incident response, future producers, manual
// re-enqueue) reaches the handler with whatever shape it has. zod
// parse refuses malformed payloads loudly instead of crashing on
// `findUniqueOrThrow` with `undefined`.
const sessionJobSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
});
type SessionJobData = z.infer<typeof sessionJobSchema>;

/**
 * Retry budget for `kea.extract`. Declared once because two places must
 * agree: the queue is CREATED with it, and the handler READS it to decide
 * which attempt is the last — the one on which a failure is durable enough
 * to stamp `extractionStatus = 'failed'` onto the Session. If they drifted,
 * sessions would be marked failed while retries were still pending.
 */
const KEA_RETRY_LIMIT = 3;

/** Name of the terminal queue for jobs that exhausted their retries. */
const DEAD_LETTER_QUEUE = "dlq";

/**
 * Daily per-user ceiling on KEA extractions. `0` disables it.
 *
 * A COUNT, not a dollar figure, and that is deliberate. The retired
 * `MAX_KEA_COST_USD_PER_SESSION` key was unenforceable in principle: KEA is
 * one LLM call chain per session, you do not know its cost until after it
 * runs, and you cannot partially extract — so a per-session dollar cap either
 * never fires or aborts after the money is already spent, yielding no
 * knowledge for it. It could not prevent the spend it named.
 *
 * A *cost*-based daily cap would be the other candidate, but KEA does no
 * token accounting at all today (nothing in kea.ts calls `recordCall`), so
 * that would mean building a whole cost model first. Extractions are roughly
 * constant-cost, so counting them bounds the operator's bill proportionally
 * for none of that work — and a count is the dimension a tier is actually
 * expressed in ("50 extractions/day"), which is what the freemium phase
 * needs. See docs/BLUEPRINT.md §11.1.
 *
 * The counter is free: `Session.extractionAt` landed in v2.9.0 for the
 * FAILED_EXTRACTION work, so today's usage is one indexed count away.
 */
const KEA_DAILY_LIMIT = (() => {
  const raw = process.env.MAX_KEA_EXTRACTIONS_PER_DAY;
  if (raw === undefined || raw === "") return 200;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 200;
})();

/** UTC midnight — same day boundary the Oracle cost ledger uses. */
function startOfUtcDay(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const env = envForWorker();
const log = getLogger("worker");
// Sentry is no-op unless SENTRY_DSN is set. Wrapped because a rejection here
// is unhandled — which on Node 18+ terminates the process. The worker failing
// to START because its error reporter failed to start is the worst possible
// trade, and it happens before main()'s .catch() is even reachable.
void (async () => {
  try {
    const { initSentry } = await import("@brain/core");
    await initSentry("worker");
  } catch (err) {
    log.warn({ err, op: "worker.sentry_init" }, "Sentry init failed — continuing without it");
  }
})();

// Nothing else logs an async escape that happens outside a job handler.
process.on("unhandledRejection", (reason) => {
  log.error({ err: reason, op: "worker.unhandled_rejection" }, "unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  log.fatal({ err, op: "worker.uncaught" }, "uncaught exception — exiting");
  process.exit(1);
});

async function main(): Promise<void> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.PG_BOSS_SCHEMA,
  });

  await boss.start();

  // pg-boss 10+ requires queues to be explicitly created before `schedule()`
  // or `work()` references them. Previously (v9) the queue was auto-created
  // on first `schedule()`. We call createQueue for every known queue up front
  // — it is idempotent (no-op if the queue already exists) and fails the
  // worker hard if the DB is mis-provisioned, which is the behaviour we want.
  //
  // Retry / backoff / expire config (audit WK1, refs #103) — every queue
  // gets explicit defaults so a transient downstream outage doesn't melt
  // the dependency at default cadence. Per-call sends from the producer
  // (apps/mcp-server/src/jobs.ts) layer their own values on top.
  const QUEUES: Array<{
    name: string;
    retryLimit: number;
    retryDelay?: number;
    retryBackoff: boolean;
    expireInSeconds: number;
    /** Terminal destination once retries are spent. See DEAD_LETTER_QUEUE. */
    deadLetter?: string;
  }> = [
    // Per-session work — retry generously with backoff; expire if the
    // run takes more than 10 min so we don't hold up other sessions.
    // KEA_RETRY_LIMIT is shared with the handler, which needs to know which
    // attempt is the last one before it marks the Session `failed`.
    { name: "kea.extract",     retryLimit: KEA_RETRY_LIMIT, retryBackoff: true,  expireInSeconds: 600, deadLetter: DEAD_LETTER_QUEUE },
    { name: "autoskill.run",   retryLimit: 3, retryBackoff: true,  expireInSeconds: 600, deadLetter: DEAD_LETTER_QUEUE },
    // Cross-session KEA (PR #219) — daily fan-out over users. Bumped
    // expireInSeconds because per-user processing involves LLM calls
    // against a multi-session payload that can take 30-60s each. retryLimit=1
    // because the work is idempotent (skip-on-no-new-sessions makes retry
    // safe) AND because LLM-call failures usually indicate provider issues
    // that won't recover in the same cron window.
    { name: "kea.cross_extract", retryLimit: 1, retryBackoff: false, expireInSeconds: 3600, deadLetter: DEAD_LETTER_QUEUE },
    // Session sweeper (#228). Daily DB-side sweep that closes Sessions
    // with endedAt=NULL whose latest activity is older than 24h. The
    // in-memory mcp.session.orphan sweeper (PR #202) handles transport-
    // level orphans; this is its DB-plane twin. retryLimit=1 because the
    // sweep is idempotent (already-closed sessions are skipped) and a
    // transient DB error recovers naturally on the next daily tick.
    { name: "session.sweep_abandoned", retryLimit: 1, retryBackoff: false, expireInSeconds: 600 },
    // Daily/weekly maintenance — modest retry, longer expire (these
    // touch the whole tenant's Knowledge set).
    { name: "evolution.decay",                retryLimit: 2, retryBackoff: true,  expireInSeconds: 1800 },
    { name: "evolution.consolidate",          retryLimit: 2, retryBackoff: true,  expireInSeconds: 1800 },
    { name: "evolution.detect-obsolescence",  retryLimit: 2, retryBackoff: true,  expireInSeconds: 1800 },
    { name: "evolution.health-snapshot",      retryLimit: 1, retryBackoff: false, expireInSeconds: 600 },
    // 10-minute cron — if a run fails, the next tick will pick up the
    // remaining work; no need to retry hard.
    { name: "embeddings.backfill",            retryLimit: 1, retryBackoff: false, expireInSeconds: 600 },
  ];
  // Terminal inbox for jobs that exhausted their retries. NOTHING works this
  // queue — it is read by the admin surface and by a human during an incident.
  //
  // Before this, an exhausted job moved to `failed` in pgboss.job and stopped
  // existing as far as the platform was concerned: no surface, no cron check,
  // no alert. Combined with the silent-handler problem fixed in v2.8.0, an
  // entire class of failure was invisible — KEA fails three times, the job
  // dies, the Session still reads `success`, and the only trace is a log line
  // nobody greps. Same shape as the backup that failed silently for three
  // weeks (§0f), which was solved the same way: a status surface someone sees.
  //
  // Only the session-scoped queues route here. The cron queues are
  // self-healing — a missed nightly decay is corrected by tomorrow's run —
  // so dead-lettering them would fill the inbox with entries nobody acts on,
  // and an inbox nobody acts on is the thing this is trying to replace.
  await boss.createQueue(DEAD_LETTER_QUEUE, {
    retryLimit: 0,
    retryBackoff: false,
    // `retentionSeconds`, NOT `expireInSeconds` — the two mean different
    // things and conflating them took the worker down in v2.11.0:
    //
    //   expireInSeconds   how long a job may sit ACTIVE before being retried
    //                     or failed. pg-boss asserts a 24-hour maximum, so
    //                     the 14 days meant here threw
    //                     "configuration assert: expiration cannot exceed
    //                     24 hours" at boss.createQueue() — before any
    //                     handler registered — and the worker crash-looped.
    //   retentionSeconds  how long a job is KEPT before deletion. This is
    //                     the "how long do dead letters stay readable"
    //                     knob, and it has no 24-hour ceiling.
    //
    // Nothing ever works this queue, so expiry is irrelevant to it; leaving
    // the default is correct rather than merely safe.
    retentionSeconds: 14 * 24 * 60 * 60,
  });

  for (const q of QUEUES) {
    const opts = {
      retryLimit: q.retryLimit,
      retryBackoff: q.retryBackoff,
      expireInSeconds: q.expireInSeconds,
      ...(q.deadLetter ? { deadLetter: q.deadLetter } : {}),
    };
    await boss.createQueue(q.name, opts);
    // `createQueue` is a NO-OP when the queue already exists — it does not
    // reconcile options. On any brain that has run before (i.e. every real
    // one), the queues predate this config, so the `deadLetter` added in
    // v2.11.0 silently never attached: the `dlq` row appeared, `dead_letter`
    // stayed NULL on all three source queues, and the feature was inert while
    // looking installed.
    //
    // `updateQueue` is the reconciling half. Running both makes this block
    // idempotent in the sense that actually matters — the queue ends up
    // matching the config in this file whether or not it existed before,
    // which is what every reader of this array assumes it already did.
    await boss.updateQueue(q.name, opts);
  }

  // Parse `job.data` defensively — see WK6 comment near sessionJobSchema.
  function parseSessionJob(raw: unknown, op: string): SessionJobData | null {
    const parsed = sessionJobSchema.safeParse(raw);
    if (!parsed.success) {
      log.error({ op, errors: parsed.error.issues }, "rejected malformed job payload");
      return null;
    }
    return parsed.data;
  }

  // Register job handlers — each scoped to a requestId so all nested core
  // logs carry the same id as the handler's own lines.
  // P2025 = Prisma "record not found" from findUniqueOrThrow. Used to
  // detect "session was deleted between enqueue and process" — a real
  // case (GDPR erase, test cleanup, manual ops) where retrying is
  // pointless. The retryable:false flag in our error envelope was being
  // ignored by pg-boss; explicitly short-circuit instead so we complete
  // the job and stop poisoning the queue.
  const isPrismaRecordNotFound = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2025";

  /**
   * Record whether extraction ran, on the Session row itself.
   *
   * Status bookkeeping must NEVER fail the job or mask the original error —
   * if this write throws, the interesting failure is the one that got us
   * here. Hence the swallow-and-log.
   *
   * P2025 is expected and ignored: the session may have been deleted between
   * enqueue and process (GDPR erase, test cleanup), which the caller already
   * treats as a non-retryable skip.
   */
  const markExtraction = async (
    sessionId: string,
    status: "ok" | "failed" | "skipped_quota",
    error?: unknown,
  ): Promise<void> => {
    try {
      await db.session.update({
        where: { id: sessionId },
        data: {
          extractionStatus: status,
          extractionAt: new Date(),
          extractionError:
            status === "failed"
              ? (error instanceof Error ? error.message : String(error)).slice(0, 500)
              : null,
        },
      });
    } catch (err) {
      if (isPrismaRecordNotFound(err)) return;
      log.warn(
        { op: "kea.extract.mark", sessionId, status, err },
        "could not record extraction status",
      );
    }
  };

  // `includeMetadata: true` is what promotes the handler's argument from
  // `Job` to `JobWithMetadata` — `retryCount` lives only on the latter, and
  // without this the read below is a type error rather than a silent
  // undefined. (Checked against pg-boss@12's own index.d.ts overloads.)
  await boss.work<{ sessionId: string; userId: string }>(
    "kea.extract",
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return;
      const data = parseSessionJob(job.data, "kea.extract");
      if (!data) return; // malformed — drop without retry
      await withRequest(`job-${job.id ?? shortId()}`, async () => {
        const start = performance.now();
        try {
          // Daily quota. Checked BEFORE any LLM work — a limit that fires
          // after the call is a report, not a limit. Failed attempts count
          // against the budget because they still spent tokens.
          if (KEA_DAILY_LIMIT > 0) {
            const usedToday = await db.session.count({
              where: {
                userId: data.userId,
                extractionAt: { gte: startOfUtcDay() },
                extractionStatus: { in: ["ok", "failed"] },
              },
            });
            if (usedToday >= KEA_DAILY_LIMIT) {
              await markExtraction(data.sessionId, "skipped_quota");
              log.warn(
                {
                  op: "kea.extract",
                  outcome: "skipped_quota",
                  sessionId: data.sessionId,
                  usedToday,
                  limit: KEA_DAILY_LIMIT,
                },
                "kea.extract skipped — daily extraction quota reached",
              );
              return; // Complete the job. Retrying would not free quota.
            }
          }

          const metrics = await summarizeSession(data.sessionId);
          const payload = await kea.buildPayload(data.sessionId, metrics);
          const extracted = await kea.extractFromSession(payload);
          await markExtraction(data.sessionId, "ok");
          log.info(
            {
              op: "kea.extract",
              outcome: "ok",
              sessionId: data.sessionId,
              items: extracted.length,
              durMs: Math.round(performance.now() - start),
            },
            "kea.extract",
          );
        } catch (err) {
          if (isPrismaRecordNotFound(err)) {
            log.warn(
              {
                op: "kea.extract",
                outcome: "skipped_session_gone",
                sessionId: data.sessionId,
                durMs: Math.round(performance.now() - start),
              },
              "kea.extract skipped — session deleted between enqueue and process",
            );
            return; // Complete the job; don't retry a 404.
          }
          // Only mark `failed` once the retries are actually spent — an
          // earlier attempt may still succeed, and flagging on attempt 1
          // would leave rows reading `failed` that later extracted fine.
          // pg-boss `retryCount` is 0-indexed; KEA_RETRY_LIMIT is the same
          // constant the queue is created with, so the two cannot drift.
          const attempt = job.retryCount ?? 0;
          const isFinalAttempt = attempt >= KEA_RETRY_LIMIT - 1;
          if (isFinalAttempt) {
            await markExtraction(data.sessionId, "failed", err);
          }
          await captureError(
            log,
            err,
            {
              op: "kea.extract",
              outcome: "error",
              sessionId: data.sessionId,
              attempt,
              finalAttempt: isFinalAttempt,
              durMs: Math.round(performance.now() - start),
            },
            "kea.extract failed",
          );
          throw err;
        }
      });
    },
  );

  await boss.work<{ sessionId: string; userId: string }>(
    "autoskill.run",
    async ([job]) => {
      if (!job) return;
      const data = parseSessionJob(job.data, "autoskill.run");
      if (!data) return;
      await withRequest(`job-${job.id ?? shortId()}`, async () => {
        const start = performance.now();
        try {
          const proposals = await autoskill.runForSession(data.sessionId);
          log.info(
            {
              op: "autoskill.run",
              outcome: "ok",
              sessionId: data.sessionId,
              proposals: proposals.length,
              durMs: Math.round(performance.now() - start),
            },
            "autoskill.run",
          );
        } catch (err) {
          if (isPrismaRecordNotFound(err)) {
            log.warn(
              {
                op: "autoskill.run",
                outcome: "skipped_session_gone",
                sessionId: data.sessionId,
                durMs: Math.round(performance.now() - start),
              },
              "autoskill.run skipped — session deleted between enqueue and process",
            );
            return;
          }
          await captureError(
            log,
            err,
            {
              op: "autoskill.run",
              outcome: "error",
              sessionId: data.sessionId,
              durMs: Math.round(performance.now() - start),
            },
            "autoskill.run failed",
          );
          throw err;
        }
      });
    },
  );

  // Scheduled jobs (daily/weekly).
  //
  // Audit WK4 (#103): use singletonKey so a slow run can't get
  // overlapped by the next cron tick — without it, if a 10-min
  // backfill takes 12 min, pg-boss enqueues a second job and a
  // second worker races over the same LIMIT-32 rows, double-spending
  // embedding API. singletonKey is checked across the active state,
  // so a long run blocks only its own re-enqueue, not other queues.
  // The pattern applies to every periodic schedule below.
  await boss.schedule("evolution.decay",                "0 2 * * *",   {}, { singletonKey: "evolution.decay" });
  await boss.schedule("evolution.consolidate",          "0 3 * * *",   {}, { singletonKey: "evolution.consolidate" });
  await boss.schedule("evolution.detect-obsolescence",  "0 4 * * 0",   {}, { singletonKey: "evolution.detect-obsolescence" });
  await boss.schedule("evolution.health-snapshot",      "0 5 * * 0",   {}, { singletonKey: "evolution.health-snapshot" });
  // Cross-session KEA at 6 AM UTC — after the morning evolution sweep
  // so the dedup similarity check sees the latest decay/consolidation
  // state. Daily because cross-session patterns compound from session
  // repetition; less frequent runs would miss short-term reflex changes.
  await boss.schedule("kea.cross_extract",              "0 6 * * *",   {}, { singletonKey: "kea.cross_extract" });
  // Session sweeper at 7 AM UTC — after cross-session KEA so an
  // abandoned session that was about to be processed today still gets
  // its KEA pass first (if it had outcome data). The sweeper closes
  // outcome=abandoned which doesn't trigger KEA, so order matters.
  await boss.schedule("session.sweep_abandoned",        "0 7 * * *",   {}, { singletonKey: "session.sweep_abandoned" });
  await boss.schedule("embeddings.backfill",            "*/10 * * * *",{}, { singletonKey: "embeddings.backfill" });

  /**
   * Wrap a maintenance handler so a failure is *visible*.
   *
   * pg-boss already retried these; what was missing was any record that they
   * failed at all. The four session-scoped handlers call `captureError`, these
   * five did not — so `evolution.decay` silently erroring every night looked
   * identical to it working, and `embeddings.backfill` (a 10-minute cron)
   * could fail 144 times a day without emitting one error line or one Sentry
   * event. Emits the same `op` / `outcome` / `durMs` shape the rest of the
   * worker uses, so the log histogram treats them uniformly.
   */
  const observed =
    (op: string, fn: () => Promise<Record<string, unknown> | void>) =>
    async (): Promise<void> => {
      const start = performance.now();
      try {
        const fields = (await fn()) ?? {};
        log.info(
          { op, outcome: "ok", ...fields, durMs: Math.round(performance.now() - start) },
          op,
        );
      } catch (err) {
        await captureError(
          log,
          err,
          { op, outcome: "error", durMs: Math.round(performance.now() - start) },
          `${op} failed`,
        );
        throw err;
      }
    };

  await boss.work(
    "evolution.decay",
    observed("evolution.decay", async () => {
      const res = await evolution.decayUnused();
      return { updated: res.updated, flaggedLowEffectiveness: res.flaggedLowEffectiveness };
    }),
  );
  await boss.work(
    "evolution.consolidate",
    observed("evolution.consolidate", async () => {
      const res = await evolution.consolidateDuplicates();
      return { merged: res.merged };
    }),
  );
  await boss.work(
    "evolution.detect-obsolescence",
    observed("evolution.detect-obsolescence", async () => {
      const res = await evolution.detectObsolescence();
      return { flagged: res.flagged };
    }),
  );
  await boss.work(
    "evolution.health-snapshot",
    observed("evolution.health-snapshot", async () => {
      await evolution.snapshotKnowledgeHealth();
    }),
  );
  await boss.work(
    "embeddings.backfill",
    observed("embeddings.backfill", async () => {
      const res = await backfillEmbeddings({ limit: 256 });
      return { rows: res.processed };
    }),
  );

  // Cross-session KEA (PR #219). Daily fan-out via kea.runCrossExtractDaily.
  // The function itself emits per-user `op="kea.cross.skip"` /
  // `op="kea.cross_funnel"` log lines AND a top-level
  // `op="kea.cross.daily_done"`. The wrapper here adds error capture +
  // per-run elapsed time so the cron's health is observable from the
  // worker log shape histogram (`grep '"op":"kea.cross.daily_done"'` in
  // docs/RUNBOOK.md §"Tokens connect but brain doesn't learn").
  await boss.work("kea.cross_extract", async () => {
    const start = performance.now();
    try {
      const results = await kea.runCrossExtractDaily();
      log.info(
        {
          op: "kea.cross_extract",
          outcome: "ok",
          users: results.length,
          totalPersisted: results.reduce((acc, r) => acc + r.persisted, 0),
          durMs: Math.round(performance.now() - start),
        },
        "kea.cross_extract",
      );
    } catch (err) {
      await captureError(
        log,
        err,
        {
          op: "kea.cross_extract",
          outcome: "error",
          durMs: Math.round(performance.now() - start),
        },
        "kea.cross_extract failed",
      );
      throw err;
    }
  });

  // Session sweeper (#228). Closes Sessions abandoned for >24h with no
  // recent activity. "Recent activity" = endedAt unset AND most recent
  // SessionEvent.timestamp older than 24h (or no events at all + startedAt
  // older than 24h). Marks outcome='abandoned' which downstream queries
  // can filter out from "real user work" counts. Does NOT enqueue
  // kea.extract — abandoned sessions don't have outcome signal worth
  // extracting from.
  await boss.work("session.sweep_abandoned", async () => {
    const start = performance.now();
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Find candidates: sessions with no endedAt where neither the
      // session itself nor any of its events have been touched in 24h.
      const result = await db.$executeRawUnsafe<number>(
        `
        UPDATE "Session" s
        SET "endedAt" = NOW(), outcome = 'abandoned'
        WHERE s."endedAt" IS NULL
          AND s."startedAt" < $1
          AND NOT EXISTS (
            SELECT 1 FROM "SessionEvent" e
            WHERE e."sessionId" = s.id
              AND e.timestamp > $1
          )
        `,
        cutoff,
      );
      log.info(
        {
          op: "session.sweep_abandoned",
          outcome: "ok",
          swept: result,
          durMs: Math.round(performance.now() - start),
        },
        "session.sweep_abandoned",
      );
    } catch (err) {
      await captureError(
        log,
        err,
        {
          op: "session.sweep_abandoned",
          outcome: "error",
          durMs: Math.round(performance.now() - start),
        },
        "session.sweep_abandoned failed",
      );
      throw err;
    }
  });

  // Liveness endpoint.
  //
  // The worker has no HTTP surface of its own, and `restart: unless-stopped`
  // only reacts to a process that EXITS — a worker wedged on a dropped
  // pg-boss connection stays "up" forever. Docker therefore needs something
  // to probe.
  //
  // The first attempt at this probe ran `node -e "require('pg')…"` inside the
  // container and failed with `Cannot find module 'pg'`: under pnpm's
  // isolated node_modules, `pg` is not resolvable from /app/apps/worker even
  // though pg-boss depends on it. Serving the check from inside the process
  // that already holds the pool removes the module-resolution question
  // entirely — the probe becomes a plain HTTP GET, which Node can make with
  // built-in `fetch` and no imports at all.
  //
  // `boss.getQueue()` round-trips to the pgboss schema, so a green response
  // means this process can still reach its queue — which is the property
  // worth asserting, rather than merely "the event loop is alive".
  // (Checked against pg-boss@12's own types: `getQueue(name)` /
  // `getQueues()` exist; `getQueueSize` does not.)
  const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 9091);
  const health = createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    void (async () => {
      try {
        await boss.getQueue("kea.extract");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, schema: env.PG_BOSS_SCHEMA }));
      } catch (err) {
        log.warn({ op: "worker.health", err }, "health probe could not reach the queue");
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      }
    })();
  });
  health.listen(healthPort, "127.0.0.1", () => {
    log.info({ op: "worker.health", port: healthPort }, "worker health endpoint listening");
  });
  // Never let the probe server hold the process open on its own.
  health.unref();

  log.info({ schema: env.PG_BOSS_SCHEMA }, "Worker running. Press Ctrl+C to stop.");

  // Graceful shutdown. Without this, SIGTERM — every `deploy.sh`, every
  // `docker compose restart` — killed jobs mid-execution: the pg-boss lease
  // was never released, the row sat `active` until expireInSeconds (10 min
  // for kea.extract, 60 for kea.cross_extract), and the work was redone,
  // re-spending the LLM tokens the killed attempt had already burned.
  // kea.cross_extract is retryLimit:1, so a deploy landing in its 06:00
  // window skipped that day's cross-session extraction entirely.
  //
  // pg-boss v12 `stop({ graceful, timeout })` already does the draining AND
  // the bounding itself: it stops the manager/timekeeper, then polls
  // `hasPendingCleanups()` every 500 ms until `timeout` elapses, then runs
  // `failWip()` + closes the pool (pg-boss `index.js::stop`). So `await
  // boss.stop(...)` returns only once the drain is finished or the budget is
  // spent — there is no separate "wait" flag, and an outer bail timer that
  // called `process.exit()` on expiry would be strictly worse: it would skip
  // `failWip()` and the connection close, which is the cleanup this handler
  // exists to perform.
  //
  // The outer timer below is therefore NOT the grace window — it is a
  // last-resort guard for `boss.stop()` itself hanging (DB unreachable), and
  // is deliberately longer than pg-boss's own budget so pg-boss wins in every
  // normal case. `stop_grace_period` in docker-compose.yml sits above both so
  // Docker doesn't SIGKILL mid-drain.
  const DRAIN_BUDGET_MS = 20_000;
  const HARD_BAIL_MS = 25_000;
  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info({ op: "worker.shutdown", signal }, "draining in-flight jobs");
    health.close();
    const bail = setTimeout(() => {
      log.warn(
        { op: "worker.shutdown", signal, outcome: "stop_hung" },
        "boss.stop() did not return — exiting without a clean drain",
      );
      process.exit(0);
    }, HARD_BAIL_MS);
    bail.unref();
    try {
      await boss.stop({ graceful: true, timeout: DRAIN_BUDGET_MS });
      log.info(
        { op: "worker.shutdown", signal, outcome: "drained" },
        "worker stopped cleanly",
      );
    } catch (err) {
      log.error({ op: "worker.shutdown", signal, err }, "boss.stop failed");
    }
    clearTimeout(bail);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

async function summarizeSession(sessionId: string) {
  const events = await db.sessionEvent.findMany({
    where: { sessionId },
    orderBy: { timestamp: "asc" },
  });
  const filesCreated: string[] = [];
  const filesModified: string[] = [];
  const filesRejected: string[] = [];
  const errors: string[] = [];
  let buildAttempts = 0;

  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    switch (e.eventType) {
      case "file_created":
        if (typeof p.path === "string") filesCreated.push(p.path);
        break;
      case "file_modified":
        if (typeof p.path === "string") filesModified.push(p.path);
        break;
      case "file_rejected":
        if (typeof p.path === "string") filesRejected.push(p.path);
        break;
      case "build_attempt":
        buildAttempts++;
        break;
      case "build_failure":
        if (typeof p.error === "string") errors.push(p.error);
        break;
    }
  }
  return {
    filesCreated,
    filesModified,
    filesRejected,
    buildAttempts,
    errors,
    knowledgeUsed: [],
    durationMs: 0,
    tokensUsed: 0,
  };
}

main().catch((err) => {
  log.fatal({ err }, "Worker fatal error");
  process.exit(1);
});
