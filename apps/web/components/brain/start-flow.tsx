"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/brain/i18n";
import { sanitizeVoucherInput } from "@/lib/brain/agentic-onboarding";
import { buildVoucherAgentPrompt } from "@/lib/brain/agent-prompt";

/**
 * Typography note (2026-08-09): two fixes on top of the original build.
 * `var(--bg-2)` was not a real token anywhere in globals.css — the voucher
 * input and the agent-prompt box had NO fill and rendered as outline-only
 * boxes; now `--bg-elev-1`, the same background the surrounding `.panel`
 * uses. And every heading on the page (card titles, footer headers) used the
 * same 13px weight-500 treatment regardless of role, which is the same
 * "everything looks equally unimportant" mistake made on `/`. Card titles are
 * now 16/600; both path CTAs are `.btn-primary` since this page's entire job
 * is presenting two genuinely equal choices, not favoring one.
 */

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

export function StartFlow({ webUrl, agenticEnabled, initialVoucher = "" }: StartFlowProps) {
  const tr = useT();
  // Sanitize the URL-supplied value on the way IN as well as on the way out —
  // otherwise the raw param would still be visible in the input box, which is
  // where a curious user would copy it from.
  const [voucher, setVoucher] = useState(() => sanitizeVoucherInput(initialVoucher));
  const [copied, setCopied] = useState(false);

  const code = sanitizeVoucherInput(voucher);
  const prompt = useMemo(
    () => (code ? buildVoucherAgentPrompt(webUrl, code) : ""),
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
            background: "var(--bg-elev-1)",
            color: "var(--ink)",
          }}
        />
      </section>

      <div className="welcome-steps">
        {/* Path B — the browser — first/left. Reordered 2026-08-09: the
            no-prior-setup, no-trust-required path belongs first for a general
            pilot audience; the agentic path is the power-user enhancement,
            not the default recommendation. Swapping JSX order (not a CSS
            `order:` override) moves DOM order, grid position, and tab order
            together — a visual-only reorder would leave keyboard users
            landing on the visually-second card first. */}
        <section
          className="panel"
          style={{ padding: "18px 20px" }}
          aria-labelledby="start-self-heading"
        >
          <h2
            id="start-self-heading"
            style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)", margin: "0 0 8px" }}
          >
            {tr("start.selfTitle")}
          </h2>
          <p
            style={{
              fontSize: 13.5,
              color: "var(--ink-2)",
              lineHeight: 1.6,
              margin: "0 0 14px",
            }}
          >
            {tr("start.selfBlurb")}
          </p>
          <Link
            className="btn btn-primary"
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

        {/* Path A — the agent does it — second/right */}
        <section
          className="panel"
          style={{ padding: "18px 20px" }}
          aria-labelledby="start-agent-heading"
        >
          <h2
            id="start-agent-heading"
            style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)", margin: "0 0 8px" }}
          >
            {tr("start.agentTitle")}
          </h2>
          <p
            style={{
              fontSize: 13.5,
              color: "var(--ink-2)",
              lineHeight: 1.6,
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
                  background: "var(--bg-elev-1)",
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
              <button type="button" className="btn btn-primary" onClick={onCopy}>
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
      </div>

      {/* A divider before the footer, matching the one `/` uses before its own
          closing section — without it this block read as loose paragraphs
          trailing off the page rather than a deliberate closing section. */}
      <footer
        style={{
          marginTop: 48,
          paddingTop: 32,
          borderTop: "1px solid var(--line-soft)",
          display: "grid",
          gap: 24,
        }}
      >
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", margin: "0 0 6px" }}>
            {tr("start.noCode")}
          </h3>
          <p
            style={{
              fontSize: 13.5,
              color: "var(--ink-3)",
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {tr("start.noCodeBlurb")}
          </p>
        </div>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", margin: "0 0 6px" }}>
            {tr("start.whatIsTitle")}
          </h3>
          <p
            style={{
              fontSize: 13.5,
              color: "var(--ink-3)",
              lineHeight: 1.6,
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
