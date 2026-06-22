"use client";

import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";
import { useT } from "@/lib/brain/i18n";
import type { Route } from "@/lib/brain/routes";
import { useDashboardStats, type TypeCount } from "@/lib/brain/use-dashboard";
import { useSessions } from "@/lib/brain/use-sessions";
import { useAutoskillProposals, type ProposalView } from "@/lib/brain/use-autoskill";
import { useLiveExtraction } from "@/lib/brain/use-live-extraction";
import { useProjectScope } from "@/lib/brain/use-project-scope";
import { ScopePill } from "./scope-pill";
import type { SessionView } from "@/lib/brain/views";
import { useTopRules, type TopRuleRow } from "@/lib/brain/use-top-rules";
import { ConnectionStatus } from "./connection-status";
import { EmptyBrainCallout } from "./empty-brain-callout";
import { AgentPromptsCard } from "./agent-prompts-card";
import { HelpPopover } from "./help-popover";
import { ProjectsList } from "./projects-list";
import { SessionDetailPanel } from "./session-detail-panel";
import { ValueChip } from "./value-chip";
import { formatRelative } from "@brain/core/format-relative";
import { PulseLine } from "./pulse-line";
import { HomeHero } from "./home-hero";

/**
 * Section label that visually chunks the dashboard. Each section gets a
 * small mono uppercase header above its grid so the eye reads the page as
 * four labelled groups instead of one wall of widgets. The hint becomes a
 * subtle sub-line so users learn the mental model alongside the data.
 */
function SectionLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginTop: 28, marginBottom: 10 }}>
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
      {hint && (
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-4)",
            marginTop: 4,
            lineHeight: 1.45,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function SQSChart({ data, sqs }: { data: number[]; sqs: number }) {
  const t = useT();
  const w = data.length > 0 ? 100 / data.length : 100;
  const delta = data.length >= 2 ? (data[data.length - 1]! - data[0]!) : 0;
  return (
    <div
      className="panel span-2"
      style={{ padding: "14px 16px", gridColumn: "span 2" }}
      title={t("tip.sqs")}
    >
      <div className="row" style={{ marginBottom: 10 }}>
        <div>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            <span title={t("tip.sqs")}>
              {t("dash.sqs")}
            </span>
          </div>
          <div className="row" style={{ gap: 10, marginTop: 6 }}>
            <span className="tab-num" style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em" }}>
              {sqs.toFixed(2)}
            </span>
            {/* UX-newcomer-pass-2 (iter 17): the previous chip read
                "→ -1.00" — newcomers couldn't tell if that was a value
                or a delta, and the arrow icon next to a negative number
                was visually ambiguous. The chip now only renders when
                we have ≥3 real data points AND a non-zero delta, and
                spells out the framing ("trend") so the meaning is
                unambiguous. */}
            {data.length >= 3 && delta !== 0 && (
              <span
                className="chip"
                style={{
                  color: delta > 0 ? "var(--ok)" : "var(--bad, #ff6b6b)",
                  borderColor: "color-mix(in oklab, var(--ok) 30%, var(--line))",
                  whiteSpace: "nowrap",
                }}
                title={t("tip.sqs_delta")}
              >
                {delta > 0 ? "+" : ""}
                {delta.toFixed(2)} trend
              </span>
            )}
          </div>
          {/* Inline scale hint — newcomers need to know which way is up
              before hovering for the long tooltip. (#UX-newcomer-pass) */}
          <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4 }}>
            {t("dash.sqs_scale")}
          </div>
        </div>
        <div className="grow" />
        {/* The "target ≥ 0.70" chip used to live here, but the scale hint
            below the title now carries the same number — keeping both was
            duplicate ink for newcomers. (UX pass v5) */}
      </div>
      <div style={{ position: "relative", height: 70, marginTop: 4 }}>
        <svg width="100%" height="70" viewBox="0 0 100 70" preserveAspectRatio="none">
          <line x1="0" y1="21" x2="100" y2="21" stroke="var(--line-soft)" strokeWidth="0.2" strokeDasharray="1 1" />
          {data.length > 1 && (
            <>
              <path
                d={`M ${data.map((v, i) => `${i * w + w / 2},${(1 - v) * 60 + 5}`).join(" L ")}`}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={`M ${data.map((v, i) => `${i * w + w / 2},${(1 - v) * 60 + 5}`).join(" L ")} L ${100 - w / 2},65 L ${w / 2},65 Z`}
                fill="var(--accent-wash)"
              />
            </>
          )}
          {data.map((v, i) => (
            <circle key={i} cx={i * w + w / 2} cy={(1 - v) * 60 + 5} r="0.8" fill="var(--accent)" />
          ))}
        </svg>
      </div>
    </div>
  );
}

