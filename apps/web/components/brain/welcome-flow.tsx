"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDashboardStats } from "@/lib/brain/use-dashboard";
import { useT } from "@/lib/brain/i18n";
import {
  claudeCodeCli,
  cursor,
  windsurf,
  rawMcpServersJson,
} from "@brain/core/install-snippets";

/**
 * /welcome — first-run guided flow (roadmap-1).
 *
 * The previous empty-state assumed the user already understood Brain.
 * This page replaces that assumption with three concrete steps:
 *   1. Pick an AI tool — sets the install-snippet variant
 *   2. Copy the install command — auto-updates per tool choice
 *   3. Run any AI task — live status polls until first session arrives
 *
 * Copy is wired through i18n (the `welcome.*` namespace, en/th/de). The TH/DE
 * strings were AI-generated and await a native sweep — see docs/KNOWN_ISSUES.md.
 */

type ToolChoice = "claude-code" | "cursor" | "windsurf" | "other";

interface ToolOption {
  id: ToolChoice;
  label: string;
  blurb: string;
}

const TOOLS: ToolOption[] = [
  { id: "claude-code", label: "Claude Code", blurb: "Anthropic's terminal coding agent" },
  { id: "cursor", label: "Cursor", blurb: "Editor with built-in MCP support" },
  { id: "windsurf", label: "Windsurf", blurb: "Codeium's MCP-aware IDE" },
  { id: "other", label: "Other (any MCP client)", blurb: "Generic mcpServers JSON" },
];

// Fallbacks for dev (no env vars wired). On a real deployment, the
// /welcome server component reads BRAIN_MCP_PUBLIC_HOSTNAME and
// BRAIN_PUBLIC_HOSTNAME from process.env and passes them down — see #293.
function fallbackMcpUrl(): string {
  if (typeof window === "undefined") return "http://localhost:3100/mcp";
  return `${window.location.protocol}//${window.location.hostname}:3100/mcp`;
}

function fallbackWebUrl(): string {
  if (typeof window === "undefined") return "http://localhost:3000";
  return `${window.location.protocol}//${window.location.host}`;
}

function detectOs(): "darwin" | "linux" | "win32" {
  if (typeof navigator === "undefined") return "linux";
  const p = navigator.platform.toLowerCase();
  if (p.includes("mac")) return "darwin";
  if (p.includes("win")) return "win32";
  return "linux";
}

/**
 * The /welcome page intentionally renders the install snippet with a
 * placeholder token instead of minting one — minting requires a name and
 * commits a row, which is the wrong default for an exploratory landing
 * page. The "Generate your token" link routes to /settings/tokens where
 * the real wizard lives.
 */
const PLACEHOLDER_TOKEN = "<YOUR_TOKEN_HERE>";

export interface WelcomeFlowProps {
  /** Public MCP URL (e.g. https://mcp.brain.example.com/mcp). Server-injected
   *  from BRAIN_MCP_PUBLIC_HOSTNAME; falls back to ${origin}:3100/mcp for dev. */
  mcpUrl?: string | undefined;
  /** Public webapp URL (e.g. https://brain.example.com). */
  webUrl?: string | undefined;
  /** Whether the viewer has a session. Anonymous visitors skip the dashboard
   *  poll so /welcome doesn't fire an auth-failing 401. #33. */
  authed?: boolean;
}

