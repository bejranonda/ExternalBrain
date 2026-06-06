"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { appendScopeParam } from "./use-project-scope";
import type { ProjectScopeKey } from "./use-project-scope";
import type {
  GraphEdgeView,
  GraphNodeView,
  GraphPayload,
} from "@/app/api/graph/route";

type LoadState = "loading" | "ready" | "error";

export interface LaidOutNode extends GraphNodeView {
  x: number; // 0-1
  y: number; // 0-1
  r: number;
}

interface State {
  nodes: LaidOutNode[];
  edges: GraphEdgeView[];
  loadState: LoadState;
  error?: string;
}

export function useGraph(scope: ProjectScopeKey = "project"): State & { refresh(): Promise<void> } {
  const [state, setState] = useState<State>({
    nodes: [],
    edges: [],
    loadState: "loading",
  });

  // Audit FE2 (#103): AbortController on the scope-driven fetch. Without
  // it, toggling scope quickly raced N parallel responses; the slowest
  // (stale) one could overwrite the freshest result. Same pattern as
  // use-knowledge.ts shipped in PR #151.
  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const url = appendScopeParam("/api/graph", scope);
        const res = await fetch(
          url,
          signal ? { cache: "no-store", signal } : { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as GraphPayload;
        if (signal?.aborted) return;
        setState({
          nodes: layout(data.nodes, data.edges),
          edges: data.edges,
          loadState: "ready",
        });
      } catch (err) {
        if (signal?.aborted) return;
        setState({
          nodes: [],
          edges: [],
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

  return { ...state, refresh: () => refresh() };
}

/**
 * Simple deterministic layout: ring by type, jittered.
 * We pre-place nodes so the svg renders predictably; a real force layout can come later.
 */
function layout(nodes: GraphNodeView[], edges: GraphEdgeView[]): LaidOutNode[] {
  if (nodes.length === 0) return [];
  // Ring radii are capped at 0.40 so that x = 0.5 ± r stays within [0.10, 0.90]
  // (and y within [0.20, 0.80]). The previous outer ring (0.75) pushed nodes
  // past the [0,1] viewBox and into the corner gutters, where the floating
  // search / legend / zoom panels (z-index 2, opaque) silently occluded them.
  const typeRings: Record<GraphNodeView["type"], number> = {
    principle: 0.08,
    heuristic: 0.16,
    recipe: 0.24,
    reflex: 0.32,
    anti: 0.4,
  };
  const byType = new Map<string, GraphNodeView[]>();
  for (const n of nodes) {
    const arr = byType.get(n.type) ?? [];
    arr.push(n);
    byType.set(n.type, arr);
  }
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const out: LaidOutNode[] = [];
  for (const [type, group] of byType) {
    const r = typeRings[type as GraphNodeView["type"]] ?? 0.5;
    const count = group.length;
    group.forEach((n, i) => {
      const angle = (i / Math.max(count, 1)) * Math.PI * 2;
      const x = 0.5 + Math.cos(angle) * r;
      const y = 0.5 + Math.sin(angle) * r * 0.75;
      const deg = degree.get(n.id) ?? 0;
      out.push({ ...n, x, y, r: Math.max(4, Math.min(14, 4 + deg * 0.8)) });
    });
  }
  return out;
}

export function useGraphFilter(nodes: LaidOutNode[], query: string): LaidOutNode[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return nodes;
    return nodes.filter(
      (n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q),
    );
  }, [nodes, query]);
}
