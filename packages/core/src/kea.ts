/**
 * KEA — Knowledge Extraction Agent.
 *
 * The doctor. Given a completed session, produces 0-3 high-quality Knowledge
 * items. LLM-based, not keyword matching.
 *
 * Invoked by the worker after `brain_report_session_outcome`, never on the
 * client's hot path.
 *
 * Prompt sourced from research/knowledge/15-implementation-stubs.md §2.
 */
import type {
  Knowledge,
  KnowledgeType,
  KnowledgeScope,
  SessionMetrics,
} from "@brain/types";
import { db, toVector } from "@brain/db";
import { embed } from "./embedding.js";
import { getLogger } from "./logger.js";
import { writeAudit } from "./audit.js";

export interface KEAInputPayload {
  sessionId: string;
  userId: string;
  projectId?: string | undefined;
  prompt: string;
  clarificationAnswers?: Record<string, string> | undefined;
  skillInjected?: { name: string; triggers: string[] } | undefined;
  patternsInjected?: Array<{ id: string; summary: string }> | undefined;
  framework?: string | undefined;
  language?: string | undefined;
  filesCreated: string[];
  filesModified: string[];
  filesRejected?: string[] | undefined;
  buildAttempts: number;
  errorsEncountered: string[];
  finalBuildSuccess: boolean;
  userFeedback?: "up" | "down" | null | undefined;
  userFeedbackComment?: string | null | undefined;
  durationMs: number;
  tokensUsed: number;
}

/** KEA-side scope union — wider than the platform's KnowledgeScope because
 *  the prompt allows the LLM to flag "community_candidate" findings that
 *  we then map to "user" before persisting (see `persist()` below). */
export type KEAScope = KnowledgeScope | "community_candidate";

export interface KEAFinding {
  type: KnowledgeType;
  scope: KEAScope;
  trigger: string;
  rule: string;
  rationale: string;
  confidence: number;
}

// ============================================================
// Prompt (do not inline string-concat; keep as a template)
// ============================================================

const SYSTEM_PROMPT = `You are a knowledge extraction agent for a coding AI platform.

Your job: given a summary of a completed coding session, extract 0-3 structured
knowledge items that will help the AI perform better on similar tasks in the future.

QUALITY BAR:
- Specific, not generic. "Use TypeScript strict mode" is good. "Use good practices" is not.
- Actionable. The rule must be something an AI could apply mechanically.
- Derivable from evidence. Don't invent preferences the session didn't demonstrate.

OUTPUT FORMAT: valid JSON matching the schema below. If there is nothing
meaningful to extract, return {"findings": []}. Never force low-quality findings.

TYPES:
- reflex: unconditional rules. "Always X" / "Never X".
- recipe: template for a specific task type. "For Y, the approach is Z."
- heuristic: context-sensitive guidance. "When A, prefer B (because C)."
- principle: abstract value. "Prefer X over Y."
- anti_principle: something to avoid. "Don't X (the user rejected this N times)."

SCOPES:
- global: applies to all this user's work
- user: applies across this user's projects (default)
- project: applies only in this specific project
- session_context: applies in specific modes (e.g. "while debugging")
- community_candidate: generic enough to share publicly

CONFIDENCE: 0.0 to 1.0. Only include findings at >= 0.7 confidence.

JSON SCHEMA:
{
  "findings": [
    {
      "type": "reflex" | "recipe" | "heuristic" | "principle" | "anti_principle",
      "scope": "global" | "user" | "project" | "session_context" | "community_candidate",
      "trigger": "natural language — when does this apply?",
      "rule": "natural language — what is the rule?",
      "rationale": "natural language — why?",
      "confidence": 0.0-1.0
    }
  ]
}

Output JSON only, no prose before or after.`;

// ============================================================
// Main entry
// ============================================================

