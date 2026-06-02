"use client";

import { useCallback, useEffect, useState } from "react";

interface Voucher {
  id: string;
  code: string;
  kind: "personal" | "organization";
  organizationLabel: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  disabled: boolean;
  note: string | null;
  createdAt: string;
}

export default function VouchersPage() {
  const [vouchers, setVouchers] = useState<Voucher[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vouchers", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { vouchers: Voucher[] };
      setVouchers(data.vouchers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const show = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2500);
  };

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Voucher codes</h1>
        <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
          {vouchers ? `${vouchers.length} codes` : "loading…"}
        </span>
      </div>

      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}
      {flash && <div style={flashStyle}>{flash}</div>}

      <CreateForm
        onCreated={() => {
          show("Voucher created.");
          void load();
        }}
      />

      <div style={{ marginTop: 24 }}>
        {vouchers && vouchers.length === 0 && (
          <div style={{ color: "var(--ink-3)", fontSize: 13 }}>
            No codes yet. Create one above to invite a pilot user.
          </div>
        )}
        {vouchers && vouchers.length > 0 && (
          <VoucherTable
            rows={vouchers}
            onChanged={(msg) => {
              show(msg);
              void load();
            }}
          />
        )}
      </div>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [kind, setKind] = useState<"personal" | "organization">("personal");
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [expiresDays, setExpiresDays] = useState(30);
  const [note, setNote] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastCreated, setLastCreated] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = { kind, maxUses };
      if (customCode.trim()) body.code = customCode.trim();
      if (kind === "organization" && label.trim()) body.organizationLabel = label.trim();
      if (expiresDays > 0) {
        body.expiresAt = new Date(Date.now() + expiresDays * 86400_000).toISOString();
      }
      if (note.trim()) body.note = note.trim();

      const res = await fetch("/api/admin/vouchers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { voucher: { code: string } };
      setLastCreated(data.voucher.code);
      setCustomCode("");
      setLabel("");
      setNote("");
      onCreated();
    } catch (e) {
      alert(e instanceof Error ? e.message : "create failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        padding: "16px 18px",
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--bg-elev-1)",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 12,
        alignItems: "end",
      }}
    >
      <Field label="Kind">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "personal" | "organization")}
          style={inputStyle}
        >
          <option value="personal">Personal</option>
          <option value="organization">Organization</option>
        </select>
      </Field>

      {kind === "organization" && (
        <Field label="Org label">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Acme Inc."
            style={inputStyle}
          />
        </Field>
      )}

      <Field label="Max uses">
        <input
          type="number"
          min={1}
          max={10000}
          value={maxUses}
          onChange={(e) => setMaxUses(Math.max(1, Number(e.target.value)))}
          style={inputStyle}
        />
      </Field>

      <Field label="Expires in (days, 0 = never)">
        <input
          type="number"
          min={0}
          max={365}
          value={expiresDays}
          onChange={(e) => setExpiresDays(Math.max(0, Number(e.target.value)))}
          style={inputStyle}
        />
      </Field>

      <Field label="Custom code (optional)">
        <input
          type="text"
          value={customCode}
          onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
          placeholder="auto-generated"
          style={{ ...inputStyle, fontFamily: "var(--font-mono)", textTransform: "uppercase" }}
        />
      </Field>

      <Field label="Note">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Q2 pilot cohort"
          style={inputStyle}
        />
      </Field>

      <div>
        <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
          {busy ? "Creating…" : "Create voucher"}
        </button>
      </div>

      {lastCreated && (
        <div style={{ gridColumn: "1 / -1", fontSize: 13, color: "var(--ink-3)" }}>
          Last created:{" "}
          <code style={{ color: "var(--accent-text)" }}>{lastCreated}</code> — share this code with the
          invitee.
        </div>
      )}
    </form>
  );
}

function VoucherTable({
  rows,
  onChanged,
}: {
  rows: Voucher[];
  onChanged: (msg: string) => void;
}) {
  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/vouchers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      alert(`update failed (${res.status})`);
      return;
    }
    onChanged("Voucher updated.");
  };

  const del = async (id: string, code: string) => {
    if (!confirm(`Delete voucher ${code}? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/vouchers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert(`delete failed (${res.status})`);
      return;
    }
    onChanged("Voucher deleted.");
  };

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ background: "var(--bg-elev-1)", color: "var(--ink-3)" }}>
            <Th>Code</Th>
            <Th>Kind</Th>
            <Th align="right">Uses</Th>
            <Th>Expires</Th>
            <Th>Status</Th>
            <Th>Note</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const expired = v.expiresAt ? new Date(v.expiresAt).getTime() < Date.now() : false;
            const exhausted = v.usedCount >= v.maxUses;
            const active = !v.disabled && !expired && !exhausted;
            return (
              <tr key={v.id} style={{ borderTop: "1px solid var(--line)" }}>
                <Td>
                  <code style={{ fontFamily: "var(--font-mono)", color: "var(--ink)" }}>{v.code}</code>
                </Td>
                <Td>
                  {v.kind}
                  {v.organizationLabel && (
                    <span style={{ color: "var(--ink-4)", marginLeft: 6 }}>· {v.organizationLabel}</span>
                  )}
                </Td>
                <Td align="right" mono>
                  {v.usedCount}/{v.maxUses}
                </Td>
                <Td mono>
                  {v.expiresAt
                    ? new Date(v.expiresAt).toISOString().slice(0, 10)
                    : <span style={{ color: "var(--ink-4)" }}>—</span>}
                </Td>
                <Td>
                  <Status active={active} disabled={v.disabled} expired={expired} exhausted={exhausted} />
                </Td>
                <Td>
                  <span style={{ color: "var(--ink-3)" }}>{v.note ?? ""}</span>
                </Td>
                <Td align="right">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void patch(v.id, { disabled: !v.disabled })}
                  >
                    {v.disabled ? "Enable" : "Disable"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ marginLeft: 6, color: "var(--warn)" }}
                    onClick={() => void del(v.id, v.code)}
                  >
                    Delete
                  </button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Status({
  active,
  disabled,
  expired,
  exhausted,
}: {
  active: boolean;
  disabled: boolean;
  expired: boolean;
  exhausted: boolean;
}) {
  if (active) return <span style={{ color: "var(--accent-text)" }}>● active</span>;
  if (disabled) return <span style={{ color: "var(--warn)" }}>● disabled</span>;
  if (expired) return <span style={{ color: "var(--ink-4)" }}>● expired</span>;
  if (exhausted) return <span style={{ color: "var(--ink-4)" }}>● exhausted</span>;
  return <span style={{ color: "var(--ink-4)" }}>—</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink-4)" }}>
      <span style={{ letterSpacing: "0.04em", textTransform: "uppercase" }}>{label}</span>
      {children}
    </label>
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  fontSize: 13,
  background: "var(--bg)",
  color: "var(--ink)",
  border: "1px solid var(--line)",
  borderRadius: 6,
};

const errorStyle: React.CSSProperties = {
  padding: "10px 12px",
  marginBottom: 14,
  border: "1px solid var(--warn)",
  borderRadius: 6,
  color: "var(--warn)",
  fontSize: 13,
};

const flashStyle: React.CSSProperties = {
  padding: "8px 12px",
  marginBottom: 14,
  border: "1px solid var(--accent)",
  borderRadius: 6,
  color: "var(--accent-text)",
  fontSize: 13,
};
