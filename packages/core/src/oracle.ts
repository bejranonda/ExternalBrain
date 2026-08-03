/**
 * Oracle — conversational interface to the user's Brain.
 *
 * RAG with citations. Premium model (Claude Sonnet 4.6 by default).
 * Stream via SSE in the webapp; return complete response over MCP.
 *
 * Reasoning levels trade cost/latency for depth (Honcho-inspired).
 */
import type {
  OracleQuery,
  OracleResponse,
  OracleCitation,
  OracleCitationMeta,
  OracleReasoningLevel,
  OracleGroundedness,
  OracleRetrievedCounts,
} from "@brain/types";
import { effectivenessScore } from "./knowledge-stats.js";
import { db, toVector } from "@brain/db";
import { embed } from "./embedding.js";
import { reserveCapSlot, recordCall, DEFAULT_RESERVATION_USD, OracleCapReachedError } from "./cost.js";
import { buildOwnerGate, buildRawProjectFilterV2, buildSessionWhere } from "./scope-filter.js";
import { RULE_TYPES_PREDICATE } from "./kra.js";
import { listProjectActionItems, type ActionItemRow } from "./action-items.js";
import type { DataScope, VisibilityScopeArgs } from "./scope-filter.js";

export class OracleCapExceededError extends Error {
  constructor(
    public readonly spentUsd: number,
    public readonly capUsd: number,
  ) {
    super(
      `Oracle daily cost cap reached: spent $${spentUsd.toFixed(
        4,
      )} of $${capUsd.toFixed(2)}`,
    );
    this.name = "OracleCapExceededError";
  }
}

const SYSTEM_PROMPT = `You are the user's personal coding Brain Oracle.

You answer questions about the user's own coding patterns, past sessions,
and preferences — based ONLY on the knowledge and session data provided below.

RULES:
1. Cite sources using [^N] markers. Every claim must be grounded.
2. If you don't have enough context to answer, say so. Don't hallucinate.
3. Be specific: use real numbers, dates, project names, framework names.
4. Distinguish high-confidence knowledge ("you consistently...") from
   low-confidence ("you've done this a few times...").
5. If the user's question is off-topic (not about their coding), redirect:
   "I'm your coding Brain — I can help with questions about your patterns,
   past work, and preferences."
6. If an OPEN TASKS block is present it is the complete, authoritative list
   of open action items, blockers, and open questions for the project —
   answer status questions ("what is open / blocked / unanswered / stale?")
   from it directly, and never present a task as a learned rule. Task lines
   carry no [^N] markers; quote them plainly.

Respond in markdown with [^N] citations.`;

/**
 * System prompt override used when the Brain has no relevant context for the
 * question. Nudges the LLM to be honest instead of fabricating citations.
 */
const SYSTEM_PROMPT_NO_CONTEXT = `You are the user's personal coding Brain Oracle.

The user's Brain has no relevant context for this question. Answer from
general knowledge but make it clear this is NOT grounded in their specific
work — do not fabricate knowledge items or session history.

RULES:
1. Do NOT use [^N] citation markers — there is nothing to cite.
2. Be explicit at the top: note that you have no Brain context for this question.
3. Be specific and helpful from general knowledge where possible.
4. Do not hallucinate past sessions, preferences, or project names.

Respond in markdown without citations.`;

const MAX_TOKENS_BY_LEVEL: Record<OracleReasoningLevel, number> = {
  minimal: 256,
  low: 512,
  medium: 1024,
  high: 2048,
  max: 4096,
};

export interface RetrievedKnowledge {
  id: string;
  type: string;
  triggerText: string;
  ruleText: string;
  rationale: string | null;
  confidence: number;
  successCount: number;
  failureCount: number;
  usageCount: number;
  lastUsedAt: Date | null;
  tags: string[];
  _similarity: number;
}

export interface RetrievedSession {
  id: string;
  clientType: string;
  startedAt: Date;
  endedAt: Date | null;
  outcome: string | null;
  sqs: number | null;
  metadata: unknown;
  project: { name: string } | null;
}

