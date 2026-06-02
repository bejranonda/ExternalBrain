"use client";

import { useState } from "react";
import type { Route } from "@/lib/brain/routes";
import { useLatestInsight } from "@/lib/brain/use-latest-insight";
import { formatRelative } from "@brain/core/format-relative";

/**
 * HomeHero — the redesigned first-viewport surface for non-technical users.
 * Three large action cards (Skills count / Latest insight / Oracle prompt)
 * replace the former dense dashboard hero. Cards stack on mobile via the
 * auto-fit grid; no globals.css edits required.
 *
 * Earned-surface-area applies to the whole row, not individual cards: if
 * `useLatestInsight` returns null, Card 2 still renders with an empty-state
 * body so the 3-card visual rhythm survives a quiet brain.
 */
export function HomeHero({
  skillsCount,
  go,
}: {
  skillsCount: number;
  go: (r: Route) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 12,
        marginTop: 12,
        marginBottom: 8,
      }}
    >
      <SkillsCard count={skillsCount} go={go} />
      <LatestInsightCard go={go} />
      <OracleCard go={go} />
    </div>
  );
}

/* --------------------------------- card 1 --------------------------------- */

function SkillsCard({
  count,
  go,
}: {
  count: number;
  go: (r: Route) => void;
}) {
  return (
    <Card
      accent="var(--accent-text)"
      onClick={() => go("skills")}
      ariaLabel={`Open Skills — ${count} learned`}
    >
      <CardLabel>SKILLS</CardLabel>
      <CardSubtitle>What your Brain has learned</CardSubtitle>
      <div
        className="tab-num"
        style={{
          fontSize: 52,
          fontWeight: 500,
          letterSpacing: "-0.03em",
          lineHeight: 1.05,
          marginTop: 12,
          marginBottom: 12,
          color: "var(--ink)",
        }}
      >
        {count.toLocaleString()}
      </div>
      <CardLink>Open Skills →</CardLink>
    </Card>
  );
}

/* --------------------------------- card 2 --------------------------------- */

function LatestInsightCard({ go }: { go: (r: Route) => void }) {
  const { data, loadState } = useLatestInsight();

  const handleOpen = () => {
    if (data) {
      // Deep-link into the skills surface with the id pre-selected. The
      // existing LatestInsight component uses the same hash format.
      if (typeof window !== "undefined") {
        window.location.hash = `skills?id=${encodeURIComponent(data.id)}`;
      }
    }
    go("skills");
  };

  const truncated =
    data && data.ruleText.length > 80
      ? `${data.ruleText.slice(0, 77)}…`
      : data?.ruleText ?? "";

  return (
    <Card
      accent="var(--violet)"
      onClick={handleOpen}
      ariaLabel="Open the most recent insight in Skills"
    >
      <CardLabel>JUST LEARNED</CardLabel>
      <CardSubtitle>The most recent thing Brain saw</CardSubtitle>
      <div style={{ flex: 1, marginTop: 12, marginBottom: 12 }}>
        {loadState === "loading" && (
          <div style={{ fontSize: 13, color: "var(--ink-4)" }}>Loading…</div>
        )}
        {loadState !== "loading" && !data && (
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.5,
              color: "var(--ink-3)",
            }}
          >
            Brain hasn’t extracted anything in the last 14 days.
          </div>
        )}
        {data && (
          <>
            <div
              style={{
                fontSize: 15,
                lineHeight: 1.45,
                color: "var(--ink)",
                fontStyle: "italic",
              }}
            >
              “{truncated}”
            </div>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                marginTop: 6,
              }}
              title={data.createdAt}
            >
              {formatRelative(data.createdAt)}
            </div>
          </>
        )}
      </div>
      <CardLink>{data ? "Read it →" : "Open Skills →"}</CardLink>
    </Card>
  );
}

/* --------------------------------- card 3 --------------------------------- */

function OracleCard({ go }: { go: (r: Route) => void }) {
  return (
    <Card
      accent="var(--cool)"
      onClick={() => go("oracle")}
      ariaLabel="Ask Brain a question via the Oracle"
    >
      <CardLabel>ORACLE</CardLabel>
      <CardSubtitle>Ask a question about your code</CardSubtitle>
      <div
        style={{
          flex: 1,
          marginTop: 12,
          marginBottom: 12,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--ink-2)",
        }}
      >
        <div style={{ color: "var(--ink-3)", marginBottom: 6 }}>Try one:</div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <li>How did we fix the deploy bug?</li>
          <li>Why does the worker need pg-boss?</li>
        </ul>
      </div>
      <CardLink>Ask Brain →</CardLink>
    </Card>
  );
}

/* ------------------------------- primitives ------------------------------- */

function Card({
  accent,
  onClick,
  ariaLabel,
  children,
}: {
  accent: string;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="panel"
      style={{
        padding: 24,
        minHeight: 200,
        display: "flex",
        flexDirection: "column",
        cursor: "pointer",
        borderLeft: `4px solid ${accent}`,
        background: hover ? "var(--bg-elev-1)" : undefined,
        transition: "background 120ms ease",
      }}
    >
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mono"
      style={{
        fontSize: 11,
        color: "var(--ink-3)",
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}

function CardSubtitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        color: "var(--ink-4)",
        marginTop: 4,
        lineHeight: 1.45,
      }}
    >
      {children}
    </div>
  );
}

function CardLink({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        color: "var(--accent-text)",
        marginTop: "auto",
      }}
    >
      {children}
    </div>
  );
}
