# User guide — using a External Brain your team has set up

> For the full technical walkthrough with concrete examples — how KEA extracts knowledge, how KRA retrieves it, how the effectiveness loop tightens — see [`HOW_IT_WORKS.md`](./HOW_IT_WORKS.md).

This is for you if someone else (IT, a teammate, the project maintainer) gave you a External Brain URL and you want to start using it. If you're installing the platform yourself, read [`QUICKSTART.md`](./QUICKSTART.md) instead.

Five minutes to first benefit. No terminal commands except the one-line config paste for your AI coding tool.

> **Looking for hands-on, step-by-step walkthroughs?** Start at [`tutorials/`](./tutorials/README.md) — six focused guides covering install, the Oracle, teaching knowledge, token scope, exporting rules, and troubleshooting. The doc you're reading now is the orientation; the tutorials are the actual practice.

---

## What you get

Every coding session with your AI tool (Claude Code, Cursor, Windsurf) produces knowledge — the framework you prefer for forms, the bug you just fixed, the rule you kept having to re-explain. Most of it evaporates when the session ends.

External Brain captures it. Before the model generates, it injects the rules you've already established ("we use react-hook-form + zod here, not Formik"). After the session, it extracts new patterns from what happened. Over time:

- Your AI tool stops making the same stylistic mistakes.
- You can ask **"what do I use for X?"** and get a grounded answer from your own history.
- You can **export** your accumulated rules as `.claude/`, `.cursor/rules/`, or `AGENTS.md` files and drop them into any new project.

The platform is MCP-first — it plugs into any AI coding tool that speaks the Model Context Protocol.

---

## 1. Sign in

Open the URL your team gave you (e.g. `https://brain.yourteam.com`). You'll either see:

- **A sign-in page asking for a voucher code** — enter the code someone on the team gave you, then "Continue with GitHub". If you don't have a code, ask your admin for one. Vouchers look like `PILOT-A1B2-C3D4`.
- **A sign-in page without a voucher field** — your team has open registration turned on. Just "Continue with GitHub".
- **The dashboard directly** — single-user dev mode, no sign-in needed.

If you see an error like "That voucher code has expired" or "exhausted", the code has reached its time or seat limit — ask for a fresh one. If you see "Too many voucher attempts from this address", you've entered bad codes 10 times in the last hour — wait an hour and try again, or ask an admin to issue you a fresh code directly.

After sign-in, the first visit shows a short 5-step onboarding modal that walks you through this guide inline. You can reopen it from the user menu if you dismiss it early.

---

## 2. Create an MCP token

A token is what lets your AI coding tool talk to your Brain. You can have one per machine; revoking one doesn't affect the others.

1. Click your avatar (bottom-left) → **MCP tokens**. Or go directly to `/settings/tokens`.
2. Give it a memorable name: `laptop`, `work-desktop`, `cursor-on-mac`.
3. Click **Create**.
4. **Copy the token immediately.** It starts with `bp_…` and is shown exactly once — if you navigate away, you have to create a new one.

Tokens default to a 90-day TTL. You'll see a list of active tokens with their `last used` timestamps so you can spot stale ones and revoke them. Each token row also has a **Verify** button that checks the token is still active server-side. For an end-to-end "is my machine actually talking to Brain" check, the home dashboard's **Connection status** card shows live per-token heartbeats (green dot = used in the last 5 min) and 24h knowledge-flow counters.

---

## 3. Wire it into your AI coding tool

Pick the section for your tool.

### Claude Code

Open or create `~/.claude/mcp.json` and add:

```json
{
  "mcpServers": {
    "brain": {
      "transport": {
        "type": "http",
        "url": "https://brain.yourteam.com/mcp"
      },
      "headers": { "Authorization": "Bearer PASTE_YOUR_TOKEN_HERE" }
    }
  }
}
```

Replace the URL with whatever your team gave you (if it's `http://localhost:3100/mcp`, that's a local deployment). Replace `PASTE_YOUR_TOKEN_HERE` with the `bp_…` token you copied.

