"use client";

import { useEffect, useState } from "react";

export interface AggregatedKnowledgeView {
  id: string;
  type: string;
  triggerText: string;
  ruleText: string;
  hitCount: number;
  lastAppliedAt: string;
}

export interface ProjectDetailView {
  project: {
    id: string;
    slug: string;
    name: string;
    organizationId: string;
    framework: string | null;
    language: string | null;
    createdAt: string;
  };
  injected: AggregatedKnowledgeView[];
  extracted: AggregatedKnowledgeView[];
  totals: {
    sessionCount: number;
    injectedCount: number;
    extractedCount: number;
  };
}

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * Fetches /api/projects/:id when projectId is non-null. Mirrors
 * useSessionDetail — no SWR cache, fetched on demand when a project
 * row expands, because clicking around projects is rare enough that
 * stale-while-revalidate would be over-engineering.
 */
export function useProjectDetail(projectId: string | null): {
  data: ProjectDetailView | null;
  loadState: LoadState;
  error: string | null;
} {
  const [data, setData] = useState<ProjectDetailView | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setData(null);
      setLoadState("idle");
      setError(null);
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    setError(null);
    fetch(`/api/projects/${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<ProjectDetailView>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoadState("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setLoadState("error");
        setError(e instanceof Error ? e.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { data, loadState, error };
}
