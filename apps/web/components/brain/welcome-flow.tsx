"use client";

import { useEffect, useState } from "react";
import { useDashboardStats } from "@/lib/brain/use-dashboard";
import { useT } from "@/lib/brain/i18n";

/**
 * /welcome — post-install verification.
 *
 * Scope narrowed 2026-08-09. This page used to be a three-step flow: pick a
 * tool, copy an install command, then watch for the first session. Steps 1
 * and 2 were removed because /docs/tutorials/00-quick-start does the same job
 * better — 12 clients from the CLIENTS registry with a real comparison table,
 * versus a hardcoded 4-tool radio group and a command containing a
 * placeholder token you could not actually run.
 *
 * What is left is the part nothing else in the app does: a live poll that
 * answers "did the install actually work — has my Brain learned anything
 * yet?", with stuck-state escalation at 90s and 5min. That makes /welcome the
 * page the installer sends people to AFTER installing, rather than a fourth
 * competing answer to "how do I get started".
 *
 * Copy is wired through i18n (the `welcome.*` namespace, en/th/de).
 */

export interface WelcomeFlowProps {
  /** Whether the viewer has a session. Anonymous visitors skip the dashboard
   *  poll so /welcome doesn't fire an auth-failing 401. #33.
   *
   *  `mcpUrl` / `webUrl` were removed with the install snippet — this page no
   *  longer renders any URL, so it no longer needs them injected. The
   *  quick-start tutorial it links to resolves its own. */
  authed?: boolean;
}

export function WelcomeFlow({ authed = false }: WelcomeFlowProps = {}) {
  const tr = useT();
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

      {/* Install pointer — replaces the old Steps 1 + 2 (tool picker +
          install command), removed 2026-08-09.

          Those two steps duplicated /docs/tutorials/00-quick-start, and did it
          worse: a hardcoded 4-tool list against the 12 in the CLIENTS registry,
          and a placeholder-token command you couldn't actually run. The stale
          list also carried a live bug — the "Other" option's id is `generic`
          but its i18n key was `other`, so the raw string
          "welcome.tool_blurb.generic" rendered on screen in all three locales.

          This page's unique job is the one thing nothing else does: the live
          "has your Brain actually learned anything yet?" check below. It is
          where the installer sends people AFTER installing, not a competing
          place to learn how to install. */}
      <section
        className="panel"
        style={{ padding: "18px 22px", marginBottom: 24 }}
        aria-labelledby="welcome-install-heading"
      >
        <h2
          id="welcome-install-heading"
          style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", margin: "0 0 8px" }}
        >
          {tr("welcome.install_title")}
        </h2>
        <p
          style={{
            fontSize: 13.5,
            color: "var(--ink-2)",
            lineHeight: 1.6,
            margin: "0 0 14px",
            maxWidth: 620,
          }}
        >
          {tr("welcome.install_body")}
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <a
            href="/docs/tutorials/00-quick-start"
            className="btn btn-primary"
            style={{ fontSize: 13, textDecoration: "none" }}
          >
            {tr("welcome.install_cta")}
          </a>
          <a
            href="/settings/tokens"
            className="btn btn-ghost"
            style={{ fontSize: 13, textDecoration: "none" }}
          >
            {tr("welcome.get_token")}
          </a>
        </div>
      </section>

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
