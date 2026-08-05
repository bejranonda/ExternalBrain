"use client";

import { useCallback, useEffect, useState } from "react";
import { appendScopeParam } from "./use-project-scope";
import type { ProjectScopeKey } from "./use-project-scope";
import type { ProposalView } from "./views";

export type { ProposalView };

type LoadState = "loading" | "ready" | "error";

interface State {
  proposals: ProposalView[];
  loadState: LoadState;
  error?: string;
}

export function useAutoskillProposals(
  scope: ProjectScopeKey = "project",
): State & {
  apply(id: string): Promise<void>;
  reject(id: string): Promise<void>;
  unreject(id: string): Promise<void>;
  refresh(): Promise<void>;
} {
  const [state, setState] = useState<State>({
    proposals: [],
    loadState: "loading",
  });

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setState((s) => ({ ...s, loadState: s.proposals.length ? s.loadState : "loading" }));
      try {
        const url = appendScopeParam("/api/autoskill/proposals?status=pending", scope);
        const res = await fetch(url, signal ? { cache: "no-store", signal } : { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { proposals: ProposalView[] };
        if (signal?.aborted) return;
        setState({ proposals: data.proposals, loadState: "ready" });
      } catch (err) {
        if (signal?.aborted) return;
        setState({
          proposals: [],
          loadState: "error",
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    },
    [scope],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void refresh(ctrl.signal);
    return () => ctrl.abort();
  }, [refresh]);

  const act = useCallback(
    async (id: string, action: "apply" | "reject" | "unreject") => {
      // "unreject" restores a row, so there is nothing to optimistically
      // remove — refresh() below pulls it back into the pending list.
      if (action !== "unreject") {
        setState((s) => ({
          ...s,
          proposals: s.proposals.filter((p) => p.id !== id),
        }));
      }
      try {
        const res = await fetch(`/api/autoskill/proposals/${id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (action === "unreject") await refresh();
      } catch (err) {
        await refresh();
        throw err;
      }
    },
    [refresh],
  );

  return {
    ...state,
    apply: (id) => act(id, "apply"),
    reject: (id) => act(id, "reject"),
    unreject: (id) => act(id, "unreject"),
    refresh: () => refresh(),
  };
}
