"use client";

/**
 * /settings/reset-knowledge — bulk-reset Knowledge rows in the active org.
 *
 * Destructive. Org-admin only (the API enforces this; the UI hides the
 * page from members at the link level via the user menu).
 *
 * Canonical scopes plus a "Custom days…" path:
 *   • Older than 1 day / 1 week / 1 month / 3 months / 1 year — time-window pruning
 *   • All                                — nuclear, with hard-delete option
 *   • Custom days                        — operator-chosen cutoff
 *
 * Soft-delete is the default (sets `deletedAt = NOW()`); hard-delete is
 * only offered for `all` and only after the operator types the
 * confirmation phrase.
 */
import { useState } from "react";

type ScopeChoice =
  | "older-1d"
  | "older-7d"
  | "older-30d"
  | "older-90d"
  | "older-365d"
  | "custom"
  | "all";

const SCOPE_LABELS: Record<ScopeChoice, string> = {
  "older-1d": "Older than 1 day",
  "older-7d": "Older than 1 week",
  "older-30d": "Older than 1 month",
  "older-90d": "Older than 3 months",
  "older-365d": "Older than 1 year",
  custom: "Custom days…",
  all: "ALL knowledge in this org",
};

const REQUIRED_CONFIRM = "RESET KNOWLEDGE";

