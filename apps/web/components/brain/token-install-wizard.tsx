"use client";

import { useState } from "react";
import { CLIENTS, clientById, needsOsChoice } from "@brain/core/install-snippets";
import type { ClientId, TargetOS } from "@brain/core/install-snippets";
import { buildTokenAgentPrompt } from "@/lib/brain/agent-prompt";
import { useLang, useT } from "@/lib/brain/i18n";
import { rich } from "@/lib/brain/rich-text";
import { runTokenTest, tokenTestMessage, type TokenTestResult } from "@/lib/brain/token-test";

// ─── types ────────────────────────────────────────────────────────────────────

// The client list, its labels, and the snippet each one renders all come from
// @brain/core's registry — the same list the `/api/onboard.*` installers are
// generated from. Keeping a second copy here is how the picker and the
// installer drift into disagreeing about what a client is called.

const OS_OPTIONS: { id: TargetOS; label: string }[] = [
  { id: "darwin", label: "macOS" },
  { id: "linux", label: "Linux" },
  { id: "win32", label: "Windows" },
];

// ─── props ────────────────────────────────────────────────────────────────────

export interface TokenInstallWizardProps {
  /** The newly minted / rotated raw bearer token (shown once). */
  rawToken: string;
  /** The token's row id — used for the Test connection call. */
  tokenId: string;
  /** Public MCP endpoint URL (e.g. https://brain.example.com/mcp). */
  mcpUrl: string;
  /** Public webapp URL (e.g. https://brain.example.com). */
  webUrl: string;
  /** Optional: the old token's scheduled revoke time shown for rotate flows. */
  oldTokenScheduledRevokeAt?: string | null;
  /** Called when the user dismisses the wizard. */
  onClose: () => void;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Detect the likely OS from the browser user-agent. Defaults to linux. */
function detectOs(): TargetOS {
  if (typeof navigator === "undefined") return "linux";
  const ua = navigator.userAgent;
  if (/Mac/.test(ua)) return "darwin";
  if (/Win/.test(ua)) return "win32";
  return "linux";
}

// ─── component ────────────────────────────────────────────────────────────────

export function TokenInstallWizard({
  rawToken,
  tokenId,
  mcpUrl,
  webUrl,
  oldTokenScheduledRevokeAt,
  onClose,
}: TokenInstallWizardProps) {
  const t = useT();
  const lang = useLang();
  const [tab, setTab] = useState<"manual" | "prompt">("manual");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientId>("claude-code");
  // detectOs() reads `navigator`, but the wizard only mounts client-side after
  // a mint (it's never in the SSR HTML), so there's no hydration to mismatch —
  // initializing from detectOs() here is correct and avoids an OS-default flash.
  const [selectedOs, setSelectedOs] = useState<TargetOS>(detectOs);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  // When the Clipboard API is unavailable (insecure context, browser
  // without permission, etc.) we surface a manual-select hint instead of
  // silently doing nothing. Keyed by which field the user just tried.
  const [copyFailed, setCopyFailed] = useState<
    null | "token" | "snippet" | "path" | "command" | "prompt"
  >(null);
  const [testStatus, setTestStatus] = useState<
    null | { loading: true } | { loading: false; result: TokenTestResult }
  >(null);

  const clientOption = clientById(selectedClient)!;
  const snippet = clientOption.snippet(rawToken, mcpUrl, webUrl, selectedOs);
  const snippetBody = snippet.lines.join("\n");
  // A "shell" snippet already IS its command; rendering both would show the
  // same line twice under two different headings.
  const command = snippet.kind === "shell" ? undefined : snippet.command;
  const commandBody = command?.lines.join("\n") ?? "";

  const configPathForOs = snippet.configPath
    ? snippet.configPath[selectedOs]
    : null;

  /**
   * Best-effort copy that degrades gracefully on insecure contexts.
   * Tries the modern Clipboard API first; on failure surfaces a hint so
   * the user knows to select manually rather than wondering why nothing
   * happened. The previous code silently swallowed the rejection.
   */
  const tryCopy = async (
    text: string,
    kind: "token" | "snippet" | "path" | "command" | "prompt",
  ): Promise<boolean> => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopyFailed(null);
        return true;
      }
    } catch {
      /* fall through to fallback */
    }
    setCopyFailed(kind);
    return false;
  };

  const copySnippet = async () => {
    if (await tryCopy(snippetBody, "snippet")) {
      setCopiedSnippet(true);
      window.setTimeout(() => setCopiedSnippet(false), 1500);
    }
  };

  const copyCommand = async () => {
    if (await tryCopy(commandBody, "command")) {
      setCopiedCommand(true);
      window.setTimeout(() => setCopiedCommand(false), 1500);
    }
  };

  const copyToken = async () => {
    if (await tryCopy(rawToken, "token")) {
      setCopiedToken(true);
      window.setTimeout(() => setCopiedToken(false), 1500);
    }
  };

  const copyPath = async (path: string) => {
    if (await tryCopy(path, "path")) {
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 1500);
    }
  };

  const agentPrompt = buildTokenAgentPrompt(webUrl, rawToken);
  const copyPrompt = async () => {
    if (await tryCopy(agentPrompt, "prompt")) {
      setCopiedPrompt(true);
      window.setTimeout(() => setCopiedPrompt(false), 1500);
    }
  };

  const testConnection = async () => {
    setTestStatus({ loading: true });
    setTestStatus({ loading: false, result: await runTokenTest(tokenId) });
  };

  return (
    <div
      className="panel"
      style={{
        padding: "14px 16px",
        marginBottom: 24,
        borderLeft: "3px solid var(--accent)",
        background: "var(--bg-elev-1)",
      }}
    >
      {/* ── Header ── */}
      <div
        className="row"
        style={{ marginBottom: 10, alignItems: "center" }}
      >
        <div
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-4)", letterSpacing: "0.06em" }}
        >
          {t("wizard.shown_once")}
        </div>
        <div className="grow" />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12, height: 22 }}
          onClick={onClose}
          aria-label={t("wizard.dismiss_label")}
        >
          {t("common.dismiss")}
        </button>
      </div>

      <h3
        style={{
          fontSize: 14,
          fontWeight: 500,
          margin: "0 0 12px",
          letterSpacing: "-0.01em",
        }}
      >
        {t("wizard.heading")}
      </h3>

      {/* ── Raw token warning ── */}
      <div
        style={{
          padding: "8px 10px",
          marginBottom: 14,
          background: "var(--bg)",
          border: "1px solid var(--line)",
          borderRadius: 4,
          position: "relative",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", marginBottom: 4 }}
        >
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-4)", flex: 1 }}
          >
            {t("wizard.your_token")}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 11, height: 20, padding: "0 6px", marginLeft: 6 }}
            onClick={() => void copyToken()}
            aria-label={t("wizard.copy_token_label")}
          >
            {copiedToken ? t("common.copied") : t("common.copy")}
          </button>
        </div>
        <code
          style={{
            display: "block",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            wordBreak: "break-all",
            color: "var(--ink)",
            userSelect: "all",
          }}
        >
          {rawToken}
        </code>
        {copyFailed === "token" && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: "var(--warn, #f5a623)",
              lineHeight: 1.45,
            }}
          >
            {t("wizard.clip_token")}
          </div>
        )}
      </div>

      {/* ── Grace-period note (rotation only) ── */}
      {oldTokenScheduledRevokeAt && (
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            marginBottom: 14,
            lineHeight: 1.5,
          }}
        >
          {rich(t("wizard.old_revokes"), {
            date: <strong>{new Date(oldTokenScheduledRevokeAt).toLocaleString(lang)}</strong>,
          })}
        </div>
      )}

      {/* ── Tab switcher: manual command vs. agent-run prompt ── */}
      <div
        className="mono"
        style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 8 }}
      >
        {t("wizard.choose_how")}
      </div>
      {/* The inactive tab needs a border the user can actually see WITHOUT
          hovering. Two earlier attempts failed, both reported from screenshots
          of the live page:
            1. `.btn-ghost` — `background/border-color: transparent`. Renders as
               plain text next to a button.
            2. plain `.btn` — border is `--line` (#E2E2DC in light theme) on
               this panel's `--bg-elev-1` (#FFFFFF): a 1.3:1 contrast ratio,
               below WCAG 2.1 SC 1.4.11's 3:1 floor for UI component
               boundaries. Visible only on hover, when the fill changes.
          `--ink-4` (#60606B light / #8C8C9A dark) is the lowest token in the
          ink ramp that is AA-legible as text, so it clears 1.4.11 comfortably
          on both themes (~6.2:1 on white). Do not "simplify" this back to the
          default `.btn` border. */}
      <div
        role="tablist"
        aria-label={t("wizard.method_label")}
        style={{ display: "flex", gap: 6, marginBottom: 14 }}
      >
        {([
          ["manual", t("wizard.tab_manual")],
          ["prompt", t("wizard.tab_prompt")],
        ] as const).map(([id, label]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? "btn btn-primary" : "btn"}
              style={{
                fontSize: 12.5,
                height: 28,
                ...(active
                  ? {}
                  : { borderColor: "var(--ink-4)", color: "var(--ink)" }),
              }}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {tab === "prompt" && (
        <div>
          <div
            style={{
              fontSize: 12,
              color: "var(--ink-3)",
              marginBottom: 8,
              lineHeight: 1.5,
            }}
          >
            {t("wizard.prompt_intro")}
          </div>
          <pre
            className="mono"
            style={{
              fontSize: 12,
              lineHeight: 1.6,
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: 4,
              padding: "10px 12px",
              margin: "0 0 8px",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              userSelect: "all",
            }}
          >
            {agentPrompt}
          </pre>
          {copyFailed === "prompt" && (
            <div
              style={{
                marginBottom: 8,
                fontSize: 12,
                color: "var(--warn, #f5a623)",
                lineHeight: 1.45,
              }}
            >
              {t("wizard.clip_prompt")}
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 13 }}
            onClick={() => void copyPrompt()}
          >
            {copiedPrompt ? t("common.copied") : t("wizard.copy_prompt")}
          </button>
        </div>
      )}

      {tab === "manual" && (
        <>
      {/* ── Step 1: client picker ── */}
      <div
        className="mono"
        style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 8 }}
      >
        {t("wizard.step_client")}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-3)",
          marginBottom: 8,
          lineHeight: 1.5,
        }}
      >
        {rich(t("wizard.pick_client"), {
          default: <strong style={{ color: "var(--ink-2)" }}>Claude Code (CLI)</strong>,
        })}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          marginBottom: 14,
        }}
      >
        {CLIENTS.map((opt) => (
          <label
            key={opt.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              cursor: "pointer",
              color: "var(--ink)",
            }}
          >
            <input
              type="radio"
              name="client"
              value={opt.id}
              checked={selectedClient === opt.id}
              onChange={() => setSelectedClient(opt.id)}
            />
            {opt.label}
          </label>
        ))}
      </div>

      {/* ── Step 2: OS picker (only when relevant) ── */}
      {needsOsChoice(snippet) && (
        <>
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 8 }}
          >
            {t("wizard.step_os")}
          </div>
          <div
            style={{
              display: "flex",
              gap: 16,
              marginBottom: 14,
            }}
          >
            {OS_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  cursor: "pointer",
                  color: "var(--ink)",
                }}
              >
                <input
                  type="radio"
                  name="os"
                  value={opt.id}
                  checked={selectedOs === opt.id}
                  onChange={() => setSelectedOs(opt.id)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </>
      )}

      {/* ── Step 3: rendered snippet ── */}
      <div
        className="mono"
        style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 8 }}
      >
        {t(command ? "wizard.step_run" : "wizard.step_copy", {
          n: needsOsChoice(snippet) ? 3 : 2,
        })}
      </div>

      {/* One-line install. Shown above the JSON on purpose: pasting config by
          hand is where onboarding goes wrong (wrong path, wrong field name,
          clobbered sibling servers), and the command also verifies the token
          actually reaches a tool — which pasting a file never does. */}
      {command && (
        <>
          <pre
            style={{
              margin: "0 0 8px",
              padding: "10px 12px",
              background: "var(--bg)",
              border: "1px solid var(--line)",
              borderRadius: 4,
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              overflowX: "auto",
              lineHeight: 1.55,
              color: "var(--ink)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              userSelect: "all",
            }}
          >
            {commandBody}
          </pre>
          {copyFailed === "command" && (
            <div
              style={{
                marginTop: -2,
                marginBottom: 8,
                fontSize: 12,
                color: "var(--warn, #f5a623)",
                lineHeight: 1.45,
              }}
            >
              {t("wizard.clip_command")}
            </div>
          )}
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 13 }}
              onClick={() => void copyCommand()}
            >
              {copiedCommand ? t("common.copied") : t("wizard.copy_command")}
            </button>
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-3)",
              marginBottom: 14,
              lineHeight: 1.5,
            }}
          >
            {command.via === "native" ? t("wizard.via_native") : t("wizard.via_merge")}
            {command.note ? ` ${command.note}` : ""}
          </div>
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 8 }}
          >
            {t("wizard.by_hand")}
          </div>
        </>
      )}

      {/* Config path */}
      {configPathForOs && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <span
            style={{ fontSize: 13, color: "var(--ink-3)" }}
          >
            {t("wizard.config_path")}
          </span>
          <code
            style={{
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              color: "var(--ink-2)",
              cursor: "pointer",
              textDecoration: "underline dotted",
            }}
            title={t("wizard.copy_path_title")}
            onClick={() => void copyPath(configPathForOs)}
          >
            {configPathForOs}
          </code>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 11, height: 20, padding: "0 6px" }}
            onClick={() => void copyPath(configPathForOs)}
          >
            {copiedPath ? t("common.copied") : t("wizard.copy_path")}
          </button>
        </div>
      )}

      {/* Snippet body */}
      <div style={{ position: "relative" }}>
        <pre
          style={{
            margin: "0 0 8px",
            padding: "10px 12px",
            background: "var(--bg)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            overflowX: "auto",
            lineHeight: 1.55,
            color: "var(--ink)",
            whiteSpace: "pre",
            userSelect: "all",
          }}
        >
          {snippetBody}
        </pre>
        {copyFailed === "snippet" && (
          <div
            style={{
              marginTop: -2,
              marginBottom: 8,
              fontSize: 12,
              color: "var(--warn, #f5a623)",
              lineHeight: 1.45,
            }}
          >
            {t("wizard.clip_snippet")}
          </div>
        )}
      </div>

      {/* Note */}
      {snippet.note && (
        <div
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            marginBottom: 10,
            lineHeight: 1.5,
          }}
        >
          {snippet.note}
        </div>
      )}

      {/* Action buttons */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ fontSize: 13 }}
          onClick={() => void copySnippet()}
        >
          {copiedSnippet ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      </>
      )}

      {/* Test connection — common to both tabs: the agent-run prompt path
          also ends in a live MCP connection, so the same check applies. */}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: tab === "prompt" ? 14 : 10 }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 13 }}
          onClick={() => void testConnection()}
          disabled={testStatus?.loading === true}
        >
          {testStatus?.loading ? t("wizard.testing") : t("wizard.test")}
        </button>
      </div>

      {/* Test result */}
      {testStatus && !testStatus.loading && (
        <div
          role="status"
          style={{
            marginTop: 8,
            fontSize: 13,
            color: testStatus.result.ok ? "var(--good, #22c55e)" : "var(--bad, #ff6b6b)",
          }}
        >
          {testStatus.result.ok ? "\u2713" : "\u2717"} {tokenTestMessage(t, lang, testStatus.result)}
        </div>
      )}
    </div>
  );
}
