/**
 * Cross-platform installer templates served from
 * `/api/onboard.sh` (POSIX) and `/api/onboard.ps1` (Windows).
 *
 * One installer, many clients. The client is selected at run time:
 *
 *   POSIX:    curl -fsSL https://<webhost>/api/onboard.sh | bash -s <token> --client cursor
 *   Windows:  iwr https://<webhost>/api/onboard.ps1 -UseBasicParsing | iex
 *               Install-Brain -Token '<token>' -Client cursor
 *
 * `--client` defaults to `claude-code`, so the one-liner that shipped before
 * multi-client support keeps working verbatim.
 *
 * Three install strategies, picked per client:
 *   1. NATIVE  — the client ships its own `… mcp add` verb (Claude Code,
 *      Copilot CLI, Codex). We shell out to it, so the vendor owns its own
 *      config format and we never have to track it.
 *   2. MERGE   — no vendor verb exists, so we merge the entry into the
 *      client's config file ourselves: back up, parse, preserve every other
 *      server, write atomically.
 *   3. REFUSE  — no vendor verb AND no fixed path (the JetBrains/Visual
 *      Studio/Eclipse/Xcode family). Better to say so than to guess a path.
 *
 * The per-client JSON shapes and config paths are NOT re-encoded here. They
 * are generated from `@brain/core/install-snippets`, the same functions the
 * token wizard renders from, with the bearer left as a `__BRAIN_TOKEN__`
 * placeholder that the installer substitutes at run time. That is what keeps
 * the pasted snippet and the scripted install from drifting — the drift this
 * repo has already paid for twice (KNOWN_ISSUES §0u, §0r).
 *
 * Token is passed as the first positional arg, NOT inlined at template
 * time — that lets the same installer URL be cached publicly while
 * each operator pastes their own bearer at run time.
 *
 * Reviewer-friendly variants (download → inspect → run) are documented in
 * docs/CLIENTS.md.
 */

import { CLIENTS, type ClientId } from "@brain/core/install-snippets";

export interface InstallerOpts {
  mcpUrl: string; // public MCP endpoint (HTTPS or HTTP-with-port for dev)
  webUrl: string; // public webapp origin — used for the SKILL.md fetch URL
}

/**
 * Stand-in for the bearer inside the baked-in config templates. The installer
 * substitutes it into parsed JSON *values* (never by string-replacing the
 * document), so a token containing JSON metacharacters cannot corrupt the
 * file it is written into.
 */
const TOKEN_PLACEHOLDER = "__BRAIN_TOKEN__";

/** Clients the installer drives through the vendor's own `mcp add` verb. */
const NATIVE_CLIENTS: readonly ClientId[] = [
  "claude-code",
  "copilot-cli",
  "codex",
];

interface MergeTarget {
  id: ClientId;
  /** POSIX config path with `~` resolved to `$HOME`; "" when the client has none. */
  pathDarwin: string;
  pathLinux: string;
  /** Windows config path with env vars left for PowerShell to expand. */
  pathWin32: string;
  /** The client's config document, bearer left as the placeholder. */
  json: string;
}

/** `~/x` → `$HOME/x`; relative paths (VS Code's `.vscode/mcp.json`) pass through. */
function toPosixPath(p: string | undefined): string {
  if (!p) return "";
  return p.startsWith("~/") ? `$HOME/${p.slice(2)}` : p;
}

/**
 * Every client whose install is "merge JSON into a config file", with its
 * shape and path taken from the shared generators.
 */
function mergeTargets(opts: InstallerOpts): MergeTarget[] {
  const out: MergeTarget[] = [];
  for (const client of CLIENTS) {
    const linux = client.snippet(
      TOKEN_PLACEHOLDER,
      opts.mcpUrl,
      opts.webUrl,
      "linux",
    );
    if (linux.command?.via !== "installer") continue;
    const darwin = client.snippet(
      TOKEN_PLACEHOLDER,
      opts.mcpUrl,
      opts.webUrl,
      "darwin",
    );
    const win32 = client.snippet(
      TOKEN_PLACEHOLDER,
      opts.mcpUrl,
      opts.webUrl,
      "win32",
    );
    out.push({
      id: client.id,
      pathDarwin: toPosixPath(darwin.configPath?.darwin),
      pathLinux: toPosixPath(linux.configPath?.linux),
      pathWin32: win32.configPath?.win32 ?? "",
      json: linux.lines.join("\n"),
    });
  }
  return out;
}

/** Bash `case` arms resolving a client id to its config path. */
function bashPathCases(targets: MergeTarget[]): string {
  return targets
    .map((t) => {
      if (!t.pathLinux && !t.pathDarwin) {
        // Generic client: the caller must supply --config-path.
        return `    ${t.id}) printf '%s' '' ;;`;
      }
      if (t.pathDarwin === t.pathLinux) {
        return `    ${t.id}) printf '%s' "${t.pathLinux}" ;;`;
      }
      return `    ${t.id})
      if [ "$(uname -s)" = "Darwin" ]; then
        printf '%s' "${t.pathDarwin}"
      else
        printf '%s' "${t.pathLinux}"
      fi ;;`;
    })
    .join("\n");
}

