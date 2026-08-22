import { CLIENTS, clientById } from "@brain/core/install-snippets";
import type { TargetOS } from "@brain/core/install-snippets";

/**
 * Skill template served to MCP clients.
 *
 * The Brain SKILL.md tells Claude Code (and other skill-aware MCP clients)
 * when, why, and how to use Brain — turning a raw tool registry into an
 * idiomatic capability. The MCP server still defines what each tool does;
 * this file defines when to reach for it.
 *
 * The template uses `{{MCP_URL}}` and `{{WEB_URL}}` placeholders that the
 * `/api/skills/brain` route substitutes per request, so the same skill
 * works against dev (`brain-dev.example.com`) and prod
 * (`brain.example.com`) without manual editing.
 *
 * Keep this file in sync with `docs/MCP_TOOLS.md` — the tool list there is
 * the source of truth for what's wired in `apps/mcp-server/src/tools/`.
 */
export const BRAIN_SKILL_TEMPLATE = `---
name: brain
description: Use when you need persistent project memory, semantic search over prior decisions, or to ask the project Oracle about cross-session context. Trigger phrases — "brain", "what did we decide", "find similar", "remember this", "ask the oracle", "search sessions", "user style", "user reflexes". Brain is your project's long-term memory layer; the in-conversation context is short-term.
---

# Brain — your project's persistent memory

External Brain is a memory layer that survives across Claude Code sessions, projects, and machines. It runs MCP-over-HTTP at \`{{MCP_URL}}\` and exposes 9 tools + 4 resources. This skill is the *usage guide*; the MCP server is the registry of what each tool does. Read this before reaching for any \`mcp__brain__*\` tool.

## When to use Brain

| Trigger | Tool to call |
|---|---|
| User starts a non-trivial coding task | \`brain_start_session\` (ONCE, save the \`sessionId\`) |
| About to generate code or a plan | \`brain_retrieve_knowledge\` BEFORE generating, inject \`bundle.injection\` |
| User says "remember this" / "save this" | \`brain_teach_knowledge\` |
| User asks "how did I solve X?" / "what did we decide about Y?" | \`brain_ask_oracle\` (slow, billed; try \`session_search\` or \`retrieve_knowledge\` first) |
| User asks "what did I do last week?" / "find that conversation" | \`brain_session_search\` |
| Scaffolding new files, writing in user's voice | \`brain_get_user_style\` |
| User asks for a complete recipe / how-to | \`brain_retrieve_knowledge\` first — the Brain's recipes live there. \`brain_find_skill\` reads a separate store of whole markdown bundles that is usually empty and mostly platform-internal, so an empty result from it does NOT mean the Brain knows nothing |
| During a session, every user accept/reject/edit | \`brain_log_event\` (per event) |
| User accepted/rejected the final output | \`brain_report_session_outcome\` (ONCE at end, with \`success\` flag) |

## When NOT to use Brain

- For ephemeral context inside the current turn — Claude Code's own conversation memory is faster and free.
- For raw filesystem reads — use \`Read\`.
- For one-shot factual lookups about the wider world — use \`WebSearch\` / \`WebFetch\`.
- When the user wants speed and the question doesn't need cross-session context — \`brain_ask_oracle\` is 5-30s and billed per call. Prefer \`brain_retrieve_knowledge\` (sub-100 ms, free) first.

## Idiomatic flows

### Answering a project question
1. Try \`brain_retrieve_knowledge\` with semantic terms.
2. If \`bundle.items\` is empty, try \`brain_session_search\` filtered by recent timestamps.
3. Still nothing? Confirm with the user before \`brain_ask_oracle\` — it's billed.

### Persisting a decision
1. Call \`brain_retrieve_knowledge\` first to check for near-duplicates (Brain stores by content hash; rewriting near-duplicates wastes tokens).
2. If no duplicate, call \`brain_teach_knowledge\` with a clear title + the *rationale* (not just the conclusion). Future Oracle calls quote rationale; without it the answer is shallow.

### Generating code in the user's style
1. Call \`brain_get_user_style\` — returns \`peerCard\` (hard overrides) and \`reflexes\` (preferences).
2. Apply \`peerCard\` strictly (e.g. "always typed Python", "no \`var\` in JS").
3. Apply \`reflexes\` softly — they're inferred, not declared. If reflexes contradict the user's literal request, the request wins.

### Closing a session
1. \`brain_report_session_outcome\` MUST be called when the user accepts or rejects the final output — it triggers KEA (knowledge extraction) which is how Brain learns. Skipping it is the single biggest reason a Brain feels "stagnant".

## Anti-patterns

- ❌ Don't paginate \`brain_session_search\` past page 2 — it's chronological FTS, not semantic. After 2 pages, switch to \`brain_retrieve_knowledge\`.
- ❌ Don't pass raw user messages to \`brain_teach_knowledge\` — distill them. The store is keyed by content hash, so a verbose original creates a different entry from the same fact distilled.
- ❌ Don't omit \`sessionId\` from \`brain_log_event\` / \`brain_report_session_outcome\` — events without a session are dropped.
- ❌ Don't rotate the bearer mid-task. Rotated tokens have a 24h grace; your current session keeps working until the grace expires. Mint and switch at task boundaries instead.

## Authentication errors

If a tool returns \`401\`:

1. The token was revoked, expired, or the grace period ended.
2. Visit \`{{WEB_URL}}/settings/tokens\`, mint a new one.
3. Run the install command shown after mint (re-runs \`claude mcp add\` with the new bearer).
4. Restart Claude Code so it reconnects.

DO NOT manually edit any \`<home>/.claude/mcp.json\` file (POSIX) or \`%USERPROFILE%\\.claude\\mcp.json\` (Windows) — Claude Code does NOT read that path; it reads \`<home>/.claude.json\` (or \`%USERPROFILE%\\.claude.json\`). Use \`claude mcp list\` to verify what Claude Code actually sees, regardless of OS.

## Tool reference (compact)

| Tool | Purpose | Cost | Latency |
|---|---|---|---|
| \`brain_start_session\` | Open a session, get \`sessionId\` | free | <50 ms |
| \`brain_retrieve_knowledge\` | Semantic search + injection bundle | free | <100 ms |
| \`brain_teach_knowledge\` | Persist a fact | free | <50 ms |
| \`brain_get_user_style\` | Get peerCard + reflexes | free | <50 ms |
| \`brain_log_event\` | Append a session event | free | <50 ms |
| \`brain_session_search\` | Postgres FTS over session text | free | <200 ms |
| \`brain_find_skill\` | Top-N Skill BUNDLES (a different store from the Skills tab; usually empty) | free | <200 ms |
| \`brain_ask_oracle\` | Cross-session reasoning | $0.01-$0.10 | 5-30 s |
| \`brain_report_session_outcome\` | Close session, trigger learning | free | <100 ms |

Resources (read-only, for hydration):

- \`brain://user/style-profile\` — quick JSON of reflexes + peer card.
- \`brain://user/active-skills\` — skills currently in knowledge / wisdom stage.
- \`brain://user/recent-sessions\` — last 10 sessions.
- \`brain://user/peer-card\` — hard-override facts.

## What the user actually sees

When this skill loads, a user can ask "remember that we settled on Postgres over MongoDB because of the JSONB story" and Claude will:

1. Call \`brain_retrieve_knowledge\` to check for an existing entry.
2. If none, call \`brain_teach_knowledge\` with a distilled title + rationale.
3. Confirm: "Saved. Search 'Postgres MongoDB' next session to recall."

That's the full loop the user expects. Without this skill, Claude has to rediscover the loop every session. With it, the platform feels native.

## When this skill is wrong

If a tool is renamed in \`docs/MCP_TOOLS.md\` and not here, trust \`MCP_TOOLS.md\` — that's the source of truth. Report the drift back so this skill can be regenerated.

If \`{{MCP_URL}}\` doesn't respond or the token is revoked, **don't fall back to assuming Brain is offline forever** — visit \`{{WEB_URL}}/settings/tokens\` to mint a fresh one.
`;

