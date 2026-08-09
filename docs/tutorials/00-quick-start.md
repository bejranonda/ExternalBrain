# Quick start — from zero to a Brain that learns

**Time:** ~5 minutes. **You need:** a Brain URL (e.g. `https://brain.autobahn.bot`) and an account or invite.

Three steps. Mint a token, run one command, then talk to it normally.

> Also available in [ไทย](./00-quick-start.th.md) and [Deutsch](./00-quick-start.de.md) — both AI-translated and awaiting a native review.

---

## Shortcut — have a voucher code? Skip to `/start`

Open `https://<your-brain>/start`, paste your code, and copy the prompt it
gives you into Claude Code, Cursor, or any AI tool that can fetch a URL. Your
agent creates the account, mints a token, and runs the install command —
**then restart your AI tool**, since MCP config is only read at startup.

That token is scoped down (14 days, no Oracle) because it travelled through a
chat window. Mint a full one later at **Settings → Tokens**.

No voucher, or `agentic_onboarding_disabled`? Continue with Step 1 below.

---

## Step 1 — Mint a token

1. Sign in and go to **Settings → Tokens** (`/settings/tokens`).
2. **Create token** → name it after the *machine*, not yourself: `laptop`, `work-desktop`, `ci-runner`. You revoke per machine, so per-machine names are what make revocation useful later.
3. Copy the `bp_…` value.

> **It is shown once.** The database stores only its SHA-256 hash — there is no "reveal" button, and support cannot recover it. Lost it? Mint a new one and revoke the old.

The mint screen then shows a per-client install command with your token already in it. That command is Step 2 — you can copy it and skip ahead.

---

## Step 2 — Connect your AI tool

One command, whichever tool you use. `--client` defaults to `claude-code`.

```bash
# macOS / Linux / WSL / Git Bash
curl -fsSL https://<your-brain>/api/onboard.sh | bash -s 'bp_…' --client claude-code
```

```powershell
# Windows PowerShell 5.1+
iwr https://<your-brain>/api/onboard.ps1 -UseBasicParsing | iex
Install-Brain -Token 'bp_…' -Client claude-code
```

### Pick your `--client`

| Your tool | `--client` | Notes |
|---|---|---|
| Claude Code | `claude-code` | Also installs the Brain skill |
| Claude Desktop | `claude-desktop` | Needs Node; **fully quit** the app afterwards, not just close the window |
| Cursor | `cursor` | |
| Windsurf | `windsurf` | |
| Google Antigravity | `antigravity` | One config serves both the IDE and the CLI |
| VS Code + Copilot | `vscode` | Run it **from your repo root** — writes `./.vscode/mcp.json` |
| GitHub Copilot CLI | `copilot-cli` | |
| OpenAI Codex | `codex` | Also prints an `export BRAIN_TOKEN=…` line — **add it to your shell profile or Codex gets a 401** |
| Anything else | `generic` | Add `--config-path <file>` to write it for you |

JetBrains / Visual Studio / Eclipse / Xcode have no stable config path, so paste the JSON from the mint screen instead.

### What the command actually does

1. Writes the config — via your tool's own `mcp add` where one exists, otherwise by **merging** into its config file. Your other MCP servers are preserved and the file is backed up first.
2. **Proves it works** — a real MCP `initialize` + tool call through your network and auth. This is why it can say "installed" honestly: a config file being written proves nothing about whether the token can call anything.
3. Logs a first session so your dashboard isn't empty.

**Then restart your AI tool.** Every one of them reads MCP config only at startup — this is the single most common "it didn't work" cause.

Prefer to read before you pipe to a shell? Download it first:

```bash
curl -fsSL https://<your-brain>/api/onboard.sh -o /tmp/brain-install.sh
less /tmp/brain-install.sh
bash /tmp/brain-install.sh 'bp_…' --client cursor
```

---

## Step 3 — Talk to it

You never call tools by name. You speak normally; the skill tells your AI which tool to reach for.

| You say… | What happens |
|---|---|
| *(you start any real task)* | Session opens; past rules that match get injected |
| "remember this: we use pgvector, not Pinecone" | Saved as a rule; appears under **Skills** |
| "ask the oracle: how did we solve the migration ordering?" | Synthesised answer **with citations** |
| "find the rule about prisma migrations" | Top matches by meaning, instant, free |
| "what did I do last week on billing?" | Past sessions matching those words |
| **"that worked" / "we're done" / "ship it"** | **Closes the session — this is what makes it learn** |

### The one habit that matters

**Close your sessions.** Say *"that worked"* or *"we're done"* when you finish.

An unclosed session teaches the Brain nothing — the extraction pipeline only fires on close. This is the number one reason a Brain sits empty after a week of real use. Everything else is optional; this isn't.

### A session, start to finish

```
You:     I need to refactor the auth middleware to use the new credentials adapter.
Claude:  [opens a session, retrieves matching rules]
         Two of your rules apply here: sessions bind at start, and
         credential checks belong at the repository layer.

You:     no — we moved that check to the route handler last month.
Claude:  Noted, updating.

You:     that worked, we're done.
Claude:  [closes the session with what it learned]
         Saved: "credential checks live at the route handler, not the
         repository layer — moved 2026-07."
```

That correction is now permanent. Next month, on a different machine, it arrives before you have to remember it.

### Getting good answers

- **"find the rule about X"** — instant, free, no LLM call. Use it whenever you'd otherwise re-derive a past decision.
- **"ask the oracle: …"** — slower and billed, but synthesised with citations. Use it when you want reasoning, not a list.
- **Don't** ask the Oracle general programming questions. It's your project's memory, not the internet. "How does flexbox work" is a web search; "how did *we* decide to lay out the dashboard" is the Oracle.

---

## Check it worked

```bash
# Should list brain as connected
claude mcp list | grep brain
```

Then in your tool: *"ask the brain what it knows about this project"*. If it answers with anything at all, the loop is live.

Nothing happening?

| Symptom | Cause |
|---|---|
| Tool doesn't see the Brain | Didn't restart it after installing |
| 401 on every call | Token revoked, expired, or from a different Brain |
| Codex specifically 401s | `BRAIN_TOKEN` missing from your shell profile |
| Connected, but Skills stays empty | Sessions never closed — say *"we're done"* |
| Edited `~/.claude/mcp.json` by hand and nothing changed | Wrong file. Claude Code reads `~/.claude.json` |

Deeper help: [troubleshooting](./06-troubleshooting.md).

---

## Where next

| | |
|---|---|
| [01 — Getting started](./01-getting-started.md) | The same ground, slower, with diagrams |
| [02 — Asking the Oracle](./02-asking-the-oracle.md) | Question patterns that work |
| [03 — Teaching knowledge](./03-teaching-knowledge.md) | Writing rules that survive |
| [04 — Managing tokens](./04-managing-tokens.md) | Scope, rotation, revocation |
| [USING_BRAIN](../USING_BRAIN.md) | The full day-to-day reference |
| [CLIENTS](../CLIENTS.md) | Per-client config shapes and traps |
