"use client";

/**
 * /settings/audit — read-only org-scoped audit log for org owners and admins.
 *
 * Uses GET /api/orgs/:orgId/audit-log (org-member auth, not platform-admin).
 * Shows the same table shape as /admin/audit but pre-filtered to the active org.
 */

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

interface OrgData {
  id: string;
  name: string;
  role: string;
}

export default function SettingsAuditPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string>("");
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useState("");

  // Resolve the active org (first one where role = owner or admin)
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/orgs", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          orgs: OrgData[];
        };
        const manageable = data.orgs.find(
          (o) => o.role === "owner" || o.role === "admin",
        );
        if (manageable) {
          setOrgId(manageable.id);
          setOrgName(manageable.name);
        } else {
          setError("You are not an owner or admin of any organization.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "load failed");
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (filterAction.trim()) params.set("action", filterAction.trim());
      const res = await fetch(`/api/orgs/${orgId}/audit-log?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: AuditRow[] };
      setRows(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, [orgId, filterAction]);

  useEffect(() => {
    if (orgId) void load();
  }, [load, orgId]);

  return (
    <main
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "48px 24px 96px",
        color: "var(--ink)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ marginTop: 18, marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0, letterSpacing: "-0.02em" }}>
          Audit log
        </h1>
        {orgName && (
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "4px 0 0" }}>
            Showing entries for <strong>{orgName}</strong> — most recent 100.
          </p>
        )}
      </div>

      {error && (
        error.includes("not an owner or admin") ? (
          <div
            role="alert"
            className="panel"
            style={{
              padding: "24px 22px",
              marginTop: 18,
              textAlign: "center",
              maxWidth: 520,
              marginInline: "auto",
            }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 500 }}>
              Admins only
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55 }}>
              The audit log shows org-level activity (member changes, token
              actions, knowledge resets) and is restricted to org owners and
              admins. Ask your org owner if you need access.
            </p>
          </div>
        ) : (
          <div role="alert" style={{ color: "var(--warn)", fontSize: 13, margin: "12px 0" }}>
            {error}
          </div>
        )
      )}

      {!error && (
        <>
          {/* Filter bar */}
          <div className="row" style={{ gap: 8, marginBottom: 16, marginTop: 18, flexWrap: "wrap" }}>
            <input
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              placeholder="Filter by action…"
              style={filterInputStyle}
            />
            {filterAction && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 11 }}
                onClick={() => setFilterAction("")}
              >
                Clear
              </button>
            )}
          </div>

          <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--bg-elev-1)", color: "var(--ink-3)" }}>
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th>Target</Th>
                  <Th>Project</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <Td mono>
                      {new Date(r.createdAt).toISOString().replace("T", " ").slice(0, 19)}
                    </Td>
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
                      {r.projectId ? (
                        <span style={{ fontSize: 10 }}>proj:{r.projectId.slice(0, 8)}</span>
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
          {!rows && !error && (
            <div style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 12 }}>Loading…</div>
          )}
          {rows && rows.length === 0 && (
            <div style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 12 }}>
              No audit entries for this org yet.
            </div>
          )}
        </>
      )}
    </main>
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
  width: 220,
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
