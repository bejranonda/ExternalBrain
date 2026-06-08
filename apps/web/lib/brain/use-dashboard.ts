"use client";

import { useCallback, useEffect, useState } from "react";
import { appendScopeParam } from "./use-project-scope";
import type { ProjectScopeKey } from "./use-project-scope";
import type { DashboardStats } from "./views";

type LoadState = "loading" | "ready" | "error" | "unauthorized";

export interface TypeCount {
  type: string;
  count: number;
}

interface State {
  stats: DashboardStats;
  typeCounts: TypeCount[];
  loadState: LoadState;
  error?: string;
}

const EMPTY_STATS: DashboardStats = {
  activeKnowledge: 0,
  sessionsAllTime: 0,
  sessionsWeek: 0,
  sqsCurrent: 0,
  sqsTrend: [],
  pendingProposals: 0,
  knowledgeHealth: 0,
  contradictions: 0,
  decayThisWeek: 0,
  bundleHitRate: 0,
};

export function useDashboardStats(
  scope: ProjectScopeKey = "project",
  // When false, skip the fetch entirely — used by /welcome for anonymous
  // visitors so the page doesn't fire an auth-failing GET /api/dashboard
  // (a 401 the browser logs to the console). #33. Defaults true so every
  // other caller is unaffected.
  enabled = true,
): State & { refresh(): Promise<void> } {
  const [state, setState] = useState<State>({
    stats: EMPTY_STATS,
    typeCounts: [],
    loadState: "loading",
  });

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      if (!enabled) return;
      try {
        const url = appendScopeParam("/api/dashboard", scope);
        const res = await fetch(
          url,
          signal ? { cache: "no-store", signal } : { cache: "no-store" },
        );
        if (res.status === 401) {
          if (signal?.aborted) return;
          setState({
            stats: EMPTY_STATS,
            typeCounts: [],
            loadState: "unauthorized",
          });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          stats: DashboardStats;
          typeCounts?: TypeCount[];
        };
        if (signal?.aborted) return;
        setState({
          stats: data.stats,
          typeCounts: data.typeCounts ?? [],
          loadState: "ready",
        });
      } catch (err) {
        if (signal?.aborted) return;
        setState({
          stats: EMPTY_STATS,
          typeCounts: [],
          loadState: "error",
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    },
    [scope, enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    void refresh(ctrl.signal);
    return () => ctrl.abort();
  }, [refresh, enabled]);

  return { ...state, refresh: () => refresh() };
}
