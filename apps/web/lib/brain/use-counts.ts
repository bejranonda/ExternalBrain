"use client";

import { useEffect, useState } from "react";

export interface AppCounts {
  skills: number;
  proposals: number;
  sessionsAllTime: number;
  sessionsWeek: number;
  loaded: boolean;
}

const INITIAL: AppCounts = {
  skills: 0,
  proposals: 0,
  sessionsAllTime: 0,
  sessionsWeek: 0,
  loaded: false,
};

/**
 * Lightweight poll of the dashboard + knowledge + proposals endpoints to
 * populate counts used by the rail, bottom nav, topbar, etc. Fetches once
 * on mount; a future revalidation strategy can replace this with SWR or
 * event-driven refresh when write paths land.
 */
export function useCounts(): AppCounts & { refresh(): Promise<void> } {
  const [counts, setCounts] = useState<AppCounts>(INITIAL);

  // Audit FE2 (#103): the polling timer plus the on-mount fetch race each
  // other; a slow first fetch landing AFTER an unmount or after a faster
  // re-fetch overwrites fresh state with stale numbers. AbortController
  // cancels the in-flight call when the timer fires the next round and
  // when the component unmounts.
  const refresh = async (signal?: AbortSignal): Promise<void> => {
    try {
      const init: RequestInit = signal ? { cache: "no-store", signal } : { cache: "no-store" };
      const [dashRes, knowledgeRes, proposalsRes] = await Promise.all([
        fetch("/api/dashboard", init),
        fetch("/api/knowledge?limit=1", init),
        fetch("/api/autoskill/proposals?status=pending&limit=1", init),
      ]);
      const dash = dashRes.ok
        ? ((await dashRes.json()) as {
            stats?: {
              activeKnowledge?: number;
              pendingProposals?: number;
              sessionsAllTime?: number;
              sessionsWeek?: number;
            };
          })
        : null;
      const k = knowledgeRes.ok
        ? ((await knowledgeRes.json()) as { total?: number })
        : null;
      const p = proposalsRes.ok
        ? ((await proposalsRes.json()) as { total?: number })
        : null;

      if (signal?.aborted) return;
      setCounts({
        skills: dash?.stats?.activeKnowledge ?? k?.total ?? 0,
        proposals: dash?.stats?.pendingProposals ?? p?.total ?? 0,
        sessionsAllTime: dash?.stats?.sessionsAllTime ?? 0,
        sessionsWeek: dash?.stats?.sessionsWeek ?? 0,
        loaded: true,
      });
    } catch {
      if (signal?.aborted) return;
      setCounts({ ...INITIAL, loaded: true });
    }
  };

  useEffect(() => {
    let ctrl = new AbortController();
    void refresh(ctrl.signal);
    const id = window.setInterval(() => {
      ctrl.abort();
      ctrl = new AbortController();
      void refresh(ctrl.signal);
    }, 30_000);
    return () => {
      ctrl.abort();
      window.clearInterval(id);
    };
  }, []);

  return { ...counts, refresh: () => refresh() };
}
