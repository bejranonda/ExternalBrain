import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@brain/db";
import { auth, anySignInConfigured } from "@/auth";

export const dynamic = "force-dynamic";

const SECTIONS: Array<{ href: string; label: string; description: string }> = [
  { href: "/admin", label: "Overview", description: "Platform health + totals" },
  { href: "/admin/vouchers", label: "Vouchers", description: "Invite codes" },
  { href: "/admin/users", label: "Users", description: "Accounts + roles" },
  { href: "/admin/audit", label: "Audit log", description: "Every admin action" },
  { href: "/admin/cost-ledger", label: "Cost ledger", description: "Per-user AI spend (30 days)" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!anySignInConfigured()) {
    // The admin surface only makes sense with real auth. In dev-shim mode
    // there is exactly one user and no access-control surface to manage.
    // `anySignInConfigured()` covers both Credentials and OAuth modes.
    redirect("/signin?error=auth_not_configured");
  }
  const session = await auth();
  const userId = (session as { userId?: string } | null)?.userId;
  if (!userId) redirect("/signin");

  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, email: true } });
  if (!user || user.role !== "admin") {
    // Not an admin — don't leak that the page exists.
    redirect("/");
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--ink)", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          gap: 16,
          background: "var(--bg-elev-1)",
        }}
      >
        <Link
          href="/"
          style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)", textDecoration: "none" }}
        >
          ← Brain
        </Link>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Admin
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {user.email}
        </span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", flex: 1, minHeight: 0 }}>
        <nav
          aria-label="Admin sections"
          style={{
            borderRight: "1px solid var(--line)",
            padding: "18px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
            background: "var(--bg-elev-1)",
          }}
        >
          {SECTIONS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 13,
                color: "var(--ink-2)",
                textDecoration: "none",
                display: "block",
              }}
            >
              <div style={{ fontWeight: 500 }}>{s.label}</div>
              <div style={{ fontSize: 11, color: "var(--ink-4)" }}>{s.description}</div>
            </Link>
          ))}
        </nav>
        <main style={{ padding: "24px 32px", overflow: "auto", minWidth: 0 }}>{children}</main>
      </div>
    </div>
  );
}
