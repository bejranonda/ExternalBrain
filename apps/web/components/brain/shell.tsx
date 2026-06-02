"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { fuzzyScore } from "@brain/core/fuzzy";
import { Icon, type IconName } from "./icons";
import { useT } from "@/lib/brain/i18n";
import type { Route } from "@/lib/brain/routes";
import { OrgProjectSwitcher } from "./org-project-switcher";

/**
 * Lightweight viewer-name accessor for the rail footer. Mirrors the fetch in
 * UserMenu but without the side menu state — kept inline to avoid pulling
 * the menu's open/close machinery into the always-mounted nav rail. The
 * /api/me endpoint is cached HTTP-side so duplicate fetches are cheap.
 */
function useMe(): { name: string; tenant: string; initials: string } {
  const [view, setView] = useState<{ name: string; tenant: string; initials: string }>(
    { name: "—", tenant: "Personal", initials: "··" },
  );
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: { name?: string | null; email?: string | null; teams?: Array<{ name: string }> } } | null) => {
        if (cancelled || !d?.user) return;
        const u = d.user;
        const name = u.name?.trim() || u.email?.split("@")[0] || "Signed in";
        const initials =
          (u.name?.trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2)
            || u.email?.slice(0, 2)
            || "··").toUpperCase();
        const tenant = u.teams?.[0]?.name ?? "Personal";
        setView({ name, tenant, initials });
      })
      .catch(() => {/* keep placeholder */});
    return () => { cancelled = true; };
  }, []);
  return view;
}

/**
 * Visible env tag in the rail brand. The two hosted Brains
 * (brain-dev.example.com, brain.example.com) are visually identical apart
 * from the URL bar — at a glance the operator and end-user benefit from
 * knowing which one they're on. Defaults to "local" off-host.
 */
function useEnvLabel(): string | null {
  return useMemo(() => {
    if (typeof window === "undefined") return null;
    const h = window.location.hostname;
    if (h.includes("brain-dev")) return "dev";
    if (/^brain\./.test(h)) return "prod";
    if (h === "localhost" || h.startsWith("127.")) return "local";
    return null;
  }, []);
}

export interface Counts {
  skills: number;
  proposals: number;
}

interface NavProps {
  route: Route;
  setRoute: (r: Route) => void;
  counts: Counts;
  onUser?: () => void;
}

interface NavItem {
  id: Route;
  label: string;
  icon: IconName;
  kbd?: string;
  /**
   * Optional count badge. `kind: "total"` whispers (it's just "how many items
   * exist in that surface"); `kind: "queue"` speaks (it's an action queue —
   * "5 things waiting for you"). When `value === 0`, the rail falls back to
   * the kbd hint regardless of kind, so a brand-new brain doesn't show
   * a "0" badge that reads as data.
   */
  count?: { value: number; kind: "total" | "queue" };
  /** Hover-tooltip / aria-describedby. One short sentence on what the surface is for. */
  hint: string;
}

function useNavItems(counts: Counts): NavItem[] {
  const t = useT();
  return [
    { id: "dashboard", label: t("nav.dashboard"), icon: "dashboard", kbd: "1",
      hint: t("nav.hints.dashboard") },
    { id: "oracle", label: t("nav.oracle"), icon: "oracle", kbd: "2",
      hint: t("nav.hints.oracle") },
    { id: "skills", label: t("nav.skills"), icon: "skills", kbd: "3",
      count: { value: counts.skills, kind: "total" },
      hint: t("nav.hints.skills") },
    { id: "graph", label: t("nav.graph"), icon: "graph", kbd: "4",
      hint: t("nav.hints.graph") },
    { id: "autoskill", label: t("nav.autoskill"), icon: "autoskill", kbd: "5",
      count: { value: counts.proposals, kind: "queue" },
      hint: t("nav.hints.autoskill") },
    { id: "sessions", label: t("nav.sessions"), icon: "sessions", kbd: "6",
      hint: t("nav.hints.sessions") },
  ];
}