export function WelcomeFlow({ mcpUrl, webUrl, authed = false }: WelcomeFlowProps = {}) {
  const tr = useT();
  const [tool, setTool] = useState<ToolChoice>("claude-code");
  const [copied, setCopied] = useState(false);
  // Closes ExternalBrain #10 — the 60-second promise had no stuck-state
  // diagnostic. Track wall-clock elapsed since the page loaded so we can
  // escalate the "Waiting for first session…" copy once it's clear the
  // install didn't take.
  const [waitStartedAt] = useState(() => Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);
  const { stats, loadState, refresh } = useDashboardStats("all", authed);

  // Poll dashboard every 4s while we're waiting for the first session.
  // Stops once one arrives — no need to keep hammering /api/dashboard.
  // Also stops on 401 (unauthorized): polling won't fix sign-in state.
  // Anonymous viewers never poll (the fetch would 401). #33.
  useEffect(() => {
    if (!authed) return;
    if (stats.sessionsAllTime > 0) return;
    if (loadState === "unauthorized") return;
    const id = window.setInterval(() => {
      void refresh();
      setElapsedSec(Math.floor((Date.now() - waitStartedAt) / 1000));
    }, 4000);
    return () => window.clearInterval(id);
  }, [authed, stats.sessionsAllTime, loadState, refresh, waitStartedAt]);

  // window/navigator are client-only. Read them post-mount and keep SSR-safe
  // defaults for the first render, so the install snippet's text matches
  // between server and client (reading them during render returned
  // localhost:3000 on SSR but window.location.host on the client → a React
  // #418 text mismatch whenever BRAIN_*_PUBLIC_HOSTNAME isn't injected).
  const [client, setClient] = useState<{ mcp: string; web: string; os: "darwin" | "linux" | "win32" }>({
    mcp: "http://localhost:3100/mcp",
    web: "http://localhost:3000",
    os: "linux",
  });
  useEffect(() => {
    setClient({ mcp: fallbackMcpUrl(), web: fallbackWebUrl(), os: detectOs() });
  }, []);

  const snippet = useMemo(() => {
    const os = client.os;
    const resolvedMcpUrl = mcpUrl ?? client.mcp;
    const resolvedWebUrl = webUrl ?? client.web;
    switch (tool) {
      case "claude-code":
        return claudeCodeCli(PLACEHOLDER_TOKEN, resolvedMcpUrl, resolvedWebUrl, os);
      case "cursor":
        return cursor(PLACEHOLDER_TOKEN, resolvedMcpUrl, resolvedWebUrl, os);
      case "windsurf":
        return windsurf(PLACEHOLDER_TOKEN, resolvedMcpUrl, resolvedWebUrl, os);
      case "other":
      default:
        return rawMcpServersJson(PLACEHOLDER_TOKEN, resolvedMcpUrl, resolvedWebUrl, os);
    }
  }, [tool, mcpUrl, webUrl, client]);

  const snippetText = snippet.lines.join("\n");

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippetText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in restricted contexts (iframe, no HTTPS);
      // fall back to a select-all hint by not toggling copied state.
    }
  }, [snippetText]);

  const firstSessionArrived = stats.sessionsAllTime > 0;

  return (
    <main
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "56px 24px 96px",
        color: "var(--ink)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Heading */}
      <header style={{ marginBottom: 36 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            margin: "0 0 10px",
          }}
        >
          {tr("welcome.title")}
        </h1>
        <p
          style={{
            fontSize: 15,
            color: "var(--ink-2)",
            lineHeight: 1.55,
            margin: 0,
            maxWidth: 620,
          }}
        >
          {tr("welcome.tagline")}
        </p>
      </header>

      {/* Steps 1 + 2 — side by side on desktop, stacked on mobile
          (.welcome-steps in globals.css) */}
      <div className="welcome-steps">
        {/* Step 1 — pick a tool */}
        <section
          className="panel"
          style={{ padding: "18px 20px" }}
          aria-labelledby="welcome-step1-heading"
        >
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            {tr("welcome.step")} 1
          </div>
          <h2
            id="welcome-step1-heading"
            style={{
              fontSize: 14,
              fontWeight: 500,
              margin: "0 0 14px",
              letterSpacing: "-0.01em",
            }}
          >
            {tr("welcome.step1_title")}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {TOOLS.map((t) => {
              const checked = tool === t.id;
              return (
                <label
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 4,
                    cursor: "pointer",
                    border: `1px solid ${checked ? "var(--accent)" : "var(--line)"}`,
                    background: checked ? "var(--accent-wash, var(--bg))" : "var(--bg)",
                  }}
                >
                  <input
                    type="radio"
                    name="welcome-tool"
                    value={t.id}
                    checked={checked}
                    onChange={() => setTool(t.id)}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ display: "block" }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{t.label}</span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12,
                        color: "var(--ink-3)",
                        marginTop: 1,
                      }}
                    >
                      {tr(`welcome.tool_blurb.${t.id}`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        {/* Step 2 — install command */}
        <section
          className="panel"
          style={{ padding: "18px 20px", display: "flex", flexDirection: "column" }}
          aria-labelledby="welcome-step2-heading"
        >
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            {tr("welcome.step")} 2
          </div>
          <h2
            id="welcome-step2-heading"
            style={{
              fontSize: 14,
              fontWeight: 500,
              margin: "0 0 14px",
              letterSpacing: "-0.01em",
            }}
          >
            {tr("welcome.step2_title")}
          </h2>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: "12px 14px",
              fontSize: 12,
              lineHeight: 1.55,
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: 4,
              color: "var(--ink)",
              // Wrap the command so the whole thing is visible — a one-line
              // curl was overflowing off the right edge (cut off at "| bash"
              // on desktop, at "https://" on mobile) inside a box that `flex:1`
              // had ballooned to match the tall tool-picker column. Live audit
              // 2026-05-29: a first-timer was told to "Replace <YOUR_TOKEN>" in
              // a command they couldn't fully see. Size to content + wrap.
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 280,
            }}
          >
            {snippetText}
          </pre>
          {snippet.note && (
            <p
              style={{
                fontSize: 12,
                color: "var(--ink-3)",
                margin: "8px 0 0",
                lineHeight: 1.5,
              }}
            >
              {snippet.note}
            </p>
          )}
          <div
            className="row"
            style={{ gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}
          >
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 13 }}
              onClick={() => void onCopy()}
            >
              {copied ? tr("welcome.copied") : tr("welcome.copy")}
            </button>
            <a
              href="/settings/tokens"
              className="btn btn-ghost"
              style={{ fontSize: 13, textDecoration: "none" }}
            >
              {tr("welcome.get_token")}
            </a>
            <span
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                marginLeft: "auto",
              }}
            >
              {tr("welcome.replace_prefix")} <code className="mono">{PLACEHOLDER_TOKEN}</code> {tr("welcome.replace_suffix")}
            </span>
          </div>
        </section>
      </div>

      {/* Step 3 — live status */}
      <section
        className="panel"
        style={{
          padding: "18px 22px",
          marginBottom: 24,
          borderLeft: `3px solid ${firstSessionArrived ? "var(--good, #22c55e)" : "var(--accent)"}`,
        }}
        aria-labelledby="welcome-step3-heading"
        aria-live="polite"
      >
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            letterSpacing: "0.06em",
            marginBottom: 4,
          }}
        >
          {tr("welcome.step")} 3
        </div>
        <h2
          id="welcome-step3-heading"
          style={{
            fontSize: 14,
            fontWeight: 500,
            margin: "0 0 10px",
            letterSpacing: "-0.01em",
          }}
        >
          {tr("welcome.step3_title")}
        </h2>
        {firstSessionArrived ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 9,
                height: 9,
                borderRadius: "50%",
                background: "var(--good, #22c55e)",
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: 14, color: "var(--ink)" }}>
              {tr("welcome.success")}
            </span>
            <a
              href="/"
              className="btn btn-primary"
              style={{
                fontSize: 13,
                textDecoration: "none",
                marginLeft: "auto",
              }}
            >
              {tr("welcome.go_dashboard")}
            </a>
            <a
              href="/docs/concepts/using-from-your-agent"
              className="btn btn-ghost"
              style={{ fontSize: 13, textDecoration: "none" }}
            >
              See the prompts to keep using it →
            </a>
          </div>
        ) : (
          // Stuck-state escalation (#10): after 90s, switch from "waiting"
          // (cool blue) to "still waiting?" (amber) — the install probably
          // didn't take. After 5 min, surface a troubleshooting bullet
          // list with the most common causes.
          (() => {
            // Anonymous visitors never poll (#33), so loadState stays "loading"
            // and never reaches "unauthorized" — treat !authed the same so they
            // still get the Sign-in CTA instead of a dead-end "Waiting…". (#44)
            const showSignin = !authed || loadState === "unauthorized";
            const stuck = !showSignin && elapsedSec >= 90;
            const veryStuck = !showSignin && elapsedSec >= 300;
            const dotColor = stuck ? "var(--warn, #d97757)" : "var(--accent)";
            return (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    aria-hidden
                    className="welcome-pulse"
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: dotColor,
                      display: "inline-block",
                    }}
                  />
                  <span style={{ fontSize: 14, color: "var(--ink-2)" }}>
                    {showSignin ? (
                      <>
                        <a href="/signin?next=/welcome" style={{ color: "var(--accent-text)" }}>
                          {tr("welcome.signin_link")}
                        </a>{" "}
                        {tr("welcome.signin_rest")}
                      </>
                    ) : stuck ? (
                      <>
                        {tr("welcome.stuck", { min: Math.floor(elapsedSec / 60) || 1 })}
                      </>
                    ) : (
                      tr("welcome.waiting")
                    )}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--ink-4)",
                      marginLeft: "auto",
                    }}
                  >
                    {tr("welcome.tip_prefix")} <code className="mono">brain_get_user_style</code> {tr("welcome.tip_suffix")}
                  </span>
                </div>
                {veryStuck && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "12px 14px",
                      background: "rgba(217, 119, 87, 0.06)",
                      border: "1px dashed rgba(217, 119, 87, 0.35)",
                      borderRadius: 6,
                      fontSize: 13,
                      color: "var(--ink-2)",
                      lineHeight: 1.55,
                    }}
                    role="status"
                  >
                    <strong style={{ color: "var(--ink, #ececf0)" }}>{tr("welcome.causes")}</strong>
                    <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                      <li>
                        {tr("welcome.cause1_prefix")}{" "}
                        <a href="/settings/tokens" style={{ color: "var(--accent-text)" }}>
                          /settings/tokens
                        </a>
                        .
                      </li>
                      <li>
                        {tr("welcome.cause2_prefix")}{" "}
                        <code className="mono">mcp.&lt;host&gt;</code>{" "}
                        {tr("welcome.cause2_suffix")}
                      </li>
                      <li>
                        {tr("welcome.cause3")}
                      </li>
                    </ul>
                  </div>
                )}
              </>
            );
          })()
        )}
      </section>

      {/* Skip welcome link */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <a
          href="/"
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            textDecoration: "none",
          }}
        >
          {tr("welcome.skip")}
        </a>
      </div>

      {/* Local keyframes for the pulsing dot. Scoped via animation name
          prefix so it can't collide with sibling components' styles. */}
      <style jsx>{`
        :global(.welcome-pulse) {
          animation: welcome-pulse-anim 1.4s ease-in-out infinite;
        }
        @keyframes welcome-pulse-anim {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.35; transform: scale(0.85); }
        }
      `}</style>
    </main>
  );
}
