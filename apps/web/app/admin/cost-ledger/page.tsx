"use client";

/**
 * /admin/cost-ledger — last 30 days of AI spend across all users.
 * Platform-admin only (enforced by the /admin/* layout gate).
 * Visual style matches /admin/users.
 */

import { useCallback, useEffect, useState } from "react";

interface LedgerRow {
  userId: string;
  email: string | null;
  day: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  callCount: number;
}

export default function CostLedgerPage() {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/cost-ledger", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: LedgerRow[]; disclaimer?: string | null };
      setRows(data.entries);
      setDisclaimer(data.disclaimer ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = rows
    ? rows.reduce((sum, r) => sum + r.costUsd, 0)
    : null;

  return (
    <div style={{ maxWidth: 960 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 6px" }}>Cost ledger</h1>
      <p style={{ color: "var(--ink-3)", fontSize: 13, margin: "0 0 18px" }}>
        Per-user AI spend for the last 30 days.
        {total !== null && (
          <> Total: <strong>${total.toFixed(4)}</strong></>
        )}
      </p>
      {disclaimer && (
        <p
          role="note"
          style={{
            color: "var(--ink-2)",
            fontSize: 12,
            lineHeight: 1.5,
            margin: "0 0 18px",
            padding: "10px 12px",
            border: "1px solid var(--line)",
            borderRadius: 6,
            background: "var(--bg-elev-1)",
          }}
        >
          {disclaimer}
        </p>
      )}

      {error && (
        <div role="alert" style={{ color: "var(--warn)", fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: "var(--bg-elev-1)", color: "var(--ink-3)" }}>
              <Th>Date</Th>
              <Th>User</Th>
              <Th align="right">Calls</Th>
              <Th align="right">Tokens in</Th>
              <Th align="right">Tokens out</Th>
              <Th align="right">Cost (USD)</Th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((r, i) => (
              <tr
                key={`${r.userId}-${r.day}-${i}`}
                style={{ borderTop: "1px solid var(--line)" }}
              >
                <Td mono>{r.day.slice(0, 10)}</Td>
                <Td>
                  <div style={{ fontSize: 12 }}>{r.email ?? <span style={{ color: "var(--ink-4)" }}>—</span>}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
                    {r.userId.slice(0, 12)}
                  </div>
                </Td>
                <Td align="right" mono>{r.callCount}</Td>
                <Td align="right" mono>{r.tokensInput.toLocaleString()}</Td>
                <Td align="right" mono>{r.tokensOutput.toLocaleString()}</Td>
                <Td align="right" mono>${r.costUsd.toFixed(4)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows && rows.length === 0 && (
        <div style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 12 }}>
          No cost entries in the last 30 days.
        </div>
      )}
      {!rows && !error && (
        <div style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 12 }}>Loading…</div>
      )}
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
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
