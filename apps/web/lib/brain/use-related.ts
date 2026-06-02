"use client";

import { useEffect, useState } from "react";
import type { RelatedNodeView } from "@/app/api/knowledge/[id]/related/route";

interface State {
  items: RelatedNodeView[];
  loadState: "idle" | "loading" | "ready" | "error";
  error?: string;
}

export function useRelated(id: string | null): State {
  const [state, setState] = useState<State>({ items: [], loadState: "idle" });

  useEffect(() => {
    if (!id) {
      setState({ items: [], loadState: "idle" });
      return;
    }
    // Audit FE2 (#103): AbortController on the id-driven fetch. Replaces
    // the prior cancelled-flag pattern, which set state-after-unmount but
    // still consumed bandwidth on a stale request.
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loadState: "loading" }));
    fetch(`/api/knowledge/${encodeURIComponent(id)}/related`, {
      cache: "no-store",
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { items: RelatedNodeView[] };
        if (ctrl.signal.aborted) return;
        setState({ items: data.items, loadState: "ready" });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({
          items: [],
          loadState: "error",
          error: err instanceof Error ? err.message : "fetch failed",
        });
      });
    return () => ctrl.abort();
  }, [id]);

  return state;
}