export async function extractFromSession(
  payload: KEAInputPayload,
): Promise<Knowledge[]> {
  const findings = await runLLM(payload);
  const filtered = await applyQualityFilter(findings, payload.userId);
  const persisted = await persist(filtered, payload);
  // Diagnostic breakdown: `items` in the worker log only shows the final
  // count, conflating "LLM returned zero findings" with "quality filter
  // dropped them all." This trace separates the two so the operator
  // doesn't have to guess which lever to tune (model quality vs filter
  // threshold) when KEA is silent. See docs/RUNBOOK.md
  // §"Tokens connect but brain doesn't learn".
  getLogger("kea", { stream: "stdout" }).info(
    {
      op: "kea.funnel",
      sessionId: payload.sessionId,
      llmFindings: findings.length,
      filterPassed: filtered.length,
      persisted: persisted.length,
    },
    "kea.funnel",
  );
  // #229 — write an AuditLog row so historical KEA runs are queryable
  // by timestamp even after worker logs roll off the docker log driver's
  // ~50MB ring. Best-effort: writeAudit catches its own errors and never
  // bubbles up to the caller, so a transient DB outage on the audit path
  // doesn't prevent the Knowledge persistence we just succeeded at.
  await writeAudit({
    action: "kea.extract_session",
    actorUserId: payload.userId,
    targetType: "Session",
    targetId: payload.sessionId,
    payload: {
      llmFindings: findings.length,
      filterPassed: filtered.length,
      persisted: persisted.length,
      model: process.env.KEA_MODEL ?? "qwen3-coder",
    },
    ...(payload.projectId ? { projectId: payload.projectId } : {}),
  });
  return persisted;
}

// ============================================================
// Cross-session KEA (2026-05-12) — runs over N recent sessions in one shot.
// Per-session KEA had a 17% extraction yield on the dev brain (1/6 closed
// sessions produced any findings) because single sessions often don't
// contain enough signal for the model to extract a real pattern. Cross-
// session KEA addresses that by giving the model a multi-session window —
// a pattern that recurs across 3 sessions is much higher-signal than one
// strong correction in one session. Designed to be scheduled (e.g. daily
// or weekly) and to *complement* per-session KEA, not replace it.
//
// Provider routing: explicitly defaults to claude-sonnet-4-6 because the
// multi-session payload routinely exceeds the working window of haiku.
// The per-session KEA path stays on KEA_MODEL (default qwen3-coder /
// haiku) for cost reasons.
// ============================================================

const CROSS_SESSION_SYSTEM_PROMPT = `You are KEA (Knowledge Extraction Agent) running in cross-session consolidation mode.
You are given a window of N recent coding sessions from one user, each with
prompt + events + outcome. Your job is to find PATTERNS that REPEAT across
multiple sessions — the user's idioms, reflexes, frameworks of choice,
recurring mistakes, things they accept vs reject. A pattern is only worth
extracting if you can point to ≥2 sessions confirming it.

OUTPUT JSON SCHEMA (output JSON only, no prose):
{
  "findings": [
    {
      "type": "reflex" | "recipe" | "heuristic" | "principle" | "anti_principle",
      "scope": "global" | "user" | "project" | "session_context",
      "trigger": "natural language — when does this apply?",
      "rule": "natural language — what is the rule?",
      "rationale": "why? Cite which sessions confirm it.",
      "confidence": 0.0-1.0
    }
  ]
}

Quality rules:
- ≥2 sessions must support each finding. Single-session-only signals belong to per-session KEA.
- Confidence ≥ 0.7 means strong cross-session repetition (3+ sessions, no contradictions).
  Confidence 0.6-0.7 means 2 sessions agree with no third disagreeing.
- Output up to 5 findings, ranked by cross-session strength.
- DO NOT extract findings that are already obvious from a single session — the per-session KEA path covers those.
- DO extract anti_principles when the user repeatedly rejected/corrected the same shape.
`;

