import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import type { LLMDeps } from "../llm.js";
import { ensureDefaultProject } from "../org.js";
import {
  buildExtractionPrompt,
  parseExtractionResponse,
  extractMeeting,
  findSupersessionCandidates,
} from "../meeting-extract.js";

describe("buildExtractionPrompt", () => {
  it("embeds the transcript verbatim", () => {
    const prompt = buildExtractionPrompt("Anna: staging DB is broken.");
    expect(prompt).toContain("Anna: staging DB is broken.");
  });
});

describe("parseExtractionResponse", () => {
  it("parses a well-formed response", () => {
    const raw = JSON.stringify({
      decisions: [{ trigger: "reporting store", rule: "use postgres+timescale", rationale: "time-bucketed queries", instead: "plain postgres" }],
      actionItems: [{ trigger: "sprint planning", rule: "fix staging db", assigneeGuessEmail: "ben@test.local", blocker: true, kind: "action-item" }],
    });
    const out = parseExtractionResponse(raw);
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]!.ruleText).toBe("use postgres+timescale");
    expect(out.actionItems).toHaveLength(1);
    expect(out.actionItems[0]!.blocker).toBe(true);
  });

  it("strips markdown fences", () => {
    const raw = "```json\n" + JSON.stringify({ decisions: [], actionItems: [] }) + "\n```";
    const out = parseExtractionResponse(raw);
    expect(out.decisions).toEqual([]);
    expect(out.actionItems).toEqual([]);
  });

  it("fails soft to empty arrays on malformed JSON", () => {
    const out = parseExtractionResponse("not json at all");
    expect(out).toEqual({ decisions: [], actionItems: [] });
  });

  it("fails soft when a field is the wrong shape", () => {
    const raw = JSON.stringify({ decisions: "not an array", actionItems: [] });
    const out = parseExtractionResponse(raw);
    expect(out.decisions).toEqual([]);
  });

  it("drops individual malformed items without dropping the whole batch", () => {
    const raw = JSON.stringify({
      decisions: [],
      actionItems: [
        { trigger: "t", rule: "valid one", assigneeGuessEmail: null, blocker: false, kind: "action-item" },
        { trigger: "t" }, // missing rule — invalid
      ],
    });
    const out = parseExtractionResponse(raw);
    expect(out.actionItems).toHaveLength(1);
    expect(out.actionItems[0]!.ruleText).toBe("valid one");
  });
});

describe("extractMeeting", () => {
  function recordingDeps(response: string): { deps: LLMDeps; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        anthropic: async (p, opts) => { calls.push(`anthropic:${p.length}`); return response; },
        openai: async (p, model, systemPrompt, maxTokens, jsonObject) => { calls.push(`openai:${p.length}`); return response; },
        dashscope: async (p, model, systemPrompt, maxTokens) => { calls.push(`dashscope:${p.length}`); return response; },
      },
    };
  }

  it("dispatches to the given model family and returns parsed output", async () => {
    const response = JSON.stringify({ decisions: [], actionItems: [] });
    const { deps, calls } = recordingDeps(response);
    const out = await extractMeeting("a transcript", "qwen3-coder", deps);
    expect(calls[0]).toMatch(/^dashscope:/);
    expect(out).toEqual({ decisions: [], actionItems: [] });
  });
});

// ============================================================
// findSupersessionCandidates — DB-guarded, project-wide search.
// ============================================================

const dbReachable2 = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const guard2 = dbReachable2 ? describe : describe.skip;

// The real embed() throws EMBEDDING_NO_PROVIDER without a configured API
// key, which CI does not have (same constraint kea-refine.test.ts and
// kea-decision-route.test.ts document for kea.ts's judge/mine/persist).
// findSupersessionCandidates takes the same optional deps-injection seam
// extractMeeting above already uses for callLLMText: a fixed vector stands
// in for a real provider call so the test exercises the real SQL/scope
// shape without needing an embedding key.
const FIXED_VECTOR = new Array(1536).fill(0.001);
const fixedEmbed = async (_text: string): Promise<number[]> => FIXED_VECTOR;

guard2("findSupersessionCandidates — project-wide, not owner-scoped", () => {
  const created = { userIds: [] as string[], knowledgeIds: [] as string[] };
  let creatorId: string;
  let otherUserId: string;
  let projectId: string;
  let otherProjectDecisionId: string;
  let sameProjectByOtherUserId: string;

  beforeAll(async () => {
    creatorId = (
      await db.user.create({
        data: { email: `sup-a-${randomBytes(6).toString("hex")}@test.local` },
        select: { id: true },
      })
    ).id;
    otherUserId = (
      await db.user.create({
        data: { email: `sup-b-${randomBytes(6).toString("hex")}@test.local` },
        select: { id: true },
      })
    ).id;
    created.userIds.push(creatorId, otherUserId);
    projectId = (await ensureDefaultProject(db, creatorId)).projectId;
    const otherProjectId = (await ensureDefaultProject(db, otherUserId)).projectId;

    // A decision taught by a DIFFERENT user, in the SAME project — this is
    // the case owner-scoped search (kra.candidatesForPrompt) would miss.
    const row = await db.knowledge.create({
      data: {
        type: "principle",
        scope: "project",
        ownerUserId: otherUserId,
        ownerProjectId: projectId,
        triggerText: "reporting store choice",
        ruleText: "use plain postgres for reporting",
        tags: ["decision"],
        confidence: 1.0,
        extractedBy: "user",
      },
      select: { id: true },
    });
    sameProjectByOtherUserId = row.id;
    created.knowledgeIds.push(row.id);
    await db.$executeRawUnsafe(
      `UPDATE "Knowledge" SET embedding = $1::vector WHERE id = $2`,
      `[${new Array(1536).fill(0.001).join(",")}]`,
      row.id,
    );

    const foreign = await db.knowledge.create({
      data: {
        type: "principle",
        scope: "project",
        ownerUserId: otherUserId,
        ownerProjectId: otherProjectId,
        triggerText: "unrelated",
        ruleText: "an unrelated foreign-project decision",
        tags: ["decision"],
        confidence: 1.0,
        extractedBy: "user",
      },
      select: { id: true },
    });
    otherProjectDecisionId = foreign.id;
    created.knowledgeIds.push(foreign.id);
    await db.$executeRawUnsafe(
      `UPDATE "Knowledge" SET embedding = $1::vector WHERE id = $2`,
      `[${new Array(1536).fill(0.001).join(",")}]`,
      foreign.id,
    );
  });

  afterAll(async () => {
    await db.knowledge.deleteMany({ where: { id: { in: created.knowledgeIds } } }).catch(() => {});
    for (const uid of created.userIds) await db.user.delete({ where: { id: uid } }).catch(() => {});
    await db.$disconnect().catch(() => {});
  });

  it("finds a decision taught by a DIFFERENT user in the same project, and excludes a foreign project's decision", async () => {
    const candidates = await findSupersessionCandidates(
      {
        ruleText: "use postgres with timescale for reporting",
        projectId,
        userId: creatorId,
      },
      fixedEmbed,
    );
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain(sameProjectByOtherUserId);
    expect(ids).not.toContain(otherProjectDecisionId);
  });
});
