/**
 * Token project-scope resolution for read paths (P2-H2).
 *
 * These are the rules that stop a token labelled "scoped to project X" from
 * reading every project its owner has. Pure functions with no DB, so they run
 * standalone — the DB-backed cross-tenant assertions live in
 * cross-user-isolation.test.ts.
 */
import { describe, it, expect } from "vitest";
import { resolveReadProjectId, isProjectScoped, FORBIDDEN_PROJECT } from "../scope.js";

/** Minimal AuthContext — only the fields these helpers read. */
function auth(projectId: string | null) {
  return {
    userId: "u1",
    teamId: null,
    scope: "personal" as const,
    tokenId: "t1",
    organizationId: null,
    projectId,
  };
}

describe("resolveReadProjectId — unscoped token", () => {
  it("passes the caller's project through untouched", () => {
    expect(resolveReadProjectId(auth(null), "proj-b")).toBe("proj-b");
  });

  it("returns undefined when the caller asked for nothing", () => {
    expect(resolveReadProjectId(auth(null))).toBeUndefined();
  });

  it("does not invent a project — downstream owns the first-project fallback", () => {
    // Regression guard: resolving to some default here would silently change
    // behaviour for every existing unscoped token.
    expect(resolveReadProjectId(auth(null), undefined)).toBeUndefined();
  });
});

describe("resolveReadProjectId — scoped token", () => {
  it("supplies the token's project when the caller asks for nothing", () => {
    expect(resolveReadProjectId(auth("proj-a"))).toBe("proj-a");
  });

  it("allows a request that matches the token's project", () => {
    expect(resolveReadProjectId(auth("proj-a"), "proj-a")).toBe("proj-a");
  });

  it("REJECTS a foreign project rather than silently narrowing", () => {
    // Failing loudly beats substituting: a caller that asked for project B
    // and received project A's answers has been given wrong data, not less.
    expect(() => resolveReadProjectId(auth("proj-a"), "proj-b")).toThrow(
      FORBIDDEN_PROJECT,
    );
  });

  it("uses the same FORBIDDEN_PROJECT vocabulary as the write path", () => {
    expect(FORBIDDEN_PROJECT).toMatch(/^FORBIDDEN_PROJECT:/);
  });

  it("never returns a project the token is not bound to", () => {
    // The property that actually matters, stated directly: for a scoped
    // token, every successful resolution equals the token's own project.
    for (const requested of [undefined, "proj-a"]) {
      expect(resolveReadProjectId(auth("proj-a"), requested)).toBe("proj-a");
    }
    for (const requested of ["proj-b", "", "PROJ-A", "proj-a "]) {
      if (requested === "") {
        // Empty string is falsy — treated as "asked for nothing".
        expect(resolveReadProjectId(auth("proj-a"), requested)).toBe("proj-a");
      } else {
        expect(() => resolveReadProjectId(auth("proj-a"), requested)).toThrow();
      }
    }
  });

  it("is case-sensitive — ids are cuids, not user-entered text", () => {
    expect(() => resolveReadProjectId(auth("proj-a"), "PROJ-A")).toThrow();
  });
});

describe("isProjectScoped", () => {
  it("is false for an unscoped token and true for a bound one", () => {
    expect(isProjectScoped(auth(null))).toBe(false);
    expect(isProjectScoped(auth("proj-a"))).toBe(true);
  });
});
