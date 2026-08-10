# Quick start — from zero to a Brain that learns

**Time:** ~5 minutes. **You need:** a Brain URL (e.g. `https://brain.autobahn.bot`) and an account or invite.

Three steps. Mint a token, run one command, then talk to it normally.

> Also available in [ไทย](./00-quick-start.th.md) and [Deutsch](./00-quick-start.de.md) — both AI-translated and awaiting a native review.

---

## Shortcut — have a voucher code? Skip to [`/start`](/start)

Open [`https://<your-brain>/start`](https://<your-brain>/start), paste your code, and copy the prompt it
gives you into Claude Code, Cursor, or any AI tool that can fetch a URL. Your
agent creates the account, mints a token, and runs the install command —
**then restart your AI tool**, since MCP config is only read at startup.

That token is scoped down (14 days, no Oracle) because it travelled through a
chat window. Mint a full one later at **Settings → Tokens**.

No voucher, or `agentic_onboarding_disabled`? Continue with Step 1 below.

---

## Step 1 — Mint a token

1. Sign in → **Settings → Tokens** ([`/settings/tokens`](/settings/tokens)).
2. **Create token** → name it after the *machine* (`laptop`, `ci-runner`).
3. Copy the `bp_…` value — shown once, and the next screen has your install command ready. Details (rotation, scope, revocation): [Tutorial 04](./04-managing-tokens.md).

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

**Then restart your AI tool.** Every one of them reads MCP config only at startup — this is the single most common "it didn't work" cause.

Want to know exactly what the script does, or read it before piping to a shell? [Tutorial 01](./01-getting-started.md) walks through it step by step.

---

## Step 3 — Talk to it

No tool names to memorize. You speak normally, in Claude Code, Cursor,
Windsurf, or anything MCP — the skill picks the right `brain_*` call.

**Prove the connection**
| Say… | What happens |
|---|---|
| "ask the brain what it knows about this project" | Free, instant — proves the link is live |

**Teach it something**
| Say… | What happens |
|---|---|
| "remember this: we use pgvector, not Pinecone" | Saved as a rule; appears under **Skills** |
| "no — we moved that check to the route handler last month" | Mid-session correction; teaches it to unlearn stale advice |
| "we decided to use Redis for sessions, not Postgres" | Recorded as a project decision (shared, doesn't decay) |

**Recall — instant, free, no LLM call**
| Say… | What happens |
|---|---|
| "find the rule about prisma migrations" | Top matches by meaning |
| "what did I do last week on billing?" | Past sessions matching those words |

**Ask the Oracle — slower, billed, reasoned answer with citations**
| Say… | What happens |
|---|---|
| "ask the oracle: how did we solve the migration ordering?" | Synthesised answer, cited to the sessions it came from |
| ✗ "ask the oracle: how does flexbox work" | Wrong use — it's your project's memory, not the internet |

**Close the loop — the one habit that matters**
| Say… | What happens |
|---|---|
| "that worked" / "we're done" / "ship it" | **Closes the session — this is what makes it learn.** Unclosed sessions teach nothing; this is the #1 reason a Brain sits empty after a week of real use |

More categories, and a full worked example: [Tutorial 01](./01-getting-started.md), [Tutorial 02 — Asking the Oracle](./02-asking-the-oracle.md), [Tutorial 03 — Teaching the Brain](./03-teaching-knowledge.md).

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
| [01 — Getting started](./01-getting-started.md) | The same ground, slower, with the reasoning spelled out |
| [02 — Asking the Oracle](./02-asking-the-oracle.md) | Question patterns that work |
| [03 — Teaching knowledge](./03-teaching-knowledge.md) | Writing rules that survive |
| [04 — Managing tokens](./04-managing-tokens.md) | Scope, rotation, revocation |
| [USING_BRAIN](../USING_BRAIN.md) | The full day-to-day reference |
| [CLIENTS](../CLIENTS.md) | Per-client config shapes and traps |
