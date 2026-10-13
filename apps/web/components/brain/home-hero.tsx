"use client";

import { useState } from "react";
import type { Route } from "@/lib/brain/routes";
import { useLatestInsight } from "@/lib/brain/use-latest-insight";
import { formatRelative } from "@brain/core/format-relative";
import { useLang, useT } from "@/lib/brain/i18n";

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
  const t = useT();
  const lang = useLang();
  return (
    <Card
      accent="var(--accent-text)"
      onClick={() => go("skills")}
      ariaLabel={t("hero.skills_aria", { n: count })}
    >
      <CardLabel>{t("nav.skills")}</CardLabel>
      <CardSubtitle>{t("skills.subtitle")}</CardSubtitle>
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
        {count.toLocaleString(lang)}
      </div>
      <CardLink>{t("hero.open_skills")}</CardLink>
    </Card>
  );
}

/* --------------------------------- card 2 --------------------------------- */

function LatestInsightCard({ go }: { go: (r: Route) => void }) {
  const t = useT();
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
      ariaLabel={t("hero.insight_aria")}
    >
      <CardLabel>{t("hero.just_learned")}</CardLabel>
      <CardSubtitle>{t("hero.insight_subtitle")}</CardSubtitle>
      <div style={{ flex: 1, marginTop: 12, marginBottom: 12 }}>
        {loadState === "loading" && (
          <div style={{ fontSize: 13, color: "var(--ink-4)" }}>{t("common.loading")}</div>
        )}
        {loadState !== "loading" && !data && (
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.5,
              color: "var(--ink-3)",
            }}
          >
            {t("hero.insight_empty")}
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
      <CardLink>{data ? t("hero.read_it") : t("hero.open_skills")}</CardLink>
    </Card>
  );
}

/* --------------------------------- card 3 --------------------------------- */

function OracleCard({ go }: { go: (r: Route) => void }) {
  const t = useT();
  return (
    <Card
      accent="var(--cool)"
      onClick={() => go("oracle")}
      ariaLabel={t("hero.oracle_aria")}
    >
      <CardLabel>{t("nav.oracle")}</CardLabel>
      <CardSubtitle>{t("hero.oracle_subtitle")}</CardSubtitle>
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
        <div style={{ color: "var(--ink-3)", marginBottom: 6 }}>{t("hero.try_one")}</div>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <li>{t("hero.oracle_q1")}</li>
          <li>{t("hero.oracle_q2")}</li>
        </ul>
      </div>
      <CardLink>{t("hero.ask_brain")}</CardLink>
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
