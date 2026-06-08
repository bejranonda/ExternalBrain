"use client";

import { useEffect, useState } from "react";

/** Shape of GET /api/admin/backup-status. */
interface BackupStatus {
  ok: boolean;
  configured: boolean;
  lastSyncAge: number | null;
  threshold?: number;
  warn: boolean;
  message?: string;
}

function formatAge(seconds: number): string {
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/**
 * Off-host backup replication heartbeat (#39). Wires the previously-orphaned
 * GET /api/admin/backup-status into the admin overview so operators can see
 * backup health without curl:
 *   • green  — synced within threshold
 *   • amber  — configured but the last sync is late (warn)
 *   • grey   — not configured (sidecar off / first sync pending) or unreachable
 */
export function BackupStatusCard() {
  const [data, setData] = useState<BackupStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/backup-status", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<BackupStatus>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  let dot = "var(--ink-4)";
  let value = "Checking…";
  let sub = "off-host replication heartbeat";

  if (failed) {
    value = "Unavailable";
    sub = "could not read backup status";
  } else if (data) {
    if (!data.configured) {
      value = "Not configured";
      sub = "backup-replicate off or first sync pending";
    } else if (data.warn) {
      dot = "var(--warn, #F5C451)";
      value = data.lastSyncAge != null ? `Late · ${formatAge(data.lastSyncAge)}` : "Late";
      sub = "last sync older than threshold";
    } else {
      dot = "var(--ok, #67E8A0)";
      value = data.lastSyncAge != null ? `Synced ${formatAge(data.lastSyncAge)}` : "Synced";
      sub = "within sync threshold";
    }
  }

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
        style={{ fontSize: 11, color: "var(--ink-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        Off-host backup
      </div>
      <div style={{ fontSize: 18, fontWeight: 500, marginTop: 4, display: "flex", alignItems: "center", gap: 8 }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}