Restart Claude Code. In a new chat, type `/mcp`. You should see `brain` listed with a green check.

### Cursor

Editor settings → **MCP** → **Add server**. Fill in:

- Server URL: `https://brain.yourteam.com/mcp`
- Header: `Authorization: Bearer PASTE_YOUR_TOKEN_HERE`

Save, reopen Cursor. The Brain should appear in the MCP servers list.

### Windsurf

Open `~/.codeium/windsurf/mcp_config.json` and add the same `brain` block as the Claude Code example above. Restart Windsurf.

### Other MCP-compatible tools

Point the client at `https://brain.yourteam.com/mcp` with the header `Authorization: Bearer <your-token>`. The protocol is standard.

---

## 4. What happens during a coding session

Once wired, every session runs this loop automatically:

1. **Before the model generates:** the tool calls `brain_retrieve_knowledge` with your prompt. The Brain returns the most relevant rules from your history, which your tool prepends as context. You don't see this; it just happens.
2. **While you work:** the tool logs events (files modified, build errors, corrections) via `brain_log_event`. These become the raw material for extraction.
3. **When the session ends:** the tool calls `brain_report_session_outcome`. The Brain's background worker (KEA) extracts up to 3 new knowledge candidates from the session. They land as proposals you can review.

You don't need to do anything special — no `/save`, no `/commit`. The MCP calls happen automatically.

**What you'll notice after 3–5 sessions:**
- The AI stops asking "which form library should I use?" — it checks your rules first.
- Your anti-patterns get respected (e.g., "don't inline Tailwind arbitrary values") without re-explaining.
- The Skills surface fills in with rows you didn't hand-type.

---

## 5. Ask the Oracle

The Oracle is the conversational interface to your own accumulated knowledge.

1. Open the webapp, click **Oracle** in the left rail.
2. Ask in plain English:
   - *"What do I use for React forms?"*
   - *"How did I solve the last Prisma transaction bug?"*
   - *"What's my rule for Stripe webhook idempotency?"*
3. The answer streams back with inline citation chips (`[^K1]`, `[^S1]`) that link to the Skills or Sessions that support each claim. Click a citation to jump to its source.