/** Bash `case` arms emitting each client's config document. */
function bashJsonCases(targets: MergeTarget[]): string {
  return targets
    .map(
      (t) => `    ${t.id})
      cat <<'BRAIN_CFG_JSON'
${t.json}
BRAIN_CFG_JSON
      ;;`,
    )
    .join("\n");
}

/** Bash `case` arms mapping a client id to its `brain_start_session` clientType. */
function bashSessionTypeCases(): string {
  return CLIENTS.map(
    (c) => `    ${c.id}) printf '%s' '${c.sessionClientType}' ;;`,
  ).join("\n");
}

/** Space-separated client ids the installer can actually install. */
function installableIds(targets: MergeTarget[]): string {
  return [...NATIVE_CLIENTS, ...targets.map((t) => t.id)].join(" ");
}

export function bashInstaller(opts: InstallerOpts): string {
  const targets = mergeTargets(opts);

  return `#!/usr/bin/env bash
# External Brain — POSIX installer (macOS / Linux / WSL / Git Bash).
# Generated by ${opts.webUrl}/api/onboard.sh — do not commit to a repo
# unless you also commit a token-redaction step.
#
# Usage:
#   curl -fsSL ${opts.webUrl}/api/onboard.sh | bash -s 'bp_…' [--client <id>]
#   # or, audit-first:
#   curl -fsSL ${opts.webUrl}/api/onboard.sh -o /tmp/brain-install.sh
#   less /tmp/brain-install.sh
#   bash /tmp/brain-install.sh 'bp_…' --client cursor
#
# Clients: ${installableIds(targets)}
# Default: claude-code (so the original one-liner keeps working unchanged).

set -eu

MCP_URL='${opts.mcpUrl}'
WEB_URL='${opts.webUrl}'

usage() {
  cat <<USAGE
External Brain installer

  bash brain-install.sh <bp_token> [--client <id>] [--config-path <file>]

  --client       which AI client to wire up (default: claude-code)
                 one of: ${installableIds(targets)}
  --config-path  override the config file to merge into. Required for
                 --client generic; optional elsewhere (e.g. a portable
                 install, or a client whose config lives off the default
                 path because COPILOT_HOME / a custom profile moved it).
USAGE
}

# ── arguments ────────────────────────────────────────────────────────────
TOKEN="\${1:-}"
if [ $# -gt 0 ]; then shift; fi

CLIENT="claude-code"
CONFIG_PATH_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --client)
      CLIENT="\${2:-}"; [ -n "$CLIENT" ] || { echo "ERROR: --client needs a value." >&2; exit 2; }
      shift 2 ;;
    --client=*) CLIENT="\${1#--client=}"; shift ;;
    --config-path)
      CONFIG_PATH_OVERRIDE="\${2:-}"; [ -n "$CONFIG_PATH_OVERRIDE" ] || { echo "ERROR: --config-path needs a value." >&2; exit 2; }
      shift 2 ;;
    --config-path=*) CONFIG_PATH_OVERRIDE="\${1#--config-path=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$TOKEN" ]; then
  echo "ERROR: pass the token as the first argument." >&2
  echo "Get a token at ${opts.webUrl}/settings/tokens" >&2
  usage >&2
  exit 1
fi
if ! printf '%s' "$TOKEN" | grep -qE '^bp_[A-Za-z0-9_-]{20,}$'; then
  echo "ERROR: token doesn't look like a Brain bearer (expected bp_…)." >&2
  exit 1
fi

# ── generated client tables ──────────────────────────────────────────────
# Derived from packages/core/src/install-snippets.ts at request time, so the
# shape written here is byte-for-byte the shape the web wizard shows.

client_config_path() {
  case "$1" in
${bashPathCases(targets)}
    *) printf '%s' '' ;;
  esac
}

client_config_json() {
  case "$1" in
${bashJsonCases(targets)}
    *) printf '%s' '' ;;
  esac
}

client_session_type() {
  case "$1" in
${bashSessionTypeCases()}
    *) printf '%s' 'custom' ;;
  esac
}

# ── shared helpers ───────────────────────────────────────────────────────

need_cmd() {
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "ERROR: '$1' not found on PATH." >&2
  [ -n "\${2:-}" ] && echo "  $2" >&2
  return 1
}

# Merge the client's entry into its JSON config, preserving every other
# server. Python (not jq) because jq is not guaranteed on macOS without
# homebrew or on a Debian slim image, while python3 effectively is.
merge_json_config() {
  target="$1"
  need_cmd python3 "Install python3, or paste the JSON by hand — run with --help for the config path." || return 1

  tmpl="$(mktemp -t brainmcp.XXXXXX)"
  client_config_json "$CLIENT" > "$tmpl"
  if [ ! -s "$tmpl" ]; then
    rm -f "$tmpl"
    echo "ERROR: no config template for client '$CLIENT'." >&2
    return 1
  fi

  # Explicit if/else rather than \`rc=$?\`: under \`set -e\` a failing python3
  # exits the script before the next line runs, leaking $tmpl and skipping the
  # error path this function is supposed to own.
  if ! BRAIN_TOKEN="$TOKEN" python3 - "$target" "$tmpl" <<'PY'
import json, os, shutil, sys, time

target, tmpl = sys.argv[1], sys.argv[2]
token = os.environ["BRAIN_TOKEN"]

with open(tmpl) as f:
    doc = json.load(f)

# Substitute into parsed VALUES, never into the document text: a bearer that
# happened to contain a quote or backslash would otherwise produce a config
# file that is silently unparseable to the client.
def sub(x):
    if isinstance(x, str):
        return x.replace("__BRAIN_TOKEN__", token)
    if isinstance(x, list):
        return [sub(i) for i in x]
    if isinstance(x, dict):
        return {k: sub(v) for k, v in x.items()}
    return x

doc = sub(doc)
wrapper = next(iter(doc))            # "mcpServers" or "servers"
entry = doc[wrapper]["brain"]

existing = {}
if os.path.exists(target):
    with open(target) as f:
        raw = f.read().strip()
    if raw:
        try:
            existing = json.loads(raw)
        except ValueError as e:
            sys.stderr.write(
                "ERROR: %s exists but is not valid JSON (%s).\\n"
                "       Refusing to overwrite it. Fix the file (comments are\\n"
                "       not valid JSON), or re-run with --config-path pointing\\n"
                "       somewhere else, or paste the entry by hand.\\n" % (target, e)
            )
            sys.exit(1)
    if not isinstance(existing, dict):
        sys.stderr.write("ERROR: %s is valid JSON but not an object. Refusing to overwrite.\\n" % target)
        sys.exit(1)
    backup = "%s.bak.%s" % (target, time.strftime("%Y%m%d%H%M%S"))
    shutil.copy2(target, backup)
    print("    backed up  -> %s" % backup)

section = existing.get(wrapper)
if not isinstance(section, dict):
    section = {}
kept = sorted(k for k in section if k != "brain")
replaced = "brain" in section
section["brain"] = entry
existing[wrapper] = section

parent = os.path.dirname(os.path.abspath(target))
if parent:
    os.makedirs(parent, exist_ok=True)
# Write-then-rename: an interrupted install leaves the old config intact
# rather than a truncated one the client refuses to load.
tmp_out = "%s.tmp.%d" % (target, os.getpid())
with open(tmp_out, "w") as f:
    json.dump(existing, f, indent=2)
    f.write("\\n")
os.replace(tmp_out, target)
try:
    os.chmod(target, 0o600)          # the file holds a bearer token
except OSError:
    pass

print("    %s 'brain' under %s" % ("replaced" if replaced else "added", wrapper))
print("    kept %d other server(s)%s" % (len(kept), (": " + ", ".join(kept)) if kept else ""))
PY
  then
    rm -f "$tmpl"
    return 1
  fi
  rm -f "$tmpl"
  return 0
}

# ── per-client install ───────────────────────────────────────────────────

install_claude_code() {
  need_cmd claude "Install Claude Code first: https://docs.claude.com/en/docs/claude-code" || return 1

  echo "==> Registering Brain MCP with Claude Code (user scope)…"
  # Capture both stdout and stderr — \`claude mcp add\` prints the
  # "already exists" hint to either depending on version.
  ADD_OUTPUT=$(claude mcp add brain \\
    --scope user \\
    --transport http \\
    "$MCP_URL" \\
    --header "Authorization: Bearer $TOKEN" 2>&1) || ADD_RC=$?

  if [ "\${ADD_RC:-0}" -ne 0 ]; then
    echo "$ADD_OUTPUT"
    if printf '%s' "$ADD_OUTPUT" | grep -qi 'already exists'; then
      cat <<EOF >&2

A 'brain' MCP server is already registered. Remove it and re-run:

  claude mcp remove brain --scope user
  curl -fsSL ${opts.webUrl}/api/onboard.sh | bash -s '<your-bp_-token>'

(Re-paste the same bp_… token. If the existing entry points at a
different Brain you want to keep, hand-edit \\$HOME/.claude.json to
give one of them a different key — the user-scope namespace is keyed
by name and 'brain' is the name this installer uses.)

EOF
      exit 1
    fi
    echo "ERROR: 'claude mcp add brain' failed:" >&2
    echo "$ADD_OUTPUT" >&2
    exit 1
  fi
  echo "$ADD_OUTPUT"

  SKILL_DIR="$HOME/.claude/skills/brain"
  echo "==> Installing skill at $SKILL_DIR/SKILL.md…"
  mkdir -p "$SKILL_DIR"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$WEB_URL/api/skills/brain" -o "$SKILL_DIR/SKILL.md"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$SKILL_DIR/SKILL.md" "$WEB_URL/api/skills/brain"
  else
    echo "ERROR: neither curl nor wget found. Install one and retry." >&2
    exit 1
  fi

  echo "==> Verifying with \\\`claude mcp list\\\`…"
  if claude mcp list 2>&1 | grep -q '^brain:'; then
    echo "    config OK"
  else
    echo "WARN: Brain entry not visible in \\\`claude mcp list\\\` — restart Claude Code and retry." >&2
  fi

  reconcile_legacy_claude_mcp_json
}

install_copilot_cli() {
  need_cmd copilot "Install GitHub Copilot CLI first: https://docs.github.com/en/copilot/how-tos/copilot-cli" || return 1
  echo "==> Registering Brain MCP with GitHub Copilot CLI…"
  ADD_OUTPUT=$(copilot mcp add \\
    --transport http \\
    --header "Authorization: Bearer $TOKEN" \\
    brain "$MCP_URL" 2>&1) || ADD_RC=$?
  if [ "\${ADD_RC:-0}" -ne 0 ]; then
    echo "ERROR: 'copilot mcp add' failed:" >&2
    echo "$ADD_OUTPUT" >&2
    echo "  Fallback: run 'copilot' then '/mcp add', or re-run this installer with" >&2
    echo "  --config-path \\"\$HOME/.copilot/mcp-config.json\\" to write the file directly." >&2
    exit 1
  fi
  echo "$ADD_OUTPUT"
  echo "    registered (config: \${COPILOT_HOME:-$HOME/.copilot}/mcp-config.json)"
}

install_codex() {
  need_cmd codex "Install Codex CLI first: https://developers.openai.com/codex/cli" || return 1
  echo "==> Registering Brain MCP with Codex CLI…"
  # Codex refuses an inline bearer by design: it stores the NAME of an env
  # var and reads the value at connect time. So the install is only half
  # done until BRAIN_TOKEN exists in the user's shell — which is why the
  # export line below is printed rather than silently appended to a profile.
  ADD_OUTPUT=$(codex mcp add brain \\
    --url "$MCP_URL" \\
    --bearer-token-env-var BRAIN_TOKEN 2>&1) || ADD_RC=$?
  if [ "\${ADD_RC:-0}" -ne 0 ]; then
    echo "ERROR: 'codex mcp add' failed:" >&2
    echo "$ADD_OUTPUT" >&2
    exit 1
  fi
  echo "$ADD_OUTPUT"
  echo
  echo "    ACTION REQUIRED — Codex reads the bearer from the environment."
  echo "    Add this line to your shell profile (~/.zshrc, ~/.bashrc, …):"
  echo
  echo "      export BRAIN_TOKEN='$TOKEN'"
  echo
  echo "    Without it Codex will connect with no Authorization header and get a 401."
}

install_via_config_file() {
  TARGET="$CONFIG_PATH_OVERRIDE"
  if [ -z "$TARGET" ]; then
    TARGET="$(client_config_path "$CLIENT")"
  fi

  if [ -z "$TARGET" ]; then
    echo "==> No default config path for '--client $CLIENT'."
    echo "    Re-run with --config-path <file> to have this merged in, or paste:"
    echo
    client_config_json "$CLIENT" | sed 's/__BRAIN_TOKEN__/'"$TOKEN"'/' | sed 's/^/      /'
    echo
    return 0
  fi

  echo "==> Target: $TARGET"
  merge_json_config "$TARGET"
}

# ----------------------------------------------------------------------
# Reconcile legacy \$HOME/.claude/mcp.json (#222, 2026-05-15)
#
# Some prior Claude Code versions wrote MCP server config to a separate
# file at \$HOME/.claude/mcp.json. Modern \`claude mcp add\` writes to
# \$HOME/.claude.json (top-level \`mcpServers\` key) but does NOT touch
# the legacy file. The CLI still READS both, with the legacy file
# shadowing the modern one on some versions — which means a freshly-
# installed token in .claude.json gets silently overridden by stale
# config in .claude/mcp.json, and the next Claude Code session calls
# the wrong (often decommissioned) host with an old token.
#
# Idempotent — a second run sees no brain entry and is a clean no-op.
# ----------------------------------------------------------------------
reconcile_legacy_claude_mcp_json() {
  LEGACY_MCP_JSON="$HOME/.claude/mcp.json"
  [ -f "$LEGACY_MCP_JSON" ] || return 0
  grep -q '"brain"' "$LEGACY_MCP_JSON" 2>/dev/null || return 0

  LEGACY_OLD_URL=$(grep -oE '"url"[[:space:]]*:[[:space:]]*"[^"]*"' "$LEGACY_MCP_JSON" | head -1 | sed 's/.*"\\(http[^"]*\\)".*/\\1/')
  echo "==> Cleaning legacy $LEGACY_MCP_JSON (was: \${LEGACY_OLD_URL:-unknown URL})…"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$LEGACY_MCP_JSON" <<'PY'
import json, os, sys
p = sys.argv[1]
try:
    with open(p) as f:
        d = json.load(f)
except Exception:
    sys.exit(0)
# Two shapes seen: { "mcpServers": { "brain": {...} } } AND { "brain": {...} } at top level.
changed = False
if isinstance(d.get("mcpServers"), dict) and "brain" in d["mcpServers"]:
    del d["mcpServers"]["brain"]
    changed = True
if isinstance(d, dict) and "brain" in d and not isinstance(d.get("brain"), str):
    del d["brain"]
    changed = True
def is_empty(x):
    if not isinstance(x, dict): return False
    if not x: return True
    return all(k == "mcpServers" and not v for k, v in x.items())
if is_empty(d):
    os.unlink(p)
    print("    legacy file had only the brain entry — removed", flush=True)
elif changed:
    with open(p, "w") as f:
        json.dump(d, f, indent=2)
    print("    stripped brain entry; preserved other servers", flush=True)
else:
    print("    no brain entry found in legacy file — left untouched", flush=True)
PY
  else
    # Conservative bash-only fallback: only delete if the file looks like
    # it ONLY contains a brain entry (the dominant case observed in #222).
    if [ "$(wc -l < "$LEGACY_MCP_JSON")" -le 5 ]; then
      rm -f "$LEGACY_MCP_JSON"
      echo "    removed (single-entry legacy file)"
    else
      echo "WARN: $LEGACY_MCP_JSON has multiple entries and python3 isn't installed." >&2
      echo "      Manually remove the 'brain' entry to avoid stale-config drift." >&2
    fi
  fi
}

# ── dispatch ─────────────────────────────────────────────────────────────

case "$CLIENT" in
  claude-code) install_claude_code ;;
  copilot-cli) install_copilot_cli ;;
  codex)       install_codex ;;
  jetbrains|rest)
    cat <<EOF >&2
ERROR: '--client $CLIENT' cannot be installed from the command line.

  jetbrains — JetBrains IDEs, Visual Studio, Eclipse and Xcode each open
              their own mcp.json editor; there is no stable path to write.
  rest      — the REST + cURL recipe is example code, not an install.

Copy the snippet from ${opts.webUrl}/settings/tokens instead.
EOF
    exit 2 ;;
  *)
    if [ -z "$(client_config_json "$CLIENT")" ]; then
      echo "ERROR: unknown client '$CLIENT'." >&2
      echo "  Known clients: ${installableIds(targets)}" >&2
      exit 2
    fi
    install_via_config_file ;;
esac

# ----------------------------------------------------------------------
# Smoke-test (I1) — prove the round-trip works through the user's
# network, TLS, Caddy, the MCP server, and authenticate() against the
# DB. The config step above only proves a file was written or a vendor
# CLI exited 0; it does NOT prove the bearer reaches a tool. A common
# silent failure: install reports success while the client can never
# call a tool (proxy / firewall / DNS / revoked token).
# ----------------------------------------------------------------------
echo "==> Smoke-testing the MCP round-trip…"
SMOKE_TMP="$(mktemp -t brainsmoke.XXXXXX)"
trap 'rm -f "$SMOKE_TMP" "$SMOKE_TMP.h"' EXIT
INIT_BODY='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"brain-installer","version":"3"}}}'
HTTP=$(curl -sS -o "$SMOKE_TMP" -D "$SMOKE_TMP.h" -w '%{http_code}' \\
  -H "Authorization: Bearer $TOKEN" \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  --max-time 15 -X POST "$MCP_URL" --data "$INIT_BODY") || HTTP=000
if [ "$HTTP" != "200" ]; then
  echo "ERROR: MCP initialize returned HTTP $HTTP" >&2
  echo "  URL: $MCP_URL" >&2
  case "$HTTP" in
    401) echo "  Cause: token rejected — mint a fresh one at ${opts.webUrl}/settings/tokens" >&2 ;;
    000) echo "  Cause: connection failed (DNS, TLS, or firewall block)." >&2 ;;
    502|503|504) echo "  Cause: Brain reachable but MCP backend unhealthy. Retry in 60s." >&2 ;;
    404) echo "  Cause: MCP endpoint not found at this URL — installer template may be stale." >&2 ;;
  esac
  echo "  NOTE: the client config above was still written — fix the cause and it will work." >&2
  exit 1
fi
SID=$(grep -i '^mcp-session-id:' "$SMOKE_TMP.h" | sed 's/^[^:]*: *//; s/[[:space:]]*$//' | head -1)
if [ -z "$SID" ]; then
  echo "ERROR: MCP did not issue Mcp-Session-Id — transport may be misconfigured." >&2
  exit 1
fi
CALL_BODY='{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"brain_get_user_style","arguments":{}}}'
HTTP=$(curl -sS -o "$SMOKE_TMP" -w '%{http_code}' \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Mcp-Session-Id: $SID" \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  --max-time 15 -X POST "$MCP_URL" --data "$CALL_BODY") || HTTP=000
if [ "$HTTP" != "200" ] || ! grep -q '"result"' "$SMOKE_TMP"; then
  echo "ERROR: brain_get_user_style failed (HTTP $HTTP). Response:" >&2
  sed 's/^/  /' "$SMOKE_TMP" >&2
  exit 1
fi
echo "    round-trip OK (session $SID)"

# ----------------------------------------------------------------------
# Install-ping (I2) — best-effort. Creates a real Session in Brain with
# the installing client's type, logs the installer + OS version, and
# reports the outcome so the KEA pipeline has its first signal. Failures
# here are non-fatal: I1 above already proved the round-trip; this just
# seeds the dashboard so the operator can distinguish new installs from
# stale heartbeats.
# ----------------------------------------------------------------------
echo "==> Logging install ping…"
CLIENT_TYPE="$(client_session_type "$CLIENT")"
OS_INFO=$(uname -srm 2>/dev/null | sed 's/[^A-Za-z0-9. _/-]//g')
START_BODY=$(printf '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"brain_start_session","arguments":{"clientType":"%s","prompt":"brain installer ping v3 (%s)"}}}' "$CLIENT_TYPE" "$CLIENT")
curl -sS -o "$SMOKE_TMP" \\
  -H "Authorization: Bearer $TOKEN" -H "Mcp-Session-Id: $SID" \\
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \\
  --max-time 15 -X POST "$MCP_URL" --data "$START_BODY" >/dev/null || true
# The response wraps the sessionId inside a JSON string with escaped quotes
# (\\"sessionId\\": \\"cmp…\\") so a naive sed for "sessionId":"..." misses
# the actual bytes. Cuids in this codebase are c + 24 lowercase alnum chars
# and are the only cuid-shaped token in the start_session response, so
# grep-for-cuid is robust to whatever quoting the JSON-RPC layer adds.
NEW_SID=$(grep -oE 'c[a-z0-9]{24}' "$SMOKE_TMP" | head -1)
if [ -n "$NEW_SID" ]; then
  EV_PAYLOAD=$(printf '{"installer_version":3,"client":"%s","os":"%s"}' "$CLIENT" "$OS_INFO")
  EV_BODY=$(printf '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"brain_log_event","arguments":{"sessionId":"%s","eventType":"tool_use","payload":%s}}}' "$NEW_SID" "$EV_PAYLOAD")
  curl -sS -o /dev/null \\
    -H "Authorization: Bearer $TOKEN" -H "Mcp-Session-Id: $SID" \\
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \\
    --max-time 15 -X POST "$MCP_URL" --data "$EV_BODY" || true
  CLOSE_BODY=$(printf '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"brain_report_session_outcome","arguments":{"sessionId":"%s","success":true}}}' "$NEW_SID")
  curl -sS -o /dev/null \\
    -H "Authorization: Bearer $TOKEN" -H "Mcp-Session-Id: $SID" \\
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \\
    --max-time 15 -X POST "$MCP_URL" --data "$CLOSE_BODY" || true
  echo "    install ping recorded (session $NEW_SID)"
fi

echo
echo "✓ Brain installed and verified for '$CLIENT'."
echo
echo "  To prove your Brain is learning, paste this into a new session:"
echo
echo "    Brain, remember: I prefer pgvector for embeddings on this project,"
echo "    because it co-locates with Postgres backups."
echo
echo "  Your client will call brain_teach_knowledge. See the fact appear at:"
# The app's surfaces are HASH routes inside the SPA shell at
# /<org>/<project> (lib/brain/routes.ts) — a bare /skills path 404s.
# "/" resolves the active project and 307s to its canonical URL; the
# fragment is client-side so it survives the redirect.
echo "    ${opts.webUrl}/#skills"
echo "  Restart your client first — every one of them reads MCP config only at startup."
`;
}

