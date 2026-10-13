"use client";

/**
 * /admin/org — Org member management page.
 *
 * Sections:
 *  1. Members list — role-dropdown (owner/admin), joined-date, Remove button
 *  2. Pending invites list — email, role, expiry, Revoke button
 *  3. Invite member form — email + role → POST → display copyable link
 *
 * Visual style mirrors /settings/tokens.
 * Guard: only org owner/admin can view; renders 403 message otherwise.
 */

import { useCallback, useEffect, useState } from "react";
import { useLang, useT } from "@/lib/brain/i18n";
import { roleLabel } from "@/lib/brain/roles";
import { caughtMessage, throwApiError } from "@/lib/brain/api-error";

// ─── types ─────────────────────────────────────────────────────────────────

interface OrgMember {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  joinedAt: string;
}

interface OrgInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  status: string;
}

interface OrgData {
  id: string;
  name: string;
  role: string;
}

// ─── helpers ───────────────────────────────────────────────────────────────

function fmt(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
  background: "var(--bg-elev-1)",
  color: "var(--ink)",
  width: "100%",
};

const btnStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "6px 14px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  background: "var(--bg-elev-1)",
  color: "var(--ink)",
};

const dangerBtnStyle: React.CSSProperties = {
  ...btnStyle,
  color: "#e05252",
  borderColor: "#e05252",
};

const flashStyle: React.CSSProperties = {
  background: "var(--bg-elev-1)",
  border: "1px solid var(--accent)",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  color: "var(--accent-text)",
  marginBottom: 16,
  wordBreak: "break-all",
};

const errorStyle: React.CSSProperties = {
  background: "rgba(224,82,82,0.07)",
  border: "1px solid rgba(224,82,82,0.3)",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  color: "#e05252",
  marginBottom: 16,
};

// ─── OrgSelector ──────────────────────────────────────────────────────────

function OrgSelector({
  orgs,
  selected,
  onChange,
}: {
  orgs: OrgData[];
  selected: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  if (orgs.length === 1) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <label htmlFor="org-selector" style={labelStyle}>{t("common.organization")}</label>
      <select
        id="org-selector"
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, marginTop: 4, maxWidth: 320 }}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({roleLabel(t, o.role)})
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── MembersSection ───────────────────────────────────────────────────────

