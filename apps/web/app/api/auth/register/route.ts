/**
 * POST /api/auth/register
 *
 * Self-service email + password registration. The caller is anonymous.
 *
 * Body: { email: string; password: string; voucher?: string }
 *
 * Posture (secure-by-default): governed by `REGISTRATION_REQUIRES_VOUCHER`
 * (default "true"). When the gate is on, a valid voucher code is mandatory —
 * the operator mints vouchers from /admin and hands them to people they want
 * to onboard. When the operator sets the flag to "false", registration is
 * fully open and the voucher field is ignored. This is the SAME knob that
 * gates the GitHub-OAuth signup path, so "open signup" is a single decision.
 *
 * On success the user gets a brand-new account + their own personal org +
 * a default project (via ensurePersonalOrg / ensureDefaultProject), and the
 * response carries `redirectTo` so the /signin client can sign them in.
 *
 * Flow:
 *  1. Rate-limit: 5 registrations/hour per IP.
 *  2. Validate body + password policy (min 8 chars).
 *  3. Reject if a User already exists for that email.
 *  4. Gated path: claim the voucher (atomic) + create UserCredential together.
 *     Open path: create User + UserCredential directly.
 *  5. Bootstrap personal org + default project (idempotent).
 */
import bcrypt from "bcryptjs";
import { db } from "@brain/db";
import { z } from "zod";
import { headers } from "next/headers";
import {
  rateLimitCheck,
  writeAudit,
  ensurePersonalOrg,
  ensureDefaultProject,
  validatePasswordPolicy,
  BCRYPT_COST,
  getLogger,
} from "@brain/core";
import { getRateLimitStore } from "@/lib/brain/rate-limit-store";
import {
  claimVoucher,
  checkVoucherRateLimit,
  validateVoucher,
} from "@/lib/brain/vouchers";
import { registrationRequiresVoucher, adminCredentialsConfigured } from "@/auth";

const log = getLogger("register");

const LIMIT = { name: "register", max: 5, windowMs: 60 * 60 * 1000 };

const bodySchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(1),
  voucher: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  // Email+password accounts can only sign in through the Credentials provider,
  // which is only registered when ADMIN_USERNAME/ADMIN_PASSWORD_HASH are set.
  // Without it, a created account would be unusable — refuse rather than strand.
  if (!adminCredentialsConfigured()) {
    return Response.json({ error: "registration_unavailable" }, { status: 403 });
  }

  // --- Rate limit (per IP) ---
  const hdrs = await headers();
  const xff = hdrs.get("x-forwarded-for");
  const ip = xff ? xff.split(",")[0]!.trim() : "local";

  const store = await getRateLimitStore();
  const gate = await rateLimitCheck(store, `register:${ip}`, LIMIT, Date.now());
  if (!gate.ok) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  // --- Parse body ---
  let email: string;
  let password: string;
  let voucher: string | undefined;
  try {
    ({ email, password, voucher } = bodySchema.parse(await req.json()));
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  // --- Password policy (min 8) ---
  try {
    validatePasswordPolicy(password);
  } catch {
    return Response.json(
      { error: "weak_password", message: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const requiresVoucher = registrationRequiresVoucher();
  let newUserId: string;

  try {
    if (requiresVoucher) {
      const code = (voucher ?? "").trim();
      if (!code) {
        return Response.json({ error: "voucher_required" }, { status: 400 });
      }
      // Brute-force limiter for the voucher code space (shared with /signin).
      const vGate = await checkVoucherRateLimit(ip);
      if (!vGate.ok) {
        return Response.json({ error: "voucher_rate_limited" }, { status: 429 });
      }

      // Validate the voucher BEFORE revealing whether the email is registered.
      // Otherwise an anonymous caller could probe the endpoint (no voucher
      // needed) and enumerate accounts via the email_taken response. With this
      // ordering, only the holder of a valid voucher can learn email status —
      // and that's rate-limited.
      const pre = await validateVoucher(code);
      if (!pre.ok) {
        return Response.json({ error: `voucher_${pre.reason}` }, { status: 400 });
      }

      const existing = await db.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) {
        return Response.json({ error: "email_taken" }, { status: 409 });
      }

      // Hash before the transaction — bcrypt is ~200ms and claimVoucher holds
      // a row lock for the voucher's duration.
      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

      const result = await claimVoucher({
        code,
        email,
        name: null,
        image: null,
        passwordHash,
      });
      if (!result.ok) {
        // Lost a race between validate and claim (voucher exhausted/disabled).
        return Response.json(
          { error: `voucher_${result.reason}` },
          { status: 400 },
        );
      }
      newUserId = result.userId;
    } else {
      // Open registration (operator opted in via REGISTRATION_REQUIRES_VOUCHER
      // =false). Enumeration is inherent to open signup; the per-IP limiter
      // above is the mitigation.
      const existing = await db.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) {
        return Response.json({ error: "email_taken" }, { status: 409 });
      }

      // Hash outside the transaction so the bcrypt cost (~200ms) doesn't hold
      // a DB connection/row lock — mirrors the voucher path above.
      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      const created = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, role: "user" },
          select: { id: true },
        });
        await tx.userCredential.create({
          data: { userId: user.id, passwordHash },
        });
        return user;
      });
      newUserId = created.id;
    }
  } catch (err) {
    // Unique-constraint race on email — another signup won between our check
    // and the insert.
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return Response.json({ error: "email_taken" }, { status: 409 });
    }
    throw err;
  }

  // Bootstrap personal org + default project (idempotent; failures must not
  // undo the account creation — the user can still sign in and self-heal).
  try {
    await ensurePersonalOrg(db, newUserId);
    await ensureDefaultProject(db, newUserId);
  } catch (e) {
    log.error({ err: e, userId: newUserId }, "register: ensurePersonalOrg/ensureDefaultProject failed");
  }

  await writeAudit({
    actorUserId: newUserId,
    action: "user.register",
    targetType: "user",
    targetId: newUserId,
    payload: { viaVoucher: requiresVoucher },
  });

  return Response.json({ ok: true, redirectTo: "/" });
}
