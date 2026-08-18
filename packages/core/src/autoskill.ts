/**
 * Autoskill — post-session improvement proposals.
 *
 * Adopts nicknisi/claude-plugins/autoskill (https://skills.sh/nicknisi/claude-plugins/autoskill).
 * Captured spec: research/autoskill/spec.md. Adaptation diff: research/autoskill/integration_notes.md.
 *
 * Pipeline (six steps):
 *   1. detectSignals      — extract corrections / repeats / approvals from session events
 *   2. scoreSignals       — apply nicknisi point system (5 / 3 / 2 / 1)
 *   3. resolveConflicts   — recency > explicitness > repetition > score
 *   4. passesQualityFilter — 4-question filter (specific, actionable, durable, non-generic)
 *   5. routeSignal        — Skill | rules | new Knowledge | internal_skill | ignore
 *   6. proposeChange      — write AutoskillProposal row, never auto-apply
 *
 * Approval is asynchronous via webapp queue; HIGH-tier proposals can auto-apply
 * if the user opts in (default: off). Every applied proposal is reversible —
 * patches use append/insert/create ops only, never replace/delete.
 */
import type {
  AutoskillProposal,
  AutoskillTarget,
  AutoskillConfidence,
  KnowledgeType,
} from "@brain/types";
import { db, Prisma, toVector } from "@brain/db";
import { embed, embedWithProvenance, cosineSimilarity } from "./embedding.js";
import { getLogger } from "./logger.js";
import {
  classifySignals,
  classifierEnabled,
  decideTarget,
  inferKnowledgeType,
  deriveTrigger,
  type Verdict,
} from "./autoskill-classifier.js";

const log = getLogger("autoskill");

// ============================================================
// Per-call embedding cache — collapses O(n²) to O(n) within
// a single runForSession invocation. The global LRU in
// embedding.ts is content-hashed so cross-call duplicates are
// also free; this cache avoids the round-trip and hash cost
// for the common in-pipeline reuse.
// ============================================================

class EmbeddingCache {
  private map = new Map<string, Promise<number[]>>();

  get(text: string): Promise<number[]> {
    let p = this.map.get(text);
    if (!p) {
      p = embed(text);
      this.map.set(text, p);
    }
    return p;
  }
}

// ============================================================
// Public entry
// ============================================================

export async function runForSession(
  sessionId: string,
): Promise<AutoskillProposal[]> {
  const session = await db.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { events: { orderBy: { timestamp: "asc" } } },
  });

  const cache = new EmbeddingCache();

  // 1. Detect raw signals
  const signals = detectSignals(session.events);
  if (signals.length === 0) return [];

  // 2. Score with nicknisi point system
  const scored = signals.map((s) => ({ ...s, score: scoreSignal(s) }));

  // 3. Resolve conflicts (returns the surviving signals only)
  const resolved = await resolveConflicts(scored, session.userId, cache);

  // 4. Filter for quality + durability
  const durable = resolved.filter(passesQualityFilter);

  // 4b. Batch-classify the survivors in ONE LLM call (verdict map keyed by the
  // index into `durable`). Empty/over-cap/error → missing entries, and
  // routeSignal falls back to the heuristic per signal (never drops a signal).
  const verdicts = await classifySignals(durable, session.userId);

  // 5. Route + 6. propose
  // Idempotency on retry (audit C9 / #108): before creating a proposal,
  // check whether a pending one already exists for the same
  // (sessionId, target, targetId). Without this, a pg-boss retry after
  // a partial-loop crash silently doubles every proposal that already
  // landed. Race-safety against concurrent runs would require a DB
  // unique constraint — filed as a follow-up; this fix covers the
  // retry case (sequential by pg-boss design) which is what the audit
  // identified.
  const proposals: AutoskillProposal[] = [];
  for (let i = 0; i < durable.length; i++) {
    const s = durable[i]!;
    const routed = await routeSignal(s, session.userId, verdicts.get(i));
    if (!routed) continue;

    const existing = await db.autoskillProposal.findFirst({
      where: {
        userId: session.userId,
        sessionId,
        target: routed.target,
        targetId: routed.targetId ?? null,
        status: "pending",
      },
      select: { id: true },
    });
    if (existing) continue;

    const proposal = await db.autoskillProposal.create({
      data: {
        userId: session.userId,
        sessionId,
        target: routed.target,
        targetId: routed.targetId ?? null,
        confidence: tierForScore(s.score),
        diff: routed.diff,
        // `Prisma.InputJsonValue` isn't portable across tsc module-resolution
        // modes once @brain/db re-exports are walked through; `unknown` cast
        // is functionally equivalent because the runtime check is Prisma's.
        patch: routed.patch as unknown as object,
        reasoning: routed.reasoning,
      },
    });
    proposals.push(proposal as unknown as AutoskillProposal);
  }
  return proposals;
}