export async function extractFromCrossSessions(opts: {
  userId: string;
  sessionIds: string[];
  model?: string;
}): Promise<Knowledge[]> {
  if (opts.sessionIds.length < 2) {
    getLogger("kea", { stream: "stdout" }).warn(
      { op: "kea.cross.skip", reason: "need_at_least_2_sessions", sessionIds: opts.sessionIds },
      "cross-session KEA skipped",
    );
    return [];
  }

  // Load each session's payload via the existing single-session helper.
  // This keeps the on-wire format identical to what per-session KEA sees,
  // so the cross-session prompt can speak the same JSON shape.
  const payloads: KEAInputPayload[] = [];
  for (const sid of opts.sessionIds) {
    try {
      const metrics = await summarizeSessionLite(sid);
      const p = await buildPayload(sid, metrics);
      payloads.push(p);
    } catch (err) {
      // Skip sessions that disappeared between enqueue and process (same
      // pattern as PR #206's P2025-tolerant handler).
      const code = (err as { code?: unknown })?.code;
      if (code === "P2025") continue;
      throw err;
    }
  }
  if (payloads.length < 2) return [];

  // Provider override chain: explicit opts → CROSS_SESSION_KEA_MODEL env →
  // ORACLE_MODEL env (already configured for the deployment) → final
  // fallback to claude-sonnet-4-6. On Z.ai-gateway dev brains, ORACLE_MODEL
  // is typically glm-5.1 (Sonnet-class); on direct-Anthropic deployments,
  // operators can set CROSS_SESSION_KEA_MODEL=claude-sonnet-4-6 explicitly.
  const model =
    opts.model ??
    process.env.CROSS_SESSION_KEA_MODEL ??
    process.env.ORACLE_MODEL ??
    "claude-sonnet-4-6";
  const start = performance.now();
  const userPrompt =
    `Here are the user's last ${payloads.length} coding sessions, oldest first.\n` +
    `Find patterns that REPEAT across at least 2 of them.\n\n` +
    payloads
      .map(
        (p, i) =>
          `===== SESSION ${i + 1} of ${payloads.length} (${p.sessionId}) =====\n${JSON.stringify(p, null, 2)}`,
      )
      .join("\n\n");

  const findings = await callAnthropic(userPrompt, {
    model,
    systemPrompt: CROSS_SESSION_SYSTEM_PROMPT,
    maxTokens: 2048,
  });

  // Use the first payload's user/project as the persistence anchor —
  // cross-session findings belong to the user, not any individual session.
  const anchor = payloads[0]!;
  const filtered = await applyQualityFilter(findings, anchor.userId);

  // Persist with sourceSessionIds = ALL contributing sessions (not just
  // the anchor). This is what makes cross-session knowledge distinguishable
  // from per-session knowledge in the audit trail.
  const persisted = await persistCrossSession(filtered, {
    userId: anchor.userId,
    projectId: anchor.projectId,
    framework: anchor.framework,
    language: anchor.language,
    sessionIds: payloads.map((p) => p.sessionId),
  });

  getLogger("kea", { stream: "stdout" }).info(
    {
      op: "kea.cross_funnel",
      sessions: payloads.length,
      model,
      durMs: Math.round(performance.now() - start),
      llmFindings: findings.length,
      filterPassed: filtered.length,
      persisted: persisted.length,
    },
    "kea.cross_funnel",
  );
  // #229 — same audit-trail rationale as extractFromSession, but the
  // target is the user (no single session anchors a cross-session run)
  // and the payload includes the session window for replay/debug.
  await writeAudit({
    action: "kea.extract_cross_session",
    actorUserId: anchor.userId,
    targetType: "User",
    targetId: anchor.userId,
    payload: {
      sessions: payloads.length,
      sessionIds: payloads.map((p) => p.sessionId),
      llmFindings: findings.length,
      filterPassed: filtered.length,
      persisted: persisted.length,
      model,
      durMs: Math.round(performance.now() - start),
    },
    ...(anchor.projectId ? { projectId: anchor.projectId } : {}),
  });
  return persisted;
}

