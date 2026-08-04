"use client";

import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "./icons";
import { useT } from "@/lib/brain/i18n";
import {
  useOracle,
  type OracleAnswer,
  type OracleCitationView,
  type OracleCitationMeta,
  type OracleGroundedness,
  type OracleRetrievedCounts,
  type RetrievalRowView,
} from "@/lib/brain/use-oracle";
import { EffectivenessBadge } from "./effectiveness-badge";
import { useProjectScope } from "@/lib/brain/use-project-scope";
import { formatRelative } from "@brain/core/format-relative";
import { ScopePill } from "./scope-pill";
import { TeachModal } from "./teach";
import { useSessions } from "@/lib/brain/use-sessions";
import { HelpPopover } from "./help-popover";
import type { OracleReasoningLevel } from "@/lib/brain/i18n-types";

const REASONING_LEVELS: OracleReasoningLevel[] = ["minimal", "low", "medium", "high", "max"];

const REASONING_HINTS: Record<OracleReasoningLevel, string> = {
  minimal: "Fastest, shallow. Good for quick lookups.",
  low: "Quick answers with light reasoning.",
  medium: "Balanced — the right default for most questions.",
  high: "Slower, more thorough. Use for tricky decisions.",
  max: "Deepest reasoning. Slowest — use sparingly.",
};

