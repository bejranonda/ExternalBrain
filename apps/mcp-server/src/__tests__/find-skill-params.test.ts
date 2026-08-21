/**
 * Placeholder/parameter agreement in the skill-search raw query.
 *
 * `brain_find_skill` emitted `$3` only when a `stage` was supplied but passed
 * `input.stage` as a third argument unconditionally, so every call WITHOUT a
 * stage — the default, and the shape every tool description advertises — died
 * at bind time with Postgres 08P01 ("bind message supplies 3 parameters, but
 * prepared statement requires 2") before a single row was read.
 *
 * It went unnoticed because the Skill table is empty on this instance, so no
 * one had a reason to call the tool; when it was finally called during a
 * validation sweep, the error read like a database fault rather than a
 * query-construction one.
 *
 * These tests pin the invariant that actually matters and is cheap to check
 * without a database: the number of distinct `$n` placeholders the query emits
 * equals the number of arguments bound, for every combination of options.
 */
import { describe, it, expect } from "vitest";

/**
 * Mirrors the build-together shape used in the handler (and in
 * packages/db/src/index.ts::searchKnowledgeByEmbedding). Kept as a local
 * replica because the handler needs a live DB and an embedding provider to
 * run, while the defect is purely in how the string and the array are built.
 */
function buildSkillQuery(opts: { stage?: string }): { sql: string; params: unknown[] } {
  const params: unknown[] = ["[0.1,0.2]", "user_1"];
  const stageCond = opts.stage
    ? (params.push(opts.stage), `AND stage = $${params.length}`)
    : "";
  const sql = `
    SELECT id FROM "Skill"
    WHERE embedding IS NOT NULL
      AND "ownerUserId" = $2
      ${stageCond}
    ORDER BY embedding <=> $1::vector ASC
  `;
  return { sql, params };
}

/** Distinct `$n` markers in the emitted SQL. */
function placeholderCount(sql: string): number {
  return new Set(sql.match(/\$\d+/g) ?? []).size;
}

/** Highest `$n` used — catches numbering GAPS, which Postgres rejects. */
function maxPlaceholder(sql: string): number {
  const ns = (sql.match(/\$(\d+)/g) ?? []).map((m) => Number(m.slice(1)));
  return ns.length === 0 ? 0 : Math.max(...ns);
}

describe("brain_find_skill query construction", () => {
  it("binds exactly as many params as it emits placeholders — WITHOUT stage", () => {
    // The regression: this combination bound 3 params against 2 placeholders.
    const { sql, params } = buildSkillQuery({});
    expect(placeholderCount(sql)).toBe(params.length);
    expect(maxPlaceholder(sql)).toBe(params.length);
  });

  it("binds exactly as many params as it emits placeholders — WITH stage", () => {
    const { sql, params } = buildSkillQuery({ stage: "knowledge" });
    expect(placeholderCount(sql)).toBe(params.length);
    expect(maxPlaceholder(sql)).toBe(params.length);
  });

  it("numbers placeholders contiguously from $1, leaving no gap", () => {
    // A conditional fragment that hardcodes `$3` while `$2` is omitted
    // produces $1 and $3 with no $2 — Postgres rejects the gap outright, and
    // that is exactly how the sibling helper in packages/db was broken.
    for (const opts of [{}, { stage: "wisdom" }]) {
      const { sql, params } = buildSkillQuery(opts);
      const used = new Set((sql.match(/\$(\d+)/g) ?? []).map((m) => Number(m.slice(1))));
      for (let i = 1; i <= params.length; i += 1) {
        expect(used.has(i)).toBe(true);
      }
    }
  });

  it("adds the stage predicate only when a stage was supplied", () => {
    expect(buildSkillQuery({}).sql).not.toContain("stage =");
    expect(buildSkillQuery({ stage: "notes" }).sql).toContain("stage =");
  });
});
