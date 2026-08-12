# Quick start — Connect your AI tool to External Brain in 3 minutes

**Time:** ~3 minutes. **You need:** Your Brain URL (e.g. `https://brain.autobahn.bot`) and either a user account or a voucher code.

> Also available in [ไทย](./00-quick-start.th.md) and [Deutsch](./00-quick-start.de.md) — both AI-translated and awaiting native review.

---

> [!IMPORTANT]
> **CHOOSE ONE SETUP OPTION BELOW (Do NOT do both):**
> - **OPTION 1 (Recommended if you have a voucher code)** — Auto-setup via AI chat in 1 min.
> - **OPTION 2 (Standard path if you have a Brain account)** — Setup via Web UI in 2 min.

---

## OPTION 1 — Auto-setup with a voucher code (1 minute)

Use this if a teammate gave you a voucher code or invite link:

1. Open [`https://<your-brain>/start`](https://<your-brain>/start) in your browser and enter your voucher code.
2. Copy the generated prompt shown on screen and paste it into Claude Code, Cursor, or Windsurf. Your AI tool creates your account and configures the Brain connection automatically.
3. **Restart your AI tool** so it loads the new MCP configuration.

> **Token Scope Note:** Voucher tokens created via AI chat are valid for 14 days and restricted to basic retrieval for chat safety. Mint a permanent token anytime at **Settings → Tokens** ([`/settings/tokens`](/settings/tokens)). See [Tutorial 04](./04-managing-tokens.md) for details.

---

## OPTION 2 — Standard setup with a user account (3 steps)

### Step 1 — Mint your token & copy your command

1. Sign in to your Brain webapp → Go to **Settings → Tokens** ([`/settings/tokens`](/settings/tokens)).
2. Click **Create token** → Name it after your machine (`laptop`, `workstation`, `ci-runner`).
3. Click the **Copy Command** button on the success screen. *(This copies the exact, ready-to-run command containing your real token and host URL to your clipboard!).*

---

### Step 2 — Run installer & restart your AI tool

1. Open a terminal on your machine.
2. **Paste and run the EXACT command you copied from your webapp clipboard in Step 1.**

> [!WARNING]
> **Do NOT copy the example command below into your terminal.** The example below contains dummy placeholders (`https://<your-brain>` and `bp_...`). Always paste the real command you copied from your webapp screen in Step 1!

```bash
# EXAMPLE ONLY — Do NOT copy this block. Paste your copied command from Step 1!
curl -fsSL https://<your-brain>/api/onboard.sh | bash -s 'bp_…your_token…' --client claude-code
```

```powershell
# EXAMPLE ONLY (Windows PowerShell) — Paste your copied command from Step 1!
iwr https://<your-brain>/api/onboard.ps1 -UseBasicParsing | iex
Install-Brain -Token 'bp_…your_token…' -Client claude-code
```

3. **RESTART YOUR AI TOOL.** *(Mandatory: AI tools like Claude Code, Cursor, and Windsurf only scan for new MCP servers when they start up).*

> Want to inspect the installer script before running it? See [Tutorial 01 — Deep-Dive Setup](./01-getting-started.md).

---

### Step 3 — Try your first conversation (Real-life examples)

You talk to your AI tool in plain, natural language — no special commands required.

#### Real-life session transcript (How it looks in practice)

```text
You:     I need to refactor the auth middleware to use the credentials adapter.
Claude:  [opens session, retrieves matching rules]
         Two of your rules apply here: session tokens bind at start, and
         credential checks belong at the repository layer.

You:     no — we moved that check to the route handler last month.
Claude:  Noted, updating code to use the route handler.

You:     that worked, we're done.
Claude:  [closes session & extracts new rules]
         Saved rule: "Credential checks live at the route handler, not the repository layer."
```

#### Quick reference phrases

| What to say | What happens in real life | Why it matters |
|---|---|---|
| *"ask the brain what it knows about this project"* | Confirms connection and lists project rules | Proves your AI agent can talk to the Brain |
| *"remember this: we use pgvector, not Pinecone"* | Saves a permanent rule under **Skills** | Stops your AI tool from making the same mistake again |
| *"no — we moved that check to the route handler last month"* | Mid-session correction | Teaches the Brain to unlearn outdated advice |
| *"we decided to use Redis for sessions, not Postgres"* | Saved as a project **Decision** | Shared project memory; exempt from fading |
| *"ask the oracle: how did we solve the migration ordering?"* | Synthesises answer with source citations `[^K1]`, `[^S2]` | Answers questions using your own project history |
| *"that worked"* / *"we're done"* / *"ship it"* | **Closes the session & extracts new skills** | **Crucial habit:** Unclosed sessions teach nothing! Closing is what makes the Brain learn. |

---

## Check it worked

```bash
# Verify Claude Code sees the brain server
claude mcp list | grep brain
```

In your tool: *"ask the brain what it knows about this project"*. If it answers with project rules (or states 0 rules exist yet), your Brain is live!

### Quick Troubleshooting

| Symptom | Cause | Solution |
|---|---|---|
| Tool doesn't see the Brain | Didn't restart after step 2 | Close and reopen terminal/editor |
| `401 Unauthorized` | Token revoked, expired, or pasted dummy command from tutorial | Mint a new token at [`/settings/tokens`](/settings/tokens) & paste from webapp |
| Connected, but Skills stays empty | Sessions never closed | Say *"we're done"* when your task finishes |
| Edited `~/.claude/mcp.json` by hand | Wrong file | Claude Code reads `~/.claude.json` |

Need deeper help? See [Tutorial 06 — Troubleshooting](./06-troubleshooting.md).

---

## Where next

| Guide | Description |
|---|---|
| [01 — Deep-dive setup](./01-getting-started.md) | Mechanics, under-the-hood installer & security audit |
| [02 — Asking the Oracle](./02-asking-the-oracle.md) | Question patterns that work |
| [03 — Teaching knowledge](./03-teaching-knowledge.md) | Writing rules that survive |
| [04 — Managing tokens](./04-managing-tokens.md) | Token scope, rotation, and revocation |
| [07 — Skill types, explained](./07-skill-types-explained.md) | Plain-language guide to Recipes, Rules of thumb, Anti-patterns, and Decisions |
| [USING_BRAIN](../USING_BRAIN.md) | Full day-to-day reference with transcript examples |
| [CLIENTS](../CLIENTS.md) | Per-client config shapes & traps |
