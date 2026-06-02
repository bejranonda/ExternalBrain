"use client";

import { useEffect, useState } from "react";
import { useLatestInsight } from "./use-latest-insight";

const STORAGE_KEY = "brain-last-seen-extraction";

/**
 * Returns the number of extractions newer than the last time the user
 * viewed the dashboard. Reads from useLatestInsight + a localStorage
 * timestamp.
 *
 * v1 simplification: only knows about the LATEST extraction, not a true
 * count of new ones since last visit. True count would require a new
 * API endpoint. For the toast this is fine — it surfaces "Brain learned
 * something new" with the latest preview, not "Brain learned 5 things".
 *
 * On dismiss(): writes the current latest createdAt to localStorage and
 * sets count to 0, so the toast doesn't re-fire on next mount.
 */
export function useNewExtractions(): {
  count: number;
  latestRuleText: string | null;
  latestCreatedAt: string | null;
  dismiss: () => void;
} {
  const { data: latest, loadState } = useLatestInsight();
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  // Read seenAt only after mount (avoids SSR mismatch).
  const [seenAt, setSeenAt] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setSeenAt(window.localStorage.getItem(STORAGE_KEY));
    }
  }, []);

  if (loadState !== "ready" || !latest) {
    return { count: 0, latestRuleText: null, latestCreatedAt: null, dismiss: () => {} };
  }

  const effectiveSeen = dismissedAt ?? seenAt;
  const isNew = !effectiveSeen || latest.createdAt > effectiveSeen;

  return {
    count: isNew ? 1 : 0,
    latestRuleText: isNew ? latest.ruleText : null,
    latestCreatedAt: latest.createdAt,
    dismiss: () => {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, latest.createdAt);
      }
      setDismissedAt(latest.createdAt);
    },
  };
}
