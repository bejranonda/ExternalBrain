"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpPopover } from "@/components/brain/help-popover";
import { useLang, useT } from "@/lib/brain/i18n";
import { roleLabel } from "@/lib/brain/roles";
import { apiErrorMessage, caughtMessage, throwApiError } from "@/lib/brain/api-error";

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

function fmt(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ProjectsPage() {
  const t = useT();
  const lang = useLang();
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
      if (!res.ok) await throwApiError(t, res);
      const d = (await res.json()) as OrgsResponse;
      setData(d);
      if (d.orgs[0] && !createOrgId) {
        setCreateOrgId(d.orgs[0].id);
      }
      setError(null);
    } catch (e) {
      setError(caughtMessage(t, e));
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
      if (!res.ok) await throwApiError(t, res);
      setCreateName("");
      await load();
    } catch (e) {
      setCreateError(caughtMessage(t, e));
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
      if (!res.ok) await throwApiError(t, res);
      setRenameTarget(null);
      await load();
    } catch (e) {
      setRenameError(caughtMessage(t, e));
    } finally {
      setRenaming(false);
    }
  };

  const onDelete = async (p: OrgProject) => {
    if (!window.confirm(t("projects.delete_confirm", { name: p.name }))) return;
    try {
      // Parse a 409 body at most once — re-reading the same Response throws a
      // stream-already-read error and masks the server's real message.
      let errorBody: { error?: string; message?: string } | null = null;
      let res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
      // If the project still holds skills/sessions, offer a one-step cascade
      // delete (the only way to remove sessions — there's no separate UI).
      if (res.status === 409) {
        errorBody = (await res.json()) as { error?: string; message?: string };
        if (errorBody.error === "project_not_empty") {
          if (
            !window.confirm(t("projects.delete_with_data_confirm", { name: p.name }))
          )
            return;
          res = await fetch(`/api/projects/${p.id}?withData=true`, { method: "DELETE" });
          errorBody = null;
        }
      }
      if (!res.ok) {
        const body =
          errorBody ?? ((await res.json().catch(() => ({}))) as { error?: string });
        setError(apiErrorMessage(t, body.error, res.status));
        return;
      }
      await load();
    } catch (e) {
      setError(caughtMessage(t, e));
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 6px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0, letterSpacing: "-0.02em" }}>
          {t("projects.title")}
        </h1>
        <HelpPopover
          content={{
            what: t("projects.help_what"),
            whatToDo: [
              t("projects.help_todo_1"),
              t("projects.help_todo_2"),
              t("projects.help_todo_3"),
            ],
          }}
        />
      </div>
      <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 28px", lineHeight: 1.55 }}>
        {t("projects.intro")}
      </p>

      {/* Create form */}
      <section className="panel" style={{ padding: "16px 18px", marginBottom: 28 }}>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 10 }}>
          {t("projects.create_heading")}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {data && data.orgs.length > 1 && (
            <select
              value={createOrgId}
              onChange={(e) => setCreateOrgId(e.target.value)}
              aria-label={t("common.organization")}
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
            placeholder={t("projects.name_label")}
            aria-label={t("projects.name_label")}
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
            {creating ? t("common.creating") : t("common.create")}
          </button>
        </div>
        {createError && (
          <div role="alert" style={{ fontSize: 13, color: "var(--bad, #ff6b6b)", marginTop: 8 }}>
            {createError}
          </div>
        )}
      </section>

      {/* Project list */}
      {loading && <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("common.loading")}</div>}
      {error && (
        <div
          role="alert"
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
            {t(org.projects.length === 1 ? "projects.org_heading_one" : "projects.org_heading_many", {
              org: org.slug.toUpperCase(),
              role: roleLabel(t, org.role),
              n: org.projects.length,
            })}
          </div>

          {org.projects.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>
              {t("projects.empty_org")}
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
                    {" · "}
                    {t("projects.meta_created", { date: fmt(p.createdAt, lang) })}
                    {p.id === data.activeProjectId ? ` · ${t("projects.meta_active")}` : ""}
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
                      {t("common.rename")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => void onDelete(p)}
                    >
                      {t("common.delete")}
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
              {t("projects.rename_title")}
            </h2>
            <input
              autoFocus
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              placeholder={t("projects.rename_placeholder")}
              aria-label={t("projects.rename_label")}
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
              <div role="alert" style={{ fontSize: 13, color: "var(--bad, #ff6b6b)", marginBottom: 12 }}>
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
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 12 }}
                onClick={() => void onRename()}
                disabled={!renameName.trim() || renaming}
              >
                {renaming ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
