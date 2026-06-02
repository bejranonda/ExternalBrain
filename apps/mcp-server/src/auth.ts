/**
 * MCP token authentication.
 *
 * Tokens are stored as SHA-256 hashes in the DB. The raw token is shown to
 * the user exactly once at creation time.
 */
import { createHash } from "node:crypto";
import { db } from "@brain/db";

export interface AuthContext {
  userId: string;
  teamId: string | null;
  scope: "personal" | "team";
  tokenId: string;
  // Phase 3c: org/project scoping. null = any project the user has access to.
  organizationId: string | null;
  projectId: string | null;
}

export async function authenticate(
  rawToken: string | undefined,
): Promise<AuthContext> {
  if (!rawToken) {
    throw new Error(
      "Missing BRAIN_MCP_TOKEN. Create one at https://brain.example/settings/tokens",
    );
  }
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const token = await db.mCPToken.findUnique({
    where: { tokenHash },
  });
  if (!token || token.revokedAt) throw new Error("Invalid token");
  // Honor the grace-period rotation cutover. A token with scheduledRevokeAt in
  // the past is effectively revoked even before the worker tick cleans it up.
  if (token.scheduledRevokeAt && token.scheduledRevokeAt.getTime() <= Date.now()) {
    throw new Error("Invalid token");
  }
  if (token.expiresAt && token.expiresAt < new Date()) {
    throw new Error("Token expired");
  }

  await db.mCPToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    userId: token.userId,
    teamId: token.teamId,
    scope: token.scope as "personal" | "team",
    tokenId: token.id,
    organizationId: token.organizationId ?? null,
    projectId: token.projectId ?? null,
  };
}