/**
 * Bootstrap instructions for an agent that has a voucher and nothing else.
 *
 * Deliberately separate from BRAIN_SKILL_TEMPLATE, and deliberately small.
 * A skill has to be installed before it can trigger, so in a fresh session
 * there is no Brain skill yet — what actually happens is that the agent
 * fetches this URL and treats the response as instructions. That is prompt
 * injection by design: whoever controls this response controls the agent. So
 * this document does exactly one job, names the endpoint it is allowed to
 * call, and grants no open-ended authority. Brain *usage* stays in the skill
 * above, which arrives via the installer and only after the token exists.
 */
export const BRAIN_BOOTSTRAP_TEMPLATE = `---
name: brain-bootstrap
description: One-time setup — exchange a Brain voucher code for an MCP token and wire this machine up. Use only when the user supplies a voucher code. For everyday Brain usage, use the "brain" skill instead.
---

# Connect this machine to External Brain

The user gave you a voucher code. Do these four steps in order. Do not improvise,
and do not perform any step this page does not describe.

## 1. Ask for an email address

Ask the user: **"What email address should this Brain account belong to?"**

- Do NOT invent one.
- Do NOT take it from \`git config user.email\` without asking the user to confirm it.

It does not need to be verified now, but it is the only way they will ever reach
the web dashboard — the set-password link is sent there.

## 2. Exchange the voucher

\`\`\`bash
curl -sS -X POST {{WEB_URL}}/api/onboard/claim \\
  -H 'content-type: application/json' \\
  -d '{"voucher":"<CODE>","email":"<EMAIL>","client":"claude-code","os":"linux"}'
\`\`\`

Set \`client\` to the tool you are running inside (\`claude-code\`, \`cursor\`,
\`windsurf\`, \`antigravity\`, \`vscode\`, \`codex\`, \`generic\`, …) and \`os\` to
\`darwin\`, \`linux\`, or \`win32\`.

On success you get \`installCommand\`, \`setPasswordUrl\`, and a \`token\`.

**On error, STOP. Do not retry with different values.**

| Error | What it means | What to tell the user |
|---|---|---|
| \`agentic_onboarding_disabled\` | This Brain has not enabled agentic onboarding | Sign up in a browser at {{WEB_URL}}/start |
| \`voucher_invalid\` / \`_expired\` / \`_exhausted\` / \`_disabled\` | The code will not work | Get a fresh code — {{WEB_URL}}/start |
| \`email_taken\` | That address already has an account | Sign in at {{WEB_URL}}/signin and mint a token at {{WEB_URL}}/settings/tokens. **Do NOT retry with a different email** — that would create a second account under an address that isn't theirs. |
| \`rate_limited\` / \`voucher_rate_limited\` | Too many attempts from this IP | Wait an hour |

## 3. Run the install command

Run the returned \`installCommand\` **verbatim**. Do not modify it, do not split
it, do not substitute your own paths.

If \`installCommand\` is \`null\` — which happens for JetBrains IDEs and for the
raw-REST option, neither of which has a one-line installer — apply the
\`manualSetup\` lines from the same response instead, and tell the user which
file or settings screen they belong in.

Never hand-edit \`~/.claude.json\`, \`~/.claude/mcp.json\`, or any client config
file yourself — the installer owns those, and the second of those paths is not
read by any client.

## 4. STOP. Do not call any brain_* tool in this session.

Your MCP configuration was bound when this conversation started. It did not
change when the installer wrote the config file. If you try a \`brain_*\` tool
now it will either fail or — worse, and this has really happened — silently
write to a different Brain while reporting success.

Tell the user exactly this, in this order, before you tell them to
restart — restarting ends this conversation, so anything said after "restart
now" is something they will never read:

1. Set a password now, before restarting: the \`setPasswordUrl\` from step 2.
   This is the only way they will ever reach the dashboard at {{WEB_URL}} —
   it does not depend on the MCP connection, so it works even before restart.
2. After restarting, verify it connected: ask *"ask the brain what it knows
   about this project"* — any answer at all (including "no matches") means
   the connection is live. This works regardless of which client you're in,
   unlike a CLI command that only exists for some of them. If you're
   specifically in Claude Code, \`claude mcp list\` also works.
3. **Restart your AI tool now.** Setup is not finished until you do. Say
   this last, after they have the link and the verification step in hand.

## Notes worth passing on

- The token expires in 14 days and cannot call the Oracle. That is intentional
  for a bootstrap token, not a fault. Once they have set a password they can
  mint a full one at {{WEB_URL}}/settings/tokens.
- The token appears in your transcript because it is inside the install
  command. Treat it as a secret: never commit it, never write it into a repo
  file.
`;

