"use client";

import { useEffect, useState } from "react";
import type { ConnectionStatusPayload } from "@/app/api/dashboard/connection-status/route";

type LoadState = "loading" | "ready" | "error";

interface State {
  payload: ConnectionStatusPayload | null;
  loadState: LoadState;
  error?: string;
}

export function useConnectionStatus(pollMs = 10_000): State {
  const [state, setState] = useState<State>({ payload: null, loadState: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/dashboard/connection-status", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ConnectionStatusPayload;
        if (cancelled) return;
        setState({ payload: data, loadState: "ready" });
      } catch (err) {
        if (cancelled) return;
        setState({
          payload: null,
          loadState: "error",
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    };
    void load();
    const id = window.setInterval(load, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pollMs]);

  return state;
}
