/**
 * pg-boss enqueue from the MCP server.
 *
 * Audit C7 (#107): the previous implementation INSERTed directly into
 * `pgboss.job` with `singletonkey` set, which:
 *   1. silently failed on schema drift (pg-boss 12 split the `job` table
 *      into partitioned `job` + `job_common` and removed/renamed columns
 *      depending on minor version), and
 *   2. left `state`, `retrylimit`, `retrydelay`, `expirein` empty so the
 *      job had no retry/backoff config — even when the row landed.
 *
 * This module exposes a singleton pg-boss client and a typed `enqueue`
 * helper that uses the public `boss.send()` API. Retry/backoff/expiry
 * defaults are documented inline; callers can override per-call.
 *
 * The boss instance is started lazily on first use, then reused across
 * requests for the lifetime of the process. The MCP-server handles SIGINT
 * already (HTTP listener close); we hook a `beforeExit` to stop boss
 * cleanly so in-flight inserts flush.
 */
import { PgBoss } from "pg-boss";
import { envForMcp, getLogger } from "@brain/core";

const log = getLogger("mcp-jobs");

let bossSingleton: PgBoss | null = null;
let startPromise: Promise<PgBoss> | null = null;
let stopHooked = false;

async function getBoss(): Promise<PgBoss> {
  if (bossSingleton) return bossSingleton;
  if (startPromise) return startPromise;

  const env = envForMcp();
  const instance = new PgBoss({
    connectionString: env.DATABASE_URL,
    // The mcp-server reads PG_BOSS_SCHEMA from env; the default ("pgboss")
    // matches what the worker uses. WorkerExtra is the canonical schema for
    // this var, but for the producer we just need the same value — read it
    // from process.env directly to avoid widening McpEnv just for the
    // enqueue side.
    schema: process.env.PG_BOSS_SCHEMA ?? "pgboss",
  });

  startPromise = instance.start().then(() => {
    bossSingleton = instance;
    if (!stopHooked) {
      process.once("beforeExit", async () => {
        try {
          await instance.stop({ graceful: true });
        } catch (err) {
          log.warn({ err }, "pg-boss stop failed during beforeExit");
        }
      });
      stopHooked = true;
    }
    return instance;
  });

  return startPromise;
}

export interface EnqueueOptions {
  /** Idempotency key — pg-boss dedups within a singleton-key window. */
  singletonKey?: string;
  /** Number of retries on handler throw. Default: 3. */
  retryLimit?: number;
  /** Exponential backoff between retries. Default: true. */
  retryBackoff?: boolean;
  /** Hard expiry; if a worker hasn't completed by then, the job is failed. Default: 600s. */
  expireInSeconds?: number;
}

export async function enqueueJob<T>(
  jobName: string,
  payload: T,
  opts: EnqueueOptions = {},
): Promise<string | null> {
  const boss = await getBoss();
  // Build the SendOptions object lazily — pg-boss types use
  // exactOptionalPropertyTypes; passing { singletonKey: undefined } is
  // rejected. Spread only the keys we actually have.
  const sendOpts: Record<string, unknown> = {
    retryLimit: opts.retryLimit ?? 3,
    retryBackoff: opts.retryBackoff ?? true,
    expireInSeconds: opts.expireInSeconds ?? 600,
  };
  if (opts.singletonKey !== undefined) sendOpts.singletonKey = opts.singletonKey;
  const id = await boss.send(jobName, payload as Record<string, unknown>, sendOpts);
  log.debug({ jobName, jobId: id }, "enqueued");
  return id;
}