async function buildContext(
  userId: string,
  question: string,
  projectId?: string,
  dataScope: DataScope = "project",
  visibilityArgs?: Omit<VisibilityScopeArgs, "userId" | "scope">,
): Promise<{
  userPrompt: string;
  knowledge: RetrievedKnowledge[];
  sessions: RetrievedSession[];
  /** Override system prompt — set when Brain has no relevant context. */
  systemPromptOverride?: string;
}> {
  const qvec = await embed(question);

  // Build Phase 4 visibility-aware SQL fragment for Knowledge (params start at $3,
  // since $1 = vector and $2 = userId).
  const visArgs: VisibilityScopeArgs = {
    userId,
    activeProjectId: projectId ?? null,
    activeOrgId: visibilityArgs?.activeOrgId ?? null,
    accessibleProjectIds: visibilityArgs?.accessibleProjectIds ?? [],
    scope: dataScope,
    // #174 — same opt-in as kra.ts: the Oracle answers from the user's own
    // rules, so a `scope:'user'` row must not be hidden just because it was
    // taught from inside a different project. Still pinned to ownerUserId,
    // and this query already hard-filters `WHERE "ownerUserId" = $2`.
    includeUserScopeAcrossProjects: true,
  };
  const { sql: kProjectFilter, params: kProjectParams } = buildRawProjectFilterV2(visArgs, 3);

  // Owner gate — kept deliberately identical in shape to `kra.ts`'s. The two
  // are one policy on two query surfaces (the same reason
  // buildKnowledgeWhereV2 and buildRawProjectFilterV2 must move together), so
  // a divergence here would mean the Oracle answered from a different corpus
  // than retrieval injected. `visibility = 'org'` rows are admitted only for
  // projects whose membership was verified server-side; everything else stays
  // owner-pinned. Empty list → byte-identical SQL to the previous form.
  const { sql: kOwnerGate, params: kOwnerGateParams } = buildOwnerGate(
    "$2",
    visArgs.accessibleProjectIds ?? [],
    3 + kProjectParams.length,
  );

  const knowledge = await db.$queryRawUnsafe<RetrievedKnowledge[]>(
    `
    SELECT id, type, tags, "triggerText", "ruleText", rationale, confidence,
           "successCount", "failureCount", "usageCount", "lastUsedAt",
           1 - (embedding <=> $1::vector) AS "_similarity"
    FROM "Knowledge"
    WHERE ${kOwnerGate}
      AND embedding IS NOT NULL${RULE_TYPES_PREDICATE}${kProjectFilter}
    ORDER BY embedding <=> $1::vector ASC
    LIMIT 12
    `,
    toVector(qvec),
    userId,
    ...kProjectParams,
    ...kOwnerGateParams,
  );

  const sessionWhere = buildSessionWhere(
    userId,
    projectId ?? "",
    dataScope,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionsRaw = await db.session.findMany({
    where: {
      ...(sessionWhere as object),
      endedAt: { not: null },
    } as any,
    orderBy: { endedAt: "desc" },
    take: 10,
    include: {
      project: true,
      applications: { where: { role: "injected" }, take: 3 },
    },
  });
  const sessions: RetrievedSession[] = sessionsRaw.map((s) => ({
    id: s.id,
    clientType: s.clientType,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    outcome: s.outcome,
    sqs: s.sqs,
    metadata: s.metadata,
    project: s.project ? { name: s.project.name } : null,
  }));

  // V2.0 (spec 2026-07-07 §4c): deterministic open-task context — complete
  // enumeration, not embedding-lucky. Flag-gated (dark); tasks are cited as
  // tasks, never as learned knowledge (kept out of `knowledge` so
  // groundedness and [^K] citations are unaffected). Direct env read matches
  // oracle.ts's existing process.env.ORACLE_MODEL style.
  let taskBlock = "";
  const tasksEnabled = /^(1|true|yes|on)$/i.test(
    process.env.V2_ORACLE_TASKS ?? "",
  );
  if (tasksEnabled) {
    try {
      // Active project only — tasks never travel via org visibility
      // (V2 security review 2026-07-10, finding 1).
      const tasks = await listProjectActionItems({
        userId,
        projectId: projectId ?? null,
      });
      taskBlock = buildTaskBlock(tasks);
    } catch {
      // Fail-soft: the Oracle answers without task context rather than 500ing.
      taskBlock = "";
    }
  }

  const knowledgeBlock = knowledge
    .map(
      (k, i) =>
        `[^K${i + 1}] [${k.type}] trigger: ${k.triggerText}\n        rule: ${k.ruleText}${
          k.rationale ? `\n        why: ${k.rationale}` : ""
        } (confidence ${k.confidence.toFixed(2)})`,
    )
    .join("\n");

  const sessionBlock = sessions
    .map((s, i) => {
      const date = (s.endedAt ?? s.startedAt).toISOString().slice(0, 10);
      const md = s.metadata as { prompt?: string } | null;
      return `[^S${i + 1}] ${date} — "${md?.prompt ?? "(no prompt)"}"
     Project: ${s.project?.name ?? "-"} | Outcome: ${s.outcome ?? "?"} | SQS: ${s.sqs ?? "-"}`;
    })
    .join("\n");

  const userPrompt = `USER QUESTION: ${question}

RELEVANT KNOWLEDGE:
${knowledgeBlock || "(no knowledge matches)"}
${taskBlock ? `\nOPEN TASKS (complete list for this project — authoritative for "what is open/blocked/unanswered" questions):\n${taskBlock}\n` : ""}
RELEVANT SESSIONS:
${sessionBlock || "(no sessions)"}

ANSWER (markdown, with [^N] citations):`;

  // When the Brain is empty, override the system prompt so the LLM is honest
  // about having no grounded context rather than fabricating citations.
  const result: {
    userPrompt: string;
    knowledge: RetrievedKnowledge[];
    sessions: RetrievedSession[];
    systemPromptOverride?: string;
  } = { userPrompt, knowledge, sessions };
  if (knowledge.length === 0 && sessions.length === 0 && taskBlock === "") {
    result.systemPromptOverride = SYSTEM_PROMPT_NO_CONTEXT;
  }

  return result;
}

/**
 * Render the OPEN TASKS prompt block (V2.0 spec §4c). Pure — exported for
 * unit tests. One line per task: blockers marked and (via listProjectActionItems
 * ordering) first, open questions labeled, assignee from the `for:` tag,
 * >14-day-old items flagged stale. `now` injectable for determinism.
 */
export function buildTaskBlock(
  tasks: Array<Pick<ActionItemRow, "ruleText" | "tags" | "createdAt">>,
  now: number = Date.now(),
): string {
  const STALE_MS = 14 * 86_400_000;
  return tasks
    .map((t) => {
      const forTag = t.tags.find((x) => x.startsWith("for:"));
      const stale =
        now - new Date(t.createdAt).getTime() > STALE_MS ? " [stale >14d]" : "";
      const blocker = t.tags.includes("blocker") ? "[BLOCKER] " : "";
      const kind = t.tags.includes("open-question") ? "open question" : "task";
      return `- ${blocker}(${kind}) ${t.ruleText} — assignee: ${forTag ? forTag.slice(4) : "unassigned"}${stale}`;
    })
    .join("\n");
}

function confidenceFrom(knowledge: unknown[]): "high" | "medium" | "low" {
  return knowledge.length >= 3 ? "high" : knowledge.length >= 1 ? "medium" : "low";
}

/**
 * Compute groundedness from retrieval results — BEFORE the LLM call.
 *
 * - none     — bundle is empty (zero knowledge + zero sessions)
 * - weak     — 1-2 knowledge rows OR only sessions (no knowledge)
 * - moderate — 3-5 knowledge rows OR mix of knowledge + sessions
 * - strong   — 6+ knowledge rows
 */
export function groundednessFrom(
  knowledge: unknown[],
  sessions: unknown[],
): OracleGroundedness {
  const k = knowledge.length;
  const s = sessions.length;
  if (k === 0 && s === 0) return "none";
  if (k >= 6) return "strong";
  if (k >= 3) return "moderate";
  if (k >= 1 && s > 0) return "moderate";
  if (k >= 1) return "weak";
  // k === 0, s > 0 — only sessions, no knowledge
  return "weak";
}

export function retrievedCountsFrom(
  knowledge: unknown[],
  sessions: unknown[],
): OracleRetrievedCounts {
  return { knowledge: knowledge.length, sessions: sessions.length };
}

export async function ask(
  userId: string,
  query: OracleQuery,
  projectId?: string,
  dataScope: DataScope = "project",
  visibilityArgs?: Omit<VisibilityScopeArgs, "userId" | "scope">,
): Promise<OracleResponse> {
  // Atomic reserve-or-deny under advisory lock — prevents the cap-race
  // where N concurrent callers all see the pre-call spend and all pass.
  // OracleCapReachedError surfaces here; map it to the legacy
  // OracleCapExceededError shape that callers expect.
  let reservedUsd = 0;
  try {
    const r = await reserveCapSlot(userId, DEFAULT_RESERVATION_USD);
    reservedUsd = r.reservedUsd;
  } catch (err) {
    if (err instanceof OracleCapReachedError) {
      throw new OracleCapExceededError(err.spentUsd, err.capUsd);
    }
    throw err;
  }
  const reasoningLevel: OracleReasoningLevel = query.reasoningLevel ?? "medium";
  const { userPrompt, knowledge, sessions, systemPromptOverride } =
    await buildContext(
      userId,
      query.question,
      projectId,
      dataScope,
      visibilityArgs,
    );
  const model = process.env.ORACLE_MODEL ?? "claude-sonnet-4-6";

  // Compute groundedness BEFORE the LLM call — reflects retrieval bundle quality.
  const groundedness = groundednessFrom(knowledge, sessions);
  const retrievedCounts = retrievedCountsFrom(knowledge, sessions);

  const { answer, tokensIn, tokensOut } = await callOracle(
    userPrompt,
    MAX_TOKENS_BY_LEVEL[reasoningLevel],
    systemPromptOverride,
  );

  await recordCall(userId, model, { input: tokensIn, output: tokensOut }, reservedUsd);
  const citations = mapCitations(answer, knowledge, sessions);

  return {
    answer,
    citations,
    confidence: confidenceFrom(knowledge),
    groundedness,
    retrievedCounts,
    relatedQuestions: deriveFollowUps(query.question),
    tokensUsed: tokensIn + tokensOut,
  };
}

/**
 * Streaming variant — yields text deltas, then a single final event
 * with citations, confidence, followups, and token usage. Caller is
 * responsible for SSE framing.
 *
 * Event order:
 *   1. meta   — emitted once, right after retrieval, before the first delta.
 *               Carries groundedness + retrievedCounts so the UI can show the
 *               header pill while the answer is still streaming.
 *   2. delta* — zero or more text chunks from the LLM
 *   3. final  — citations, confidence, groundedness, followups, token count
 */
export type OracleStreamEvent =
  | { kind: "meta"; groundedness: OracleGroundedness; retrievedCounts: OracleRetrievedCounts }
  | { kind: "delta"; text: string }
  | {
      kind: "final";
      citations: OracleCitation[];
      confidence: "high" | "medium" | "low";
      groundedness: OracleGroundedness;
      retrievedCounts: OracleRetrievedCounts;
      relatedQuestions: string[];
      tokensUsed: number;
    };

export async function* askStream(
  userId: string,
  query: OracleQuery,
  opts: {
    signal?: AbortSignal;
    projectId?: string;
    dataScope?: DataScope;
    visibilityArgs?: Omit<VisibilityScopeArgs, "userId" | "scope">;
  } = {},
): AsyncGenerator<OracleStreamEvent> {
  // Atomic reserve under advisory lock (audit C16 / #111) — see ask().
  let reservedUsd = 0;
  try {
    const r = await reserveCapSlot(userId, DEFAULT_RESERVATION_USD);
    reservedUsd = r.reservedUsd;
  } catch (err) {
    if (err instanceof OracleCapReachedError) {
      throw new OracleCapExceededError(err.spentUsd, err.capUsd);
    }
    throw err;
  }
  const reasoningLevel: OracleReasoningLevel = query.reasoningLevel ?? "medium";
  const { userPrompt, knowledge, sessions, systemPromptOverride } =
    await buildContext(
      userId,
      query.question,
      opts.projectId,
      opts.dataScope ?? "project",
      opts.visibilityArgs,
    );
  const maxTokens = MAX_TOKENS_BY_LEVEL[reasoningLevel];
  const model = process.env.ORACLE_MODEL ?? "claude-sonnet-4-6";

  // Compute groundedness BEFORE the LLM call — reflects retrieval bundle quality.
  const groundedness = groundednessFrom(knowledge, sessions);
  const retrievedCounts = retrievedCountsFrom(knowledge, sessions);

  // Emit meta event immediately after retrieval so the UI can render the
  // "Grounded on N rules · M sessions" header pill while the answer streams.
  yield { kind: "meta", groundedness, retrievedCounts };

  let answer = "";
  let tokensIn = 0;
  let tokensOut = 0;

  for await (const ev of callOracleStream(
    userPrompt,
    maxTokens,
    opts.signal,
    systemPromptOverride,
  )) {
    if (ev.kind === "delta") {
      answer += ev.text;
      yield ev;
    } else {
      tokensIn = ev.tokensIn;
      tokensOut = ev.tokensOut;
    }
  }

  // Record cost even if the stream was aborted mid-flight — we paid for what
  // the model generated before the abort. Pass `reservedUsd` so the ledger
  // nets the actual cost against the upfront reservation.
  await recordCall(userId, model, { input: tokensIn, output: tokensOut }, reservedUsd);

  yield {
    kind: "final",
    citations: mapCitations(answer, knowledge, sessions),
    confidence: confidenceFrom(knowledge),
    groundedness,
    retrievedCounts,
    relatedQuestions: deriveFollowUps(query.question),
    tokensUsed: tokensIn + tokensOut,
  };
}

/**
 * True when the Anthropic SDK path should handle this call. We use the
 * SDK for: (a) native Claude models, OR (b) any model when
 * `ANTHROPIC_BASE_URL` points at an Anthropic-compatible provider
 * (e.g. Z.ai / GLM, AWS Bedrock, Vertex anthropic proxy) — in that
 * case the provider's own model names (`glm-*`, etc.) are passed
 * through verbatim.
 */
function useAnthropicSdk(model: string): boolean {
  if (model.startsWith("claude")) return true;
  if (process.env.ANTHROPIC_BASE_URL) return true;
  return false;
}

async function callOracle(
  userPrompt: string,
  maxTokens: number,
  systemPromptOverride?: string,
): Promise<{ answer: string; tokensIn: number; tokensOut: number }> {
  const model = process.env.ORACLE_MODEL ?? "claude-sonnet-4-6";
  const systemPrompt = systemPromptOverride ?? SYSTEM_PROMPT;
  if (useAnthropicSdk(model)) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      ...(process.env.ANTHROPIC_BASE_URL
        ? { baseURL: process.env.ANTHROPIC_BASE_URL }
        : {}),
    });
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    // Anthropic SDK 0.91+ widened `ContentBlock` to include thinking blocks
    // and tool-use blocks; flatMap with a discriminated check is the
    // type-safe extraction of text content.
    const text = res.content
      .flatMap((c) => (c.type === "text" ? [c.text] : []))
      .join("");
    return {
      answer: text,
      tokensIn: res.usage.input_tokens,
      tokensOut: res.usage.output_tokens,
    };
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return {
    answer: res.choices[0]?.message.content ?? "",
    tokensIn: res.usage?.prompt_tokens ?? 0,
    tokensOut: res.usage?.completion_tokens ?? 0,
  };
}

