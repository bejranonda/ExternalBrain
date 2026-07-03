"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/brain/i18n";
import type { LoopHealthPayload } from "@/app/api/dashboard/health/route";

function pct(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function fmtRate(part: number, whole: number): string {
  const r = pct(part, whole);
  return r === null ? "—" : `${Math.round(r * 100)}% (${part}/${whole})`;
}

/**
 * Loop health — the four vitals of the knowledge flywheel (flywheel-repair
 * spec §4.2): capture alive? retrieval helping? corpus validated? identity
 * fragmenting? Lives behind the Show-everything fold next to the existing
 * Brain-health panel; plain-English row labels, precise mechanics in hover
 * tooltips, matching the KnowledgeHealth convention.
 */
export function LoopHealthCard() {
  const t = useT();
  const [data, setData] = useState<LoopHealthPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/health", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<LoopHealthPayload>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const rows = data
    ? [
        {
          label: "Sessions closed with learnings",
          tooltip:
            "Of sessions opened in the window, how many were closed via brain_report_session_outcome with ≥1 learning. Stage-3 gate: ≥60%.",
          value: fmtRate(data.sessions.closedWithLearnings, data.sessions.opened),
          bar: pct(data.sessions.closedWithLearnings, data.sessions.opened),
          target: "≥ 60%",
        },
        {
          label: "Injected knowledge marked used",
          tooltip:
            "Of sessions that received injected knowledge at open, how many reported ≥1 item back as knowledgeUsed at close. Accrues from v1.13.0 onward. Stage-3 gate: ≥40%.",
          value: fmtRate(data.injection.usedSessions, data.injection.injectedSessions),
          bar: pct(data.injection.usedSessions, data.injection.injectedSessions),
          target: "≥ 40%",
        },
        {
          label: "Knowledge validated by outcomes",
          tooltip:
            "Active knowledge with at least one recorded success/failure outcome — the rest has never been confirmed useful.",
          value: fmtRate(data.knowledge.withOutcomes, data.knowledge.active),
          bar: pct(data.knowledge.withOutcomes, data.knowledge.active),
          target: "grow",
        },
        {
          label: "Duplicate project identities",
          tooltip:
            "Projects in one organization whose names normalize to the same identity — knowledge filed under a sibling is invisible to project-scoped retrieval. Fix: scripts/merge-duplicate-projects.sql.",
          value: String(data.duplicateProjects.length),
          bar: data.duplicateProjects.length > 0 ? 1 : 0,
          inv: true,
          target: "0",
        },
      ]
    : [];

  return (
    <div className="panel">
      <div className="panel-h">
        <h3>{t("dash.loop_health")}</h3>
        <span className="sub">{t("dash.loop_health_sub")}</span>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {failed && (
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("dash.loop_health_err")}</div>
        )}
        {!failed && !data && (
          <div style={{ fontSize: 13, color: "var(--ink-3)" }}>…</div>
        )}
        {rows.map((m) => (
          <div key={m.label}>
            <div className="row" style={{ marginBottom: 5 }}>
              <span style={{ fontSize: 13, color: "var(--ink-2)" }} title={m.tooltip}>
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
                  width: `${Math.min(100, (m.bar ?? 0) * 100)}%`,
                  height: "100%",
                  background: m.inv ? "var(--warn, #F5C451)" : "var(--accent)",
                  borderRadius: 2,
                }}
              />
            </div>
          </div>
        ))}
        {data && data.duplicateProjects.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {data.duplicateProjects.map((g) => (
              <div key={`${g.organizationId}:${g.normalizedName}`}>⚠ {g.names.join(" · ")}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
