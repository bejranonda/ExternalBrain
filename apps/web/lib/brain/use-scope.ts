"use client";

import { useCallback, useEffect, useState } from "react";

export type ScopeKey = "personal" | "team" | "community";

const STORAGE_KEY = "bp_scope";
const DEFAULT: ScopeKey = "personal";

function readInitial(): ScopeKey {
  if (typeof window === "undefined") return DEFAULT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "personal" || raw === "team" || raw === "community") return raw;
  return DEFAULT;
}

export function useScope(): [ScopeKey, (next: ScopeKey) => void] {
  const [scope, setScope] = useState<ScopeKey>(DEFAULT);

  useEffect(() => {
    setScope(readInitial());
  }, []);

  const set = useCallback((next: ScopeKey) => {
    setScope(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return [scope, set];
}
