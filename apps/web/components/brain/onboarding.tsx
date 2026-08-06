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
import { rawMcpServersJson } from "@brain/core/install-snippets";
import { Icon } from "./icons";

const STORAGE_KEY = "bp_onboarded";

interface Props {
  /** Real MCP endpoint from the deploy env, injected by the server component.
   *  Undefined in local dev, where localhost:3100 is correct. */
  mcpUrl?: string | undefined;
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
  knowledgeCount,
  ready,
  onTeach,
  onOracle,
  onAutoskill: _onAutoskill,
}: Props) {
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

  const steps: Array<{ title: string; body: React.ReactNode; cta?: { label: string; action: () => void } }> = [
    {
      title: "Welcome to your Brain",
      body: (
        <div>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
            Every coding session with your AI tools produces knowledge — patterns, preferences,
            decisions. Most of it evaporates.
          </p>
          <p style={{ margin: 0, lineHeight: 1.55, color: "var(--ink-2)" }}>
            External Brain captures it from any MCP-compatible client, organizes it as typed skills
            and rules, and lets you query it back in natural language via the Oracle. We'll spend
            about a minute getting you wired up.
          </p>
        </div>
      ),
    },
    {
      title: "Create a token for your AI tool",
      body: (
        <div>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
            Your AI tool (Claude Code, Cursor, Windsurf…) talks to the Brain
            over <strong>MCP</strong> — an open standard for letting AI tools
            connect to services. A token is the password it uses.
          </p>
          <p style={{ margin: 0, lineHeight: 1.55, color: "var(--ink-2)" }}>
            Open the <strong>Access tokens</strong> page in a new tab, name
            your token (e.g. <code>laptop</code>), click Create, and copy
            the value — you&rsquo;ll only see it once.
          </p>
        </div>
      ),
      cta: {
        label: "Open access tokens",
        action: () => {
          window.open("/settings/tokens", "_blank", "noopener");
        },
      },
    },
    {
      title: "Wire Claude Code",
      body: (
        <div>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
            Add this entry to <code>~/.claude/mcp.json</code> and restart Claude Code. Replace{" "}
            <code>&lt;TOKEN&gt;</code> with the token you copied.
            {!mcpUrl && (
              <>
                {" "}
                Replace <code>localhost:3100</code> with your Brain&rsquo;s URL if
                you&rsquo;re on a hosted instance (the tokens page shows the exact
                value to use).
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
            {rawMcpServersJson(
              "<TOKEN>",
              mcpUrl ?? "http://localhost:3100/mcp",
              "",
              "linux",
            ).lines.join("\n")}
          </pre>
          <p style={{ margin: "10px 0 0", lineHeight: 1.5, color: "var(--ink-3)", fontSize: 12 }}>
            From now on, every Claude Code session can read your Brain (<code>brain_retrieve_knowledge</code>)
            and report events back (<code>brain_log_event</code>). Other clients differ — Windsurf
            uses <code>serverUrl</code>, Gemini CLI uses <code>httpUrl</code>, and Claude Desktop
            needs the <code>mcp-remote</code> bridge; the tokens page generates the exact snippet
            per client. After your first session, the <strong>Connection status</strong> card on
            the dashboard will show your token with a green dot — that's the proof your machine is
            talking to Brain.
          </p>
        </div>
      ),
    },
    {
      title: "Teach your first skill",
      body: (
        <div>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
            The fastest way to feel the loop is to hand-teach a skill you already follow.
            Example: "In React, always prefer <code>react-hook-form + zod</code> over raw form
            state."
          </p>
          <p style={{ margin: 0, lineHeight: 1.55, color: "var(--ink-2)" }}>
            Click <strong>Add a skill</strong> below and type it in. The next time
            you ask the Oracle "what do I use for forms?", it'll cite this skill. Add two more
            to feel the shape.
          </p>
        </div>
      ),
      cta: {
        label: "Add a skill",
        action: () => {
          onTeach();
        },
      },
    },
    {
      title: "Ask the Oracle",
      body: (
        <div>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55 }}>
            Ask anything about your own coding patterns. Every answer is grounded — claims are
            cited to the skill or session that supports them.
          </p>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55, color: "var(--ink-2)" }}>
            Try: <em>"What patterns do I follow for React forms?"</em> or{" "}
            <em>"How did I solve the last build error?"</em>
          </p>
          <p style={{ margin: 0, lineHeight: 1.5, color: "var(--ink-3)", fontSize: 12 }}>
            New to driving Brain from your agent?{" "}
            <a href="/docs/concepts/using-from-your-agent" style={{ color: "var(--accent-text)" }}>
              See the prompts to type →
            </a>
          </p>
        </div>
      ),
      cta: {
        label: "Open Oracle",
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
      aria-label="Onboarding"
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
            STEP {step + 1} OF {steps.length}
          </div>
          <div className="grow" />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 11, height: 22 }}
            onClick={() => dismiss(true)}
            aria-label="Skip onboarding"
          >
            Skip
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
              <Icon name="arrowR" size={10} /> Back
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
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
