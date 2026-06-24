"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { useT } from "@/lib/brain/i18n";
import {
  useAutoskillProposals,
  type ProposalView,
} from "@/lib/brain/use-autoskill";
import { useCounts } from "@/lib/brain/use-counts";
import { useProjectScope } from "@/lib/brain/use-project-scope";
import { ScopePill } from "./scope-pill";
import { HelpPopover } from "./help-popover";

const AUTO_APPLY_KEY = "bp_autoapply";

function readAutoApply(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTO_APPLY_KEY) === "1";
}

export function Autoskill() {
  const t = useT();
  const { scope, setScope } = useProjectScope();
  const { proposals, loadState, error, apply, reject, refresh } = useAutoskillProposals(scope);
  const counts = useCounts();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autoApply, setAutoApply] = useState(false);
  const [editTarget, setEditTarget] = useState<ProposalView | null>(null);
  const [diffTarget, setDiffTarget] = useState<ProposalView | null>(null);

  useEffect(() => {
    setAutoApply(readAutoApply());
  }, []);

  // Auto-apply HIGH confidence proposals if the toggle is on.
  useEffect(() => {
    if (!autoApply || loadState !== "ready") return;
    const highs = proposals.filter((p) => p.confidence === "high");
    if (highs.length === 0) return;
    void (async () => {
      for (const p of highs) {
        setPendingId(p.id);
        try {
          await apply(p.id);
        } catch {
          /* best effort */
        } finally {
          setPendingId(null);
        }
      }
    })();
  }, [autoApply, loadState, proposals, apply]);

  const toggleAutoApply = () => {
    const next = !autoApply;
    setAutoApply(next);
    try {
      window.localStorage.setItem(AUTO_APPLY_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const onAct = async (id: string, action: "apply" | "reject") => {
    setPendingId(id);
    setActionError(null);
    try {
      if (action === "apply") await apply(id);
      else await reject(id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "action failed");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="scroll" style={{ height: "100%", padding: "24px 32px 60px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.02em", fontWeight: 500 }}>
            {t("autoskill.title")}
          </h1>
          <span className="chip" style={{ marginLeft: 10 }}>
            <span className="live-dot" /> {t("autoskill.queue_live")}
          </span>
          <ScopePill scope={scope} onScopeChange={setScope} />
          <div className="grow" />
          <button
            type="button"
            className={autoApply ? "btn btn-primary" : "btn btn-ghost"}
            style={{
              height: 26,
              whiteSpace: "nowrap",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
            onClick={toggleAutoApply}
            aria-pressed={autoApply}
            role="switch"
            title={t("autoskill.auto_apply_tip")}
          >
            {/* Phase R.3: previous render was ambiguous — in the OFF state
                the btn-ghost label "Auto-accept HIGH" read as a static
                status badge, not a clickable toggle. A mini switch
                affordance (track + thumb) in front of the label makes the
                toggle nature obvious in both ON and OFF states; the
                role="switch" + aria-pressed pair keeps the semantics
                explicit for assistive tech. Label copy + behavior
                unchanged. */}
            <span
              aria-hidden="true"
              style={{
                position: "relative",
                width: 22,
                height: 12,
                borderRadius: 999,
                background: autoApply
                  ? "var(--accent-ink, rgba(0,0,0,0.35))"
                  : "var(--ink-4, rgba(255,255,255,0.25))",
                transition: "background 120ms ease",
                flex: "0 0 auto",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 1,
                  left: autoApply ? 11 : 1,
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: autoApply ? "var(--accent, #fff)" : "var(--ink-2, #ccc)",
                  transition: "left 120ms ease, background 120ms ease",
                }}
              />
            </span>
            {autoApply
              ? t("autoskill.auto_apply_on")
              : t("autoskill.auto_apply")}
          </button>
          <HelpPopover
            content={{
              what: "Skill proposals Brain found — recurring behaviors across your sessions that look like skills but haven't been promoted yet.",
              whatToDo: [
                "Read each proposal: trigger, suggested skill, source session(s).",
                "Apply to promote it to a real skill (it then shows up in Skills).",
                "Reject if the pattern is noise — Brain learns from rejections.",
                "Toggle Auto-apply HIGH if you trust high-confidence proposals to go straight in.",
              ],
              docHref: "/docs/concepts/autoskill",
            }}
          />
        </div>
        {/* Phase R.1: dropped both the hardcoded "Suggestions waiting for
            your decision" line and the long `autoskill.subtitle` explainer
            paragraph — they duplicated each other and the (?) help popover.
            Session count moved to a single quiet mono line; the proposal
            cards below are the visual hero. */}
        {(counts.sessionsWeek || counts.sessionsAllTime) ? (
          <div
            className="mono"
            style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 20 }}
          >
            {t("autoskill.session_count", { n: counts.sessionsWeek || counts.sessionsAllTime })}
          </div>
        ) : (
          <div style={{ marginBottom: 12 }} />
        )}

        {loadState === "error" && (
          <Banner kind="warn">
            Failed to load proposals{error ? ` (${error})` : ""}.
          </Banner>
        )}
        {loadState === "loading" && <Banner kind="info">Loading proposals…</Banner>}
        {loadState === "ready" && proposals.length === 0 && <EmptyState />}
        {actionError && <Banner kind="error">{actionError}</Banner>}

        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            p={p}
            disabled={pendingId === p.id}
            onApply={() => onAct(p.id, "apply")}
            onReject={() => onAct(p.id, "reject")}
            onEdit={() => setEditTarget(p)}
            onDiff={() => setDiffTarget(p)}
            tApply={t("autoskill.apply")}
            tReject={t("autoskill.reject")}
            tTarget={t("autoskill.target")}
            tReason={t("autoskill.reason")}
            tViewDiff={t("autoskill.view_diff")}
          />
        ))}
      </div>

      {editTarget && (
        <EditProposalModal
          proposal={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            void refresh();
          }}
        />
      )}
      {diffTarget && (
        <DiffModal proposal={diffTarget} onClose={() => setDiffTarget(null)} />
      )}
    </div>
  );
}