The right side of the screen shows the retrieval inspector — the top-scored Skills that were considered for your answer, with their similarity scores. Helpful for checking whether the Brain found the right sources. (User-facing copy says **Skill**; the underlying DB/API name is `Knowledge` — see [the glossary](#) under "Start here" in the deployed `/docs` index for the full vocabulary lock.)

If the answer is wrong or unhelpful: click **Not helpful** under the answer. The feedback shapes future retrieval for your account.

---

## 6. Add a skill directly

Sometimes you want to codify a rule without waiting for KEA to extract it from a session.

1. Click **Add a skill** in the top-right (formerly "Teach" — renamed in an early PR to name the object).
2. Fill in:
   - **Trigger:** when does this apply? ("When scaffolding a new React form")
   - **Rule:** what should happen? ("Use react-hook-form + zod resolver. Formik is deprecated here.")
   - **Type:** is this a reflex, recipe, heuristic, principle, or anti-principle? ([see the ontology](./KNOWLEDGE.md#2-the-5-category-ontology))
   - **Scope:** personal (only you), project (just this repo), team (your whole team), or community (public).
3. Click **Save**. Your next session will have this rule in the pre-injected context.

"Add a skill" is how you bootstrap the Brain on day 1 before you've run enough sessions to extract naturally.

---

## 7. Review skill proposals

The **Proposals** surface (URL: `/autoskill`) shows patterns KEA has noticed across multiple sessions but hasn't promoted to real Skills yet — because it wants your approval.

1. Open **Proposals** in the left rail.
2. Each proposal shows: the suggested rule, the sessions it was detected in, and a confidence band (HIGH / MEDIUM).
3. For each proposal:
   - **Apply** — promotes it to a real Skill.
   - **Reject** — dismisses it; the pattern won't be re-proposed for 30 days.
   - **Edit** — tweak the reasoning or text before applying.
   - **View diff** — shows exactly what will change in your Skills corpus.

Optional: toggle **Auto-apply HIGH** in the top-right to apply HIGH-confidence proposals automatically. Recommended once you've developed trust in what KEA produces — usually after 20–30 sessions.

---

## 8. Export your skills as rules files

The Brain can generate per-tool rules bundles so your accumulated Skills work in any project, not just those wired to MCP.

1. Open **Skills** in the left rail.
2. Scroll to the bottom-right: click **Download rules bundle**.
3. You get a markdown file containing every Skill tagged `rules-export`, formatted per-tool:
   - `.claude/rules/` for Claude Code
   - `.cursor/rules/` for Cursor
   - `AGENTS.md` for Codex / generic agents
   - A plain markdown version
4. Drop the file into a new project — your AI tool there will pick it up even without MCP.

Not every Skill exports. Tag a Skill with `rules-export` from the Skills detail pane to include it.

---

## 9. Keeping your Brain tidy

A few light-touch habits keep the corpus useful:

- **Review once a week.** Five minutes on the Proposals queue. Patterns age fast.
- **Reject aggressively.** A noisy Brain is worse than a sparse one. If a proposal looks wrong, reject it — KEA will re-learn.
- **Use Add a skill when a correction keeps happening.** Three corrections for the same thing = worth codifying.
- **Watch decay.** The Dashboard's "decay this week" number shows rules the system has auto-retired for disuse. Too much decay means the Brain was learning the wrong things. Too little means it's not pruning — anything older than 90 days without use should be deprioritized.

---

## 10. Troubleshooting

| What you see | What's happening | What to do |
|---|---|---|
| `/mcp` in Claude Code shows `brain` as red / disconnected | Token wrong, URL unreachable, or token revoked | Double-check the `Authorization: Bearer` header; re-issue the token in the webapp; confirm the URL is reachable from your machine |
| Oracle streams an answer but no citations | Retrieval found nothing relevant — your Brain is still small | Run a few more sessions or use **Add a skill** to author explicit ones |
| Oracle returns 429 "rate limited" | Too many requests in a short window | Wait a minute; the default limit is generous. If this happens repeatedly, ask whoever runs the deployment to raise `RATE_LIMIT_ORACLE_PER_DAY` |
| Skills list looks polluted (test Skills, duplicates) | Stale Skills from earlier experimentation | Use the detail pane's **Delete** to soft-delete; they disappear from retrieval immediately |
| You forgot to copy a token | Tokens are shown once | Create a new one and revoke the old one from the `/settings/tokens` page |
| Onboarding modal keeps reappearing | `bp_onboarded` flag not persisting (browser storage blocked?) | Click **Skip** — it sets the flag explicitly. Enable LocalStorage for the site if it's blocked. |

If a problem isn't in the table: share what you see with whoever operates the deployment. They have `docker compose logs`, an admin dashboard at `/api/admin/*`, and the server logs.

---

## What good looks like after a month

- **20–50 Skills** accumulated, mostly extracted from real sessions, a few hand-authored via **Add a skill**.
- **Oracle answers** cite your own sessions and reflect your actual patterns, not generic advice.
- **Session Quality Score (SQS)** on the Dashboard trending up — the Brain is making AI coding measurably better at your work.
- **Rules bundles** exported into every new project so the benefit is portable.
- **Skill proposals** (the Proposals queue) averaging 1–3 per active week, most accepted.

If that's not happening, something's wrong with the feedback loop — ask in the [repo issues](https://github.com/bejranonda/ExternalBrain/issues).

---

## See also

- [`QUICKSTART.md`](./QUICKSTART.md) — if you're installing the stack yourself.
- [`CLIENTS.md`](./CLIENTS.md) — more detail on tool wiring + MCP protocol specifics.
- [`KNOWLEDGE.md`](./KNOWLEDGE.md) — what the 5 Knowledge types mean, normative.
- [`MCP_TOOLS.md`](./MCP_TOOLS.md) — the 9 `brain_*` MCP tools, if you're building a custom agent.
