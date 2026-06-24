# External Brain — Self-Hosted MCP Server for Persistent AI Coding Memory

> **Stop re-teaching your AI the same lessons.** External Brain is an open-source
> **MCP server** that captures what you learn in every AI coding session —
> across **Claude Code, Cursor, Windsurf, GitHub Copilot, Google Antigravity**,
> and any MCP client — extracts it into reusable **skills and rules**, and
> serves it back automatically the next time you code.

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
webapp** that gives AI coding agents persistent, long-term memory. It ingests
your coding sessions, **extracts durable knowledge** (skills, rules, recipes,
anti-patterns), **retrieves it by semantic meaning** when you start a new task,
and answers questions about your own codebase through a grounded **Oracle** —
every answer cited back to the sessions and skills that support it.

Provider-agnostic (Google Gemini, GLM, OpenAI, Anthropic Claude), runs on a
single VM with Docker Compose, and **MIT-licensed** — fork it and build your
own.

![Architecture diagram showing how External Brain connects AI coding tools like Claude Code and Cursor via MCP to a Postgres + pgvector knowledge store](./docs/assets/illustrations/ai_application.png)

---

## Why Use External Brain? — The Problem with Stateless AI Coding

AI coding tools are stateless. Every new chat, every new repo, every teammate
starts from zero — the hard-won context ("we use Zod not Yup", "the deploy
breaks if you skip the migration step", "this service owns auth") evaporates
when the session ends. You re-explain. The AI re-disovers. The team re-learns.

External Brain is the missing **memory layer for AI coding agents**.

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
- 📈 **Self-improving knowledge base** — a daily pipeline synthesizes
  cross-session knowledge; low-value skills decay; useful ones surface. The
  brain gets sharper the more you use it.
- 🏠 **Self-hosted & private** — your knowledge stays in your Postgres, on your
  infrastructure. Secure-by-default auth, Bearer-gated MCP.
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

### Connect your AI tool

After signing in, the **`/welcome`** flow walks you through it: pick your tool,
copy a one-line installer, run any task. For Claude Code:

```bash
curl -fsSL https://<your-host>/api/onboard.sh | bash -s 'bp_<your-token>'
```

The installer wires the MCP server, smoke-tests the round-trip, and seeds your
first session so the brain starts learning from day zero. Manual wiring for
Cursor / Windsurf / Antigravity / GitHub Copilot / any MCP client:
[docs/CLIENTS.md](./docs/CLIENTS.md).

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

## Documentation & Guides

| Doc | What it covers |
|---|---|
| [EVIDENCE](./docs/EVIDENCE.md) | **Does it actually help?** — the capture→retrieve loop demonstrated on a real instance |
| [QUICKSTART](./docs/QUICKSTART.md) | Zero to a running instance |
| [HOW_IT_WORKS](./docs/HOW_IT_WORKS.md) | End-to-end mental model with examples |
| [ARCHITECTURE](./docs/ARCHITECTURE.md) | System design, layers, data flow |
| [MCP_TOOLS](./docs/MCP_TOOLS.md) | The `brain_*` MCP tools + resources |
| [REST_API](./docs/REST_API.md) | HTTP endpoints |
| [CLIENTS](./docs/CLIENTS.md) | Wiring Claude Code / Cursor / Windsurf / Antigravity / GitHub Copilot |
| [USING_BRAIN](./docs/USING_BRAIN.md) | Daily workflow, trigger phrases, recipes |
| [KNOWLEDGE](./docs/KNOWLEDGE.md) | The knowledge model (normative) |
| [SECURITY](./docs/SECURITY.md) | Auth modes, MCP gating, threat model |
| [DEPLOY_CHECKLIST](./docs/DEPLOY_CHECKLIST.md) | Production deploy on a public VM |
| [CICD](./docs/CICD.md) | CI checks + the two deploy scripts, for forkers |
| [CONTRIBUTING](./docs/CONTRIBUTING.md) · [GUIDELINES](./docs/GUIDELINES.md) | How to contribute, code style |
| [DESIGN_PRINCIPLES](./docs/DESIGN_PRINCIPLES.md) | UI philosophy (progressive disclosure) |
| [KNOWN_ISSUES](./docs/KNOWN_ISSUES.md) | Tracked risks & gotchas |
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
Antigravity**, **Gemini CLI**, and any other MCP-capable agent. See
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
<summary><strong>How is External Brain different from RAG or a vector database?</strong></summary>

RAG retrieves static documents. External Brain **actively extracts, scores, and
evolved knowledge** from your coding sessions — skills decay if unused, improve
if applied successfully, and compound across teammates. It's a living knowledge
base, not a document index.
</details>

---

## License

[MIT](./LICENSE) © External Brain contributors. Fork it, run it, build on it.
