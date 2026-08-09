/**
 * POST /api/onboard/claim  →  anonymous voucher → MCP-token exchange.
 *
 * The one endpoint that lets an AI agent onboard its user without a browser.
 * The caller proves nothing except possession of a voucher code, and receives
 * a working bearer — so this route is the security surface of the whole
 * agentic-onboarding feature. Read `docs/superpowers/specs/
 * 2026-08-08-agentic-onboarding-design.md` before changing the gate order.
 *
 * Body: { voucher, email, label?, client?, os? }
 *
 * Deliberately NOT here:
 *  - No password. The User is created without a UserCredential; the human
 *    claims web access via forgot-password. An agent that invents a password
 *    leaks it into the transcript and the user never learns it.
 *  - No token for an existing account. `email_taken` is a hard stop — minting
 *    for an existing user would make any voucher an account-takeover primitive.
 *
 * Gate order mirrors /api/auth/register, including the reason its email lookup
 * comes *after* voucher validation (anonymous account enumeration).
 */
import { z } from "zod";
import { headers } from "next/headers";
import { db } from "@brain/db";
import { getLogger, rateLimitCheck, writeAudit } from "@brain/core";
import { clientById, type ClientId, type TargetOS } from "@brain/core/install-snippets";
import { getRateLimitStore } from "@/lib/brain/rate-limit-store";
import { publicUrlsFromEnv } from "@/lib/brain/skill-template";
import {
  checkVoucherRateLimit,
  claimVoucher,
  validateVoucher,
} from "@/lib/brain/vouchers";
import {
  agenticOnboardingEnabled,
  bootstrapInstallCommand,
  setPasswordUrl,
  startUrl,
  BOOTSTRAP_TOKEN_CAPABILITIES,
  BOOTSTRAP_TOKEN_NAME,
  BOOTSTRAP_TOKEN_TTL_DAYS,
} from "@/lib/brain/agentic-onboarding";

const log = getLogger("onboard-claim");

export const dynamic = "force-dynamic";

// Tighter than /api/auth/register's 5/hour because each success mints a live
// bearer, not merely an account that still needs a password to be useful.
const LIMIT = { name: "onboard-claim", max: 5, windowMs: 60 * 60 * 1000 };

const bodySchema = z.object({
  voucher: z.string().min(1),
  email: z
    .string()
    .email()
    .transform((e) => e.toLowerCase().trim()),
  label: z.string().max(80).optional(),
  client: z.string().optional(),
  os: z.enum(["darwin", "linux", "win32"]).optional(),
});

