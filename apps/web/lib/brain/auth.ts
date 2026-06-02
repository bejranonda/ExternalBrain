/**
 * Unified auth resolution for every API route.
 *
 * Four modes (see `auth.ts` for the full matrix):
 *   1. Credentials OR OAuth configured → require a valid JWT session;
 *      throw `not_signed_in` otherwise. The dev shim is never consulted.
 *   2. Dev shim explicitly allowed → return `DEV_USER_ID` or the first User
 *      row. Production guard applies: set `NODE_ENV=production` and unless
 *      `ALLOW_DEV_AUTH_IN_PRODUCTION=true` this path is refused at runtime.
 *   3. Unconfigured → every request throws `auth_not_configured`. No silent
 *      pass-through. This is the secure default for a freshly-deployed VM
 *      that has not yet been configured — better to be locked shut than
 *      serve every visitor as the first User row.
 *
 * The decision uses `anySignInConfigured()` — true when EITHER Credentials
 * (`ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH`) OR GitHub OAuth
 * (`AUTH_GITHUB_ID` + `AUTH_GITHUB_SECRET` + `AUTH_SECRET`) is set. Earlier
 * versions checked only OAuth; a deployment running the phase-1 Credentials-
 * only posture then fell through to the dev-shim silently.
 */
import { db } from "@brain/db";
import { getLogger } from "@brain/core";
import { auth, anySignInConfigured, devAuthAllowed } from "@/auth";

const log = getLogger("web").child({ subsystem: "auth" });

export class AuthError extends Error {
  constructor(message: string, readonly status: number = 401) {
    super(message);
  }
}

let cachedDevUserId: string | null = null;

function refuseDevShimInProduction(): void {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEV_AUTH_IN_PRODUCTION !== "true"
  ) {
    throw new AuthError(
      "dev-auth shim is refused in NODE_ENV=production. Configure NextAuth (AUTH_GITHUB_ID, AUTH_GITHUB_SECRET, AUTH_SECRET) — or set ALLOW_DEV_AUTH_IN_PRODUCTION=true if this deployment is behind a VPN.",
      500,
    );
  }
}

export async function getCurrentUserId(): Promise<string> {
  if (anySignInConfigured()) {
    const session = await auth();
    const userId = (session as { userId?: string } | null)?.userId;
    if (userId) return userId;
    // Sign-in is configured but there's no valid session — do NOT silently
    // fall through. Caller should redirect/401 as appropriate.
    throw new AuthError("not_signed_in", 401);
  }

  if (!devAuthAllowed()) {
    // No sign-in path AND no explicit dev opt-in. Refuse loudly — a deployment
    // in this state is a locked door, not an open one. The operator must
    // pick a mode before any user can reach the app.
    throw new AuthError(
      "auth_not_configured — set ADMIN_USERNAME+ADMIN_PASSWORD_HASH for credentials login, AUTH_GITHUB_ID+AUTH_GITHUB_SECRET+AUTH_SECRET for OAuth, or ALLOW_DEV_AUTH=true for local development.",
      503,
    );
  }

  refuseDevShimInProduction();

  const fromEnv = process.env.DEV_USER_ID;
  if (fromEnv) return fromEnv;

  if (cachedDevUserId) return cachedDevUserId;

  const first = await db.user.findFirst({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!first) {
    throw new AuthError(
      "No user in DB and DEV_USER_ID not set. Run the seed or set DEV_USER_ID in .env.",
      401,
    );
  }
  cachedDevUserId = first.id;
  return first.id;
}

/**
 * Translate caught AuthError / ZodError / unknown into a Next response.
 *
 * Logs server-side errors so a 500 is never a black hole — the caller
 * can grep the structured log line by the `requestId` echoed in the
 * `x-request-id` response header (set by `withApi`).
 */
export function authErrorResponse(err: unknown): Response {
  if (err instanceof AuthError) {
    log.warn(
      { err, op: "auth", outcome: "error", status: err.status },
      "auth rejected",
    );
    return Response.json({ error: err.message }, { status: err.status });
  }
  // Zod validation errors are client errors, not 500s. We detect them
  // structurally to avoid a hard import of the `zod` package here.
  if (err && typeof err === "object" && (err as { name?: string }).name === "ZodError") {
    const issues = (err as { issues?: unknown[] }).issues ?? [];
    return Response.json(
      { error: "invalid_request", issues },
      { status: 400 },
    );
  }
  log.error(
    { err, op: "api", outcome: "error", status: 500 },
    "unhandled error in route handler",
  );
  return Response.json({ error: "internal" }, { status: 500 });
}