export function Oracle() {
  const t = useT();
  const { scope, setScope } = useProjectScope();
  const { turns, status, error, ask, reset, sendFeedback } = useOracle(scope);
  // Used to derive personalised suggestions from the user's recent
  // session prompts. Limit 12 keeps the request small; only the first
  // 4 unique prompts surface as suggestion chips.
  const sessionsHook = useSessions(12, scope);
  const [q, setQ] = useState("");
  const [reasoning, setReasoning] = useState<OracleReasoningLevel>("medium");
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<Record<number, "up" | "down">>({});
  const [teachOpen, setTeachOpen] = useState(false);
  const [teachPrefill, setTeachPrefill] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, status]);

  const submit = async () => {
    if (!q.trim() || (status === "asking" || status === "streaming")) return;
    const query = q;
    setQ("");
    await ask(query, reasoning);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  // Per-project suggestions: replay recent prompts so the user gets
  // ideas drawn from their actual work. Falls back to a small set of
  // 'how do I start' meta-questions when the Brain is empty so the
  // empty-state still shows clickable affordances. Users called the
  // previous hardcoded examples (CORS / pgvector / React) misleading
  // because they implied content the Brain didn't have.
  const recent = sessionsHook.sessions
    .map((s) => s.prompt?.trim())
    .filter((p): p is string => !!p && p.length > 4 && p.length < 140);
  const recentUnique: string[] = [];
  for (const p of recent) {
    if (!recentUnique.some((q) => q.toLowerCase() === p.toLowerCase())) {
      recentUnique.push(p);
    }
    if (recentUnique.length >= 4) break;
  }
  const fallback = [
    "what rules has my Brain captured so far?",
    "summarize my recent coding patterns",
    "what's been working well across my sessions?",
    "what should I review or refresh?",
  ];
  const suggestions = recentUnique.length >= 2
    ? recentUnique
    : [...recentUnique, ...fallback].slice(0, 4);

  const lastRetrieval: RetrievalRowView[] = turns.length
    ? (turns[turns.length - 1]?.retrieval ?? [])
    : [];

  const openTeach = (prefill: string) => {
    setTeachPrefill(prefill);
    setTeachOpen(true);
  };

  return (
    <>
    <TeachModal
      open={teachOpen}
      prefillTrigger={teachPrefill}
      onClose={() => setTeachOpen(false)}
      onTaught={() => setTeachOpen(false)}
    />
    <div
      className="oracle-layout"
      data-inspector-open={turns.length > 0 ? "true" : "false"}
      style={{
        height: "100%",
        display: "grid",
        // Inspector hides before the first turn — no point showing an empty
        // right column full of "Ask a question to see retrieval." while the
        // chat waits for input.
        gridTemplateColumns: turns.length > 0 ? "1fr 320px" : "1fr",
      }}
    >
      <div
        ref={scrollRef}
        className="scroll"
        style={{ padding: "24px 32px 180px", position: "relative" }}
      >
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div className="row" style={{ marginBottom: 4 }}>
            <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.02em", fontWeight: 500 }}>
              {t("oracle.title")}
            </h1>
            <ScopePill scope={scope} onScopeChange={setScope} />
            <div className="grow" />
            {turns.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  reset();
                  setFeedbackGiven({});
                }}
              >
                <Icon name="branch" size={11} /> {t("oracle.new_thread")}
              </button>
            )}
            <HelpPopover
              content={{
                what: t("oracle.popover_what"),
                whatToDo: [
                  t("oracle.popover_step1"),
                  t("oracle.popover_step2"),
                  t("oracle.popover_step3"),
                  t("oracle.popover_step4"),
                  t("oracle.popover_step5"),
                ],
                docHref: "/docs/concepts/oracle",
              }}
            />
          </div>
          {/* UX-newcomer-pass-4 (iter 33): "Oracle" is a brand-style
              route name; first-timers don't always connect it to "ask
              my Brain a question". The one-line tagline under the h1
              makes the function obvious without renaming the route.
              Phase R: copy normalized across nav pages to a verbatim
              plain-English subtitle. */}
          <p
            style={{
              margin: "2px 0 18px",
              fontSize: 13,
              color: "var(--ink-3)",
              lineHeight: 1.4,
            }}
          >
            Ask a question — Brain answers from what it&apos;s learned
          </p>
          {/* Long intro paragraph removed (Phase 4 simplification). The
              same context now lives behind the (?) HelpPopover for users
              who want it; first-time users see a focused empty-state
              card and a real input rather than three stacked panels.
              Phase R.1: the centered EmptyState explainer card was
              dropped — it pushed the actual input below the fold and
              repeated what the subtitle + suggestion chips already say.
              The input is now the visual hero of the empty state. */}

          {turns.map((turn, i) => (
            <TurnView
              key={i}
              turn={turn}
              index={i}
              t={t}
              feedback={feedbackGiven[i]}
              onFeedback={async (rating, reason) => {
                setFeedbackGiven((m) => ({ ...m, [i]: rating }));
                await sendFeedback(i, rating, reason);
              }}
              onFollow={(q2) => setQ(q2)}
              onCopy={async () => {
                // `navigator.clipboard` is undefined on a non-secure origin —
                // the default `dev-up.sh` posture — so the previous bare
                // `void navigator.clipboard.writeText(...)` threw inside the
                // click handler and, either way, gave the user no signal at
                // all. Report the outcome so TurnView can show it.
                try {
                  if (!navigator.clipboard?.writeText) return false;
                  await navigator.clipboard.writeText(turn.answer);
                  return true;
                } catch {
                  return false;
                }
              }}
              onTeach={(q2) => openTeach(q2)}
              streaming={
                i === turns.length - 1 &&
                (status === "asking" || status === "streaming")
              }
            />
          ))}

          {status === "error" && error && (
            <div
              className="panel"
              style={{
                padding: "10px 14px",
                marginTop: 14,
                borderLeft: "3px solid var(--bad, #ff6b6b)",
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              {t("oracle.error", { msg: error })}
            </div>
          )}

          <div style={{ marginTop: 32 }}>
            <div
              className="panel"
              style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}
            >
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
                →
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder={turns.length === 0 ? t("oracle.first_placeholder") : t("oracle.placeholder")}
                style={{ flex: 1, fontSize: 14, padding: "6px 0" }}
                disabled={(status === "asking" || status === "streaming")}
              />
              {/* Reasoning level used to be 5 inline buttons — visually
                  cluttered for a setting most users never touch. Collapsed
                  to a single chip + tiny popover. Default 'medium' is
                  preselected; power users can still pick min..max. */}
              <div className="oracle-reasoning-seg" style={{ position: "relative" }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ height: 24, fontSize: 12, color: "var(--ink-3)" }}
                  onClick={() => setReasoningOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={reasoningOpen}
                  title={`Thinking depth: ${reasoning} — ${REASONING_HINTS[reasoning]} Click to change.`}
                >
                  {reasoning} ▾
                </button>
                {reasoningOpen && (
                  <div
                    role="listbox"
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 6px)",
                      right: 0,
                      background: "var(--bg-elev-1)",
                      border: "1px solid var(--line-strong)",
                      borderRadius: "var(--r-sm)",
                      padding: 4,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      minWidth: 120,
                      boxShadow: "var(--shadow-2)",
                      zIndex: 60,
                    }}
                  >
                    {REASONING_LEVELS.map((l) => (
                      <button
                        key={l}
                        type="button"
                        role="option"
                        aria-selected={reasoning === l}
                        className={reasoning === l ? "btn" : "btn btn-ghost"}
                        style={{ justifyContent: "flex-start", height: 24, fontSize: 12 }}
                        title={REASONING_HINTS[l]}
                        onClick={() => {
                          setReasoning(l);
                          setReasoningOpen(false);
                        }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ height: 26 }}
                aria-label="Send"
                onClick={() => void submit()}
                disabled={!q.trim() || (status === "asking" || status === "streaming")}
              >
                <Icon name="arrowR" size={11} />
              </button>
            </div>
            {turns.length === 0 && suggestions.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--ink-4)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 6,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {recentUnique.length >= 2
                    ? t("oracle.recent_prompts")
                    : t("oracle.starter_prompts")}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {suggestions.map((s) => {
                    // UX-newcomer-pass: chips were wrapping to 2 lines for
                    // long real prompts (the user's own session history can
                    // include 100+ char prompts like "Real improvement to
                    // External Brain itself…"). Cap chip text to 60 chars
                    // with title attr for full text on hover. One-line
                    // chips are scannable; multi-line chips look broken.
                    const display = s.length > 60 ? `${s.slice(0, 58)}…` : s;
                    return (
                      <button
                        key={s}
                        type="button"
                        className="chip"
                        title={s.length > 60 ? s : undefined}
                        style={{
                          height: 24,
                          padding: "0 10px",
                          fontFamily: "var(--font-sans)",
                          fontSize: 13,
                          color: "var(--ink-2)",
                          maxWidth: 360,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        onClick={() => setQ(s)}
                      >
                        {display}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {turns.length > 0 && (
      <aside
        className="scroll oracle-inspector"
        style={{ borderLeft: "1px solid var(--line)", background: "var(--bg-elev-1)" }}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {t("oracle.inspector")}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 6 }}>
            {t("oracle.inspector_sub", { n: lastRetrieval.length })}{" "}
            <span
              title="Score blends relevance, past success, recency, surrounding context, and Brain's confidence."
            >
              relevance, past success &amp; recency
            </span>
          </div>
        </div>

        <div style={{ padding: "12px 14px" }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              marginBottom: 8,
              letterSpacing: "0.06em",
            }}
          >
            {t("oracle.top")}
          </div>
          {lastRetrieval.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--ink-4)", padding: "8px 4px" }}>
              {t("oracle.ask_to_see")}
            </div>
          )}
          {lastRetrieval.map((r) => (
            <div
              key={r.id}
              style={{
                padding: "8px 10px",
                marginBottom: 4,
                borderRadius: 6,
                background: r.used ? "var(--accent-wash)" : "transparent",
                border: r.used
                  ? "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))"
                  : "1px solid transparent",
              }}
            >
              <div className="row" style={{ marginBottom: 4 }}>
                <span
                  className={`chip k-${r.type}`}
                  style={{ fontSize: 11, height: 16, padding: "0 5px" }}
                >
                  {r.type}
                </span>
                <div className="grow" />
                <span
                  className="mono tab-num"
                  style={{
                    fontSize: 12,
                    color: r.used ? "var(--accent-text)" : "var(--ink-3)",
                    fontWeight: 600,
                  }}
                >
                  {r.score.toFixed(2)}
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.35, color: "var(--ink-2)" }}>
                {r.title}
              </div>
              <div
                className="row mono"
                style={{ marginTop: 5, gap: 10, fontSize: 11, color: "var(--ink-4)" }}
              >
                <span title="Relevance to your question (0–1)">relevance {r.sem.toFixed(2)}</span>
                <span title="How recent this skill is (0–1)">recency {r.rec.toFixed(2)}</span>
                {r.used && <span style={{ color: "var(--accent-text)" }}>{t("oracle.cited")}</span>}
              </div>
            </div>
          ))}
        </div>
      </aside>
      )}
    </div>
    </>
  );
}