// ============================================================
// Step 1: detectSignals
// ============================================================

export type SignalKind =
  | "correction_explicit" // "always X" / "never Y"
  | "correction_repeated" // same correction ≥ 2× in this session
  | "correction_single"
  | "approval"; // "yes that's right", "perfect"

export interface Signal {
  kind: SignalKind;
  snippet: string;
  occurrences: number;
  /** Most recent occurrence in the session (newest = winner on recency conflict). */
  lastSeenAt: Date;
  /** Raw event payloads (for audit). */
  evidence: unknown[];
}

export interface ScoredSignal extends Signal {
  score: number;
}

const ALWAYS_NEVER_RE = /\b(always|never|must|don't ever|every time)\b/i;
const APPROVAL_RE = /\b(yes,? that'?s right|perfect|exactly|keep doing|good catch)\b/i;

export function detectSignals(
  events: Array<{ eventType: string; payload: unknown; timestamp: Date }>,
): Signal[] {
  const correctionEvents = events.filter(
    (e) =>
      e.eventType === "user_correction" ||
      e.eventType === "file_rejected" ||
      e.eventType === "knowledge_rejected",
  );
  const approvalEvents = events.filter(
    (e) => e.eventType === "user_clarification" || isApprovalEvent(e),
  );

  const groups = new Map<
    string,
    {
      snippet: string;
      occurrences: number;
      lastSeenAt: Date;
      evidence: unknown[];
      anyExplicit: boolean;
    }
  >();

  for (const e of correctionEvents) {
    const snippet = summarize(e.payload);
    if (!snippet) continue;
    const key = normalize(snippet);
    const g = groups.get(key) ?? {
      snippet,
      occurrences: 0,
      lastSeenAt: e.timestamp,
      evidence: [],
      anyExplicit: false,
    };
    g.occurrences += 1;
    g.lastSeenAt = e.timestamp;
    g.evidence.push(e.payload);
    if (ALWAYS_NEVER_RE.test(snippet)) g.anyExplicit = true;
    groups.set(key, g);
  }

  const out: Signal[] = [];
  for (const g of groups.values()) {
    let kind: SignalKind = "correction_single";
    if (g.anyExplicit) kind = "correction_explicit";
    else if (g.occurrences >= 2) kind = "correction_repeated";
    out.push({
      kind,
      snippet: g.snippet,
      occurrences: g.occurrences,
      lastSeenAt: g.lastSeenAt,
      evidence: g.evidence,
    });
  }

  for (const e of approvalEvents) {
    const snippet = summarize(e.payload);
    if (!snippet) continue;
    out.push({
      kind: "approval",
      snippet,
      occurrences: 1,
      lastSeenAt: e.timestamp,
      evidence: [e.payload],
    });
  }

  return out;
}

function isApprovalEvent(e: { payload: unknown }): boolean {
  const s = summarize(e.payload);
  return APPROVAL_RE.test(s);
}

function summarize(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (typeof p.reason === "string") return p.reason;
    if (typeof p.message === "string") return p.message;
    if (typeof p.text === "string") return p.text;
  }
  return "";
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// ============================================================
// Step 2: scoreSignal — nicknisi point system
// ============================================================

const SCORE_EXPLICIT = 5;
const SCORE_REPEATED = 3;
const SCORE_SINGLE = 2;
const SCORE_APPROVAL = 1;

export function scoreSignal(s: Signal): number {
  switch (s.kind) {
    case "correction_explicit":
      // Repeated explicit corrections get the explicit weight + repetition bonus
      return SCORE_EXPLICIT + (s.occurrences >= 3 ? 2 : 0);
    case "correction_repeated":
      return SCORE_REPEATED;
    case "correction_single":
      return SCORE_SINGLE;
    case "approval":
      return SCORE_APPROVAL;
  }
}

export function tierForScore(score: number): AutoskillConfidence {
  // HIGH ≥ 7, MEDIUM 3-6. Scores < 3 are LOW and MUST be filtered by
  // `routeSignal` before reaching here — this function will return
  // "medium" for score=2 and emit a noisier-than-intended proposal
  // tier if called with a LOW score. The `AutoskillConfidence` type
  // doesn't include "low" deliberately: LOW is supposed to never
  // become a proposal at all.
  if (score >= 7) return "high";
  return "medium";
}

// ============================================================
// Step 3: resolveConflicts — recency > explicitness > repetition > score
// ============================================================

async function resolveConflicts(
  scored: ScoredSignal[],
  userId: string,
  cache: EmbeddingCache,
): Promise<ScoredSignal[]> {
  // Pre-embed all snippets in parallel — single batched walk through the cache
  await Promise.all(scored.map((s) => cache.get(s.snippet)));

  // Group semantically-similar signals (cosine > 0.85). Each comparison now
  // hits the cache, so this loop is O(n²) memory-bound but no I/O.
  const groups: ScoredSignal[][] = [];
  for (const s of scored) {
    const vec = await cache.get(s.snippet);
    let placed = false;
    for (const g of groups) {
      const ref = g[0];
      if (!ref) continue;
      const refVec = await cache.get(ref.snippet);
      if (cosineSimilarity(vec, refVec) > 0.85) {
        g.push(s);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([s]);
  }

  const winners: ScoredSignal[] = [];
  for (const g of groups) {
    if (g.length === 1) {
      const only = g[0];
      if (only) winners.push(only);
      continue;
    }
    const sorted = [...g].sort(byPriority);
    const winner = sorted[0];
    if (winner) winners.push(winner);
  }

  // Cross-session bump — uses the same cache for current snippets, fresh
  // embeddings for priors (different content space).
  const out: ScoredSignal[] = [];
  for (const w of winners) {
    const bump = await crossSessionBump(w, userId, cache);
    out.push({ ...w, score: w.score + bump });
  }
  return out;
}

function byPriority(a: ScoredSignal, b: ScoredSignal): number {
  // 1. Recency — newer wins
  if (a.lastSeenAt.getTime() !== b.lastSeenAt.getTime()) {
    return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
  }
  // 2. Explicitness — explicit corrections > approvals
  const explicitOrder = (k: SignalKind) =>
    k === "correction_explicit"
      ? 4
      : k === "correction_repeated"
        ? 3
        : k === "correction_single"
          ? 2
          : 1;
  const ae = explicitOrder(a.kind);
  const be = explicitOrder(b.kind);
  if (ae !== be) return be - ae;
  // 3. Repetition
  if (a.occurrences !== b.occurrences) return b.occurrences - a.occurrences;
  // 4. Score
  return b.score - a.score;
}

async function crossSessionBump(
  s: Signal,
  userId: string,
  cache: EmbeddingCache,
): Promise<number> {
  const priors = await db.sessionEvent.findMany({
    where: {
      eventType: { in: ["user_correction", "file_rejected"] },
      session: { userId },
      timestamp: {
        gte: new Date(Date.now() - 30 * 86_400_000),
        lt: s.lastSeenAt,
      },
    },
    take: 50,
  });
  if (priors.length === 0) return 0;
  const vec = await cache.get(s.snippet);

  // Embed priors in parallel through the cache (different snippets but
  // they may also collide with each other — cache helps either way).
  const priorVecs = await Promise.all(
    priors
      .map((p) => summarize(p.payload))
      .filter((snip): snip is string => snip.length > 0)
      .map((snip) => cache.get(snip)),
  );

  let similarPriors = 0;
  for (const v of priorVecs) {
    if (cosineSimilarity(vec, v) > 0.75) similarPriors += 1;
  }
  if (similarPriors === 0) return 0;
  if (similarPriors >= 3) return 3;
  return 1;
}

// ============================================================
// Step 4: passesQualityFilter — nicknisi 4 questions
// ============================================================

const GENERIC_PHRASES = [
  "good practice",
  "best practice",
  "clean code",
  "be more careful",
  "be careful",
  "use proper",
  "do it correctly",
  "follow conventions",
  "dry principle",
  "separation of concerns",
];

const FUTURE_TENSE_RE =
  /\b(always|never|every time|from now on|in this project|in this codebase|we use|we prefer|we avoid)\b/i;
const SCOPE_LOCAL_RE = /\b(here|this case|this time|just for now|one[- ]?off)\b/i;

export function passesQualityFilter(s: ScoredSignal): boolean {
  const lower = s.snippet.toLowerCase();
  if (
    s.snippet.length < 80 &&
    GENERIC_PHRASES.some((p) => lower.includes(p))
  ) {
    return false;
  }
  if (s.snippet.length < 15) return false;
  if (SCOPE_LOCAL_RE.test(s.snippet) && !FUTURE_TENSE_RE.test(s.snippet)) {
    return false;
  }
  if (s.kind === "correction_single" && !FUTURE_TENSE_RE.test(s.snippet)) {
    return false;
  }
  if (s.kind === "approval" && s.score < 4) return false;
  return true;
}

// ============================================================
// Step 5: routeSignal — Skill | rules | knowledge | internal_skill
// ============================================================

export interface Routed {
  target: AutoskillTarget;
  targetId?: string;
  diff: string;
  patch: Record<string, unknown>;
  reasoning: string;
}

async function routeSignal(
  s: ScoredSignal,
  userId: string,
  verdict: Verdict | undefined,
): Promise<Routed | null> {
  // Drop LOW signals before they can reach the proposal queue. Audit C17
  // (#112): the previous threshold of `< 2` let `correction_single`
  // (score=2) through, where `tierForScore` then mapped it to "medium" —
  // emitting a noisier proposal queue than the spec calls for. LOW = score
  // < 3 per the comment in tierForScore.
  if (s.score < 3) return null;

  // Skill short-circuit stays exact (embedding/tag match, upstream of the LLM).
  const skill = await findRelatedSkill(s.snippet, userId);
  if (skill && s.score >= 3) {
    return {
      target: "skill",
      targetId: skill.id,
      diff: `Append rule to skill "${skill.title}": ${s.snippet}`,
      patch: {
        op: "append",
        section: sectionForSignal(s),
        text: s.snippet,
        evidence: s.evidence,
      },
      reasoning: `Signal scored ${s.score} (${s.kind}); matches skill "${skill.title}".`,
    };
  }

  // The keyword classifier (legacy path) is always computed: it drives behaviour
  // when the flag is off, and is the fail-soft fallback when the flag is on but
  // the LLM produced no verdict for this signal.
  const heuristic = heuristicRoute(s);
  const { routed, shadow } = decideTarget({
    flagOn: classifierEnabled(),
    heuristic,
    verdict,
    signal: s,
  });
  log.info({ kind: s.kind, score: s.score, ...shadow }, "autoskill.classify.shadow");
  return routed;
}

/** The pre-LLM keyword classifier, extracted verbatim from the old routeSignal.
 *  Keeps the score>=5 gate for the knowledge path (the LLM path widens it). */
function heuristicRoute(s: ScoredSignal): Routed | null {
  if (isProjectConvention(s.snippet) || isSessionBehavior(s.snippet)) {
    return {
      target: "rules",
      diff: `Add to rules export: ${s.snippet}`,
      patch: {
        op: "append",
        file: ".claude/rules/conventions.md",
        text: s.snippet,
        evidence: s.evidence,
      },
      reasoning: `Signal scored ${s.score}; classified as project convention.`,
    };
  }

  if (s.score >= 5) {
    const type = inferKnowledgeType(s);
    return {
      target: "knowledge",
      diff: `Create new ${type}: ${s.snippet}`,
      patch: {
        op: "create",
        type,
        trigger: deriveTrigger(s.snippet),
        rule: s.snippet,
        rationale: `Auto-extracted by autoskill from session events (${s.kind}, occurrences=${s.occurrences}).`,
        evidence: s.evidence,
      },
      reasoning: `Signal scored ${s.score} with no active skill match; promoting to atomic knowledge.`,
    };
  }

  return null;
}

async function findRelatedSkill(
  snippet: string,
  userId: string,
): Promise<{ id: string; title: string } | null> {
  const tokens = normalize(snippet).split(" ").filter((t) => t.length >= 4);
  if (tokens.length === 0) return null;
  const skill = await db.skill.findFirst({
    where: {
      ownerUserId: userId,
      stage: { in: ["notes", "knowledge", "wisdom"] },
      OR: tokens.map((t) => ({ tags: { has: t } })),
    },
    select: { id: true, title: true },
  });
  return skill ?? null;
}

function sectionForSignal(s: Signal): string {
  if (/style|format|indent|quote/i.test(s.snippet)) return "style";
  if (/test|coverage|mock/i.test(s.snippet)) return "testing";
  if (/error|exception|catch|throw/i.test(s.snippet)) return "error-handling";
  return "rules";
}

function isProjectConvention(snippet: string): boolean {
  return /\b(use the .+ utility|we use|always import from|naming convention|file structure|folder layout)\b/i.test(
    snippet,
  );
}

function isSessionBehavior(snippet: string): boolean {
  return (
    /\b(don'?t|stop|never|avoid)\b/i.test(snippet) &&
    /\b(summarize|narrate|comment|explain|preamble|verbose)\b/i.test(snippet)
  );
}

// `inferKnowledgeType` / `deriveTrigger` now live in autoskill-classifier.ts
// (imported above) so the runtime import edge stays one-directional.

// ============================================================
// Apply (asynchronous; user-approved unless autoApplyHigh is on)
// ============================================================

interface SkillAppendPatch {
  op: "append";
  section: string;
  text: string;
  evidence?: unknown[];
}
interface RulesAppendPatch {
  op: "append";
  file: string;
  text: string;
  evidence?: unknown[];
}
interface KnowledgeCreatePatch {
  op: "create";
  type: KnowledgeType;
  trigger: string;
  rule: string;
  rationale?: string;
  evidence?: unknown[];
}
interface InternalSkillPatch {
  op: "append" | "create";
  skillId?: string;
  title?: string;
  text: string;
  evidence?: unknown[];
}

const AUTOSKILL_MARKER_BEGIN = "<!-- autoskill:begin -->";
const AUTOSKILL_MARKER_END = "<!-- autoskill:end -->";

export async function applyProposal(proposalId: string): Promise<void> {
  const p = await db.autoskillProposal.findUniqueOrThrow({
    where: { id: proposalId },
  });
  // Accept either "pending" (direct call) or "applying" (the API route
  // pre-claimed via atomic updateMany — see audit R1 #103). Anything
  // else means the proposal already resolved; no-op.
  if (p.status !== "pending" && p.status !== "applying") return;

  // Invariant: only append/insert/create. Replace/delete forbidden.
  const op = (p.patch as { op?: string }).op;
  if (op === "replace" || op === "delete") {
    await db.autoskillProposal.update({
      where: { id: proposalId },
      data: { status: "rejected", resolvedAt: new Date() },
    });
    throw new Error(
      `autoskill cannot apply destructive op "${op}" — see KNOWLEDGE.md invariant 10`,
    );
  }

  switch (p.target) {
    case "skill":
      await applySkillAppend(p.userId, p.targetId!, p.patch as unknown as SkillAppendPatch);
      break;
    case "knowledge":
      await applyKnowledgeCreate(
        p.userId,
        p.sessionId,
        p.patch as unknown as KnowledgeCreatePatch,
      );
      break;
    case "rules":
      await applyRulesAppend(p.userId, p.patch as unknown as RulesAppendPatch);
      break;
    case "internal_skill":
      await applyInternalSkill(p.patch as unknown as InternalSkillPatch);
      break;
  }

  await db.autoskillProposal.update({
    where: { id: proposalId },
    data: { status: "applied", resolvedAt: new Date() },
  });
}

// ----- skill: append into a marked autoskill block, version-bump

async function applySkillAppend(
  userId: string,
  skillId: string,
  patch: SkillAppendPatch,
): Promise<void> {
  if (!skillId) throw new Error("skill target requires targetId");

  const skill = await db.skill.findUniqueOrThrow({ where: { id: skillId } });
  if (skill.ownerUserId !== userId) {
    // Scope invariant — never edit a skill the user doesn't own.
    throw new Error("autoskill: cannot apply to skill outside owner scope");
  }

  const newContent = appendToAutoskillBlock(
    skill.content,
    patch.section,
    patch.text,
  );

  await db.skill.update({
    where: { id: skillId },
    data: {
      content: newContent,
      version: { increment: 1 },
    },
  });
}

/** Append `text` under `## section` inside an autoskill-managed block.
 *  The block is bounded by HTML comments so manual edits outside it are safe.
 *  Idempotent: appending the same text twice still yields one bullet. */
export function appendToAutoskillBlock(
  content: string,
  section: string,
  text: string,
): string {
  const begin = AUTOSKILL_MARKER_BEGIN;
  const end = AUTOSKILL_MARKER_END;
  const bullet = `- ${text.trim()}`;
  const sectionHeader = `## ${section}`;

  if (!content.includes(begin)) {
    // Bootstrap the block at end of file
    const block = `\n\n${begin}\n${sectionHeader}\n${bullet}\n${end}\n`;
    return content.trimEnd() + block;
  }

  const beginIdx = content.indexOf(begin);
  const endIdx = content.indexOf(end, beginIdx);
  const before = content.slice(0, beginIdx + begin.length);
  const blockBody = content.slice(beginIdx + begin.length, endIdx);
  const after = content.slice(endIdx);

  // Idempotency check
  if (blockBody.includes(bullet)) return content;

  let updatedBody: string;
  if (blockBody.includes(sectionHeader)) {
    // Append bullet under existing section
    const lines = blockBody.split("\n");
    const sectionLineIdx = lines.findIndex((l) => l.trim() === sectionHeader);
    let insertAt = lines.length;
    for (let i = sectionLineIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l !== undefined && l.startsWith("## ")) {
        insertAt = i;
        break;
      }
    }
    lines.splice(insertAt, 0, bullet);
    updatedBody = lines.join("\n");
  } else {
    // New section at end of block
    updatedBody = blockBody.trimEnd() + `\n\n${sectionHeader}\n${bullet}\n`;
  }

  return before + updatedBody + after;
}

// ----- knowledge: insert atomic Knowledge row + embedding

async function applyKnowledgeCreate(
  userId: string,
  sessionId: string,
  patch: KnowledgeCreatePatch,
): Promise<void> {
  const row = await db.knowledge.create({
    data: {
      type: patch.type,
      scope: "user",
      ownerUserId: userId,
      triggerText: patch.trigger,
      ruleText: patch.rule,
      rationale: patch.rationale ?? null,
      tags: ["autoskill"],
      confidence: 0.7,
      extractedBy: "promoted",
      sourceSessionIds: [sessionId],
    },
  });

  const { vector: vec, model: embModel } = await embedWithProvenance(
    `${patch.trigger}\n${patch.rule}`,
  );
  await db.$executeRawUnsafe(
    `UPDATE "Knowledge" SET embedding = $1::vector, "embeddingModel" = $3 WHERE id = $2`,
    toVector(vec),
    row.id,
    embModel,
  );

  await db.sessionKnowledgeApplication
    .create({
      data: {
        sessionId,
        knowledgeId: row.id,
        role: "extracted_from",
      },
    })
    .catch(() => {
      /* duplicate is fine — unique constraint covers it */
    });
}

// ----- rules: stored as a global-scope reflex tagged for export.
// A separate export job (Phase 2) materializes these to .claude/rules/*,
// .cursor/rules/*, .windsurfrules, AGENTS.md as the user has configured.

async function applyRulesAppend(
  userId: string,
  patch: RulesAppendPatch,
): Promise<void> {
  const row = await db.knowledge.create({
    data: {
      type: "reflex",
      scope: "global",
      ownerUserId: userId,
      triggerText: "session start (every session)",
      ruleText: patch.text,
      rationale: `Auto-extracted by autoskill, exported to ${patch.file}`,
      tags: ["autoskill", "rules-export", `target:${patch.file}`],
      confidence: 0.8,
      extractedBy: "promoted",
      sourceSessionIds: [],
    },
  });

  const { vector: vec, model: embModel } = await embedWithProvenance(patch.text);
  await db.$executeRawUnsafe(
    `UPDATE "Knowledge" SET embedding = $1::vector, "embeddingModel" = $3 WHERE id = $2`,
    toVector(vec),
    row.id,
    embModel,
  );
}

// ----- internal_skill: upsert Skill with kind="internal".
// These improve the platform itself (KEA prompt addenda, KRA tweaks).

async function applyInternalSkill(patch: InternalSkillPatch): Promise<void> {
  const skillId = patch.skillId ?? slugify(patch.title ?? patch.text);
  const title = patch.title ?? patch.text.slice(0, 60);

  const existing = await db.skill.findFirst({
    where: { skillId, kind: "internal" },
  });

  if (existing) {
    const newContent = appendToAutoskillBlock(
      existing.content,
      "improvements",
      patch.text,
    );
    await db.skill.update({
      where: { id: existing.id },
      data: { content: newContent, version: { increment: 1 } },
    });
    return;
  }

  const content = `---
skill_id: ${skillId}
title: ${title}
kind: internal
stage: notes
---

${AUTOSKILL_MARKER_BEGIN}
## improvements
- ${patch.text}
${AUTOSKILL_MARKER_END}
`;

  await db.skill.create({
    data: {
      skillId,
      title,
      content,
      frontmatter: {
        skill_id: skillId,
        title,
        kind: "internal",
        stage: "notes",
        scope: "global",
        tags: ["autoskill"],
        dependencies: [],
        confidence: 0.7,
        mastery: 1,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
      kind: "internal",
      stage: "notes",
      scope: "global",
      tags: ["autoskill"],
      dependencies: [],
    },
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "internal-skill";
}
