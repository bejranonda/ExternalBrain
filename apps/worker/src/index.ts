/**
 * Background worker — runs KEA extraction, autoskill, decay, consolidation.
 *
 * Scheduling via pg-boss. One process handles all job classes; scale
 * horizontally by running additional workers.
 */
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
  }> = [
    // Per-session work — retry generously with backoff; expire if the
    // run takes more than 10 min so we don't hold up other sessions.
    { name: "kea.extract",     retryLimit: 3, retryBackoff: true,  expireInSeconds: 600 },
    { name: "autoskill.run",   retryLimit: 3, retryBackoff: true,  expireInSeconds: 600 },
    // Cross-session KEA (PR #219) — daily fan-out over users. Bumped
    // expireInSeconds because per-user processing involves LLM calls
    // against a multi-session payload that can take 30-60s each. retryLimit=1
    // because the work is idempotent (skip-on-no-new-sessions makes retry
    // safe) AND because LLM-call failures usually indicate provider issues
    // that won't recover in the same cron window.
    { name: "kea.cross_extract", retryLimit: 1, retryBackoff: false, expireInSeconds: 3600 },
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
  for (const q of QUEUES) {
    await boss.createQueue(q.name, {
      retryLimit: q.retryLimit,
      retryBackoff: q.retryBackoff,
      expireInSeconds: q.expireInSeconds,
    });
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

  await boss.work<{ sessionId: string; userId: string }>(
    "kea.extract",
    async ([job]) => {
      if (!job) return;
      const data = parseSessionJob(job.data, "kea.extract");
      if (!data) return; // malformed — drop without retry
      await withRequest(`job-${job.id ?? shortId()}`, async () => {
        const start = performance.now();
        try {
          const metrics = await summarizeSession(data.sessionId);
          const payload = await kea.buildPayload(data.sessionId, metrics);
          const extracted = await kea.extractFromSession(payload);
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
          await captureError(
            log,
            err,
            {
              op: "kea.extract",
              outcome: "error",
              sessionId: data.sessionId,
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
