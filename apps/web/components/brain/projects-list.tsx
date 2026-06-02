"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { ProjectDetailPanel } from "./project-detail-panel";
import { ValueChip } from "./value-chip";

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
}

interface ProjectTotals {
  sessionCount: number;
  injectedCount: number;
  extractedCount: number;
}

interface OrgsResponse {
  orgs: Array<{
    id: string;
    slug: string;
    name: string;
    projects: ProjectRow[];
  }>;
  activeProjectId: string | null;
}

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * Dashboard ProjectsList — lists every project the user can see, with
 * an inline ProjectDetailPanel that expands on click.
 *
 * Earned surface area: this component renders nothing when the user
 * has zero projects. With exactly one project it collapses to a single
 * row (no list affordance — there is no list to scroll). With ≥2 it
 * shows the full list. Either way, click-to-expand reveals what the
 * brain has done for / learned from each project.
 */
export function ProjectsList() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [totals, setTotals] = useState<Map<string, ProjectTotals | null>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    fetch("/api/orgs", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as OrgsResponse;
      })
      .then(async (data) => {
        const flat: ProjectRow[] = [];
        for (const o of data.orgs) {
          for (const p of o.projects) flat.push(p);
        }
        const totalsByProject = await Promise.all(
          flat.map(async (p): Promise<readonly [string, ProjectTotals | null]> => {
            try {
              const r = await fetch(`/api/projects/${encodeURIComponent(p.id)}`, { cache: "no-store" });
              if (!r.ok) return [p.id, null] as const;
              const body = (await r.json()) as { totals: ProjectTotals };
              return [p.id, body.totals] as const;
            } catch {
              return [p.id, null] as const;
            }
          }),
        );
        if (cancelled) return;
        const totalsMap = new Map(totalsByProject);
        // Earned surface area: hide projects with 0 sessions on the dashboard.
        // If totals failed to load (t === null) we err toward showing the row
        // — better to overcount than to hide a project the user has used.
        const visible = flat.filter((p) => {
          const t = totalsMap.get(p.id);
          return t == null || t.sessionCount > 0;
        });
        setProjects(visible);
        setTotals(totalsMap);
        setActiveId(data.activeProjectId);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadState === "loading" || loadState === "idle") {
    return (
      <div className="panel" style={{ padding: 16, fontSize: 13, color: "var(--ink-3)" }}>
        Loading projects…
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div
        className="panel"
        role="alert"
        style={{ padding: 16, fontSize: 13, color: "var(--bad)" }}
      >
        Could not load your projects.
      </div>
    );
  }

  if (projects.length === 0) {
    // Earned surface area: nothing to show, render nothing at all
    // (no "no projects yet" placeholder — the section header just
    // disappears with us).
    return null;
  }

  if (projects.length === 1) {
    const only = projects[0]!;
    // Single-project users get a compact one-line treatment plus the
    // value drill-down behind a click. A list of 1 is not a list.
    return (
      <div className="panel">
        <ProjectRowButton
          row={only}
          totals={totals.get(only.id) ?? null}
          isActive={only.id === activeId}
          expanded={expandedId === only.id}
          onToggle={() =>
            setExpandedId((cur) => (cur === only.id ? null : only.id))
          }
        />
        {expandedId === only.id && <ProjectDetailPanel projectId={only.id} />}
      </div>
    );
  }

  return (
    <div className="panel">
      {projects.map((p) => (
        <div key={p.id}>
          <ProjectRowButton
            row={p}
            totals={totals.get(p.id) ?? null}
            isActive={p.id === activeId}
            expanded={expandedId === p.id}
            onToggle={() =>
              setExpandedId((cur) => (cur === p.id ? null : p.id))
            }
          />
          {expandedId === p.id && <ProjectDetailPanel projectId={p.id} />}
        </div>
      ))}
    </div>
  );
}

function ProjectRowButton({
  row,
  totals,
  isActive,
  expanded,
  onToggle,
}: {
  row: ProjectRow;
  totals: ProjectTotals | null;
  isActive: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      className="row"
      style={{
        padding: "12px 16px",
        fontSize: 14,
        borderBottom: "1px solid var(--line-soft)",
        cursor: "pointer",
        background: expanded ? "var(--bg-elev-1)" : undefined,
        alignItems: "center",
        gap: 10,
      }}
      title="Click to see what the Brain has done for this project and learned from it"
    >
      <span style={{ width: 16, color: "var(--ink-3)" }}>
        <Icon name={expanded ? "chevD" : "chevR"} size={11} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: "var(--ink)" }}>{row.name}</span>
        {isActive && (
          <span
            className="mono"
            style={{
              marginLeft: 8,
              fontSize: 10,
              color: "var(--accent-text)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            active
          </span>
        )}
      </span>
      {totals && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12, marginRight: 12 }}>
          <ValueChip
            injected={totals.injectedCount}
            extracted={totals.extractedCount}
            variant="row-preview"
          />
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
            {totals.sessionCount} session{totals.sessionCount === 1 ? "" : "s"}
          </span>
        </span>
      )}
      <span
        className="mono"
        style={{ fontSize: 11, color: "var(--ink-4)" }}
      >
        {row.slug}
      </span>
    </div>
  );
}
