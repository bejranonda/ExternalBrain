"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectScopeKey } from "@/lib/brain/use-project-scope";

interface OrgProject {
  id: string;
  name: string;
  slug: string;
}

interface OrgData {
  id: string;
  slug: string;
  // Friendly org name from `/api/orgs`. Used for the human-readable
  // scope label — falls back to slug only when name is missing.
  name?: string;
  projects: OrgProject[];
}

interface OrgsResponse {
  orgs: OrgData[];
  activeProjectId: string | null;
}

interface ScopePillProps {
  scope: ProjectScopeKey;
  onScopeChange: (next: ProjectScopeKey) => void;
}

/**
 * ScopePill — compact inline scope toggle for data-fetch surfaces.
 *
 * Renders:
 *   [● this project] [○ all my projects]
 *
 * Auto-hides when the user has exactly 1 org × 1 project (same rule as the
 * OrgProjectSwitcher) — solo users never see multi-project UI.
 */
export function ScopePill({ scope, onScopeChange }: ScopePillProps) {
  const [data, setData] = useState<OrgsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const hasFetched = useRef(false);

  const load = useCallback(async () => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    try {
      const res = await fetch("/api/orgs", { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as OrgsResponse;
      setData(d);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // AUTO-HIDE: solo user with 1 org × 1 project
  if (!loading && data) {
    const totalProjects = data.orgs.reduce((n, o) => n + o.projects.length, 0);
    if (data.orgs.length === 1 && totalProjects <= 1) {
      return null;
    }
  }

  // Not enough data yet to know — render nothing while loading to avoid flash
  if (loading || !data) return null;

  const btnStyle = (active: boolean): React.CSSProperties => ({
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 4,
    border: "1px solid var(--line)",
    cursor: "pointer",
    background: active ? "var(--accent-wash)" : "transparent",
    color: active ? "var(--accent-text)" : "var(--ink-3)",
    fontFamily: "inherit",
  });

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
      aria-label="Data scope"
    >
      <div style={{ display: "flex", gap: 4 }}>
        <button
          type="button"
          style={btnStyle(scope === "project")}
          onClick={() => onScopeChange("project")}
          aria-pressed={scope === "project"}
        >
          {scope === "project" ? "●" : "○"} this project
        </button>
        <button
          type="button"
          style={btnStyle(scope === "all")}
          onClick={() => onScopeChange("all")}
          aria-pressed={scope === "all"}
        >
          {scope === "all" ? "●" : "○"} all my projects
        </button>
      </div>
    </div>
  );
}