/**
 * Prominent pill rendered at the top of each Oracle answer block.
 * When groundedness !== "none" — shows "🧠 Grounded on N rules · M sessions · level"
 * When groundedness === "none" — shows the "no relevant memories" warning + Teach button.
 */
function GroundednessHeader({
  groundedness,
  retrievedCounts,
  question,
  onTeach,
  streaming,
  t,
}: {
  groundedness: OracleGroundedness;
  retrievedCounts: OracleRetrievedCounts;
  question: string;
  onTeach: (prefill: string) => void;
  streaming: boolean;
  // i18n function — passed by parent so we don't double-mount the
  // useT hook. The component renders i18n keys (oracle.no_memories,
  // oracle.grounded_on, etc.) and won't compile without it. The earlier
  // typecheck miss was because `t` was declared in the type but absent
  // from the destructure.
  t: (k: string, vars?: any) => string;
}) {
  // During the initial "asking" phase (before the meta event arrives), the
  // groundedness is still "none" with zero counts — don't flash the "no
  // memories" banner while retrieving. Wait until counts are set OR streaming
  // is done.
  const isLoading = streaming && retrievedCounts.knowledge === 0 && retrievedCounts.sessions === 0;
  if (isLoading) return null;

  if (groundedness === "none") {
    return (
      <div
        className="oracle-groundedness oracle-groundedness-none"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 12px",
          borderRadius: 8,
          marginBottom: 12,
          fontSize: 13,
          background: "color-mix(in oklab, var(--warn, #e8a000) 10%, transparent)",
          border: "1px solid color-mix(in oklab, var(--warn, #e8a000) 30%, var(--line))",
          color: "var(--ink-2)",
        }}
      >
        <span style={{ fontSize: 15 }}>⚠️</span>
        <span style={{ flex: 1 }}>
          {t("oracle.no_memories")}
        </span>
        <button
          type="button"
          className="btn btn-ghost oracle-teach-btn"
          style={{ height: 24, fontSize: 12, whiteSpace: "nowrap" }}
          onClick={() => onTeach(question)}
        >
          {t("oracle.teach_rule")}
        </button>
      </div>
    );
  }

  const levelColor: Record<Exclude<OracleGroundedness, "none">, string> = {
    strong: "var(--accent)",
    moderate: "color-mix(in oklab, var(--accent) 70%, var(--warn, #e8a000))",
    weak: "var(--ink-3)",
  };
  const color = levelColor[groundedness as Exclude<OracleGroundedness, "none">] ?? "var(--ink-3)";

  return (
    <div
      className="oracle-groundedness oracle-groundedness-grounded"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 8,
        marginBottom: 12,
        fontSize: 14,
        background: "color-mix(in oklab, var(--accent) 6%, transparent)",
        border: "1px solid color-mix(in oklab, var(--accent) 18%, var(--line))",
        color: "var(--ink-2)",
      }}
    >
      <span style={{ fontSize: 14 }}>🧠</span>
      <span>
        {t("oracle.grounded_on")}{" "}
        <strong style={{ color: "var(--ink)" }}>
          {retrievedCounts.knowledge} {retrievedCounts.knowledge === 1 ? t("oracle.rule") : t("oracle.rules")}
        </strong>
        {retrievedCounts.sessions > 0 && (
          <>
            {" "}·{" "}
            <strong style={{ color: "var(--ink)" }}>
              {retrievedCounts.sessions} {retrievedCounts.sessions === 1 ? t("oracle.session") : t("oracle.sessions_count")}
            </strong>
          </>
        )}
      </span>
      <span
        className="chip"
        style={{
          fontSize: 12,
          color,
          borderColor: "color-mix(in oklab, currentColor 30%, transparent)",
          background: "color-mix(in oklab, currentColor 8%, transparent)",
          marginLeft: 2,
        }}
      >
        {groundedness}
      </span>
    </div>
  );
}

