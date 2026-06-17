"use client";

import { useCallback, useEffect, useState } from "react";

export const ROUTES = [
  "dashboard",
  "oracle",
  "skills",
  "graph",
  "decisions",
  "autoskill",
  "sessions",
] as const;

export type Route = (typeof ROUTES)[number];

export const DEFAULT_ROUTE: Route = "dashboard";

export function isRoute(r: string): r is Route {
  return (ROUTES as readonly string[]).includes(r);
}

/** Number-key bindings 1..7 mapped to surfaces. */
export const KEY_MAP: Record<string, Route> = {
  "1": "dashboard",
  "2": "oracle",
  "3": "skills",
  "4": "graph",
  "5": "autoskill",
  "6": "sessions",
  "7": "decisions",
};

const STORAGE_KEY = "bp_route";

function warnInvalid(h: string): void {
  if (!h) return;
  if (process.env.NODE_ENV !== "production") {
     
    console.warn(
      `[brain:routes] unknown route "#${h}" — falling back to "${DEFAULT_ROUTE}". ` +
        `Valid routes: ${ROUTES.join(", ")}.`,
    );
  }
}

function readInitial(): Route {
  if (typeof window === "undefined") return DEFAULT_ROUTE;
  const hash = window.location.hash.replace(/^#/, "");
  if (isRoute(hash)) return hash;
  if (hash) warnInvalid(hash);
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved && isRoute(saved)) return saved;
  return DEFAULT_ROUTE;
}

/**
 * Route state synced with `location.hash` (deep-linkable) and persisted in
 * localStorage. Falls back to in-memory state for SSR.
 */
export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState<Route>(DEFAULT_ROUTE);

  // Hydrate from hash/localStorage on mount to avoid SSR mismatch.
  useEffect(() => {
    setRoute(readInitial());
    const onHash = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (isRoute(h)) setRoute(h);
      else warnInvalid(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((next: Route) => {
    if (!isRoute(next)) return;
    setRoute(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
      if (window.location.hash.replace(/^#/, "") !== next) {
        history.replaceState(null, "", `#${next}`);
      }
    }
  }, []);

  return [route, go];
}
