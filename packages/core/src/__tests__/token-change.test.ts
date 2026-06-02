/**
 * Unit tests for the token-change (in-place secret swap) logic.
 *
 * The change endpoint is distinct from rotate:
 *   - Same row id, same name/scope/userId/teamId/expiresAt/createdAt.
 *   - Fresh tokenHash replaces the old one immediately — no grace window.
 *   - No scheduledRevokeAt, no rotatedFromId.
 *   - Old secret stops working the instant tokenHash is overwritten.
 *
 * DB interactions and the HTTP layer are not tested here.
 */
import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────────
// Pure helpers extracted from the change endpoint logic.
// ──────────────────────────────────────────────────────────────────────────────

function generateRaw(): string {
  return `bp_${randomBytes(32).toString("base64url")}`;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Simulate the 409 guard logic from the change endpoint.
 * Returns the error code if the token should be rejected, null if it can proceed.
 */
function changeGuard(token: {
  revokedAt: Date | null;
  scheduledRevokeAt: Date | null;
  expiresAt: Date | null;
}, now: Date): string | null {
  if (token.revokedAt !== null) return "TOKEN_ALREADY_REVOKED";
  if (token.scheduledRevokeAt !== null) return "ROTATION_ALREADY_PENDING";
  if (token.expiresAt !== null && token.expiresAt <= now) return "TOKEN_EXPIRED";
  return null;
}

/**
 * Simulate the in-place hash swap: preserves all fields except tokenHash.
 */
function applyChange(
  token: {
    id: string;
    name: string;
    scope: string;
    userId: string;
    teamId: string | null;
    expiresAt: Date | null;
    createdAt: Date;
    tokenHash: string;
    scheduledRevokeAt: Date | null;
    rotatedFromId: string | null;
  },
  newTokenHash: string,
) {
  return { ...token, tokenHash: newTokenHash };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

const BASE = new Date("2026-04-27T10:00:00.000Z");

const SAMPLE_TOKEN = {
  id: "tok_001",
  name: "my-token",
  scope: "personal",
  userId: "usr_abc",
  teamId: null,
  expiresAt: new Date(BASE.getTime() + 90 * 86_400_000),
  createdAt: new Date(BASE.getTime() - 5 * 86_400_000),
  tokenHash: hashToken("bp_old"),
  revokedAt: null as Date | null,
  scheduledRevokeAt: null as Date | null,
  rotatedFromId: null as string | null,
};

describe("token.change — in-place hash swap", () => {
  it("preserves the same id after a change", () => {
    const raw = generateRaw();
    const newHash = hashToken(raw);
    const updated = applyChange(SAMPLE_TOKEN, newHash);
    expect(updated.id).toBe(SAMPLE_TOKEN.id);
  });

  it("tokenHash differs after a change", () => {
    const raw = generateRaw();
    const newHash = hashToken(raw);
    const updated = applyChange(SAMPLE_TOKEN, newHash);
    expect(updated.tokenHash).not.toBe(SAMPLE_TOKEN.tokenHash);
    expect(updated.tokenHash).toBe(newHash);
  });

  it("preserves name, scope, userId, teamId, expiresAt, createdAt", () => {
    const raw = generateRaw();
    const updated = applyChange(SAMPLE_TOKEN, hashToken(raw));
    expect(updated.name).toBe(SAMPLE_TOKEN.name);
    expect(updated.scope).toBe(SAMPLE_TOKEN.scope);
    expect(updated.userId).toBe(SAMPLE_TOKEN.userId);
    expect(updated.teamId).toBe(SAMPLE_TOKEN.teamId);
    expect(updated.expiresAt).toBe(SAMPLE_TOKEN.expiresAt);
    expect(updated.createdAt).toBe(SAMPLE_TOKEN.createdAt);
  });

  it("scheduledRevokeAt stays null — no grace period", () => {
    const raw = generateRaw();
    const updated = applyChange(SAMPLE_TOKEN, hashToken(raw));
    expect(updated.scheduledRevokeAt).toBeNull();
  });

  it("rotatedFromId stays null — not a rotation chain", () => {
    const raw = generateRaw();
    const updated = applyChange(SAMPLE_TOKEN, hashToken(raw));
    expect(updated.rotatedFromId).toBeNull();
  });

  it("two successive changes produce different hashes (collision-free)", () => {
    const hash1 = hashToken(generateRaw());
    const hash2 = hashToken(generateRaw());
    expect(hash1).not.toBe(hash2);
  });
});

describe("token.change — 409 guard", () => {
  it("allows a healthy active token", () => {
    const result = changeGuard(SAMPLE_TOKEN, BASE);
    expect(result).toBeNull();
  });

  it("rejects an already-revoked token", () => {
    const token = { ...SAMPLE_TOKEN, revokedAt: new Date(BASE.getTime() - 1000) };
    expect(changeGuard(token, BASE)).toBe("TOKEN_ALREADY_REVOKED");
  });

  it("rejects a token with a pending rotation", () => {
    const token = {
      ...SAMPLE_TOKEN,
      scheduledRevokeAt: new Date(BASE.getTime() + 3_600_000),
    };
    expect(changeGuard(token, BASE)).toBe("ROTATION_ALREADY_PENDING");
  });

  it("rejects a token exactly at expiry (boundary — expiry <= now)", () => {
    const token = { ...SAMPLE_TOKEN, expiresAt: BASE }; // expiresAt == now
    expect(changeGuard(token, BASE)).toBe("TOKEN_EXPIRED");
  });

  it("rejects a token past its expiry", () => {
    const token = {
      ...SAMPLE_TOKEN,
      expiresAt: new Date(BASE.getTime() - 1),
    };
    expect(changeGuard(token, BASE)).toBe("TOKEN_EXPIRED");
  });

  it("allows a token that expires strictly in the future", () => {
    const token = {
      ...SAMPLE_TOKEN,
      expiresAt: new Date(BASE.getTime() + 1),
    };
    expect(changeGuard(token, BASE)).toBeNull();
  });

  it("allows a no-expiry token (expiresAt === null)", () => {
    const token = { ...SAMPLE_TOKEN, expiresAt: null };
    expect(changeGuard(token, BASE)).toBeNull();
  });
});

describe("token.change — raw token format", () => {
  it("generated raw token has the bp_ prefix", () => {
    const raw = generateRaw();
    expect(raw.startsWith("bp_")).toBe(true);
  });

  it("generated raw token is long enough (>= 40 chars)", () => {
    const raw = generateRaw();
    expect(raw.length).toBeGreaterThanOrEqual(40);
  });

  it("SHA-256 hash of raw token is 64 hex chars", () => {
    const raw = generateRaw();
    const hash = hashToken(raw);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
