/**
 * Oracle cost ledger — per-user, per-day spend tracking + cap enforcement.
 *
 * The cap (`MAX_ORACLE_COST_USD_PER_DAY`) is read at call time, so operators
 * can tighten or loosen limits without a redeploy. We block BEFORE calling
 * the LLM so a user can't exceed the cap by starting many parallel calls.
 *
 * Prices are per 1M tokens. Update the table as providers change their
 * pricing — keep the defaults honest. If the `ORACLE_MODEL` isn't in the
 * table, we fall back to the most expensive entry so we over-count rather
 * than under-count.
 */
import { db } from "@brain/db";
import { getLogger } from "./logger.js";

const log = getLogger("core");

// In-process dedup sets — prevent log floods when a user keeps calling after
// the cap fires. Keys are "${userId}:${day_iso}".
const warnedAt80 = new Set<string>();
const warnedAtCap = new Set<string>();

export interface TokenUsage {
  input: number;
  output: number;
}

/** USD per 1M tokens. Input | Output. Update with provider changes. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-haiku-4-5": { input: 0.8, output: 4 },
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // Z.ai GLM via Anthropic-compatible endpoint.
  "glm-5.1": { input: 0.6, output: 2.2 },
  "glm-4.7": { input: 0.6, output: 2.2 },
  "glm-4.6": { input: 0.6, output: 2.2 },
  "glm-4.5": { input: 0.2, output: 1.1 },
  "glm-4.5-air": { input: 0.2, output: 1.1 },
  "glm-4.5-flash": { input: 0, output: 0 },
  // Alibaba DashScope Qwen3. Embedding pricing is per-request (negligible for
  // our volumes) and is not tracked in this ledger — this table covers chat
  // models only. Chat prices below are representative; revise on provider change.
  "qwen3-coder": { input: 0.2, output: 0.6 },
  "qwen-plus": { input: 0.4, output: 1.2 },
  "qwen-turbo": { input: 0.05, output: 0.2 },
};

export function pricePerCall(model: string, usage: TokenUsage): number {
  const row = PRICES[model] ?? { input: 15, output: 75 }; // conservative fallback
  return (usage.input * row.input + usage.output * row.output) / 1_000_000;
}

function today(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export interface CapDecision {
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
  callsToday: number;
}

/**
 * Check whether `userId` can run another Oracle call today without exceeding
 * the cap. Read-only — does not touch the ledger. Returns the current
 * spend so callers can surface a meaningful message.
 *
 * NOTE: this function is racy under concurrency — N callers all see the same
 * pre-call spend and all pass. Production paths should use `reserveCapSlot`
 * which performs an atomic check-and-reserve under an advisory lock. This
 * `checkCap` survives for read-only inspection paths (UI hints, etc.).
 */
export async function checkCap(userId: string): Promise<CapDecision> {
  const capRaw = process.env.MAX_ORACLE_COST_USD_PER_DAY;
  const capUsd = capRaw ? Number(capRaw) : 10;
  const day = today();
  const row = await db.oracleCostLedger.findUnique({
    where: { userId_day: { userId, day } },
  });
  const spentUsd = row ? Number(row.costUsd) : 0;
  const callsToday = row?.callCount ?? 0;
  return {
    allowed: spentUsd < capUsd,
    spentUsd,
    capUsd,
    callsToday,
  };
}

/**
 * Default per-call estimate, used by `reserveCapSlot` callers that don't
 * want to compute one. ~$0.05 covers a typical Sonnet Oracle call (5k input
 * + 1k output ≈ $0.03) with headroom; conservative enough that the cap
 * cannot be overshot by more than one parallel call's worth.
 */
export const DEFAULT_RESERVATION_USD = 0.05;

export class OracleCapReachedError extends Error {
  spentUsd: number;
  capUsd: number;
  reservedUsd: number;
  constructor(spentUsd: number, capUsd: number, reservedUsd: number) {
    super(
      `Oracle cap reached: $${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)} spent today (would exceed with $${reservedUsd.toFixed(4)} reservation)`,
    );
    this.name = "OracleCapReachedError";
    this.spentUsd = spentUsd;
    this.capUsd = capUsd;
    this.reservedUsd = reservedUsd;
  }
}