type StreamEvent =
  | { kind: "delta"; text: string }
  | { kind: "done"; tokensIn: number; tokensOut: number };

async function* callOracleStream(
  userPrompt: string,
  maxTokens: number,
  signal: AbortSignal | undefined,
  systemPromptOverride?: string,
): AsyncGenerator<StreamEvent> {
  if (signal?.aborted) return;
  const model = process.env.ORACLE_MODEL ?? "claude-sonnet-4-6";
  const systemPrompt = systemPromptOverride ?? SYSTEM_PROMPT;
  if (useAnthropicSdk(model)) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      ...(process.env.ANTHROPIC_BASE_URL
        ? { baseURL: process.env.ANTHROPIC_BASE_URL }
        : {}),
    });
    // Anthropic SDK accepts a per-request `signal` via the options object.
    const stream = client.messages.stream(
      {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      },
      signal ? { signal } : undefined,
    );
    try {
      for await (const event of stream) {
        if (signal?.aborted) break;
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { kind: "delta", text: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      yield {
        kind: "done",
        tokensIn: final.usage.input_tokens,
        tokensOut: final.usage.output_tokens,
      };
    } catch (err) {
      if (isAbortError(err, signal)) return;
      throw err;
    }
    return;
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const stream = await client.chat.completions.create(
    {
      model,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
    signal ? { signal } : undefined,
  );
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const delta = chunk.choices[0]?.delta.content;
      if (typeof delta === "string" && delta.length > 0) {
        yield { kind: "delta", text: delta };
      }
      if (chunk.usage) {
        tokensIn = chunk.usage.prompt_tokens ?? tokensIn;
        tokensOut = chunk.usage.completion_tokens ?? tokensOut;
      }
    }
    yield { kind: "done", tokensIn, tokensOut };
  } catch (err) {
    if (isAbortError(err, signal)) return;
    throw err;
  }
}

