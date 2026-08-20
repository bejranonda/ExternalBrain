/**
 * One project-resolution rule across brain_start_session, brain_teach_knowledge
 * and brain_ask_oracle.
 *
 * The three disagreed, and every disagreement was invisible because all three
 * returned success (KNOWN_ISSUES §0ar): teach accepted only `projectId` and so
 * filed EVERY rule ever taught from this repo under the fallback project;
 * ask_oracle accepted no project at all and read the fallback project only, so
 * knowledge correctly filed under a named project became unreadable by it.
 * Following the documented per-call scoping discipline therefore hid knowledge.
 *
 * These tests pin the precedence order and — as much as the shape allows — the
 * fact that a fallback is REPORTED rather than silent.
 */
import { describe, it, expect, vi } from "vitest";
import { resolveProjectForCall, FORBIDDEN_PROJECT } from "../scope.js";
import type { AuthContext } from "../auth.js";

const unscoped = { userId: "u1", projectId: null } as unknown as AuthContext;
const scoped = { userId: "u1", projectId: "proj_token" } as unknown as AuthContext;

function deps(overrides: Partial<Parameters<typeof resolveProjectForCall>[2]> = {}) {
  return {
    userCanAccessProject: vi.fn(async () => true),
    ensureNamedProject: vi.fn(async () => ({ projectId: "proj_named" })),
    getUserProjects: vi.fn(async () => [{ id: "proj_first", name: "First" }]),
    ensureDefaultProject: vi.fn(async () => ({ projectId: "proj_default", name: "Default" })),
    ...overrides,
  } as Parameters<typeof resolveProjectForCall>[2];
}

const hint = (n: string) => `fell back to ${n}`;

describe("resolveProjectForCall", () => {
  it("lets a scoped token win outright, ignoring nothing and asking nothing", async () => {
    const d = deps();
    const r = await resolveProjectForCall(scoped, {}, d, hint);
    expect(r).toMatchObject({ projectId: "proj_token", source: "token_scope" });
    // The token IS the scope: no lookups, and never a fallback hint.
    expect(d.getUserProjects).not.toHaveBeenCalled();
    expect(r.hint).toBeUndefined();
  });

  it("rejects a scoped token asked for a different project rather than narrowing", async () => {
    await expect(
      resolveProjectForCall(scoped, { projectId: "other" }, deps(), hint),
    ).rejects.toThrow(FORBIDDEN_PROJECT);
  });

  it("accepts a matching projectId on a scoped token", async () => {
    const r = await resolveProjectForCall(scoped, { projectId: "proj_token" }, deps(), hint);
    expect(r.projectId).toBe("proj_token");
  });

  it("prefers an explicit projectId over a name", async () => {
    const d = deps();
    const r = await resolveProjectForCall(
      unscoped,
      { projectId: "proj_explicit", projectName: "Ignored" },
      d,
      hint,
    );
    expect(r).toMatchObject({ projectId: "proj_explicit", source: "explicit_id" });
    expect(d.ensureNamedProject).not.toHaveBeenCalled();
  });

  it("refuses a projectId the user cannot access", async () => {
    await expect(
      resolveProjectForCall(
        unscoped,
        { projectId: "someone_elses" },
        deps({ userCanAccessProject: vi.fn(async () => false) }),
        hint,
      ),
    ).rejects.toThrow(FORBIDDEN_PROJECT);
  });

  it("resolves projectName, creating on demand — the parameter teach used to lack", async () => {
    const d = deps();
    const r = await resolveProjectForCall(unscoped, { projectName: "External Brain" }, d, hint);
    expect(r).toMatchObject({
      projectId: "proj_named",
      projectName: "External Brain",
      source: "explicit_name",
    });
    expect(d.ensureNamedProject).toHaveBeenCalledWith("u1", "External Brain");
    // An explicitly named project is not a fallback, so no nag.
    expect(r.hint).toBeUndefined();
  });

  it("REPORTS the fallback instead of falling back silently", async () => {
    const r = await resolveProjectForCall(unscoped, {}, deps(), hint);
    expect(r).toMatchObject({ projectId: "proj_first", source: "default_fallback" });
    // The whole defect was that this was silent: callers believed their rule
    // had been filed under the project they were working in.
    expect(r.hint).toBe("fell back to First");
  });

  it("creates a default project when the user has none, still reporting the fallback", async () => {
    const r = await resolveProjectForCall(
      unscoped,
      {},
      deps({ getUserProjects: vi.fn(async () => []) }),
      hint,
    );
    expect(r).toMatchObject({ projectId: "proj_default", source: "default_fallback" });
    expect(r.hint).toBe("fell back to Default");
  });
});
