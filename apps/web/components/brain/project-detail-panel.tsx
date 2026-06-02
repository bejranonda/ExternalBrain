"use client";

import { useProjectDetail, type AggregatedKnowledgeView } from "@/lib/brain/use-project-detail";
import { formatRelative } from "@brain/core/format-relative";

/**
 * ProjectDetailPanel
 *
 * Inline expansion below a project row. Mirrors SessionDetailPanel's
 * two-column shape, aggregated over every session in the project:
 *
 *   Brain helped this project   (skills retrieved INTO any session here)
 *   Brain learned from this project   (skills extracted OUT of any session here)
 *
 * The top line summarizes "what the round-trip produced" so a user can
 * answer "is the brain pulling its weight on this project" without
 * leaving the dashboard.
 */
export function ProjectDetailPanel({ projectId }: { projectId: string }) {
  const { data, loadState, error } = useProjectDetail(projectId);

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
        Loading project value…
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
        Failed to load project details — {error ?? "unknown error"}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div
      style={{
        background: "var(--bg-elev-1)",
        borderTop: "1px solid var(--line-soft)",
      }}
    >
      <ValueSummary
        sessionCount={data.totals.sessionCount}
        injectedCount={data.totals.injectedCount}
        extractedCount={data.totals.extractedCount}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
          borderTop: "1px solid var(--line-soft)",
        }}
        className="project-detail-grid"
      >
        <ValueColumn
          label="Brain helped this project"
          sub="Skills retrieved into sessions, ranked by use"
          items={data.injected}
          empty="No skills have been retrieved into this project yet. They will appear here as your AI tools request them during sessions."
          accent="var(--accent-text)"
        />
        <ValueColumn
          label="Brain learned from this project"
          sub="New skills extracted from sessions, ranked by recurrence"
          items={data.extracted}
          empty="Nothing extracted yet. Brain runs after sessions close — start a few sessions and check back."
          accent="var(--violet)"
          borderLeft
        />
      </div>
    </div>
  );
}

function ValueSummary({
  sessionCount,
  injectedCount,
  extractedCount,
}: {
  sessionCount: number;
  injectedCount: number;
  extractedCount: number;
}) {
  // Quiet-by-default principle: the summary whispers in one short line.
  // The two halves below carry the depth.
  let body: string;
  if (sessionCount === 0) {
    body = "No sessions on this project yet — start one from Claude Code, Cursor, or any MCP client.";
  } else if (injectedCount === 0 && extractedCount === 0) {
    body = `${sessionCount} session${sessionCount === 1 ? "" : "s"} captured. The brain hasn't applied skills here yet — counts will populate after the next session closes.`;
  } else {
    body = `${sessionCount} session${sessionCount === 1 ? "" : "s"} · brain shared ${injectedCount} skill${injectedCount === 1 ? "" : "s"} into this project and learned ${extractedCount} new one${extractedCount === 1 ? "" : "s"} from it.`;
  }
  return (
    <div
      style={{
        padding: "12px 18px",
        fontSize: 13,
        color: "var(--ink-2)",
        lineHeight: 1.5,
      }}
    >
      {body}
    </div>
  );
}

function ValueColumn({
  label,
  sub,
  items,
  empty,
  accent,
  borderLeft,
}: {
  label: string;
  sub: string;
  items: AggregatedKnowledgeView[];
  empty: string;
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
                {k.hitCount}× · last {formatRelative(k.lastAppliedAt)} · when:{" "}
                <em style={{ fontStyle: "normal" }}>{k.triggerText}</em>
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