export async function POST(req: Request): Promise<Response> {
  if (!agenticOnboardingEnabled()) {
    return Response.json(
      {
        error: "agentic_onboarding_disabled",
        message:
          "This Brain does not accept agentic onboarding. Set AGENTIC_ONBOARDING=true to enable it, or sign up in a browser.",
      },
      { status: 403 },
    );
  }

  const hdrs = await headers();
  const xff = hdrs.get("x-forwarded-for");
  const ip = xff ? xff.split(",")[0]!.trim() : "local";

  const store = await getRateLimitStore();
  const gate = await rateLimitCheck(store, `onboard-claim:${ip}`, LIMIT, Date.now());
  if (!gate.ok) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const { voucher, email, label, os } = parsed;

  // Unknown client ids degrade to the default rather than 400 — an agent on a
  // newer/older vocabulary should still get onboarded, just with the generic
  // installer invocation. Same "narrow, don't reject" posture as
  // sanitizeCapabilities in /api/tokens.
  const client: ClientId | undefined = parsed.client
    ? clientById(parsed.client)?.id
    : undefined;

  // --- Voucher brute-force limiter (SHARED counter with /signin, on purpose:
  // two surfaces validating the same code space must not grant 10 guesses each) ---
  const vGate = await checkVoucherRateLimit(ip);
  if (!vGate.ok) {
    return Response.json({ error: "voucher_rate_limited" }, { status: 429 });
  }

  // --- Validate the voucher BEFORE looking the email up ---
  // Without this ordering an anonymous caller could skip the voucher entirely
  // and enumerate registered accounts through the email_taken response.
  const pre = await validateVoucher(voucher);
  if (!pre.ok) {
    return Response.json({ error: `voucher_${pre.reason}` }, { status: 400 });
  }

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    // Hard stop. Do NOT mint for the existing user, and do NOT invite a retry
    // with a different address — that is voucher-funded account squatting.
    return Response.json(
      {
        error: "email_taken",
        message:
          "That email already has an account on this Brain. Sign in and mint a token from /settings/tokens instead.",
      },
      { status: 409 },
    );
  }

  const { mcpUrl, webUrl } = publicUrlsFromEnv();

  // --- The exchange: voucher burn + user + org + project + token, atomically ---
  let result: Awaited<ReturnType<typeof claimVoucher>>;
  try {
    result = await claimVoucher({
      code: voucher,
      email,
      name: null,
      image: null,
      bootstrapToken: {
        name: label ? `${BOOTSTRAP_TOKEN_NAME} — ${label}` : BOOTSTRAP_TOKEN_NAME,
        ttlDays: BOOTSTRAP_TOKEN_TTL_DAYS,
        capabilities: BOOTSTRAP_TOKEN_CAPABILITIES,
      },
    });
  } catch (err) {
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return Response.json({ error: "email_taken" }, { status: 409 });
    }
    log.error({ err, op: "onboard.claim", outcome: "error" }, "voucher exchange failed");
    return Response.json({ error: "internal" }, { status: 500 });
  }

  if (!result.ok) {
    // Lost the race between validate and claim (last seat taken, or disabled
    // in between).
    return Response.json({ error: `voucher_${result.reason}` }, { status: 400 });
  }

  if (!result.rawToken) {
    // Unreachable: bootstrapToken was supplied, so claimVoucher returns a raw
    // secret. Refuse loudly rather than hand back a 201 with no token — a
    // success response the caller cannot act on is the silent-failure mode
    // this repo keeps rediscovering.
    log.error(
      { op: "onboard.claim", outcome: "error", userId: result.userId },
      "claim succeeded without minting a token",
    );
    return Response.json({ error: "internal" }, { status: 500 });
  }

  const install = bootstrapInstallCommand({
    token: result.rawToken,
    mcpUrl,
    webUrl,
    ...(client ? { client } : {}),
    ...(os ? { os: os as TargetOS } : {}),
  });

  // Awaited so a process restart can't drop the row, but NOT allowed to fail
  // the request.
  //
  // /api/tokens awaits this and lets a throw become a 500, and that is right
  // there: the caller has a session and can simply mint again. The precedent
  // does not transfer here. By this line the voucher is burned, the user and
  // token rows are committed, and `rawToken` exists only in this response —
  // there is no second copy and no session to retry from. A 500 would strand
  // the user holding a spent code, which is precisely the failure the
  // single-transaction design above exists to prevent; throwing it away over a
  // log write would be absurd.
  //
  // The audit row is the recoverable half: VoucherRedemption + MCPToken still
  // record that this happened, so the event is reconstructable. Logged at
  // error level with the ids needed to backfill.
  try {
    await writeAudit({
      actorUserId: result.userId,
      action: "onboard.claim",
      targetType: "user",
      targetId: result.userId,
      payload: {
        voucherId: result.voucherId,
        client: install.client,
        os: install.os,
        capabilities: [...BOOTSTRAP_TOKEN_CAPABILITIES],
        expiresAt: result.tokenExpiresAt ?? null,
      },
      ip,
      userAgent: req.headers.get("user-agent") ?? null,
    });
  } catch (err) {
    log.error(
      {
        err,
        op: "onboard.claim",
        outcome: "error",
        userId: result.userId,
        voucherId: result.voucherId,
      },
      "onboard.claim succeeded but its audit row failed to persist — backfill from VoucherRedemption",
    );
  }

  return Response.json(
    {
      ok: true,
      token: result.rawToken,
      expiresAt: result.tokenExpiresAt,
      capabilities: BOOTSTRAP_TOKEN_CAPABILITIES,
      mcpUrl,
      webUrl,
      // null for `jetbrains` / `rest`, which have no one-liner. Agents must
      // fall back to `manualSetup` rather than assume a command is always here.
      installCommand: install.command,
      manualSetup: install.manualLines,
      client: install.client,
      setPasswordUrl: setPasswordUrl(webUrl, email),
      startUrl: startUrl(webUrl),
      // Surfaced so the agent can tell the user why Oracle 403s rather than
      // letting them read a scoped token as a broken product.
      notes: [
        `This token expires in ${BOOTSTRAP_TOKEN_TTL_DAYS} days and cannot call the Oracle. Set a password at the setPasswordUrl, then mint a full token at ${webUrl}/settings/tokens.`,
      ],
    },
    { status: 201 },
  );
}