/**
 * Bootstrap instructions for an agent whose user already has a Brain
 * account and a minted token (from /settings/tokens) — no voucher, no
 * claim step. Deliberately a sibling of BRAIN_BOOTSTRAP_TEMPLATE rather
 * than a branch inside it: the voucher template's whole shape exists to
 * bound what a pre-auth, unauthenticated fetch is allowed to do (exchange
 * exactly one code for exactly one token). This one starts from a token
 * the user already typed into their own prompt, so there is no exchange
 * step to bound — collapsing the two into one conditional template would
 * make the security-relevant "stop, don't improvise" framing harder to
 * audit, not easier.
 */
export const BRAIN_BOOTSTRAP_TOKEN_TEMPLATE = `---
name: brain-bootstrap-token
description: One-time setup — wire this machine up to External Brain using a token the user already minted at /settings/tokens. Use only when the user supplies a raw Brain token directly (not a voucher code). For everyday Brain usage once connected, use the "brain" skill instead.
---

# Connect this machine to External Brain (existing token)

The user gave you a Brain token directly — they already have an account.
Do these steps in order. Do not improvise, and do not perform any step this
page does not describe.

## 1. Identify which AI tool you're running inside

You already know this — you're running inside it right now. Pick your
\`--client\` id from exactly this list:

{{CLIENT_IDS}}

If none of them is the tool you are in, use \`generic\` rather than inventing
an id. If you are in a JetBrains IDE or a tool with no MCP support at all,
STOP — there is no one-line installer for those. Tell the user to open
{{WEB_URL}}/settings/tokens and use the manual "Run it myself" steps there
instead.

## 2. Run the installer

Replace \`<TOKEN>\` with the token the user gave you, and \`claude-code\` with
your client id from step 1. Run it **verbatim** otherwise — do not modify the
URL, do not split it, do not substitute your own paths.

On macOS or Linux:

\`\`\`bash
{{INSTALL_POSIX}}
\`\`\`

On Windows (PowerShell):

\`\`\`powershell
{{INSTALL_WINDOWS}}
\`\`\`

This is the same installer every other Brain surface uses: it wires up the
MCP server, installs the Brain skill, and smoke-tests the round-trip. A
hand-written \`mcp add\` command does none of the last two — don't substitute
one.

Never hand-edit \`~/.claude.json\`, \`~/.claude/mcp.json\`, or any other client
config file yourself — the installer owns those, and the second of those
paths is not read by any client.

## 3. STOP. Do not call any brain_* tool in this session.

Your MCP configuration was bound when this conversation started; it does not
change retroactively. Tell the user, in this order, before telling them to
restart:

1. **Restart your AI tool now.** Setup is not finished until you do.
2. After restarting, verify it connected: ask *"ask the brain what it knows
   about this project"* — any answer at all (including "no matches") means
   the connection is live. In Claude Code specifically, \`claude mcp list\`
   also works.

## Notes worth passing on

- This token was already minted with real scope (not a 14-day bootstrap
  token) — no follow-up mint is needed.
- The token appears in your transcript because it's inside the install
  command. Treat it as a secret: never commit it, never write it into a repo
  file.
`;

