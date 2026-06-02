"use client";

import { useConnectionStatus } from "@/lib/brain/use-connection-status";
import { useT } from "@/lib/brain/i18n";
import type { ConnectionStatusToken } from "@/app/api/dashboard/connection-status/route";
import { formatRelative } from "@brain/core/format-relative";

// Thin null-guard over the canonical formatRelative so every surface
// renders "2d ago" identically (was one of 4 divergent hand-rolled
// formatters — consistency pass 2026-05-31).
function relTime(iso: string | null): string {
  return iso ? formatRelative(iso) : "never";
}

export function ConnectionStatus({ onManageTokens }: { onManageTokens: () => void }) {
  const { payload, loadState, error } = useConnectionStatus();
  const tr = useT();

  // Loading shell — keep the panel visible so layout doesn't jump on first paint.
  if (loadState === "loading" || !payload) {
    return (
      <div className="panel" style={{ padding: "14px 16px" }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Connection status
          </div>
          <div className="grow" />
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
            {loadState === "error" ? `error: ${error ?? "unknown"}` : "loading…"}
          </span>
        </div>
      </div>
    );
  }

  const {
    tokens,
    liveTokenCount,
    totalActiveTokens,
    sessions24h,
    events24h,
    knowledgeExtracted24h,
    keaQueueDepth,
  } = payload;

  return (
    <div className="panel" style={{ padding: "14px 16px" }}>
      {/* Header */}
      <div className="row" style={{ marginBottom: 12 }}>
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Connection status
        </div>
        <div className="grow" />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ height: 22, fontSize: 12 }}
          onClick={onManageTokens}
        >
          Manage tokens
        </button>
      </div>

      {/* Token heartbeat list */}
      <div style={{ marginBottom: 14 }}>
        <div
          className="row"
          style={{ marginBottom: 6, alignItems: "center", gap: 8 }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background:
                liveTokenCount > 0 ? "var(--ok, #22c55e)" : "var(--ink-4)",
              boxShadow:
                liveTokenCount > 0
                  ? "0 0 6px color-mix(in oklab, var(--ok, #22c55e) 60%, transparent)"
                  : "none",
            }}
            aria-hidden
          />
          <span
            style={{ fontSize: 13 }}
            title={`${liveTokenCount} token${liveTokenCount === 1 ? " is" : "s are"} actively connecting from an AI tool right now (used in the last 5 minutes). ${totalActiveTokens} total ${totalActiveTokens === 1 ? "token exists" : "tokens exist"} on this account.`}
          >
            <strong className="tab-num">
              {liveTokenCount}/{totalActiveTokens}
            </strong>{" "}
            tokens live
          </span>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
            (last 5 min)
          </span>
        </div>

        {tokens.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 0", lineHeight: 1.5 }}>
            No active tokens yet.{" "}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "0 4px", height: 18 }}
              onClick={onManageTokens}
            >
              Create one
            </button>{" "}
            to wire up an{" "}
            <span title={tr("tip.mcp")}>
              MCP
            </span>{" "}
            client (Claude Code, Cursor, Windsurf…).
          </div>
        )}

        {tokens.map((t: ConnectionStatusToken) => (
          <div
            key={t.id}
            className="row"
            style={{
              padding: "4px 0",
              fontSize: 13,
              alignItems: "center",
              gap: 8,
            }}
            title={
              t.sessions24h > 0
                ? `${t.sessions24h} session${t.sessions24h === 1 ? "" : "s"} · ${t.events24h} event${t.events24h === 1 ? "" : "s"} in the last 24h`
                : "no sessions from this token in the last 24h"
            }
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 99,
                background: t.live ? "var(--ok, #22c55e)" : "var(--ink-4)",
              }}
              aria-hidden
            />
            <span style={{ color: "var(--ink-2)" }}>{t.name}</span>
            {/* Issue #166: per-token 24h counts. Renders only when this
                token actually contributed; keeps the row compact for
                idle tokens. */}
            {t.sessions24h > 0 && (
              <span
                className="mono"
                style={{ fontSize: 12, color: "var(--ink-4)" }}
                title="Sessions and events from this token in the last 24h"
              >
                {t.sessions24h} {t.sessions24h === 1 ? "session" : "sessions"} ·{" "}
                {t.events24h} {t.events24h === 1 ? "event" : "events"}
              </span>
            )}
            <div className="grow" />
            <span
              className="mono"
              style={{ fontSize: 12, color: t.live ? "var(--ok, #22c55e)" : "var(--ink-4)" }}
            >
              {relTime(t.lastUsedAt)}
            </span>
          </div>
        ))}
      </div>

      {/* Knowledge-flow counters (24h) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8,
          padding: "10px 0 0",
          borderTop: "1px solid var(--line-soft)",
        }}
      >
        <Counter label="Sessions 24h" value={sessions24h} />
        <Counter label="Events 24h" value={events24h} />
        <Counter label="Knowledge 24h" value={knowledgeExtracted24h} />
        {keaQueueDepth === null ? (
          <Counter
            label="Extract queue"
            value="—"
            dim
            hint={tr("tip.kea_queue_hidden")}
          />
        ) : (
          <Counter
            label="Extract queue"
            value={keaQueueDepth}
            hint={tr("tip.kea_queue_pending")}
          />
        )}
      </div>
    </div>
  );
}

function Counter({
  label,
  value,
  dim,
  hint,
}: {
  label: string;
  value: number | string;
  dim?: boolean;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        className="tab-num"
        style={{
          fontSize: 20,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          marginTop: 2,
          color: dim ? "var(--ink-4)" : "var(--ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
