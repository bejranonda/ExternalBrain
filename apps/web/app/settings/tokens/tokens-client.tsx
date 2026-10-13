"use client";

// Subpath import, NOT the "@brain/core" barrel. This is a client component,
// and the barrel re-exports `logger.ts` → `@sentry/node` → `worker_threads`,
// which cannot be bundled for the browser ("Module not found: Can't resolve
// 'worker_threads'"). `capabilities.ts` has no imports at all, so it is safe
// to ship to the client. Same reason `token-install-wizard.tsx` imports from
// "@brain/core/install-snippets".
import { CAPABILITIES, isCapability } from "@brain/core/capabilities";

import { useCallback, useEffect, useState } from "react";
import { TokenInstallWizard } from "@/components/brain/token-install-wizard";
import { HelpPopover } from "@/components/brain/help-popover";
import { useLang, useT } from "@/lib/brain/i18n";
import { caughtMessage, throwApiError, type Translate } from "@/lib/brain/api-error";
import { runTokenTest, tokenTestMessage, type TokenTestResult } from "@/lib/brain/token-test";

interface TokenRow {
  id: string;
  name: string;
  scope: "personal" | "team";
  organizationId: string | null;
  projectId: string | null;
  capabilities?: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  scheduledRevokeAt: string | null;
  rotatedFromId: string | null;
}

interface OrgOption {
  id: string;
  name: string;
  slug: string;
  projects: Array<{ id: string; name: string; slug: string }>;
}

interface ProjectOption {
  id: string;
  name: string;
  slug: string;
  orgId: string;
  orgName: string;
}

interface TokensClientProps {
  /** Public MCP endpoint resolved from BRAIN_MCP_PUBLIC_HOSTNAME server-side.
   *  Undefined in local dev, where the `${origin}:3100` heuristic is right.
   *  Explicit `| undefined` because the workspace sets
   *  `exactOptionalPropertyTypes`, under which `?:` alone forbids passing
   *  an explicit undefined. */
  mcpUrl?: string | undefined;
  webUrl?: string | undefined;
}

