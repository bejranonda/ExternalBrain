import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { ensureDefaultProject, meetingExtract, _resetEnvCache } from "@brain/core";
import * as authLib from "@/lib/brain/auth";
import { getRateLimitStore } from "@/lib/brain/rate-limit-store";
import { POST } from "./route.js";

// Second unit-test file for apps/web (see apps/web/app/api/knowledge/route.test.ts
// for the established pattern this follows: static import of the route,
// vi.spyOn(authLib, "getCurrentUserId") instead of a real session).
//
// Scope note: `meetingExtract.extractMeeting` / `findSupersessionCandidates`
// hit real LLM + embedding providers in production
// (packages/core/src/__tests__/meeting-extract.test.ts documents the same
// EMBEDDING_NO_PROVIDER / DASHSCOPE_API_KEY constraint), and CI has no
// provider keys configured — so this suite mocks just those two functions at
// the `@brain/core` module level (everything else — envForWeb,
// requireOrgMember, rateLimitCheck, listOrgMembers, ensureDefaultProject,
// _resetEnvCache — stays real) to exercise the full response-shaping chain
// without a live provider. See the "happy path" test below.
vi.mock("@brain/core", async () => {
  const actual = await vi.importActual<typeof import("@brain/core")>("@brain/core");
  return {
    ...actual,
    meetingExtract: {
      ...actual.meetingExtract,
      extractMeeting: vi.fn(),
      findSupersessionCandidates: vi.fn(),
    },
  };
});

const dbReachable = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("POST /api/meetings/extract", () => {
  const created = { userIds: [] as string[] };
  let userId: string;
  let userEmail: string;

  beforeAll(async () => {
    userEmail = `meetings-route-${randomBytes(6).toString("hex")}@test.local`;
    const u = await db.user.create({
      data: { email: userEmail },
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

  it("wires extractMeeting -> findSupersessionCandidates -> listOrgMembers into the response shape (flag on, happy path)", async () => {
    // Deliberately runs BEFORE the 429 test below, and sets a rate limit
    // (10/day) far above the single call this test makes, so this test's own
    // in-memory-store increment never collides with the 429 test's fixture —
    // that test overwrites the same bucket key with an explicit `store.set`
    // regardless of what count this test leaves behind, so ordering isn't
    // even load-bearing for correctness, just for readability.
    delete process.env["REDIS_URL"];
    process.env["MEETING_UPLOAD_ENABLED"] = "true";
    process.env["RATE_LIMIT_MEETING_EXTRACT_PER_DAY"] = "10";
    _resetEnvCache();

    const fakeDecision = {
      triggerText: "when a client asks for a bigger discount than list price",
      ruleText: "hold list price and offer a payment plan instead of a discount",
      rationale: "protects margin without losing the deal",
      instead: "ad-hoc percentage discounts negotiated per client",
    };
    const fakeActionItem = {
      triggerText: "before the next release",
      ruleText: "add a regression test for the discount-hold flow",
      assigneeGuessEmail: null,
      blocker: false,
      kind: "action-item" as const,
    };
    const fakeCandidate = {
      id: "fake-knowledge-id-1",
      ruleText: "always give a 10% discount on request",
      similarity: 0.91,
    };

    const extractMeetingMock = vi.mocked(meetingExtract.extractMeeting);
    const findCandidatesMock = vi.mocked(meetingExtract.findSupersessionCandidates);
    extractMeetingMock.mockResolvedValue({ decisions: [fakeDecision], actionItems: [fakeActionItem] });
    findCandidatesMock.mockResolvedValue([fakeCandidate]);

    const req = new Request("http://test.local/api/meetings/extract", {
      method: "POST",
      body: JSON.stringify({ transcript: "a whole meeting about discounts" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      decisions: Array<{
        triggerText: string;
        ruleText: string;
        rationale: string;
        instead: string;
        supersedes: unknown;
      }>;
      actionItems: Array<Record<string, unknown>>;
      members: Array<{ email: string; name: string | null }>;
    };

    // Asserts the exact fields the route is supposed to attach — a broken
    // response-shaping change (wrong field copied into `supersedes`, the
    // candidate dropped, or an extra/missing action-item field) fails this.
    expect(body.decisions).toEqual([{ ...fakeDecision, supersedes: fakeCandidate }]);
    expect(body.actionItems).toEqual([fakeActionItem]);
    // listOrgMembers is a real call against the org seeded by ensureDefaultProject
    // in beforeAll — this user is the sole member of their personal org.
    expect(body.members).toEqual([{ email: userEmail, name: null }]);

    expect(extractMeetingMock).toHaveBeenCalledWith("a whole meeting about discounts", expect.any(String));
    expect(findCandidatesMock).toHaveBeenCalledWith(
      expect.objectContaining({ ruleText: fakeDecision.ruleText, userId, limit: 1 }),
    );
  });

  it("returns 400 (not 500) when the request body is not valid JSON", async () => {
    delete process.env["REDIS_URL"];
    process.env["MEETING_UPLOAD_ENABLED"] = "true";
    process.env["RATE_LIMIT_MEETING_EXTRACT_PER_DAY"] = "50";
    _resetEnvCache();

    const req = new Request("http://test.local/api/meetings/extract", {
      method: "POST",
      body: "{not valid json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("caps supersession enrichment at 20 decisions, but keeps every extracted decision in the response", async () => {
    delete process.env["REDIS_URL"];
    process.env["MEETING_UPLOAD_ENABLED"] = "true";
    process.env["RATE_LIMIT_MEETING_EXTRACT_PER_DAY"] = "50";
    _resetEnvCache();

    const manyDecisions = Array.from({ length: 25 }, (_, i) => ({
      triggerText: `trigger ${i}`,
      ruleText: `decision ${i}`,
      rationale: "r",
      instead: "i",
    }));

    const extractMeetingMock = vi.mocked(meetingExtract.extractMeeting);
    const findCandidatesMock = vi.mocked(meetingExtract.findSupersessionCandidates);
    // Reset call counts — these mocks are shared across tests in this file
    // (no global clearMocks configured) and the happy-path test above
    // already called findCandidatesMock once.
    extractMeetingMock.mockClear();
    findCandidatesMock.mockClear();
    extractMeetingMock.mockResolvedValue({ decisions: manyDecisions, actionItems: [] });
    findCandidatesMock.mockResolvedValue([]);

    const req = new Request("http://test.local/api/meetings/extract", {
      method: "POST",
      body: JSON.stringify({ transcript: "a meeting with an unusually large decision list" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { decisions: Array<{ supersedes: unknown }> };
    expect(body.decisions).toHaveLength(25);
    expect(findCandidatesMock).toHaveBeenCalledTimes(20);
    expect(body.decisions.slice(20).every((d) => d.supersedes === null)).toBe(true);
    expect(body.decisions.slice(0, 20).every((d) => d.supersedes === null)).toBe(true); // mock resolves []
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
