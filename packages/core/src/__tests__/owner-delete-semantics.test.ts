import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every relation to an "owner-ish" model (User, Organization, Team) must
 * declare an explicit `onDelete` strategy — not rely on Prisma's implicit
 * default.
 *
 * Named after the invariant, not the one model that violated it (#218).
 * `Project.organizationId` had no cascade, so deleting an Organization that
 * still owned projects failed with a raw, unhandled Postgres FK-violation
 * 500 instead of a decided behavior. The `User` graph got this right early
 * — every FK referencing `User` is `onDelete: Cascade` — but the
 * `Organization`/`Team` graphs grew without the same discipline. This is
 * the repo's recurring shape (`KNOWN_ISSUES §0u/§0v/§0w/§0ab/§0ac`): a rule
 * the codebase already knows, applied to some owner graphs but not others.
 *
 * Explicit is the property that matters, not any one specific strategy —
 * `Cascade`, `Restrict`, and `SetNull` are all legitimate answers depending
 * on the model (see `Project.organization`'s own comment for why Restrict
 * was chosen there). What's not legitimate is a relation to an owner model
 * with no onDelete clause at all, because that means nobody decided.
 */

const SCHEMA = readFileSync(
  join(__dirname, "..", "..", "..", "db", "prisma", "schema.prisma"),
  "utf8",
);

const OWNER_MODELS = ["User", "Organization", "Team"] as const;

interface OwnerRelation {
  model: string;
  field: string;
  target: string;
  hasOnDelete: boolean;
  line: string;
}

function ownerRelations(): OwnerRelation[] {
  const out: OwnerRelation[] = [];
  let current: string | null = null;
  for (const raw of SCHEMA.split("\n")) {
    const line = raw.trim();
    const modelMatch = /^model\s+(\w+)\s*\{/.exec(line);
    if (modelMatch) {
      current = modelMatch[1]!;
      continue;
    }
    if (line === "}") {
      current = null;
      continue;
    }
    if (!current || !line.includes("@relation(")) continue;

    const fieldMatch = /^(\w+)\s+([A-Za-z]\w*)\??\s*(?:\[\])?\s*@relation\(([^)]*)\)/.exec(line);
    if (!fieldMatch) continue;
    const [, field, target, args] = fieldMatch;
    if (!OWNER_MODELS.includes(target as (typeof OWNER_MODELS)[number])) continue;

    // Self-relations on the owner model itself (none currently exist, but a
    // future `Organization.parentOrgId` shouldn't be exempted by accident)
    // are still in scope — the target is what matters, not the source.
    out.push({
      model: current,
      field: field!,
      target: target!,
      hasOnDelete: /onDelete\s*:/.test(args!),
      line,
    });
  }
  return out;
}

describe("owner-ish models (User/Organization/Team) have decided delete semantics", () => {
  const relations = ownerRelations();

  it("parsed the schema (guards against a silent no-op)", () => {
    // A parser that matched nothing would make every assertion below vacuous.
    expect(relations.length).toBeGreaterThan(5);
    expect(relations.some((r) => r.target === "Organization")).toBe(true);
    expect(relations.some((r) => r.target === "User")).toBe(true);
  });

  it("every relation to User, Organization, or Team declares onDelete explicitly", () => {
    const undecided = relations
      .filter((r) => !r.hasOnDelete)
      .map((r) => `${r.model}.${r.field} -> ${r.target}`);

    expect(
      undecided,
      `A relation to an owner-ish model with no explicit onDelete means ` +
        `nobody decided what happens on delete — the exact gap #218 found ` +
        `(Project.organizationId -> Organization, no cascade, unhandled 500). ` +
        `Add onDelete: Cascade / Restrict / SetNull and document why.`,
    ).toEqual([]);
  });

  it("Project.organization is Restrict (deliberate — see schema.prisma's own comment)", () => {
    const rel = relations.find((r) => r.model === "Project" && r.target === "Organization");
    expect(rel, "Project.organizationId -> Organization relation not found").toBeDefined();
    expect(rel!.line).toMatch(/onDelete:\s*Restrict/);
  });
});
