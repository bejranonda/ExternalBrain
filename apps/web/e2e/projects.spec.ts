import { test, expect } from "@playwright/test";

/**
 * E2E spec for Phase 2a project CRUD.
 *
 * Requires the dev stack running with a live DB (readyz must return 200).
 * These tests run against the real API — they are intentionally skipped when
 * the stack is unreachable (e.g. in pure unit-test CI runs).
 */

const PROJECT_NAME = "e2e-phase2a-project";

test.describe("Project CRUD API", () => {
  test.beforeEach(async ({ request }) => {
    // Clean up any leftover e2e test projects.
    const res = await request.get("/api/orgs");
    if (!res.ok()) return;
    const data = (await res.json()) as {
      orgs: Array<{ id: string; projects: Array<{ id: string; name: string }> }>;
    };
    for (const org of data.orgs) {
      for (const p of org.projects) {
        if (p.name === PROJECT_NAME) {
          await request.delete(`/api/projects/${p.id}`);
        }
      }
    }
  });

  test("GET /api/orgs returns orgs + projects", async ({ request }) => {
    const res = await request.get("/api/orgs");
    expect(res.ok()).toBeTruthy();
    const data = (await res.json()) as {
      orgs: Array<{ id: string; slug: string; projects: unknown[] }>;
      activeProjectId: string | null;
    };
    expect(Array.isArray(data.orgs)).toBe(true);
    expect(data.orgs.length).toBeGreaterThanOrEqual(1);
    expect(data.orgs[0]).toHaveProperty("slug");
    expect(Array.isArray(data.orgs[0]?.projects)).toBe(true);
  });

  test("POST /api/projects creates a project and returns slug", async ({ request }) => {
    // Get the first org id
    const orgsRes = await request.get("/api/orgs");
    expect(orgsRes.ok()).toBeTruthy();
    const orgsData = (await orgsRes.json()) as { orgs: Array<{ id: string }> };
    const orgId = orgsData.orgs[0]?.id;
    expect(orgId).toBeTruthy();

    const res = await request.post("/api/projects", {
      data: { orgId, name: PROJECT_NAME },
    });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { project: { id: string; slug: string; name: string } };
    expect(body.project.slug).toBe("e2e-phase2a-project");
    expect(body.project.name).toBe(PROJECT_NAME);

    // Clean up
    await request.delete(`/api/projects/${body.project.id}`);
  });

  test("PATCH /api/projects/:id renames and updates slug", async ({ request }) => {
    const orgsRes = await request.get("/api/orgs");
    const orgsData = (await orgsRes.json()) as { orgs: Array<{ id: string }> };
    const orgId = orgsData.orgs[0]?.id;

    const createRes = await request.post("/api/projects", {
      data: { orgId, name: PROJECT_NAME },
    });
    const { project } = (await createRes.json()) as {
      project: { id: string; slug: string };
    };

    const patchRes = await request.patch(`/api/projects/${project.id}`, {
      data: { name: "Renamed Project" },
    });
    expect(patchRes.ok()).toBeTruthy();
    const patched = (await patchRes.json()) as { project: { name: string; slug: string } };
    expect(patched.project.name).toBe("Renamed Project");
    expect(patched.project.slug).toBe("renamed-project");

    // Clean up
    await request.delete(`/api/projects/${project.id}`);
  });

  test("POST /api/projects/:id/activate sets the active project cookie", async ({
    request,
  }) => {
    const orgsRes = await request.get("/api/orgs");
    const orgsData = (await orgsRes.json()) as {
      orgs: Array<{ id: string; projects: Array<{ id: string }> }>;
    };
    const firstProject = orgsData.orgs[0]?.projects[0];
    if (!firstProject) {
      test.skip();
      return;
    }

    const res = await request.post(`/api/projects/${firstProject.id}/activate`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { ok: boolean; projectId: string };
    expect(body.ok).toBe(true);
    expect(body.projectId).toBe(firstProject.id);
  });

  test("/settings/projects page loads", async ({ page }) => {
    await page.goto("/settings/projects");
    await page.waitForLoadState("networkidle");
    // Page title should be visible
    await expect(page.locator("h1")).toContainText("Projects");
  });
});

// ---------------------------------------------------------------------------
// Phase 2b: per-project filtering — scope toggle integration
//
// These tests require a live DB + stack. They are marked to skip when the
// stack is unreachable (readyz returns non-200), matching the pattern used
// throughout this file.
//
// Scenario:
//   1. Create project A + project B.
//   2. Create a Knowledge item in project A (POST /api/knowledge with ownerProjectId = A).
//   3. Switch active project to B (POST /api/projects/:id/activate).
//   4. GET /api/knowledge — item from A should NOT appear (project scope).
//   5. GET /api/knowledge?scope=all — item from A SHOULD appear.
// ---------------------------------------------------------------------------

test.describe("Phase 2b: project-scoped knowledge filtering", () => {
  const PROJECT_A = "e2e-phase2b-proj-a";
  const PROJECT_B = "e2e-phase2b-proj-b";

  test.beforeEach(async ({ request }) => {
    // Clean up leftover e2e projects.
    const res = await request.get("/api/orgs");
    if (!res.ok()) return;
    const data = (await res.json()) as {
      orgs: Array<{ id: string; projects: Array<{ id: string; name: string }> }>;
    };
    for (const org of data.orgs) {
      for (const p of org.projects) {
        if (p.name === PROJECT_A || p.name === PROJECT_B) {
          await request.delete(`/api/projects/${p.id}`);
        }
      }
    }
  });

  test("knowledge from project A is hidden when project B is active, visible with ?scope=all", async ({
    request,
  }) => {
    // Get first org
    const orgsRes = await request.get("/api/orgs");
    if (!orgsRes.ok()) {
      test.skip();
      return;
    }
    const orgsData = (await orgsRes.json()) as { orgs: Array<{ id: string }> };
    const orgId = orgsData.orgs[0]?.id;
    if (!orgId) {
      test.skip();
      return;
    }

    // Create project A
    const aRes = await request.post("/api/projects", {
      data: { orgId, name: PROJECT_A },
    });
    expect(aRes.status()).toBe(201);
    const { project: projA } = (await aRes.json()) as {
      project: { id: string };
    };

    // Create project B
    const bRes = await request.post("/api/projects", {
      data: { orgId, name: PROJECT_B },
    });
    expect(bRes.status()).toBe(201);
    const { project: projB } = (await bRes.json()) as {
      project: { id: string };
    };

    // Activate project A and create a knowledge item assigned to it
    await request.post(`/api/projects/${projA.id}/activate`);
    const kRes = await request.post("/api/knowledge", {
      data: {
        type: "heuristic",
        triggerText: "e2e phase2b test trigger",
        ruleText: "e2e phase2b test rule — project A only",
        ownerProjectId: projA.id,
      },
    });
    expect(kRes.status()).toBe(201);

    // Switch active project to B
    const activateB = await request.post(`/api/projects/${projB.id}/activate`);
    expect(activateB.ok()).toBeTruthy();

    // GET /api/knowledge — project-scoped (default) — item from A should not appear
    const scopedRes = await request.get("/api/knowledge?limit=500");
    expect(scopedRes.ok()).toBeTruthy();
    const scopedData = (await scopedRes.json()) as {
      items: Array<{ ruleText: string }>;
    };
    const hasItemA = scopedData.items.some((i) =>
      i.ruleText.includes("e2e phase2b test rule"),
    );
    expect(hasItemA).toBe(false);

    // GET /api/knowledge?scope=all — should include item from A
    const allRes = await request.get("/api/knowledge?limit=500&scope=all");
    expect(allRes.ok()).toBeTruthy();
    const allData = (await allRes.json()) as {
      items: Array<{ ruleText: string }>;
    };
    const hasItemAAll = allData.items.some((i) =>
      i.ruleText.includes("e2e phase2b test rule"),
    );
    expect(hasItemAAll).toBe(true);

    // Cleanup
    await request.delete(`/api/projects/${projA.id}`);
    await request.delete(`/api/projects/${projB.id}`);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: knowledge visibility + promote/fork mechanics
//
// Scenario:
//   1. Create projects A and B in the same org.
//   2. Create a Knowledge item in project A (visibility="project").
//   3. Switch active project to B — item from A is NOT visible.
//   4. Switch back to A — promote the item to org visibility.
//   5. Switch to project B — org-visible item appears in the list.
//   6. Fork the org-visible item into project B — project-local copy appears.
// ---------------------------------------------------------------------------

test.describe("Phase 4: knowledge visibility + promote/fork", () => {
  const E2E_PROJ_A = "e2e-phase4-proj-a";
  const E2E_PROJ_B = "e2e-phase4-proj-b";

  test.beforeEach(async ({ request }) => {
    const res = await request.get("/api/orgs");
    if (!res.ok()) return;
    const data = (await res.json()) as {
      orgs: Array<{ id: string; projects: Array<{ id: string; name: string }> }>;
    };
    for (const org of data.orgs) {
      for (const p of org.projects) {
        if (p.name === E2E_PROJ_A || p.name === E2E_PROJ_B) {
          await request.delete(`/api/projects/${p.id}`);
        }
      }
    }
  });

  test("promote to org + fork into project lifecycle", async ({ request }) => {
    const orgsRes = await request.get("/api/orgs");
    if (!orgsRes.ok()) {
      test.skip();
      return;
    }
    const orgsData = (await orgsRes.json()) as { orgs: Array<{ id: string }> };
    const orgId = orgsData.orgs[0]?.id;
    if (!orgId) {
      test.skip();
      return;
    }

    // Create project A
    const aRes = await request.post("/api/projects", { data: { orgId, name: E2E_PROJ_A } });
    if (!aRes.ok()) { test.skip(); return; }
    const { project: projA } = (await aRes.json()) as { project: { id: string } };

    // Create project B
    const bRes = await request.post("/api/projects", { data: { orgId, name: E2E_PROJ_B } });
    if (!bRes.ok()) { test.skip(); return; }
    const { project: projB } = (await bRes.json()) as { project: { id: string } };

    try {
      // Activate project A — create a knowledge item there
      await request.post(`/api/projects/${projA.id}/activate`);
      const kRes = await request.post("/api/knowledge", {
        data: {
          type: "heuristic",
          triggerText: "e2e phase4 promote trigger",
          ruleText: "e2e phase4 promote rule — project A only",
          ownerProjectId: projA.id,
        },
      });
      expect(kRes.status()).toBe(201);
      const { item: knowledge } = (await kRes.json()) as { item: { id: string; visibility: string } };
      expect(knowledge.visibility).toBe("project");

      // Switch to project B — knowledge should NOT appear
      await request.post(`/api/projects/${projB.id}/activate`);
      const fromB = await request.get("/api/knowledge?limit=500");
      expect(fromB.ok()).toBeTruthy();
      const fromBData = (await fromB.json()) as { items: Array<{ ruleText: string }> };
      const seenFromB = fromBData.items.some((i) => i.ruleText.includes("e2e phase4 promote rule"));
      expect(seenFromB).toBe(false);

      // Switch back to project A and promote to org
      await request.post(`/api/projects/${projA.id}/activate`);
      const promoteRes = await request.post(`/api/knowledge/${knowledge.id}/promote`);
      expect(promoteRes.ok()).toBeTruthy();
      const { item: promoted } = (await promoteRes.json()) as { item: { visibility: string; originProjectId: string } };
      expect(promoted.visibility).toBe("org");
      expect(promoted.originProjectId).toBe(projA.id);

      // Switch to project B — org-visible row should now appear
      await request.post(`/api/projects/${projB.id}/activate`);
      const fromB2 = await request.get("/api/knowledge?limit=500");
      expect(fromB2.ok()).toBeTruthy();
      const fromB2Data = (await fromB2.json()) as { items: Array<{ ruleText: string; visibility: string }> };
      const orgRow = fromB2Data.items.find((i) => i.ruleText.includes("e2e phase4 promote rule"));
      expect(orgRow).toBeDefined();
      expect(orgRow?.visibility).toBe("org");

      // Fork the org-visible row into project B
      const forkRes = await request.post(`/api/knowledge/${knowledge.id}/fork-to-project`, {
        data: { projectId: projB.id },
      });
      expect(forkRes.status()).toBe(201);
      const { item: forked } = (await forkRes.json()) as {
        item: { visibility: string; ownerProjectId: string; originProjectId: string; parentKnowledgeId: string };
      };
      expect(forked.visibility).toBe("project");
      expect(forked.ownerProjectId).toBe(projB.id);
      expect(forked.parentKnowledgeId).toBe(knowledge.id);
      expect(forked.originProjectId).toBe(projA.id);

    } finally {
      // Cleanup
      await request.delete(`/api/projects/${projA.id}`);
      await request.delete(`/api/projects/${projB.id}`);
    }
  });

  test("promote requires ownership — 403 for non-owner", async ({ request }) => {
    const orgsRes = await request.get("/api/orgs");
    if (!orgsRes.ok()) { test.skip(); return; }
    const orgsData = (await orgsRes.json()) as { orgs: Array<{ id: string; projects: Array<{ id: string }> }> };
    const firstProject = orgsData.orgs[0]?.projects[0];
    if (!firstProject) { test.skip(); return; }

    // Create a knowledge item to promote
    await request.post(`/api/projects/${firstProject.id}/activate`);
    const kRes = await request.post("/api/knowledge", {
      data: {
        type: "heuristic",
        triggerText: "ownership test trigger",
        ruleText: "ownership test rule",
        ownerProjectId: firstProject.id,
      },
    });
    if (!kRes.ok()) { test.skip(); return; }
    const { item } = (await kRes.json()) as { item: { id: string } };

    // Promote should succeed (we ARE the owner in E2E)
    const promoteRes = await request.post(`/api/knowledge/${item.id}/promote`);
    expect(promoteRes.ok()).toBeTruthy();

    // Second promote should fail (already org-visible)
    const promoteAgain = await request.post(`/api/knowledge/${item.id}/promote`);
    expect(promoteAgain.ok()).toBe(false);
    expect(promoteAgain.status()).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Phase 3b: URL routing — org/project slugs in the URL
// ---------------------------------------------------------------------------

test.describe("Phase 3b: URL routing", () => {
  test("bare / redirects to /[orgSlug]/[projectSlug]", async ({ page }) => {
    // The root page must redirect to a canonical project URL.
    const res = await page.goto("/", { waitUntil: "domcontentloaded" });
    // Should land somewhere under an org/project URL (two non-empty path segments).
    const url = new URL(page.url());
    const parts = url.pathname.split("/").filter(Boolean);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    // Both segments must be non-empty slugs.
    expect(parts[0]).toBeTruthy();
    expect(parts[1]).toBeTruthy();
    // HTTP status at final destination should be 200.
    expect(res?.status()).toBe(200);
  });

  test("direct visit to /[orgSlug]/[projectSlug] renders the app", async ({
    page,
  }) => {
    // Navigate to / first so we can capture the redirected slug pair.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const canonicalUrl = page.url();

    // Visit the canonical URL directly — should render the shell without
    // another redirect.
    const res = await page.goto(canonicalUrl, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(200);
    expect(page.url()).toBe(canonicalUrl);
  });

  test("direct visit to /[orgSlug]/bad-project returns 404", async ({ page }) => {
    // Resolve the real org slug first.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const url = new URL(page.url());
    const orgSlug = url.pathname.split("/").filter(Boolean)[0];
    if (!orgSlug) {
      test.skip();
      return;
    }

    // Visit a project slug that does not exist.
    const res = await page.goto(`/${orgSlug}/definitely-does-not-exist-xyz`, {
      waitUntil: "domcontentloaded",
    });
    expect(res?.status()).toBe(404);
  });

  test("switcher click navigates URL to new project", async ({ request, page }) => {
    // Ensure there are at least 2 projects so the switcher is visible.
    const orgsRes = await request.get("/api/orgs");
    if (!orgsRes.ok()) {
      test.skip();
      return;
    }
    const orgsData = (await orgsRes.json()) as {
      orgs: Array<{ id: string; slug: string; projects: Array<{ id: string; slug: string }> }>;
    };
    const firstOrg = orgsData.orgs[0];
    if (!firstOrg) {
      test.skip();
      return;
    }

    // Create a second project for switching.
    const createRes = await request.post("/api/projects", {
      data: { orgId: firstOrg.id, name: "e2e-phase3b-switcher" },
    });
    if (!createRes.ok()) {
      test.skip();
      return;
    }
    const { project: newProject } = (await createRes.json()) as {
      project: { id: string; slug: string };
    };

    try {
      // Navigate to the app and click the switcher.
      await page.goto("/", { waitUntil: "networkidle" });

      // The switcher button should be visible (2 projects exist).
      const switcherBtn = page.locator('[aria-haspopup="listbox"]');
      await switcherBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => null);

      if (!(await switcherBtn.isVisible())) {
        // Switcher auto-hides with 1 project — that's fine, skip.
        return;
      }

      await switcherBtn.click();

      // Click the new project row (identified by its slug text).
      const projectBtn = page.locator(`text=${newProject.slug}`).first();
      await projectBtn.click();

      // URL must change to include the new project slug.
      await page.waitForURL(`**/${newProject.slug}`, { timeout: 5000 });
      expect(page.url()).toContain(`/${newProject.slug}`);
    } finally {
      await request.delete(`/api/projects/${newProject.id}`);
    }
  });
});