export function TokensClient({ mcpUrl, webUrl }: TokensClientProps) {
  const t = useT();
  const lang = useLang();
  const fmt = (iso: string) => fmtDate(iso, lang);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  // Phase 3c + token-scope feature: org + project pickers for new tokens.
  // The user's full hierarchy of orgs → projects, used for both the
  // create form and the per-token "Change scope" modal.
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  // Capability allow-list for the token being minted. EMPTY = unrestricted,
  // which is the default and matches every token that already exists.
  const [selectedCaps, setSelectedCaps] = useState<string[]>([]);

  // "Change scope" modal state — separate from the secret-rotation modal.
  const [scopeTarget, setScopeTarget] = useState<TokenRow | null>(null);
  const [scopeOrgId, setScopeOrgId] = useState<string | null>(null);
  const [scopeProjectId, setScopeProjectId] = useState<string | null>(null);
  const [savingScope, setSavingScope] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);
  // freshRaw + freshTokenId drive the install wizard.
  const [freshRaw, setFreshRaw] = useState<string | null>(null);
  const [freshTokenId, setFreshTokenId] = useState<string | null>(null);

  // Change modal state
  const [changeTarget, setChangeTarget] = useState<TokenRow | null>(null);
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  // Per-token Verify state. Keyed by tokenId so multiple verifications can run
  // independently without UI bleed.
  type VerifyState = { loading: true } | { loading: false; result: TokenTestResult };
  const [verify, setVerify] = useState<Record<string, VerifyState>>({});

  const onVerify = async (id: string) => {
    setVerify((m) => ({ ...m, [id]: { loading: true } }));
    const result = await runTokenTest(id);
    setVerify((m) => ({ ...m, [id]: { loading: false, result } }));
  };

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/tokens", { cache: "no-store" });
      if (!res.ok) await throwApiError(t, res);
      const data = (await res.json()) as { tokens: TokenRow[] };
      setTokens(data.tokens);
      setError(null);
    } catch (e) {
      setError(caughtMessage(t, e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load orgs + projects for the pickers. Hierarchical structure is
  // kept on the orgs state; the flat `projects` list is derived for
  // backward-compat with the existing per-row name resolution.
  useEffect(() => {
    fetch("/api/orgs", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { orgs: Array<{ id: string; name: string; slug: string; projects: Array<{ id: string; name: string; slug: string }> }> }) => {
        const orgList: OrgOption[] = (data.orgs ?? []).map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          projects: o.projects ?? [],
        }));
        setOrgs(orgList);
        const flat: ProjectOption[] = [];
        for (const org of orgList) {
          for (const p of org.projects) {
            flat.push({ id: p.id, name: p.name, slug: p.slug, orgId: org.id, orgName: org.name });
          }
        }
        setProjects(flat);
      })
      .catch(() => {/* non-fatal */});
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    setFreshRaw(null);
    setFreshTokenId(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scope: "personal",
          organizationId: selectedOrgId ?? null,
          projectId: selectedProjectId ?? null,
          capabilities: selectedCaps,
        }),
      });
      if (!res.ok) await throwApiError(t, res);
      const data = (await res.json()) as { raw: string; token: { id: string } };
      setFreshRaw(data.raw);
      setFreshTokenId(data.token.id);
      setName("");
      await refresh();
    } catch (e) {
      setError(caughtMessage(t, e));
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (id: string) => {
    if (!window.confirm(t("tokens.revoke_confirm"))) return;
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      if (!res.ok) await throwApiError(t, res);
      await refresh();
    } catch (e) {
      setError(caughtMessage(t, e));
    }
  };

  const openChangeModal = (token: TokenRow) => {
    setChangeTarget(token);
    setChanging(false);
    setChangeError(null);
  };

  const closeChangeModal = () => {
    setChangeTarget(null);
    setChanging(false);
    setChangeError(null);
  };

  // ─── Scope-change modal handlers ──────────────────────────────────────
  const openScopeModal = (token: TokenRow) => {
    setScopeTarget(token);
    setScopeOrgId(token.organizationId);
    setScopeProjectId(token.projectId);
    setSavingScope(false);
    setScopeError(null);
  };

  const closeScopeModal = () => {
    setScopeTarget(null);
    setScopeOrgId(null);
    setScopeProjectId(null);
    setSavingScope(false);
    setScopeError(null);
  };

  const onSaveScope = async () => {
    if (!scopeTarget || savingScope) return;
    setSavingScope(true);
    setScopeError(null);
    try {
      const res = await fetch(`/api/tokens/${scopeTarget.id}/scope`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: scopeOrgId,
          projectId: scopeProjectId,
        }),
      });
      if (!res.ok) await throwApiError(t, res);
      closeScopeModal();
      await refresh();
    } catch (e) {
      setScopeError(caughtMessage(t, e));
      setSavingScope(false);
    }
  };

  const onChange = async () => {
    if (!changeTarget || changing) return;
    setChanging(true);
    setChangeError(null);
    try {
      const res = await fetch(`/api/tokens/${changeTarget.id}/change`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) await throwApiError(t, res);
      const data = (await res.json()) as { raw: string; token: { id: string } };
      setFreshRaw(data.raw);
      setFreshTokenId(data.token.id);
      closeChangeModal();
      await refresh();
    } catch (e) {
      setChangeError(caughtMessage(t, e));
      setChanging(false);
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
          {t("tokens.title")}
        </h1>
        <HelpPopover
          content={{
            what: t("tokens.help_what"),
            whatToDo: [
              t("tokens.help_todo_1"),
              t("tokens.help_todo_2"),
              t("tokens.help_todo_3"),
              t("tokens.help_todo_4"),
            ],
            docHref: "/docs/concepts/tokens",
          }}
        />
      </div>
      {/* UX-newcomer-pass-3 (iter 24): replaced "MCP tokens" / "Bearer
          token" / "hashed (SHA-256) at rest" jargon with newcomer-friendly
          phrasing. The full technical detail still lives in the
          docs/concepts/tokens link, and the install wizard below shows
          the literal "Bearer" header for clients that need it. */}
      <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 28px", lineHeight: 1.55 }}>
        {t("tokens.intro")}
      </p>

      {freshRaw && freshTokenId && (
        <TokenInstallWizard
          rawToken={freshRaw}
          tokenId={freshTokenId}
          mcpUrl={mcpUrl ?? resolveMcpUrl()}
          webUrl={webUrl ?? resolveWebUrl()}
          onClose={() => {
            setFreshRaw(null);
            setFreshTokenId(null);
          }}
        />
      )}

      <section className="panel" style={{ padding: "16px 18px", marginBottom: 28 }}>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 10 }}>
          {t("tokens.create_heading")}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("tokens.name_placeholder")}
            aria-label={t("tokens.name_label")}
            style={{
              flex: 1,
              padding: "8px 10px",
              fontSize: 13,
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: 4,
              color: "var(--ink)",
              fontFamily: "inherit",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onCreate();
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void onCreate()}
            disabled={!name.trim() || creating}
          >
            {creating ? t("common.creating") : t("common.create")}
          </button>
        </div>
        {/* Org + project pickers. Org picker shown when the user is in
            multiple orgs; project picker shown when the chosen org (or
            the only org) has multiple projects. Both default to the
            broadest scope ("any"). */}
        {orgs.length >= 2 && (
          <div style={{ marginTop: 10 }}>
            <label
              htmlFor="token-org-picker"
              style={{ fontSize: 12, color: "var(--ink-3)", display: "block", marginBottom: 4 }}
            >
              {t("tokens.org_scope")}
            </label>
            <select
              id="token-org-picker"
              value={selectedOrgId ?? ""}
              onChange={(e) => {
                setSelectedOrgId(e.target.value || null);
                setSelectedProjectId(null); // reset project when org changes
              }}
              style={pickerStyle}
            >
              <option value="">{t("tokens.any_org")}</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {(() => {
          const projectsInScope = selectedOrgId
            ? projects.filter((p) => p.orgId === selectedOrgId)
            : projects;
          if (projectsInScope.length < 2) return null;
          return (
            <div style={{ marginTop: 10 }}>
              <label
                htmlFor="token-project-picker"
                style={{ fontSize: 12, color: "var(--ink-3)", display: "block", marginBottom: 4 }}
              >
                {t("tokens.project_scope")}
              </label>
              <select
                id="token-project-picker"
                value={selectedProjectId ?? ""}
                onChange={(e) => setSelectedProjectId(e.target.value || null)}
                style={pickerStyle}
              >
                <option value="">{t("tokens.any_project_in_org")}</option>
                {projectsInScope.map((p) => (
                  <option key={p.id} value={p.id}>
                    {selectedOrgId ? p.name : `${p.orgName} / ${p.name}`}
                  </option>
                ))}
              </select>
            </div>
          );
        })()}

        {/* Capability allow-list. Unchecked-everything = unrestricted, which
            is deliberately the default: it is what every existing token has,
            and it means the common case needs no decision. Checking any box
            turns the token into an allow-list — the primitive offered instead
            of partitioning skills by project (KNOWN_ISSUES §0q). */}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 4 }}>
            {t("tokens.capabilities")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {CAPABILITIES.map((cap) => (
              <label
                key={cap}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={selectedCaps.includes(cap)}
                  onChange={(e) =>
                    setSelectedCaps((prev) =>
                      e.target.checked ? [...prev, cap] : prev.filter((c) => c !== cap),
                    )
                  }
                  style={{ width: 14, height: 14, accentColor: "var(--accent)" }}
                />
                {t(`tokens.caps.${cap}`)}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 4 }}>
            {selectedCaps.length === 0
              ? t("tokens.caps_none")
              : t("tokens.caps_some", { list: capList(t, selectedCaps) })}
          </div>
        </div>
      </section>

      <section>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 10, letterSpacing: "0.06em" }}>
          {t("tokens.existing_heading", { n: tokens.filter((tok) => !tok.revokedAt).length })}
        </div>

        {loading && <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("common.loading")}</div>}
        {error && (
          <div
            role="alert"
            className="panel"
            style={{ padding: "10px 12px", fontSize: 13, borderLeft: "3px solid var(--bad, #ff6b6b)" }}
          >
            {error}
          </div>
        )}
        {!loading && tokens.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>
            {t("tokens.none_yet")}
          </div>
        )}

        {tokens.map((tok) => {
          const revoked = !!tok.revokedAt;
          const expired = tok.expiresAt ? new Date(tok.expiresAt) < new Date() : false;
          const active = !revoked && !expired;
          // scheduledRevokeAt may still be set on rows from old rotations;
          // the auth gate already handles enforcement — we keep the column but no longer
          // surface a pending-rotation concept in the UI.
          const canChange = active;

          // Resolve org + project names from the loaded list.
          const orgName = tok.organizationId
            ? (orgs.find((o) => o.id === tok.organizationId)?.name ?? tok.organizationId.slice(0, 10))
            : null;
          const projectName = tok.projectId
            ? (projects.find((p) => p.id === tok.projectId)?.name ?? tok.projectId.slice(0, 10))
            : null;

          return (
            <div
              key={tok.id}
              className="panel"
              style={{
                padding: "12px 14px",
                marginBottom: 6,
                opacity: revoked || expired ? 0.5 : 1,
                borderLeft: `3px solid ${revoked || expired ? "var(--ink-4)" : "var(--accent)"}`,
              }}
            >
              <div className="row">
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{tok.name}</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 3 }}>
                    {[
                      t(tok.scope === "team" ? "tokens.scope_team" : "tokens.scope_personal"),
                      t("tokens.meta_created", { date: fmt(tok.createdAt) }),
                      tok.lastUsedAt
                        ? t("tokens.meta_last_used", { date: fmt(tok.lastUsedAt) })
                        : t("tokens.meta_never_used"),
                      tok.expiresAt ? t("tokens.meta_expires", { date: fmt(tok.expiresAt) }) : null,
                      revoked ? t("tokens.meta_revoked") : expired ? t("tokens.meta_expired") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {/* Scope chips — org + project. Org chip only renders
                      when the user is in multiple orgs (otherwise it's
                      redundant with "personal org"). Project chip is
                      always shown so the read of the token's authority
                      is unambiguous. */}
                  <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {orgs.length >= 2 && (
                      <span className="mono" style={chipStyle}>
                        {orgName ? t("tokens.chip_org", { name: orgName }) : t("tokens.chip_org_personal")}
                      </span>
                    )}
                    <span className="mono" style={chipStyle}>
                      {projectName ? t("tokens.chip_project", { name: projectName }) : t("tokens.chip_any_project")}
                    </span>
                    {/* Capability chip. Only rendered when the token IS
                        restricted — an "unrestricted" chip on every row would
                        be noise, and the read that matters is "which of these
                        is limited?", not "which is normal?". */}
                    {(tok.capabilities?.length ?? 0) > 0 && (
                      <span
                        className="mono"
                        style={{ ...chipStyle, borderColor: "var(--warn, #F5C451)", color: "var(--warn, #F5C451)" }}
                        title={t("tokens.caps_some", { list: capList(t, tok.capabilities!) })}
                      >
                        {t("tokens.chip_limited", { list: capList(t, tok.capabilities!) })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="grow" />
                <div className="row" style={{ gap: 6 }}>
                  {active && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => void onVerify(tok.id)}
                      disabled={verify[tok.id]?.loading === true}
                      title={t("tokens.verify_title")}
                    >
                      {verify[tok.id]?.loading === true ? t("tokens.verifying") : t("tokens.verify")}
                    </button>
                  )}
                  {active && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => openScopeModal(tok)}
                      title={t("tokens.scope_title")}
                    >
                      {t("tokens.scope_btn")}
                    </button>
                  )}
                  {canChange && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => openChangeModal(tok)}
                      title={t("tokens.change_title")}
                    >
                      {t("tokens.change_btn")}
                    </button>
                  )}
                  {active && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => void onRevoke(tok.id)}
                    >
                      {t("tokens.revoke_btn")}
                    </button>
                  )}
                </div>
              </div>
              {(() => {
                const v = verify[tok.id];
                if (!v || v.loading) return null;
                return (
                  <div
                    role="status"
                    aria-live="polite"
                    style={{
                      marginTop: 8,
                      fontSize: 13,
                      color: v.result.ok ? "var(--good, #22c55e)" : "var(--bad, #ff6b6b)",
                    }}
                  >
                    {v.result.ok
                      ? `\u2713 ${t("tokens.test_ok_now")}`
                      : `\u2717 ${tokenTestMessage(t, lang, v.result)}`}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </section>

      {/* ─── Scope-change modal ───────────────────────────────────────────── */}
      {scopeTarget && (
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
          onClick={(e) => { if (e.target === e.currentTarget) closeScopeModal(); }}
        >
          <div
            className="panel"
            style={{
              width: "min(480px, 90vw)",
              padding: "24px 24px 20px",
              background: "var(--bg-elev-1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 4px", letterSpacing: "-0.01em" }}>
              {t("tokens.scope_modal_title", { name: scopeTarget.name })}
            </h2>
            <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 18px", lineHeight: 1.55 }}>
              {t("tokens.scope_modal_body")}
            </p>

            <div style={{ marginBottom: 12 }}>
              <label htmlFor="scope-org-picker" style={{ fontSize: 12, color: "var(--ink-3)", display: "block", marginBottom: 4 }}>
                {t("common.organization")}
              </label>
              <select
                id="scope-org-picker"
                value={scopeOrgId ?? ""}
                onChange={(e) => {
                  setScopeOrgId(e.target.value || null);
                  setScopeProjectId(null);
                }}
                style={{ ...pickerStyle, width: "100%" }}
                disabled={savingScope}
              >
                <option value="">{t("tokens.any_org")}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="scope-project-picker" style={{ fontSize: 12, color: "var(--ink-3)", display: "block", marginBottom: 4 }}>
                {t("common.project")}
              </label>
              <select
                id="scope-project-picker"
                value={scopeProjectId ?? ""}
                onChange={(e) => setScopeProjectId(e.target.value || null)}
                style={{ ...pickerStyle, width: "100%" }}
                disabled={savingScope}
              >
                <option value="">{t("tokens.any_project_within")}</option>
                {(scopeOrgId ? projects.filter((p) => p.orgId === scopeOrgId) : projects).map((p) => (
                  <option key={p.id} value={p.id}>
                    {scopeOrgId ? p.name : `${p.orgName} / ${p.name}`}
                  </option>
                ))}
              </select>
            </div>

            {scopeError && (
              <div
                role="alert"
                style={{
                  fontSize: 13,
                  color: "var(--bad, #ff6b6b)",
                  marginBottom: 14,
                  padding: "8px 10px",
                  background: "var(--bg)",
                  border: "1px solid var(--bad, #ff6b6b)",
                  borderRadius: 4,
                }}
              >
                {scopeError}
              </div>
            )}

            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={closeScopeModal} disabled={savingScope}>
                {t("common.cancel")}
              </button>
              <button type="button" className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => void onSaveScope()} disabled={savingScope}>
                {savingScope ? t("common.saving") : t("tokens.save_scope")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Change modal ─────────────────────────────────────────────────────── */}
      {changeTarget && (
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
          onClick={(e) => { if (e.target === e.currentTarget) closeChangeModal(); }}
        >
          <div
            className="panel"
            style={{
              width: "min(480px, 90vw)",
              padding: "24px 24px 20px",
              background: "var(--bg-elev-1)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 4px", letterSpacing: "-0.01em" }}>
              {t("tokens.change_modal_title", { name: changeTarget.name })}
            </h2>
            <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 18px", lineHeight: 1.55 }}>
              {t("tokens.change_modal_body")}
            </p>

            {changeError && (
              <div
                role="alert"
                style={{
                  fontSize: 13,
                  color: "var(--bad, #ff6b6b)",
                  marginBottom: 14,
                  padding: "8px 10px",
                  background: "var(--bg)",
                  border: "1px solid var(--bad, #ff6b6b)",
                  borderRadius: 4,
                }}
              >
                {changeError}
              </div>
            )}

            <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: 12 }}
                onClick={closeChangeModal}
                disabled={changing}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 13, background: "var(--bad, #ff6b6b)", borderColor: "var(--bad, #ff6b6b)" }}
                onClick={() => void onChange()}
                disabled={changing}
              >
                {changing ? t("tokens.changing") : t("tokens.change_confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ─── Shared inline-style helpers ─────────────────────────────────────────
const pickerStyle = {
  padding: "6px 8px",
  fontSize: 13,
  background: "var(--bg)",
  border: "1px solid var(--line)",
  borderRadius: 4,
  color: "var(--ink)",
  fontFamily: "inherit",
  minWidth: 220,
} as const;

const chipStyle = {
  fontSize: 11,
  color: "var(--ink-3)",
  background: "var(--bg)",
  border: "1px solid var(--line)",
  borderRadius: 3,
  padding: "1px 5px",
  display: "inline-block",
} as const;

// Unknown slugs (a capability added server-side before this UI learns it)
// render as the slug rather than a missing-key path.
function capList(t: Translate, caps: string[]): string {
  return caps.map((c) => (isCapability(c) ? t(`tokens.caps.${c}`) : c)).join(", ");
}

function fmtDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Dev-only fallback. On a real deploy the server component passes the
// TLS-fronted URL down; this `${origin}:3100` guess is wrong behind Caddy
// (the MCP host is its own vhost on :443 — see deploy/Caddyfile). Same
// hazard #293 fixed for /welcome.
function resolveMcpUrl(): string {
  if (typeof window === "undefined") return "http://localhost:3100/mcp";
  return `${window.location.protocol}//${window.location.hostname}:3100/mcp`;
}

function resolveWebUrl(): string {
  if (typeof window === "undefined") return "http://localhost:3000";
  return `${window.location.protocol}//${window.location.host}`;
}
