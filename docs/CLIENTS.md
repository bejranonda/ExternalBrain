# Wiring an MCP client to your Brain

> **For new tokens:** the `/settings/tokens` mint screen now generates per-client install snippets automatically — pick your client and OS, copy the command, done. The snippets in this doc are the manual-paste fallback and the canonical reference for snippet shapes; you should not need them unless the wizard is unavailable or you prefer to audit the raw config.

Brain exposes **9 MCP tools + 4 resources** over Streamable HTTP. To connect, you need:

1. A **bearer token** minted at `https://<your-brain>/settings/tokens`.
2. Claude Code (or another MCP client) configured to use it.
3. *(Recommended)* The Brain **skill**, which teaches your client *when and how* to use the tools — not just that they exist.

This page covers all three on **macOS, Linux, Windows native (PowerShell), and WSL/Git Bash**.

---

## TL;DR — one-line install (recommended)

After you mint a token at `/settings/tokens`, the webapp shows a copy-paste command pre-filled with your bearer. The plain-text equivalents are below; substitute `<your-brain>` (e.g. `brain.example.com`) and your minted `bp_…` token.

### macOS / Linux / WSL / Git Bash

```bash
curl -fsSL https://<your-brain>/api/onboard.sh | bash -s 'bp_…'
```

### Windows (PowerShell 5.1+ or 7+)

```powershell
iwr https://<your-brain>/api/onboard.ps1 -UseBasicParsing | iex
Install-Brain -Token 'bp_…'
```

The installer:

1. Calls `claude mcp add brain --scope user --transport http <mcp-url> --header "Authorization: Bearer <token>"` — this writes to **`~/.claude.json`** (the canonical Claude Code config), NOT `~/.claude/mcp.json` (a common trap path; Claude Code does not read it).
2. Downloads the Brain SKILL.md to `~/.claude/skills/brain/SKILL.md` (POSIX) or `%USERPROFILE%\.claude\skills\brain\SKILL.md` (Windows).
3. Verifies via `claude mcp list | grep brain` and reports.

After install, **restart Claude Code** so it picks up the new MCP entry and the skill.

> **If you are re-pointing an existing `brain` entry at a different Brain, the
> restart is not cosmetic — it is the whole operation.** Claude Code binds its
> MCP config **at session start**. A running session keeps talking to whichever
> Brain it connected to originally, so re-running the installer mid-session
> repoints the *file* while every subsequent `brain_teach_knowledge` still
> writes to the **old** instance. Nothing errors; the tool calls succeed and
> return real IDs. See [`KNOWN_ISSUES §0t`](./KNOWN_ISSUES.md).
>
> After any repoint, confirm which Brain you actually reached before trusting a
> write:
>
> ```bash
> # POSIX
> python3 -c "import json;print(json.load(open('$HOME/.claude.json'))['mcpServers']['brain']['url'])"
> ```
>
> ```powershell
> # Windows PowerShell
> (Get-Content "$env:USERPROFILE\.claude.json" | ConvertFrom-Json).mcpServers.brain.url
> ```
>
> Then check that a taught id really landed in the Brain you meant:
> `select id from "Knowledge" where id = '<id returned by the teach call>';`
> Zero rows means the id is absent *there* — it may have gone to another
> instance, or the write may have failed; the resolved URL above distinguishes
> the two.

### Audit-first variant (security-aware operators)

Don't pipe untrusted scripts to `bash` / `iex`. Same effect, with inspection:

```bash
# POSIX
curl -fsSL https://<your-brain>/api/onboard.sh -o /tmp/brain-install.sh
less /tmp/brain-install.sh
bash /tmp/brain-install.sh 'bp_…'
```

```powershell
# PowerShell
iwr https://<your-brain>/api/onboard.ps1 -OutFile $env:TEMP\brain-install.ps1
notepad $env:TEMP\brain-install.ps1
. $env:TEMP\brain-install.ps1 ; Install-Brain -Token 'bp_…'
```

---

## Manual: step by step (every OS)

### 1. Mint a token

`https://<your-brain>/settings/tokens` → **Create token**. Copy the `bp_…` value once — the webapp stores only its SHA-256 hash and cannot show it again.

### 2. Register the MCP server with Claude Code

Same command on every OS — **always use the `claude mcp add` CLI**, never edit `mcp.json` files by hand:

```bash
claude mcp add brain \
  --scope user \
  --transport http \
  https://<your-brain>/mcp \
  --header "Authorization: Bearer bp_…"
```