/** PowerShell `switch` arms resolving a client id to its config path. */
function psPathCases(targets: MergeTarget[]): string {
  return targets
    .map((t) => {
      const win = t.pathWin32
        ? `[Environment]::ExpandEnvironmentVariables('${t.pathWin32}')`
        : "''";
      return `    '${t.id}' { ${win} }`;
    })
    .join("\n");
}

/** PowerShell `switch` arms emitting each client's config document. */
function psJsonCases(targets: MergeTarget[]): string {
  return targets
    .map(
      (t) => `    '${t.id}' { @'
${t.json}
'@ }`,
    )
    .join("\n");
}

function psSessionTypeCases(): string {
  return CLIENTS.map((c) => `    '${c.id}' { '${c.sessionClientType}' }`).join(
    "\n",
  );
}

export function powershellInstaller(opts: InstallerOpts): string {
  const targets = mergeTargets(opts);

  return `# External Brain — Windows PowerShell installer.
# Generated by ${opts.webUrl}/api/onboard.ps1
#
# Usage (PowerShell 5.1 or 7+):
#   iwr ${opts.webUrl}/api/onboard.ps1 -UseBasicParsing | iex
#   Install-Brain -Token 'bp_…' -Client cursor
#
# Clients: ${installableIds(targets)}   (default: claude-code)
#
# Audit-first variant:
#   iwr ${opts.webUrl}/api/onboard.ps1 -OutFile $env:TEMP\\brain-install.ps1
#   notepad $env:TEMP\\brain-install.ps1
#   . $env:TEMP\\brain-install.ps1 ; Install-Brain -Token 'bp_…' -Client cursor

function Get-BrainConfigPath {
  param([string] $Client)
  switch ($Client) {
${psPathCases(targets)}
    default { '' }
  }
}

function Get-BrainConfigJson {
  param([string] $Client)
  switch ($Client) {
${psJsonCases(targets)}
    default { '' }
  }
}

function Get-BrainSessionType {
  param([string] $Client)
  switch ($Client) {
${psSessionTypeCases()}
    default { 'custom' }
  }
}

# PS 5.1's ConvertFrom-Json yields PSCustomObject, which cannot take new
# members by index the way a hashtable can. -AsHashtable is PS 7+ only, so
# convert explicitly and keep one code path for both shells.
function ConvertTo-BrainHashtable {
  param($InputObject)
  if ($null -eq $InputObject) { return $null }
  if ($InputObject -is [System.Collections.IDictionary]) {
    $h = @{}
    foreach ($k in $InputObject.Keys) { $h[$k] = ConvertTo-BrainHashtable $InputObject[$k] }
    return $h
  }
  if ($InputObject -is [System.Management.Automation.PSCustomObject]) {
    $h = @{}
    foreach ($p in $InputObject.PSObject.Properties) { $h[$p.Name] = ConvertTo-BrainHashtable $p.Value }
    return $h
  }
  if ($InputObject -is [System.Collections.IEnumerable] -and $InputObject -isnot [string]) {
    return @($InputObject | ForEach-Object { ConvertTo-BrainHashtable $_ })
  }
  return $InputObject
}

function Merge-BrainMcpConfig {
  param(
    [Parameter(Mandatory=$true)] [string] $Target,
    [Parameter(Mandatory=$true)] [string] $Template,
    [Parameter(Mandatory=$true)] [string] $Token
  )

  $doc = ConvertTo-BrainHashtable (ConvertFrom-Json $Template)
  # Substitute into parsed values, not the document text — a bearer with a
  # quote or backslash would otherwise corrupt the file it is written into.
  function Sub-BrainToken($node) {
    if ($node -is [string]) { return $node.Replace('__BRAIN_TOKEN__', $Token) }
    if ($node -is [System.Collections.IDictionary]) {
      $out = @{}
      foreach ($k in $node.Keys) { $out[$k] = Sub-BrainToken $node[$k] }
      return $out
    }
    if ($node -is [array]) { return @($node | ForEach-Object { Sub-BrainToken $_ }) }
    return $node
  }
  $doc = Sub-BrainToken $doc

  $wrapper = @($doc.Keys)[0]
  $entry = $doc[$wrapper]['brain']

  $existing = @{}
  if (Test-Path -LiteralPath $Target) {
    $raw = (Get-Content -LiteralPath $Target -Raw -ErrorAction Stop)
    if ($raw -and $raw.Trim()) {
      try {
        $existing = ConvertTo-BrainHashtable (ConvertFrom-Json $raw)
      } catch {
        Write-Error "$Target exists but is not valid JSON. Refusing to overwrite it — fix the file (comments are not valid JSON) or paste the entry by hand."
        return $false
      }
    }
    if ($existing -isnot [System.Collections.IDictionary]) {
      Write-Error "$Target is valid JSON but not an object. Refusing to overwrite."
      return $false
    }
    $backup = "$Target.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
    Copy-Item -LiteralPath $Target -Destination $backup -Force
    Write-Host "    backed up  -> $backup"
  }

  $section = $existing[$wrapper]
  if ($section -isnot [System.Collections.IDictionary]) { $section = @{} }
  $kept = @($section.Keys | Where-Object { $_ -ne 'brain' } | Sort-Object)
  $replaced = $section.ContainsKey('brain')
  $section['brain'] = $entry
  $existing[$wrapper] = $section

  $parent = Split-Path -Parent $Target
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  # Write-then-move: an interrupted install leaves the old config intact.
  $tmp = "$Target.tmp$PID"
  ($existing | ConvertTo-Json -Depth 20) | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $Target -Force

  $verb = if ($replaced) { 'replaced' } else { 'added' }
  Write-Host "    $verb 'brain' under $wrapper"
  Write-Host "    kept $($kept.Count) other server(s)$(if ($kept.Count) { ': ' + ($kept -join ', ') } else { '' })"
  return $true
}

function Install-Brain {
  param(
    [Parameter(Mandatory=$true, Position=0)] [string] $Token,
    [Parameter(Position=1)] [string] $Client = 'claude-code',
    [string] $ConfigPath = ''
  )

  $ErrorActionPreference = 'Stop'
  $McpUrl = '${opts.mcpUrl}'

  if ($Token -notmatch '^bp_[A-Za-z0-9_-]{20,}$') {
    Write-Error "Token doesn't look like a Brain bearer (expected bp_…). Get one at ${opts.webUrl}/settings/tokens"
    return
  }

  if ($Client -in @('jetbrains','rest')) {
    Write-Error "'-Client $Client' cannot be installed from the command line — those surfaces have no stable config path. Copy the snippet from ${opts.webUrl}/settings/tokens instead."
    return
  }

  switch ($Client) {
    'claude-code' {
      if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
        Write-Error "'claude' CLI not found on PATH. Install Claude Code first: https://docs.claude.com/en/docs/claude-code"
        return
      }
      Write-Host "==> Registering Brain MCP with Claude Code (user scope)…"
      $addOutput = & claude mcp add brain \`
        --scope user \`
        --transport http \`
        $McpUrl \`
        --header "Authorization: Bearer $Token" 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0) {
        Write-Host $addOutput
        if ($addOutput -match '(?i)already exists') {
          Write-Host ""
          Write-Host "A 'brain' MCP server is already registered. Remove it and re-run:" -ForegroundColor Yellow
          Write-Host ""
          Write-Host "  claude mcp remove brain --scope user"
          Write-Host "  Install-Brain -Token '<paste-the-same-bp_-token>'"
          Write-Host ""
          return
        }
        Write-Error "claude mcp add failed (exit $LASTEXITCODE):\`n$addOutput"
        return
      }
      Write-Host $addOutput

      $SkillDir = Join-Path $env:USERPROFILE '.claude\\skills\\brain'
      Write-Host "==> Installing skill at $SkillDir\\SKILL.md…"
      New-Item -ItemType Directory -Force -Path $SkillDir | Out-Null
      Invoke-WebRequest -Uri '${opts.webUrl}/api/skills/brain' \`
                        -OutFile (Join-Path $SkillDir 'SKILL.md') \`
                        -UseBasicParsing

      Write-Host "==> Verifying with \\\`claude mcp list\\\`…"
      $list = & claude mcp list 2>&1 | Out-String
      if ($list -notmatch '(?m)^brain:') {
        Write-Warning "Brain entry not visible in 'claude mcp list' — restart Claude Code and retry."
      }
    }

    'copilot-cli' {
      if (-not (Get-Command copilot -ErrorAction SilentlyContinue)) {
        Write-Error "'copilot' CLI not found on PATH. Install GitHub Copilot CLI first."
        return
      }
      Write-Host "==> Registering Brain MCP with GitHub Copilot CLI…"
      $addOutput = & copilot mcp add --transport http --header "Authorization: Bearer $Token" brain $McpUrl 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0) {
        Write-Error "copilot mcp add failed (exit $LASTEXITCODE):\`n$addOutput"
        return
      }
      Write-Host $addOutput
    }

    'codex' {
      if (-not (Get-Command codex -ErrorAction SilentlyContinue)) {
        Write-Error "'codex' CLI not found on PATH. Install Codex CLI first."
        return
      }
      Write-Host "==> Registering Brain MCP with Codex CLI…"
      $addOutput = & codex mcp add brain --url $McpUrl --bearer-token-env-var BRAIN_TOKEN 2>&1 | Out-String
      if ($LASTEXITCODE -ne 0) {
        Write-Error "codex mcp add failed (exit $LASTEXITCODE):\`n$addOutput"
        return
      }
      Write-Host $addOutput
      Write-Host ""
      Write-Host "    ACTION REQUIRED — Codex reads the bearer from the environment." -ForegroundColor Yellow
      Write-Host "    Run this once so it persists for future shells:"
      Write-Host ""
      Write-Host "      [Environment]::SetEnvironmentVariable('BRAIN_TOKEN','$Token','User')"
      Write-Host ""
      Write-Host "    Without it Codex connects with no Authorization header and gets a 401."
    }

    default {
      $template = Get-BrainConfigJson $Client
      if (-not $template) {
        Write-Error "Unknown client '$Client'. Known clients: ${installableIds(targets)}"
        return
      }
      $target = if ($ConfigPath) { $ConfigPath } else { Get-BrainConfigPath $Client }
      if (-not $target) {
        Write-Host "==> No default config path for '-Client $Client'."
        Write-Host "    Re-run with -ConfigPath <file>, or paste:"
        Write-Host ""
        Write-Host ($template.Replace('__BRAIN_TOKEN__', $Token))
        Write-Host ""
      } else {
        Write-Host "==> Target: $target"
        if (-not (Merge-BrainMcpConfig -Target $target -Template $template -Token $Token)) { return }
      }
    }
  }

  # ── Smoke-test: prove the bearer actually reaches a tool ───────────────
  # Writing a config file (or a vendor CLI exiting 0) proves nothing about
  # whether this token can call anything through this network.
  Write-Host "==> Smoke-testing the MCP round-trip…"
  $headers = @{
    'Authorization' = "Bearer $Token"
    'Accept'        = 'application/json, text/event-stream'
  }
  $initBody = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"brain-installer","version":"3"}}}'
  try {
    $resp = Invoke-WebRequest -Uri $McpUrl -Method Post -Headers $headers \`
              -ContentType 'application/json' -Body $initBody -UseBasicParsing -TimeoutSec 15
  } catch {
    Write-Error "MCP initialize failed: $($_.Exception.Message)\`n  URL: $McpUrl\`n  A 401 means the token was rejected — mint a fresh one at ${opts.webUrl}/settings/tokens.\`n  NOTE: the client config above was still written."
    return
  }
  $sid = $resp.Headers['Mcp-Session-Id']
  if ($sid -is [array]) { $sid = $sid[0] }
  if (-not $sid) {
    Write-Error "MCP did not issue Mcp-Session-Id — transport may be misconfigured."
    return
  }
  $callHeaders = $headers.Clone()
  $callHeaders['Mcp-Session-Id'] = $sid
  $callBody = '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"brain_get_user_style","arguments":{}}}'
  try {
    $callResp = Invoke-WebRequest -Uri $McpUrl -Method Post -Headers $callHeaders \`
                  -ContentType 'application/json' -Body $callBody -UseBasicParsing -TimeoutSec 15
  } catch {
    Write-Error "brain_get_user_style failed: $($_.Exception.Message)"
    return
  }
  if ($callResp.Content -notmatch '"result"') {
    Write-Error "brain_get_user_style returned no result:\`n$($callResp.Content)"
    return
  }
  Write-Host "    round-trip OK (session $sid)"

  # ── Install ping (best-effort) ─────────────────────────────────────────
  $clientType = Get-BrainSessionType $Client
  $startBody = '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"brain_start_session","arguments":{"clientType":"' + $clientType + '","prompt":"brain installer ping v3 (' + $Client + ')"}}}'
  try {
    Invoke-WebRequest -Uri $McpUrl -Method Post -Headers $callHeaders \`
      -ContentType 'application/json' -Body $startBody -UseBasicParsing -TimeoutSec 15 | Out-Null
  } catch { }

  Write-Host ""
  Write-Host "✓ Brain installed and verified for '$Client'." -ForegroundColor Green
  Write-Host "  Restart your client — every one of them reads MCP config only at startup."
  Write-Host "  See what it learns at ${opts.webUrl}/#skills"
}

# Auto-run if a $BrainToken global is set (for one-liner curl|iex flows).
if ($BrainToken) {
  if ($BrainClient) { Install-Brain -Token $BrainToken -Client $BrainClient }
  else { Install-Brain -Token $BrainToken }
}
`;
}
