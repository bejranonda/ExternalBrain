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

// Single in-memory fallback shared across calls so that a brief Redis
// outage keeps consistent state within this process.
const fallback = memoryStore();

/**
 * Redis-side counter bump, run as one script so no other client can observe
 * the pre-increment value. `INCR` creates the key at 1, and only the caller
 * that created it arms the window TTL — which also makes Redis reap the key,
 * so nothing has to sweep expired buckets. `PTTL` rides along in the same
 * script so the caller learns the window end Redis actually holds rather
 * than assuming its own clock agrees.
 */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {count, redis.call('PTTL', KEYS[1])}
`;

function redisStore(client: RedisClientType): Store {
  const prefix = "bp:ratelimit:";
  return {
    async increment(key: string, windowMs: number, now: number): Promise<Bucket> {
      const window = Math.max(1, Math.ceil(windowMs));
      try {
        const reply: unknown = await client.eval(INCREMENT_SCRIPT, {
          keys: [prefix + key],
          arguments: [String(window)],
        });
        if (!Array.isArray(reply) || typeof reply[0] !== "number") {
          return fallback.increment(key, windowMs, now);
        }
        // PTTL reports -1 (key has no expiry) or -2 (key vanished) only if
        // something outside this script touched the key; trust our own window
        // rather than surfacing a nonsense resetAt.
        const ttlMs = typeof reply[1] === "number" ? reply[1] : -1;
        return { count: reply[0], resetAt: ttlMs > 0 ? now + ttlMs : now + window };
      } catch {
        // Redis unreachable mid-request. Degrade to the per-process limiter —
        // same posture as the `error` handler above: limit independently
        // rather than 500, but never let the request through uncounted.
        return fallback.increment(key, windowMs, now);
      }
    },
  };
}

export async function getRateLimitStore(): Promise<Store> {
  const client = await ensureRedis();
  return client && redisReady ? redisStore(client) : fallback;
}
