import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { ensureDefaultProject, _resetEnvCache } from "@brain/core";
import * as authLib from "@/lib/brain/auth";
import { getRateLimitStore } from "@/lib/brain/rate-limit-store";
import { POST } from "./route.js";

// Second unit-test file for apps/web (see apps/web/app/api/knowledge/route.test.ts
// for the established pattern this follows: static import of the route,
// vi.spyOn(authLib, "getCurrentUserId") instead of a real session).
//
// Scope note: this suite deliberately does NOT exercise the happy-path
// extraction call (flag ON, transcript parsed by the LLM) — extractMeeting /
// findSupersessionCandidates hit real LLM + embedding providers
// (packages/core/src/__tests__/meeting-extract.test.ts documents the same
// EMBEDDING_NO_PROVIDER / DASHSCOPE_API_KEY constraint for the functions
// this route calls), and CI has no provider keys configured. The two
// request-shape gates below (flag-off 503, rate-limit 429) are the parts of
// this route that are safely testable without a live provider; extraction
// wiring itself is hand-verified (see task-6-report.md).
const dbReachable = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("POST /api/meetings/extract", () => {
  const created = { userIds: [] as string[] };
  let userId: string;

  beforeAll(async () => {
    const u = await db.user.create({
      data: { email: `meetings-route-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    created.userIds.push(u.id);
    userId = u.id;
    await ensureDefaultProject(db, userId);
    vi.spyOn(authLib, "getCurrentUserId").mockResolvedValue(userId);
  });

  afterAll(async () => {
    for (const uid of created.userIds) await db.user.delete({ where: { id: uid } }).catch(() => {});
    vi.restoreAllMocks();
    delete process.env["MEETING_UPLOAD_ENABLED"];
    delete process.env["RATE_LIMIT_MEETING_EXTRACT_PER_DAY"];
    delete process.env["REDIS_URL"];
    _resetEnvCache();
    await db.$disconnect().catch(() => {});
  });

  it("returns 503 when the flag is off", async () => {
    delete process.env["MEETING_UPLOAD_ENABLED"];
    _resetEnvCache();
    const req = new Request("http://test.local/api/meetings/extract", {
      method: "POST",
      body: JSON.stringify({ transcript: "hello" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_ENABLED");
  });

  it("returns 429 when the daily meeting-extract limit is already exhausted", async () => {
    // Redis unset so both this test and the route resolve to the same
    // in-memory fallback Store singleton (apps/web/lib/brain/rate-limit-store.ts).
    delete process.env["REDIS_URL"];
    process.env["MEETING_UPLOAD_ENABLED"] = "true";
    process.env["RATE_LIMIT_MEETING_EXTRACT_PER_DAY"] = "1";
    _resetEnvCache();

    // Pre-seed the bucket at the limit so the request short-circuits on the
    // rate-limit check BEFORE reaching the (unmockable-without-keys) LLM
    // extraction call — bucketKey format is `${limit.name}:${clientKey}`
    // (packages/core/src/rate-limit.ts's `check()`); this route's
    // `meetingExtractLimit()` uses name "meeting-extract" and clientKey is
    // the caller's userId.
    const store = await getRateLimitStore();
    await store.set(`meeting-extract:${userId}`, { count: 1, resetAt: Date.now() + 60_000 }, 60_000);

    const req = new Request("http://test.local/api/meetings/extract", {
      method: "POST",
      body: JSON.stringify({ transcript: "hello" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});
