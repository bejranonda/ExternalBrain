"use client";

import { useCallback, useEffect, useState } from "react";

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  knowledgeCount: number;
  sessionCount: number;
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { users: UserRow[] };
      setUsers(data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  const changeRole = useCallback(
    async (u: UserRow, next: "admin" | "user") => {
      const verb = next === "admin" ? "Promote" : "Demote";
      if (!confirm(`${verb} ${u.email} to ${next}?`)) return;
      setPendingId(u.id);
      try {
        const res = await fetch(`/api/admin/users/${u.id}/role`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setFlash(`${u.email} is now ${next}.`);
        window.setTimeout(() => setFlash(null), 2500);
        await load();
      } catch (e) {
        alert(e instanceof Error ? e.message : "role change failed");
      } finally {
        setPendingId(null);
      }
    },
    [load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ maxWidth: 960 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 18px" }}>Users</h1>

      {error && (
        <div role="alert" style={{ color: "var(--warn)", fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {flash && (
        <div
          role="status"
          style={{
            padding: "8px 12px",
            marginBottom: 12,
            border: "1px solid var(--accent)",
            borderRadius: 6,
            color: "var(--accent-text)",
            fontSize: 13,
          }}
        >
          {flash}
        </div>
      )}

      <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "var(--bg-elev-1)", color: "var(--ink-3)" }}>
              <Th>Email</Th>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th align="right">Knowledge</Th>
              <Th align="right">Sessions</Th>
              <Th>Joined</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {/* Audit FE4 (#103): show a loading row instead of an empty
                <tbody> while the initial fetch is in flight. Without it,
                the table header rendered with nothing under it during
                the ~200ms DB roundtrip and looked like an empty admin
                page. Mirrors the loading pattern in tokens/page.tsx. */}
            {users === null && (
              <tr style={{ borderTop: "1px solid var(--line)" }}>
                <td
                  colSpan={7}
                  style={{ padding: "16px 12px", fontSize: 13, color: "var(--ink-3)" }}
                >
                  Loading users…
                </td>
              </tr>
            )}
            {users?.map((u) => (
              <tr key={u.id} style={{ borderTop: "1px solid var(--line)" }}>
                <Td>{u.email}</Td>
                <Td>{u.name ?? <span style={{ color: "var(--ink-4)" }}>—</span>}</Td>
                <Td>
                  <span
                    style={{
                      color: u.role === "admin" ? "var(--accent-text)" : "var(--ink-2)",
                      fontWeight: u.role === "admin" ? 500 : 400,
                    }}
                  >
                    {u.role}
                  </span>
                </Td>
                <Td align="right" mono>
                  {u.knowledgeCount}
                </Td>
                <Td align="right" mono>
                  {u.sessionCount}
                </Td>
                <Td mono>{new Date(u.createdAt).toISOString().slice(0, 10)}</Td>
                <Td align="right">
                  {u.role === "user" ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 11 }}
                      disabled={pendingId === u.id}
                      onClick={() => void changeRole(u, "admin")}
                    >
                      {pendingId === u.id ? "…" : "Promote to admin"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12, color: "var(--warn)" }}
                      disabled={pendingId === u.id}
                      onClick={() => void changeRole(u, "user")}
                    >
                      {pendingId === u.id ? "…" : "Demote"}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {users && users.length === 0 && (
        <div style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 12 }}>
          No users yet. Nobody has signed in through this deployment.
        </div>
      )}

      <div style={{ marginTop: 20, fontSize: 12, color: "var(--ink-4)", lineHeight: 1.6 }}>
        Promotion / demotion writes an AuditLog row. The last remaining admin
        cannot be demoted — promote someone else first. Changes take effect
        immediately for API requests; the admin UI only re-renders for the
        demoted user on their next page load.
      </div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        padding: "8px 12px",
        textAlign: align,
        fontWeight: 500,
        fontSize: 12,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  align = "left",
  mono = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      style={{
        padding: "8px 12px",
        textAlign: align,
        fontFamily: mono ? "var(--font-mono)" : undefined,
      }}
    >
      {children}
    </td>
  );
}