/**
 * Map the wire-format client tag onto its friendly product name.
 * The dashboard chip used to just print the wire tag verbatim
 * ("claude") which left newcomers wondering "claude what?".
 */
function clientLabel(client: string): string {
  switch (client) {
    case "claude":
    case "claude_code":
      return "Claude Code";
    case "cursor":
      return "Cursor";
    case "windsurf":
      return "Windsurf";
    case "autobahn":
      return "Autobahn";
    case "antigravity":
      return "Antigravity";
    case "github_copilot":
      return "GitHub Copilot";
    case "mcp":
      return "MCP client";
    case "webapp":
      return "Webapp";
    default:
      return client;
  }
}

function LiveExtraction() {
  const t = useT();
  const { payload, loadState } = useLiveExtraction();

  return (
    <div className="panel">
      <div className="panel-h">
        <span
          className="live-dot"
          style={{
            background: loadState === "ready" ? undefined : "var(--ink-4)",
          }}
        />
        <h3>{t("dash.live_extract")}</h3>
        <span
          className="sub"
          // UX-newcomer-pass-2 (iter 12): previously rendered
          // "session s_6cp3" — newcomers don't need the 4-char id at the
          // header; it's diagnostic, not status. Show humanized state
          // here ("active" / "no session yet") and keep the short id on
          // hover for power users.
          title={payload?.sessionShort && payload.sessionShort !== "—"
            ? `Session id: ${payload.sessionShort}`
            : undefined}
        >
          {payload?.sessionShort && payload.sessionShort !== "—"
            ? "Session in progress"
            : "No session in progress"}
        </span>
        <div className="grow" />
        {payload?.client && payload.sessionShort !== "—" && (
          <span
            className="chip"
            title={`Connected from ${clientLabel(payload.client)}`}
          >
            <Icon name={payload.client as IconName} size={9} />
            {clientLabel(payload.client)}
          </span>
        )}
      </div>
      <div style={{ padding: "4px 0 6px", fontFamily: "var(--font-mono)", fontSize: 12 }}>
        {loadState === "loading" && (
          <div style={{ padding: "10px 14px", color: "var(--ink-3)" }}>Loading events…</div>
        )}
        {loadState !== "loading" && (!payload || payload.events.length === 0) && (
          <div style={{ padding: "10px 14px", color: "var(--ink-3)", lineHeight: 1.55 }}>
            No live activity yet. Connect Claude Code, Cursor, or Windsurf — then
            anything those tools do shows up here in real time.{" "}
            <a
              href="/settings/tokens"
              style={{ color: "var(--accent-text)", textDecoration: "none" }}
            >
              Get a token →
            </a>
          </div>
        )}
        {payload?.events.map((e, i) => (
          <div
            key={i}
            className="row"
            style={{ padding: "6px 14px", gap: 10, alignItems: "flex-start" }}
          >
            <span
              className="tab-num"
              style={{ color: "var(--ink-4)", fontSize: 11, minWidth: 50 }}
            >
              +{formatOffset(e.t)}
            </span>
            <span
              style={{
                color:
                  e.type === "extract"
                    ? "var(--accent)"
                    : e.type === "autoskill"
                      ? "var(--violet)"
                      : "var(--ink-3)",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                minWidth: 62,
              }}
            >
              <span
                title={
                  e.type === "extract"
                    ? t("tip.kea_short")
                    : e.type === "autoskill"
                      ? t("tip.autoskill_event")
                      : undefined
                }
              >
                {e.type === "extract"
                  ? "EXTRACT"
                  : e.type === "autoskill"
                    ? "AUTOSKILL"
                    : "EVENT"}
              </span>
            </span>
            <span
              style={{
                color: e.type !== "event" ? "var(--ink)" : "var(--ink-2)",
                flex: 1,
              }}
            >
              {e.text}
            </span>
            {e.conf != null && (
              <span
                className="chip"
                style={{ marginLeft: "auto" }}
                title="Confidence the Brain has in this extraction (0–1)"
              >
                confidence {e.conf.toFixed(2)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatOffset(ms: number): string {
  if (ms < 1000) return `${String(ms).padStart(4, "0")}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  return `${min}m${Math.round(sec - min * 60)}s`;
}

function RecentSessions({
  onViewAll,
  sessions,
  total,
  loading,
}: {
  onViewAll: () => void;
  sessions: SessionView[];
  total: number;
  loading: boolean;
}) {
  const t = useT();
  const rows = sessions.slice(0, 6);
  const h = t("dash.headers") as unknown as Record<string, string>;
  // Inline click-to-expand mirrors the /sessions route: click a row to
  // reveal what skills the brain shared & learned in that session,
  // without leaving the dashboard. Only one row open at a time keeps
  // the dashboard scannable.
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  return (
    <div className="panel">
      <div className="panel-h">
        <h3>{t("dash.recent")}</h3>
        <span className="sub">
          {rows.length} {t("dash.of")} {total.toLocaleString()}
        </span>
        <div className="grow" />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ height: 24, fontSize: 12 }}
          onClick={onViewAll}
        >
          {t("dash.view_all")} <Icon name="arrowR" size={10} />
        </button>
      </div>
      <div>
        <div
          className="row mono"
          style={{
            padding: "8px 14px",
            fontSize: 11,
            color: "var(--ink-4)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            borderBottom: "1px solid var(--line-soft)",
          }}
        >
          <span style={{ width: 14 }} />
          <span style={{ width: 22 }} />
          <span style={{ flex: 2 }}>{h.project}</span>
          <span style={{ width: 80 }}>{h.started}</span>
          <span style={{ width: 50 }}>{h.dur}</span>
          <span style={{ width: 70 }}>{h.outcome}</span>
          <span style={{ width: 60, textAlign: "right" }}>{h.sqs}</span>
          <span style={{ width: 90, textAlign: "right" }}>{h.kio}</span>
        </div>
        {loading && rows.length === 0 && (
          <div style={{ padding: 16, color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
        )}
        {!loading && rows.length === 0 && (
          <div style={{ padding: 16, color: "var(--ink-3)", fontSize: 13 }}>
            {/* UX-newcomer-pass-2 (iter 20): "No sessions yet." is the
                kind of dead-end message that leaves a newcomer wondering
                "what do I do now?". Pair the state with the next step. */}
            No sessions yet — start one from Claude Code, Cursor, or any MCP client.
          </div>
        )}
        {rows.map((row) => (
          <div key={row.id}>
          <div
            role="button"
            tabIndex={0}
            aria-expanded={expandedSessionId === row.id}
            aria-controls={`dash-session-detail-${row.id}`}
            onClick={() =>
              setExpandedSessionId((cur) => (cur === row.id ? null : row.id))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setExpandedSessionId((cur) => (cur === row.id ? null : row.id));
              }
            }}
            className="row sess-row"
            style={{
              padding: "10px 14px",
              fontSize: 13,
              borderBottom: "1px solid var(--line-soft)",
              cursor: "pointer",
              background:
                expandedSessionId === row.id ? "var(--bg-elev-1)" : undefined,
            }}
            title="Click to see what the Brain shared and learned in this session"
          >
            <span
              style={{
                width: 14,
                color: "var(--ink-3)",
                display: "inline-flex",
                alignItems: "center",
              }}
              aria-hidden="true"
            >
              <Icon name={expandedSessionId === row.id ? "chevD" : "chevR"} size={11} />
            </span>
            <span style={{ width: 22, color: "var(--ink-3)" }}>
              <Icon name={row.icon} size={13} />
            </span>
            <span style={{ flex: 2 }}>
              <span className="mono" style={{ fontSize: 13 }}>
                {row.project}
              </span>
            </span>
            <span
              className="mono tab-num col-started-date"
              style={{ width: 80, fontSize: 12, color: "var(--ink-3)" }}
              title={row.startedAt}
            >
              {formatRelative(row.startedAt)}
            </span>
            <span
              className="mono tab-num col-duration"
              style={{
                width: 50,
                fontSize: 12,
                color: row.state === "in_progress" ? "var(--ink-4)" : "var(--ink-3)",
              }}
            >
              {row.duration}
            </span>
            <span style={{ width: 70 }}>
              <span
                className="chip"
                style={{
                  color:
                    row.outcome === "accepted"
                      ? "var(--ok)"
                      : row.outcome === "partial"
                        ? "var(--warn)"
                        : row.outcome === "in_progress"
                          ? "var(--ink-3)"
                          : "var(--bad)",
                  borderColor: "var(--line)",
                }}
              >
                <span className="dot" />
                {row.outcome === "in_progress" ? "running" : row.outcome}
              </span>
            </span>
            <span
              className="mono tab-num"
              style={{
                width: 60,
                textAlign: "right",
                color: row.sqs >= 0.7 ? "var(--accent-text)" : "var(--ink-2)",
              }}
            >
              {row.sqs.toFixed(2)}
            </span>
            <span style={{ width: 90, textAlign: "right" }}>
              <ValueChip injected={row.injected} extracted={row.extracted} />
            </span>
          </div>
          {expandedSessionId === row.id && (
            <div id={`dash-session-detail-${row.id}`}>
              <SessionDetailPanel sessionId={row.id} />
            </div>
          )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingProposals({
  onReview,
  proposals,
  total,
  loading,
}: {
  onReview: () => void;
  proposals: ProposalView[];
  total: number;
  loading: boolean;
}) {
  const t = useT();
  const rows = proposals.slice(0, 3);
  return (
    <div className="panel">
      <div className="panel-h">
        <h3>{t("dash.autoskill_title")}</h3>
        <span className="sub">
          {total} {t("dash.pending")}
        </span>
        <div className="grow" />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ height: 24, fontSize: 12 }}
          onClick={onReview}
        >
          {t("dash.review")} <Icon name="arrowR" size={10} />
        </button>
      </div>
      <div>
        {loading && rows.length === 0 && (
          <div style={{ padding: 16, color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
        )}
        {!loading && rows.length === 0 && (
          <div style={{ padding: 16, color: "var(--ink-3)", fontSize: 13 }}>
            No pending proposals.
          </div>
        )}
        {rows.map((pr) => (
          <div
            key={pr.id}
            style={{
              padding: "12px 14px",
              borderBottom: "1px solid var(--line-soft)",
            }}
          >
            <div className="row" style={{ marginBottom: 6 }}>
              <span
                className="chip"
                style={{
                  color: pr.confidence === "high" ? "var(--accent-text)" : "var(--warn)",
                  borderColor:
                    pr.confidence === "high"
                      ? "color-mix(in oklab, var(--accent) 30%, var(--line))"
                      : "var(--line)",
                  textTransform: "uppercase",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                }}
              >
                {pr.confidence}
              </span>
              <span
                className={`chip k-${pr.type === "anti_principle" ? "anti" : pr.type === "style" ? "reflex" : pr.type}`}
              >
                {pr.type.replace("_", " ")}
              </span>
              <div className="grow" />
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
                {pr.session.slice(0, 8)}
              </span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.35, marginBottom: 4 }}>{pr.title}</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>→ {pr.target}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgeHealth({
  knowledgeHealth,
  bundleHitRate,
  contradictions,
}: {
  knowledgeHealth: number;
  bundleHitRate: number;
  contradictions: number;
}) {
  const t = useT();
  // Plain-English labels for non-technical users; the precise metric name
  // (NDCG@5, etc.) lives in the hover tooltip for anyone who wants it.
  const metrics = [
    {
      label: "Answer relevance",
      tooltip: t("tip.ndcg"),
      value: knowledgeHealth.toFixed(2),
      bar: knowledgeHealth,
      target: "> 0.50",
    },
    { label: "Overall health", value: knowledgeHealth.toFixed(2), bar: knowledgeHealth, target: "> 0.70" },
    { label: "Useful-bundle rate", value: bundleHitRate.toFixed(2), bar: bundleHitRate, target: "> 0.60" },
    {
      label: "Conflicting skills",
      value: String(contradictions),
      bar: contradictions > 5 ? 1 : contradictions / 5,
      inv: true,
      target: "< 5",
    },
  ];
  return (
    <div className="panel">
      <div className="panel-h">
        <h3>{t("dash.flywheel")}</h3>
        <span className="sub">{t("dash.gate2")}</span>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {metrics.map((m) => (
          <div key={m.label}>
            <div className="row" style={{ marginBottom: 5 }}>
              <span
                style={{ fontSize: 13, color: "var(--ink-2)" }}
                title={"tooltip" in m ? (m as { tooltip?: string }).tooltip : undefined}
              >
                {m.label}
              </span>
              <div className="grow" />
              <span className="mono tab-num" style={{ fontSize: 13 }}>
                {m.value}
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 6 }}>
                {m.target}
              </span>
            </div>
            <div style={{ height: 3, background: "var(--bg-elev-3)", borderRadius: 2 }}>
              <div
                style={{
                  width: `${Math.min(100, m.bar * 100)}%`,
                  height: "100%",
                  background: m.inv ? "var(--ink-3)" : "var(--accent)",
                  borderRadius: 2,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgeTypes({ typeCounts }: { typeCounts: TypeCount[] }) {
  const t = useT();
  const total = typeCounts.reduce((s, c) => s + c.count, 0);
  const palette: Record<string, { k: string; label: string }> = {
    recipe: { k: "recipe", label: "Recipe" },
    heuristic: { k: "heuristic", label: "Heuristic" },
    reflex: { k: "reflex", label: "Reflex" },
    principle: { k: "principle", label: "Principle" },
    anti_principle: { k: "anti", label: "Anti-principle" },
  };
  const ordered = Object.keys(palette)
    .map((key) => {
      const entry = typeCounts.find((c) => c.type === key);
      return {
        ...palette[key]!,
        count: entry?.count ?? 0,
      };
    })
    .filter((r) => r.count > 0);
  return (
    <div className="panel">
      <div className="panel-h">
        <h3>{t("dash.composition")}</h3>
        <span className="sub">
          {total} {t("dash.items")}
        </span>
      </div>
      <div style={{ padding: "14px 14px 10px" }}>
        <div
          style={{
            display: "flex",
            height: 8,
            borderRadius: 4,
            overflow: "hidden",
            marginBottom: 12,
          }}
        >
          {ordered.map((tt) => (
            <div
              key={tt.k}
              style={{
                width: `${total ? (tt.count / total) * 100 : 0}%`,
                background: `var(--k-${tt.k})`,
                opacity: 0.85,
              }}
            />
          ))}
        </div>
        {ordered.map((tt) => (
          <div key={tt.k} className="row" style={{ padding: "6px 0", fontSize: 13 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: `var(--k-${tt.k})` }} />
            <span>{tt.label}</span>
            <div className="grow" />
            <span className="mono tab-num" style={{ color: "var(--ink-3)" }}>
              {tt.count}
            </span>
            <span
              className="mono tab-num"
              style={{ width: 40, textAlign: "right", color: "var(--ink-4)" }}
            >
              {total ? `${Math.round((tt.count / total) * 100)}%` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function effectivenessColor(score: number): string {
  if (score >= 0.7) return "var(--ok, #4caf50)";
  if (score >= 0.4) return "var(--warn, #f5a623)";
  return "var(--bad, #ff6b6b)";
}

function MostUsefulRules({
  onViewSkill,
}: {
  onViewSkill: () => void;
}) {
  const { scope } = useProjectScope();
  const { rules, loadState } = useTopRules(scope, 5);

  return (
    <div className="panel">
      <div className="panel-h">
        <h3>Most Useful Skills</h3>
        <span className="sub">≥5 session outcomes</span>
        <div className="grow" />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ height: 24, fontSize: 12 }}
          onClick={onViewSkill}
          title="View all skills in the Skills tab"
        >
          All skills <Icon name="arrowR" size={10} />
        </button>
      </div>
      <div>
        {loadState === "loading" && (
          <div style={{ padding: 16, color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
        )}
        {loadState !== "loading" && rules.length === 0 && (
          <div style={{ padding: "12px 14px", color: "var(--ink-3)", fontSize: 13, lineHeight: 1.5 }}>
            No skills with ≥5 recorded outcomes yet. Run sessions and report
            their outcomes to see effectiveness data here.
          </div>
        )}
        {rules.map((rule: TopRuleRow) => {
          const pct = Math.round(rule.score * 100);
          return (
            <div
              key={rule.id}
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--line-soft)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span className={`chip k-${rule.type === "anti_principle" ? "anti" : rule.type}`} style={{ flexShrink: 0 }}>
                {rule.type === "anti_principle" ? "anti" : rule.type}
              </span>
              <span style={{ flex: 1, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.35 }}>
                {rule.title}
              </span>
              <span
                className="mono tab-num"
                title={`${pct}% success rate across ${rule.outcomes} session outcomes`}
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: effectivenessColor(rule.score),
                  flexShrink: 0,
                }}
              >
                {pct}%
              </span>
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-4)", flexShrink: 0 }}
                title={`${rule.outcomes} sessions reported outcome for this rule`}
              >
                {rule.outcomes} sess.
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Dashboard({
  go,
  onTeach,
}: {
  go: (r: Route) => void;
  /** Open the Teach modal (used by the empty-state callout). */
  onTeach?: () => void;
}) {
  const t = useT();
  const { scope, setScope } = useProjectScope();
  const { stats: s, typeCounts, loadState } = useDashboardStats(scope);
  const sessionsH = useSessions(50, scope);
  const proposalsH = useAutoskillProposals(scope);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Mount-gate the empty-state branch. The /api/dashboard fetch is same-origin
  // and can resolve before React commits hydration; if it returns an empty
  // project, `isEmpty` flips true and the client's first committed render (the
  // EmptyBrainCallout branch) diverges from the server HTML (the loading
  // branch) → React #418. Gating on `mounted` forces the first client render
  // to match SSR; the empty branch only appears via a post-hydration update.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Empty-Brain mode: a fresh user has nothing meaningful to summarize, so
  // every "0 / 0 / 0" tile reads as "this app is broken". Replace the
  // dashboard body with the EmptyBrainCallout hero and keep only the
  // Connection card so they can see whether their token is wired up.
  const isEmpty = mounted && s.activeKnowledge === 0 && loadState !== "loading";

  return (
    <div className="scroll" style={{ height: "100%", padding: "20px 24px 40px" }}>
      <div className="row dash-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, letterSpacing: "-0.02em", fontWeight: 500 }}>
            {t("dash.title")}
          </h1>
          {/* Subtitle whispers: only render meaningful copy. The non-empty
              filler "Recent activity and what needs your attention" was
              generic UX noise; PulseLine + HomeHero already say what's
              happening. Loading/offline pills still show because they're
              state signals, not filler. */}
          {(isEmpty || loadState === "loading" || loadState === "error") && (
            <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 4 }}>
              {isEmpty &&
                "Your Brain is just getting started. Wire up a tool or teach a rule below."}
              {loadState === "loading" && (
                <span style={{ color: "var(--ink-4)", marginLeft: isEmpty ? 8 : 0 }}>
                  {isEmpty ? "· " : ""}loading…
                </span>
              )}
              {loadState === "error" && (
                <span style={{ color: "var(--warn)", marginLeft: isEmpty ? 8 : 0 }}>
                  {isEmpty ? "· " : ""}offline
                </span>
              )}
            </div>
          )}
        </div>
        <div className="grow" />
        {!isEmpty && <ScopePill scope={scope} onScopeChange={setScope} />}
      </div>

      {isEmpty ? (
        <>
          <EmptyBrainCallout onTeach={() => onTeach?.()} />
          <AgentPromptsCard sessionsAllTime={s.sessionsAllTime} />
          <div style={{ marginTop: 16 }}>
            <ConnectionStatus
              onManageTokens={() => {
                window.location.href = "/settings/tokens";
              }}
            />
          </div>
        </>
      ) : (
        <>
          {/* HERO — Phase R: one-sentence pulse, then three big action
              cards (Skills count / Just-learned insight / Oracle prompt).
              Everything else (projects, sessions, live activity, advanced)
              hides behind the Show-everything fold so a first-time visitor
              sees one sentence + three cards + one toggle. Spec:
              docs/superpowers/specs/2026-05-24-ui-revision-phaseR-redesign.md */}
          <PulseLine
            sessionsWeek={s.sessionsWeek}
            sessionsAllTime={s.sessionsAllTime}
            activeKnowledge={s.activeKnowledge}
            sqsCurrent={s.sqsCurrent}
            sqsTrend={s.sqsTrend}
          />
          <HomeHero skillsCount={s.activeKnowledge} go={go} />

          {/* Toast was here in R.3; moved to BrainApp shell in R.4 so it
              only fires on non-dashboard routes. HomeHero's Card 2 already
              shows the latest insight on the dashboard — firing the toast
              there meant two simultaneous announcements of the same
              extraction (issue: R.4 audit). */}

          <ShowEverythingFold>
          {/* SECTION 1 — Projects. List of your projects; each row
              expands inline to show what the Brain has done for /
              learned from that project. Earned-surface-area: the
              ProjectsList component returns null when there are no
              projects, so the SectionLabel still anchors the header
              once any project exists. */}
          <SectionLabel hint="Click a project to see what the Brain has done for it and learned from it.">
            Your projects
          </SectionLabel>
          <ProjectsList />

          {/* SECTION 2 — Your work. Recent sessions list. Click a row
              to expand inline (same drill-down available on /sessions
              from PR #263) without leaving the dashboard. */}
          <SectionLabel hint="Your most recent coding sessions — click a row to see what the Brain shared and learned.">
            Your recent work
          </SectionLabel>
          <RecentSessions
            onViewAll={() => go("sessions")}
            sessions={sessionsH.sessions}
            total={s.sessionsAllTime}
            loading={sessionsH.loadState === "loading"}
          />

          {/* Live activity + pending review. Demoted below the
              user-facing surfaces above: the brain's own activity is
              secondary to "what's the brain done for me", per
              docs/DESIGN_PRINCIPLES.md (quiet by default). Phase 2
              dropped the "Right now" SectionLabel — the panels carry
              their own headers and a meta-label was duplicate ink. */}
          <div
            className="dash-grid-wide"
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr",
              gap: 10,
              marginTop: 24,
            }}
          >
            <LiveExtraction />
            <PendingProposals
              onReview={() => go("autoskill")}
              proposals={proposalsH.proposals}
              total={proposalsH.proposals.length}
              loading={proposalsH.loadState === "loading"}
            />
          </div>

          {/* SECTION 3 — Advanced (collapsed by default). Connection
              status, knowledge health, types, useful rules. None of
              these are needed for everyday use; surfacing them
              behind a toggle keeps the default view scannable. */}
          <div style={{ marginTop: 24 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              style={{ fontSize: 13 }}
            >
              {showAdvanced ? "▾" : "▸"} Advanced metrics &amp; connection status
            </button>
          </div>
          {showAdvanced && (
            <div style={{ marginTop: 12 }}>
              <ConnectionStatus
                onManageTokens={() => {
                  window.location.href = "/settings/tokens";
                }}
              />
              {/* SQS chart relocated here from the hero per Phase 2 —
                  most users don't parse a 12-point quality sparkline at
                  a glance, but power users can still find it. */}
              <div style={{ marginTop: 10 }}>
                <SQSChart data={s.sqsTrend} sqs={s.sqsCurrent} />
              </div>
              <div
                className="dash-grid-wide"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr",
                  gap: 10,
                  marginTop: 10,
                }}
              >
                <KnowledgeHealth
                  knowledgeHealth={s.knowledgeHealth}
                  bundleHitRate={s.bundleHitRate}
                  contradictions={s.contradictions}
                />
                <KnowledgeTypes typeCounts={typeCounts} />
                <MostUsefulRules onViewSkill={() => go("skills")} />
              </div>
              <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 13 }}
                  onClick={() => {
                    window.open("/api/knowledge?limit=500", "_blank", "noopener");
                  }}
                >
                  <Icon name="copy" size={11} /> {t("dash.export")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ fontSize: 13 }}
                  onClick={() => {
                    window.open("/api/me", "_blank", "noopener");
                  }}
                >
                  <Icon name="link" size={11} />{" "}
                  <span title={t("tip.mcp")}>
                    {t("dash.mcp")}
                  </span>
                </button>
                <HelpPopover
                  content={{
                    what: "Your dashboard — Brain health at a glance: how many skills you have, how recent sessions performed, what's pending review, and whether your tokens are talking to the server.",
                    whatToDo: [
                      "Watch the Connection status card — green = your AI tools are talking to Brain right now.",
                      "Click any stat label to learn what it means (hover for tooltips).",
                      "Hit Teach (top-right) to add a skill. Use Export to download your knowledge as JSON.",
                      "Switch the scope chip (project/all) to filter what these numbers count.",
                    ],
                    related: [],
                    docHref: "/docs/concepts/connection-status",
                  }}
                />
              </div>
            </div>
          )}
          </ShowEverythingFold>
        </>
      )}
    </div>
  );
}

/**
 * ShowEverythingFold — the single toggle that gates the entire
 * legacy dashboard body (projects, sessions, live activity, advanced).
 * Per Phase R, a first-time non-technical visitor should see one
 * sentence + three cards + this toggle, and nothing else. The open/
 * closed state persists in localStorage so power users don't have to
 * re-expand on every page load.
 */
function ShowEverythingFold({ children }: { children: React.ReactNode }) {
  // Start closed (matches SSR), then restore the persisted state AFTER mount.
  // Reading localStorage during render diverges from the server's output and
  // triggers a hydration mismatch (React #418) once the value is "1".
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (window.localStorage.getItem("brain-home-expanded") === "1") setOpen(true);
  }, []);
  return (
    <div style={{ marginTop: 24 }}>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ fontSize: 13 }}
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (typeof window !== "undefined") {
              window.localStorage.setItem(
                "brain-home-expanded",
                next ? "1" : "0",
              );
            }
            return next;
          });
        }}
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} Show everything (projects, sessions, live activity, advanced)
      </button>
      {open && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  );
}
