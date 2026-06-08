import { db } from "@brain/db";
import { BackupStatusCard } from "@/components/brain/backup-status-card";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const [users, vouchers, knowledge, sessions, audit, cost] = await Promise.all([
    db.user.count(),
    db.voucherCode.count(),
    db.knowledge.count({ where: { deletedAt: null } }),
    db.session.count(),
    db.auditLog.count(),
    db.oracleCostLedger.aggregate({ _sum: { costUsd: true, callCount: true } }),
  ]);
  const activeVouchers = await db.voucherCode.count({
    where: {
      disabled: false,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  const redemptions = await db.voucherRedemption.count();

  return (
    <div style={{ maxWidth: 880 }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, margin: "0 0 6px" }}>Platform overview</h1>
      <p style={{ color: "var(--ink-3)", fontSize: 13, margin: "0 0 24px", lineHeight: 1.5 }}>
        Health counters for this deployment. Every number here is queried live — refresh to re-read.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 14,
        }}
      >
        <Stat label="Users" value={users} sub="across all roles" />
        <Stat label="Active vouchers" value={activeVouchers} sub={`of ${vouchers} total`} />
        <Stat label="Voucher redemptions" value={redemptions} sub="one per signup" />
        <Stat label="Knowledge rows" value={knowledge} sub="live, across scopes" />
        <Stat label="Sessions" value={sessions} sub="total recorded" />
        <Stat label="Audit entries" value={audit} sub="append-only" />
        <Stat
          label="Oracle spend"
          value={`$${Number(cost._sum.costUsd ?? 0).toFixed(2)}`}
          sub={`${cost._sum.callCount ?? 0} calls all-time`}
        />
        <BackupStatusCard />
      </div>

      <section style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 10px" }}>Next steps</h2>
        <ul style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.7, paddingLeft: 22 }}>
          <li>
            Issue a voucher code from <a href="/admin/vouchers">Vouchers</a> before inviting a
            pilot user.
          </li>
          <li>
            Check <a href="/admin/users">Users</a> to confirm admin promotions via{" "}
            <code>ADMIN_EMAILS</code>.
          </li>
          <li>
            Spot-check <a href="/admin/audit">Audit log</a> after any bulk operation.
          </li>
        </ul>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        border: "1px solid var(--line)",
        borderRadius: 8,
        background: "var(--bg-elev-1)",
      }}
    >
      <div
        className="mono"
        style={{ fontSize: 11, color: "var(--ink-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 500, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