function isAbortError(err: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err && typeof err === "object" && "name" in err && (err as { name?: string }).name === "AbortError") {
    return true;
  }
  return false;
}

export function mapCitations(
  answer: string,
  knowledge: RetrievedKnowledge[],
  sessions: RetrievedSession[],
): OracleCitation[] {
  const pattern = /\[\^([KS])(\d+)\]/g;
  const seen = new Map<string, OracleCitation>();
  for (const m of answer.matchAll(pattern)) {
    const kind = m[1];
    const n = Number(m[2]) - 1;
    const key = `${kind}${n}`;
    if (seen.has(key)) continue;
    if (kind === "K") {
      const row = knowledge[n];
      if (!row) continue;
      const eff = effectivenessScore({
        successCount: row.successCount,
        failureCount: row.failureCount,
        usageCount: row.usageCount,
      });
      const knowledgeType = row.type as OracleCitationMeta["knowledgeType"];
      const meta: OracleCitationMeta = {
        ...(knowledgeType !== undefined ? { knowledgeType } : {}),
        triggerText: row.triggerText,
        effectiveness: eff,
        outcomes: row.successCount + row.failureCount,
        usageCount: row.usageCount,
        ...(row.lastUsedAt !== null ? { lastUsedAt: row.lastUsedAt.toISOString() } : {}),
        ...(Array.isArray(row.tags) && row.tags.includes("decision") ? { isDecision: true } : {}),
      };
      seen.set(key, {
        marker: n + 1,
        knowledgeId: row.id,
        excerpt: row.ruleText,
        meta,
      });
    } else if (kind === "S") {
      const row = sessions[n];
      if (!row) continue;
      const md = row.metadata as { prompt?: string } | null;
      // Map DB outcome ("success" | "partial" | "failed" | null) to display value
      let sessionOutcome: OracleCitationMeta["sessionOutcome"] = "unknown";
      if (row.outcome === "success") sessionOutcome = "success";
      else if (row.outcome === "partial" || row.outcome === "failed") sessionOutcome = "failure";
      const meta: OracleCitationMeta = {
        ...(row.project?.name !== undefined ? { projectName: row.project.name } : {}),
        sessionStartedAt: row.startedAt.toISOString(),
        sessionOutcome,
        clientType: row.clientType,
      };
      seen.set(key, {
        marker: n + 1,
        sessionId: row.id,
        excerpt: md?.prompt ?? "",
        meta,
      });
    }
  }
  return [...seen.values()];
}

function deriveFollowUps(question: string): string[] {
  // Placeholder — a v2 can ask the LLM for related questions inline.
  const lower = question.toLowerCase();
  if (lower.includes("react"))
    return [
      "What do I usually do for state management?",
      "Show me my anti-patterns in React",
    ];
  if (lower.includes("test"))
    return [
      "What test framework do I prefer?",
      "What's my coverage target?",
    ];
  return [
    "Show me my most confident principles",
    "What have I been learning recently?",
  ];
}
