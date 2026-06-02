"use client";

/**
 * EffectivenessBadge — shared between Skills and Oracle citation cards.
 *
 * score = -1  → insufficient data (< 3 outcomes)
 * score 0..1  → successCount / (successCount + failureCount)
 *
 * Visual tiers:
 *   ✓ green   ≥ 0.70 and ≥3 outcomes
 *   ~ yellow  0.40–0.69
 *   ✗ red     < 0.40
 *   — gray    <3 outcomes but usageCount > 0
 *   ○ dim     usageCount == 0
 */
export function EffectivenessBadge({
  effectiveness,
  outcomes,
  usageCount,
}: {
  effectiveness: number;
  outcomes: number;
  usageCount: number;
}) {
  if (usageCount === 0) {
    return (
      <span
        className="chip mono"
        title="This rule has not been retrieved in any Oracle answer yet."
        style={{ fontSize: 11, color: "var(--ink-4)", background: "transparent", padding: "1px 5px" }}
      >
        ○ Unused
      </span>
    );
  }
  if (effectiveness === -1) {
    return (
      <span
        className="chip mono"
        title={`Retrieved ${usageCount} time${usageCount === 1 ? "" : "s"} in Oracle answers, but fewer than 3 session outcomes recorded. Score will appear once ≥3 sessions report an outcome.`}
        style={{ fontSize: 11, color: "var(--ink-3)", background: "transparent", padding: "1px 5px" }}
      >
        — Untested ({usageCount} {usageCount === 1 ? "use" : "uses"})
      </span>
    );
  }
  const pct = Math.round(effectiveness * 100);
  if (effectiveness >= 0.7) {
    return (
      <span
        className="chip mono"
        title={`This rule was helpful in ${pct}% of the ${outcomes} session${outcomes === 1 ? "" : "s"} where it was applied. Score = successCount / (successCount + failureCount).`}
        style={{ fontSize: 11, color: "var(--ok, #4caf50)", background: "transparent", padding: "1px 5px" }}
      >
        ✓ {pct}% · {outcomes} {outcomes === 1 ? "session" : "sessions"}
      </span>
    );
  }
  if (effectiveness >= 0.4) {
    return (
      <span
        className="chip mono"
        title={`Mixed signal — helpful in ${pct}% of the ${outcomes} session${outcomes === 1 ? "" : "s"} where it was applied. Consider refining the trigger or rule text.`}
        style={{ fontSize: 11, color: "var(--warn, #f5a623)", background: "transparent", padding: "1px 5px" }}
      >
        ~ {pct}% · {outcomes} {outcomes === 1 ? "session" : "sessions"}
      </span>
    );
  }
  return (
    <span
      className="chip mono"
      title={`Low signal — helpful in only ${pct}% of the ${outcomes} session${outcomes === 1 ? "" : "s"} where it was applied. Consider updating or archiving this rule.`}
      style={{ fontSize: 11, color: "var(--bad, #ff6b6b)", background: "transparent", padding: "1px 5px" }}
    >
      ✗ {pct}% · {outcomes} {outcomes === 1 ? "session" : "sessions"}
    </span>
  );
}
