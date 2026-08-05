"use client";

import { useCallback, useEffect, useState } from "react";

interface AuditRow {
  id: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  organizationId: string | null;
  projectId: string | null;
  createdAt: string;
  ip: string | null;
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  // Phase 3c: filter state
  const [filterOrgId, setFilterOrgId] = useState("");
  const [filterProjectId, setFilterProjectId] = useState("");
  const [filterAction, setFilterAction] = useState("");

  const load = useCallback(async () => {
    // Clearing the error here is load-bearing: it was previously only ever
    // set, so a single transient failure pinned the banner on screen for the
    // rest of the session even after a successful refetch.
    setError(null);
    setBusy(true);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (filterOrgId.trim()) params.set("orgId", filterOrgId.trim());
      if (filterProjectId.trim()) params.set("projectId", filterProjectId.trim());
      if (filterAction.trim()) params.set("action", filterAction.trim());
      const res = await fetch(`/api/admin/audit-log?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: AuditRow[] };
      setRows(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setBusy(false);
    }
  }, [filterOrgId, filterProjectId, filterAction]);

  // Debounced: `load` is keyed on the three filter strings, so without this
  // every keystroke fired a fresh LIMIT 200 query against the audit table.
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(t);
  }, [load]);

  return (
    <div style={{ maxWidth: 960 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 6px" }}>Audit log</h1>
      <p style={{ color: "var(--ink-3)", fontSize: 13, margin: "0 0 18px" }}>
        Append-only record of admin-visible mutations. Most recent 200 entries.
      </p>

      {/* Phase 3c: filter controls */}
      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {/* Placeholders are not accessible names — they vanish on input and
            several screen readers skip them entirely. */}
        <input
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          placeholder="Filter by action…"
          aria-label="Filter by action"
          style={filterInputStyle}
        />
        <input
          value={filterOrgId}
          onChange={(e) => setFilterOrgId(e.target.value)}
          placeholder="Filter by org ID…"
          aria-label="Filter by organization ID"
          style={filterInputStyle}
        />
        <input
          value={filterProjectId}
          onChange={(e) => setFilterProjectId(e.target.value)}
          placeholder="Filter by project ID…"
          aria-label="Filter by project ID"
          style={filterInputStyle}
        />
        {(filterOrgId || filterProjectId || filterAction) && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 11 }}
            onClick={() => {
              setFilterOrgId("");
              setFilterProjectId("");
              setFilterAction("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="row"
          style={{
            gap: 10,
            color: "var(--bad)",
            fontSize: 13,
            marginBottom: 12,
            padding: "8px 10px",
            border: "1px solid var(--line)",
            borderRadius: 6,
          }}
        >
          <span>Couldn&rsquo;t load the audit log — {error}</span>
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {/* overflow-x, not hidden: six columns of IDs and IPs cannot fit a
          375px viewport, and `hidden` silently clipped them. */}
      <div
        className="scroll"
        style={{
          border: "1px solid var(--line)",
          borderRadius: 8,
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <caption className="sr-only">
            Admin audit log — most recent 200 entries, newest first
          </caption>
          <thead>
            <tr style={{ background: "var(--bg-elev-1)", color: "var(--ink-3)" }}>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Target</Th>
              <Th>Org / Project</Th>
              <Th>IP</Th>
            </tr>
          </thead>
          <tbody>
            {busy &&
              rows === null &&
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`} style={{ borderTop: "1px solid var(--line)" }}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <Td key={j}>
                      <span className="skeleton-bar" />
                    </Td>
                  ))}
                </tr>
              ))}
            {rows?.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                <Td mono>{new Date(r.createdAt).toISOString().replace("T", " ").slice(0, 19)}</Td>
                <Td mono>{r.actorUserId ? r.actorUserId.slice(0, 10) : "system"}</Td>
                <Td>
                  <code style={{ color: "var(--ink)", fontSize: 11 }}>{r.action}</code>
                </Td>
                <Td mono>
                  {r.targetType ? (
                    <>
                      {r.targetType}:{r.targetId?.slice(0, 10)}
                    </>
                  ) : (
                    <span style={{ color: "var(--ink-4)" }}>—</span>
                  )}
                </Td>
                <Td mono>
                  {r.organizationId || r.projectId ? (
                    <span style={{ fontSize: 10 }}>
                      {r.organizationId ? `org:${r.organizationId.slice(0, 8)}` : ""}
                      {r.organizationId && r.projectId ? " · " : ""}
                      {r.projectId ? `proj:${r.projectId.slice(0, 8)}` : ""}
                    </span>
                  ) : (
                    <span style={{ color: "var(--ink-4)" }}>—</span>
                  )}
                </Td>
                <Td mono>{r.ip ?? <span style={{ color: "var(--ink-4)" }}>—</span>}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows && rows.length === 0 && (
        <div style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 12 }}>
          {filterAction || filterOrgId || filterProjectId ? (
            <>
              No entries match these filters.{" "}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setFilterOrgId("");
                  setFilterProjectId("");
                  setFilterAction("");
                }}
              >
                Clear filters
              </button>
            </>
          ) : (
            "No audit entries yet — admin mutations will appear here as they happen."
          )}
        </div>
      )}
    </div>
  );
}

const filterInputStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 13,
  background: "var(--bg)",
  border: "1px solid var(--line)",
  borderRadius: 4,
  color: "var(--ink)",
  fontFamily: "inherit",
  width: 180,
};

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      style={{
        padding: "8px 12px",
        textAlign: "left",
        fontWeight: 500,
        fontSize: 12,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      style={{
        padding: "8px 12px",
        fontFamily: mono ? "var(--font-mono)" : undefined,
      }}
    >
      {children}
    </td>
  );
}
