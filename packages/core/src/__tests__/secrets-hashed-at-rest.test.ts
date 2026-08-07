import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashSecret } from "../secret-hash.js";

/**
 * No bearer-style secret is stored raw.
 *
 * Named after the invariant, not the two models that violated it.
 * `PasswordResetToken.token` and `OrganizationInvite.token` persisted the exact
 * value emailed to the user, so database read access — a leaked dump, a
 * compromised credential, an operator — was equivalent to holding every live
 * reset link (1 h) and invite (7 d). `MCPToken.tokenHash` in the same schema
 * was already SHA-256: the rule existed and was applied inconsistently, which
 * is precisely the shape a per-model review keeps missing.
 *
 * This reads the schema rather than the call sites on purpose. A test that
 * checked "forgot-password hashes its token" would pass while the next model
 * added a raw one; the property that matters is about the whole schema.
 */

const SCHEMA = readFileSync(
  join(__dirname, "..", "..", "..", "db", "prisma", "schema.prisma"),
  "utf8",
);

/**
 * Columns permitted to hold a raw credential-ish value, each with a reason.
 * Adding to this list should require justifying why the value cannot be hashed.
 */
const ALLOWED_RAW = new Set([
  // Counters on the LLM cost ledger — "tokens" as in billing units, not creds.
  "OracleCostLedger.tokensInput",
  "OracleCostLedger.tokensOutput",
  // FK to Session.id, not a secret.
  "Session.tokenId",
  // bcrypt (cost 12) — deliberately NOT sha256: passwords are low-entropy and
  // human-chosen, so they need a slow salted KDF, not a fast digest.
  "UserCredential.passwordHash",
]);

/**
 * Parse `model X { … }` blocks into SCALAR { model, field } pairs.
 *
 * Relation fields are excluded: `token MCPToken? @relation(...)` on Session is
 * a link to the token row, not a stored secret, and flagging it would train
 * the reader to ignore this test's output. Prisma scalars are lowercase
 * (`String`, `Int`, …) or lowercase-typed enums; a capitalised type is a model
 * reference.
 */
function schemaFields(): { model: string; field: string; line: string }[] {
  const out: { model: string; field: string; line: string }[] = [];
  let current: string | null = null;
  for (const raw of SCHEMA.split("\n")) {
    const line = raw.trim();
    const m = /^model\s+(\w+)\s*\{/.exec(line);
    if (m) {
      current = m[1]!;
      continue;
    }
    if (line === "}") {
      current = null;
      continue;
    }
    if (!current || line.startsWith("//") || line.startsWith("@@")) continue;
    const f = /^(\w+)\s+([A-Za-z]\w*)/.exec(line);
    if (!f) continue;
    const type = f[2]!;
    const isRelation = /^[A-Z]/.test(type) && !/^(String|Int|Float|Boolean|DateTime|Json|Bytes|Decimal|BigInt)$/.test(type);
    if (isRelation || line.includes("@relation")) continue;
    out.push({ model: current, field: f[1]!, line });
  }
  return out;
}

describe("bearer-style secrets are hashed at rest", () => {
  const fields = schemaFields();

  it("parsed the schema (guards against a silent no-op)", () => {
    // A parser that matched nothing would make every assertion below vacuous.
    expect(fields.length).toBeGreaterThan(50);
    expect(fields.some((f) => f.model === "MCPToken")).toBe(true);
  });

  it("no model stores a credential in a column named `token`/`secret`", () => {
    const offenders = fields
      .filter((f) => /^(token|secret|apiKey|accessToken|refreshToken)$/i.test(f.field))
      .map((f) => `${f.model}.${f.field}`)
      .filter((k) => !ALLOWED_RAW.has(k));

    expect(
      offenders,
      `Store the SHA-256 digest and name the column \`tokenHash\` (see ` +
        `packages/core/src/secret-hash.ts). A column named \`token\` invites ` +
        `the next author to compare it against user input directly, which is ` +
        `how KNOWN_ISSUES §0w happened.`,
    ).toEqual([]);
  });

  it("the two models that regressed now carry tokenHash", () => {
    for (const model of ["PasswordResetToken", "OrganizationInvite"]) {
      const has = fields.some(
        (f) => f.model === model && f.field === "tokenHash",
      );
      expect(has, `${model} must store tokenHash, not a raw token`).toBe(true);
    }
  });

  it("hashSecret is a stable, non-reversible sha256 hex digest", () => {
    const raw = "bp_example_secret_value";
    const h = hashSecret(raw);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain(raw);
    // Deterministic — lookup by hash only works if the same input maps to the
    // same digest every time (no per-call salt, unlike a password KDF).
    expect(hashSecret(raw)).toBe(h);
    expect(hashSecret(raw + "x")).not.toBe(h);
  });
});
