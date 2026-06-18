/**
 * Voucher-code validation + atomic redemption.
 *
 * Two-phase flow:
 *   1. `validateVoucher(code)` — read-only check invoked from the /signin
 *      page to give fast feedback before the OAuth round-trip. Returns the
 *      specific reason on failure so the UI can tell the user.
 *   2. `claimVoucher({code, email, name, image, roleIfAdmin})` — called from
 *      the NextAuth `signIn` callback AFTER OAuth returns. Transactionally
 *      validates the voucher, increments `usedCount`, creates the User row,
 *      and writes the VoucherRedemption. Race-safe via a row-level lock
 *      (`SELECT ... FOR UPDATE` inside a transaction) so two concurrent
 *      claims on the last seat of a multi-use voucher cannot both succeed.
 */
import { db } from "@brain/db";

export type VoucherFailure =
  | "invalid"    // code does not exist
  | "disabled"   // admin disabled the code
  | "expired"    // expiresAt is in the past
  | "exhausted"; // usedCount >= maxUses

export interface VoucherValidResult {
  ok: true;
  voucherId: string;
  kind: "personal" | "organization";
  organizationLabel: string | null;
  seatsLeft: number; // maxUses - usedCount (could be 0 if someone just took the last)
}

export interface VoucherInvalidResult {
  ok: false;
  reason: VoucherFailure;
}

export type VoucherResult = VoucherValidResult | VoucherInvalidResult;

function normalize(code: string): string {
  return code.trim().toUpperCase();
}

function pickFailure(row: {
  disabled: boolean;
  expiresAt: Date | null;
  usedCount: number;
  maxUses: number;
}): VoucherFailure | null {
  if (row.disabled) return "disabled";
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return "expired";
  if (row.usedCount >= row.maxUses) return "exhausted";
  return null;
}

/** Read-only validator — no mutation. Used by /signin for fast UI feedback. */
export async function validateVoucher(code: string): Promise<VoucherResult> {
  const c = normalize(code);
  if (!c) return { ok: false, reason: "invalid" };

  const row = await db.voucherCode.findUnique({ where: { code: c } });
  if (!row) return { ok: false, reason: "invalid" };

  const failure = pickFailure(row);
  if (failure) return { ok: false, reason: failure };

  return {
    ok: true,
    voucherId: row.id,
    kind: row.kind as "personal" | "organization",
    organizationLabel: row.organizationLabel,
    seatsLeft: row.maxUses - row.usedCount,
  };
}

/**
 * Per-IP brute-force rate-limiter for voucher validation attempts. Prevents an
 * attacker from enumerating the 8-char alphanumeric code space on /signin.
 *
 * Backing store is the shared rate-limit Store (Redis in production, in-memory
 * otherwise). 10 attempts per rolling hour is enough for a human to mistype a
 * few times + ask for a fresh code; catastrophic for anyone trying to
 * brute-force the ~10^10 code space.
 *
 * Returns true when the claim may proceed, false when rate-limited. The
 * signIn callback should translate `false` into `/signin?error=voucher_rate_limited`.
 */
const VOUCHER_ATTEMPT_LIMIT = {
  name: "voucher-attempt",
  max: 10,
  windowMs: 60 * 60 * 1000,
} as const;

export async function checkVoucherRateLimit(clientIp: string): Promise<{
  ok: boolean;
  remaining: number;
  resetAt: number;
}> {
  // Dynamic import so the browser bundle for /signin doesn't pull Redis.
  const [{ rateLimitCheck }, { getRateLimitStore }] = await Promise.all([
    import("@brain/core"),
    import("./rate-limit-store.js"),
  ]);
  const store = await getRateLimitStore();
  const key = `voucher:${clientIp || "unknown"}`;
  const result = await rateLimitCheck(store, key, VOUCHER_ATTEMPT_LIMIT, Date.now());
  return { ok: result.ok, remaining: result.remaining, resetAt: result.resetAt };
}

export interface ClaimParams {
  code: string;
  email: string;
  name: string | null;
  image: string | null;
  roleIfAdmin?: "admin";
  /**
   * Pre-computed bcrypt hash for an email+password registration. When set, a
   * `UserCredential` row is created for the new user inside the same
   * transaction so the voucher claim and the password are committed together
   * (or not at all). Omitted for the OAuth path, where there is no password.
   *
   * Hash *before* calling — bcrypt is intentionally ~200ms and we don't want
   * to hold the voucher row lock for that long.
   */
  passwordHash?: string;
}

export type ClaimResult =
  | { ok: true; userId: string; voucherId: string }
  | { ok: false; reason: VoucherFailure };

/**
 * Atomically validate + claim + create user. Race-safe — two parallel claims
 * on the last seat of a multi-use voucher cannot both succeed because the
 * row is locked for update inside the transaction.
 *
 * Called from `auth.ts::signIn` after OAuth returns a verified email.
 */
export async function claimVoucher(params: ClaimParams): Promise<ClaimResult> {
  const code = normalize(params.code);
  if (!code) return { ok: false, reason: "invalid" };
  const email = params.email.toLowerCase();

  return db.$transaction(async (tx) => {
    // Lock the voucher row for the duration of this transaction so concurrent
    // claims queue up instead of racing the usedCount check.
    const [locked] = await tx.$queryRaw<
      Array<{
        id: string;
        disabled: boolean;
        expiresAt: Date | null;
        usedCount: number;
        maxUses: number;
      }>
    >`
      SELECT id, disabled, "expiresAt", "usedCount", "maxUses"
      FROM "VoucherCode"
      WHERE code = ${code}
      FOR UPDATE
    `;
    if (!locked) return { ok: false, reason: "invalid" } as const;

    const failure = pickFailure(locked);
    if (failure) return { ok: false, reason: failure } as const;

    const user = await tx.user.create({
      data: {
        email,
        name: params.name,
        image: params.image,
        role: params.roleIfAdmin === "admin" ? "admin" : "user",
      },
    });

    if (params.passwordHash) {
      await tx.userCredential.create({
        data: { userId: user.id, passwordHash: params.passwordHash },
      });
    }

    await tx.voucherCode.update({
      where: { id: locked.id },
      data: { usedCount: { increment: 1 } },
    });

    await tx.voucherRedemption.create({
      data: { voucherId: locked.id, userId: user.id },
    });

    return { ok: true, userId: user.id, voucherId: locked.id } as const;
  });
}
