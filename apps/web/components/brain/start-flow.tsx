"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/brain/i18n";

/**
 * /start — the one public URL that goes on a voucher card.
 *
 * Before this page existed, roughly eighteen surfaces answered "how do I start
 * with Brain" and none of them could be printed next to a code: the good ones
 * (/settings/tokens, the onboarding modal) sit behind a login the voucher
 * holder does not have yet, and /welcome opens by asking which AI tool you use
 * — which is step two of their journey, not step one.
 *
 * So this page presents exactly ONE decision — agent or self — and links out to
 * everything else rather than absorbing it. Adding a section here should feel
 * expensive; the failure mode being corrected was breadth, not depth.
 */

export interface StartFlowProps {
  /** Public webapp origin, server-injected so the prompt shows the real host. */
  webUrl: string;
  /** Whether POST /api/onboard/claim will actually answer on this deployment. */
  agenticEnabled: boolean;
  /** Prefill from ?voucher=CODE so a link in an email needs no typing. */
  initialVoucher?: string;
}

/**
 * The prompt the user pastes. Kept in one place because it is the *product*
 * of this page — every word is doing work:
 *  - names the voucher explicitly so the agent doesn't have to infer it
 *  - points at one URL and says "follow it", bounding what the agent may do
 *  - says "ask me for my email" so the agent doesn't invent one, which is the
 *    single most damaging thing it could improvise here
 */
function buildAgentPrompt(webUrl: string, voucher: string): string {
  return [
    `Set up External Brain on this machine. My voucher code is ${voucher}.`,
    `Fetch ${webUrl.replace(/\/$/, "")}/api/onboard/agent.md and follow it exactly.`,
    `Ask me for my email address first — don't guess it.`,
  ].join("\n");
}

export function StartFlow({ webUrl, agenticEnabled, initialVoucher = "" }: StartFlowProps) {
  const tr = useT();
  const [voucher, setVoucher] = useState(initialVoucher);
  const [copied, setCopied] = useState(false);

  const code = voucher.trim().toUpperCase();
  const prompt = useMemo(
    () => (code ? buildAgentPrompt(webUrl, code) : ""),
    [webUrl, code],
  );

  const onCopy = useCallback(async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API fails in restricted contexts (no HTTPS, sandboxed
      // iframe). The prompt stays visible and selectable, so the user can
      // still copy it by hand — don't fake a success state.
    }
  }, [prompt]);

  return (
    <main
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "56px 24px 96px",
        color: "var(--ink)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <header style={{ marginBottom: 32 }}>
        {/* Every page owes the reader a way out — page-home-link.test.ts
            enforces it. It matters more here than most: this is frequently
            the first Brain page a person ever loads. */}
        <p style={{ margin: "0 0 18px", fontSize: 13 }}>
          <Link href="/" style={{ color: "var(--ink-3)" }}>
            {tr("auth.backToBrain")}
          </Link>
        </p>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            margin: "0 0 10px",
          }}
        >
          {tr("start.title")}
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
          {tr("start.tagline")}
        </p>
      </header>

      {/* Voucher input — shared by both paths, so it sits above the fork. */}
      <section className="panel" style={{ padding: "18px 20px", marginBottom: 20 }}>
        <label
          htmlFor="start-voucher"
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          {tr("start.voucherLabel")}
        </label>
        <input
          id="start-voucher"
          className="mono"
          value={voucher}
          onChange={(e) => setVoucher(e.target.value)}
          placeholder={tr("start.voucherPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: 14,
            borderRadius: 6,
            border: "1px solid var(--line)",
            background: "var(--bg-2)",
            color: "var(--ink)",
          }}
        />
      </section>

      <div className="welcome-steps">
        {/* Path A — the agent does it */}
        <section
          className="panel"
          style={{ padding: "18px 20px" }}
          aria-labelledby="start-agent-heading"
        >
          <h2
            id="start-agent-heading"
            style={{ fontSize: 15, fontWeight: 500, margin: "0 0 8px" }}
          >
            {tr("start.agentTitle")}
          </h2>
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.55,
              margin: "0 0 14px",
            }}
          >
            {tr("start.agentBlurb")}
          </p>

          {!agenticEnabled ? (
            <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>
              {tr("start.agentDisabled")}
            </p>
          ) : !code ? (
            <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>
              {tr("start.agentNeedCode")}
            </p>
          ) : (
            <>
              <pre
                className="mono"
                style={{
                  fontSize: 12,
                  lineHeight: 1.6,
                  background: "var(--bg-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  padding: "12px 14px",
                  margin: "0 0 12px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {prompt}
              </pre>
              <button type="button" className="btn" onClick={onCopy}>
                {copied ? tr("start.agentCopied") : tr("start.agentCopy")}
              </button>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--ink-3)",
                  lineHeight: 1.5,
                  margin: "12px 0 0",
                }}
              >
                {tr("start.agentRestart")}
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--ink-4)",
                  lineHeight: 1.5,
                  margin: "8px 0 0",
                }}
              >
                {tr("start.tokenNote")}
              </p>
            </>
          )}
        </section>

        {/* Path B — the browser */}
        <section
          className="panel"
          style={{ padding: "18px 20px" }}
          aria-labelledby="start-self-heading"
        >
          <h2
            id="start-self-heading"
            style={{ fontSize: 15, fontWeight: 500, margin: "0 0 8px" }}
          >
            {tr("start.selfTitle")}
          </h2>
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.55,
              margin: "0 0 14px",
            }}
          >
            {tr("start.selfBlurb")}
          </p>
          <Link
            className="btn"
            href={code ? `/signup?voucher=${encodeURIComponent(code)}` : "/signup"}
          >
            {tr("start.selfCta")}
          </Link>
          <p style={{ fontSize: 12, margin: "14px 0 0" }}>
            <Link href="/welcome" style={{ color: "var(--ink-3)" }}>
              {tr("start.tourLink")}
            </Link>
          </p>
        </section>
      </div>

      <footer style={{ marginTop: 32, display: "grid", gap: 18 }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 500, margin: "0 0 6px" }}>
            {tr("start.noCode")}
          </h3>
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-3)",
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            {tr("start.noCodeBlurb")}
          </p>
        </div>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 500, margin: "0 0 6px" }}>
            {tr("start.whatIsTitle")}
          </h3>
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-3)",
              lineHeight: 1.55,
              margin: "0 0 8px",
            }}
          >
            {tr("start.whatIsBlurb")}
          </p>
          <p style={{ fontSize: 13, margin: 0 }}>
            <Link href="/docs" style={{ color: "var(--ink-2)" }}>
              {tr("start.learnMore")}
            </Link>
          </p>
        </div>
        <p style={{ fontSize: 13, margin: 0 }}>
          <Link href="/signin" style={{ color: "var(--ink-3)" }}>
            {tr("start.signinLink")}
          </Link>
        </p>
      </footer>
    </main>
  );
}