interface ProposalCardProps {
  p: ProposalView;
  disabled: boolean;
  onApply(): void;
  onReject(): void;
  onEdit(): void;
  onDiff(): void;
  tApply: string;
  tReject: string;
  tTarget: string;
  tReason: string;
  tViewDiff: string;
}

function ProposalCard({
  p,
  disabled,
  onApply,
  onReject,
  onEdit,
  onDiff,
  tApply,
  tReject,
  tTarget,
  tReason,
  tViewDiff,
}: ProposalCardProps) {
  return (
    <div className="panel" style={{ marginBottom: 10, overflow: "hidden", opacity: disabled ? 0.5 : 1 }}>
      <div
        style={{
          padding: "14px 18px",
          borderLeft: `3px solid ${p.confidence === "high" ? "var(--accent)" : "var(--warn)"}`,
        }}
      >
        <div className="row" style={{ marginBottom: 8 }}>
          <span
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "3px 6px",
              borderRadius: 3,
              color: p.confidence === "high" ? "var(--accent-ink)" : "var(--bg)",
              background: p.confidence === "high" ? "var(--accent)" : "var(--warn)",
              fontWeight: 600,
            }}
            title={
              p.confidence === "high"
                ? "High confidence — the Brain saw this pattern repeatedly. Safer to accept or auto-apply."
                : "Medium confidence — pattern seen, but worth a review before accepting."
            }
          >
            {p.confidence}
          </span>
          <span
            className={`chip k-${
              p.type === "anti_principle"
                ? "anti"
                : p.type === "style"
                  ? "reflex"
                  : p.type
            }`}
          >
            {p.type.replace("_", " ")}
          </span>
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-4)" }}>
            · session {p.session.slice(0, 8)}
          </span>
          <div className="grow" />
          <span
            className="mono"
            style={{ fontSize: 12, color: "var(--ink-3)" }}
            title="How many times this pattern was seen across your sessions"
          >
            seen {p.pattern}×
          </span>
        </div>
        <div style={{ fontSize: 15, letterSpacing: "-0.005em", marginBottom: 4 }}>
          {p.title}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 10 }}>
          <span className="mono" style={{ color: "var(--ink-4)" }}>
            {tTarget} →{" "}
          </span>
          <span>{p.target}</span>
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            padding: "8px 10px",
            background: "var(--bg-elev-2)",
            borderRadius: 6,
            marginBottom: 10,
          }}
        >
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
            {tReason} ·{" "}
          </span>
          {p.reason}
        </div>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn btn-primary" onClick={onApply} disabled={disabled}>
            <Icon name="check" size={10} /> {tApply}
          </button>
          <button className="btn" onClick={onEdit} disabled={disabled}>
            <Icon name="copy" size={10} /> Edit
          </button>
          <button className="btn btn-ghost" onClick={onReject} disabled={disabled}>
            <Icon name="x" size={10} /> {tReject}
          </button>
          <div className="grow" />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
            disabled={disabled}
            onClick={onDiff}
          >
            {tViewDiff} <Icon name="arrowR" size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}

