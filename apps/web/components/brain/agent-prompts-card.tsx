"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { useT } from "@/lib/brain/i18n";

const STORAGE_KEY = "bp_agent_prompts_dismissed";

interface Props {
  /** Total sessions ever. When 0, the card is expanded; once the user has a
   *  session it collapses to a one-line link (they've clearly connected). */
  sessionsAllTime: number;
}

/**
 * Dashboard card teaching the literal prompts to drive the Brain from an
 * agent. Expanded for brand-new users (no sessions, not dismissed); collapses
 * to a single link otherwise. Dismiss persists in localStorage — mirrors the
 * bp_onboarded pattern in onboarding.tsx.
 */
export function AgentPromptsCard({ sessionsAllTime }: Props) {
  const t = useT();
  // SSR-safe default: collapsed. The real dismiss state is read post-mount so
  // server and first client render agree (no hydration mismatch).
  const [dismissed, setDismissed] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  const expanded = sessionsAllTime === 0 && !dismissed;

  const prompts: Array<{ key: string; text: string }> = [
    { key: "p_check", text: t("agentPrompts.p_check") },
    { key: "p_project", text: t("agentPrompts.p_project") },
    { key: "p_close", text: t("agentPrompts.p_close") },
  ];

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      /* clipboard blocked (no HTTPS/iframe) — no-op, text is selectable */
    }
  };

  if (!expanded) {
    return (
      <a
        href="/docs/concepts/using-from-your-agent"
        className="btn btn-ghost"
        style={{ fontSize: 12, textDecoration: "none" }}
      >
        <Icon name="sparkle" size={11} /> {t("agentPrompts.collapsed")}
      </a>
    );
  }

  return (
    <div
      className="panel"
      style={{
        padding: "18px 20px",
        marginBottom: 14,
        borderLeft: "3px solid var(--accent)",
        background: "var(--bg-elev-1)",
      }}
    >
      <div className="row" style={{ alignItems: "center", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, letterSpacing: "-0.01em" }}>
          {t("agentPrompts.title")}
        </h2>
        <div className="grow" />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 11, height: 22 }}
          aria-label={t("agentPrompts.dismiss")}
          onClick={() => {
            window.localStorage.setItem(STORAGE_KEY, "true");
            setDismissed(true);
          }}
        >
          <Icon name="x" size={10} />
        </button>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
        {t("agentPrompts.body")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {prompts.map((p) => (
          <div
            key={p.key}
            className="row"
            style={{
              gap: 8,
              alignItems: "center",
              border: "1px solid var(--line)",
              borderRadius: 4,
              padding: "8px 10px",
              background: "var(--bg)",
            }}
          >
            <code className="mono" style={{ fontSize: 12, color: "var(--ink)", flex: 1, lineHeight: 1.5 }}>
              {p.text}
            </code>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11, height: 24, whiteSpace: "nowrap" }}
              onClick={() => void copy(p.key, p.text)}
            >
              <Icon name="copy" size={11} />{" "}
              {copiedKey === p.key ? t("agentPrompts.copied") : t("agentPrompts.copy")}
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <a
          href="/docs/concepts/using-from-your-agent"
          className="btn btn-ghost"
          style={{ fontSize: 12, textDecoration: "none" }}
        >
          {t("agentPrompts.more")}
        </a>
      </div>
    </div>
  );
}
