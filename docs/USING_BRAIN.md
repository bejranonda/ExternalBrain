# Using the Brain — daily workflow with Claude Code, Cursor, Windsurf

> **Audience:** an operator who already has a Brain URL and wants to use it productively from any MCP-capable AI coding tool. If you don't have a Brain yet, start at [`QUICKSTART.md`](./QUICKSTART.md). If you have one but haven't wired your editor yet, read [`CLIENTS.md`](./CLIENTS.md) first.

This document is the **daily-workflow** guide. It assumes the wiring step is done and walks through how to deploy a token onto a new machine, verify the connection, use the Brain effectively during vibe coding, ask the Oracle, teach rules, debug when something feels off, and rotate credentials safely.

Lifted from real session transcripts — every example is a phrase, command, or response that actually worked.

> **In-app companion:** the most common prompts here are also surfaced inside the
> webapp — the **"Talk to your Brain"** dashboard card and the
> **`/docs/concepts/using-from-your-agent`** concept page (localized EN/TH/DE) —
> each mapped to the `brain_*` tool it triggers. This doc is the long-form
> superset; that page is the at-a-glance cheat-sheet for a new user.

---

## 0. Mental model in 60 seconds

The Brain is a remote service. Your AI coding tool (Claude Code / Cursor / Windsurf) is a **client** that talks to it via MCP-over-HTTP. One Brain can serve many clients on many machines; they all share the same knowledge pool.

| Concept | What it is | Where it lives |
|---|---|---|
| **Brain** | The MCP server + DB + Oracle | `https://mcp.<host>/mcp` (e.g. `mcp.brain-dev.example.com`) |
| **Token** | Per-installation bearer (`bp_…`) | `~/.claude.json` after install; one row per token in the `MCPToken` table |
| **Skill** | Usage instructions for the AI | `~/.claude/skills/brain/SKILL.md` (copied by the installer) |
| **Knowledge** | The rules / patterns / decisions you've taught | `Knowledge` table; surfaced through Skills tab + retrieve_knowledge tool |
| **Session** | A unit of work the AI ran (start → events → outcome) | `Session` table; KEA extracts knowledge from completed sessions |

Three things make the loop work:
1. The MCP server is reachable and the bearer authenticates.
2. The Skill file tells the AI **when** to call which `brain_*` tool.
3. You explicitly **close** sessions with phrases like "that worked" so KEA fires and the Brain learns.

---

## 1. Deploy a token to a new machine

### One-line install (POSIX)

```bash
curl -fsSL https://<brain-host>/api/onboard.sh | bash -s 'bp_<your-token>'
```

The installer:
1. Runs `claude mcp add brain --scope user --transport http <mcp-url> --header "Authorization: Bearer <token>"`
2. Downloads the `SKILL.md` to `~/.claude/skills/brain/SKILL.md`
3. Verifies the connection with `claude mcp list`

### One-line install (Windows PowerShell)

```powershell
iwr https://<brain-host>/api/onboard.ps1 -UseBasicParsing | iex
Install-Brain -Token 'bp_<your-token>'
```

### Audit-first variant (any platform)

If you want to read the script before running it:

```bash
curl -fsSL https://<brain-host>/api/onboard.sh -o /tmp/brain-install.sh
less /tmp/brain-install.sh
bash /tmp/brain-install.sh 'bp_<your-token>'
```

### What if it says "MCP server brain already exists"?

That happens when a previous registration is still in `~/.claude.json`. The installer prints the exact remediation:

```bash
claude mcp remove brain --scope user
curl -fsSL https://<brain-host>/api/onboard.sh | bash -s 'bp_<your-token>'
```

This is **safe** to run any time — `claude mcp remove` only removes the entry from your local config; it doesn't revoke the token on the Brain side.

### Two machines, one Brain

Mint **one token per machine** at `https://<webapp-host>/settings/tokens`. They both authenticate against the same Brain, so knowledge taught on machine A is immediately retrievable on machine B. Each token has independent revocation (steal-resistant).

```
Machine A — `claude mcp add brain ...` --header "Authorization: Bearer bp_AAAA..."
Machine B — `claude mcp add brain ...` --header "Authorization: Bearer bp_BBBB..."
                                                          \         /
                                          (both target the same Brain URL)
                                                          \         /
                                              [ same Brain — Knowledge / Sessions / Oracle ]
```

The Brain doesn't care which token wrote a row; ownership is by `userId`, and tokens for the same user contribute to the same pool.

---

## 2. Verify the connection

Three checks, fastest first:

```bash
# (a) one-liner — does the bearer auth round-trip work?
claude mcp list | grep brain
# expect: brain: https://mcp.<host>/mcp (HTTP) - ✓ Connected

# (b) full registration detail — which token is registered?
claude mcp get brain

# (c) live tools — does the AI actually see them in a session?
claude
> list the brain tools
# expect: 9 tools listed under mcp__brain__*
```

