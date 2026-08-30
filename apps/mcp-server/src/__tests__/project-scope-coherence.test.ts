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
import { resolveProjectForCall, FORBIDDEN_PROJECT, PROJECT_NOT_FOUND } from "../scope.js";
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

  it("creates a named project on a WRITE when none exists", async () => {
    const d = deps();
    const r = await resolveProjectForCall(
      unscoped,
      { projectName: "Brand New" },
      d,
      hint,
      { allowCreate: true },
    );
    expect(r).toMatchObject({ projectId: "proj_named", source: "explicit_name" });
    // Third arg carries framework/language so a project created by name is
    // typed the same as one created by brain_create_project.
    expect(d.ensureNamedProject).toHaveBeenCalledWith("u1", "Brand New", {});
    expect(r.hint).toBeUndefined();
  });

  it("prefers an EXISTING accessible project over creating a personal-org duplicate", async () => {
    // ensureNamedProject resolves/creates only inside the personal org, so a
    // shared-org project reached by name used to be shadowed by a new empty
    // duplicate — and a decision written there was invisible to teammates.
    const d = deps({
      getUserProjects: vi.fn(async () => [{ id: "proj_shared", name: "Acme API" }]),
    });
    const r = await resolveProjectForCall(
      unscoped,
      { projectName: "acme api" },
      d,
      hint,
      { allowCreate: true },
    );
    expect(r).toMatchObject({ projectId: "proj_shared", source: "explicit_name" });
    expect(d.ensureNamedProject).not.toHaveBeenCalled();
  });

  it("REFUSES to create on a READ — a typo must not conjure an empty project", async () => {
    // brain_ask_oracle answering from a freshly-created empty project reads as
    // "you have no knowledge about that", the most misleading possible reply.
    const d = deps();
    await expect(
      resolveProjectForCall(unscoped, { projectName: "Typoed Nmae" }, d, hint),
    ).rejects.toThrow(PROJECT_NOT_FOUND);
    expect(d.ensureNamedProject).not.toHaveBeenCalled();
  });

  it("matches an existing project by name case-insensitively on a read", async () => {
    const d = deps({
      getUserProjects: vi.fn(async () => [{ id: "proj_eb", name: "External Brain" }]),
    });
    const r = await resolveProjectForCall(unscoped, { projectName: "  external brain " }, d, hint);
    expect(r).toMatchObject({ projectId: "proj_eb", source: "explicit_name" });
  });

  it("rejects a scoped token given a projectName it is not bound to", async () => {
    // The id path already threw; the name path used to narrow silently, so a
    // contractor token scoped to A that named B was answered from A.
    const d = deps({
      getUserProjects: vi.fn(async () => [
        { id: "proj_token", name: "Mine" },
        { id: "proj_other", name: "Theirs" },
      ]),
    });
    await expect(
      resolveProjectForCall(scoped, { projectName: "Theirs" }, d, hint),
    ).rejects.toThrow(FORBIDDEN_PROJECT);
  });

  it("accepts a scoped token given its own project by name", async () => {
    const d = deps({
      getUserProjects: vi.fn(async () => [{ id: "proj_token", name: "Mine" }]),
    });
    const r = await resolveProjectForCall(scoped, { projectName: "Mine" }, d, hint);
    expect(r).toMatchObject({ projectId: "proj_token", source: "token_scope" });
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

describe("start_session reporting signals", () => {
  it("reports `ambiguous` only when the fallback had a real choice to make", async () => {
    // brain_start_session hints selectively on this: a solo user with one
    // project is not making a mistake, and hinting every session trains them
    // to ignore hints entirely.
    const one = await resolveProjectForCall(unscoped, {}, deps(), hint);
    expect(one.ambiguous).toBe(false);

    const many = await resolveProjectForCall(
      unscoped,
      {},
      deps({
        getUserProjects: vi.fn(async () => [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ]),
      }),
      hint,
    );
    expect(many.ambiguous).toBe(true);
  });

  it("reports `created` so 'we made you a project' is distinguishable from 'we picked one'", async () => {
    const picked = await resolveProjectForCall(unscoped, {}, deps(), hint);
    expect(picked.created).toBe(false);

    const made = await resolveProjectForCall(
      unscoped,
      {},
      deps({
        getUserProjects: vi.fn(async () => []),
        ensureDefaultProject: vi.fn(async () => ({
          projectId: "proj_default",
          name: "Default",
          created: true,
        })),
      }),
      hint,
    );
    expect(made.created).toBe(true);
  });

  it("passes framework/language through when creating a project by name", async () => {
    const d = deps();
    await resolveProjectForCall(
      unscoped,
      { projectName: "Typed" },
      d,
      hint,
      { allowCreate: true, framework: "nextjs", language: "typescript" },
    );
    expect(d.ensureNamedProject).toHaveBeenCalledWith("u1", "Typed", {
      framework: "nextjs",
      language: "typescript",
    });
  });
});

/**
 * The fallback now SUGGESTS where the call probably belonged.
 *
 * The fallback takes `projects[0]` (oldest-first) — the auto-created "Default"
 * for essentially every user — and the hint asked for a `projectName` while
 * naming none, which is not an instruction a caller can follow. Measured on
 * prod 2026-08-30: an agent following the documented discipline still filed
 * four rules into Default in one session, one of which superseded a rule about
 * not doing exactly that.
 */
describe("fallback suggestions", () => {
  const threeProjects = {
    getUserProjects: vi.fn(async () => [
      { id: "proj_default", name: "Default", framework: null, language: null },
      { id: "proj_eb", name: "External Brain", framework: "nextjs", language: "typescript" },
    ]),
  };

  it("ranks the other projects and never re-suggests the one it picked", async () => {
    const r = await resolveProjectForCall(unscoped, {}, deps(threeProjects), hint, {
      allowCreate: true,
      signalText: "audit the docs for the External Brain repo",
    });
    expect(r.source).toBe("default_fallback");
    expect(r.suggestions?.map((s) => s.projectId)).toEqual(["proj_eb"]);
    expect(r.suggestions?.[0]?.name).toBe("External Brain");
  });

  it("passes the signal through, so the hint can name a concrete project", async () => {
    // The bug this guards: wiring the ranker but forgetting to feed it. The
    // ranker would then return every project at score 0 and the hint would
    // degrade to a bare list — working, useless, and silent about it.
    const named = vi.fn((n: string, s: Array<{ name: string }>) =>
      `${n}|${s.map((x) => x.name).join(",")}`,
    );
    const r = await resolveProjectForCall(unscoped, {}, deps(threeProjects), named, {
      allowCreate: true,
      signalText: "External Brain docs",
    });
    expect(r.hint).toBe("Default|External Brain");
  });

  it("omits suggestions entirely for a user with only the fallback project", async () => {
    const r = await resolveProjectForCall(unscoped, {}, deps(), hint, { allowCreate: true });
    expect(r.suggestions).toBeUndefined();
  });

  it("does not suggest when the caller named a project — nothing to correct", async () => {
    const r = await resolveProjectForCall(
      unscoped,
      { projectName: "External Brain" },
      deps(threeProjects),
      hint,
      { allowCreate: true, signalText: "anything" },
    );
    expect(r.source).toBe("explicit_name");
    expect(r.suggestions).toBeUndefined();
    expect(r.hint).toBeUndefined();
  });

  it("never AUTO-REDIRECTS: the resolved project is still the fallback", async () => {
    // Suggesting is safe; silently rerouting a write to a better-fitting
    // project would turn a visible misfile into an invisible one, and the
    // caller would have no way to tell where their rule went.
    const r = await resolveProjectForCall(unscoped, {}, deps(threeProjects), hint, {
      allowCreate: true,
      signalText: "External Brain External Brain External Brain",
    });
    expect(r.projectId).toBe("proj_default");
  });
});
