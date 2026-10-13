"use client";

import { useEffect, useState } from "react";
// Subpath import (not the "@brain/core" barrel) — this is a client component
// and the barrel pulls in @sentry/node. Same constraint as token-install-wizard.
//
// Imported rather than hand-written: this modal previously hardcoded its own
// `mcpServers` JSON, which drifted into an invented `transport: { type, url }`
// shape no client accepts, and told the reader "Cursor and Windsurf use the
// same config shape" when all three differ. That is the §0r defect class —
// one value rendered by several surfaces, fixed in one of them. Rendering from
// the generator makes the modal structurally unable to drift again.
import { claudeCodeCli } from "@brain/core/install-snippets";
import { Icon } from "./icons";
import { useT } from "@/lib/brain/i18n";
import { rich } from "@/lib/brain/rich-text";

const STORAGE_KEY = "bp_onboarded";

interface Props {
  /** Real MCP endpoint from the deploy env, injected by the server component.
   *  Undefined in local dev, where localhost:3100 is correct. */
  mcpUrl?: string | undefined;
  /** Public webapp URL — the onboard installer is served from it. */
  webUrl?: string | undefined;
  knowledgeCount: number;
  /** True once the hosting app has fetched initial counts. Gates auto-open
   *  so we don't flash the modal during the pre-fetch window where every
   *  count defaults to 0 — existing users would otherwise see onboarding
   *  on every reload. */
  ready: boolean;
  onTeach: () => void;
  onOracle: () => void;
  onAutoskill: () => void;
}

/**
 * First-run onboarding modal. Auto-opens when the user has zero Knowledge
 * items AND the `bp_onboarded` localStorage flag is not set. Dismissable;
 * the flag is set on dismiss so it won't re-appear.
 *
 * Five steps, each small enough to complete in ~10 seconds:
 *  1. Welcome + what this is
 *  2. Generate an MCP token (opens /settings/tokens in a new tab)
 *  3. Wire Claude Code (copy snippet)
 *  4. Teach your first skill (opens the Teach modal)
 *  5. Ask the Oracle (navigates to #oracle)
 */
