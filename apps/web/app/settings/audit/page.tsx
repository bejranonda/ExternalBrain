"use client";

/**
 * /settings/audit — read-only org-scoped audit log for org owners and admins.
 *
 * Uses GET /api/orgs/:orgId/audit-log (org-member auth, not platform-admin).
 * Shows the same table shape as /admin/audit but pre-filtered to the active org.
 */

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/brain/i18n";
import { caughtMessage, throwApiError } from "@/lib/brain/api-error";
import { rich } from "@/lib/brain/rich-text";

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
  const t = useT();
  const [notAdmin, setNotAdmin] = useState(false);
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
        if (!res.ok) await throwApiError(t, res);
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
          setNotAdmin(true);
        }
      } catch (e) {
        setError(caughtMessage(t, e));
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
      if (!res.ok) await throwApiError(t, res);
      const data = (await res.json()) as { entries: AuditRow[] };
      setRows(data.entries);
    } catch (e) {
      setError(caughtMessage(t, e));
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
          {t("audit.title")}
        </h1>
        {orgName && (
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "4px 0 0" }}>
            {rich(t("audit.showing"), { org: <strong>{orgName}</strong> })}
          </p>
        )}
      </div>

      {notAdmin ? (
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
              {t("audit.admins_only")}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55 }}>
              {t("audit.admins_only_body")}
            </p>
          </div>
      ) : error ? (
        <div role="alert" style={{ color: "var(--warn)", fontSize: 13, margin: "12px 0" }}>
          {error}
        </div>
      ) : null}

      {!error && !notAdmin && (
        <>
          {/* Filter bar */}
          <div className="row" style={{ gap: 8, marginBottom: 16, marginTop: 18, flexWrap: "wrap" }}>
            <input
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              placeholder={t("audit.filter_placeholder")}
              aria-label={t("audit.filter_placeholder")}
              style={filterInputStyle}
            />
            {filterAction && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 11 }}
                onClick={() => setFilterAction("")}
              >
                {t("audit.clear")}
              </button>
            )}
          </div>

          <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--bg-elev-1)", color: "var(--ink-3)" }}>
                  <Th>{t("audit.col_when")}</Th>
                  <Th>{t("audit.col_actor")}</Th>
                  <Th>{t("audit.col_action")}</Th>
                  <Th>{t("audit.col_target")}</Th>
                  <Th>{t("common.project")}</Th>
                  <Th>{t("audit.col_ip")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <Td mono>
                      {new Date(r.createdAt).toISOString().replace("T", " ").slice(0, 19)}
                    </Td>
                    <Td mono>{r.actorUserId ? r.actorUserId.slice(0, 10) : t("audit.system")}</Td>
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
            <div style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 12 }}>{t("common.loading")}</div>
          )}
          {rows && rows.length === 0 && (
            <div style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 12 }}>
              {t("audit.empty")}
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