/**
 * Atomic reserve-or-deny. Acquires `pg_advisory_xact_lock` keyed on
 * (userId, day) so only one caller per user-day bucket runs the
 * read-spend → tentatively-increment sequence at a time. After this
 * returns, the ledger has been incremented by `estimateUsd`; the caller
 * MUST eventually call `recordCall(..., reservedUsd: estimateUsd)` to
 * net the reservation against the actual cost. If the LLM call fails
 * before `recordCall`, the reservation stays in the ledger as a small
 * over-count — that's the bound: at most `estimateUsd` per failed call.
 *
 * Throws `OracleCapReachedError` if `currentSpend + estimateUsd > cap`.
 *
 * Audit C16 / #111: the previous flow (`checkCap` then `recordCall`)
 * was non-atomic — N concurrent callers all saw the pre-call spend and
 * all passed, blowing the cap by any factor proportional to
 * concurrency. The advisory lock serializes the brief check-and-reserve
 * window; the LLM call itself stays parallel.
 */
export async function reserveCapSlot(
  userId: string,
  estimateUsd = DEFAULT_RESERVATION_USD,
): Promise<{ spentUsd: number; capUsd: number; reservedUsd: number }> {
  const capRaw = process.env.MAX_ORACLE_COST_USD_PER_DAY;
  const capUsd = capRaw ? Number(capRaw) : 10;
  const day = today();
  const dayIso = day.toISOString().slice(0, 10);

  return await db.$transaction(async (tx) => {
    // Lock keyed on (userId, day). hashtextextended returns int8 (bigint),
    // which is what pg_advisory_xact_lock takes. Lock auto-releases at
    // transaction commit/rollback.
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      `${userId}:${dayIso}`,
    );

    const row = await tx.oracleCostLedger.findUnique({
      where: { userId_day: { userId, day } },
      select: { costUsd: true },
    });
    const spentUsd = row ? Number(row.costUsd) : 0;

    if (capUsd > 0 && spentUsd + estimateUsd > capUsd) {
      throw new OracleCapReachedError(spentUsd, capUsd, estimateUsd);
    }

    await tx.oracleCostLedger.upsert({
      where: { userId_day: { userId, day } },
      create: {
        userId,
        day,
        tokensInput: 0,
        tokensOutput: 0,
        costUsd: estimateUsd,
        callCount: 0, // bumped by recordCall when the call completes
      },
      update: {
        costUsd: { increment: estimateUsd },
      },
    });

    return { spentUsd, capUsd, reservedUsd: estimateUsd };
  });
}

/**
 * Increment the ledger after a completed Oracle call. Idempotent per
 * (userId, day) via the unique index — concurrent writes use Prisma upsert.
 *
 * If `reservedUsd` is provided (paired with a prior `reserveCapSlot`
 * call), the cost increment is `actualCost - reservedUsd` so the ledger
 * lands at the correct total. Pass 0 for unreserved calls (legacy
 * non-atomic flow).
 *
 * After writing, checks the spend ratio against the cap and emits a single
 * structured warn (80% threshold) or error (cap hit) per (userId, day) per
 * process lifetime. Alerts are deduplicated in-process — operators can set
 * structured-log alerts on these events without being flooded.
 */
export async function recordCall(
  userId: string,
  model: string,
  usage: TokenUsage,
  reservedUsd = 0,
): Promise<void> {
  const cost = pricePerCall(model, usage);
  const costDelta = cost - reservedUsd;
  const day = today();
  const updated = await db.oracleCostLedger.upsert({
    where: { userId_day: { userId, day } },
    create: {
      userId,
      day,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      costUsd: cost, // no reservation in the create branch; first row
      callCount: 1,
    },
    update: {
      tokensInput: { increment: usage.input },
      tokensOutput: { increment: usage.output },
      costUsd: { increment: costDelta },
      callCount: { increment: 1 },
    },
  });

  // Cap alert — read the same cap the check function uses.
  const capRaw = process.env.MAX_ORACLE_COST_USD_PER_DAY;
  const capUsd = capRaw ? Number(capRaw) : 10;
  if (capUsd <= 0) return; // cap disabled — nothing to alert on

  const spentUsd = Number(updated.costUsd);
  const ratio = spentUsd / capUsd;
  const dayKey = `${userId}:${day.toISOString().slice(0, 10)}`;

  if (ratio >= 1 && !warnedAtCap.has(dayKey)) {
    warnedAtCap.add(dayKey);
    log.error({ userId, spentUsd, capUsd, ratio }, "oracle_cost_cap_hit");
  } else if (ratio >= 0.8 && !warnedAt80.has(dayKey)) {
    warnedAt80.add(dayKey);
    log.warn({ userId, spentUsd, capUsd, ratio }, "oracle_cost_80pct_warning");
  }
}
