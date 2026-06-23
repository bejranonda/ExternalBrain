"use client";

/**
 * PulseLine — a single-sentence summary of "where the brain is right now".
 * Replaces the 3-KPI hero tiles. Three branches:
 *
 *   1. cold     — no sessions ever AND no knowledge yet
 *   2. quiet    — no sessions this week BUT knowledge exists
 *   3. active   — sessions this week
 *
 * Trend marker only renders when the SQS trend has ≥3 points and a
 * non-zero delta — the same gate the original SQS chip used so trend
 * wording never appears for a brand-new brain whose trend is undefined.
 */
import { InfoDot } from "./info-dot";

export function PulseLine({
  sessionsWeek,
  sessionsAllTime,
  activeKnowledge,
  sqsCurrent,
  sqsTrend,
}: {
  sessionsWeek: number;
  sessionsAllTime: number;
  activeKnowledge: number;
  sqsCurrent: number;
  sqsTrend: number[];
}) {
  const isCold = sessionsAllTime === 0 && activeKnowledge === 0;
  const isQuiet = sessionsWeek === 0 && activeKnowledge > 0;

  if (isCold) {
    return (
      <PulseShell>
        <strong>Brain is quiet this week.</strong>{" "}
        Start a session in Claude Code, Cursor, or any MCP client to feed it.
      </PulseShell>
    );
  }
  if (isQuiet) {
    return (
      <PulseShell>
        <strong>No sessions this week</strong> — but your Brain holds{" "}
        {activeKnowledge} skill{activeKnowledge === 1 ? "" : "s"} from before.
        Run a session to keep it fresh.
      </PulseShell>
    );
  }

  const delta =
    sqsTrend.length >= 2 ? sqsTrend[sqsTrend.length - 1]! - sqsTrend[0]! : 0;
  const showTrend = sqsTrend.length >= 3 && delta !== 0;

  // Quality fragment whispers when no closed session has produced an SQS
  // yet (sqsCurrent === 0). Showing "Quality 0.00" for a brain with only
  // in-progress sessions reads as "the platform is failing" to a first-
  // time user. Better to say nothing than to lie with zeros.
  const showQuality = sqsCurrent > 0;

  return (
    <PulseShell>
      <strong>This week:</strong> {sessionsWeek} session
      {sessionsWeek === 1 ? "" : "s"} · {activeKnowledge} skill
      {activeKnowledge === 1 ? "" : "s"} in your Brain
      {showQuality && (
        <>
          {" · "}Quality {sqsCurrent.toFixed(2)}
          <InfoDot
            term="Quality"
            conceptSlug="vocabulary"
            tip="Session Quality Score (SQS): are your recent sessions succeeding? 0–1, target ≥ 0.70."
          />
        </>
      )}
      {showTrend && (
        <>
          {" "}
          <span
            style={{
              color: delta > 0 ? "var(--ok)" : "var(--bad, #ff6b6b)",
              fontWeight: 500,
            }}
            title={`Change across the last ${sqsTrend.length} sessions`}
          >
            ({delta > 0 ? "↑ +" : "↓ "}
            {delta.toFixed(2)} trend)
          </span>
        </>
      )}
      .
    </PulseShell>
  );
}

function PulseShell({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 16px",
        fontSize: 17,
        lineHeight: 1.5,
        color: "var(--ink)",
        maxWidth: 820,
      }}
    >
      {children}
    </p>
  );
}
