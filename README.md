# External Brain: Self-Improving, Compounding AI Coding Intelligence Across Every Tool, Project, and Team

> **Standard AI memory is trapped in one tool, one project, one person — and stays static.** Claude
> Code doesn't share with Cursor, lessons learned on one repo don't carry to
> the next, and basic memory just accumulates raw chat history. External Brain is **a
> self-improving, compounding intelligence engine across every MCP tool, project, and team**.
> It extracts structured rules and recipes from finished sessions, reinforces what pays off,
> decays obsolete guidance, and makes every AI tool 10× smarter from your team's real work.
> Built for teams and enterprise, on your own infrastructure.

<img width="1416" height="320" alt="image" src="https://github.com/user-attachments/assets/74d9c69c-145a-452d-aead-b00f8447025c" />

<p>
  <a href="https://github.com/bejranonda/ExternalBrain/actions/workflows/ci.yml"><img alt="GitHub Workflow CI build status" src="https://github.com/bejranonda/ExternalBrain/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/bejranonda/ExternalBrain/stargazers"><img alt="GitHub Stars count" src="https://img.shields.io/github/stars/bejranonda/ExternalBrain?style=flat&color=gold"></a>
  <a href="https://github.com/bejranonda/ExternalBrain/network/members"><img alt="GitHub Forks count" src="https://img.shields.io/github/forks/bejranonda/ExternalBrain?style=flat&color=blue"></a>
  <a href="https://github.com/bejranonda/ExternalBrain/issues"><img alt="GitHub Open Issues" src="https://img.shields.io/github/issues/bejranonda/ExternalBrain?style=flat&color=red"></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="TypeScript strict mode" src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg">
  <img alt="Model Context Protocol native support" src="https://img.shields.io/badge/Model_Context_Protocol-native-6E56CF.svg">
  <img alt="Self-hosted via Docker Compose" src="https://img.shields.io/badge/self--hosted-Docker_Compose-2496ED.svg">
</p>

**External Brain** is a self-hosted **MCP (Model Context Protocol) server +
webapp** that powers self-improving AI coding intelligence. It ingests
your coding sessions, **extracts durable knowledge** (skills, rules, recipes,
anti-patterns, project decisions), **retrieves it by semantic meaning** when you start a new task,
and answers questions about your own codebase through a grounded **Oracle** —
every answer cited back to the sessions and skills that support it.

Unlike basic memory built into individual AI tools, that intelligence is **one shared,
self-improving, inspectable layer across every MCP client** — it stays on your own
infrastructure instead of sitting in a separate black box locked inside each
tool.

Provider-agnostic (Google Gemini, GLM, OpenAI, Anthropic Claude), runs on a
single VM with Docker Compose, and **MIT-licensed** — fork it and build your
own.

![Architecture diagram showing how External Brain connects AI coding tools like Claude Code and Cursor via MCP to a Postgres + pgvector knowledge store](./docs/assets/illustrations/ai_application.png)

---

## Why Use External Brain? — Self-Improving Compounding Intelligence Across Every Tool, Project, and Team

Modern AI coding tools have memory now. The real problem is *where* that memory
lives, *how static it remains*, and *how far it reaches*:

- **Siloed & Static — per tool, per project, per person.** Claude Code doesn't share with
  Cursor or Copilot; a lesson learned on one repo doesn't carry to the next; and
  your teammates each start from zero. Knowledge that should compound stays stuck
  in one place.
- **A black box.** You can't see what it kept, fix it when it's wrong, or curate
  it. You just hope it remembered the right thing.
- **Not yours.** It's locked inside one vendor's cloud, tied to that one tool.
  You can't inspect it, move it, or share it on your terms.

