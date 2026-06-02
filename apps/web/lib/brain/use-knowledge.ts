"use client";

import { useCallback, useEffect, useState } from "react";
import { appendScopeParam } from "./use-project-scope";
import type { KnowledgeItemView } from "./views";
import type { ProjectScopeKey } from "./use-project-scope";

type LoadState = "loading" | "ready" | "error";

interface State {
  items: KnowledgeItemView[];
  loadState: LoadState;
  error?: string;
}

/**
 * Metadata patches only — Knowledge is semantically immutable
 * (KNOWLEDGE.md §5.1). To change trigger/rule/rationale, use `fork`.
 */
export interface KnowledgePatch {
  tags?: string[];
  scope?: "user" | "project" | "team" | "global" | "community";
  confidence?: number;
}

export function useKnowledge(
  scope: ProjectScopeKey = "project",
  visibilityFilter?: "private" | "project" | "org" | "all",
): State & {
  refresh(): Promise<void>;
  update(id: string, patch: KnowledgePatch): Promise<KnowledgeItemView>;
  remove(id: string): Promise<void>;
  fork(id: string, overrides?: { ruleText?: string }): Promise<KnowledgeItemView>;
  promote(id: string): Promise<KnowledgeItemView>;
  forkToProject(id: string, projectId?: string): Promise<KnowledgeItemView>;
} {
  const [state, setState] = useState<State>({ items: [], loadState: "loading" });

  // Audit FE2 (#103): AbortController on the scope-driven fetch.
  // Without it, toggling scope quickly raced N parallel responses;
  // the slowest (stale) one could overwrite the freshest result.
  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      setState((s) => ({ ...s, loadState: s.items.length ? s.loadState : "loading" }));
      try {
        let url = appendScopeParam("/api/knowledge?limit=200", scope);
        if (visibilityFilter && visibilityFilter !== "all") {
          url += `&visibility=${encodeURIComponent(visibilityFilter)}`;
        }
        const res = await fetch(url, signal ? { cache: "no-store", signal } : { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { items: KnowledgeItemView[] };
        if (signal?.aborted) return;
        setState({ items: data.items, loadState: "ready" });
      } catch (err) {
        if (signal?.aborted) return;
        setState({
          items: [],
          loadState: "error",
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    },
    [scope, visibilityFilter],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void refresh(ctrl.signal);
    return () => ctrl.abort();
  }, [refresh]);

  const update = useCallback(async (id: string, patch: KnowledgePatch) => {
    const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { item: KnowledgeItemView };
    setState((s) => ({
      ...s,
      items: s.items.map((i) => (i.id === id ? data.item : i)),
    }));
    return data.item;
  }, []);

  const remove = useCallback(async (id: string) => {
    const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
  }, []);

  const fork = useCallback(
    async (id: string, overrides: { ruleText?: string } = {}) => {
      const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "fork", overrides }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { item: KnowledgeItemView };
      setState((s) => ({ ...s, items: [data.item, ...s.items] }));
      return data.item;
    },
    [],
  );

  const promote = useCallback(async (id: string) => {
    const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}/promote`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { item: KnowledgeItemView };
    setState((s) => ({
      ...s,
      items: s.items.map((i) => (i.id === id ? data.item : i)),
    }));
    return data.item;
  }, []);

  const forkToProject = useCallback(async (id: string, projectId?: string) => {
    const res = await fetch(`/api/knowledge/${encodeURIComponent(id)}/fork-to-project`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(projectId ? { projectId } : {}),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { item: KnowledgeItemView };
    setState((s) => ({ ...s, items: [data.item, ...s.items] }));
    return data.item;
  }, []);

  // Public refresh() — toolbar Refresh button uses this; no signal.
  return { ...state, refresh: () => refresh(), update, remove, fork, promote, forkToProject };
}
