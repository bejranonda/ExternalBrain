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
  // Phase 3c: filter state
  const [filterOrgId, setFilterOrgId] = useState("");
  const [filterProjectId, setFilterProjectId] = useState("");
  const [filterAction, setFilterAction] = useState("");

  const load = useCallback(async () => {
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
    }
  }, [filterOrgId, filterProjectId, filterAction]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ maxWidth: 960 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 6px" }}>Audit log</h1>
      <p style={{ color: "var(--ink-3)", fontSize: 13, margin: "0 0 18px" }}>
        Append-only record of admin-visible mutations. Most recent 200 entries.
      </p>

      {/* Phase 3c: filter controls */}
      <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          placeholder="Filter by action…"
          style={filterInputStyle}
        />
        <input
          value={filterOrgId}
          onChange={(e) => setFilterOrgId(e.target.value)}
          placeholder="Filter by org ID…"
          style={filterInputStyle}
        />
        <input
          value={filterProjectId}
          onChange={(e) => setFilterProjectId(e.target.value)}
          placeholder="Filter by project ID…"
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
        <div role="alert" style={{ color: "var(--warn)", fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
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
          No audit entries yet.
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
      style={{
        padding: "8px 12px",
        textAlign: "left",
        fontWeight: 500,
        fontSize: 12,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
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
