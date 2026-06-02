import { test, expect } from "@playwright/test";

// Probe smoke — verifies that both health endpoints respond with the expected JSON shape.
// These tests do NOT require a browser; they hit the API directly via the Playwright
// request fixture so they run fast even without a headful browser.

test.describe("health probes", () => {
  test("GET /api/healthz → 200 { ok: true }", async ({ request }) => {
    const res = await request.get("/api/healthz");
    expect(res.status()).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
  });

  test("GET /api/readyz → 200 { ok: true, db: 'up' } when DB is reachable", async ({ request }) => {
    const res = await request.get("/api/readyz");
    // 200 = DB up; 503 = DB down. Either is a valid operational state.
    // We only assert shape — callers decide whether 503 is acceptable.
    const body = await res.json() as Record<string, unknown>;
    if (res.status() === 200) {
      expect(body["ok"]).toBe(true);
      expect(body["db"]).toBe("up");
    } else {
      // 503 with ok: false is the expected shape for a degraded DB.
      expect(res.status()).toBe(503);
      expect(body["ok"]).toBe(false);
      expect(typeof body["reason"]).toBe("string");
    }
  });
});
