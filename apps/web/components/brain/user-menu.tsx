"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";

interface Props {
  open: boolean;
  onClose: () => void;
  onTweaks: () => void;
}

interface MeView {
  id: string;
  email: string;
  name: string | null;
  hasCredential?: boolean;
  teams: Array<{ id: string; name: string; role: string }>;
}

export function UserMenu({ open, onClose, onTweaks }: Props) {
  const [me, setMe] = useState<MeView | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d: { user: MeView | null }) => {
        if (!cancelled) setMe(d.user);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="cmdk-scrim"
      onClick={onClose}
      role="presentation"
      style={{ alignItems: "flex-end", justifyContent: "flex-start" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="User menu"
        className="panel"
        style={{
          width: 260,
          marginBottom: 18,
          marginLeft: 18,
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
          <div className="row" style={{ gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 999,
                background: "var(--accent)",
                color: "var(--accent-ink)",
                display: "grid",
                placeItems: "center",
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              {initials(me?.name, me?.email)}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                {loading ? "…" : me?.name ?? me?.email ?? "Signed out"}
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {me?.email ?? "no email"}
              </div>
            </div>
          </div>
        </div>
        {me?.teams && me.teams.length > 0 && (
          <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--line)" }}>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 6,
              }}
            >
              Teams
            </div>
            {me.teams.map((tm) => (
              <div
                key={tm.id}
                className="row"
                style={{ fontSize: 13, padding: "2px 0", color: "var(--ink-2)" }}
              >
                <span>{tm.name}</span>
                <span className="grow" />
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
                  {tm.role}
                </span>
              </div>
            ))}
          </div>
        )}
        <div style={{ padding: 6 }}>
          <MenuItem icon="settings" label="Preferences" onClick={onTweaks} />
          <MenuItem
            icon="link"
            label="MCP tokens"
            onClick={() => {
              window.location.href = "/settings/tokens";
            }}
          />
          <MenuItem
            icon="link"
            label="Organization"
            onClick={() => {
              window.location.href = "/settings/org";
            }}
          />
          <MenuItem
            icon="link"
            label="Projects"
            onClick={() => {
              window.location.href = "/settings/projects";
            }}
          />
          <MenuItem
            icon="x"
            label="Reset knowledge"
            onClick={() => {
              window.location.href = "/settings/reset-knowledge";
            }}
          />
          {me?.hasCredential && (
            <MenuItem
              icon="settings"
              label="Change password"
              onClick={() => {
                window.location.href = "/settings/password";
              }}
            />
          )}
          <MenuItem
            icon="settings"
            label="Show onboarding tour"
            onClick={() => {
              window.localStorage.removeItem("bp_onboarded");
              window.location.reload();
            }}
          />
          <MenuItem
            icon="file"
            label="Documentation"
            onClick={() => {
              // In-app docs route (was a stale anthropics.com URL).
              window.location.href = "/docs";
            }}
          />
          <MenuItem
            icon="x"
            label="Sign out"
            onClick={() => {
              window.location.href = "/signout";
            }}
          />
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: "settings" | "link" | "file" | "x";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rail-item"
      style={{ width: "100%", textAlign: "left" }}
    >
      <Icon name={icon} size={12} />
      <span>{label}</span>
    </button>
  );
}

function initials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    return (parts[0]?.[0] ?? "").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return "··";
}
