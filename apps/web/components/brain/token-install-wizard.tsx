"use client";

import { useState } from "react";
import { CLIENTS, clientById, needsOsChoice } from "@brain/core/install-snippets";
import type { ClientId, TargetOS } from "@brain/core/install-snippets";
import { buildTokenAgentPrompt } from "@/lib/brain/agent-prompt";

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
    | null
    | { loading: true }
    | { loading: false; ok: true }
    | { loading: false; ok: false; reason: string; detail?: string }
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
    try {
      const res = await fetch("/api/tokens/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        status?: string;
        reason?: string;
        expiresAt?: string;
        scheduledRevokeAt?: string;
      };
      if (!res.ok) {
        setTestStatus({
          loading: false,
          ok: false,
          reason: data.reason ?? `HTTP ${res.status}`,
        });
        return;
      }
      if (data.ok) {
        setTestStatus({ loading: false, ok: true });
      } else {
        let detail: string | undefined;
        if (data.reason === "expired" && data.expiresAt) {
          detail = `expired at ${new Date(data.expiresAt).toLocaleString()}`;
        } else if (data.reason === "scheduled-revoke" && data.scheduledRevokeAt) {
          detail = `scheduled revoke at ${new Date(data.scheduledRevokeAt).toLocaleString()}`;
        }
        const failState: { loading: false; ok: false; reason: string; detail?: string } = {
          loading: false,
          ok: false,
          reason: data.reason ?? "unknown",
        };
        if (detail !== undefined) failState.detail = detail;
        setTestStatus(failState);
      }
    } catch (e) {
      setTestStatus({
        loading: false,
        ok: false,
        reason: e instanceof Error ? e.message : "request failed",
      });
    }
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
          COPY NOW — THIS IS SHOWN ONCE
        </div>
        <div className="grow" />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12, height: 22 }}
          onClick={onClose}
          aria-label="Dismiss wizard"
        >
          Dismiss
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
        Install in your client
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
            YOUR TOKEN — SAVE IT NOW, IT CANNOT BE RETRIEVED LATER
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: 11, height: 20, padding: "0 6px", marginLeft: 6 }}
            onClick={() => void copyToken()}
            aria-label="Copy raw token"
          >
            {copiedToken ? "Copied" : "Copy"}
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
            Clipboard unavailable in this context — triple-click the token above to
            select it, then ⌘/Ctrl+C.
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
          Old token auto-revokes at:{" "}
          <strong>
            {new Date(oldTokenScheduledRevokeAt).toLocaleString()}
          </strong>
          . Both tokens authenticate until then — update your clients at your
          own pace.
        </div>
      )}

      {/* ── Tab switcher: manual command vs. agent-run prompt ── */}
      <div
        role="tablist"
        style={{ display: "flex", gap: 4, marginBottom: 14 }}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "manual"}
          className={tab === "manual" ? "btn btn-primary" : "btn btn-ghost"}
          style={{ fontSize: 12, height: 26 }}
          onClick={() => setTab("manual")}
        >
          Run it myself
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "prompt"}
          className={tab === "prompt" ? "btn btn-primary" : "btn btn-ghost"}
          style={{ fontSize: 12, height: 26 }}
          onClick={() => setTab("prompt")}
        >
          Paste a prompt
        </button>
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
            Paste this into your AI agent — it fetches the setup doc and
            connects itself. No client/OS picking needed.
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
              Clipboard unavailable — click anywhere in the prompt to select
              all, then ⌘/Ctrl+C.
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary"
            style={{ fontSize: 13 }}
            onClick={() => void copyPrompt()}
          >
            {copiedPrompt ? "Copied" : "Copy prompt"}
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
        STEP 1 — CHOOSE YOUR CLIENT
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--ink-3)",
          marginBottom: 8,
          lineHeight: 1.5,
        }}
      >
        Pick the AI tool you actually use. Not sure?{" "}
        <strong style={{ color: "var(--ink-2)" }}>Claude Code (CLI)</strong> is
        the most common starting point.
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
            STEP 2 — CHOOSE YOUR OS
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
        {needsOsChoice(snippet) ? "STEP 3" : "STEP 2"} —{" "}
        {command ? "RUN THIS COMMAND" : "COPY THE SNIPPET"}
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
              Clipboard unavailable — click anywhere in the command to select
              all, then ⌘/Ctrl+C.
            </div>
          )}
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: 13 }}
              onClick={() => void copyCommand()}
            >
              {copiedCommand ? "Copied" : "Copy command"}
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
            {command.via === "native"
              ? "Wires it up with the client's own MCP command, then verifies the connection end-to-end."
              : "Merges into your existing config (other MCP servers are preserved and the file is backed up first), then verifies the connection end-to-end."}
            {command.note ? ` ${command.note}` : ""}
          </div>
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 8 }}
          >
            OR CONFIGURE IT BY HAND
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
            Config path:
          </span>
          <code
            style={{
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              color: "var(--ink-2)",
              cursor: "pointer",
              textDecoration: "underline dotted",
            }}
            title="Click to copy path"
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
            {copiedPath ? "Copied" : "Copy path"}
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
            Clipboard unavailable — click anywhere in the snippet to select all, then ⌘/Ctrl+C.
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
          {copiedSnippet ? "Copied" : "Copy"}
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
          disabled={testStatus !== null && "loading" in testStatus && testStatus.loading}
        >
          {testStatus !== null && "loading" in testStatus && testStatus.loading
            ? "Testing…"
            : "Test connection"}
        </button>
      </div>

      {/* Test result */}
      {testStatus !== null && !("loading" in testStatus && testStatus.loading) && (
        <div
          style={{
            marginTop: 8,
            fontSize: 13,
            color:
              "ok" in testStatus && testStatus.ok
                ? "var(--good, #22c55e)"
                : "var(--bad, #ff6b6b)",
          }}
        >
          {"ok" in testStatus && testStatus.ok ? (
            <>&#10003; Token is active</>
          ) : (
            <>
              &#10007;{" "}
              {"reason" in testStatus ? testStatus.reason : "error"}
              {"detail" in testStatus && testStatus.detail
                ? ` — ${testStatus.detail}`
                : ""}
            </>
          )}
        </div>
      )}
    </div>
  );
}