External Brain is the missing **self-improving intelligence layer that spans every AI coding tool,
every project, and your whole team**: one shared, inspectable, self-hosted store
you actually own. A rule captured once ("we use Zod not Yup", "the deploy breaks
if you skip the migration step", "this service owns auth") is served back to
every tool, on every project, for every teammate who needs it. With user /
project / team / org scopes, it was built for **enterprise knowledge reuse**, so
the lessons one engineer learns become the team's, not a silo's.

And it doesn't sit still. **Autoskill** watches your sessions, proposes new skills
it notices you reusing, reinforces the rules that pay off, and lets the weak ones
fade. Each project gets better day by day, on its own, through **self-improving feedback loops**.

### Key Features

- 🧠 **Automatic knowledge extraction** — finished sessions are mined for
  durable, reusable lessons. No manual note-taking.
- 🔌 **Universal MCP compatibility** — works with Claude Code, Cursor,
  Windsurf, Google Antigravity, GitHub Copilot (VS Code, JetBrains, CLI), and
  any MCP-capable agent as first-class clients.
- 🔎 **Semantic retrieval with pgvector** — relevant skills are injected into
  context *before* the model generates, by meaning, not keyword match.
- 💬 **Grounded Oracle with citations** — ask "how did we fix the deploy bug?"
  in plain English and get an answer cited to real sessions and skills.
- 📝 **Meeting transcript → decisions & action items** — paste a transcript
  and review/confirm the decisions, owned action items, and open questions
  it surfaced. Flag-gated (`MEETING_UPLOAD_ENABLED`), off by default.
- 📈 **Self-improving knowledge base** — a daily pipeline synthesizes
  cross-session knowledge; low-value skills decay; useful ones surface; and
  post-session **proposals** suggest new rules, increasingly tuned to what you
  accept vs reject. The brain gets sharper the more you use it.
- 🏠 **Self-hosted & private** — your knowledge stays in your Postgres, on your
  infrastructure. Secure-by-default auth, Bearer-gated MCP.
- 👥 **Team & enterprise knowledge sharing** — user / project / team / org scopes
  mean a skill learned once is reused across other projects and teammates, with
  team-wide access to the same decisions. Built for enterprise knowledge reuse,
  not one-person silos.
- 🪶 **Clean, progressive-disclosure UI** — a quiet dashboard that opens into
  depth only when you ask. Not a wall of dials.
- 🧭 **Self-explaining with built-in docs** — a built-in `/docs` glossary
  (every concept in plain English, EN/TH/DE), inline tooltips on jargon, and an
  in-app cheat-sheet of the exact prompts to type to your agent.
- 🌐 **Multilingual UI** — English, Thai (ไทย), and German, switchable on every
  surface including unauthenticated pages.

> **What it is *not*:** another AI coding tool. External Brain doesn't write
> code — it's the memory substrate that makes whatever tool you already use
> smarter over time.

---

## Quickstart — Self-Host External Brain in Minutes

Requires Docker Engine 24+ and one LLM provider key (Google Gemini has a free
tier and is the easiest start). Full guide: **[docs/QUICKSTART.md](./docs/QUICKSTART.md)**.

```bash
git clone https://github.com/bejranonda/ExternalBrain.git external-brain
cd external-brain

cp .env.example .env          # add one provider key (e.g. GOOGLE_GEMINI_API_KEY)
./scripts/dev-up.sh           # build · migrate · seed · start — idempotent
```

*Alternatively, run directly via Docker Compose:*
```bash
docker compose -f deploy/docker-compose.yml up -d
```

Webapp: `http://localhost:3000` | MCP HTTP: `http://localhost:3100/mcp`

`dev-up.sh` runs an auth-posture audit at the end and prints PASS/FAIL. For a
public-internet **server** deployment (Caddy + auto-TLS, real auth enforced,
nightly backups), use `./scripts/deploy.sh` instead — see
[docs/DEPLOY_CHECKLIST.md](./docs/DEPLOY_CHECKLIST.md).

### Sign in & create your workspace

New users can self-register from **`/signin` → "Create one"** (email + password)
and get their own personal workspace immediately. Registration is
secure-by-default: it requires a voucher code (minted by the operator at
`/admin`) unless you set `REGISTRATION_REQUIRES_VOUCHER=false` to open signup
fully. Any signed-in user can also create additional organizations from
**Settings → Organization → New organization**. See
[docs/SECURITY.md](./docs/SECURITY.md) for the full posture.

**Two public URLs matter.** `https://<your-host>/` is the landing page — what
Brain is, what it does, which tools it works with, and links into the docs. It
renders for anonymous visitors only; signed-in users are still routed straight
to their project.

`https://<your-host>/start` is the front door for anyone holding a **voucher
code** — it prefills from `?voucher=CODE`, explains both setup routes, and is
where every voucher error on `/signin` sends people. That is the link worth
printing on a card or pasting into a channel.

> Fresh deployments serve `robots.txt` with `Disallow: /`, because an
> invite-only instance shouldn't be indexed. Set `BRAIN_ROBOTS_DISALLOW_ALL=false`
> when you want your landing page found.

### Let your AI set itself up (no browser)

If you'd rather not leave your editor, hand the voucher to your agent instead.
Paste this into Claude Code, Cursor, or any AI tool that can fetch a URL:

```text
Set up External Brain on this machine. My voucher code is PILOT-XXXX-XXXX.
Fetch https://<your-host>/api/onboard/agent.md and follow it exactly.
Ask me for my email address first — don't guess it.
```

The agent creates your account, mints a token, and wires up MCP — then **stops
and tells you to restart**, because MCP configuration is bound at session start
and the connection isn't live until you do.

**Operators must opt in:** set `AGENTIC_ONBOARDING=true`. It is off by default,
because with it on a voucher code is a bearer-equivalent secret — anyone holding
one can mint a token. The minted token is deliberately narrow (14 days, no
Oracle access) so a leaked code can't run up LLM spend. Full posture and the
trade-offs: [docs/SECURITY.md](./docs/SECURITY.md#agentic-onboarding--the-voucher-becomes-a-credential-v2150).

### Connect your AI tool (browser route)

After signing in, **[`docs/tutorials/00-quick-start.md`](./docs/tutorials/00-quick-start.md)**
(also served in-app at `/docs/tutorials/00-quick-start`) walks you through it:
mint a token, copy a one-line installer, run any task. Every supported client
gets a command — pass `--client` to pick one (it defaults to `claude-code`):

```bash
curl -fsSL https://<your-host>/api/onboard.sh | bash -s 'bp_<your-token>'
curl -fsSL https://<your-host>/api/onboard.sh | bash -s 'bp_<your-token>' --client cursor
```

```powershell
iwr https://<your-host>/api/onboard.ps1 -UseBasicParsing | iex
Install-Brain -Token 'bp_<your-token>' -Client windsurf
```

> **Crucial:** Always restart your AI tool (Claude Code, Cursor, Windsurf, etc.) after running the onboarding script so it loads the new MCP server configuration at startup.

Clients: `claude-code`, `claude-desktop`, `cursor`, `windsurf`, `antigravity`,

`vscode`, `copilot-cli`, `codex`, `gemini-cli`, `generic`. Where the vendor
ships its own `mcp add` verb (Claude Code, Copilot CLI, Codex) the installer
calls it; otherwise it merges into the client's config file — backing it up
first and preserving every other MCP server already there.

Either way it then **smoke-tests the round-trip** — a real MCP `initialize` +
tool call through your network and auth path — and seeds your first session, so
"installed" means "this token can call a tool", not "a file was written".
Manual wiring and the per-client config shapes:
[docs/CLIENTS.md](./docs/CLIENTS.md).

Not sure it actually worked? `/welcome` is a live status page, not a setup
flow — it polls for your first session and tells you honestly if nothing's
arrived after 90 seconds, with the most likely causes.

Once connected, the dashboard's **"Talk to your Brain"** card and the in-app
**[Using Brain from your agent](./docs/USING_BRAIN.md)** page give you the literal
prompts to drive it day-to-day ("create a project for this workspace", "transfer
what we learned into the Brain") — each mapped to the `brain_*` tool it triggers.

---

## How External Brain Works — MCP Knowledge Pipeline

```
  AI coding tool ──MCP──▶  External Brain  ──▶  Postgres + pgvector
   (Claude Code,            ├─ retrieve relevant skills (before you code)
    Cursor, …)              ├─ log the session + outcome (after you code)
                            ├─ extract durable knowledge (background worker)
                            └─ answer questions via the Oracle (cited)
```

1. **Before a task**, opening a session (`brain_start_session` with the task
   description) returns `relevantKnowledge` — past skills scored against the
   task, injected in the same round-trip. (`brain_retrieve_knowledge` remains
   for mid-task re-query.)
2. **After a task**, the session + outcome are reported and queued for
   extraction.
3. **A background worker** mines sessions into typed skills, embeds them for
   semantic search, and decays the stale ones.
4. **Anytime**, ask the **Oracle** in plain language and get grounded, cited
   answers from your own knowledge.
5. **Meetings too (V2.0):** feed a transcript through the
   [meeting-miner protocol](./docs/protocols/meeting-miner.md) (agentic) or
   paste it straight into the `/meetings` webapp surface (no agent required
   — flag-gated `MEETING_UPLOAD_ENABLED`, off by default) and decisions
   (with supersession), per-person action items, and open questions land in
   the same knowledge loop. Assignees see their open items at session start;
   the Oracle answers "what's open / blocked / unanswered?" from a complete
   task list. Surfacing is behind `V2_ACTION_ITEMS` / `V2_ORACLE_TASKS` flags
   — default off for a fresh self-host, so `git clone` still gives you plain
   V1 behavior; opt in by setting both `V2_ACTION_ITEMS="true"` and
   `V2_ORACLE_TASKS="true"`.

Full walkthrough with examples: **[docs/HOW_IT_WORKS.md](./docs/HOW_IT_WORKS.md)**.

---

## Tech Stack — What Powers External Brain

| Concern | Choice |
|---|---|
| Runtime | Node 20 LTS · TypeScript (strict) |
| Webapp | Next.js · React · Tailwind |
| Database | Postgres + pgvector |
| Embeddings | Provider-agnostic via `EMBEDDING_BASE_URL` (Gemini / OpenAI / Qwen3 — any OpenAI-compatible endpoint) |
| LLM | Claude / GLM / OpenAI / Gemini (swap via env) |
| Background jobs | pg-boss (no Redis required) |
| Rate-limit state | In-process by default; Redis when `REDIS_URL` is set (needed for multi-replica, and it survives restarts) |
| Protocol | Model Context Protocol (`@modelcontextprotocol/sdk`) |
| Packaging | Turborepo + pnpm workspaces · Docker Compose |

---

## Repository Structure

```
apps/
  web/         Next.js webapp — dashboard, Oracle, Skills, settings
  mcp-server/  MCP server (stdio + HTTP transport)
  worker/      Background jobs: extraction, decay, embeddings
packages/
  core/        Intelligence layer (extraction, retrieval, Oracle)
  db/          Prisma schema + client
  types/       Cross-package TypeScript types
deploy/        Docker Compose, Caddy, Dockerfile
docs/          Documentation
REBUILD/       Phase-by-phase vibe-coding reconstruction guide (start: REBUILD/00-START-HERE.md)
```

---

## Operating a Brain — what tells you it's working

Self-hosting means you own the failure modes, so the platform surfaces them
rather than leaving them in container logs:

| Surface | Answers |
|---|---|
| `/admin` → **Backups** tile | did last night's `pg_dump` succeed, and is off-host replication current? |
| `/admin` → **Background jobs** tile | did any job exhaust its retries and get lost? (`GET /api/admin/queue-health`) |
| `/settings/tokens` → **Limited:** chip | is any token restricted, and to what? (capabilities: `knowledge`, `skills`, `sessions`, `oracle` — empty means unrestricted) |
| `./scripts/smoke.sh` | are all containers healthy, and does a real MCP session still complete end-to-end? |
| `./scripts/verify-lockdown.sh` | is the deployment still refusing anonymous access on every gated surface? |

`./scripts/deploy.sh` runs the last two automatically and **fails the deploy**
if either does. That is deliberate: this project's most expensive bugs have all
been silent ones — a backup that failed for three weeks, a nightly extraction
that died for eight days, a healthcheck that could never pass. Each was
invisible until something was built to look. See
[`KNOWN_ISSUES §0q`](./docs/KNOWN_ISSUES.md) for the full set and what each one
cost.

The 2026-08-05 pass ([`§0s`](./docs/KNOWN_ISSUES.md)) found two more of the
same shape, and both had been reporting success the whole time: nightly
backups that had **never written a single file** (the service was gated behind
a compose profile the nginx-fronted topology never enables), and a renewed TLS
certificate that nginx never picked up, silently breaking every MCP client for
11 days. The rule they taught:

> **An automated mechanism is not verified until you have inspected its
> output.** A green container, a zero exit code, and a "renewals succeeded"
> banner each proved nothing. Count the rows in the dump; read the certificate
> off the wire.

If you self-host, spot-check these two directly — neither raises an alarm on
its own:

```bash
docker run --rm -v deploy_brain_backups:/b alpine ls -la /b/last/   # expect a .sql.gz
echo | openssl s_client -connect mcp.your-host.com:443 2>/dev/null \
  | openssl x509 -noout -dates                                     # expect a future date
```

The 2026-08-06 sequel ([`§0t`](./docs/KNOWN_ISSUES.md)) turned the same rule on
the verification itself. Five rules were taught over MCP and the loop was
confirmed — teach, retrieve, inject, close — with every call returning a real
id. All of it went to a **different Brain**: Claude Code binds its MCP config
at session start, so re-running the installer mid-session repoints the file
while the live connection keeps writing to the instance it already had.

> **A round-trip test proves the loop is closed; it says nothing about *which*
> loop.** When a check can pass against the wrong target, the target is part of
> what you are checking.

So if you point a client at a different Brain, restart it — then confirm where
your writes actually went. Note what each check does and does not prove:

```bash
# The CONFIGURED target. Does NOT prove which endpoint the running session
# uses — that mismatch is the whole incident.
python3 -c "import json;print(json.load(open('$HOME/.claude.json'))['mcpServers']['brain']['url'])"
```

The only conclusive check is server-side: teach one rule, then confirm the id
it returned exists in the Brain you meant.

```sql
select id from "Knowledge" where id = '<id returned by the teach call>';
```

And treat an empty result as a question, not a pass: `brain_get_user_style`
returning zero reflexes usually means *a different instance answered*, or that
this token's user owns no knowledge yet — not that anything is broken.

The 2026-08-07 finding ([`§0z`](./docs/KNOWN_ISSUES.md)) is the inverse of
§0u below: not a shape no client accepts, but a **correct** shape written to a
path the client no longer reads. Google folded Gemini CLI into Antigravity CLI
and moved its MCP config file in the process; our installer kept emitting the
old path for weeks. A user pasting the snippet got a syntactically perfect
config sitting somewhere nothing would ever load it — no error, no server,
nothing to diagnose.

> **A passing test that pins an external product's file path is evidence
> about your code, not about the vendor.** Nothing inside this repo could
> have caught the drift; the assertion kept passing precisely because it was
> pinned to the value that went stale.

If a tool you integrate with announces a rename, merger, or retirement,
that's the cue to re-check its config path — there is no internal test that
substitutes for reading the vendor's current docs.

## Documentation & Guides

| Doc | What it covers |
|---|---|
| [EVIDENCE](./docs/EVIDENCE.md) | **Does it actually help?** — the capture→retrieve loop demonstrated on a real instance |
| [QUICKSTART](./docs/QUICKSTART.md) | Zero to a running instance |
| [**tutorials/00-quick-start**](./docs/tutorials/00-quick-start.md) | **Start here — token → install → first conversation, 5 min.** Also in [ไทย](./docs/tutorials/00-quick-start.th.md) · [Deutsch](./docs/tutorials/00-quick-start.de.md), and as printable PDFs: [EN](./docs/assets/handouts/External-Brain-Quick-Start.pdf) · [TH](./docs/assets/handouts/External-Brain-Quick-Start-TH.pdf) · [DE](./docs/assets/handouts/External-Brain-Quick-Start-DE.pdf) |
| [tutorials/](./docs/tutorials/README.md) | End-user tutorials 01–07: getting started → Oracle → teaching → tokens → exporting → troubleshooting → skill types for non-tech readers |
| [HOW_IT_WORKS](./docs/HOW_IT_WORKS.md) | End-to-end mental model with examples |
| [ARCHITECTURE](./docs/ARCHITECTURE.md) | System design, layers, data flow |
| [MCP_TOOLS](./docs/MCP_TOOLS.md) | The `brain_*` MCP tools + resources |
| [REST_API](./docs/REST_API.md) | HTTP endpoints |
| [CLIENTS](./docs/CLIENTS.md) | Wiring Claude Code / Cursor / Windsurf / Antigravity / GitHub Copilot |
| [USING_BRAIN](./docs/USING_BRAIN.md) | Daily workflow, trigger phrases, recipes |
| [KNOWLEDGE](./docs/KNOWLEDGE.md) | The knowledge model (normative) |
| [protocols/](./docs/protocols/meeting-miner.md) | Agent protocols (V2.0): meeting-miner · doc-harvest · doc-draft · report-draft |
| [VALIDATION](./docs/VALIDATION.md) | **Does it measurably help?** — retrieval NDCG@5 0.45 vs 0.30 cosine baseline (2026-07-06); two generation-uplift reads (+33.3pp n=6, then +40pp n=5 with live retrieval), both small and honestly caveated. The more useful finding than either number: injected knowledge changes the output where a convention is *locally arbitrary* (a workspace subpath, a build-pipeline quirk) and makes no difference where it coincides with general good practice **Acted on since v2.7.0:** KEA's extraction prompt now optimises for exactly that — it prefers conventions a competent engineer could not derive and demotes general best practice, with the before/after pre-registered |
| [SECURITY](./docs/SECURITY.md) | Auth modes, MCP gating, threat model |
| [DEPLOY_CHECKLIST](./docs/DEPLOY_CHECKLIST.md) | Production deploy on a public VM |
| [CICD](./docs/CICD.md) | CI checks + the two deploy scripts, for forkers |
| [CONTRIBUTING](./docs/CONTRIBUTING.md) · [GUIDELINES](./docs/GUIDELINES.md) | How to contribute, code style |
| [DESIGN_PRINCIPLES](./docs/DESIGN_PRINCIPLES.md) | UI philosophy (progressive disclosure) + the accessibility constraint |
| [UI_UX_MASTER_AUDIT](./UI_UX_MASTER_AUDIT.md) | **UI/UX + WCAG 2.1 AA audit (2026-08-05)** — the aesthetic half found nothing; the finding that mattered was three surfaces shipping one bug because its regression test was named after a page. Includes measured contrast and Thai typography tables, and the audit's own corrections |
| [KNOWN_ISSUES](./docs/KNOWN_ISSUES.md) | Tracked risks & gotchas |
| [pre-release/](./docs/pre-release/00_REMEDIATION_LOG.md) | **Four-pass pre-release audit (2026-08-02)** — onboarding · MCP & multi-tenancy security · worker/DB reliability · deployment & i18n. Zero CRITICAL findings; the reports keep their full working, including two in-place corrections where remediation proved a finding overstated |
| [REBUILD](./REBUILD/00-START-HERE.md) | **Rebuild from scratch** — 6-phase vibe-coding guide for porting to a new machine |

Diagrams (Mermaid sources + rendered PNGs) live in
[`docs/assets/illustrations/`](./docs/assets/illustrations/).

---

## Contributing to External Brain

Contributions and forks are welcome. Fork the repo, branch from `main`
(`feature/<slug>`, `bugfix/<slug>`, `docs/<slug>`), and open a PR — see
[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md)
(the guide for AI assistants working in this repo). Be kind — we follow a
[Code of Conduct](./CODE_OF_CONDUCT.md).

Every PR runs three required checks — **typecheck · test · build** (which
includes the fresh-DB migration gate, the day-zero deploy path), an
**anonymous e2e** gate, and a **signed-in e2e** gate (both path-scoped: they
no-op green when a PR doesn't touch their surfaces). A daily **prod-drift
watchdog** flags when `main` is ahead of the deployment. How CI and the two
deploy scripts fit together is one short page:
**[docs/CICD.md](./docs/CICD.md)**.

## Frequently Asked Questions

<details>
<summary><strong>What is an MCP server and why does External Brain use one?</strong></summary>

The **Model Context Protocol (MCP)** is an open standard that lets AI coding
tools (Claude Code, Cursor, Windsurf, GitHub Copilot, etc.) connect to external
services via a structured API. External Brain runs as an MCP server so any
MCP-compatible AI tool can read and write knowledge without custom integration
work — one server, every client.
</details>

<details>
<summary><strong>Which AI coding tools does External Brain work with?</strong></summary>

Any tool that supports the Model Context Protocol: **Claude Code**, **Cursor**,
**Windsurf**, **GitHub Copilot** (VS Code, JetBrains, CLI), **Google
Antigravity** (which folded in Gemini CLI as of 2026-05-19 — enterprise Gemini
CLI access continues separately), and any other MCP-capable agent. See
[docs/CLIENTS.md](./docs/CLIENTS.md) for wiring instructions.
</details>

<details>
<summary><strong>How do I self-host External Brain?</strong></summary>

You need Docker Engine 24+ and one LLM provider API key (Google Gemini's free
tier works). Clone the repo, copy `.env.example` to `.env`, add your key, and
run `./scripts/dev-up.sh`. Full walkthrough:
[docs/QUICKSTART.md](./docs/QUICKSTART.md).
</details>

<details>
<summary><strong>What does it cost?</strong></summary>

**Nothing to us — there is no payment in this phase.** External Brain is MIT
licensed and freemium with no payment required: no checkout, no card, no paywall
that blocks you. Tiers, usage tracking and quotas exist as product features (and
the limits that are documented are meant to be enforced), but nobody is charged.

What you *do* pay for is your own infrastructure and your own LLM usage — you
bring your own provider key, so those tokens are billed to you by that provider,
not by us. Google Gemini's free tier is enough to run an instance.

Two knobs bound that spend, and one of them is honest about not working yet:
`MAX_ORACLE_COST_USD_PER_DAY` is **enforced** (atomic per user/day);
`MAX_KEA_COST_USD_PER_SESSION` is **not yet enforced** and is labelled as such
in `.env.example` — tracked in
[KNOWN_ISSUES §0q](./docs/KNOWN_ISSUES.md). Model and rationale:
[docs/BLUEPRINT.md §11.1](./docs/BLUEPRINT.md).
</details>

<details>
<summary><strong>What LLM providers are supported?</strong></summary>

External Brain is provider-agnostic. It supports **Google Gemini**, **Anthropic
Claude**, **OpenAI**, **GLM (Z.ai)**, and any OpenAI-compatible endpoint for
embeddings. Swap providers by changing environment variables — no code changes.
</details>

<details>
<summary><strong>Is my data private? Where is knowledge stored?</strong></summary>

Yes — External Brain is fully self-hosted. All knowledge, sessions, and
embeddings live in **your own Postgres + pgvector** database on your
infrastructure. Nothing is sent to third parties beyond the LLM API calls you
configure. See [docs/SECURITY.md](./docs/SECURITY.md).
</details>

<details>
<summary><strong>Why not just use the memory built into Claude Code or Cursor?</strong></summary>

Those built-in memories are **siloed three ways: per tool, per project, and per
person**. Claude Code's memory doesn't carry over to Cursor or Copilot, a lesson
learned on one repo doesn't reach the next, and each teammate starts from zero.
They're also a **black box** you can't browse or correct, and they live in
someone else's cloud. External Brain is **one shared, inspectable, self-hosted
knowledge layer across every MCP tool, project, and team**: browse and edit it in
the Skills view, get grounded Oracle answers cited to your real sessions, and own
it in your own Postgres. With user / project / team / org scopes it's built for
enterprise knowledge reuse. Use it *alongside* your tools' built-in memory, not
instead of them.
</details>

<details>
<summary><strong>Does knowledge carry across projects and teammates?</strong></summary>

Yes — that's the point. Built-in memory is stuck on one machine for one person on
one project. External Brain has **user / project / team / org scopes**: a rule
learned on one repo can apply to the next, and **team/org-scoped knowledge and
decisions are shared across everyone on the team** — a teammate's next session
surfaces them automatically. It's designed for **enterprise knowledge reuse**, so
the lessons one engineer learns become the team's, not a silo's. (Scope
boundaries are strict and owner-checked; see [docs/KNOWLEDGE.md](./docs/KNOWLEDGE.md).)
</details>

<details>
<summary><strong>Does External Brain improve on its own?</strong></summary>

Yes. After every session, **autoskill** scans what happened, proposes new skills
it notices you reusing, and reinforces the rules that pay off while letting unused
ones decay. You review proposals with one click (or auto-accept the high-confidence
ones). Each project gets sharper day by day without you stopping to hand-write a
rules file, and a new project never starts from zero. Approval is required by
default, so nothing changes your skills without you.
</details>

<details>
<summary><strong>How is External Brain different from RAG or a vector database?</strong></summary>

RAG retrieves static documents. External Brain **actively extracts, scores, and
evolves knowledge** from your coding sessions — skills decay if unused, improve
if applied successfully, and compound across teammates. It's a living knowledge
base, not a document index.
</details>

---

## License

[MIT](./LICENSE) © External Brain contributors. Fork it, run it, build on it.
