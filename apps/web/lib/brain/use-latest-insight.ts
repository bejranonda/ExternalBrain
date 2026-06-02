"use client";

import { useEffect, useState } from "react";

export interface LatestInsightView {
  id: string;
  type: string;
  ruleText: string;
  createdAt: string;
}

type LoadState = "idle" | "loading" | "ready" | "error";

/**
 * Fetches the most recently extracted knowledge row for the current scope.
 * Returns null when:
 *   - the response has no rows, OR
 *   - the newest row is older than 14 days (earned surface area — the
 *     latest insight stops being "latest" eventually).
 *
 * The 14-day window matches the dashboard's "this week" framing — if
 * nothing has been extracted in two weeks, the surface should disappear
 * rather than show stale praise.
 */
export function useLatestInsight(): {
  data: LatestInsightView | null;
  loadState: LoadState;
} {
  const [data, setData] = useState<LatestInsightView | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    fetch("/api/knowledge?sort=recent&limit=1", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{
          items: Array<{
            id: string;
            type: string;
            body: string;
            createdAt: string;
          }>;
        }>;
      })
      .then((body) => {
        if (cancelled) return;
        const row = body.items[0];
        if (!row) {
          setData(null);
          setLoadState("ready");
          return;
        }
        const ageMs = Date.now() - Date.parse(row.createdAt);
        const fourteenDays = 14 * 24 * 60 * 60 * 1000;
        if (Number.isNaN(ageMs) || ageMs > fourteenDays) {
          setData(null);
          setLoadState("ready");
          return;
        }
        setData({
          id: row.id,
          type: row.type,
          ruleText: row.body,
          createdAt: row.createdAt,
        });
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loadState };
}
