"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import type { ProposalView } from "@/lib/brain/views";

interface Props {
  open: boolean;
  onClose: () => void;
  onReview: () => void;
}

export function NotificationsPanel({ open, onClose, onReview }: Props) {
  const [items, setItems] = useState<ProposalView[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/autoskill/proposals?status=pending&limit=8", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { proposals: [] }))
      .then((d: { proposals: ProposalView[] }) => {
        if (!cancelled) setItems(d.proposals);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="cmdk-scrim"
      onClick={onClose}
      role="presentation"
      style={{ alignItems: "flex-start" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className="panel"
        style={{
          width: 360,
          marginTop: 54,
          marginRight: 18,
          alignSelf: "flex-end",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="notifications" size={12} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>Notifications</span>
          <span className="grow" />
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {items.length} pending
          </span>
        </div>
        <div className="scroll" style={{ flex: 1 }}>
          {loading && (
            <div style={{ padding: 14, color: "var(--ink-3)", fontSize: 13 }}>
              Loading…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div
              style={{
                padding: 18,
                color: "var(--ink-3)",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              Nothing pending — you&rsquo;re caught up. Notifications appear
              here when the Brain spots a pattern across your sessions worth
              promoting to a skill.
            </div>
          )}
          {(() => {
            // Categorize proposals by confidence so the user sees the
            // urgency hierarchy (high to act on first; low to skim).
            // Existing data — no new endpoint or schema change.
            type Group = { label: string; items: ProposalView[]; tone: string };
            const groups: Group[] = [
              { label: "High confidence — likely ready to apply",
                items: items.filter((p) => p.confidence === "high"),
                tone: "var(--accent-text)" },
              { label: "Medium — worth a look",
                items: items.filter((p) => p.confidence === "medium"),
                tone: "var(--warn)" },
              { label: "Low — skim or skip",
                items: items.filter((p) => !["high", "medium"].includes(p.confidence)),
                tone: "var(--ink-3)" },
            ].filter((g) => g.items.length > 0);
            return groups.map((g) => (
              <div key={g.label}>
                <div
                  className="mono"
                  style={{
                    padding: "8px 14px 4px",
                    fontSize: 11,
                    color: g.tone,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {g.label} · {g.items.length}
                </div>
                {g.items.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={onReview}
              style={{
                display: "block",
                width: "100%",
                padding: "10px 14px",
                textAlign: "left",
                background: "transparent",
                border: 0,
                borderBottom: "1px solid var(--line-soft)",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              <div className="row" style={{ marginBottom: 4 }}>
                <span
                  className="chip"
                  style={{
                    color: p.confidence === "high" ? "var(--accent-text)" : "var(--warn)",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  {p.confidence}
                </span>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
                  {p.type.replace("_", " ")}
                </span>
                <span className="grow" />
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
                  {p.session.slice(0, 8)}
                </span>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.35, color: "var(--ink)" }}>
                {p.title}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
                → {p.target}
              </div>
            </button>
                ))}
              </div>
            ));
          })()}
        </div>
        <div style={{ padding: 10, borderTop: "1px solid var(--line)" }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: "100%" }}
            onClick={onReview}
          >
            Review all proposals
          </button>
        </div>
      </div>
    </div>
  );
}