interface TurnViewProps {
  turn: OracleAnswer;
  index: number;
  t: (k: string) => string;
  feedback: "up" | "down" | undefined;
  onFeedback(rating: "up" | "down", reason?: string): void;
  onFollow(q: string): void;
  /** Resolves true when the clipboard write actually landed. */
  onCopy(): Promise<boolean>;
  onTeach(prefill: string): void;
  streaming: boolean;
}

function TurnView({ turn, t, feedback, onFeedback, onFollow, onCopy, onTeach, streaming }: TurnViewProps) {
  const askedTime = new Date(turn.askedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const [citationsOpen, setCitationsOpen] = useState(false);
  // Per-turn, so it belongs here rather than threaded down from the parent.
  const [copyState, setCopyState] = useState<"idle" | "ok" | "fail">("idle");
  // The reason picker appears after a thumbs-down click (not before).
  // null = down not clicked yet; string = down clicked, picker open.
  const [reasonOpen, setReasonOpen] = useState(false);

  return (
    <>
      <div style={{ padding: "18px 0 8px" }}>
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 8,
          }}
        >
          {t("oracle.you")} · {askedTime}
        </div>
        <div
          className="serif oracle-q"
          style={{
            fontSize: 22,
            lineHeight: 1.35,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
            fontWeight: 400,
          }}
        >
          {turn.question}
        </div>
      </div>

      <div
        style={{
          padding: "22px 0 8px",
          borderTop: "1px solid var(--line-soft)",
          marginTop: 14,
        }}
      >
        <div className="row" style={{ marginBottom: 10 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              display: "grid",
              placeItems: "center",
              background: "var(--accent)",
              color: "var(--accent-ink)",
            }}
          >
            <Icon name="oracle" size={11} />
          </div>
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {t("oracle.oracle")}
          </span>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
            · {turn.retrieval.length} {t("oracle.retrieved")}
            {turn.citations.length > 0 && (
              <>
                {" "}· {turn.citations.length} {t("oracle.citedInline")}
              </>
            )}
          </span>
          <div className="grow" />
          <span className="chip">
            <Icon name="clock" size={9} /> {(turn.latencyMs / 1000).toFixed(1)}s
          </span>
        </div>

        <GroundednessHeader
          groundedness={turn.groundedness}
          retrievedCounts={turn.retrievedCounts}
          question={turn.question}
          onTeach={onTeach}
          streaming={streaming}
          t={t}
        />

        <div className="oracle-answer">
          {turn.answer && (
            <AnswerMarkdown
              answer={turn.answer}
              citations={turn.citations}
              askedAt={turn.askedAt}
            />
          )}
          {streaming && (
            <span
              aria-hidden
              className="oracle-cursor"
              style={{
                display: "inline-block",
                width: 8,
                height: "1em",
                verticalAlign: "text-bottom",
                marginLeft: 2,
                background: "var(--accent)",
                animation: "bp-blink 1s steps(2, start) infinite",
              }}
            />
          )}
          {streaming && turn.answer === "" && (
            <span style={{ color: "var(--ink-4)", fontStyle: "italic" }}>
              {t("oracle.thinking")}
            </span>
          )}
        </div>

        {/* Collapsible citations section */}
        {turn.citations.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn-ghost oracle-sources-toggle"
              style={{ height: 26, fontSize: 12, padding: "0 8px" }}
              onClick={() => setCitationsOpen((o) => !o)}
              aria-expanded={citationsOpen}
            >
              <span style={{ marginRight: 4 }}>
                {t("oracle.sources_used")} ({turn.citations.length})
              </span>
              <span
                style={{
                  display: "inline-block",
                  transition: "transform 0.15s",
                  transform: citationsOpen ? "rotate(180deg)" : "rotate(0deg)",
                }}
              >
                ▾
              </span>
            </button>
            {citationsOpen && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                {turn.citations.map((c) => (
                  <div
                    id={citationId(turn.askedAt, c)}
                    key={`${c.marker}-${c.knowledgeId ?? c.sessionId}`}
                    className="panel oracle-citation-card"
                    style={{
                      padding: "10px 12px",
                      background: "var(--bg-elev-1)",
                      borderLeft: "2px solid var(--accent)",
                    }}
                  >
                    {/* Header row: marker + type chip + metadata chips */}
                    <div className="row" style={{ marginBottom: 6, flexWrap: "wrap", gap: 4 }}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
                        [{c.marker}]
                      </span>
                      {c.knowledgeId && c.meta?.knowledgeType ? (
                        <span
                          className={`chip ${knowledgeTypeChipClass(c.meta.knowledgeType)}`}
                          style={{ fontSize: 11, height: 16, padding: "0 5px" }}
                        >
                          {c.meta.knowledgeType === "anti_principle" ? "anti-principle" : c.meta.knowledgeType}
                        </span>
                      ) : (
                        <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                          {c.knowledgeId ? "knowledge" : c.sessionId ? "session" : "ref"}
                        </span>
                      )}
                      {c.knowledgeId && c.meta?.isDecision && (
                        <span
                          className="chip"
                          style={{ fontSize: 11, color: "var(--accent-text)", borderColor: "var(--accent-text)" }}
                          title="A settled project decision"
                        >
                          decision
                        </span>
                      )}
                      {/* Knowledge meta chips */}
                      {c.knowledgeId && c.meta && typeof c.meta.effectiveness === "number" && (
                        <EffectivenessBadge
                          effectiveness={c.meta.effectiveness}
                          outcomes={c.meta.outcomes ?? 0}
                          usageCount={c.meta.usageCount ?? 0}
                        />
                      )}
                      {c.knowledgeId && c.meta?.lastUsedAt && (
                        <span
                          className="chip mono oracle-citation-last-used"
                          style={{ fontSize: 11, color: "var(--ink-4)", background: "transparent", padding: "1px 5px" }}
                        >
                          last used <RelativeTime isoStr={c.meta.lastUsedAt} />
                        </span>
                      )}
                      {/* Session meta chips */}
                      {c.sessionId && c.meta && (
                        <>
                          {c.meta.projectName && (
                            <span
                              className="chip mono oracle-citation-project"
                              style={{ fontSize: 11, color: "var(--ink-3)", background: "transparent", padding: "1px 5px" }}
                            >
                              {c.meta.projectName}
                            </span>
                          )}
                          {c.meta.sessionStartedAt && (
                            <span
                              className="chip mono oracle-citation-session-date"
                              style={{ fontSize: 11, color: "var(--ink-4)", background: "transparent", padding: "1px 5px" }}
                            >
                              <RelativeTime isoStr={c.meta.sessionStartedAt} />
                            </span>
                          )}
                          {c.meta.sessionOutcome && (
                            <span className="chip mono" style={{ fontSize: 11, background: "transparent", padding: "1px 5px" }}>
                              {sessionOutcomeLabel(c.meta.sessionOutcome)}
                            </span>
                          )}
                          {c.meta.clientType && (
                            <span
                              className="chip mono oracle-citation-client"
                              style={{ fontSize: 11, color: "var(--ink-4)", background: "transparent", padding: "1px 5px" }}
                            >
                              {c.meta.clientType}
                            </span>
                          )}
                        </>
                      )}
                      <div className="grow" />
                      <span className="mono" style={{ fontSize: 12, color: "var(--ink-4)" }}>
                        {(c.knowledgeId ?? c.sessionId ?? "").slice(0, 10)}
                      </span>
                    </div>
                    {/* Excerpt */}
                    <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5 }}>{c.excerpt}</div>
                    {/* WHEN trigger line — knowledge only */}
                    {c.knowledgeId && c.meta?.triggerText && (
                      <div
                        className="oracle-citation-trigger mono"
                        style={{
                          marginTop: 6,
                          fontSize: 12,
                          color: "var(--ink-4)",
                          lineHeight: 1.4,
                        }}
                      >
                        <span style={{ color: "var(--ink-4)", fontWeight: 600 }}>WHEN: </span>
                        {c.meta.triggerText}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 20, gap: 4 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{
              height: 26,
              fontSize: 12,
              color: feedback === "up" ? "var(--accent-text)" : undefined,
            }}
            onClick={() => onFeedback("up")}
            disabled={!!feedback}
          >
            <Icon name="check" size={10} /> {t("oracle.helpful")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{
              height: 26,
              fontSize: 12,
              color: feedback === "down" ? "var(--bad, #ff6b6b)" : undefined,
            }}
            onClick={() => setReasonOpen(true)}
            disabled={!!feedback}
          >
            <Icon name="x" size={10} /> {t("oracle.not_useful")}
          </button>
          {reasonOpen && !feedback && (
            <div
              role="group"
              aria-label="Why was this answer not useful?"
              className="row"
              style={{
                gap: 4,
                padding: "0 6px",
                fontSize: 12,
                color: "var(--ink-3)",
              }}
            >
              <span style={{ marginRight: 4 }}>{t("oracle.why")}</span>
              {[
                { k: "irrelevant", label: t("oracle.feedback_irrelevant") },
                { k: "wrong", label: t("oracle.feedback_wrong") },
                { k: "outdated", label: t("oracle.feedback_outdated") },
                { k: "missing-context", label: t("oracle.feedback_missing_context") },
              ].map((r) => (
                <button
                  key={r.k}
                  type="button"
                  className="btn btn-ghost"
                  style={{ height: 22, fontSize: 12 }}
                  onClick={() => {
                    setReasonOpen(false);
                    onFeedback("down", r.k);
                  }}
                >
                  {r.label}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: 22, fontSize: 12, color: "var(--ink-4)" }}
                onClick={() => {
                  setReasonOpen(false);
                  onFeedback("down");
                }}
              >
                Skip
              </button>
            </div>
          )}
          {turn.relatedQuestions.slice(0, 1).map((rq) => (
            <button
              key={rq}
              type="button"
              className="btn btn-ghost"
              style={{ height: 26, fontSize: 12 }}
              onClick={() => onFollow(rq)}
              title={rq}
            >
              <Icon name="branch" size={10} /> {t("oracle.follow")}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ height: 26, fontSize: 12 }}
            onClick={async () => {
              const ok = await onCopy();
              setCopyState(ok ? "ok" : "fail");
              window.setTimeout(() => setCopyState("idle"), 1500);
            }}
            title={copyState === "fail" ? t("oracle.copy_unavailable") : undefined}
          >
            <Icon name="copy" size={10} />{" "}
            {copyState === "ok"
              ? t("oracle.copied")
              : copyState === "fail"
                ? t("oracle.copy_unavailable")
                : t("oracle.copy_skill")}
          </button>
          <div className="grow" />
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
            reasoning: {turn.reasoningLevel} · {turn.tokensUsed.toLocaleString()} tokens
          </span>
        </div>
      </div>
    </>
  );
}

/**
 * Hydration-safe wrapper around the canonical formatRelative. Audit FE5
 * (#103): relative-time reads `Date.now()` during render. SSR happens at
 * one instant; first client paint at another. Around minute / hour
 * boundaries the strings differ ("just now" vs "1m ago") and React logs a
 * hydration mismatch warning.
 *
 * Strategy: render an absolute YYYY-MM-DD on the SSR pass + first client
 * render, then swap to the relative form post-mount via useEffect.
 *
 * (Dropped the local `relativeTime` formatter — verbose "3 days ago" — in
 * the 2026-05-31 consistency pass; was one of 4 divergent variants. Now
 * matches the "Nd ago" form used everywhere else.)
 */
function RelativeTime({ isoStr }: { isoStr: string }) {
  const absolute = isoStr.slice(0, 10);
  const [str, setStr] = useState(absolute);
  useEffect(() => {
    setStr(formatRelative(isoStr));
  }, [isoStr]);
  return <>{str}</>;
}

/** Color for a knowledge type chip. */
function knowledgeTypeChipClass(type: OracleCitationMeta["knowledgeType"]): string {
  if (type === "anti_principle") return "k-anti";
  if (type) return `k-${type}`;
  return "k-recipe";
}

/** Label for the session outcome. */
function sessionOutcomeLabel(outcome: OracleCitationMeta["sessionOutcome"]): React.ReactNode {
  if (outcome === "success") {
    return <span style={{ color: "var(--ok, #4caf50)" }}>✓ success</span>;
  }
  if (outcome === "failure") {
    return <span style={{ color: "var(--bad, #ff6b6b)" }}>✗ failure</span>;
  }
  return <span style={{ color: "var(--ink-4)" }}>? unknown</span>;
}

/**
 * Stable DOM id for a citation card. `askedAt` scopes it to the turn so
 * multiple turns can each own their own anchors.
 */
function citationId(askedAt: string, c: OracleCitationView): string {
  const kind = c.knowledgeId ? "k" : c.sessionId ? "s" : "x";
  const suffix = (c.knowledgeId ?? c.sessionId ?? "ref").slice(0, 10);
  const stamp = askedAt.replace(/[^0-9]/g, "").slice(0, 14);
  return `cite-${stamp}-${kind}${c.marker}-${suffix}`;
}

/**
 * Split the answer text into segments around `[^K1]` / `[^S1]` citation
 * markers, so the Markdown renderer receives plain-text nodes it understands
 * and the citation markers render as inline anchor chips.
 *
 * Shape: a custom `text` renderer re-splits each text node, rather than
 * pre-processing the raw string — remark/rehype would otherwise strip the
 * `^` footnote sigil or interpret it as a GFM footnote.
 */
function renderWithCitations(
  text: string,
  citations: OracleCitationView[],
  askedAt: string,
): React.ReactNode[] {
  const byMarker = new Map<string, OracleCitationView>();
  for (const c of citations) {
    const kind = c.knowledgeId ? "K" : c.sessionId ? "S" : "K";
    byMarker.set(`${kind}${c.marker}`, c);
  }
  const parts: React.ReactNode[] = [];
  const pattern = /\[\^([KS])(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const key = `${m[1]}${m[2]}`;
    const cite = byMarker.get(key);
    if (cite) {
      const id = citationId(askedAt, cite);
      parts.push(
        <a
          key={`c-${m.index}`}
          href={`#${id}`}
          className="oracle-citation-ref"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(id)?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }}
          title={cite.excerpt}
        >
          [{cite.marker}]
        </a>,
      );
    } else {
      parts.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function AnswerMarkdown({
  answer,
  citations,
  askedAt,
}: {
  answer: string;
  citations: OracleCitationView[];
  askedAt: string;
}) {
  const wrap = (children: React.ReactNode) => wrapTextChildren(children, citations, askedAt);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p style={{ margin: "0 0 12px" }}>{wrap(children)}</p>,
        li: ({ children }) => <li style={{ margin: "2px 0" }}>{wrap(children)}</li>,
        strong: ({ children }) => <strong>{wrap(children)}</strong>,
        em: ({ children }) => <em>{wrap(children)}</em>,
        a: ({ href, children }) => (
          <a href={href ?? "#"} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {answer}
    </ReactMarkdown>
  );
}

/**
 * Replace each string child with the citation-resolved variant. Non-string
 * children (emphasis, code, etc.) pass through unchanged.
 */
function wrapTextChildren(
  children: React.ReactNode,
  citations: OracleCitationView[],
  askedAt: string,
): React.ReactNode {
  const arr = Array.isArray(children) ? children : [children];
  return arr.map((node, i) => {
    if (typeof node === "string") {
      return (
        <React.Fragment key={i}>
          {renderWithCitations(node, citations, askedAt)}
        </React.Fragment>
      );
    }
    return node;
  });
}
