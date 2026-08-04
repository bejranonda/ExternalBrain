"use client";

// Subpath import, NOT the "@brain/core" barrel. This is a client component,
// and the barrel re-exports `logger.ts` → `@sentry/node` → `worker_threads`,
// which cannot be bundled for the browser ("Module not found: Can't resolve
// 'worker_threads'"). `capabilities.ts` has no imports at all, so it is safe
// to ship to the client. Same reason `token-install-wizard.tsx` imports from
// "@brain/core/install-snippets".
import { CAPABILITIES, CAPABILITY_LABELS, type Capability } from "@brain/core/capabilities";

import { useCallback, useEffect, useState } from "react";
import { TokenInstallWizard } from "@/components/brain/token-install-wizard";
import { HelpPopover } from "@/components/brain/help-popover";

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

export default function TokensPage() {
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
  type VerifyState =
    | { loading: true }
    | { loading: false; ok: true; at: number }
    | { loading: false; ok: false; reason: string; detail?: string; at: number };
  const [verify, setVerify] = useState<Record<string, VerifyState>>({});

  const onVerify = async (id: string) => {
    setVerify((m) => ({ ...m, [id]: { loading: true } }));
    try {
      const res = await fetch("/api/tokens/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId: id }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        reason?: string;
        expiresAt?: string;
        scheduledRevokeAt?: string;
      };
      const at = Date.now();
      if (!res.ok) {
        setVerify((m) => ({
          ...m,
          [id]: { loading: false, ok: false, reason: data.reason ?? `HTTP ${res.status}`, at },
        }));
        return;
      }
      if (data.ok) {
        setVerify((m) => ({ ...m, [id]: { loading: false, ok: true, at } }));
      } else {
        let detail: string | undefined;
        if (data.reason === "expired" && data.expiresAt) {
          detail = `expired at ${new Date(data.expiresAt).toLocaleString()}`;
        } else if (data.reason === "scheduled-revoke" && data.scheduledRevokeAt) {
          detail = `scheduled revoke at ${new Date(data.scheduledRevokeAt).toLocaleString()}`;
        }
        const fail: VerifyState = {
          loading: false,
          ok: false,
          reason: data.reason ?? "unknown",
          at,
        };
        if (detail !== undefined) fail.detail = detail;
        setVerify((m) => ({ ...m, [id]: fail }));
      }
    } catch (e) {
      setVerify((m) => ({
        ...m,
        [id]: {
          loading: false,
          ok: false,
          reason: e instanceof Error ? e.message : "request failed",
          at: Date.now(),
        },
      }));
    }
  };

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/tokens", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tokens: TokenRow[] };
      setTokens(data.tokens);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { raw: string; token: { id: string } };
      setFreshRaw(data.raw);
      setFreshTokenId(data.token.id);
      setName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (id: string) => {
    if (!window.confirm("Revoke this token? Any client using it will stop working.")) return;
    try {
      const res = await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "revoke failed");
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
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setScopeError(body.message ?? body.error ?? `HTTP ${res.status}`);
        setSavingScope(false);
        return;
      }
      closeScopeModal();
      await refresh();
    } catch (e) {
      setScopeError(e instanceof Error ? e.message : "save failed");
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
      if (!res.ok) {
        const body = (await res.json()) as { error?: string; message?: string };
        const msg = body.message ?? body.error ?? `HTTP ${res.status}`;
        setChangeError(msg);
        setChanging(false);
        return;
      }
      const data = (await res.json()) as { raw: string; token: { id: string } };
      setFreshRaw(data.raw);
      setFreshTokenId(data.token.id);
      closeChangeModal();
      await refresh();
    } catch (e) {
      setChangeError(e instanceof Error ? e.message : "change failed");
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
      <a href="/" className="mono" style={{ fontSize: 12, color: "var(--ink-3)", textDecoration: "none" }}>
        ← back to Brain
      </a>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 6px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0, letterSpacing: "-0.02em" }}>
          Access tokens
        </h1>
        <HelpPopover
          content={{
            what: "Access tokens let your AI tools (Claude Code, Cursor, …) connect to this Brain. One token per machine × tool keeps things easy to revoke if a laptop is lost.",
            whatToDo: [
              "Click Create to mint a new token — copy it now, you can't retrieve it later.",
              "Verify checks the token is still active.",
              "Scope restricts a token to one org or project (defaults to all your access).",
              "Change replaces the secret in place; Revoke disables the token entirely.",
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
        Each AI tool (Claude Code, Cursor, Windsurf, Autobahn) needs a token to talk to this
        Brain. Treat tokens like passwords — they show only once when created. Lost a token?
        Revoke it and create a new one.
      </p>

      {freshRaw && freshTokenId && (
        <TokenInstallWizard
          rawToken={freshRaw}
          tokenId={freshTokenId}
          mcpUrl={resolveMcpUrl()}
          webUrl={resolveWebUrl()}
          onClose={() => {
            setFreshRaw(null);
            setFreshTokenId(null);
          }}
        />
      )}

      <section className="panel" style={{ padding: "16px 18px", marginBottom: 28 }}>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 10 }}>
          CREATE NEW TOKEN
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. laptop · claude-code"
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
            {creating ? "Creating…" : "Create"}
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
              Organization scope
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
              <option value="">Any org — broadest scope (default)</option>
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
                Project scope
              </label>
              <select
                id="token-project-picker"
                value={selectedProjectId ?? ""}
                onChange={(e) => setSelectedProjectId(e.target.value || null)}
                style={pickerStyle}
              >
                <option value="">Any project in this org</option>
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
            Capabilities
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
                {CAPABILITY_LABELS[cap]}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 4 }}>
            {selectedCaps.length === 0
              ? "Nothing checked — the token can do everything (the default)."
              : `Restricted: this token may only ${selectedCaps.map((c) => CAPABILITY_LABELS[c as Capability].toLowerCase()).join(", ")}.`}
          </div>
        </div>
      </section>

      <section>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 10, letterSpacing: "0.06em" }}>
          EXISTING TOKENS ({tokens.filter((t) => !t.revokedAt).length} active)
        </div>

        {loading && <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading…</div>}
        {error && (
          <div
            className="panel"
            style={{ padding: "10px 12px", fontSize: 13, borderLeft: "3px solid var(--bad, #ff6b6b)" }}
          >
            {error}
          </div>
        )}
        {!loading && tokens.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--ink-3)", padding: "8px 0" }}>
            No tokens yet. Create one to wire up your first MCP client.
          </div>
        )}

        {tokens.map((t) => {
          const revoked = !!t.revokedAt;
          const expired = t.expiresAt ? new Date(t.expiresAt) < new Date() : false;
          const active = !revoked && !expired;
          // scheduledRevokeAt may still be set on rows from old rotations;
          // the auth gate already handles enforcement — we keep the column but no longer
          // surface a pending-rotation concept in the UI.
          const canChange = active;

          // Resolve org + project names from the loaded list.
          const orgName = t.organizationId
            ? (orgs.find((o) => o.id === t.organizationId)?.name ?? t.organizationId.slice(0, 10))
            : null;
          const projectName = t.projectId
            ? (projects.find((p) => p.id === t.projectId)?.name ?? t.projectId.slice(0, 10))
            : null;

          return (
            <div
              key={t.id}
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
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 3 }}>
                    {t.scope} · created {fmt(t.createdAt)}
                    {t.lastUsedAt ? ` · last used ${fmt(t.lastUsedAt)}` : " · never used"}
                    {t.expiresAt ? ` · expires ${fmt(t.expiresAt)}` : ""}
                    {revoked ? " · revoked" : expired ? " · expired" : ""}
                  </div>
                  {/* Scope chips — org + project. Org chip only renders
                      when the user is in multiple orgs (otherwise it's
                      redundant with "personal org"). Project chip is
                      always shown so the read of the token's authority
                      is unambiguous. */}
                  <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {orgs.length >= 2 && (
                      <span className="mono" style={chipStyle}>
                        {orgName ? `Org: ${orgName}` : "Org: personal"}
                      </span>
                    )}
                    <span className="mono" style={chipStyle}>
                      {projectName ? `Project: ${projectName}` : "Any project"}
                    </span>
                    {/* Capability chip. Only rendered when the token IS
                        restricted — an "unrestricted" chip on every row would
                        be noise, and the read that matters is "which of these
                        is limited?", not "which is normal?". */}
                    {(t.capabilities?.length ?? 0) > 0 && (
                      <span
                        className="mono"
                        style={{ ...chipStyle, borderColor: "var(--warn, #F5C451)", color: "var(--warn, #F5C451)" }}
                        title={`Restricted to: ${t.capabilities!.join(", ")}`}
                      >
                        Limited: {t.capabilities!.join(", ")}
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
                      onClick={() => void onVerify(t.id)}
                      disabled={verify[t.id]?.loading === true}
                      title="Check that this token is still active on the server"
                    >
                      {verify[t.id]?.loading === true ? "Verifying…" : "Verify"}
                    </button>
                  )}
                  {active && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => openScopeModal(t)}
                      title="Change which org/project this token can access"
                    >
                      Scope
                    </button>
                  )}
                  {canChange && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => openChangeModal(t)}
                      title="Change the token's secret in place (same row, new bp_ value)"
                    >
                      Change
                    </button>
                  )}
                  {active && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11 }}
                      onClick={() => void onRevoke(t.id)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
              {(() => {
                const v = verify[t.id];
                if (!v || v.loading) return null;
                return (
                  <div
                    role="status"
                    aria-live="polite"
                    style={{
                      marginTop: 8,
                      fontSize: 13,
                      color: v.ok ? "var(--good, #22c55e)" : "var(--bad, #ff6b6b)",
                    }}
                  >
                    {v.ok ? (
                      <>&#10003; Token is active — checked just now</>
                    ) : (
                      <>
                        &#10007; {v.reason}
                        {v.detail ? ` — ${v.detail}` : ""}
                      </>
                    )}
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
              Change scope: {scopeTarget.name}
            </h2>
            <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 18px", lineHeight: 1.55 }}>
              Restrict this token to a specific organization or project. The token&apos;s
              secret stays the same — clients keep working without re-pasting. The new
              scope takes effect on the next request the token makes.
            </p>

            <div style={{ marginBottom: 12 }}>
              <label htmlFor="scope-org-picker" style={{ fontSize: 12, color: "var(--ink-3)", display: "block", marginBottom: 4 }}>
                Organization
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
                <option value="">Any org — broadest scope (default)</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="scope-project-picker" style={{ fontSize: 12, color: "var(--ink-3)", display: "block", marginBottom: 4 }}>
                Project
              </label>
              <select
                id="scope-project-picker"
                value={scopeProjectId ?? ""}
                onChange={(e) => setScopeProjectId(e.target.value || null)}
                style={{ ...pickerStyle, width: "100%" }}
                disabled={savingScope}
              >
                <option value="">Any project (within the chosen org)</option>
                {(scopeOrgId ? projects.filter((p) => p.orgId === scopeOrgId) : projects).map((p) => (
                  <option key={p.id} value={p.id}>
                    {scopeOrgId ? p.name : `${p.orgName} / ${p.name}`}
                  </option>
                ))}
              </select>
            </div>

            {scopeError && (
              <div
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
                Cancel
              </button>
              <button type="button" className="btn btn-primary" style={{ fontSize: 12 }} onClick={() => void onSaveScope()} disabled={savingScope}>
                {savingScope ? "Saving…" : "Save scope"}
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
              Change token secret: {changeTarget.name}
            </h2>
            <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 18px", lineHeight: 1.55 }}>
              Change the token&apos;s secret immediately. The current secret stops working as soon as
              you confirm. Use this for routine refresh or after a suspected leak. For a
              no-disruption swap: create a new token, update clients, then revoke this one.
            </p>

            {changeError && (
              <div
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
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 13, background: "var(--bad, #ff6b6b)", borderColor: "var(--bad, #ff6b6b)" }}
                onClick={() => void onChange()}
                disabled={changing}
              >
                {changing ? "Changing…" : "Change token"}
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

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveMcpUrl(): string {
  if (typeof window === "undefined") return "http://localhost:3100/mcp";
  // Default guess: same host, port 3100. User can edit the snippet if
  // they deployed the MCP server elsewhere.
  return `${window.location.protocol}//${window.location.hostname}:3100/mcp`;
}

function resolveWebUrl(): string {
  if (typeof window === "undefined") return "http://localhost:3000";
  return `${window.location.protocol}//${window.location.host}`;
}
