"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectScopeKey } from "./use-project-scope";
import type { SessionView } from "./views";

type LoadState = "loading" | "ready" | "error";

export interface SessionFilter {
  outcome?: "accepted" | "partial" | "rejected";
  client?: "claude_code" | "cursor" | "windsurf" | "mcp" | "custom";
}

interface State {
  sessions: SessionView[];
  total: number;
  nextCursor: string | null;
  loadState: LoadState;
  error?: string;
}

export function useSessions(
  initialLimit = 50,
  scope: ProjectScopeKey = "project",
): State & {
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  setFilter(next: SessionFilter): void;
  filter: SessionFilter;
} {
  const [filter, setFilter] = useState<SessionFilter>({});
  const [state, setState] = useState<State>({
    sessions: [],
    total: 0,
    nextCursor: null,
    loadState: "loading",
  });

  // Audit FE2 (#103): AbortController on the scope-driven refresh —
  // toggling scope used to race two parallel responses; the slower
  // (stale) one would overwrite the fresh one on slow networks.
  const fetchPage = useCallback(
    async (cursor: string | null, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      params.set("limit", String(initialLimit));
      if (cursor) params.set("cursor", cursor);
      if (filter.outcome) params.set("outcome", filter.outcome);
      if (filter.client) params.set("client", filter.client);
      if (scope === "all") params.set("scope", "all");
      const res = await fetch(
        `/api/sessions?${params.toString()}`,
        signal ? { cache: "no-store", signal } : { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as {
        sessions: SessionView[];
        total: number;
        nextCursor: string | null;
      };
    },
    [filter, initialLimit, scope],
  );

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setState((s) => ({ ...s, loadState: s.sessions.length ? s.loadState : "loading" }));
      try {
        const data = await fetchPage(null, signal);
        if (signal?.aborted) return;
        setState({
          sessions: data.sessions,
          total: data.total,
          nextCursor: data.nextCursor,
          loadState: "ready",
        });
      } catch (err) {
        if (signal?.aborted) return;
        setState({
          sessions: [],
          total: 0,
          nextCursor: null,
          loadState: "error",
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void refresh(ctrl.signal);
    return () => ctrl.abort();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!state.nextCursor) return;
    try {
      const data = await fetchPage(state.nextCursor);
      setState((s) => ({
        ...s,
        sessions: [...s.sessions, ...data.sessions],
        total: data.total,
        nextCursor: data.nextCursor,
        loadState: "ready",
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : "load-more failed",
      }));
    }
  }, [fetchPage, state.nextCursor]);

  // Manual `refresh()` (toolbar button) — no signal, runs to completion.
  return { ...state, refresh: () => refresh(), loadMore, setFilter, filter };
}
