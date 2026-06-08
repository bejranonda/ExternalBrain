# External Brain — persistent memory for AI coding agents

> **Stop re-teaching your AI the same things.** External Brain captures what you
> learn in every AI coding session — across Claude Code, Cursor, Windsurf, and
> any MCP client — turns it into reusable skills, and serves it back
> automatically the next time you code.

<p>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg">
  <img alt="MCP" src="https://img.shields.io/badge/Model_Context_Protocol-native-6E56CF.svg">
  <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-Docker_Compose-2496ED.svg">
  <a href="./docs/CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"></a>
</p>

**External Brain** is a self-hostable **MCP (Model Context Protocol) server +
webapp** that gives your AI coding tools a long-term memory. It ingests your
coding sessions, **extracts durable knowledge** (skills, rules, recipes,
anti-patterns), **retrieves it by meaning** when you start a new task, and
answers questions about your own codebase through a grounded **Oracle** — every
answer cited back to the sessions and skills that support it.

Provider-agnostic (Gemini, GLM, OpenAI, Claude), runs on a single VM, and
**MIT-licensed** — fork it and build your own.

![How External Brain works](./docs/assets/illustrations/ai_application.png)

---

## Why External Brain?

AI coding tools are stateless. Every new chat, every new repo, every teammate
starts from zero — the hard-won context ("we use Zod not Yup", "the deploy
breaks if you skip the migration step", "this service owns auth") evaporates
when the session ends. You re-explain. The AI re-discovers. The team re-learns.

External Brain is the missing **memory substrate**:

- 🧠 **Captures knowledge automatically** — finished sessions are mined for
  durable, reusable lessons. No manual note-taking.
- 🔌 **Works with every AI tool** — it's an MCP server, so Claude Code, Cursor,
  Windsurf, and any MCP-capable agent are first-class clients.
- 🔎 **Semantic retrieval** — relevant skills are injected into context *before*
  the model generates, by meaning, not keyword match.
- 💬 **Grounded Oracle** — ask "how did we fix the deploy bug?" in plain English
  and get an answer with citations to the real sessions and skills.
- 📈 **Compounds over time** — a daily pipeline synthesizes cross-session
  knowledge; low-value skills decay; useful ones surface. The brain gets sharper
  the more you use it.
- 🏠 **Self-hosted & private** — your knowledge stays in your Postgres, on your
  infrastructure. Secure-by-default auth, Bearer-gated MCP.
- 🪶 **Quiet by default** — a clean dashboard that opens into depth only when you
  ask. Progressive disclosure, not a wall of dials.

> **What it is *not*:** another AI coding tool. External Brain doesn't write
> code — it's the substrate that makes whatever tool you already use smarter
> over time.

---

## Quickstart — run your own in minutes

Requires Docker Engine 24+ and one LLM provider key (Google Gemini has a free
tier and is the easiest start). Full guide: **[docs/QUICKSTART.md](./docs/QUICKSTART.md)**.

```bash
git clone https://github.com/bejranonda/ExternalBrain.git external-brain
cd external-brain

cp .env.example .env          # add one provider key (e.g. GOOGLE_GEMINI_API_KEY)
./scripts/dev-up.sh           # build · migrate · seed · start — idempotent

# Webapp:  http://localhost:3000
# MCP HTTP: http://localhost:3100/mcp
```

`dev-up.sh` runs an auth-posture audit at the end and prints PASS/FAIL. For a
public-internet **server** deployment (Caddy + auto-TLS, real auth enforced,
nightly backups), use `./scripts/deploy.sh` instead — see
[docs/DEPLOY_CHECKLIST.md](./docs/DEPLOY_CHECKLIST.md).

### Connect your AI tool

After signing in, the **`/welcome`** flow walks you through it: pick your tool,
copy a one-line installer, run any task. For Claude Code:

```bash
curl -fsSL https://<your-host>/api/onboard.sh | bash -s 'bp_<your-token>'
```

The installer wires the MCP server, smoke-tests the round-trip, and seeds your
first session so the brain starts learning from day zero. Manual wiring for
Cursor / Windsurf / any MCP client: [docs/CLIENTS.md](./docs/CLIENTS.md).

---

## How it works

```
  AI coding tool ──MCP──▶  External Brain  ──▶  Postgres + pgvector
   (Claude Code,            ├─ retrieve relevant skills (before you code)
    Cursor, …)              ├─ log the session + outcome (after you code)
                            ├─ extract durable knowledge (background worker)
                            └─ answer questions via the Oracle (cited)
```

1. **Before a task**, your tool calls `brain_retrieve_knowledge` and relevant
   past skills are injected into context.
2. **After a task**, the session + outcome are reported and queued for
   extraction.
3. **A background worker** mines sessions into typed skills, embeds them for
   semantic search, and decays the stale ones.
4. **Anytime**, ask the **Oracle** in plain language and get grounded, cited
   answers from your own knowledge.

Full walkthrough with examples: **[docs/HOW_IT_WORKS.md](./docs/HOW_IT_WORKS.md)**.

---

## Tech stack

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

## Repo layout

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
```

---

## Documentation

| Doc | What it covers |
|---|---|
| [EVIDENCE](./docs/EVIDENCE.md) | **Does it actually help?** — the capture→retrieve loop demonstrated on a real instance |
| [QUICKSTART](./docs/QUICKSTART.md) | Zero to a running instance |
| [HOW_IT_WORKS](./docs/HOW_IT_WORKS.md) | End-to-end mental model with examples |
| [ARCHITECTURE](./docs/ARCHITECTURE.md) | System design, layers, data flow |
| [MCP_TOOLS](./docs/MCP_TOOLS.md) | The `brain_*` MCP tools + resources |
| [REST_API](./docs/REST_API.md) | HTTP endpoints |
| [CLIENTS](./docs/CLIENTS.md) | Wiring Claude Code / Cursor / Windsurf |
| [USING_BRAIN](./docs/USING_BRAIN.md) | Daily workflow, trigger phrases, recipes |
| [KNOWLEDGE](./docs/KNOWLEDGE.md) | The knowledge model (normative) |
| [SECURITY](./docs/SECURITY.md) | Auth modes, MCP gating, threat model |
| [DEPLOY_CHECKLIST](./docs/DEPLOY_CHECKLIST.md) | Production deploy on a public VM |
| [CICD](./docs/CICD.md) | CI checks + the two deploy scripts, for forkers |
| [CONTRIBUTING](./docs/CONTRIBUTING.md) · [GUIDELINES](./docs/GUIDELINES.md) | How to contribute, code style |
| [DESIGN_PRINCIPLES](./docs/DESIGN_PRINCIPLES.md) | UI philosophy (progressive disclosure) |
| [KNOWN_ISSUES](./docs/KNOWN_ISSUES.md) | Tracked risks & gotchas |

Diagrams (Mermaid sources + rendered PNGs) live in
[`docs/assets/illustrations/`](./docs/assets/illustrations/).

---

## Contributing

Contributions and forks are welcome. Fork the repo, branch from `main`
(`feature/<slug>`, `bugfix/<slug>`, `docs/<slug>`), and open a PR — see
[docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md)
(the guide for AI assistants working in this repo). Be kind — we follow a
[Code of Conduct](./CODE_OF_CONDUCT.md).

Every PR runs three required checks: **typecheck · test · build**, a
**fresh-DB migration** (the day-zero deploy path), and — when an onboarding/
unauth surface changes — an **anonymous e2e** gate. How CI and the two deploy
scripts fit together is one short page: **[docs/CICD.md](./docs/CICD.md)**.

## License

[MIT](./LICENSE) © External Brain contributors. Fork it, run it, build on it.
