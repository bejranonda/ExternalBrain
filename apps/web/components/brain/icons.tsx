"use client";

import type { ReactNode } from "react";

export type IconName =
  | "brain" | "dashboard" | "oracle" | "skills" | "graph" | "autoskill" | "sessions"
  | "search" | "settings" | "notifications" | "plus" | "chevR" | "chevD"
  | "arrowUp" | "arrowR" | "sparkle" | "check" | "x" | "clock" | "file" | "link"
  | "cite" | "filter" | "sort" | "more" | "bolt" | "branch" | "bookmark" | "copy"
  | "claude" | "cursor" | "windsurf" | "mcp";

const paths: Record<IconName, ReactNode> = {
  brain: <path d="M7 3a3 3 0 0 0-3 3v1a2 2 0 0 0-1 1.7v.3a2 2 0 0 0 1 1.7V12a3 3 0 0 0 3 3h0m0-12v12m0-12a3 3 0 0 1 3 3m-3 9a3 3 0 0 0 3-3m4-5a3 3 0 0 0-3-3m3 3v1a2 2 0 0 1 1 1.7v.3a2 2 0 0 1-1 1.7V12a3 3 0 0 1-3 3" />,
  dashboard: (
    <>
      <rect x="2" y="2" width="5" height="6" rx="1" />
      <rect x="2" y="10" width="5" height="4" rx="1" />
      <rect x="9" y="2" width="5" height="4" rx="1" />
      <rect x="9" y="8" width="5" height="6" rx="1" />
    </>
  ),
  oracle: (
    <>
      <path d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6l-3 2v-2H4a2 2 0 0 1-2-2z" />
      <circle cx="5.5" cy="7" r="0.6" fill="currentColor" />
      <circle cx="8" cy="7" r="0.6" fill="currentColor" />
      <circle cx="10.5" cy="7" r="0.6" fill="currentColor" />
    </>
  ),
  skills: <path d="M2 4h12M2 8h12M2 12h8" />,
  graph: (
    <>
      <circle cx="8" cy="3" r="1.6" />
      <circle cx="3" cy="11" r="1.6" />
      <circle cx="13" cy="11" r="1.6" />
      <circle cx="8" cy="12.5" r="1.3" />
      <path d="M7 4.3 3.8 9.7M9 4.3l3.2 5.4M4.5 11.5h2M9.3 11.7l2.4-.4" />
    </>
  ),
  autoskill: <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2" />,
  sessions: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <path d="M2 6h12M5 3v10" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="m10 10 3 3" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M1 8h2M13 8h2M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" />
    </>
  ),
  notifications: <path d="M4 6a4 4 0 0 1 8 0v3l1 2H3l1-2V6zM6 13a2 2 0 0 0 4 0" />,
  plus: <path d="M8 3v10M3 8h10" />,
  chevR: <path d="m6 3 4 5-4 5" />,
  chevD: <path d="m3 6 5 4 5-4" />,
  arrowUp: <path d="M8 13V3M4 7l4-4 4 4" />,
  arrowR: <path d="M3 8h10M9 4l4 4-4 4" />,
  sparkle: <path d="M8 2l1.4 4.6L14 8l-4.6 1.4L8 14l-1.4-4.6L2 8l4.6-1.4zM13 2l.5 1.5L15 4l-1.5.5L13 6l-.5-1.5L11 4l1.5-.5z" />,
  check: <path d="m3 8 3.5 3.5L13 5" />,
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1.5" />
    </>
  ),
  file: (
    <>
      <path d="M3 2h6l3 3v9H3z" />
      <path d="M9 2v3h3" />
    </>
  ),
  link: <path d="M6.5 9.5 9.5 6.5M7 4l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 12l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1" />,
  cite: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <path d="M5 6h6M5 9h4" />
    </>
  ),
  filter: <path d="M2 3h12l-4.5 5v5l-3-1V8z" />,
  sort: <path d="M4 3v10M4 3l-2 2M4 3l2 2M12 13V3M12 13l-2-2M12 13l2-2" />,
  more: (
    <>
      <circle cx="4" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12" cy="8" r="1" />
    </>
  ),
  bolt: <path d="M9 2 3 9h4l-1 5 6-7H8z" />,
  branch: (
    <>
      <circle cx="4" cy="3" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <circle cx="12" cy="8" r="1.5" />
      <path d="M4 4.5v7M5.5 13c4 0 5-2 5-3.5" />
    </>
  ),
  bookmark: <path d="M4 2h8v12l-4-3-4 3z" />,
  copy: (
    <>
      <rect x="5" y="2" width="9" height="9" rx="1" />
      <path d="M5 5H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2" />
    </>
  ),
  claude: <path d="M4 4l1.8 5-1.8 5m3-10v10m1-10 1.8 5-1.8 5m3-10 1.8 5-1.8 5" />,
  cursor: <path d="m3 2 10 5-4 1-1 4z" />,
  windsurf: (
    <>
      <path d="M2 6c2 0 2 2 4 2s2-2 4-2 2 2 4 2" />
      <path d="M2 11c2 0 2-2 4-2s2 2 4 2 2-2 4-2" />
    </>
  ),
  mcp: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M4 8c0-2 1-4 4-4s4 2 4 4M8 12V4" />
    </>
  ),
};

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
