"use client";

import { useEffect, useState } from "react";
import { appendScopeParam } from "./use-project-scope";
import type { ProjectScopeKey } from "./use-project-scope";
import type { LivePayload } from "@/app/api/dashboard/live/route";

type LoadState = "loading" | "ready" | "error" | "empty";

interface State {
  payload: LivePayload | null;
  loadState: LoadState;
  error?: string;
}

export function useLiveExtraction(scope: ProjectScopeKey = "project"): State {
  const [state, setState] = useState<State>({ payload: null, loadState: "loading" });

  useEffect(() => {
    // Audit FE2 (#103): the 15s polling timer plus the on-mount fetch race.
    // AbortController on each round cancels in-flight requests when the
    // next tick fires or the component unmounts.
    let ctrl = new AbortController();
    const load = async (signal: AbortSignal) => {
      try {
        const url = appendScopeParam("/api/dashboard/live", scope);
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as LivePayload;
        if (signal.aborted) return;
        setState({
          payload: data,
          loadState: data.session ? "ready" : "empty",
        });
      } catch (err) {
        if (signal.aborted) return;
        setState({
          payload: null,
          loadState: "error",
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    };
    void load(ctrl.signal);
    const id = window.setInterval(() => {
      ctrl.abort();
      ctrl = new AbortController();
      void load(ctrl.signal);
    }, 15_000);
    return () => {
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [scope]);

  return state;
}