/**
 * Daily cross-session extraction driver (PR #219).
 *
 * For each user that has ≥2 closed sessions newer than their last
 * cross-session Knowledge row, runs `extractFromCrossSessions` over the
 * recent window. Designed to be invoked from a pg-boss schedule (queue:
 * `kea.cross_extract`) — see `apps/worker/src/index.ts`.
 *
 * Idempotency: this function is safe to run multiple times per day.
 * Users with no new sessions since their last cross-extraction get a
 * skip-log (`op="kea.cross.skip"`) and no LLM call. This is the
 * "instrument the invisible" recipe from Brain rule cmp2qnrm5: the
 * absence of work must be observable, not silent.
 *
 * Returns a per-user count of persisted rows for observability /
 * tests.
 */
export async function runCrossExtractDaily(opts: {
  windowSize?: number;
  model?: string;
  /**
   * Injection point for tests — the default is the real
   * `extractFromCrossSessions`. Production callers should never set this.
   * Workaround for the ESM-module-spy pattern: vi.spyOn on an exported
   * function does not intercept calls made from inside the same module,
   * so the test needs a separate handle.
   */
  extract?: typeof extractFromCrossSessions;
} = {}): Promise<Array<{ userId: string; persisted: number; skipped?: string }>> {
  const extractFn = opts.extract ?? extractFromCrossSessions;
  const log = getLogger("kea", { stream: "stdout" });
  const windowSize = opts.windowSize ?? Number(process.env.CROSS_SESSION_WINDOW ?? 20);

  // Per-user candidate selection. We need: closed Sessions where
  // endedAt > the user's most recent cross-session Knowledge row's
  // createdAt. If the user has no cross-session row yet, ANY closed
  // session counts.
  //
  // Implementation: pull all (userId, endedAt) pairs in one query,
  // pull all (ownerUserId, createdAt) pairs for cross_session-tagged
  // Knowledge in another, then bucket in-process. Avoids N+1 round
  // trips when the number of active users grows.
  const sessions = await db.session.findMany({
    where: { endedAt: { not: null } },
    select: { id: true, userId: true, endedAt: true },
    orderBy: { endedAt: "desc" },
  });
  const lastCrossExtractAt = await db.knowledge.groupBy({
    by: ["ownerUserId"],
    where: { extractedBy: "kea", tags: { has: "cross_session" } },
    _max: { createdAt: true },
  });
  const lastByUser = new Map<string, Date>();
  for (const row of lastCrossExtractAt) {
    if (row.ownerUserId && row._max.createdAt) {
      lastByUser.set(row.ownerUserId, row._max.createdAt);
    }
  }

  const byUser = new Map<string, { id: string; endedAt: Date }[]>();
  for (const s of sessions) {
    if (!s.endedAt) continue;
    const cutoff = lastByUser.get(s.userId);
    if (cutoff && s.endedAt <= cutoff) continue;
    if (!byUser.has(s.userId)) byUser.set(s.userId, []);
    const arr = byUser.get(s.userId)!;
    if (arr.length < windowSize) arr.push({ id: s.id, endedAt: s.endedAt });
  }

  const results: Array<{ userId: string; persisted: number; skipped?: string }> = [];
  for (const [userId, sids] of byUser) {
    if (sids.length < 2) {
      log.info(
        {
          op: "kea.cross.skip",
          userId: userId.slice(0, 12),
          reason: "fewer_than_2_new_sessions",
          newSessionCount: sids.length,
        },
        "kea.cross.skip — not enough new sessions",
      );
      results.push({ userId, persisted: 0, skipped: "fewer_than_2_new_sessions" });
      continue;
    }
    // Oldest-first for LLM progression sense.
    const sessionIds = sids.map((s) => s.id).reverse();
    const persisted = await extractFn({
      userId,
      sessionIds,
      ...(opts.model ? { model: opts.model } : {}),
    });
    results.push({ userId, persisted: persisted.length });
  }

  // Top-level observability: how many users processed, how many
  // total rows persisted in this run.
  const totalPersisted = results.reduce((acc, r) => acc + r.persisted, 0);
  log.info(
    {
      op: "kea.cross.daily_done",
      users: results.length,
      processed: results.filter((r) => !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      totalPersisted,
      model: opts.model ?? process.env.CROSS_SESSION_KEA_MODEL ?? process.env.ORACLE_MODEL ?? null,
    },
    "kea.cross.daily_done",
  );

  return results;
}

async function persistCrossSession(
  findings: KEAFinding[],
  ctx: {
    userId: string;
    projectId: string | null | undefined;
    framework: string | null | undefined;
    language: string | null | undefined;
    sessionIds: string[];
  },
): Promise<Knowledge[]> {
  const out: Knowledge[] = [];
  for (const f of findings) {
    const text = `${f.trigger}\n${f.rule}`;
    const vec = await embed(text);
    const row = await db.$transaction(async (tx) => {
      const created = await tx.knowledge.create({
        data: {
          type: f.type,
          scope: (f.scope === "community_candidate" ? "user" : f.scope) satisfies KnowledgeScope,
          ownerUserId: ctx.userId,
          ownerProjectId: ctx.projectId ?? null,
          triggerText: f.trigger,
          ruleText: f.rule,
          rationale: f.rationale,
          framework: ctx.framework ?? null,
          language: ctx.language ?? null,
          tags: ["cross_session"],
          confidence: f.confidence,
          extractedBy: "kea",
          sourceSessionIds: ctx.sessionIds,
        },
      });
      await tx.$executeRawUnsafe(
        `UPDATE "Knowledge" SET embedding = $1::vector WHERE id = $2`,
        toVector(vec),
        created.id,
      );
      // Wire the application row for the FIRST contributing session
      // (Prisma doesn't allow multi-row anchor; SessionKnowledgeApplication
      // is per-pair). Operator can join sourceSessionIds for full lineage.
      await tx.sessionKnowledgeApplication.create({
        data: {
          sessionId: ctx.sessionIds[0]!,
          knowledgeId: created.id,
          role: "extracted_from",
        },
      });
      return created;
    });
    out.push(row as unknown as Knowledge);
  }
  return out;
}

/** Minimal session-metrics shim — duplicates `apps/worker/src/index.ts:summarizeSession`
 *  because the worker's version isn't exported. Cross-session KEA only needs
 *  payload shape, not the full session-quality scoring. */
async function summarizeSessionLite(sessionId: string): Promise<SessionMetrics> {
  const events = await db.sessionEvent.findMany({
    where: { sessionId },
    orderBy: { timestamp: "asc" },
  });
  const filesCreated: string[] = [];
  const filesModified: string[] = [];
  const filesRejected: string[] = [];
  const errors: string[] = [];
  let buildAttempts = 0;
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.eventType) {
      case "file_created":
        if (typeof p.path === "string") filesCreated.push(p.path);
        break;
      case "file_modified":
        if (typeof p.path === "string") filesModified.push(p.path);
        break;
      case "file_rejected":
        if (typeof p.path === "string") filesRejected.push(p.path);
        break;
      case "build_attempt":
        buildAttempts++;
        break;
      case "build_failure":
        if (typeof p.error === "string") errors.push(p.error);
        break;
    }
  }
  return {
    filesCreated,
    filesModified,
    filesRejected,
    buildAttempts,
    errors,
    knowledgeUsed: [],
    durationMs: 0,
    tokensUsed: 0,
  };
}