| Scope | When to use |
|---|---|
| `user` | One Brain across every project on this machine. Default and recommended. |
| `project` | Only this repo. Writes `<repo>/.claude.json` and commits-able if the team shares a Brain. |
| `local` | Just for this Claude Code session, not persisted. Useful for ad-hoc testing. |

Verify:

```bash
claude mcp list | grep brain
# brain: https://<your-brain>/mcp (HTTP) - ✓ Connected
```

### 3. Install the skill

The skill is what makes Brain *idiomatic* — without it, Claude treats the 9 tools as an undifferentiated registry and discovers usage patterns by trial. Drop it once per machine:

#### macOS / Linux / WSL / Git Bash

```bash
mkdir -p ~/.claude/skills/brain
curl -fsSL https://<your-brain>/api/skills/brain -o ~/.claude/skills/brain/SKILL.md
```

#### Windows (PowerShell)

```powershell
$dir = "$env:USERPROFILE\.claude\skills\brain"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest "https://<your-brain>/api/skills/brain" `
  -OutFile "$dir\SKILL.md" -UseBasicParsing
```

#### Project-scoped (commit alongside your repo)

If your team shares a Brain instance, commit the skill so every clone of the repo gets it:

```
<repo>/.claude/skills/brain/SKILL.md
```

A teammate cloning the repo gets the skill automatically — no install step. Commit `.claude/skills/brain/` but **never commit `~/.claude.json`** (it contains your personal token). Add it to `.gitignore` if you've checked the wrong file in.

### 4. Restart Claude Code

Skills are loaded at session start. Claude Code in another terminal won't see the change until the next `claude` invocation.

---

## Other MCP clients

### Cursor

Cursor speaks native streamable-HTTP MCP — the `mcp-remote` shim this page
used to require is no longer needed. It keys the endpoint off a **flat `url`**:

```json
{
  "mcpServers": {
    "brain": {
      "url": "https://<your-brain>/mcp",
      "headers": { "Authorization": "Bearer bp_…" }
    }
  }
}
```

Cursor reads `~/.cursor/mcp.json` (user-scope) or `<repo>/.cursor/mcp.json` (project-scope).

### Windsurf

Native HTTP, but Windsurf is the one client that names the field **`serverUrl`**
instead of `url` — a `url` entry is silently ignored:

```json
{
  "mcpServers": {
    "brain": {
      "serverUrl": "https://<your-brain>/mcp",
      "headers": { "Authorization": "Bearer bp_…" }
    }
  }
}
```

Config at `~/.codeium/windsurf/mcp_config.json`.

### Claude Desktop

Edit `claude_desktop_config.json`:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Claude Desktop validates **stdio servers only** — it is now the one client here
that still needs the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote)
bridge. Do **not** paste a `url`-shaped entry: Desktop ignores it and can drop
the whole `mcpServers` block on its next save, taking your other servers with it
([anthropics/claude-code#37286](https://github.com/anthropics/claude-code/issues/37286)).

```json
{
  "mcpServers": {
    "brain": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://<your-brain>/mcp",
        "--header", "Authorization:Bearer bp_…"
      ]
    }
  }
}
```

Requires Node (for `npx`). Then **restart Claude Desktop fully** (quit from menu bar / system tray, not just close the window).

### Generic MCP / custom agent

Streamable HTTP, JSON-RPC 2.0:

```bash
curl -X POST https://<your-brain>/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "Authorization: Bearer bp_…" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"0.1"}}}'
```

After `initialize` returns, persist the `Mcp-Session-Id` response header and send it on every subsequent request as a `Mcp-Session-Id:` request header.

### Google Antigravity

Antigravity speaks native streamable-HTTP MCP — no `mcp-remote` shim needed. The
catch: it keys remote servers off **`serverUrl`** (not `url`); a `url`-shaped
entry is silently ignored.

```json
{
  "mcpServers": {
    "brain": {
      "serverUrl": "https://<your-brain>/mcp",
      "headers": { "Authorization": "Bearer bp_…" }
    }
  }
}
```

Config at `~/.gemini/config/mcp_config.json` — shared by the Antigravity IDE and the Antigravity CLI since the 2026-05-19 merge (Windows:
`%USERPROFILE%\.gemini\antigravity\mcp_config.json`). Open it from
**Settings → Customizations → Open MCP Config**.

### GitHub Copilot (all surfaces)

Copilot has native HTTP MCP across its editors, CLI, and cloud agent — but the
config shape differs per surface. The wizard emits the right one for each.

| Surface | Config file | Top key | Bearer goes under |
|---|---|---|---|
| VS Code | `.vscode/mcp.json` (or user config) | `servers` | `headers` |
| JetBrains / Visual Studio / Eclipse / Xcode | `mcp.json` | `servers` | `requestInit.headers` |
| Copilot CLI | `~/.copilot/mcp-config.json` | `mcpServers` | `headers` |
| Coding agent (cloud) | repo **Settings → Copilot → Coding agent** | `mcpServers` | `COPILOT_MCP_*` secret |

**VS Code** (`.vscode/mcp.json`, or palette → "MCP: Open User Configuration"):

```json
{
  "servers": {
    "brain": {
      "type": "http",
      "url": "https://<your-brain>/mcp",
      "headers": { "Authorization": "Bearer bp_…" }
    }
  }
}
```

**JetBrains / Visual Studio / Eclipse / Xcode** — same `servers` wrapper, but the
header moves under `requestInit.headers`:

```json
{
  "servers": {
    "brain": {
      "url": "https://<your-brain>/mcp",
      "requestInit": { "headers": { "Authorization": "Bearer bp_…" } }
    }
  }
}
```

**Copilot CLI** (`~/.copilot/mcp-config.json`, or run `copilot` then `/mcp add`):

```json
{
  "mcpServers": {
    "brain": {
      "type": "http",
      "url": "https://<your-brain>/mcp",
      "headers": { "Authorization": "Bearer bp_…" }
    }
  }
}
```

**Coding agent (cloud).** Configured in the repository's **Settings → Copilot →
Coding agent → MCP configuration**, not a local file. Because it runs in GitHub's
cloud, it can only reach a Brain that is **internet-reachable** (a localhost or
private-network deploy won't work), and the token must be stored as a
`COPILOT_MCP_*` repository secret rather than pasted inline.

> **Static-bearer note.** Antigravity and Copilot have both shipped bugs where a
> `401` from an HTTP MCP server triggers an OAuth-discovery flow instead of
> sending the configured header (antigravity-cli #25, copilot-cli #3100). The
> Brain uses a static bearer and advertises no OAuth metadata, so a
> statically-configured `headers`/`requestInit.headers` entry is sent on every
> request — including `initialize` — which is the supported path. If a client is
> observed probing `/.well-known/oauth-*` instead, re-check that the header is
> present in the config above.

---

## Sanity-check from any shell

Confirm the deploy is alive (no token needed):

```bash
curl -s https://<your-brain>/mcp/health 2>/dev/null \
  || curl -s https://<your-brain>:3100/health  # dev profile, plain HTTP
