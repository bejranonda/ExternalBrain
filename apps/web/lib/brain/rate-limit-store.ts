/**
 * Pick a rate-limit `Store` based on env: Redis in production
 * (multi-replica safe) or the in-memory Map fallback for single-host.
 *
 * Connection semantics:
 *   - One client per process, lazily created on first `check()`.
 *   - We don't await `connect()` on first call — the `redis` package
 *     auto-reconnects and queues commands, so the first few requests
 *     pay a tiny latency penalty but nothing fails.
 *   - On client errors (which the redis lib emits to an `error` handler
 *     we can't ignore without it crashing the process), we log once per
 *     minute and fall back to in-memory until the connection recovers.
 *     Better to rate-limit some replicas independently than to 500.
 */
import type { Bucket, Store } from "@brain/core";
import { memoryStore, getLogger } from "@brain/core";
import type { RedisClientType } from "redis";

const log = getLogger("web").child({ subsystem: "rate-limit" });

let redisClient: RedisClientType | null = null;
let redisReady = false;
let lastErrorLogAt = 0;

async function ensureRedis(): Promise<RedisClientType | null> {
  if (!process.env.REDIS_URL) return null;
  if (redisClient) return redisReady ? redisClient : null;

  // Lazy-load the client so the web container doesn't open a socket
  // during `next build`'s page-data collection.
  const { createClient } = await import("redis");
  const client = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
  client.on("error", (err: Error) => {
    const now = Date.now();
    if (now - lastErrorLogAt > 60_000) {
      lastErrorLogAt = now;
      log.error(
        {
          err,
          op: "rate-limit.redis",
          outcome: "error",
        },
        "redis error — falling back to in-memory rate limiter",
      );
    }
    redisReady = false;
  });
  client.on("ready", () => {
    if (!redisReady) log.info({ op: "rate-limit.redis" }, "redis ready");
    redisReady = true;
  });
  redisClient = client;
  // Fire-and-forget — the lib queues commands until connected.
  void client.connect().catch(() => {
    /* already logged via `error` handler */
  });
  return redisReady ? client : null;
}

function redisStore(client: RedisClientType): Store {
  const prefix = "bp:ratelimit:";
  return {
    async get(key: string): Promise<Bucket | undefined> {
      try {
        const raw = await client.get(prefix + key);
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as Bucket;
        if (
          typeof parsed.count !== "number" ||
          typeof parsed.resetAt !== "number"
        ) {
          return undefined;
        }
        return parsed;
      } catch {
        return undefined;
      }
    },
    async set(key: string, bucket: Bucket, ttlMs: number): Promise<void> {
      try {
        // `PX` sets the TTL in milliseconds so Redis auto-expires the key
        // once the rate-limit window elapses. One less thing to reap.
        await client.set(prefix + key, JSON.stringify(bucket), {
          PX: Math.max(1, Math.ceil(ttlMs)),
        });
      } catch {
        /* best-effort — fall through to next request */
      }
    },
  };
}

// Single in-memory fallback shared across calls so that a brief Redis
// outage keeps consistent state within this process.
const fallback = memoryStore();

export async function getRateLimitStore(): Promise<Store> {
  const client = await ensureRedis();
  return client && redisReady ? redisStore(client) : fallback;
}