// ============================================================
// LLM call — pluggable provider
// ============================================================

async function runLLM(payload: KEAInputPayload): Promise<KEAFinding[]> {
  const model = process.env.KEA_MODEL ?? "qwen3-coder";
  const userPrompt = `SESSION SUMMARY:\n${JSON.stringify(payload, null, 2)}\n\nExtract now.`;

  // Dispatch on model family — all return normalized KEAFinding[]
  if (model.startsWith("claude")) {
    return callAnthropic(userPrompt);
  }
  if (model.startsWith("qwen") || model.startsWith("glm")) {
    return callDashScope(userPrompt, model);
  }
  return callOpenAI(userPrompt, model);
}

async function callAnthropic(
  userPrompt: string,
  opts: { model?: string; systemPrompt?: string; maxTokens?: number } = {},
): Promise<KEAFinding[]> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // Honor ANTHROPIC_BASE_URL explicitly — on Z.ai-gateway dev brains the
  // SDK needs to be told to route through the gateway, otherwise it falls
  // back to api.anthropic.com which won't recognize the key. The SDK does
  // pick this up from env automatically in most versions, but passing it
  // explicitly avoids subtle SDK-version differences.
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
  });
  const res = await client.messages.create({
    model: opts.model ?? "claude-haiku-4-5",
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.systemPrompt ?? SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  // Anthropic SDK 0.91+ widened `ContentBlock`; flatMap with a
  // discriminated check is the type-safe extraction of text content.
  const text = res.content
    .flatMap((c) => (c.type === "text" ? [c.text] : []))
    .join("");
  return parseFindings(text);
}

async function callOpenAI(
  userPrompt: string,
  model: string,
): Promise<KEAFinding[]> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1024,
  });
  return parseFindings(res.choices[0]?.message.content ?? "");
}

