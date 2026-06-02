/**
 * Shared types for the Brain Platform.
 *
 * These are the canonical shapes used across the MCP server, webapp, worker,
 * and SDK. If a shape lives in the DB it is authored here first and the Prisma
 * schema conforms to it.
 */

// ============================================================
// KNOWLEDGE — the atomic unit
// ============================================================

export type KnowledgeType =
  | "reflex"
  | "recipe"
  | "heuristic"
  | "principle"
  | "anti_principle";

export type KnowledgeScope =
  | "global"
  | "user"
  | "project"
  | "session_context"
  | "team"
  | "community";

export type KnowledgeExtractedBy = "kea" | "user" | "imported" | "promoted";

export interface Knowledge {
  id: string;
  type: KnowledgeType;
  scope: KnowledgeScope;

  ownerUserId: string | null;
  ownerTeamId: string | null;
  ownerProjectId: string | null;

  triggerText: string;
  ruleText: string;
  rationale: string | null;
  symbolicWhen: string | null;
  symbolicThen: string | null;
  instead: string | null; // anti-principles

  framework: string | null;
  language: string | null;
  tags: string[];

  confidence: number; // 0-1
  successCount: number;
  failureCount: number;
  usageCount: number;
  decayScore: number; // 0-1

  createdAt: Date;
  confirmedAt: Date | null;
  lastUsedAt: Date | null;

  extractedBy: KnowledgeExtractedBy;
  sourceSessionIds: string[];
  parentKnowledgeId: string | null;
}

export interface KnowledgeBundle {
  reflexes: Knowledge[];
  recipes: Knowledge[];
  heuristics: Knowledge[];
  principles: Knowledge[];
  antiPrinciples: Knowledge[];
  skill?: Skill | null;
  /** The ID list that was injected — record this with brain_report_session_outcome. */
  injectedIds: string[];
}

// ============================================================
// SKILLS — user-visible bundles of knowledge in markdown form
// ============================================================

export type SkillStage = "inbox" | "notes" | "knowledge" | "wisdom";
export type SkillKind = "output" | "internal";

export interface SkillFrontmatter {
  skill_id: string;
  title: string;
  stage: SkillStage;
  kind: SkillKind;
  scope: KnowledgeScope;
  tags: string[];
  dependencies: string[]; // other skill_ids (wikilink-resolvable)
  confidence: number;
  mastery: number; // 1-5
  created: string; // ISO
  updated: string; // ISO
  [key: string]: unknown;
}

export interface Skill {
  id: string;
  skillId: string; // stable slug, matches frontmatter.skill_id
  title: string;
  content: string; // full markdown (frontmatter + body)
  frontmatter: SkillFrontmatter;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  scope: KnowledgeScope;
  successCount: number;
  failureCount: number;
  usageCount: number;
  version: number;
  parentSkillId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SkillExportFormat =
  | "claude-code"
  | "cursor"
  | "windsurf"
  | "codex"
  | "markdown";

// ============================================================
// SESSIONS — what external clients report
// ============================================================

export type SessionClientType =
  | "claude_code"
  | "cursor"
  | "windsurf"
  | "autobahn"
  | "custom"
  | "webapp";

export type SessionOutcome = "success" | "partial" | "failed";

export type SessionEventType =
  | "session_started"
  | "tool_use"
  | "file_created"
  | "file_modified"
  | "file_rejected"
  | "build_attempt"
  | "build_success"
  | "build_failure"
  | "user_clarification"
  | "user_correction"
  | "knowledge_injected"
  | "knowledge_rejected";

export interface Session {
  id: string;
  userId: string;
  projectId: string | null;
  teamId: string | null;
  parentSessionId: string | null; // for context compactions
  clientType: SessionClientType;
  startedAt: Date;
  endedAt: Date | null;
  outcome: SessionOutcome | null;
  sqs: number | null; // Session Quality Score, 0-100
  metadata: Record<string, unknown>;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  eventType: SessionEventType;
  payload: Record<string, unknown>;
  timestamp: Date;
}

// Optional fields are declared with explicit `| undefined` so callers can pass
// objects shaped by Zod parsing (where missing fields surface as
// `undefined` values) without per-field `...(x ? {x} : {})` gymnastics under
// `exactOptionalPropertyTypes`.

export interface SessionContext {
  sessionId: string;
  userId: string;
  projectId?: string | undefined;
  framework?: string | undefined;
  language?: string | undefined;
  sessionMode?: "building" | "debugging" | "refactoring" | "exploring" | undefined;
  /** Phase 2b: filter candidates to active-project scope ("project") or all ("all"). Defaults to "project" in kra.ts. */
  dataScope?: "project" | "all" | undefined;
  /** Phase 4: org ID for visibility-aware retrieval. */
  orgId?: string | undefined;
  /** Phase 4: all project IDs in the active org the user can access. */
  accessibleProjectIds?: string[] | undefined;
}

export interface SessionMetrics {
  filesCreated: string[];
  filesModified: string[];
  filesRejected: string[];
  buildAttempts: number;
  errors: string[];
  userFeedback?: "up" | "down" | undefined;
  userFeedbackComment?: string | undefined;
  knowledgeUsed: string[]; // IDs injected at start
  durationMs: number;
  tokensUsed: number;
}

// ============================================================
// GRAPH — Obsidian-style linking
// ============================================================

export type GraphRelation =
  | "depends_on"
  | "prerequisite_for"
  | "related_to"
  | "deepens"
  | "specializes"
  | "contradicts"
  | "supersedes";

export interface GraphEdge {
  id: string;
  sourceId: string; // skill or knowledge ID
  targetId: string;
  relation: GraphRelation;
  scope: KnowledgeScope;
  weight: number; // 0-1
  createdBy: string; // userId | "kea" | "autoskill"
  evidence: string[]; // session IDs or knowledge IDs justifying the edge
  createdAt: Date;
}

// ============================================================
// PEER CARDS — Honcho-style hard-override facts
// ============================================================

export interface PeerCard {
  id: string;
  ownerUserId: string;
  ownerProjectId: string | null;
  facts: string[]; // simple bullet list
  updatedAt: Date;
}

// ============================================================
// ORACLE — chat interface
// ============================================================

export type OracleReasoningLevel = "minimal" | "low" | "medium" | "high" | "max";

export interface OracleQuery {
  question: string;
  conversationId?: string | undefined;
  reasoningLevel?: OracleReasoningLevel | undefined;
}

/** Enriched metadata attached to each Oracle citation — Phase "Why this answer". */
export interface OracleCitationMeta {
  // ── Knowledge citation fields ────────────────────────────────────────────
  /** The knowledge type (reflex / recipe / heuristic / principle / anti_principle). */
  knowledgeType?: "reflex" | "recipe" | "heuristic" | "principle" | "anti_principle";
  /** The trigger text ("when" of the rule). */
  triggerText?: string;
  /**
   * Effectiveness score: 0..1 when ≥3 outcomes, -1 (sentinel) when insufficient data.
   * Computed from effectivenessScore({ successCount, failureCount, usageCount }).
   */
  effectiveness?: number;
  /** successCount + failureCount — total sessions with a recorded outcome. */
  outcomes?: number;
  /** Total Oracle retrieval count (usageCount). */
  usageCount?: number;
  /** ISO string for lastUsedAt on the Knowledge row. */
  lastUsedAt?: string;

