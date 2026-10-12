/**
 * Email ownership — the defence against pre-account takeover (KNOWN_ISSUES §0az).
 *
 * Every signup path stores the email it was given without proving it. Until
 * someone proves control of that inbox, whoever registered the address first
 * may not be its owner: they can hold a password, MCP tokens and live web
 * sessions on an account the real owner is about to start using. Proof is the
 * moment to evict all of that — once, the first time.
 */
import { db, type Prisma } from "@brain/db";

type Tx = typeof db | Prisma.TransactionClient;

export interface OwnershipProof {
  /** True when this proof is the first for the account. */
  firstProof: boolean;
  /** MCP tokens revoked because they predate the first proof. */
  tokensRevoked: number;
}

/**
 * Record that the person acting now controls the account's inbox, and sign
 * out every web session issued before this instant.
 *
 * On the FIRST proof, also revoke every live MCP token: they were minted by
 * whoever held the account before anyone proved the address, which may not be
 * the person proving it now. Later proofs (an owner who simply forgot their
 * password) keep tokens — revoking a verified owner's agents on every reset
 * would punish the common case for a threat that no longer applies.
 */
export async function proveEmailOwnership(
  tx: Tx,
  userId: string,
  now: Date = new Date(),
): Promise<OwnershipProof> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  if (!user) return { firstProof: false, tokensRevoked: 0 };

  const firstProof = user.emailVerifiedAt === null;
  let tokensRevoked = 0;
  if (firstProof) {
    const r = await tx.mCPToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    tokensRevoked = r.count;
  }
  await tx.user.update({
    where: { id: userId },
    data: {
      sessionsRevokedAt: now,
      ...(firstProof ? { emailVerifiedAt: now } : {}),
    },
  });
  return { firstProof, tokensRevoked };
}

/**
 * Whether a web session that authenticated at `authAtMs` is still valid.
 * A user who no longer exists has no valid sessions.
 */
export async function sessionStillValid(
  userId: string,
  authAtMs: number,
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { sessionsRevokedAt: true },
  });
  if (!user) return false;
  if (!user.sessionsRevokedAt) return true;
  return authAtMs >= user.sessionsRevokedAt.getTime();
}

/**
 * The GitHub account's primary email, lowercased — only if GitHub has verified
 * it. NextAuth's GitHub provider picks the primary address without checking
 * `verified`, so the provider's `user.email` alone is not proof. Fails closed:
 * any API error returns null.
 */
export async function githubVerifiedPrimaryEmail(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "external-brain",
      },
    });
    if (!res.ok) return null;
    const emails = (await res.json()) as Array<{
      email?: unknown;
      primary?: unknown;
      verified?: unknown;
    }>;
    if (!Array.isArray(emails)) return null;
    const primary = emails.find((e) => e.primary === true);
    if (!primary || primary.verified !== true || typeof primary.email !== "string") {
      return null;
    }
    return primary.email.toLowerCase();
  } catch {
    return null;
  }
}