If `(a)` shows `✓ Connected`, the Brain is wired. If `(c)` lists 9 tools (`brain_start_session` through `brain_session_search`), the AI will use them when prompted by phrases the SKILL.md recognises.

### Health endpoint

The MCP server exposes an unauthenticated `/health` for monitoring:

```bash
curl https://mcp.<host>/health
# {"ok":true,"transport":"http","sessions":3}
```

`sessions` is the live count of in-flight MCP sessions. Useful for "is anyone connected?" probes.

---

## 3. Use it: the trigger-phrase map

You don't call MCP tools by name. You speak naturally; the SKILL.md tells the AI which tool to invoke for which phrase.

| You say… | The AI calls… | What you see |
|---|---|---|
| (start of any non-trivial task) | `brain_start_session` | Silent — sessionId saved internally |
| "remember this: …" / "save this rule" | `brain_teach_knowledge` | "Saved as a rule" + a row appears in `#skills` |
| "ask the oracle: …" / "how did I solve …?" | `brain_ask_oracle` | Streamed answer with `[^N]` citations + groundedness pill |
| "what did I do last week on X?" | `brain_session_search` | List of past sessions matching keywords |
| "find the rule about Y" | `brain_retrieve_knowledge` | Top-N rules by semantic similarity |
| "what's my style for tests?" | `brain_get_user_style` | peerCard + reflexes (used internally to colour generation) |
| "is there a recipe for Z?" | `brain_find_skill` | A higher-level Skill (composed of multiple rules) |
| (every accept/reject during the session) | `brain_log_event` | Silent — feeds KEA's view of what happened |
| **"that worked" / "we're done" / "ship it"** | **`brain_report_session_outcome`** | **KEA fires within 30 s; 0–3 new rules within minutes** |

The single biggest practical lesson: **close your sessions explicitly**. Without `brain_report_session_outcome`, KEA never runs and your Brain stays empty.

---

## 4. Apply: a real coding session, narrated

```
You:    I want to refactor the auth middleware to use the new credentials adapter.

Claude: [calls brain_start_session — assigns sessionId]
        [calls brain_get_user_style — gets your test/log conventions]
        [calls brain_retrieve_knowledge with prompt="auth middleware credentials adapter"]
        Found 3 relevant rules:
          [^K1] Always log auth failures with structured BrainError(code: "auth")
          [^K2] Credentials adapter must wrap pg-pool with explicit timeout
          [^K3] Anti-pattern: don't store bcrypt hashes in env — use ADMIN_PASSWORD_HASH
        Here's my plan based on those rules: …

You:    looks good, do it

Claude: [edits files; calls brain_log_event for each significant change]
        [runs tests; calls brain_log_event(build_attempt) and (build_success)]
        Done. All tests green.

You:    perfect, that worked

Claude: [calls brain_report_session_outcome with success=true, knowledgeUsed=[K1,K2,K3]]

(~20s later, in the worker logs:)
worker  {op:"kea.extract", outcome:"ok", items:1, durMs:11420,
         msg:"kea.extract"}
```

The new rule that landed (visible in `#skills` after a refresh):

```
type:    heuristic
trigger: when refactoring an existing middleware
rule:    keep the existing auth-failure log shape (BrainError + code)
         when swapping the underlying adapter — downstream alerting
         is keyed on those codes
rationale: derived from the session where K1 was reused unchanged
           across the credentials-adapter swap
```

That rule didn't come from "remember this" — it came from KEA reading the session's events + outcome. **That's the automatic flywheel.** It only fires because you said "that worked" at the end.

---

## 5. Inquire: question patterns that work well

### Cheap, fast, free — `brain_retrieve_knowledge`

```
You:    find rules about prisma migrations
Claude: [returns top 5 by semantic similarity — sub-100 ms, no LLM call]
```

Use this whenever you'd otherwise re-derive a decision. It costs nothing.

### Slow, billed, structured answer — `brain_ask_oracle`

```
You:    ask the oracle: how do I run prisma migrate reset on this project?
Claude: [retrieves bundle; calls Sonnet 4.6 / GLM 5.1; ~10 s]
        Per your prior rules, the answer is:
        1. Set the consent token: PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="…"  [^K7]
        2. Run with --force on the dev DB only — no real users yet [^K9]
        3. After reset, drop pgboss schema and let v12 recreate it [^K11]
        Grounded on 3 rules · 0 sessions · moderate
```

Use this when:
- You want a synthesised answer, not a list
- You need rationale/explanation, not just rule text
- You're starting work and want context

**Don't** use it for one-shot factual lookups (`how does CSS flexbox work` — that's WebSearch). The Oracle is your project's memory, not the internet.

### Time-window — `brain_session_search`

