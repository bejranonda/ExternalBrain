/**
 * The owner gate — the predicate that decides whose Knowledge rows may be
 * returned by the two raw pgvector surfaces (kra.ts, oracle.ts).
 *
 * This is the highest-consequence predicate in the codebase. It is ANDed in
 * FRONT of `buildRawProjectFilterV2`, whose `visibility = 'project'` arm
 * deliberately carries no owner predicate — so the gate is the only thing
 * standing between that arm and a cross-tenant read.
 *
 * Until 2026-08-03 the gate was a bare `"ownerUserId" = $2`: safe, and also
 * the reason Phase-4 org sharing silently did not apply over MCP. These tests
 * pin the widened form, and specifically pin what it must still REFUSE.
 */
import { describe, it, expect } from "vitest";
import { buildOwnerGate, buildRawProjectFilterV2 } from "../scope-filter.js";

describe("buildOwnerGate — no accessible projects (the historical form)", () => {
  it("emits exactly the old predicate, byte for byte", () => {
    const { sql, params } = buildOwnerGate("$2", [], 5);
    // Any drift here changes behaviour for every caller that never opted in.
    expect(sql).toBe('"ownerUserId" = $2');
    expect(params).toEqual([]);
  });

  it("binds no parameters, so caller param indices are unshifted", () => {
    expect(buildOwnerGate("$2", [], 3).params).toHaveLength(0);
  });
});

describe("buildOwnerGate — with verified org membership", () => {
  const gate = buildOwnerGate("$2", ["p1", "p2"], 5);

  it("still admits the caller's own rows", () => {
    expect(gate.sql).toContain('"ownerUserId" = $2');
  });

  it("admits ONLY visibility='org' rows across the owner boundary", () => {
    // The literal 'org' is the whole containment story: a row the author did
    // not explicitly mark as shared must never cross to another user.
    expect(gate.sql).toContain(`"visibility" = 'org'`);
    expect(gate.sql).not.toContain(`"visibility" = 'project'`);
    expect(gate.sql).not.toContain(`"visibility" = 'private'`);
  });

  it("bounds the widening to the supplied project list", () => {
    expect(gate.sql).toContain(`"ownerProjectId" = ANY($5::text[])`);
    expect(gate.params).toEqual([["p1", "p2"]]);
  });

  it("keeps the two arms disjoined, never replacing the owner pin", () => {
    // If OR ever became AND, or the pin were dropped, the gate would stop
    // returning the caller's own rows / stop bounding anything.
    expect(gate.sql).toMatch(/\("ownerUserId" = \$2 OR \(/);
  });

  it("parameterises the project list rather than interpolating it", () => {
    const injected = buildOwnerGate("$2", ["p1'); DROP TABLE \"Knowledge\"; --"], 5);
    // The hostile value must appear only in params, never in the SQL text.
    expect(injected.sql).not.toContain("DROP TABLE");
    expect(injected.params[0]).toContain("p1'); DROP TABLE \"Knowledge\"; --");
  });
});

describe("owner gate + project filter — the composition that actually runs", () => {
  // The gate is meaningless in isolation: what protects a tenant is the gate
  // ANDed in front of the project filter. These assert the shape of the pair.
  const args = {
    userId: "u-me",
    activeProjectId: "p1",
    activeOrgId: "o1",
    accessibleProjectIds: ["p1", "p2"],
    scope: "project" as const,
    includeUserScopeAcrossProjects: true,
  };

  it("the project filter DOES contain an owner-agnostic arm — which is why the gate must exist", () => {
    const { sql } = buildRawProjectFilterV2(args, 3);
    // Documented and intended (it is what makes org sharing expressible).
    // Asserting it here so that if someone ever "fixes" it by adding an owner
    // predicate, this test explains why the gate was built.
    expect(sql).toContain(`("visibility" = 'project' AND "ownerProjectId" = $3)`);
  });

  it("gate params come after filter params, so indices cannot collide", () => {
    const filter = buildRawProjectFilterV2(args, 3);
    const gate = buildOwnerGate("$2", args.accessibleProjectIds, 3 + filter.params.length);
    // The gate's placeholder must be strictly beyond every filter placeholder.
    const filterMax = 2 + filter.params.length;
    const gateIndex = Number(/\$(\d+)::text\[\]/.exec(gate.sql)![1]);
    expect(gateIndex).toBeGreaterThan(filterMax);
  });
});

describe("what the gate must never do", () => {
  it("does not widen when the membership list is empty — a non-member gets nothing", () => {
    // getAccessibleProjectIds() returns [] for a non-member, so this IS the
    // non-member path. It must collapse to the owner-only pin.
    const { sql } = buildOwnerGate("$2", [], 3);
    expect(sql).not.toContain("visibility");
    expect(sql).toBe('"ownerUserId" = $2');
  });

  it("never emits an unbounded org arm", () => {
    // A gate that admitted `visibility='org'` with no project bound would
    // return every org-shared row in the entire installation.
    const { sql } = buildOwnerGate("$2", ["p1"], 3);
    const orgArm = /\("visibility" = 'org' AND ([^)]+)\)/.exec(sql);
    expect(orgArm).not.toBeNull();
    expect(orgArm![1]).toContain("ownerProjectId");
  });
});
