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

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
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
  if (orgs.length === 1) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={labelStyle}>Organization</label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, marginTop: 4, maxWidth: 320 }}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} ({o.role})
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
  onAction: (msg: string) => void;
}) {
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canManage = viewerRole === "owner" || viewerRole === "admin";

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/members`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { members: OrgMember[] };
      setMembers(data.members);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
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
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      onAction(`Role updated to ${newRole}.`);
      void load();
    } catch (e) {
      onAction(e instanceof Error ? e.message : "role change failed");
    }
  };

  const remove = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email} from this org?`)) return;
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      onAction(`${email} removed.`);
      void load();
    } catch (e) {
      onAction(e instanceof Error ? e.message : "remove failed");
    }
  };

  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>Members</h2>
      {error && <div style={errorStyle}>{error}</div>}
      {!members && !error && (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
      )}
      {members && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Name / Email", "Role", "Joined", canManage ? "Actions" : ""].map((h) => (
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
                      onChange={(e) => void changeRole(m.userId, e.target.value)}
                      style={{ ...btnStyle, padding: "4px 8px" }}
                    >
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                      <option value="owner">owner</option>
                    </select>
                  ) : (
                    <span className="mono" style={{ fontSize: 11 }}>
                      {m.role}
                    </span>
                  )}
                </td>
                <td style={{ padding: "8px 8px", color: "var(--ink-3)", fontSize: 12 }}>
                  {fmt(m.joinedAt)}
                </td>
                {canManage && (
                  <td style={{ padding: "8px 8px" }}>
                    <button
                      style={dangerBtnStyle}
                      onClick={() => void remove(m.userId, m.email)}
                    >
                      Remove
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
  onAction: (msg: string) => void;
}) {
  const [invites, setInvites] = useState<OrgInvite[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orgs/${orgId}/invites`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { invites: OrgInvite[] };
      setInvites(data.invites);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (inviteId: string, email: string) => {
    if (!confirm(`Revoke invite for ${email}?`)) return;
    try {
      const res = await fetch(`/api/orgs/${orgId}/invites/${inviteId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      onAction("Invite revoked.");
      void load();
    } catch (e) {
      onAction(e instanceof Error ? e.message : "revoke failed");
    }
  };

  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>Pending invites</h2>
      {error && <div style={errorStyle}>{error}</div>}
      {!invites && !error && (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
      )}
      {invites && invites.length === 0 && (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>No active invites.</div>
      )}
      {invites && invites.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Email", "Role", "Expires", "Actions"].map((h) => (
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
                    {inv.role}
                  </span>
                </td>
                <td style={{ padding: "8px 8px", color: "var(--ink-3)", fontSize: 12 }}>
                  {fmt(inv.expiresAt)}
                </td>
                <td style={{ padding: "8px 8px" }}>
                  <button
                    style={dangerBtnStyle}
                    onClick={() => void revoke(inv.id, inv.email)}
                  >
                    Revoke
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
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { link: string; invite: { email: string } };
      setEmail("");
      setRole("member");
      onInvited(data.link, data.invite.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "invite failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 16, fontWeight: 500, margin: "0 0 12px" }}>Invite a member</h2>
      {error && <div style={errorStyle}>{error}</div>}
      <form
        onSubmit={(e) => void submit(e)}
        style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 160 }}>
          <label style={{ ...labelStyle, display: "block", marginBottom: 4 }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="invitee@example.com"
            required
            style={inputStyle}
          />
        </div>
        <div style={{ flex: "0 0 140px" }}>
          <label style={{ ...labelStyle, display: "block", marginBottom: 4 }}>Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin" | "owner")}
            style={inputStyle}
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
            <option value="owner">owner</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={creating || !email.trim()}
          style={{ ...btnStyle, borderColor: "var(--accent)", color: "var(--accent-text)" }}
        >
          {creating ? "Inviting…" : "Send invite"}
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
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(d.message ?? d.error ?? `HTTP ${res.status}`);
      }
      const { org } = (await res.json()) as { org: OrgData };
      setName("");
      onCreated(org);
    } catch (err) {
      onError(err instanceof Error ? err.message : "create failed");
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
      <label style={{ flex: "1 1 240px", minWidth: 0 }}>
        <span style={labelStyle}>Organization name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="e.g. Acme Inc."
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
        {creating ? "Creating…" : "Create organization"}
      </button>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function OrgPage() {
  const [orgs, setOrgs] = useState<OrgData[] | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [flash, setFlash] = useState<{ text: string; isLink: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const show = (text: string, isLink = false) => {
    setFlash({ text, isLink });
    if (!isLink) {
      window.setTimeout(() => setFlash(null), 3000);
    }
  };

  const loadOrgs = useCallback(async () => {
    try {
      const res = await fetch("/api/orgs", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  const onOrgCreated = (org: OrgData) => {
    setShowCreate(false);
    setSelectedOrgId(org.id);
    show(`Organization “${org.name}” created.`);
    void loadOrgs();
  };

  const selectedOrg = orgs?.find((o) => o.id === selectedOrgId);

  if (error) {
    return (
      <div style={{ maxWidth: 960 }}>
        <div style={errorStyle}>{error}</div>
      </div>
    );
  }

  if (!orgs) {
    return (
      <div style={{ maxWidth: 960, color: "var(--ink-3)", fontSize: 13 }}>
        Loading…
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
          Organization
        </h1>
        {flash && !flash.isLink && (
          <div style={{ ...flashStyle, color: "var(--ink-2)" }}>{flash.text}</div>
        )}
        <div className="panel" style={{ padding: "20px 22px", maxWidth: 520 }}>
          <h2 style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 500 }}>
            Create your first organization
          </h2>
          <p
            style={{
              margin: "0 0 16px",
              fontSize: 13,
              color: "var(--ink-3)",
              lineHeight: 1.55,
            }}
          >
            Organizations group projects and let you invite teammates. You&rsquo;ll
            be the owner of any org you create here.
          </p>
          <CreateOrgForm onCreated={onOrgCreated} onError={(m) => show(m)} />
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
          Organization
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
          {showCreate ? "Cancel" : "New organization"}
        </button>
      </div>

      {showCreate && (
        <div className="panel" style={{ padding: "16px 18px", marginBottom: 24, maxWidth: 520 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 500 }}>
            Create a new organization
          </h2>
          <CreateOrgForm onCreated={onOrgCreated} onError={(m) => show(m)} />
        </div>
      )}

      {flash && (
        <div style={flash.isLink ? flashStyle : { ...flashStyle, color: "var(--ink-2)" }}>
          {flash.isLink ? (
            <>
              <strong>Invite link (copy now — shown once):</strong>
              <br />
              <span
                style={{ cursor: "pointer", textDecoration: "underline" }}
                onClick={() => {
                  void navigator.clipboard.writeText(flash.text);
                  window.setTimeout(() => setFlash(null), 800);
                }}
              >
                {flash.text}
              </span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(flash.text);
                  window.setTimeout(() => setFlash(null), 800);
                }}
                style={{ ...btnStyle, marginLeft: 12, fontSize: 11 }}
              >
                Copy
              </button>
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
            onAction={(msg) => show(msg)}
          />

          {(selectedOrg.role === "owner" || selectedOrg.role === "admin") && (
            <>
              <InvitesSection orgId={selectedOrgId} onAction={(msg) => show(msg)} />
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
