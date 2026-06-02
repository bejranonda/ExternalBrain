"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface OrgProject {
  id: string;
  slug: string;
  name: string;
  framework: string | null;
  language: string | null;
  createdAt: string;
  isOwn: boolean;
}

interface OrgData {
  id: string;
  slug: string;
  name: string;
  role: string;
  projects: OrgProject[];
}

interface OrgsResponse {
  orgs: OrgData[];
  activeProjectId: string | null;
}

/**
 * OrgProjectSwitcher
 *
 * Renders a compact "[org-slug] / [project-slug]" button in the topbar.
 * AUTO-HIDES when the user has exactly 1 org AND that org has exactly 1 project.
 *
 * On click, opens a dropdown with:
 *  - Current org's projects (checkmark on active)
 *  - "+ New project" inline form
 *  - "Manage projects →" link
 *  - Other orgs if the user belongs to more than one
 */
export function OrgProjectSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<OrgsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newOrgId, setNewOrgId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<OrgsResponse | null> => {
    try {
      const res = await fetch("/api/orgs", { cache: "no-store" });
      if (!res.ok) return null;
      const d = (await res.json()) as OrgsResponse;
      setData(d);
      return d;
    } catch {
      // non-fatal — keep previous data
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refetch every time the dropdown opens. Without this, a project
  // created in another tab (or via the API / CLI) never appears
  // here until a hard page reload — the symptom that prompted this
  // fix was "I created a new project but the dropdown doesn't show
  // it." The cost is one extra /api/orgs call per open, which is
  // cheap and avoids a confusing stale-state UX.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowNewForm(false);
        setNewName("");
        setError(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Auto-focus new-project input when form opens
  useEffect(() => {
    if (showNewForm) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [showNewForm]);

  // AUTO-HIDE: solo user with 1 org × 1 project
  if (!loading && data) {
    const totalProjects = data.orgs.reduce((n, o) => n + o.projects.length, 0);
    if (data.orgs.length === 1 && totalProjects <= 1) {
      return null;
    }
  }

  // Derive display labels
  const allProjects = data?.orgs.flatMap((o) => o.projects.map((p) => ({ ...p, orgId: o.id, orgSlug: o.slug }))) ?? [];
  const active = allProjects.find((p) => p.id === data?.activeProjectId) ?? allProjects[0];
  const activeOrg = data?.orgs.find((o) => o.projects.some((p) => p.id === active?.id));

  // Display the project's user-facing name in the topbar — slugs like
  // "personal-rcfmkg000001/brain-platform" overflow on mobile and look
  // like an internal id rather than a project. The full org/project slug
  // is still available in the dropdown and the URL bar.
  const slugDisplay = loading
    ? "…"
    : active
    ? active.name
    : "—";
  // Multi-org users get an org prefix so they can distinguish projects
  // with the same name across orgs ("acme/api" vs "personal/api"). Single-
  // org users (the common case) get just the project name.
  const orgPrefix =
    !loading && active && (data?.orgs.length ?? 0) > 1
      ? `${activeOrg?.name ?? activeOrg?.slug ?? "?"} · `
      : "";

  const activateProject = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/activate`, { method: "POST" });
      if (res.ok) {
        // Reload orgs fresh so we have authoritative slug data, then navigate
        // to the canonical URL for the newly-active project.
        const freshData = await load();
        const allP = freshData?.orgs.flatMap((o) =>
          o.projects.map((p) => ({ ...p, orgSlug: o.slug })),
        ) ?? [];
        const target = allP.find((p) => p.id === projectId);
        if (target) {
          router.push(`/${target.orgSlug}/${target.slug}`);
        } else {
          // Fallback: let the bare-URL redirect pick the right project.
          router.push("/");
        }
      }
    } catch {
      // swallow
    }
    setOpen(false);
  };

  const createProject = async () => {
    if (!newName.trim() || !newOrgId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: newOrgId, name: newName.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { project: OrgProject };
      setNewName("");
      setShowNewForm(false);
      // Reload data so org/slug info is available, then activate + navigate.
      await load();
      // activateProject will navigate to the canonical URL.
      await activateProject(body.project.id);
    } catch {
      setError("create failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      ref={dropdownRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
    >
      {/* Trigger button */}
      <button
        type="button"
        className="btn btn-ghost"
        style={{
          fontSize: 12,
          fontFamily: "var(--font-mono)",
          padding: "3px 8px",
          color: "var(--ink-2)",
          letterSpacing: "0.01em",
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Project: ${orgPrefix}${slugDisplay} (click to switch)`}
      >
        {orgPrefix && (
          <span style={{ opacity: 0.6, fontSize: 11, marginRight: 4 }}>
            {orgPrefix}
          </span>
        )}
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 13 }}>
          {slugDisplay}
        </span>
        <span style={{ marginLeft: 4, opacity: 0.5 }}>▾</span>
      </button>

      {/* Dropdown — uses the shared `panel` class for visual consistency
          with other floating surfaces (UserMenu, NotificationsPanel,
          HelpPopover). The boxShadow is added inline because `panel`
          does not raise its surface visually on its own. */}
      {open && (
        <div
          role="dialog"
          aria-label="Switch project"
          className="panel"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 200,
            minWidth: 240,
            background: "var(--bg-elev-1)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            overflow: "hidden",
            padding: 0,
          }}
        >
          {data?.orgs.map((org, orgIdx) => (
            <div key={org.id}>
              {orgIdx > 0 && (
                <div
                  style={{
                    height: 1,
                    background: "var(--line)",
                    margin: "4px 0",
                  }}
                />
              )}

              {/* Org label */}
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--ink-4)",
                  padding: "8px 12px 4px",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {org.slug}
              </div>

              {/* Projects in this org */}
              {org.projects.map((p) => {
                const isActive = p.id === data.activeProjectId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      width: "100%",
                      padding: "6px 12px",
                      background: isActive ? "var(--accent-wash)" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--ink)",
                      fontSize: 13,
                      textAlign: "left",
                      gap: 8,
                    }}
                    onClick={() => void activateProject(p.id)}
                  >
                    <span
                      style={{
                        width: 14,
                        textAlign: "center",
                        color: "var(--accent-text)",
                        fontWeight: 700,
                      }}
                    >
                      {isActive ? "✓" : ""}
                    </span>
                    <span style={{ flex: 1 }}>{p.name}</span>
                    <span
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-4)" }}
                    >
                      {p.slug}
                    </span>
                  </button>
                );
              })}

              {/* "+ New project" — uses the shared btn vocabulary so the
                  visual treatment matches the rest of the dropdown's
                  affordances (Cancel, Create, Manage). */}
              {!showNewForm && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    width: "100%",
                    padding: "6px 12px",
                    height: "auto",
                    color: "var(--ink-3)",
                    fontSize: 13,
                    gap: 6,
                    borderRadius: 0,
                    border: "none",
                  }}
                  onClick={() => {
                    setNewOrgId(org.id);
                    setShowNewForm(true);
                    setError(null);
                  }}
                >
                  <span>+</span>
                  <span>New project</span>
                </button>
              )}

              {/* Inline create form */}
              {showNewForm && newOrgId === org.id && (
                <div style={{ padding: "8px 12px" }}>
                  <input
                    ref={inputRef}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Project name"
                    style={{
                      width: "100%",
                      padding: "5px 8px",
                      fontSize: 13,
                      background: "var(--bg)",
                      border: "1px solid var(--line)",
                      borderRadius: 4,
                      color: "var(--ink)",
                      fontFamily: "inherit",
                      marginBottom: 4,
                      boxSizing: "border-box",
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createProject();
                      if (e.key === "Escape") {
                        setShowNewForm(false);
                        setNewName("");
                      }
                    }}
                  />
                  {/* Slug preview */}
                  {newName.trim() && (
                    <div
                      className="mono"
                      style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 6 }}
                    >
                      slug:{" "}
                      {newName
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-+|-+$/g, "") || "project"}
                    </div>
                  )}
                  {error && (
                    <div style={{ fontSize: 12, color: "var(--bad, #ff6b6b)", marginBottom: 4 }}>
                      {error}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: 12, flex: 1 }}
                      disabled={!newName.trim() || creating}
                      onClick={() => void createProject()}
                    >
                      {creating ? "Creating…" : "Create"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        setShowNewForm(false);
                        setNewName("");
                        setError(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Footer: Manage link */}
          <div
            style={{
              height: 1,
              background: "var(--line)",
              margin: "4px 0",
            }}
          />
          <a
            href="/settings/projects"
            style={{
              display: "flex",
              alignItems: "center",
              padding: "7px 12px",
              fontSize: 13,
              color: "var(--ink-3)",
              textDecoration: "none",
              gap: 6,
            }}
            onClick={() => setOpen(false)}
          >
            Manage projects →
          </a>
        </div>
      )}
    </div>
  );
}