/**
 * Render the skill with concrete URLs substituted.
 */
export function renderBrainSkill(opts: { mcpUrl: string; webUrl: string }): string {
  return BRAIN_SKILL_TEMPLATE.replaceAll("{{MCP_URL}}", opts.mcpUrl).replaceAll(
    "{{WEB_URL}}",
    opts.webUrl,
  );
}

/** Render the bootstrap instructions with concrete URLs substituted. */
export function renderBrainBootstrap(opts: { mcpUrl: string; webUrl: string }): string {
  return BRAIN_BOOTSTRAP_TEMPLATE.replaceAll("{{MCP_URL}}", opts.mcpUrl).replaceAll(
    "{{WEB_URL}}",
    opts.webUrl,
  );
}

/**
 * Render the token-based bootstrap instructions.
 *
 * The install command is *derived* from `@brain/core/install-snippets`, never
 * written out here — that registry is the single source every other surface
 * (the wizard, /welcome, the claim response) already renders from, and the
 * whole point of `install-command-single-source.test.ts` is that no second
 * place is able to construct one. The token is the literal `<TOKEN>` because
 * this document is public and token-free; the real value arrives in the
 * user's pasted prompt and the agent substitutes it.
 */
export function renderBrainBootstrapForToken(opts: { mcpUrl: string; webUrl: string }): string {
  const claudeCode = clientById("claude-code")!;
  const render = (os: TargetOS): string => {
    const snippet = claudeCode.snippet("<TOKEN>", opts.mcpUrl, opts.webUrl, os);
    return (snippet.command?.lines ?? snippet.lines).join("\n");
  };

  // Only clients the installer can actually drive. A client without a
  // one-line install command (JetBrains, raw REST — the same ones the claim
  // route answers with `installCommand: null`) must not be offered as a
  // `--client` id: onboard.sh dies with "no config template" for them, and
  // an agent mid-setup has no way to recover from that. Deriving the list
  // from `snippet(...).command` keeps this doc in lockstep with what
  // installer-templates.ts generates, with no second hand-kept list.
  const installable = CLIENTS.filter(
    (c) =>
      c.snippet("<TOKEN>", opts.mcpUrl, opts.webUrl, "linux").command !==
      undefined,
  );

  return BRAIN_BOOTSTRAP_TOKEN_TEMPLATE.replaceAll("{{INSTALL_POSIX}}", render("linux"))
    .replaceAll("{{INSTALL_WINDOWS}}", render("win32"))
    .replaceAll(
      "{{CLIENT_IDS}}",
      installable.map((c) => `- \`${c.id}\` — ${c.label}`).join("\n"),
    )
    .replaceAll("{{MCP_URL}}", opts.mcpUrl)
    .replaceAll("{{WEB_URL}}", opts.webUrl);
}

