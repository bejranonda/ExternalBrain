"use client";

import { useSessionDetail, type AppliedKnowledgeView } from "@/lib/brain/use-session-detail";

/**
 * SessionDetailPanel
 *
 * Inline expansion below a Session row. Surfaces the "value of the
 * Brain↔session round-trip" explicitly, as a two-column layout:
 *
 *   ← Brain → you   (skills the AI retrieved INTO this session)
 *   → Brain ← you   (skills KEA extracted OUT of this session)
 *
 * The numbers are already in the Sessions table header ("Used / Learned"),
 * but the *names* of the items only appear here — so a user can answer
 * "what specifically did the Brain help with on this task" without
 * leaving the Sessions surface.
 */
export function SessionDetailPanel({ sessionId }: { sessionId: string }) {
  const { data, loadState, error } = useSessionDetail(sessionId);

  if (loadState === "loading") {
    return (
      <div
        style={{
          padding: "12px 18px",
          fontSize: 13,
          color: "var(--ink-3)",
          background: "var(--bg-elev-1)",
          borderTop: "1px solid var(--line-soft)",
        }}
      >
        Loading details…
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div
        role="alert"
        style={{
          padding: "12px 18px",
          fontSize: 13,
          color: "var(--bad)",
          background: "var(--bg-elev-1)",
          borderTop: "1px solid var(--line-soft)",
        }}
      >
        Failed to load session details — {error ?? "unknown error"}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 0,
        background: "var(--bg-elev-1)",
        borderTop: "1px solid var(--line-soft)",
      }}
      className="session-detail-grid"
    >
      <ValueColumn
        label="Brain helped you"
        sub="Skills retrieved into this session"
        items={data.injected}
        empty="No skills were applied during this session. The Brain either had nothing relevant to suggest, or your AI tool didn't ask."
        emptyTone="neutral"
        accent="var(--accent-text)"
      />
      <ValueColumn
        label="Brain learned from you"
        sub="New skills extracted from this session"
        items={data.extracted}
        empty="Nothing new was extracted yet. Brain runs after a session closes — give it a few minutes."
        emptyTone="neutral"
        accent="var(--violet)"
        borderLeft
      />
    </div>
  );
}

function ValueColumn({
  label,
  sub,
  items,
  empty,
  emptyTone: _emptyTone,
  accent,
  borderLeft,
}: {
  label: string;
  sub: string;
  items: AppliedKnowledgeView[];
  empty: string;
  emptyTone: "neutral";
  accent: string;
  borderLeft?: boolean;
}) {
  return (
    <div
      style={{
        padding: "14px 18px",
        borderLeft: borderLeft ? "1px solid var(--line-soft)" : "none",
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: accent,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 2,
        }}
      >
        {label} · {items.length}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 10 }}>
        {sub}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {empty}
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {items.slice(0, 8).map((k) => (
            <li key={k.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <a
                href={`/#skills?id=${encodeURIComponent(k.id)}`}
                style={{
                  fontSize: 13,
                  color: "var(--ink)",
                  textDecoration: "none",
                  lineHeight: 1.4,
                }}
                title={k.ruleText}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--ink-4)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginRight: 6,
                  }}
                >
                  {humanType(k.type)}
                </span>
                {k.ruleText.length > 110 ? `${k.ruleText.slice(0, 107)}…` : k.ruleText}
              </a>
              <span style={{ fontSize: 11, color: "var(--ink-4)" }}>
                when: <em style={{ fontStyle: "normal" }}>{k.triggerText}</em>
              </span>
            </li>
          ))}
          {items.length > 8 && (
            <li style={{ fontSize: 12, color: "var(--ink-4)" }}>
              +{items.length - 8} more — open the Skills tab to see all.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function humanType(t: string): string {
  switch (t) {
    case "recipe": return "Recipe";
    case "heuristic": return "Rule of thumb";
    case "principle": return "Principle";
    case "reflex": return "Reflex";
    case "anti_principle": return "Anti-pattern";
    default: return t;
  }
}