export function Onboarding({
  mcpUrl,
  webUrl,
  knowledgeCount,
  ready,
  onTeach,
  onOracle,
  onAutoskill: _onAutoskill,
}: Props) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Wait until the host app has actual counts — avoids the flash-then-
    // stuck-open race where the initial `knowledgeCount=0` value from
    // useState opens the modal and later non-zero counts never close it.
    if (!ready) return;
    const done = window.localStorage.getItem(STORAGE_KEY) === "true";
    if (!done && knowledgeCount === 0) setVisible(true);
  }, [ready, knowledgeCount]);

  if (!visible) return null;

  const dismiss = (permanent: boolean) => {
    if (permanent && typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, "true");
    }
    setVisible(false);
  };

  const code = (s: string) => <code>{s}</code>;

  const steps: Array<{ title: string; body: React.ReactNode; cta?: { label: string; action: () => void } }> = [
    {
      title: t("onboarding.welcome_title"),
      body: (
        <div>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>{t("onboarding.welcome_p1")}</p>
          <p style={{ margin: 0, lineHeight: 1.55, color: "var(--ink-2)" }}>
            {t("onboarding.welcome_p2")}
          </p>
        </div>
      ),
    },
    {
      title: t("onboarding.token_title"),
      body: (
        <div>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
            {rich(t("onboarding.token_p1"), { mcp: <strong>MCP</strong> })}
          </p>
          <p style={{ margin: 0, lineHeight: 1.55, color: "var(--ink-2)" }}>
            {rich(t("onboarding.token_p2"), {
              page: <strong>{t("onboarding.token_page")}</strong>,
              example: code("laptop"),
            })}
          </p>
        </div>
      ),
      cta: {
        label: t("onboarding.token_cta"),
        action: () => {
          window.open("/settings/tokens", "_blank", "noopener");
        },
      },
    },
    {
      title: t("onboarding.wire_title"),
      body: (
        <div>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
            {rich(t("onboarding.wire_p1"), { token: code("<TOKEN>") })}
            {!mcpUrl && (
              <>
                {" "}
                {rich(t("onboarding.wire_hosted"), { host: code("localhost:3100") })}
              </>
            )}
          </p>
          <pre
            style={{
              margin: 0,
              padding: "10px 12px",
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: 4,
              fontSize: 11.5,
              fontFamily: "var(--font-mono)",
              overflowX: "auto",
              lineHeight: 1.55,
            }}
          >
            {claudeCodeCli(
              "<TOKEN>",
              mcpUrl ?? "http://localhost:3100/mcp",
              webUrl ?? "http://localhost:3000",
              "linux",
            ).lines.join("\n")}
          </pre>
          <p style={{ margin: "10px 0 0", lineHeight: 1.5, color: "var(--ink-3)", fontSize: 12 }}>
            {rich(t("onboarding.wire_p2"), {
              retrieve: code("brain_retrieve_knowledge"),
              log: code("brain_log_event"),
              serverUrl: code("serverUrl"),
              httpUrl: code("httpUrl"),
              bridge: code("mcp-remote"),
              card: <strong>{t("onboarding.connection_status")}</strong>,
            })}
          </p>
        </div>
      ),
    },
    {
      title: t("onboarding.teach_title"),
      body: (
        <div>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
            {rich(t("onboarding.teach_p1"), { lib: code("react-hook-form + zod") })}
          </p>
          <p style={{ margin: 0, lineHeight: 1.55, color: "var(--ink-2)" }}>
            {rich(t("onboarding.teach_p2"), { button: <strong>{t("app.teach")}</strong> })}
          </p>
        </div>
      ),
      cta: {
        label: t("app.teach"),
        action: () => {
          onTeach();
        },
      },
    },
    {
      title: t("onboarding.oracle_title"),
      body: (
        <div>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>{t("onboarding.oracle_p1")}</p>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55, color: "var(--ink-2)" }}>
            {rich(t("onboarding.oracle_try"), {
              q1: <em>{t("onboarding.oracle_q1")}</em>,
              q2: <em>{t("onboarding.oracle_q2")}</em>,
            })}
          </p>
          <p style={{ margin: 0, lineHeight: 1.5, color: "var(--ink-3)", fontSize: 12 }}>
            {t("onboarding.oracle_agent")}{" "}
            <a href="/docs/concepts/using-from-your-agent" style={{ color: "var(--accent-text)" }}>
              {t("onboarding.oracle_agent_link")}
            </a>
          </p>
        </div>
      ),
      cta: {
        label: t("onboarding.oracle_cta"),
        action: () => {
          onOracle();
          dismiss(true);
        },
      },
    },
  ];

  const cur = steps[step]!;
  const last = step === steps.length - 1;

  return (
    <div
      className="cmdk-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.dialog_label")}
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(540px, 92vw)",
          padding: "0",
          background: "var(--bg-elev-1)",
          border: "1px solid var(--line)",
        }}
      >
        <div
          className="row"
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: "0.06em" }}>
            {t("onboarding.step_of", { n: step + 1, total: steps.length })}
          </div>
          <div className="grow" />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 11, height: 22 }}
            onClick={() => dismiss(true)}
            aria-label={t("onboarding.skip_label")}
          >
            {t("onboarding.skip")}
          </button>
        </div>

        <div style={{ padding: "22px 22px 16px" }}>
          <h2
            className="serif"
            style={{ margin: "0 0 14px", fontSize: 22, fontWeight: 500, letterSpacing: "-0.01em" }}
          >
            {cur.title}
          </h2>
          <div style={{ fontSize: 13.5, color: "var(--ink)" }}>{cur.body}</div>
        </div>

        <div
          className="row"
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--line)",
            gap: 8,
          }}
        >
          <div className="row" style={{ gap: 4 }}>
            {steps.map((_, i) => (
              <span
                key={i}
                aria-hidden
                style={{
                  width: 16,
                  height: 3,
                  borderRadius: 2,
                  background: i <= step ? "var(--accent)" : "var(--line)",
                }}
              />
            ))}
          </div>
          <div className="grow" />
          {step > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
              onClick={() => setStep((s) => s - 1)}
            >
              <Icon name="arrowR" size={10} /> {t("common.back")}
            </button>
          )}
          {cur.cta && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
              onClick={cur.cta.action}
            >
              {cur.cta.label}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 12 }}
            onClick={() => {
              if (last) dismiss(true);
              else setStep((s) => s + 1);
            }}
          >
            {last ? t("common.done") : t("common.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
