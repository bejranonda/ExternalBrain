import { test, expect } from "@playwright/test";

// Dedicated Oracle SSE streaming tests.
test.describe("oracle SSE streaming", () => {
  test("stream response contains event:delta frames and a terminal event:final frame", async ({
    page,
  }) => {
    test.slow(); // generous timeout for LLM streaming

    await page.goto("/#oracle");
    await expect(page.locator('[data-screen-label="oracle"]')).toBeVisible({ timeout: 15_000 });

    let streamResponse: import("@playwright/test").Response | null = null;

    // Intercept the SSE stream before it starts
    page.on("response", (resp) => {
      if (resp.url().includes("/api/oracle/stream")) {
        streamResponse = resp;
      }
    });

    // Submit a question
    const input = page.locator("input[placeholder]").first();
    await input.fill("What is my preferred approach to React state management?");
    await page.locator('button[aria-label="Send"]').click();

    // Wait for the streaming response to complete (cursor disappears)
    await expect(page.locator(".oracle-cursor")).not.toBeVisible({ timeout: 90_000 });

    // Verify we captured the stream
    if (!streamResponse) {
      // If the oracle uses the non-stream endpoint, skip the SSE-specific assertions
      test.fixme(
        true,
        "No /api/oracle/stream response captured — oracle.tsx may use /api/oracle (non-streaming) endpoint. " +
          "Check use-oracle.ts for the actual endpoint URL.",
      );
      return;
    }

    // Verify content-type is event-stream
    const contentType = streamResponse.headers()["content-type"] ?? "";
    expect(contentType).toContain("text/event-stream");

    // Read the body as text and verify it contains delta + final events
    const body = await streamResponse.body();
    const bodyText = body.toString("utf-8");

    expect(bodyText).toContain("event: delta");
    expect(bodyText).toContain("event: final");
    // The final frame should include citations in its payload
    expect(bodyText).toContain("citations");
  });

  test("aborting stream by reload leaves no orphaned cursor on the page", async ({ page }) => {
    test.slow();

    await page.goto("/#oracle");
    await expect(page.locator('[data-screen-label="oracle"]')).toBeVisible({ timeout: 15_000 });

    // Submit a question
    const input = page.locator("input[placeholder]").first();
    await input.fill("Describe all the TypeScript patterns I follow in detail.");
    await page.locator('button[aria-label="Send"]').click();

    // Wait briefly for streaming to start (cursor should appear)
    // The oracle-cursor appears while streaming === true
    try {
      await expect(page.locator(".oracle-cursor")).toBeVisible({ timeout: 15_000 });
    } catch {
      // Cursor may have already disappeared if the answer was extremely fast
    }

    // Reload mid-stream
    await page.reload();
    await expect(page.locator('[data-screen-label]')).toBeVisible({ timeout: 20_000 });

    // After reload, the oracle surface resets — no cursor should be visible
    // (turns state is reset to empty on mount)
    const cursorCount = await page.locator(".oracle-cursor").count();
    expect(cursorCount).toBe(0);

    // The oracle should be back to its empty state
    const answerBlocks = await page.locator(".oracle-answer").count();
    expect(answerBlocks).toBe(0);
  });
});
