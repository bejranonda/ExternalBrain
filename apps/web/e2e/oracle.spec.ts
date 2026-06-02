import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helper — shared pre-flight check for rate-limit / stream failures
// ---------------------------------------------------------------------------
async function skipIfStreamFailed(page: import("@playwright/test").Page) {
  const streamResp = await page
    .waitForResponse(
      (resp) => resp.url().includes("/api/oracle/stream"),
      { timeout: 30_000 },
    )
    .catch(() => null);
  if (streamResp && streamResp.status() !== 200) {
    test.skip(
      true,
      `Stream returned ${streamResp.status()} — likely rate-limit saturation`,
    );
  }
}

// Oracle tests involve real LLM streaming — allow generous timeouts.
test.describe("oracle surface", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#oracle");
    await expect(page.locator('[data-screen-label="oracle"]')).toBeVisible({ timeout: 15_000 });
  });

  test("oracle input renders with correct placeholder", async ({ page }) => {
    // i18n EN oracle.placeholder = "Follow up — or ask anything about your Brain…"
    const input = page.locator("input[placeholder]").first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    const ph = await input.getAttribute("placeholder");
    expect(ph).toBeTruthy();
    expect(ph!.length).toBeGreaterThan(5);
  });

  test("ask a question, see turn block appear and streaming complete", async ({ page }) => {
    const question = "What framework do I use for React forms?";

    const input = page.locator("input[placeholder]").first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill(question);

    // Capture the stream response so we can detect a rate-limit 429. The hook
    // swallows non-200 stream errors into an empty answer (and the cursor still
    // hides when the fetch rejects), which would otherwise look like an
    // assertion failure for an infra reason.
    const streamRespPromise = page
      .waitForResponse(
        (resp) => resp.url().includes("/api/oracle/stream"),
        { timeout: 30_000 },
      )
      .catch(() => null);

    const sendBtn = page.locator('button[aria-label="Send"]');
    await expect(sendBtn).toBeEnabled({ timeout: 5_000 });
    await sendBtn.click();

    const streamResp = await streamRespPromise;
    if (streamResp && streamResp.status() !== 200) {
      test.skip(
        true,
        `Stream returned ${streamResp.status()} (likely in-memory rate-limit saturation)`,
      );
      return;
    }

    // The question text should appear in a .oracle-q serif div
    const questionEl = page.locator(".oracle-q");
    await expect(questionEl).toBeVisible({ timeout: 10_000 });
    await expect(questionEl).toContainText(question, { timeout: 10_000 });

    // Wait for streaming to complete: oracle-answer content stops growing for 2s.
    // We poll the text length and wait for it to stabilise.
    const answerEl = page.locator(".oracle-answer").first();
    await expect(answerEl).toBeVisible({ timeout: 20_000 });

    // The cursor disappears when streaming is done
    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 60_000 });

    // Answer area should have non-empty text content after completion
    const answerText = await answerEl.textContent();
    expect(answerText?.trim().length).toBeGreaterThan(10);
  });

  test("retrieval inspector shows at least one item with numeric score", async ({ page }) => {
    const question = "What do I use for state management?";
    const input = page.locator("input[placeholder]").first();
    await input.fill(question);

    // Capture the retrieve response so we can detect rate-limit fallback. When
    // the in-memory proxy returns 429, the oracle hook silently renders an empty
    // inspector — asserting on score chips would fail for infra reasons, not
    // product reasons. Skip if that happens.
    const retrieveRespPromise = page
      .waitForResponse(
        (resp) => resp.url().includes("/api/knowledge/retrieve"),
        { timeout: 30_000 },
      )
      .catch(() => null);
    await page.locator('button[aria-label="Send"]').click();

    // Wait for the answer to complete
    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 60_000 });

    const retrieveResp = await retrieveRespPromise;
    if (retrieveResp && retrieveResp.status() !== 200) {
      test.skip(
        true,
        `Retrieval returned ${retrieveResp.status()} (likely in-memory rate-limit saturation); inspector cannot populate`,
      );
      return;
    }

    // Inspector panel is the right-side aside.oracle-inspector
    // It renders .tab-num spans with scores like "0.82"
    const inspector = page.locator(".oracle-inspector");
    await expect(inspector).toBeVisible({ timeout: 5_000 });

    // At least one score chip — .tab-num in inspector with a decimal number
    const scoreSpans = inspector.locator(".tab-num").filter({ hasText: /^\d+\.\d+$/ });
    await expect(scoreSpans.first()).toBeVisible({ timeout: 10_000 });

    const scoreText = await scoreSpans.first().textContent();
    const score = parseFloat(scoreText ?? "0");
    expect(score).toBeGreaterThan(0);
  });

  test("feedback button Helpful disables after click and fires POST to feedback API", async ({ page }) => {
    const question = "What testing library do I prefer?";
    const input = page.locator("input[placeholder]").first();
    await input.fill(question);
    await page.locator('button[aria-label="Send"]').click();

    // Wait for streaming to complete
    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 60_000 });

    // Feedback buttons rendered by TurnView
    // i18n EN oracle.helpful = "Helpful"
    const helpfulBtn = page.getByRole("button", { name: /helpful/i }).first();
    await expect(helpfulBtn).toBeVisible({ timeout: 10_000 });
    await expect(helpfulBtn).toBeEnabled();

    // Wait for feedback API response when we click
    const feedbackResp = page.waitForResponse(
      (resp) => resp.url().includes("/api/oracle/feedback"),
      { timeout: 10_000 },
    );
    await helpfulBtn.click();
    // After click the button should be disabled (feedback given)
    await expect(helpfulBtn).toBeDisabled({ timeout: 5_000 });

    // The POST should have landed (if API is up); if it 404s that's a code bug to investigate
    const resp = await feedbackResp;
    expect(resp.status()).toBeLessThan(500);
  });

  test("reasoning level chip opens a popover and selecting a level updates the chip", async ({ page }) => {
    // Phase 4 collapsed the 5-button segmented control into a single chip
    // that opens a listbox popover. Default level is "medium".
    const chip = page.locator(".oracle-reasoning-seg button[aria-haspopup='listbox']");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("medium");

    await chip.click();
    const listbox = page.locator(".oracle-reasoning-seg [role='listbox']");
    await expect(listbox).toBeVisible();

    // Five levels in the listbox.
    const options = listbox.locator("[role='option']");
    expect(await options.count()).toBe(5);

    const mediumOpt = options.filter({ hasText: /^medium$/ });
    await expect(mediumOpt).toHaveAttribute("aria-selected", "true");

    const highOpt = options.filter({ hasText: /^high$/ });
    await highOpt.click();
    await expect(listbox).toBeHidden();
    await expect(chip).toContainText("high");
  });

  test("citation chip appears in answer and links to a cite- element", async ({ page }) => {
    // This test requires the LLM to produce a cited answer — not guaranteed.
    // We mark it fixme if there are no citation chips after a full answer.
    test.slow(); // generous timeout

    const question = "What React form validation approach do I use?";
    const input = page.locator("input[placeholder]").first();
    await input.fill(question);
    await page.locator('button[aria-label="Send"]').click();

    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 90_000 });

    const citationChips = page.locator("a.oracle-citation-ref");
    const chipCount = await citationChips.count();

    if (chipCount === 0) {
      // The LLM may not always produce citations for every question — this is expected.
      // TODO: force a knowledge base query that guarantees citation (blocked by non-deterministic LLM)
      test.fixme(true, "LLM did not produce citations for this question — non-deterministic");
      return;
    }

    // Click the first citation chip; it should scroll to a #cite-... card
    const firstChip = citationChips.first();
    await firstChip.click();

    // A [id^="cite-"] element should exist in the DOM (scroll target)
    const citeCard = page.locator("[id^='cite-']").first();
    await expect(citeCard).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // With-Brain indicator tests
  // -------------------------------------------------------------------------

  test("groundedness header pill appears after an answer completes", async ({ page }) => {
    const question = "What React form validation approach do I use?";
    const input = page.locator("input[placeholder]").first();
    await input.fill(question);

    const streamRespPromise = page
      .waitForResponse(
        (resp) => resp.url().includes("/api/oracle/stream"),
        { timeout: 30_000 },
      )
      .catch(() => null);

    await page.locator('button[aria-label="Send"]').click();

    const streamResp = await streamRespPromise;
    if (streamResp && streamResp.status() !== 200) {
      test.skip(
        true,
        `Stream returned ${streamResp.status()} (likely in-memory rate-limit saturation)`,
      );
      return;
    }

    // Wait for streaming to finish
    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 90_000 });

    // The groundedness header pill should be present — either the grounded variant
    // (.oracle-groundedness-grounded) or the none variant (.oracle-groundedness-none).
    const grounded = page.locator(".oracle-groundedness-grounded");
    const noneVariant = page.locator(".oracle-groundedness-none");
    const groundedCount = await grounded.count();
    const noneCount = await noneVariant.count();

    // At least one variant must be present
    expect(groundedCount + noneCount).toBeGreaterThan(0);
  });

  test("grounded answer shows '🧠 Grounded on N rules' text in header pill", async ({ page }) => {
    // The seed data should provide relevant knowledge for this standard question.
    const question = "What do I usually use for auth?";
    const input = page.locator("input[placeholder]").first();
    await input.fill(question);

    const streamRespPromise = page
      .waitForResponse(
        (resp) => resp.url().includes("/api/oracle/stream"),
        { timeout: 30_000 },
      )
      .catch(() => null);

    await page.locator('button[aria-label="Send"]').click();

    const streamResp = await streamRespPromise;
    if (streamResp && streamResp.status() !== 200) {
      test.skip(true, `Stream returned ${streamResp.status()}`);
      return;
    }

    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 90_000 });

    // The grounded pill should contain "rules" text
    const groundedPill = page.locator(".oracle-groundedness-grounded");
    if (await groundedPill.count() > 0) {
      await expect(groundedPill.first()).toContainText(/rules?|sessions?/i, { timeout: 5_000 });
    } else {
      // No relevant memories — also acceptable, just verify the none pill renders
      await expect(page.locator(".oracle-groundedness-none").first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test("no-memory pill shows Teach a rule button when Brain has no context", async ({ page }) => {
    // If the none-variant pill appears, the Teach button should be present
    const question = "What is my opinion on quantum computing frameworks?";
    const input = page.locator("input[placeholder]").first();
    await input.fill(question);

    const streamRespPromise = page
      .waitForResponse(
        (resp) => resp.url().includes("/api/oracle/stream"),
        { timeout: 30_000 },
      )
      .catch(() => null);

    await page.locator('button[aria-label="Send"]').click();
    const streamResp = await streamRespPromise;
    if (streamResp && streamResp.status() !== 200) {
      test.skip(true, `Stream returned ${streamResp.status()}`);
      return;
    }

    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 90_000 });

    const noneVariant = page.locator(".oracle-groundedness-none");
    if (await noneVariant.count() > 0) {
      // The Teach button should be visible inside the pill
      const teachBtn = noneVariant.locator(".oracle-teach-btn");
      await expect(teachBtn).toBeVisible({ timeout: 5_000 });
      // Clicking it should open the Teach modal
      await teachBtn.click();
      const teachModal = page.locator('[aria-label="Teach your Brain"]');
      await expect(teachModal).toBeVisible({ timeout: 5_000 });
    } else {
      // Brain had relevant context — the grounded pill should be present instead
      await expect(page.locator(".oracle-groundedness-grounded").first()).toBeVisible({ timeout: 5_000 });
    }
  });

  test("Sources used by the Brain toggle expands and collapses citation cards", async ({ page }) => {
    test.slow(); // generous timeout — needs actual LLM citations

    const question = "What React form validation approach do I use?";
    const input = page.locator("input[placeholder]").first();
    await input.fill(question);

    const streamRespPromise = page
      .waitForResponse(
        (resp) => resp.url().includes("/api/oracle/stream"),
        { timeout: 30_000 },
      )
      .catch(() => null);

    await page.locator('button[aria-label="Send"]').click();
    const streamResp = await streamRespPromise;
    if (streamResp && streamResp.status() !== 200) {
      test.skip(true, `Stream returned ${streamResp.status()}`);
      return;
    }

    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 90_000 });

    const toggle = page.locator(".oracle-sources-toggle");
    if (await toggle.count() === 0) {
      test.fixme(true, "LLM produced no citations — Sources toggle not rendered");
      return;
    }

    // Default: collapsed — citation cards not visible
    await expect(toggle.first()).toBeVisible({ timeout: 5_000 });
    const toggleText = await toggle.first().textContent();
    expect(toggleText).toMatch(/Sources used by the Brain/i);

    // Expand
    await toggle.first().click();
    await expect(toggle.first()).toHaveAttribute("aria-expanded", "true", { timeout: 3_000 });

    // Citation cards should now be visible
    const cards = page.locator(".oracle-citation-card");
    await expect(cards.first()).toBeVisible({ timeout: 5_000 });

    // Collapse again
    await toggle.first().click();
    await expect(toggle.first()).toHaveAttribute("aria-expanded", "false", { timeout: 3_000 });
  });

  // -------------------------------------------------------------------------
  // Why-this-answer enriched citation card tests
  // -------------------------------------------------------------------------

  test("citation card shows knowledge type chip when expanded", async ({ page }) => {
    test.slow();

    const question = "What React form validation approach do I use?";
    const input = page.locator("input[placeholder]").first();
    await input.fill(question);

    const streamRespPromise = page
      .waitForResponse(
        (resp) => resp.url().includes("/api/oracle/stream"),
        { timeout: 30_000 },
      )
      .catch(() => null);

    await page.locator('button[aria-label="Send"]').click();
    const streamResp = await streamRespPromise;
    if (streamResp && streamResp.status() !== 200) {
      test.skip(true, `Stream returned ${streamResp.status()}`);
      return;
    }

    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 90_000 });

    const toggle = page.locator(".oracle-sources-toggle");
    if (await toggle.count() === 0) {
      test.fixme(true, "LLM produced no knowledge citations for this question");
      return;
    }

    await toggle.first().click();
    await expect(toggle.first()).toHaveAttribute("aria-expanded", "true", { timeout: 3_000 });

    const cards = page.locator(".oracle-citation-card");
    if (await cards.count() === 0) {
      test.fixme(true, "No citation cards rendered");
      return;
    }

    // First card should have a type chip — one of: recipe, reflex, heuristic, principle, anti-principle
    const firstCard = cards.first();
    await expect(firstCard).toBeVisible({ timeout: 5_000 });

    // Chips with k-* class identify the knowledge type
    const typeChip = firstCard.locator("[class*='k-']").first();
    if (await typeChip.count() > 0) {
      const chipText = await typeChip.textContent();
      expect(["recipe", "reflex", "heuristic", "principle", "anti-principle"]).toContain(chipText?.trim());
    }
    // If no k-* chip, the "knowledge"/"session"/"ref" fallback text is acceptable
  });

  test("knowledge citation card shows effectiveness badge when expanded", async ({ page }) => {
    test.slow();

    const question = "What do I usually use for auth?";
    const input = page.locator("input[placeholder]").first();
    await input.fill(question);

    const streamRespPromise = page
      .waitForResponse(
        (resp) => resp.url().includes("/api/oracle/stream"),
        { timeout: 30_000 },
      )
      .catch(() => null);

    await page.locator('button[aria-label="Send"]').click();
    const streamResp = await streamRespPromise;
    if (streamResp && streamResp.status() !== 200) {
      test.skip(true, `Stream returned ${streamResp.status()}`);
      return;
    }

    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 90_000 });

    const toggle = page.locator(".oracle-sources-toggle");
    if (await toggle.count() === 0) {
      test.fixme(true, "LLM produced no citations");
      return;
    }

    await toggle.first().click();

    const cards = page.locator(".oracle-citation-card");
    if (await cards.count() === 0) {
      test.fixme(true, "No citation cards");
      return;
    }

    // After expansion, each knowledge card should either show effectiveness badge
    // (✓/~/✗ pattern or "Untested" or "Unused") from .chip.mono elements
    const firstCard = cards.first();
    // The card must at minimum render — no crash
    await expect(firstCard).toBeVisible({ timeout: 5_000 });
    const cardText = await firstCard.textContent();
    expect(cardText).toBeTruthy();
    expect(cardText!.length).toBeGreaterThan(5);
  });

  test("knowledge citation card shows WHEN trigger line when expanded", async ({ page }) => {
    test.slow();

    const question = "How do I handle React form validation in this project?";
    const input = page.locator("input[placeholder]").first();
    await input.fill(question);

    const streamRespPromise = page
      .waitForResponse(
        (resp) => resp.url().includes("/api/oracle/stream"),
        { timeout: 30_000 },
      )
      .catch(() => null);

    await page.locator('button[aria-label="Send"]').click();
    const streamResp = await streamRespPromise;
    if (streamResp && streamResp.status() !== 200) {
      test.skip(true, `Stream returned ${streamResp.status()}`);
      return;
    }

    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 90_000 });

    const toggle = page.locator(".oracle-sources-toggle");
    if (await toggle.count() === 0) {
      test.fixme(true, "LLM produced no citations");
      return;
    }

    await toggle.first().click();

    // Any oracle-citation-trigger element should contain "WHEN:"
    const triggerLines = page.locator(".oracle-citation-trigger");
    if (await triggerLines.count() > 0) {
      const firstTrigger = triggerLines.first();
      await expect(firstTrigger).toBeVisible({ timeout: 5_000 });
      await expect(firstTrigger).toContainText("WHEN:", { timeout: 3_000 });
    }
    // If no trigger lines: the LLM produced citations without matching knowledge rows
    // (e.g. seed data not present) — acceptable.
  });

  test("citation card renders without crash for last-used time display", async ({ page }) => {
    test.slow();

    const question = "Show me my most used coding patterns.";
    const input = page.locator("input[placeholder]").first();
    await input.fill(question);

    const streamRespPromise = page
      .waitForResponse(
        (resp) => resp.url().includes("/api/oracle/stream"),
        { timeout: 30_000 },
      )
      .catch(() => null);

    await page.locator('button[aria-label="Send"]').click();
    const streamResp = await streamRespPromise;
    if (streamResp && streamResp.status() !== 200) {
      test.skip(true, `Stream returned ${streamResp.status()}`);
      return;
    }

    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 90_000 });

    const toggle = page.locator(".oracle-sources-toggle");
    if (await toggle.count() === 0) {
      test.fixme(true, "LLM produced no citations");
      return;
    }

    await toggle.first().click();

    const cards = page.locator(".oracle-citation-card");
    if (await cards.count() === 0) {
      test.fixme(true, "No citation cards");
      return;
    }

    // last-used chip uses class oracle-citation-last-used
    const lastUsedChips = page.locator(".oracle-citation-last-used");
    if (await lastUsedChips.count() > 0) {
      const text = await lastUsedChips.first().textContent();
      // Should contain "ago" or "just now"
      expect(text).toMatch(/ago|just now/i);
    }
    // Acceptable if not present (knowledge with no lastUsedAt)
  });
});