```

Confirm your token works (single round-trip via `tools/list` requires session state — the easiest token validation is **inside Claude Code** after install, not in a single curl):

```bash
# This will return 200 with serverInfo even unauthenticated (spec-permitted),
# so it confirms reachability but NOT token validity.
curl -X POST https://<your-brain>/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"sanity","version":"0.1"}}}'

# Real validation: install via the recipe above, then run:
claude mcp list | grep brain   # → "✓ Connected" if token is good
```

---

## Common traps (from real onboarding incidents)

| Symptom | Trap | Fix |
|---|---|---|
| Edited `~/.claude/mcp.json` (or `%USERPROFILE%\.claude\mcp.json`); nothing happens | **Wrong path.** Claude Code reads `~/.claude.json` (no subdir). The `mcp.json` filename inside `.claude/` is ignored. | Use `claude mcp add`, not manual edits. Verify with `claude mcp list`. |
| `https://...:3100/mcp` → SSL error | Port 3100 on most deploys is plain HTTP, not TLS. | Use the standard-port HTTPS URL (`https://<host>/mcp`) if Caddy/nginx fronts it; otherwise use `http://<host>:3100/mcp`. |
| `claude mcp add` returns "command not found" | Claude Code is not installed (or its binary isn't on PATH). | Install Claude Code first: <https://docs.claude.com/en/docs/claude-code> |
| 401 even with a fresh token | Bearer typo — `Authorization: bearer` (lowercase b) or `Authorization: Token` instead of `Authorization: Bearer` | Use `claude mcp add ... --header "Authorization: Bearer bp_…"` exactly. |
| Tools appear but every call returns 401 | Token was revoked between mint and use, OR rotated and the grace period expired. | Mint a new token; re-run the install. |
| Session works in one terminal but not another | Claude Code wrote to project scope (`<repo>/.claude.json`), and the second terminal is in a different repo. | Re-add with `--scope user` for cross-project availability. |
| Skill appears but Claude doesn't use it | Claude Code hasn't restarted since the skill was dropped. | Restart Claude Code. |
| Token works but `brain_*` tools missing from palette | Claude Code restarted, but didn't reload MCP registry. | Try `/mcp` inside Claude Code, or restart again. |
| Taught knowledge "succeeds" but never appears in the webapp | You re-ran the installer against a different Brain **without restarting**, so writes went to the previously-connected instance. Tool calls return real IDs, so nothing looks wrong. | Restart Claude Code, verify the URL in `~/.claude.json`, then re-teach. Confirm the returned id exists: `select id from "Knowledge" where id='…'`. |
| `brain_get_user_style` suddenly returns zero reflexes | Usually not a fault: you are now talking to a **different Brain**, or this token's user genuinely owns no knowledge yet (a fresh instance, or knowledge owned by other users/demo personas). | Check the URL and the token's user before treating it as a regression. An empty result is a signal about *which* instance you reached, not proof of breakage. |

---

## Token rotation

Brain supports **24-hour grace-period rotation**: when you click "Rotate" in `/settings/tokens`, the old token keeps working for 24 h while you push the new value to clients. After 24 h the old token is auto-revoked.

Recommended workflow:

1. Click **Rotate** in the webapp. The new bearer is shown once.
2. Run the install one-liner again (with the new token) on every machine that needs it. Each machine's Claude Code config picks up the new value.
3. Verify with `claude mcp list` on each machine before the 24-h window ends.

If you miss the window, no harm done — just mint a fresh token and re-run the installer.

---

## Per-machine, not per-user

We strongly recommend **one token per machine**, not one shared across laptops + desktop + CI runner:

- A leaked token can be revoked without disrupting your other machines.
- Audit logs (`MCPToken.lastUsedAt` + nginx access log) tell you which machine made which call.
- If a machine is decommissioned, just revoke its token; no other workflow changes.

Each user's `/settings/tokens` page lists every token they've minted with name + last-used timestamp + status (active / rotated / revoked). Name them clearly: `Personal MacBook`, `Office Linux`, `CI runner`, etc.

---

## Provider key scoping (Gemini + DashScope + Z.ai)

The External Brain uses two independent provider paths:

- **Chat models** (Oracle, KEA) route through the Anthropic SDK, pointed at any Anthropic-compatible gateway via `ANTHROPIC_BASE_URL`. Uses `ANTHROPIC_API_KEY`.
- **Embeddings** route through the OpenAI SDK, pointed at any OpenAI-compatible gateway via `EMBEDDING_BASE_URL`. Key resolution chain: `EMBEDDING_API_KEY → GOOGLE_GEMINI_API_KEY → OPENAI_API_KEY → ANTHROPIC_API_KEY`.

Three tested combinations live in `deploy/DEPLOY.md` §"Provider ecology cheat-sheets". Current recommendation for a free-tier demo: Gemini (embeddings) + Z.ai GLM (chat).

**Three gotchas:**

1. **Z.ai has no embedding endpoint.** `paas/v4` and `anthropic` subdomains serve chat completions only.
2. **DashScope issues multiple token kinds.** A Claude-Code-integration token (`coding-intl.dashscope.aliyuncs.com`) is chat-only and 401s against `/embeddings`. For embeddings you need a general-purpose `sk-…` key from the 百炼 Model Studio console.
3. **Gemini honors `dimensions`** — `gemini-embedding-001` defaults to 3072 dim but accepts the `dimensions: 1536` request param. If you swap to a provider that ignores it, retrieval breaks silently at pgvector insert.

See `deploy/DEPLOY.md` §7 for the full cheat-sheets and troubleshooting table.

---

## Security notes

- Tokens are stored as **SHA-256 hashes** server-side. We never see the raw token after create.
- HTTP transport is stateless on the wire: each request carries its own Bearer. Revocation is immediate (the `MCPToken.revokedAt` check happens on every call).
- Per-IP rate limits (configured at the reverse proxy) apply to every MCP endpoint.
- **Do not expose the MCP HTTP port directly to the public internet** without TLS in front. Use Caddy / nginx + Let's Encrypt, or Cloudflare Tunnel. Token model assumes transport is trusted; a sniffer on the wire can replay a captured Bearer.
- The skill itself is non-secret — it's a documentation file. The MCP token in your Claude Code config is the only secret on your machine; protect it like any other credential.
