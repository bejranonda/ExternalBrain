"use client";

import { useEffect, useState } from "react";

export interface AppliedKnowledgeView {
  id: string;
  type: string;
  triggerText: string;
  ruleText: string;
  appliedAt: string;
}

export interface SessionDetailView {
  session: {
    id: string;
    prompt: string | null;
    clientType: string;
    startedAt: string;
    endedAt: string | null;
    outcome: string | null;
    sqs: number | null;
    projectName: string | null;
    projectSlug: string | null;
  };
  injected: AppliedKnowledgeView[];
  extracted: AppliedKnowledgeView[];
}

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * Fetches /api/sessions/:id when `sessionId` is non-null. Returns null
 * when idle so callers can render a placeholder without a flicker. The
 * hook is intentionally minimal — no SWR cache — because session
 * details are inspected rarely and stale-while-revalidate is overkill.
 */
export function useSessionDetail(sessionId: string | null): {
  data: SessionDetailView | null;
  loadState: LoadState;
  error: string | null;
} {
  const [data, setData] = useState<SessionDetailView | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setData(null);
      setLoadState("idle");
      setError(null);
      return;
    }
    let cancelled = false;
    setLoadState("loading");
    setError(null);
    fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<SessionDetailView>;
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
  }, [sessionId]);

  return { data, loadState, error };
}