async function callDashScope(
  userPrompt: string,
  model: string,
): Promise<KEAFinding[]> {
  // DashScope is OpenAI-compatible via its /compatible-mode endpoint.
  // Guard up-front: passing undefined apiKey makes the OpenAI SDK throw
  // a misleading "set the OPENAI_API_KEY env variable" error that
  // sends operators chasing the wrong env var. Fail loud with the right
  // variable name so the fix is one paste away.
  if (!process.env.DASHSCOPE_API_KEY) {
    throw new Error(
      `KEA_MODEL=${model} routes to DashScope but DASHSCOPE_API_KEY is unset. ` +
        `Either set DASHSCOPE_API_KEY in .env, or switch KEA_MODEL to a configured ` +
        `provider (claude-haiku-4-5 needs ANTHROPIC_API_KEY; gpt-* needs OPENAI_API_KEY).`,
    );
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  });
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 1024,
  });
  return parseFindings(res.choices[0]?.message.content ?? "");
}

function parseFindings(text: string): KEAFinding[] {
  try {
    // Strip markdown fences if present
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.findings)) return [];
    return parsed.findings.filter(isValidFinding);
  } catch {
    return [];
  }
}

function isValidFinding(f: unknown): f is KEAFinding {
  return (
    typeof f === "object" &&
    f !== null &&
    typeof (f as KEAFinding).type === "string" &&
    typeof (f as KEAFinding).trigger === "string" &&
    typeof (f as KEAFinding).rule === "string" &&
    typeof (f as KEAFinding).confidence === "number"
  );
}

// ============================================================
// Quality filter — research/knowledge/15 §2 + doc 03 §3.4
// ============================================================

const GENERIC_PHRASES = [
  "good practices",
  "best practices",
  "clean code",
  "proper",
  "correctly",
  "appropriately",
  "as needed",
];

async function applyQualityFilter(
  findings: KEAFinding[],
  ownerUserId: string,
): Promise<KEAFinding[]> {
  const passed: KEAFinding[] = [];
  for (const f of findings.slice(0, 3)) {
    if (f.confidence < 0.7) continue;
    if (f.rule.length < 20 || f.trigger.length < 10) continue;

    const ruleLower = f.rule.toLowerCase();
    const tooGeneric =
      f.rule.length < 60 &&
      GENERIC_PHRASES.some((p) => ruleLower.includes(p));
    if (tooGeneric) continue;

    if (await isSemanticDuplicate(f, ownerUserId)) continue;

    passed.push(f);
  }
  return passed;
}