/**
 * Derive the public URLs from env. Falls back to localhost if unset, which
 * is fine for `pnpm turbo run dev` but should never appear in a deployed
 * webapp's response — the operator is expected to set
 * BRAIN_MCP_PUBLIC_HOSTNAME (and AUTH_URL or BRAIN_PUBLIC_HOSTNAME) once
 * the host is reachable from the public internet.
 */
export function publicUrlsFromEnv(): { mcpUrl: string; webUrl: string } {
  const webHost = process.env.BRAIN_PUBLIC_HOSTNAME || "";
  const mcpHost = process.env.BRAIN_MCP_PUBLIC_HOSTNAME || "";
  const mcpHostPort = process.env.MCP_HOST_PORT || "3100";

  // Web URL: prefer AUTH_URL since that's the canonical user-facing origin.
  const webUrl = process.env.AUTH_URL?.replace(/\/$/, "") ||
    (webHost ? `https://${webHost}` : "http://localhost:3000");

  // MCP URL: prefer the public hostname (Caddy/nginx-fronted HTTPS), else fall
  // back to direct host:port. The dev-stack default (`Caddyfile.dev`) fronts
  // MCP under the same hostname as web at /mcp; the prod overlay
  // (`docker-compose.prod.yml`) puts MCP on its own subdomain. Either way,
  // BRAIN_MCP_PUBLIC_HOSTNAME is the single source of truth.
  let mcpUrl: string;
  if (mcpHost) {
    mcpUrl = `https://${mcpHost}/mcp`;
  } else if (webHost) {
    // Single-hostname dev TLS profile: MCP at /mcp on the web host.
    mcpUrl = `https://${webHost}/mcp`;
  } else {
    mcpUrl = `http://localhost:${mcpHostPort}/mcp`;
  }

  return { mcpUrl, webUrl };
}