function MembersSection({
  orgId,
  viewerRole,
  onAction,
}: {
  orgId: string;
  viewerRole: string;
  onAction: (msg: string, isError?: boolean) => void;
}) {
  const t = useT();
  const lang = useLang();
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = viewerRole === "owner" || viewerRole === "admin";

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/members`, { cache: "no-store" });
      if (!res.ok) await throwApiError(t, res);
      const data = (await res.json()) as { members: OrgMember[] };
      setMembers(data.members);
      setError(null);
    } catch (e) {
      setError(caughtMessage(t, e));
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = async (userId: string, newRole: string) => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) await throwApiError(t, res);
      onAction(t("org.role_updated", { role: roleLabel(t, newRole) }));
      void load();
    } catch (e) {
      onAction(caughtMessage(t, e), true);
    }
  };

  const remove = async (userId: string, email: string) => {
    if (!confirm(t("org.remove_confirm", { email }))) return;
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) await throwApiError(t, res);
      onAction(t("org.removed", { email }));
      void load();
    } catch (e) {
      onAction(caughtMessage(t, e), true);
    }
  };

  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>{t("org.members")}</h2>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      {!members && !error && (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>{t("common.loading")}</div>
      )}
      {members && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {[t("org.col_name"), t("common.role"), t("org.col_joined"), canManage ? t("org.col_actions") : ""].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "6px 8px",
                    borderBottom: "1px solid var(--line)",
                    ...labelStyle,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "8px 8px" }}>
                  <div style={{ fontWeight: 500 }}>{m.name ?? m.email}</div>
                  {m.name && (
                    <div style={{ color: "var(--ink-3)", fontSize: 11 }}>{m.email}</div>
                  )}
                </td>
                <td style={{ padding: "8px 8px" }}>
                  {canManage ? (
                    <select
                      value={m.role}
                      aria-label={t("org.role_for", { name: m.name ?? m.email })}
                      onChange={(e) => void changeRole(m.userId, e.target.value)}
                      style={{ ...btnStyle, padding: "4px 8px" }}
                    >
                      <option value="member">{roleLabel(t, "member")}</option>
                      <option value="admin">{roleLabel(t, "admin")}</option>
                      <option value="owner">{roleLabel(t, "owner")}</option>
                    </select>
                  ) : (
                    <span className="mono" style={{ fontSize: 11 }}>
                      {roleLabel(t, m.role)}
                    </span>
                  )}
                </td>
                <td style={{ padding: "8px 8px", color: "var(--ink-3)", fontSize: 12 }}>
                  {fmt(m.joinedAt, lang)}
                </td>
                {canManage && (
                  <td style={{ padding: "8px 8px" }}>
                    <button
                      style={dangerBtnStyle}
                      onClick={() => void remove(m.userId, m.email)}
                    >
                      {t("org.remove")}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ─── InvitesSection ───────────────────────────────────────────────────────

function InvitesSection({
  orgId,
  onAction,
}: {
  orgId: string;
  onAction: (msg: string, isError?: boolean) => void;
}) {
  const t = useT();
  const lang = useLang();
  const [invites, setInvites] = useState<OrgInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/invites`, { cache: "no-store" });
      if (!res.ok) await throwApiError(t, res);
      const data = (await res.json()) as { invites: OrgInvite[] };
      setInvites(data.invites);
      setError(null);
    } catch (e) {
      setError(caughtMessage(t, e));
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (inviteId: string, email: string) => {
    if (!confirm(t("org.revoke_confirm", { email }))) return;
    try {
      const res = await fetch(`/api/orgs/${orgId}/invites/${inviteId}`, {
        method: "DELETE",
      });
      if (!res.ok) await throwApiError(t, res);
      onAction(t("org.invite_revoked"));
      void load();
    } catch (e) {
      onAction(caughtMessage(t, e), true);
    }
  };

  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>{t("org.pending")}</h2>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      {!invites && !error && (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>{t("common.loading")}</div>
      )}
      {invites && invites.length === 0 && (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>{t("org.no_invites")}</div>
      )}
      {invites && invites.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {[t("common.email"), t("common.role"), t("org.col_expires"), t("org.col_actions")].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "6px 8px",
                    borderBottom: "1px solid var(--line)",
                    ...labelStyle,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={{ padding: "8px 8px" }}>{inv.email}</td>
                <td style={{ padding: "8px 8px" }}>
                  <span className="mono" style={{ fontSize: 11 }}>
                    {roleLabel(t, inv.role)}
                  </span>
                </td>
                <td style={{ padding: "8px 8px", color: "var(--ink-3)", fontSize: 12 }}>
                  {fmt(inv.expiresAt, lang)}
                </td>
                <td style={{ padding: "8px 8px" }}>
                  <button
                    style={dangerBtnStyle}
                    onClick={() => void revoke(inv.id, inv.email)}
                  >
                    {t("org.revoke")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ─── InviteForm ───────────────────────────────────────────────────────────

function InviteForm({
  orgId,
  onInvited,
}: {
  orgId: string;
  onInvited: (link: string, email: string) => void;
}) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin" | "owner">("member");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      if (!res.ok) await throwApiError(t, res);
      const data = (await res.json()) as { link: string; invite: { email: string } };
      setEmail("");
      setRole("member");
      onInvited(data.link, data.invite.email);
    } catch (err) {
      setError(caughtMessage(t, err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>{t("org.invite_heading")}</h2>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <form
        onSubmit={(e) => void submit(e)}
        style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 160 }}>
          <label htmlFor="invite-email" style={{ ...labelStyle, display: "block", marginBottom: 4 }}>{t("common.email")}</label>
          <input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="invitee@example.com"
            required
            style={inputStyle}
          />
        </div>
        <div style={{ flex: "0 0 140px" }}>
          <label htmlFor="invite-role" style={{ ...labelStyle, display: "block", marginBottom: 4 }}>{t("common.role")}</label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin" | "owner")}
            style={inputStyle}
          >
            <option value="member">{roleLabel(t, "member")}</option>
            <option value="admin">{roleLabel(t, "admin")}</option>
            <option value="owner">{roleLabel(t, "owner")}</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={creating || !email.trim()}
          style={{ ...btnStyle, borderColor: "var(--accent)", color: "var(--accent-text)" }}
        >
          {creating ? t("org.inviting") : t("org.send_invite")}
        </button>
      </form>
    </section>
  );
}

// ─── CreateOrgForm ──────────────────────────────────────────────────────────

function CreateOrgForm({
  onCreated,
  onError,
}: {
  onCreated: (org: OrgData) => void;
  onError: (msg: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) await throwApiError(t, res);
      const { org } = (await res.json()) as { org: OrgData };
      setName("");
      onCreated(org);
    } catch (err) {
      onError(caughtMessage(t, err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
      <label style={{ flex: "1 1 240px", minWidth: 0 }}>
        <span style={labelStyle}>{t("org.create_name")}</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder={t("org.create_placeholder")}
          style={{ ...inputStyle, marginTop: 4 }}
          required
        />
      </label>
      <button
        type="submit"
        disabled={creating || !name.trim()}
        style={{
          ...btnStyle,
          borderColor: "var(--accent)",
          color: "var(--accent-text)",
          opacity: creating || !name.trim() ? 0.6 : 1,
        }}
      >
        {creating ? t("common.creating") : t("org.create_btn")}
      </button>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function OrgPage() {
  const t = useT();
  const [orgs, setOrgs] = useState<OrgData[] | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [flash, setFlash] = useState<{ text: string; isLink: boolean; isError: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [copyFailed, setCopyFailed] = useState(false);

  const show = (text: string, isLink = false, isError = false) => {
    setFlash({ text, isLink, isError });
    setCopyFailed(false);
    // An error stays until the next action; a success note fades.
    if (!isLink && !isError) {
      window.setTimeout(() => setFlash(null), 3000);
    }
  };

  /**
   * Copy the once-shown invite link, and only dismiss it if the write
   * actually landed.
   *
   * The previous version fired `void navigator.clipboard.writeText(...)` and
   * cleared the flash on an unconditional 800 ms timer. `navigator.clipboard`
   * is `undefined` on a non-secure origin — which is the default `dev-up.sh`
   * posture (no TLS) — so the call threw, and on a secure origin a denied
   * permission prompt rejected a promise that `void` discarded. Either way the
   * link was gone 800 ms later and the admin had to revoke and re-issue it.
   */
  const copyInviteLink = async (text: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      window.setTimeout(() => setFlash(null), 800);
    } catch {
      // Keep the link on screen. It is still selectable, so manual copy works.
      setCopyFailed(true);
    }
  };

  const loadOrgs = useCallback(async () => {
    try {
      const res = await fetch("/api/orgs", { cache: "no-store" });
      if (!res.ok) await throwApiError(t, res);
      const data = (await res.json()) as {
        orgs: Array<{ id: string; name: string; role: string }>;
      };
      // Only show orgs where caller is owner or admin
      const manageable = data.orgs.filter(
        (o) => o.role === "owner" || o.role === "admin",
      );
      setOrgs(manageable);
      setSelectedOrgId((prev) =>
        prev && manageable.some((o) => o.id === prev)
          ? prev
          : manageable[0]?.id ?? "",
      );
    } catch (e) {
      setError(caughtMessage(t, e));
    }
  }, []);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  const onOrgCreated = (org: OrgData) => {
    setShowCreate(false);
    setSelectedOrgId(org.id);
    show(t("org.created", { name: org.name }));
    void loadOrgs();
  };

  const selectedOrg = orgs?.find((o) => o.id === selectedOrgId);

  if (error) {
    return (
      <div style={{ maxWidth: 960 }}>
        <div role="alert" style={errorStyle}>{error}</div>
      </div>
    );
  }

  if (!orgs) {
    return (
      <div style={{ maxWidth: 960, color: "var(--ink-3)", fontSize: 13 }}>
        {t("common.loading")}
      </div>
    );
  }

  if (orgs.length === 0) {
    // No org you can manage. Rather than a dead-end "Admins only" message,
    // offer to create one — every user can own organizations. (This also
    // recovers the edge case where the sign-in personal-org bootstrap was
    // skipped or failed, leaving a user with zero owned orgs.)
    return (
      <div style={{ maxWidth: 960 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 12px" }}>
          {t("common.organization")}
        </h1>
        {flash && !flash.isLink && (
          <div
            role={flash.isError ? "alert" : "status"}
            style={flash.isError ? errorStyle : { ...flashStyle, color: "var(--ink-2)" }}
          >
            {flash.text}
          </div>
        )}
        <div className="panel" style={{ padding: "20px 22px", maxWidth: 520 }}>
          <h2 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 500 }}>
            {t("org.first_title")}
          </h2>
          <p
            style={{
              margin: "0 0 16px",
              fontSize: 13,
              color: "var(--ink-3)",
              lineHeight: 1.55,
            }}
          >
            {t("org.first_body")}
          </p>
          <CreateOrgForm onCreated={onOrgCreated} onError={(m) => show(m, false, true)} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>
          {t("common.organization")}
        </h1>
        {selectedOrg && (
          <span style={{ color: "var(--ink-3)", fontSize: 13 }}>
            {selectedOrg.name}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          style={{ ...btnStyle, marginLeft: "auto" }}
        >
          {showCreate ? t("common.cancel") : t("org.new_org")}
        </button>
      </div>

      {showCreate && (
        <div className="panel" style={{ padding: "16px 18px", marginBottom: 24, maxWidth: 520 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 500 }}>
            {t("org.create_new_title")}
          </h2>
          <CreateOrgForm onCreated={onOrgCreated} onError={(m) => show(m, false, true)} />
        </div>
      )}

      {flash && (
        <div
          role={flash.isError ? "alert" : "status"}
          style={
            flash.isError
              ? errorStyle
              : flash.isLink
                ? flashStyle
                : { ...flashStyle, color: "var(--ink-2)" }
          }
        >
          {flash.isLink ? (
            <>
              <strong>{t("org.link_heading")}</strong>
              <br />
              <span
                style={{ cursor: "pointer", textDecoration: "underline" }}
                onClick={() => void copyInviteLink(flash.text)}
              >
                {flash.text}
              </span>
              <button
                onClick={() => void copyInviteLink(flash.text)}
                style={{ ...btnStyle, marginLeft: 12, fontSize: 11 }}
              >
                {t("common.copy")}
              </button>
              {copyFailed && (
                <div
                  role="alert"
                  style={{ marginTop: 8, fontSize: 12, color: "var(--warn, #d97757)" }}
                >
                  {t("org.clip_failed")}
                </div>
              )}
            </>
          ) : (
            flash.text
          )}
        </div>
      )}

      <OrgSelector
        orgs={orgs}
        selected={selectedOrgId}
        onChange={setSelectedOrgId}
      />

      {selectedOrgId && selectedOrg && (
        <>
          <MembersSection
            orgId={selectedOrgId}
            viewerRole={selectedOrg.role}
            onAction={(msg, isError) => show(msg, false, isError)}
          />

          {(selectedOrg.role === "owner" || selectedOrg.role === "admin") && (
            <>
              <InvitesSection
                orgId={selectedOrgId}
                onAction={(msg, isError) => show(msg, false, isError)}
              />
              <InviteForm
                orgId={selectedOrgId}
                onInvited={(link, _email) =>
                  show(link, true)
                }
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
