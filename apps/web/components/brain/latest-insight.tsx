"use client";

import { formatRelative } from "@brain/core/format-relative";
import { useLatestInsight } from "@/lib/brain/use-latest-insight";

/**
 * LatestInsight — single card surfacing the most recent extracted
 * knowledge row in plain English. Earned surface area: renders nothing
 * when there is no insight in the last 14 days, so a brand-new brain or
 * a brain that has gone quiet does not show a stale "Brain learned"
 * banner.
 */
export function LatestInsight() {
  const { data, loadState } = useLatestInsight();
  if (loadState !== "ready" || !data) return null;

  const truncated =
    data.ruleText.length > 160 ? `${data.ruleText.slice(0, 157)}…` : data.ruleText;

  return (
    <a
      href={`/#skills?id=${encodeURIComponent(data.id)}`}
      className="panel"
      style={{
        display: "block",
        padding: "16px 18px",
        marginBottom: 16,
        textDecoration: "none",
        color: "inherit",
        borderLeft: "3px solid var(--violet)",
      }}
    >
      <div
        className="row"
        style={{ marginBottom: 6, alignItems: "baseline", gap: 10 }}
      >
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--violet)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}
        >
          What Brain just learned
        </span>
        <div className="grow" />
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-4)" }}
          title={data.createdAt}
        >
          {formatRelative(data.createdAt)}
        </span>
      </div>
      <div
        style={{
          fontSize: 15,
          lineHeight: 1.5,
          color: "var(--ink)",
          marginBottom: 8,
        }}
      >
        “{truncated}”
      </div>
      <div
        className="mono"
        style={{ fontSize: 11, color: "var(--ink-4)" }}
      >
        {humanType(data.type)} · click to open in Skills
      </div>
    </a>
  );
}

function humanType(t: string): string {
  switch (t) {
    case "recipe":
      return "Recipe";
    case "heuristic":
      return "Rule of thumb";
    case "principle":
      return "Principle";
    case "reflex":
      return "Reflex";
    case "anti_principle":
      return "Anti-pattern";
    default:
      return t;
  }
}

