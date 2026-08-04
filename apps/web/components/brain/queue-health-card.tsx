"use client";

import { useEffect, useState } from "react";

/** Shape of GET /api/admin/queue-health. */
interface QueueHealth {
  ok: boolean;
  deadLetter: { queue: string; depth: number; oldestAgeSeconds: number | null };
  failedLast24h: Array<{ name: string; failed24h: number }>;
}

function formatAge(seconds: number): string {
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/**
 * Background-pipeline health, sitting beside BackupStatusCard for the same
 * reason it exists: a failure with no surface is indistinguishable from
 * success.
 *
 * Before v2.11.0 a job that exhausted its retries moved to `failed` in
 * `pgboss.job` and nothing ever read it — so KEA could stop learning and the
 * only trace was a log line nobody greps.
 *
 *   • green — dead-letter queue empty
 *   • red   — anything in it. There is no threshold below which losing a
 *             user's extraction is acceptable, so the first entry is already
 *             the alarm.
 *   • grey  — endpoint unreachable
 *
 * The 24 h failure counts are the leading indicator: jobs that fail and then
 * retry successfully never reach the DLQ, but a rising count is what precedes
 * the first dead letter.
 */
export function QueueHealthCard() {
  const [data, setData] = useState<QueueHealth | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/queue-health", { cache: "no-store" })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<QueueHealth>)
          : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  let dot = "var(--ink-4)";
  let value = "Checking…";
  let sub = "jobs that exhausted their retries";

  if (failed) {
    value = "Unavailable";
    sub = "could not read queue health";
  } else if (data) {
    const { depth, oldestAgeSeconds } = data.deadLetter;
    if (depth === 0) {
      dot = "var(--ok, #67E8A0)";
      value = "No dead jobs";
    } else {
      dot = "var(--bad, #ff6b6b)";
      value = `${depth} dead ${depth === 1 ? "job" : "jobs"}`;
      sub =
        oldestAgeSeconds != null
          ? `oldest ${formatAge(oldestAgeSeconds)} — work was lost`
          : "work was lost";
    }
  }

  const failures = data?.failedLast24h ?? [];
  const totalFailed = failures.reduce((n, q) => n + q.failed24h, 0);

  return (
    <div
      style={{
        padding: "14px 16px",
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--bg-elev-1)",
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--ink-4)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        Background jobs
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 500,
          marginTop: 4,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: dot,
            flexShrink: 0,
          }}
        />
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>
      {!failed && data && (
        <div style={{ fontSize: 13, marginTop: 8 }}>
          {totalFailed === 0
            ? "No failures in 24h"
            : `${totalFailed} retried failure${totalFailed === 1 ? "" : "s"} in 24h`}
          {failures.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
              {failures
                .slice(0, 3)
                .map((q) => `${q.name} ×${q.failed24h}`)
                .join(" · ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