async function isSemanticDuplicate(
  f: KEAFinding,
  ownerUserId: string,
): Promise<boolean> {
  const vec = await embed(`${f.trigger}\n${f.rule}`);
  const rows = await db.$queryRawUnsafe<Array<{ id: string; sim: number }>>(
    `
    SELECT id, 1 - (embedding <=> $1::vector) AS sim
    FROM "Knowledge"
    WHERE "ownerUserId" = $2
      AND type = $3
      AND embedding IS NOT NULL
      AND "deletedAt" IS NULL
    ORDER BY embedding <=> $1::vector ASC
    LIMIT 1
    `,
    toVector(vec),
    ownerUserId,
    f.type,
  );
  const top = rows[0];
  if (top && top.sim > 0.85) {
    // Bump confidence on the existing item instead of creating a duplicate
    await db.knowledge.update({
      where: { id: top.id },
      data: {
        confidence: { increment: 0.02 },
        successCount: { increment: 1 },
      },
    });
    return true;
  }
  return false;
}

// ============================================================
// Persist + embed
// ============================================================

async function persist(
  findings: KEAFinding[],
  payload: KEAInputPayload,
): Promise<Knowledge[]> {
  // Idempotency on retry (audit C8 / #108): wrap each finding's persist
  // sequence (create row + write embedding + record application) in a
  // single transaction. Without this, a crash AFTER `db.knowledge.create`
  // but BEFORE the embedding update commits leaves a Knowledge row with
  // NULL embedding — which `isSemanticDuplicate` filters out, so the
  // pg-boss retry's dedup check misses it and creates a duplicate.
  //
  // Wrapping per-finding (rather than the whole loop) is intentional:
  // findings 1..n-1 that successfully persisted on the first attempt
  // would already be in the DB on retry, and `isSemanticDuplicate`
  // (which now sees their embeddings) will dedup them on the way back
  // through. Per-finding atomicity gives that property.
  const out: Knowledge[] = [];
  for (const f of findings) {
    const text = `${f.trigger}\n${f.rule}`;
    const vec = await embed(text);

    const row = await db.$transaction(async (tx) => {
      const created = await tx.knowledge.create({
        data: {
          type: f.type,
          // Map LLM-only "community_candidate" scope to "user" before persisting.
          scope: (f.scope === "community_candidate" ? "user" : f.scope) satisfies KnowledgeScope,
          ownerUserId: payload.userId,
          ownerProjectId: payload.projectId ?? null,
          triggerText: f.trigger,
          ruleText: f.rule,
          rationale: f.rationale,
          framework: payload.framework ?? null,
          language: payload.language ?? null,
          tags: [],
          confidence: f.confidence,
          extractedBy: "kea",
          sourceSessionIds: [payload.sessionId],
        },
      });

      await tx.$executeRawUnsafe(
        `UPDATE "Knowledge" SET embedding = $1::vector WHERE id = $2`,
        toVector(vec),
        created.id,
      );

      await tx.sessionKnowledgeApplication.create({
        data: {
          sessionId: payload.sessionId,
          knowledgeId: created.id,
          role: "extracted_from",
        },
      });

      return created;
    });

    out.push(row as unknown as Knowledge);
  }
  return out;
}

// ============================================================
// Helper: build a KEAInputPayload from a Session + its events + metrics
// ============================================================

export async function buildPayload(
  sessionId: string,
  metrics: SessionMetrics,
): Promise<KEAInputPayload> {
  const session = await db.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { events: { orderBy: { timestamp: "asc" } } },
  });

  const prompt =
    (session.events.find((e) => e.eventType === "session_started")
      ?.payload as { prompt?: string } | null)?.prompt ?? "";

  return {
    sessionId,
    userId: session.userId,
    projectId: session.projectId ?? undefined,
    prompt,
    framework: (session.metadata as { framework?: string } | null)?.framework,
    language: (session.metadata as { language?: string } | null)?.language,
    filesCreated: metrics.filesCreated,
    filesModified: metrics.filesModified,
    filesRejected: metrics.filesRejected,
    buildAttempts: metrics.buildAttempts,
    errorsEncountered: metrics.errors,
    finalBuildSuccess: session.outcome === "success",
    userFeedback: metrics.userFeedback ?? null,
    userFeedbackComment: metrics.userFeedbackComment ?? null,
    durationMs: metrics.durationMs,
    tokensUsed: metrics.tokensUsed,
  };
}