function EditProposalModal({
  proposal,
  onClose,
  onSaved,
}: {
  proposal: ProposalView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reasoning, setReasoning] = useState(proposal.reason);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/autoskill/proposals/${encodeURIComponent(proposal.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reasoning }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cmdk-scrim" onClick={onClose} role="presentation">
      <div
        className="cmdk"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Edit proposal"
        style={{ maxWidth: 560 }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Edit proposal</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4 }}>
            {proposal.id.slice(0, 10)} · {proposal.type}
          </div>
        </div>
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{proposal.title}</div>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Reasoning
            </span>
            <textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              rows={6}
              style={{ resize: "vertical", fontSize: 14 }}
            />
          </label>
          {err && (
            <div style={{ fontSize: 13, color: "var(--bad, #ff6b6b)" }}>{err}</div>
          )}
          <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DiffModal({
  proposal,
  onClose,
}: {
  proposal: ProposalView;
  onClose: () => void;
}) {
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/autoskill/proposals/${encodeURIComponent(proposal.id)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : { diff: null }))
      .then((d: { diff?: string }) => {
        if (!cancelled) setDiff(d.diff ?? "(no diff)");
      })
      .catch(() => {
        if (!cancelled) setDiff("(fetch failed)");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [proposal.id]);

  return (
    <div className="cmdk-scrim" onClick={onClose} role="presentation">
      <div
        className="cmdk"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="View diff"
        style={{ maxWidth: 720 }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Proposal diff</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 4 }}>
            {proposal.id} · target: {proposal.target}
          </div>
        </div>
        <pre
          className="mono"
          style={{
            margin: 0,
            padding: 14,
            fontSize: 13,
            lineHeight: 1.5,
            maxHeight: "60vh",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            background: "var(--bg)",
          }}
        >
          {loading ? "Loading diff…" : diff}
        </pre>
        <div style={{ padding: 10, borderTop: "1px solid var(--line)", textAlign: "right" }}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Banner({
  kind,
  children,
}: {
  kind: "info" | "warn" | "error";
  children: React.ReactNode;
}) {
  const color =
    kind === "error"
      ? "var(--bad, #ff6b6b)"
      : kind === "warn"
        ? "var(--warn)"
        : "var(--ink-3)";
  return (
    <div
      className="panel"
      style={{
        padding: "10px 14px",
        marginBottom: 12,
        borderLeft: `3px solid ${color}`,
        fontSize: 13,
        color: "var(--ink-2)",
      }}
    >
      {children}
    </div>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <div
      className="panel"
      style={{
        padding: "32px 28px",
        margin: "0 auto",
        maxWidth: 480,
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--bg-elev-1)",
          border: "1px solid var(--line-soft)",
          color: "var(--ink-3)",
          marginBottom: 14,
        }}
      >
        <Icon name="notifications" size={14} />
      </div>
      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: "var(--ink)",
        }}
      >
        {t("autoskill.empty_title")}
      </h2>
      <p
        style={{
          margin: "0 0 16px",
          fontSize: 14,
          lineHeight: 1.55,
          color: "var(--ink-2)",
        }}
      >
        {t("autoskill.empty_body")}
      </p>
      <div
        className="row"
        style={{ gap: 8, justifyContent: "center", flexWrap: "wrap" }}
      >
        <a
          href="/settings/tokens"
          className="btn btn-primary"
          style={{ fontSize: 13, textDecoration: "none" }}
        >
          <Icon name="link" size={11} /> {t("autoskill.connect_tool")}
        </a>
      </div>
    </div>
  );
}
