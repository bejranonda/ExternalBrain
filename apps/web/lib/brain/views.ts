/**
 * View-models — server-side mappers from DB rows to GUI-friendly shapes.
 *
 * The GUI components were drafted from the design bundle with their own
 * field names. Rather than refactor 4,000+ lines of components every time
 * the schema evolves, server routes shape data into stable view types
 * declared here. View types are the API contract.
 */
// @brain/db re-exports the Prisma generated types — apps/web doesn't depend
// on @prisma/client directly to keep the package boundary clean.
import type {
  AutoskillProposal as DbAutoskillProposal,
  Session as DbSession,
  Knowledge as DbKnowledge,
} from "@brain/db";
import { effectivenessScore } from "@brain/core";

export interface ProposalView {
  id: string;
  /** Tier from the autoskill scoring (HIGH ≥ 7, MEDIUM 4-6). LOW never reaches the queue. */
  confidence: "high" | "medium";
  /** Display category — derived from patch contents. */
  type:
    | "style"
    | "anti_principle"
    | "recipe"
    | "heuristic"
    | "principle"
    | "reflex";
  /** First-line text of the proposed change. */
  title: string;
  /** Human-readable target description, e.g. "skill (typescript-style)". */
  target: string;
  /** The reasoning string from autoskill — keeps citation context. */
  reason: string;
  /** Source session id (truncated for display). */
  session: string;
  /** Pattern occurrences in the originating session (for the "× N" badge). */
  pattern: number;
  /** ISO timestamp — for relative-time rendering. */
  createdAt: string;
  /** Status — pending rows are the queue; applied/rejected may be shown in history. */
  status: "pending" | "applied" | "rejected" | "superseded";
}

export function toProposalView(p: DbAutoskillProposal): ProposalView {
  const patch = (p.patch ?? {}) as Record<string, unknown>;

  const text =
    pickString(patch, "text") ??
    pickString(patch, "rule") ??
    p.diff ??
    "(no preview)";

  const type = inferDisplayType(patch);
  const target = renderTarget(p.target, p.targetId, patch);
  const evidence = (patch.evidence as unknown[] | undefined) ?? [];

  return {
    id: p.id,
    confidence: (p.confidence as "high" | "medium") ?? "medium",
    type,
    title: text.length > 110 ? text.slice(0, 110) + "…" : text,
    target,
    reason: p.reasoning,
    session: p.sessionId,
    pattern: Math.max(evidence.length, 1),
    createdAt: p.createdAt.toISOString(),
    status: p.status as ProposalView["status"],
  };
}

function pickString(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" ? v : null;
}

function inferDisplayType(patch: Record<string, unknown>): ProposalView["type"] {
  const explicit = pickString(patch, "type");
  if (explicit && isDisplayType(explicit)) return explicit;
  const section = pickString(patch, "section");
  if (section === "style") return "style";
  if (section === "testing") return "recipe";
  if (section === "error-handling") return "heuristic";
  return "anti_principle";
}

function isDisplayType(s: string): s is ProposalView["type"] {
  return ["style", "anti_principle", "recipe", "heuristic", "principle", "reflex"].includes(s);
}

function renderTarget(
  target: string,
  targetId: string | null,
  patch: Record<string, unknown>,
): string {
  switch (target) {
    case "skill":
      return targetId ? `skill (${targetId.slice(0, 8)})` : "skill";
    case "knowledge":
      return "new Knowledge item";
    case "rules": {
      const file = pickString(patch, "file");
      return file ? `rules export → ${file}` : "rules export";
    }
    case "internal_skill":
      return "internal wisdom skill";
    default:
      return target;
  }
}

// ============================================================
// SESSIONS
// ============================================================

export interface SessionView {
  id: string;
  /** Short id for display, e.g. "s_9f4a". */
  shortId: string;
  /** First ~140 chars of the user-facing task description. May be null for very old rows. */
  prompt: string | null;
  client: string;
  /** Icon hint for the GUI: "claude" | "cursor" | "windsurf" | "mcp". */
  icon: "claude" | "cursor" | "windsurf" | "mcp";
  project: string;
  startedAt: string; // "YYYY-MM-DD HH:MM"
  /** "1h 12m" when the session has ended; "—" when still in progress. */
  duration: string;
  /** State distinguishes ended sessions from in-flight ones. */
  state: "in_progress" | "ended";
  outcome: "accepted" | "partial" | "rejected" | "in_progress";
  sqs: number; // 0-1 float for display (DB stores 0-100)
  injected: number;
  extracted: number;
}

export function toSessionView(
  s: DbSession & {
    project?: { name: string } | null;
    _count?: { applications?: number };
    _injectedCount?: number;
    _extractedCount?: number;
  },
): SessionView {
  // A session that hasn't reported its outcome should NOT show a runaway
  // wall-clock duration ("35h 50m" for a session that crashed or is still
  // open). Treat null endedAt as "in progress" and let the UI render that
  // explicitly instead of guessing.
  const isEnded = s.endedAt !== null && s.endedAt !== undefined;
  const dur = isEnded ? Math.max(0, s.endedAt!.getTime() - s.startedAt.getTime()) : 0;
  return {
    id: s.id,
    shortId: shortenId(s.id),
    prompt: extractPrompt(s.metadata),
    client: s.clientType,
    icon: clientIcon(s.clientType),
    project: s.project?.name ?? "—",
    startedAt: formatDateTime(s.startedAt),
    duration: isEnded ? formatDuration(dur) : "—",
    state: isEnded ? "ended" : "in_progress",
    outcome: isEnded ? mapOutcome(s.outcome) : "in_progress",
    sqs: typeof s.sqs === "number" ? s.sqs / 100 : 0,
    injected: s._injectedCount ?? 0,
    extracted: s._extractedCount ?? 0,
  };
}