  // ── Session citation fields ──────────────────────────────────────────────
  /** Display name of the owning Project. */
  projectName?: string;
  /** ISO string for Session.startedAt. */
  sessionStartedAt?: string;
  /**
   * Session outcome. Maps the DB "success|partial|failed" to the
   * trimmed union used by the UI ("success"|"failure"|"unknown").
   */
  sessionOutcome?: "success" | "failure" | "unknown";
  /** Client type that ran the session (claude_code / cursor / etc.). */
  clientType?: string;
}

export interface OracleCitation {
  marker: number; // the [^N] in the response
  knowledgeId?: string | undefined;
  sessionId?: string | undefined;
  skillId?: string | undefined;
  excerpt: string;
  /** Enriched Why-this-answer metadata. Absent when the row cannot be resolved. */
  meta?: OracleCitationMeta | undefined;
}

/** How much Brain context the answer drew on (independent of LLM confidence). */
export type OracleGroundedness = "strong" | "moderate" | "weak" | "none";

export interface OracleRetrievedCounts {
  knowledge: number;
  sessions: number;
}

export interface OracleResponse {
  answer: string;
  citations: OracleCitation[];
  confidence: "high" | "medium" | "low";
  /** How much Brain context was available when composing the answer. */
  groundedness: OracleGroundedness;
  /** Raw retrieval counts — use for "N rules · M sessions" display. */
  retrievedCounts: OracleRetrievedCounts;
  relatedQuestions: string[];
  tokensUsed: number;
}

// ============================================================
// AUTOSKILL — Hermes-inspired post-session improvement
// ============================================================

export type AutoskillConfidence = "high" | "medium";

export type AutoskillTarget =
  | "skill" // update a user skill
  | "rules" // .claude/rules or equivalent
  | "knowledge" // create a new Knowledge item
  | "internal_skill"; // improve the platform itself

export interface AutoskillProposal {
  id: string;
  userId: string;
  sessionId: string;
  target: AutoskillTarget;
  targetId: string | null; // skill/knowledge being edited; null for creation
  confidence: AutoskillConfidence;
  diff: string; // human-readable proposed change
  patch: Record<string, unknown>; // machine-applicable change
  reasoning: string;
  status: "pending" | "applied" | "rejected" | "superseded";
  createdAt: Date;
  resolvedAt: Date | null;
}

// ============================================================
// MCP auth
// ============================================================

export interface MCPToken {
  id: string;
  userId: string;
  teamId: string | null;
  name: string;
  scope: "personal" | "team";
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
}

// ============================================================
// Evaluation
// ============================================================

export interface SessionQualityScore {
  sessionId: string;
  score: number; // 0-100
  buildSuccess: number;
  userFeedback: number;
  diffAcceptanceRatio: number;
  clarificationPenalty: number;
  computedAt: Date;
}

export interface KnowledgeHealthSnapshot {
  snapshotAt: Date;
  usedInLast30Days: number;
  totalActive: number;
  averageConfidence: number;
  contradictionCount: number;
  medianAgeDays: number;
}