export default function ResetKnowledgePage() {
  const [choice, setChoice] = useState<ScopeChoice>("older-30d");
  const [customDays, setCustomDays] = useState<string>("60");
  const [confirm, setConfirm] = useState("");
  const [hard, setHard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { kind: "ok"; deleted: number; scopeLabel: string; hard: boolean }
    | { kind: "err"; message: string }
    | null
  >(null);

  const isAll = choice === "all";
  const isCustom = choice === "custom";
  const canSubmit =
    confirm === REQUIRED_CONFIRM &&
    (!isCustom || (Number.isInteger(Number(customDays)) && Number(customDays) > 0)) &&
    !busy;

  async function onSubmit() {
    setBusy(true);
    setResult(null);
    try {
      let body:
        | { scope: "all"; hard?: boolean; confirmPhrase: string }
        | { scope: "older-than"; olderThanDays: number; confirmPhrase: string };
      if (choice === "all") {
        body = { scope: "all", hard, confirmPhrase: confirm };
      } else if (choice === "custom") {
        body = {
          scope: "older-than",
          olderThanDays: Number(customDays),
          confirmPhrase: confirm,
        };
      } else {
        const days = Number(choice.replace("older-", "").replace("d", ""));
        body = { scope: "older-than", olderThanDays: days, confirmPhrase: confirm };
      }

      const res = await fetch("/api/admin/knowledge/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as
        | { deleted: number; scopeLabel: string; hard: boolean }
        | { error?: string; message?: string };
      if (!res.ok) {
        setResult({
          kind: "err",
          message: ("message" in json && json.message) || "Reset failed.",
        });
        return;
      }
      setResult({
        kind: "ok",
        deleted: (json as { deleted: number }).deleted,
        scopeLabel: (json as { scopeLabel: string }).scopeLabel,
        hard: (json as { hard: boolean }).hard,
      });
      setConfirm("");
    } catch (err) {
      setResult({
        kind: "err",
        message: err instanceof Error ? err.message : "Network error.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "48px 24px 96px",
        color: "var(--ink)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <h1
        style={{
          fontSize: 22,
          fontWeight: 500,
          margin: "18px 0 6px",
          letterSpacing: "-0.02em",
        }}
      >
        Reset knowledge
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "var(--ink-3)",
          margin: "0 0 28px",
          lineHeight: 1.55,
        }}
      >
        Bulk-clear skills and rules from this organization.{" "}
        <strong style={{ color: "var(--ink-2)" }}>Soft delete</strong> hides
        rows from your Brain everywhere (Oracle, Skills, retrieval), but they
        stay recoverable.{" "}
        <strong style={{ color: "var(--ink-2)" }}>Hard delete</strong> removes
        them forever. Org-admin only — every reset is captured in the{" "}
        <a href="/settings/audit">audit log</a>.
      </p>

      <section
        className="panel"
        style={{ padding: "16px 18px", marginBottom: 18 }}
      >
        <label
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-4)", display: "block", marginBottom: 6 }}
        >
          SCOPE
        </label>
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value as ScopeChoice)}
          style={{
            width: "100%",
            padding: "8px 10px",
            fontSize: 13,
            background: "var(--bg)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            color: "var(--ink)",
            fontFamily: "inherit",
          }}
        >
          {Object.entries(SCOPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        {isCustom && (
          <div style={{ marginTop: 10 }}>
            <label
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-4)", display: "block", marginBottom: 6 }}
            >
              CUSTOM CUTOFF (DAYS)
            </label>
            <input
              type="number"
              min={1}
              value={customDays}
              onChange={(e) => setCustomDays(e.target.value)}
              style={{
                width: 120,
                padding: "8px 10px",
                fontSize: 13,
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: 4,
                color: "var(--ink)",
                fontFamily: "inherit",
              }}
            />
            <span style={{ marginLeft: 8, fontSize: 13, color: "var(--ink-3)" }}>
              soft-delete rows older than this many days
            </span>
          </div>
        )}

        {isAll && (
          <div style={{ marginTop: 12 }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--ink-2)",
              }}
            >
              <input
                type="checkbox"
                checked={hard}
                onChange={(e) => setHard(e.target.checked)}
              />
              <span>
                Hard delete (physically remove rows; not recoverable). Only
                allowed with scope = ALL.
              </span>
            </label>
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <label
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-4)", display: "block", marginBottom: 6 }}
          >
            CONFIRM (TYPE EXACTLY: {REQUIRED_CONFIRM})
          </label>
          <span id="reset-confirm-hint" className="sr-only">
            Type {REQUIRED_CONFIRM} exactly to enable the reset button.
          </span>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={REQUIRED_CONFIRM}
            aria-describedby="reset-confirm-hint"
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: 13,
              background: "var(--bg)",
              border:
                confirm === REQUIRED_CONFIRM
                  ? "1px solid var(--accent)"
                  : "1px solid var(--line)",
              borderRadius: 4,
              color: "var(--ink)",
              fontFamily: "var(--font-mono, monospace)",
            }}
          />
        </div>

        <button
          type="button"
          className="btn"
          disabled={!canSubmit}
          onClick={() => void onSubmit()}
          aria-describedby="reset-confirm-hint"
          style={{
            marginTop: 16,
            // Was `white` on #e05252 — 3.82:1, below the 4.5:1 AA floor, on
            // the single most destructive control in the product. The token
            // pair --bg on --bad is 8.36:1 and matches the palette.
            background: canSubmit ? "var(--bad)" : "var(--bg-elev-1)",
            color: canSubmit ? "var(--bg)" : "var(--ink-3)",
            borderColor: canSubmit ? "var(--bad)" : "var(--line)",
            cursor: canSubmit ? "pointer" : "not-allowed",
            padding: "8px 16px",
            fontWeight: 500,
          }}
        >
          {busy ? "Resetting…" : "Reset knowledge"}
        </button>
      </section>

      {/* A bulk destructive operation previously reported its outcome only
          visually — a screen-reader user got no confirmation that N rows had
          been deleted. role="status" announces the success count; the failure
          path uses role="alert" because it is genuinely interruptive.
          WCAG 4.1.3. */}
      <div aria-live="polite" aria-atomic="true">
        {result?.kind === "ok" && (
          <section
            className="panel"
            role="status"
            style={{
              padding: "12px 14px",
              background: "var(--bg-elev-1)",
              border: "1px solid var(--accent)",
              borderRadius: 8,
              color: "var(--accent-text)",
              fontSize: 13,
            }}
          >
            ✓ Reset complete — {result.deleted} row{result.deleted === 1 ? "" : "s"}{" "}
            {result.hard ? "permanently deleted" : "soft-deleted"} (scope: {result.scopeLabel}).{" "}
            <a href="/settings/audit">View audit entry →</a>
          </section>
        )}
        {result?.kind === "err" && (
          <section
            className="panel"
            role="alert"
            style={{
              padding: "12px 14px",
              // Hardcoded #e05252 / rgba(224,82,82,…) replaced with the
              // --bad token so the page tracks theme changes like every
              // other surface.
              background: "color-mix(in oklab, var(--bad) 8%, transparent)",
              border: "1px solid color-mix(in oklab, var(--bad) 35%, transparent)",
              borderRadius: 8,
              color: "var(--bad)",
              fontSize: 13,
            }}
          >
            ✗ {result.message}
          </section>
        )}
      </div>
    </main>
  );
}