/**
 * Rail nav item.
 *
 * UX rule (Phase 2 cleanup): kbd hints and notification counts are
 * visually distinct.
 *
 * - `count > 0`  → render the badge (actionable signal: "5 pending").
 * - `count == 0` → fall back to the kbd hint, NOT a "0" badge. A zero
 *   badge confuses the user into reading it as data ("Oracle 2", "Skills 0")
 *   when it's actually a keyboard shortcut. Empty state belongs in the
 *   surface, not next to the nav label.
 * - no count    → render the kbd hint (always meaningful for power users).
 */
function RailNavItem({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const showBadge = item.count != null && item.count.value > 0;
  const badgeKind = item.count?.kind;
  return (
    <button
      type="button"
      className={`rail-item ${active ? "active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={item.hint}
      aria-label={
        showBadge
          ? `${item.label} — ${item.hint} — ${item.count!.value} ${badgeKind === "queue" ? "pending" : "total"}`
          : `${item.label} — ${item.hint}`
      }
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {showBadge ? (
        <span
          className={`count tab-num${badgeKind === "total" ? " count-total" : ""}`}
          aria-hidden="true"
        >
          {item.count!.value}
        </span>
      ) : item.kbd ? (
        <span className="kbd" aria-hidden="true">{item.kbd}</span>
      ) : null}
    </button>
  );
}

export function Rail({ route, setRoute, counts, onUser }: NavProps) {
  const t = useT();
  const items = useNavItems(counts);
  const me = useMe();
  const env = useEnvLabel();

  return (
    <nav className="rail desktop-only" aria-label="Primary">
      <div
        className="rail-brand"
        title={
          env
            ? `Brain Platform · ${env} environment (hover to expand sidebar)`
            : "Brain Platform (hover to expand sidebar)"
        }
      >
        <div className="rail-brand-mark">B</div>
        <div className="rail-brand-wm">Brain</div>
        {env && (
          <div
            className="rail-brand-tag"
            data-env={env}
            style={env === "prod" ? { color: "var(--bad, #ff6b6b)" } : undefined}
          >
            {env}
          </div>
        )}
      </div>

      <div className="rail-section-label">{t("nav.workspace")}</div>
      {items.slice(0, 4).map((it) => (
        <RailNavItem key={it.id} item={it} active={route === it.id} onClick={() => setRoute(it.id)} />
      ))}

      <div className="rail-section-label">{t("nav.activity")}</div>
      {items.slice(4).map((it) => (
        <RailNavItem key={it.id} item={it} active={route === it.id} onClick={() => setRoute(it.id)} />
      ))}

      {/* The "Scopes" rail section (Personal / Team · core / Community)
          was removed in the 2026-05-17 newcomer-UX pass. The buttons
          updated client-side state but no surface consumed it — to
          a first-time user the clicks appeared dead, which broke
          trust in the rail. The actual data-scope toggle ("this
          project" / "all my projects") lives in the in-page
          <ScopePill /> on each surface and is the single source of
          truth. Per-Knowledge.scope filtering (private/team/global)
          will return as a faceted filter inside Skills if/when the
          UX is fully designed, not as a decorative rail dot. */}

      <div className="rail-footer">
        <button
          type="button"
          className="rail-user"
          onClick={onUser}
          title={`Signed in as ${me.name}. Click for settings, tokens, sign out.`}
          aria-label={`User menu for ${me.name}`}
        >
          <div className="rail-user-avatar">{me.initials}</div>
          <div className="rail-user-meta">
            <div>{me.name}</div>
            <div className="rail-user-tenant">{me.tenant}</div>
          </div>
          <Icon name="chevD" size={12} />
        </button>
      </div>
    </nav>
  );
}

export function BottomNav({ route, setRoute, counts }: NavProps) {
  const t = useT();
  // Six items so mobile users can reach every primary surface — earlier
  // versions omitted Sessions, leaving phones with no path to it short of
  // the topbar crumb. Items mirror the desktop rail.
  const items: Array<NavItem & { badge?: number; hint: string }> = [
    { id: "dashboard", label: t("nav.dashboard"), icon: "dashboard",
      hint: t("nav.hints.dashboard") },
    { id: "oracle", label: t("nav.oracle"), icon: "oracle",
      hint: t("nav.hints.oracle") },
    { id: "skills", label: t("nav.skills"), icon: "skills",
      hint: t("nav.hints.skills") },
    { id: "graph", label: t("nav.graph"), icon: "graph",
      hint: t("nav.hints.graph") },
    { id: "autoskill", label: t("nav.autoskill"), icon: "autoskill",
      badge: counts.proposals,
      hint: t("nav.hints.autoskill") },
    { id: "sessions", label: t("nav.sessions"), icon: "sessions",
      hint: t("nav.hints.sessions") },
  ];
  return (
    <nav className="bottom-nav mobile-only" aria-label="Primary (mobile)">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`bottom-nav-item ${route === it.id ? "active" : ""}`}
          onClick={() => setRoute(it.id)}
          aria-current={route === it.id ? "page" : undefined}
          aria-label={`${it.label} — ${it.hint}`}
        >
          <div style={{ position: "relative" }}>
            <Icon name={it.icon} size={18} />
            {it.badge ? (
              <span
                style={{
                  position: "absolute",
                  top: -4,
                  right: -6,
                  minWidth: 14,
                  height: 14,
                  padding: "0 3px",
                  borderRadius: 7,
                  background: "var(--accent)",
                  color: "var(--accent-ink)",
                  fontSize: 9,
                  fontWeight: 700,
                  display: "grid",
                  placeItems: "center",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {it.badge}
              </span>
            ) : null}
          </div>
          <span style={{ fontSize: 12 }}>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function Topbar({
  route,
  setRoute,
  onCmd,
  onTweaks,
  onUser,
  onNotifications,
  notificationCount,
}: {
  route: Route;
  setRoute?: (r: Route) => void;
  onCmd: () => void;
  onTweaks: () => void;
  /**
   * Open the user/account menu (settings → tokens, org, projects,
   * reset-knowledge, sign-out, etc.). Required prop — without it the
   * mobile topbar would have no entry point to settings, since the
   * left rail is `desktop-only` and the bottom nav doesn't carry a
   * user-menu button (the four primary surfaces fill it).
   */
  onUser?: () => void;
  onTeach?: () => void;
  onNotifications?: () => void;
  ingestLive?: boolean;
  ingestLabel?: string;
  notificationCount?: number;
}) {
  const t = useT();
  // UX-newcomer-pass-2 (iter 16): the parent crumb ("Workspace" /
  // "Activity") added no info — every page already shows the current
  // surface label, the rail shows section grouping, and the
  // OrgProjectSwitcher on the left carries the higher-level context.
  // "Brain Platform · Workspace / Dashboard" read as decoration to
  // first-time users. Simplified to a single crumb (the current route).
  // Kept the array shape so the render loop below doesn't need to
  // branch on length.
  const crumbsMap: Record<Route, Array<{ label: string; to: Route }>> = {
    dashboard: [{ label: t("nav.dashboard"), to: "dashboard" }],
    oracle: [{ label: t("nav.oracle"), to: "oracle" }],
    skills: [{ label: t("nav.skills"), to: "skills" }],
    graph: [{ label: t("nav.graph"), to: "graph" }],
    autoskill: [{ label: t("nav.autoskill"), to: "autoskill" }],
    sessions: [{ label: t("nav.sessions"), to: "sessions" }],
  };
  const crumbs = crumbsMap[route];

  return (
    <header className="topbar">
      <OrgProjectSwitcher />
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => {
          const isCurrent = i === crumbs.length - 1;
          return (
            <Fragment key={i}>
              {i > 0 && <span className="sep">/</span>}
              <button
                type="button"
                className={`crumb ${isCurrent ? "current" : ""}`}
                aria-current={isCurrent ? "page" : undefined}
                onClick={() => setRoute?.(c.to)}
              >
                {c.label}
              </button>
            </Fragment>
          );
        })}
      </nav>
      <button
        type="button"
        className="topbar-search"
        onClick={onCmd}
        aria-label={t("app.search")}
        title="Press ⌘K (or Ctrl+K on Windows/Linux) to search your Brain, ask the Oracle, or jump between surfaces. Inside, type 1–6 to nav directly."
      >
        <Icon name="search" size={12} />
        <span style={{ fontSize: 12 }}>{t("app.search")}</span>
        <span className="kbd">⌘K</span>
      </button>
      <div className="topbar-actions desktop-only">
        <button
          type="button"
          className="icon-btn"
          title={t("app.notifications")}
          aria-label={t("app.notifications")}
          onClick={onNotifications}
          style={{ position: "relative" }}
        >
          <Icon name="notifications" />
          {notificationCount ? (
            <span
              aria-label={`${notificationCount} pending`}
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                minWidth: 12,
                height: 12,
                padding: "0 3px",
                borderRadius: 6,
                background: "var(--accent)",
                color: "var(--accent-ink)",
                fontSize: 9,
                fontWeight: 700,
                display: "grid",
                placeItems: "center",
                fontFamily: "var(--font-mono)",
              }}
            >
              {notificationCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t("app.settings")}
          aria-label={t("app.settings")}
          onClick={onTweaks}
        >
          <Icon name="settings" />
        </button>
        {/* Phase R: the "Add a skill" (teach) button moved off the global
            topbar — it belongs on the Skills page, not in chrome. The
            `onTeach` prop is kept on Topbar for backward-compat with
            callers; a future pass wires it into the Skills surface. */}
      </div>
      {/*
        Mobile-only entry into the user/account menu. Was previously wired
        to `onTweaks` (the Preferences panel only), which left mobile
        operators with no way to reach /settings/tokens, /settings/org,
        /settings/reset-knowledge, sign-out, etc. The user menu carries
        Preferences as its first item, so wiring this button to `onUser`
        keeps Tweaks reachable AND surfaces every other settings entry.
      */}
      <button
        className="icon-btn mobile-only"
        aria-label="Account menu"
        onClick={onUser ?? onTweaks}
      >
        <Icon name="settings" />
      </button>
    </header>
  );
}

interface CmdKProps {
  open: boolean;
  onClose: () => void;
  go: (r: Route) => void;
}

export function CmdK({ open, onClose, go }: CmdKProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (!open) return null;

  const sections: Array<{
    section: string;
    items: Array<{ label: string; hint: string; icon: IconName; action: () => void }>;
  }> = [
    {
      section: t("nav.workspace"),
      items: [
        { label: t("nav.dashboard"), hint: "1", icon: "dashboard", action: () => go("dashboard") },
        { label: t("nav.oracle"), hint: "2", icon: "oracle", action: () => go("oracle") },
        { label: t("nav.skills"), hint: "3", icon: "skills", action: () => go("skills") },
        { label: t("nav.graph"), hint: "4", icon: "graph", action: () => go("graph") },
        { label: t("nav.autoskill"), hint: "5", icon: "autoskill", action: () => go("autoskill") },
        { label: t("nav.sessions"), hint: "6", icon: "sessions", action: () => go("sessions") },
      ],
    },
    {
      section: t("nav.oracle"),
      items: [
        { label: t("nav.hints.cmdk_q1"), hint: "↵", icon: "oracle", action: () => go("oracle") },
        { label: t("nav.hints.cmdk_q2"), hint: "↵", icon: "oracle", action: () => go("oracle") },
        { label: t("nav.hints.cmdk_q3"), hint: "↵", icon: "oracle", action: () => go("oracle") },
      ],
    },
  ];

  const normalized = q.trim().toLowerCase();
  const filtered = normalized
    ? sections
        .map((s) => ({
          ...s,
          items: s.items
            .map((it) => {
              const score = fuzzyScore(it.label, normalized);
              return { it, score };
            })
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .map(({ it }) => it),
        }))
        .filter((s) => s.items.length > 0)
    : sections;

  return (
    <div
      className="cmdk-scrim"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="cmdk"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("app.search")}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder={t("app.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const first = filtered[0]?.items[0];
              if (first) {
                first.action();
                onClose();
              }
            }
          }}
        />
        <div className="cmdk-list">
          {filtered.map((sec) => (
            <div key={sec.section}>
              <div className="cmdk-section">{sec.section}</div>
              {sec.items.map((it, i) => (
                <button
                  type="button"
                  key={i}
                  className="cmdk-item"
                  onClick={() => {
                    it.action();
                    onClose();
                  }}
                >
                  <Icon name={it.icon} size={12} />
                  <span>{it.label}</span>
                  <span className="hint">{it.hint}</span>
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="cmdk-section" style={{ padding: "16px 12px" }}>
              No matches
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