```
You:    what did I work on last Monday?
Claude: [calls session_search with date filter]
        Sessions on 2026-04-28:
        - 14:02 UTC: refactor auth middleware (success)
        - 16:30 UTC: fix migration ordering (success)
        - 19:15 UTC: investigate worker crashloop (failure)
```

Useful for stand-up prep and "where was I?" recovery after time off.

---

## 6. Other activities

### Teach a rule explicitly

```
You:    remember this: when bumping pg-boss across a major version,
        always run `DROP SCHEMA pgboss CASCADE` first — pg-boss 12+
        doesn't ship migrations from v24, so a fresh schema is the
        only clean upgrade path.
```

The rule is created **immediately**; no waiting for KEA. Use this when:
- You want the rationale you give it, not what KEA infers
- You want the rule live before this session ends
- You're capturing something architectural that wasn't part of any specific session

### Browse / edit / delete rules

Open `https://<webapp-host>/<org>/<project>#skills`. Each row has the rule, its effectiveness badge (✓/~/✗/—/○), filters, and an inline editor. Edits are version-controlled (forks create a new row, parent retained).

### See what a specific session actually got from the Brain (2026-05-23, 2026-05-24)

Two equivalent entry points, same drill-down:

- **From the Dashboard** (the landing route at `https://<webapp-host>/<org>/<project>`). The **Your recent work** panel shows the latest 6 sessions; click any row to expand it inline. No nav to `#sessions` required — added in an early PR.
- **From the Sessions surface** (`https://<webapp-host>/<org>/<project>#sessions`). Click any row (desktop) or tap any card (mobile) for the full session table with the same expansion.

Either way, the row opens a two-column panel:

- **Brain helped you** — skills the AI retrieved INTO this session via `brain_retrieve_knowledge`. These are the items that shaped the tool's answer.
- **Brain learned from you** — new skills KEA pulled OUT of this session after it closed. These are what the Brain gained.

Each item links to its row in `#skills`, so a "where did this come from" or "did the suggestion that helped me here come from a real prior session" question is one click away. Press `Enter` or `Space` on a focused row for the same toggle (no mouse needed).

The Sessions table header still shows the bare `K in/out` counts; the drill-down only shows the names. If `K in/out` says `5 / 3` but the panel shows fewer rows, the missing ones are soft-deleted Knowledge — they were applied at the time, but you removed them later, so they no longer show on a surface you can act on.

### See what the Brain has done for a whole project (2026-05-24)

The Dashboard's **Your projects** section lists every project you can see. Click any row to expand the project-level value drill-down inline:

- **Brain helped this project** — skills retrieved INTO any session in this project, ranked by hit count. A skill that helped four sessions ranks above one that helped two.
- **Brain learned from this project** — new skills KEA pulled OUT of any session in this project, ranked the same way.

A one-line value summary above the two columns reads, e.g., *"42 sessions · brain shared 12 skills into this project and learned 8 new ones from it."* For a project with no sessions yet, the summary swaps to a "start one from Claude Code / Cursor / any MCP client" prompt instead.

**Earned surface area.** If you have zero projects, the section disappears entirely. With exactly one project it collapses to a single row (no list of one). The full clickable list only appears at ≥2 projects. This is the same pattern as the project switcher in the topbar — see `docs/DESIGN_PRINCIPLES.md §2`.

Backend contract for the curious: `GET /api/projects/:id` — see `docs/REST_API.md` and `docs/KNOWLEDGE.md §12.30`.

### Switch projects without a hard reload (2026-05-23)

The project switcher in the topbar (visible only when you have ≥2 projects or ≥2 orgs) refetches its list every time you open the dropdown — so a project you just created in another tab, via the CLI, or via the API shows up without a page reload. Before 2026-05-23 the dropdown only refreshed on page mount, which caused a "I created it but it's missing" surprise — fixed by an early PR.

### Bulk reset (org-admin only)

`https://<webapp-host>/settings/reset-knowledge` — soft-deletes (or hard-deletes for scope=ALL) Knowledge rows in the active org. Seven scopes: sample-only, older-than-N, custom-days, all. Always audit-logged. Useful before a pilot to clear sample seed data.

### Mint a new token

`https://<webapp-host>/settings/tokens` → **Create token** → copy the `bp_…` shown ONCE → run the one-liner installer with it on the target machine.

### Rotate a token without losing the install

`https://<webapp-host>/settings/tokens` → **Change** button on the row → copy the new `bp_…` → on the affected machine:

```bash
claude mcp remove brain --scope user
curl -fsSL https://<brain-host>/api/onboard.sh | bash -s '<new-bp_-token>'
```

Same token row in the DB; the bearer string is replaced; old bearer is rejected immediately. The 24 h grace window from #82 keeps in-flight sessions alive long enough to swap.

