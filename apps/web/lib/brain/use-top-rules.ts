"use client";

import { useCallback, useEffect, useState } from "react";
import { appendScopeParam } from "./use-project-scope";
import type { ProjectScopeKey } from "./use-project-scope";
import type { TopRuleRow } from "@brain/core";

type LoadState = "loading" | "ready" | "error";

interface State {
  rules: TopRuleRow[];
  loadState: LoadState;
  error?: string;
}

export type { TopRuleRow };

export function useTopRules(
  scope: ProjectScopeKey = "project",
  minOutcomes = 5,
): State & { refresh(): Promise<void> } {
  const [state, setState] = useState<State>({ rules: [], loadState: "loading" });

  // Audit FE2 (#103): AbortController on the scope/minOutcomes-driven fetch.
  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setState((s) => ({ ...s, loadState: s.rules.length ? s.loadState : "loading" }));
      try {
        const url = appendScopeParam(
          `/api/dashboard/top-rules?minOutcomes=${minOutcomes}`,
          scope,
        );
        const res = await fetch(
          url,
          signal ? { cache: "no-store", signal } : { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { rules: TopRuleRow[] };
        if (signal?.aborted) return;
        setState({ rules: data.rules, loadState: "ready" });
      } catch (err) {
        if (signal?.aborted) return;
        setState({
          rules: [],
          loadState: "error",
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    },
    [scope, minOutcomes],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void refresh(ctrl.signal);
    return () => ctrl.abort();
  }, [refresh]);

  return { ...state, refresh: () => refresh() };
}