// The MCP `brain_start_session` tool persists the user-facing task
// description into Session.metadata.prompt (see apps/mcp-server/src/tools/
// start-session.ts:96). It's not a top-level column, so the cast through
// unknown is required by Prisma's JsonValue typing.
export function extractPrompt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const p = (metadata as Record<string, unknown>).prompt;
  if (typeof p !== "string") return null;
  const t = p.trim();
  if (!t) return null;
  return t.length > 140 ? `${t.slice(0, 137)}…` : t;
}

function shortenId(id: string): string {
  // Keep first 6 chars after any prefix — mirrors the `s_9f4a`-style of seed.
  return `s_${id.slice(-4)}`;
}

function clientIcon(client: string): SessionView["icon"] {
  if (client === "claude_code") return "claude";
  if (client === "cursor") return "cursor";
  if (client === "windsurf") return "windsurf";
  return "mcp";
}

function mapOutcome(o: string | null): SessionView["outcome"] {
  if (o === "success") return "accepted";
  if (o === "partial") return "partial";
  return "rejected";
}

function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${pad2(m)}m`;
  return `${m}m`;
}
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// ============================================================
// KNOWLEDGE — the "Skills" UI surface browses these atomic rules
// (the schema table is `Knowledge`; the `Skill` table — markdown
// bundles — is a separate concept exposed through a different
// surface later.)
// ============================================================

export type KnowledgeDisplayType =
  | "recipe"
  | "heuristic"
  | "principle"
  | "reflex"
  | "anti";

export interface KnowledgeItemView {
  id: string;
  type: KnowledgeDisplayType;
  title: string;
  body: string;
  scope: "global" | "user" | "project" | "community";
  /** Phase 4: listing visibility — "private" | "project" | "org" */
  visibility: "private" | "project" | "org";
  confidence: number;
  uses: number;
  success: number; // 0-1
  updated: string; // relative time
  /** Raw ISO timestamp of creation — clients that need to compare ages
   *  (e.g. the LatestInsight 14-day cutoff) work off this, not `updated`. */
  createdAt: string;
  tags: string[];
  ownerUserId?: string | undefined;
  ownerProjectId?: string | null | undefined;
  originProjectId?: string | null | undefined;
  parentKnowledgeId?: string | null | undefined;
  /** Core Value B: effectiveness score — 0..1 or -1 for "insufficient data" */
  effectiveness: number;
  /** Core Value B: total outcome count (successCount + failureCount) */
  outcomes: number;
}

export function toKnowledgeItemView(k: DbKnowledge): KnowledgeItemView {
  const totalApplied = k.successCount + k.failureCount;
  const success = totalApplied > 0 ? k.successCount / totalApplied : 0;

  // Phase 4: visibility field may not exist on older DB rows (before migration);
  // default to "project" for backward compatibility.
  const visibilityRaw = (k as DbKnowledge & { visibility?: string }).visibility;
  const visibility = mapKnowledgeVisibility(visibilityRaw);

  const effectiveness = effectivenessScore({
    successCount: k.successCount,
    failureCount: k.failureCount,
    usageCount: k.usageCount,
  });

  return {
    id: k.id,
    type: knowledgeDisplayType(k.type),
    title: deriveTitle(k.ruleText),
    body: k.ruleText,
    scope: mapKnowledgeScope(k.scope),
    visibility,
    confidence: k.confidence,
    uses: k.usageCount,
    success,
    updated: relativeTime(k.confirmedAt ?? k.createdAt),
    createdAt: k.createdAt.toISOString(),
    tags: k.tags,
    ownerUserId: k.ownerUserId ?? undefined,
    ownerProjectId: k.ownerProjectId,
    originProjectId: (k as DbKnowledge & { originProjectId?: string | null }).originProjectId,
    parentKnowledgeId: k.parentKnowledgeId,
    effectiveness,
    outcomes: totalApplied,
  };
}

function mapKnowledgeVisibility(v: string | undefined | null): KnowledgeItemView["visibility"] {
  if (v === "private" || v === "org") return v;
  return "project"; // default
}

function knowledgeDisplayType(t: string): KnowledgeDisplayType {
  if (t === "anti_principle") return "anti";
  if (t === "heuristic") return "heuristic";
  if (t === "principle") return "principle";
  if (t === "reflex") return "reflex";
  return "recipe";
}

function mapKnowledgeScope(scope: string): KnowledgeItemView["scope"] {
  if (scope === "global" || scope === "user" || scope === "project" || scope === "community") {
    return scope;
  }
  return "user";
}

function deriveTitle(rule: string): string {
  const firstSentence = rule.split(/[.!?\n]/)[0] ?? rule;
  return firstSentence.length > 90 ? firstSentence.slice(0, 90) + "…" : firstSentence;
}

function relativeTime(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? "" : "s"} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${days < 60 ? "" : "s"} ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// ============================================================
// DASHBOARD — composite stats
// ============================================================

export interface DashboardStats {
  activeKnowledge: number;
  sessionsAllTime: number;
  sessionsWeek: number;
  sqsCurrent: number; // 0-1
  sqsTrend: number[]; // last 12 sessions, 0-1
  pendingProposals: number;
  knowledgeHealth: number; // 0-1
  contradictions: number;
  decayThisWeek: number;
  bundleHitRate: number;
}

