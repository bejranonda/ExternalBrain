"use client";

import { useState } from "react";
import { formatRelative } from "@brain/core/format-relative";
import { Icon } from "./icons";
import { useT } from "@/lib/brain/i18n";
import { useSessions, type SessionFilter } from "@/lib/brain/use-sessions";
import { useProjectScope } from "@/lib/brain/use-project-scope";
import { ScopePill } from "./scope-pill";
import { HelpPopover } from "./help-popover";
import { SessionDetailPanel } from "./session-detail-panel";
import { ValueChip } from "./value-chip";

type OutcomeOption = "accepted" | "partial" | "rejected" | "all";
type ClientOption = "claude_code" | "cursor" | "windsurf" | "mcp" | "custom" | "all";

export function Sessions() {
  const t = useT();
  const { scope, setScope } = useProjectScope();
  const { sessions, total, nextCursor, loadState, error, refresh, loadMore, setFilter, filter } =
    useSessions(50, scope);
  const [showFilter, setShowFilter] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Single open at a time — collapses any previously-expanded row when
  // a new one is clicked. Toggle off if the same row is clicked again.
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  const applyOutcome = (v: OutcomeOption) => {
    const next: SessionFilter = { ...filter };
    if (v === "all") delete next.outcome;
    else next.outcome = v;
    setFilter(next);
  };
  const applyClient = (v: ClientOption) => {
    const next: SessionFilter = { ...filter };
    if (v === "all") delete next.client;
    else next.client = v;
    setFilter(next);
  };

  return (
    <div className="scroll" style={{ height: "100%", padding: "24px 32px 60px" }}>
      <div className="row" style={{ marginBottom: 4, gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.02em", fontWeight: 500 }}>
          {t("sessions.title")}
        </h1>
        <span className="chip" style={{ marginLeft: 10 }}>
          {total.toLocaleString()} {t("sessions.all_time")}
        </span>
        <ScopePill scope={scope} onScopeChange={setScope} />
        <div className="grow" />
        <button
          type="button"
          className={showFilter ? "btn" : "btn btn-ghost"}
          onClick={() => setShowFilter((v) => !v)}
        >
          <Icon name="filter" size={11} /> Filter
          {(filter.outcome || filter.client) && (
            <span className="kbd" style={{ marginLeft: 4 }}>
              {(filter.outcome ? 1 : 0) + (filter.client ? 1 : 0)}
            </span>
          )}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void refresh()}
          title="Refresh"
        >
          <Icon name="sort" size={11} />
        </button>
        <HelpPopover
          content={{
            what: "Each row is one task your AI tool started via the Brain. Brain reads your sessions, spots recurring patterns, and proposes new skills from them.",
            whatToDo: [
              "Read the Task column — it's the prompt your tool started with.",
              "Outcome: accepted = success; in progress = the tool never reported back; rejected = failed.",
              "Quality is the session's quality score (0–1). Aim for ≥ 0.70.",
              "Used / Learned = how many skills were used in the session vs newly learned from it.",
            ],
            related: [],
            docHref: "/docs/concepts/sessions",
          }}
        />
      </div>
      <p
        style={{
          margin: "2px 0 20px",
          fontSize: 13,
          color: "var(--ink-3)",
          lineHeight: 1.4,
        }}
      >
        {/* TODO i18n: short subtitle — keep terse. Detail moved to (?) help popover. */}
        Every coding task your AI tools have run
      </p>

      {showFilter && (
        <div
          className="panel"
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <FilterGroup
            label="Outcome"
            value={(filter.outcome as OutcomeOption | undefined) ?? "all"}
            options={[
              { k: "all", label: "All" },
              { k: "accepted", label: "Accepted" },
              { k: "partial", label: "Partial" },
              { k: "rejected", label: "Rejected" },
            ]}
            onChange={(v) => applyOutcome(v as OutcomeOption)}
          />
          <FilterGroup
            label="Client"
            value={(filter.client as ClientOption | undefined) ?? "all"}
            options={[
              { k: "all", label: "All" },
              { k: "claude_code", label: "Claude" },
              { k: "cursor", label: "Cursor" },
              { k: "windsurf", label: "Windsurf" },
              { k: "mcp", label: "MCP", title: t("tip.mcp") },
              { k: "custom", label: "Custom" },
            ]}
            onChange={(v) => applyClient(v as ClientOption)}
          />
        </div>
      )}

      {loadState === "error" && (
        <Banner>
          Failed to load sessions{error ? ` (${error})` : ""}.
        </Banner>
      )}
      {loadState === "loading" && <Banner>Loading sessions…</Banner>}
      {loadState === "ready" && sessions.length === 0 && <EmptyState />}

      {sessions.length > 0 && (
        <div className="panel">
          <div
            className="row mono desktop-only"
            style={{
              padding: "12px 16px",
              fontSize: 11,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              borderBottom: "1px solid var(--line-soft)",
            }}
          >
            <span style={{ width: 22 }} />
            <span style={{ flex: 3 }}>Task</span>
            {scope === "all" && <span style={{ width: 120 }}>Project</span>}
            <span style={{ width: 120 }}>Started</span>
            <span style={{ width: 70 }}>Dur</span>
            <span style={{ width: 100 }}>Outcome</span>
            <span
              style={{ width: 60, textAlign: "right" }}
              title={t("tip.sqs_short")}
            >
              Quality
            </span>
            <span style={{ width: 90, textAlign: "right" }}>Used / Learned</span>
          </div>
          {sessions.map((row) => (
            <div key={row.id} className="desktop-only">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={expandedSessionId === row.id}
                aria-controls={`session-detail-${row.id}`}
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
                  padding: "14px 16px",
                  fontSize: 14,
                  borderBottom: "1px solid var(--line-soft)",
                  cursor: "pointer",
                  background:
                    expandedSessionId === row.id ? "var(--bg-elev-1)" : undefined,
                }}
                title="Click to see what skills the Brain shared and learned from this session"
              >
              <span style={{ width: 22, color: "var(--ink-3)" }}>
                <Icon name={row.icon} size={13} />
              </span>
              <span
                style={{
                  flex: 3,
                  fontSize: 14,
                  paddingRight: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: row.prompt ? "var(--ink)" : "var(--ink-3)",
                    fontStyle: row.prompt ? "normal" : "italic",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={row.prompt ?? row.shortId}
                >
                  {row.prompt ?? "(no task description)"}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--ink-4)" }}
                >
                  {row.shortId}
                </span>
              </span>
              {scope === "all" && (
                <span className="mono" style={{ width: 120, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.project}>
                  {row.project}
                </span>
              )}
              <span
                className="mono tab-num col-started-date"
                style={{ width: 120, fontSize: 12, color: "var(--ink-3)" }}
                title={row.startedAt}
              >
                {formatRelative(row.startedAt)}
              </span>
              <span
                className="mono tab-num col-duration"
                style={{
                  width: 70,
                  fontSize: 12,
                  color: row.state === "in_progress" ? "var(--ink-4)" : "var(--ink-3)",
                }}
              >
                {row.duration}
              </span>
              <span style={{ width: 100 }}>
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
                    borderColor:
                      row.outcome === "in_progress"
                        ? "color-mix(in oklab, var(--ink-3) 40%, var(--line))"
                        : undefined,
                  }}
                >
                  {row.outcome === "in_progress" ? "in progress" : row.outcome}
                </span>
              </span>
              <span
                className="mono tab-num"
                style={{
                  width: 60,
                  fontSize: 13,
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
                <div id={`session-detail-${row.id}`}>
                  <SessionDetailPanel sessionId={row.id} />
                </div>
              )}
            </div>
          ))}

          {/* Mobile-only vertical card layout. Same data, restructured so a
              360px viewport doesn't horizontally scroll. Uses the .sess-card
              CSS class — inline `display: flex` previously overrode
              .mobile-only's display:none and rendered the cards on desktop
              too (visible 2026-05-07 on a wide screenshot). */}
          {sessions.map((row) => (
            <div
              key={`m-${row.id}`}
              className="sess-card"
              role="button"
              tabIndex={0}
              aria-expanded={expandedSessionId === row.id}
              onClick={() =>
                setExpandedSessionId((cur) => (cur === row.id ? null : row.id))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setExpandedSessionId((cur) => (cur === row.id ? null : row.id));
                }
              }}
              style={{
                cursor: "pointer",
                background:
                  expandedSessionId === row.id ? "var(--bg-elev-1)" : undefined,
              }}
            >
              {/* Top meta row */}
              <div
                className="row"
                style={{ gap: 8, fontSize: 11, alignItems: "center", flexWrap: "wrap" }}
              >
                <Icon name={row.icon} size={13} />
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
                  }}
                >
                  {row.outcome === "in_progress" ? "in progress" : row.outcome}
                </span>
                <span
                  className="mono tab-num"
                  style={{ color: row.sqs >= 0.7 ? "var(--accent-text)" : "var(--ink-2)" }}
                >
                  SQS {row.sqs.toFixed(2)}
                </span>
                <div className="grow" />
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>
                  {row.shortId}
                </span>
              </div>

              {/* Task / prompt */}
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.4,
                  color: row.prompt ? "var(--ink)" : "var(--ink-3)",
                  fontStyle: row.prompt ? "normal" : "italic",
                }}
              >
                {row.prompt ?? "(no task description)"}
              </div>

              {/* Bottom meta row — project · started · duration · K in/out */}
              <div
                className="mono"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0 10px",
                  fontSize: 10.5,
                  color: "var(--ink-4)",
                }}
              >
                {scope === "all" && <span>{row.project}</span>}
                <span title={row.startedAt}>{formatRelative(row.startedAt)}</span>
                <span style={{ color: row.state === "in_progress" ? "var(--ink-4)" : "var(--ink-3)" }}>
                  {row.duration === "—" ? "running" : row.duration}
                </span>
                <ValueChip injected={row.injected} extracted={row.extracted} />
              </div>
              {expandedSessionId === row.id && (
                <SessionDetailPanel sessionId={row.id} />
              )}
            </div>
          ))}
          {nextCursor && (
            <div
              style={{
                padding: 12,
                borderTop: "1px solid var(--line-soft)",
                textAlign: "center",
              }}
            >
              <button
                type="button"
                className="btn"
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  try {
                    await loadMore();
                  } finally {
                    setLoadingMore(false);
                  }
                }}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ k: T; label: string; title?: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
        {options.map((o) => (
          <button
            key={o.k}
            type="button"
            className={value === o.k ? "btn" : "btn btn-ghost"}
            style={{ height: 24, fontSize: 11 }}
            onClick={() => onChange(o.k)}
            title={o.title}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="panel"
      style={{
        padding: "10px 14px",
        marginBottom: 12,
        borderLeft: "3px solid var(--ink-3)",
        fontSize: 12,
        color: "var(--ink-2)",
      }}
    >
      {children}
    </div>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <div
      className="panel"
      style={{
        padding: "32px 28px",
        margin: "0 auto",
        maxWidth: 480,
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--bg-elev-1)",
          border: "1px solid var(--line-soft)",
          color: "var(--ink-3)",
          marginBottom: 14,
        }}
      >
        <Icon name="link" size={14} />
      </div>
      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: "var(--ink)",
        }}
      >
        {t("sessions.empty_title")}
      </h2>
      <p
        style={{
          margin: "0 0 16px",
          fontSize: 14,
          lineHeight: 1.55,
          color: "var(--ink-2)",
        }}
      >
        {t("sessions.empty_body")}
      </p>
      <div
        className="row"
        style={{ gap: 8, justifyContent: "center", flexWrap: "wrap" }}
      >
        <a
          href="/settings/tokens"
          className="btn btn-primary"
          style={{ fontSize: 13, textDecoration: "none" }}
        >
          <Icon name="link" size={11} /> {t("sessions.get_token")}
        </a>
        <a
          href="/api/onboard.sh"
          target="_blank"
          rel="noopener"
          className="btn btn-ghost"
          style={{ fontSize: 13, textDecoration: "none" }}
          title={t("sessions.install_hint")}
        >
          {t("sessions.view_install")}
        </a>
      </div>
    </div>
  );
}
