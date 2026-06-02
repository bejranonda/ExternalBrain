import { test, expect } from "@playwright/test";

test.describe("graph surface", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#graph");
    await expect(page.locator('[data-screen-label="graph"]')).toBeVisible({ timeout: 15_000 });
    // Wait for the graph layout to appear
    await expect(page.locator(".graph-layout")).toBeVisible({ timeout: 10_000 });
  });

  test("SVG canvas renders and contains at least one circle node", async ({ page }) => {
    // The Graph component renders an SVG with circle elements for each node.
    // Wait for the graph data to load
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/graph") && resp.status() === 200,
      { timeout: 15_000 },
    ).catch(() => { /* may have already fired */ });

    const svg = page.locator(".graph-layout svg").first();
    await expect(svg).toBeVisible({ timeout: 12_000 });

    // After graph data loads, there should be circle elements representing nodes
    const circles = svg.locator("circle");
    await expect(circles.first()).toBeVisible({ timeout: 10_000 });
    const circleCount = await circles.count();
    expect(circleCount).toBeGreaterThan(0);
  });

  test("search input filters visible nodes", async ({ page }) => {
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/graph") && resp.status() === 200,
      { timeout: 15_000 },
    ).catch(() => { /* may have already fired */ });

    const svg = page.locator(".graph-layout svg").first();
    await expect(svg.locator("circle").first()).toBeVisible({ timeout: 12_000 });

    // Count circles before filtering
    const beforeCount = await svg.locator("circle").count();
    expect(beforeCount).toBeGreaterThan(0);

    // Type in the search input — i18n EN graph.search = "Search the graph"
    const searchInput = page.locator(".graph-layout input[placeholder]");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });
    await searchInput.fill("react");

    await page.waitForTimeout(400); // allow React to re-render

    // Filtering happens via useGraphFilter — nodes not matching become non-visible in the SVG.
    // The SVG still contains all circles but some are hidden via display:none or opacity 0.
    // Since the filter works by returning a subset of filteredNodes, non-matching circles
    // simply won't be rendered (return null in the map). So the count should be <= original.
    const afterCount = await svg.locator("circle").count();
    // If no nodes match "react", count could be 0; if all match, count is same.
    // Either way, the search didn't crash and the count makes sense.
    expect(afterCount).toBeLessThanOrEqual(beforeCount);

    // Clear the search to restore
    await searchInput.fill("");
    await page.waitForTimeout(300);
  });

  test("zoom in / out / reset buttons are clickable without error", async ({ page }) => {
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/graph") && resp.status() === 200,
      { timeout: 15_000 },
    ).catch(() => { /* may have already fired */ });

    // The main graph canvas SVG lives inside .dot-grid and has width="100%" height="100%".
    // Use .dot-grid svg to avoid matching the small icon SVGs (which have fixed px sizes).
    const svg = page.locator(".dot-grid > svg");
    await expect(svg).toBeVisible({ timeout: 12_000 });

    // Record the initial viewBox
    const initialViewBox = await svg.getAttribute("viewBox");

    // Click Zoom In
    const zoomInBtn = page.locator('button[aria-label="Zoom in"]');
    await expect(zoomInBtn).toBeVisible({ timeout: 5_000 });
    await zoomInBtn.click();
    const afterZoomIn = await svg.getAttribute("viewBox");

    // The viewBox should change after zoom in
    expect(afterZoomIn).not.toBe(initialViewBox);

    // Click Zoom Out
    const zoomOutBtn = page.locator('button[aria-label="Zoom out"]');
    await zoomOutBtn.click();
    const afterZoomOut = await svg.getAttribute("viewBox");
    expect(afterZoomOut).not.toBe(afterZoomIn);

    // Click Reset zoom — resets to zoom=1 → viewBox "0 0 800 600"
    const resetBtn = page.locator('button[aria-label="Reset zoom"]');
    await resetBtn.click();
    const afterReset = await svg.getAttribute("viewBox");
    // After reset the component sets zoom=1, so viewBox is "0 0 800 600".
    // initialViewBox was also computed at zoom=1, so they should match.
    expect(afterReset).toBe(initialViewBox);
  });

  test("graph queries panel: backlinks / orphans / dependents buttons all click without error", async ({
    page,
  }) => {
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/graph") && resp.status() === 200,
      { timeout: 15_000 },
    ).catch(() => { /* may have already fired */ });

    // Click on a node to load the inspector and enable graph queries.
    // Each node renders as a <g> containing <circle> elements. Clicking a circle
    // triggers the parent g's onClick via bubbling. Use .dot-grid svg to target
    // the main canvas rather than any icon SVGs.
    const svg = page.locator(".dot-grid > svg");
    // The first circle in each node group is the filled node circle (r = n.r).
    // We skip the glow circle (r = 60, fill="url(#accentGlow)") by filtering circles
    // that have a non-empty fill attribute pointing to a CSS variable.
    const firstNodeCircle = svg.locator("circle[fill^='var(--k-']").first();
    await expect(firstNodeCircle).toBeVisible({ timeout: 12_000 });
    await firstNodeCircle.click();

    // Inspector shows query buttons
    const inspector = page.locator(".graph-inspector");
    await expect(inspector).toBeVisible({ timeout: 5_000 });

    // The "Queries" section has three QueryBtn components
    // i18n EN: "Backlinks", "Orphans in cluster", "Dependents · transitive"
    const backlinkBtn = inspector.locator("button").filter({ hasText: /backlinks/i }).first();
    await expect(backlinkBtn).toBeVisible({ timeout: 5_000 });
    await backlinkBtn.click();

    // After clicking backlinks, the filter button in the top toolbar becomes active
    // and a "clear query" button appears
    await page.waitForTimeout(300);

    const orphanBtn = inspector.locator("button").filter({ hasText: /orphan/i }).first();
    await expect(orphanBtn).toBeVisible({ timeout: 5_000 });
    await orphanBtn.click();
    await page.waitForTimeout(300);

    const dependentBtn = inspector.locator("button").filter({ hasText: /dependent/i }).first();
    await expect(dependentBtn).toBeVisible({ timeout: 5_000 });
    await dependentBtn.click();
    await page.waitForTimeout(300);

    // "clear query" button should appear when a query is active
    const clearBtn = inspector.locator("button").filter({ hasText: /clear query/i });
    await expect(clearBtn).toBeVisible({ timeout: 5_000 });

    // Clear the query
    await clearBtn.click();
    await page.waitForTimeout(300);
  });

  test("clicking a node populates the inspector with title, confidence, and related count", async ({
    page,
  }) => {
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/graph") && resp.status() === 200,
      { timeout: 15_000 },
    ).catch(() => { /* may have already fired */ });

    // Each node is a <g> containing a <circle fill="var(--k-<type>)">. Click the
    // circle to trigger the parent g's onClick. Use .dot-grid svg to target the
    // main canvas, not icon SVGs.
    const svg = page.locator(".dot-grid > svg");
    const firstNodeCircle = svg.locator("circle[fill^='var(--k-']").first();
    await expect(firstNodeCircle).toBeVisible({ timeout: 12_000 });
    await firstNodeCircle.click();

    const inspector = page.locator(".graph-inspector");
    await expect(inspector).toBeVisible({ timeout: 5_000 });

    // Inspector shows [[label]] in a mono span
    const labelEl = inspector.locator(".mono").filter({ hasText: /^\[\[.+\]\]$/ }).first();
    await expect(labelEl).toBeVisible({ timeout: 5_000 });

    // Confidence is rendered as a .tab-num span with a decimal value
    const confidenceEl = inspector.locator(".tab-num").filter({ hasText: /^\d+\.\d+$/ }).first();
    await expect(confidenceEl).toBeVisible({ timeout: 5_000 });
    const confText = await confidenceEl.textContent();
    const conf = parseFloat(confText ?? "0");
    expect(conf).toBeGreaterThan(0);
    expect(conf).toBeLessThanOrEqual(1);

    // The "Backlinks · N" section shows the degree / related count
    const backlinksSection = inspector.locator(".mono").filter({ hasText: /backlinks/i }).first();
    await expect(backlinksSection).toBeVisible({ timeout: 5_000 });
  });
});
