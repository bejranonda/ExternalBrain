"use client";

import { useCallback, useEffect, useState } from "react";

export type ProjectScopeKey = "project" | "all";

const STORAGE_KEY = "bp_project_scope";
const DEFAULT: ProjectScopeKey = "project";

function readInitial(): ProjectScopeKey {
  if (typeof window === "undefined") return DEFAULT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "project" || raw === "all") return raw;
  return DEFAULT;
}

/**
 * Persists the user's preferred data-scope across page loads.
 *
 * "project" (default) — only show data for the active project + the user's
 *   project-less personal knowledge.
 * "all" — show everything the user owns, across all projects.
 *
 * Each surface passes `scope` as `?scope=all` when set to "all".
 */
export function useProjectScope(): {
  scope: ProjectScopeKey;
  setScope: (next: ProjectScopeKey) => void;
} {
  const [scope, setScope] = useState<ProjectScopeKey>(DEFAULT);

  useEffect(() => {
    setScope(readInitial());
  }, []);

  const set = useCallback((next: ProjectScopeKey) => {
    setScope(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  return { scope, setScope: set };
}

/**
 * Build the URL search-param string for the active scope.
 * Returns "?scope=all" when scope is "all", "" otherwise.
 */
export function scopeParam(scope: ProjectScopeKey): string {
  return scope === "all" ? "?scope=all" : "";
}

/**
 * Append a scope param to an existing URL (which may already have params).
 */
export function appendScopeParam(url: string, scope: ProjectScopeKey): string {
  if (scope !== "all") return url;
  return url.includes("?") ? `${url}&scope=all` : `${url}?scope=all`;
}