### Revoke (laptop stolen / suspected leak)

`/settings/tokens` → **Revoke** on the row. Immediate. Other machines continue to work because they have different tokens.

---

## 7. Empty-Brain state — what to expect

Right after a fresh deploy or a `prisma migrate reset`, the Brain has zero rules and zero sessions. That's not a bug. The Oracle handles it explicitly:

```
You:    ask the oracle: what's in my brain?
Oracle: ⚠️ I have no Brain context for this question. Your Brain
        contains no knowledge items and no session history…
        Groundedness: none, retrieved: { knowledge: 0, sessions: 0 }
```

The `⚠️` banner with a "Teach a rule" CTA renders in the web UI (`/<org>/<project>#oracle`). The CLI version (Claude Code in your terminal) shows the LLM's text response — it explicitly tells you the Brain is empty.

The fastest way out of empty-Brain: 5–10 explicit `remember this` statements pinned to your project's high-leverage decisions. After that, KEA + autoskill take over and the Brain grows on its own from your real sessions.

---

## 8. Debug — when something feels off

### Tools not visible in Claude Code

```bash
claude mcp list | grep brain
```

- `✓ Connected` but no `mcp__brain__*` tools in the AI's session: **restart Claude Code** (Ctrl+C, then `claude` again). The SKILL.md is loaded at startup.
- `✗ Failed`: bearer is invalid or the MCP host is unreachable. Re-mint at `/settings/tokens`, then `claude mcp remove brain --scope user` + re-run the installer.

### Oracle returns 401

Bearer is invalid (revoked, rotated, or wrong host). Check `claude mcp get brain` and confirm the URL + bearer match the host you're trying to reach.

### Knowledge isn't accumulating

The likely cause is missing session-close. Check the worker logs:

```bash
docker logs deploy-worker-1 --since 1h | grep "kea.extract"
```

If you see no `kea.extract` lines after a session ended, Claude didn't call `brain_report_session_outcome`. Be more explicit: end with "we're done" or "ship it" — the SKILL.md trains the AI to recognise these as session-close signals.

### Worker crashloops on `pgboss.job_common does not exist`

pg-boss major bump without schema reset. Run:

```bash
docker compose ... exec -T db psql -U brain -d brain \
  -c 'DROP SCHEMA IF EXISTS pgboss CASCADE;'
docker restart deploy-worker-1
```

`scripts/pgboss-version-check.sh` (after PR #90) catches this preemptively before a deploy.

### Cookie write 500 on `/<org>/<project>` page

Stale session cookie from before a `prisma migrate reset`. Clear cookies for the host in your browser; the page will bounce you to `/signin`. The bug that originally let this 500 was fixed in #80.

### Mobile: where is the settings menu?

Tap the gear icon in the top-right of the page. Since #86 it opens the full user menu (Preferences, MCP tokens, Organization, Projects, Reset knowledge, Sign out). The left-rail user-avatar is desktop-only; the mobile bottom nav has the four primary surfaces (Dashboard / Oracle / Skills / Graph) — there's no settings entry there by design.

---

## 9. Operator habits that pay off

After ~50 sessions of dogfooding, three habits separate a Brain that compounds from a Brain that stagnates:

1. **Close every session.** Even a tiny task. "ok done" is enough — KEA fires off small sessions too. The cost is negligible (~$0.001 per KEA call); the rule it produces might pay for itself the next day.

2. **Teach explicit rules at the moment of pain.** When you correct the AI with "no, never do X — always do Y because Z", say "remember this" right after, with the **rationale** (Z). The rationale is what makes future Oracle answers sharp. Without it, the rule is just an assertion.

3. **Ask before you guess.** Before any task that feels like one you've done before, "ask the oracle: have I done X before?" One Oracle call costs <$0.01 and saves you re-deriving prior decisions. The "ask the oracle:" prefix is the trigger phrase — without it the AI will often just answer from general knowledge.

A Brain that does well after a month: 30+ rules with effectiveness badges (mostly ✓), 50+ closed sessions, and an Oracle that consistently grounds on 3+ rules per answer.

---

## 10. See also

- [`CLIENTS.md`](./CLIENTS.md) — per-tool wiring snippets (Claude Code / Cursor / Windsurf / Claude Desktop)
- [`MCP_TOOLS.md`](./MCP_TOOLS.md) — the 9 `brain_*` tools in detail (input/output schemas)
- [`HOW_IT_WORKS.md`](./HOW_IT_WORKS.md) — full platform walkthrough with examples
- [`KNOWLEDGE.md`](./KNOWLEDGE.md) — the knowledge model (5 types, lifecycle, invariants)
- [`SECURITY.md`](./SECURITY.md) — auth modes, token rotation, voucher gate
- The skill served at `https://<brain-host>/api/skills/brain` — what tells your AI when to call which tool
