"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpPopover } from "@/components/brain/help-popover";

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

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ProjectsPage() {
  const [data, setData] = useState<OrgsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [createOrgId, setCreateOrgId] = useState<string>("");
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Rename modal
  const [renameTarget, setRenameTarget] = useState<OrgProject | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/orgs", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as OrgsResponse;
      setData(d);
      if (d.orgs[0] && !createOrgId) {
        setCreateOrgId(d.orgs[0].id);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [createOrgId]);

  useEffect(() => {
    void load();
  }, []);

  const onCreate = async () => {
    if (!createName.trim() || !createOrgId || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: createOrgId, name: createName.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setCreateName("");
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "create failed");
    } finally {
      setCreating(false);
    }
  };

  const openRenameModal = (p: OrgProject) => {
    setRenameTarget(p);
    setRenameName(p.name);
    setRenameError(null);
  };

  const onRename = async () => {
    if (!renameTarget || !renameName.trim() || renaming) return;
    setRenaming(true);
    setRenameError(null);
    try {
      const res = await fetch(`/api/projects/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: renameName.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string; message?: string };
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      setRenameTarget(null);
      await load();
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : "rename failed");
    } finally {
      setRenaming(false);
    }
  };

  const onDelete = async (p: OrgProject) => {
    if (!window.confirm(`Delete project "${p.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string; message?: string };
        const msg = body.message ?? body.error ?? `HTTP ${res.status}`;
        setError(msg);
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  };

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 24px 96px",
        color: "var(--ink)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <a href="/" className="mono" style={{ fontSize: 12, color: "var(--ink-3)", textDecoration: "none" }}>
        ← back to Brain
      </a>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 6px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0, letterSpacing: "-0.02em" }}>
          Projects
        </h1>
        <HelpPopover
          content={{
            what: "Projects scope your knowledge and sessions. Each project belongs to one organization; rules and sessions are tagged to a project so they don't bleed across contexts.",
            whatToDo: [
              "Create a new project for a distinct codebase or client.",
              "Promote a personal project to a team org if collaborators need access.",
              "Delete cascades to its tokens and sessions — verify before confirming.",
            ],
          }}
        />
      </div>
      <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 28px", lineHeight: 1.55 }}>
        Projects group your knowledge and sessions. Each project belongs to one organization.
      </p>

      {/* Create form */}
      <section className="panel" style={{ padding: "16px 18px", marginBottom: 28 }}>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 10 }}>
          CREATE NEW PROJECT
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {data && data.orgs.length > 1 && (
            <select
              value={createOrgId}
              onChange={(e) => setCreateOrgId(e.target.value)}
              style={{
                padding: "7px 10px",
                fontSize: 13,
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: 4,
                color: "var(--ink)",
                fontFamily: "inherit",
              }}
            >
              {data.orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.slug}
                </option>
              ))}
            </select>
          )}
          <input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Project name"
            style={{
              flex: 1,
              padding: "8px 10px",
              fontSize: 13,
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: 4,
              color: "var(--ink)",
              fontFamily: "inherit",
              minWidth: 160,
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onCreate();
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onCreate()}
            disabled={!createName.trim() || creating}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        {createError && (
          <div style={{ fontSize: 13, color: "var(--bad, #ff6b6b)", marginTop: 8 }}>
            {createError}
          </div>
        )}
      </section>

      {/* Project list */}
      {loading && <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading…</div>}
      {error && (
        <div
          className="panel"
          style={{ padding: "10px 12px", fontSize: 13, borderLeft: "3px solid var(--bad, #ff6b6b)", marginBottom: 12 }}
        >
          {error}
        </div>
      )}

      {data?.orgs.map((org) => (
        <section key={org.id} style={{ marginBottom: 28 }}>
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 10, letterSpacing: "0.06em" }}
          >
            {org.slug.toUpperCase()} ({org.role}) — {org.projects.length} project
            {org.projects.length !== 1 ? "s" : ""}
          </div>

          {org.projects.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>
              No projects in this org.
            </div>
          )}

          {org.projects.map((p) => (
            <div
              key={p.id}
              className="panel"
              style={{
                padding: "12px 14px",
                marginBottom: 6,
                borderLeft: `3px solid ${p.id === data.activeProjectId ? "var(--accent)" : "var(--line)"}`,
              }}
            >
              <div className="row">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 3 }}>
                    {p.slug}
                    {p.framework ? ` · ${p.framework}` : ""}
                    {p.language ? ` · ${p.language}` : ""}
                    {" · "}created {fmt(p.createdAt)}
                    {p.id === data.activeProjectId ? " · active" : ""}
                  </div>
                </div>
                <div className="grow" />
                {p.isOwn && (
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => openRenameModal(p)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => void onDelete(p)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>
      ))}

      {/* Rename modal */}
      {renameTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setRenameTarget(null);
            }
          }}
        >
          <div
            className="panel"
            style={{
              width: "min(420px, 90vw)",
              padding: "24px 24px 20px",
              background: "var(--bg-elev-1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 16px", letterSpacing: "-0.01em" }}>
              Rename project
            </h2>
            <input
              autoFocus
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              placeholder="New name"
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 13,
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: 4,
                color: "var(--ink)",
                fontFamily: "inherit",
                marginBottom: renameError ? 8 : 16,
                boxSizing: "border-box",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void onRename();
                if (e.key === "Escape") setRenameTarget(null);
              }}
            />
            {renameError && (
              <div style={{ fontSize: 13, color: "var(--bad, #ff6b6b)", marginBottom: 12 }}>
                {renameError}
              </div>
            )}
            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12 }}
                onClick={() => setRenameTarget(null)}
                disabled={renaming}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 12 }}
                onClick={() => void onRename()}
                disabled={!renameName.trim() || renaming}
              >
                {renaming ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
