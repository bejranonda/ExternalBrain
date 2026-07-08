# Docs Index

All platform documentation. Start with `BLUEPRINT.md`; everything else deepens a specific axis.

## Core

| Doc | What it covers |
|---|---|
| [BLUEPRINT.md](./BLUEPRINT.md) | Master blueprint: thesis, architecture, reference-system adaptations, business model, open decisions |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 3-layer / 8-subsystem diagram + data flow |
| [APPROACH.md](./APPROACH.md) | Philosophy, method, decision framework |

## Normative

| Doc | What it covers |
|---|---|
| [KNOWLEDGE.md](./KNOWLEDGE.md) | Knowledge representation, ontology, lifecycle, invariants (normative) |
| [GUIDELINES.md](./GUIDELINES.md) | Code style, package boundaries, testing, security, PR process |
| [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | Scaffolding gaps, structural risks, stop-conditions, open design questions |

## Illustrations

Visual diagrams live in [`assets/illustrations/`](./assets/illustrations/). Each has a Mermaid `.md` source and a rendered `.png`.

| Diagram | Audience | What it shows |
|---|---|---|
| [User Flow](./assets/illustrations/user_flow.png) | Users | AI tool → MCP → Brain → Skills & Rules |
| [Architecture](./assets/illustrations/architecture.png) | Developers | 3-layer block diagram (Frontend, Core, Data) |
| [AI Application](./assets/illustrations/ai_application.png) | Both | Where LLMs and embeddings are used (KEA, KRA, Oracle, Autoskill) |
| [Process Logic](./assets/illustrations/process_logic.png) | Developers | End-to-end session sequence: retrieve → log → report → extract → evolve |

## Surfaces & contracts

| Doc | What it covers |
|---|---|
| [MCP_TOOLS.md](./MCP_TOOLS.md) | The `brain_*` MCP tools + resources, with typical client flow |
| [protocols/](./protocols/meeting-miner.md) | Agent protocols (V2.0): meeting-miner · doc-harvest · doc-draft · report-draft |
| [REST_API.md](./REST_API.md) | REST endpoints for webapp + integrators |
| [NAVIGATION.md](./NAVIGATION.md) | Webapp navigation surfaces + zero-error iteration process |
| [WIRING.md](./WIRING.md) | How a GUI surface connects to the backend (4-file contract, view types, mock fallback) |
| [SYNC.md](./SYNC.md) | Optional LiveSync bridge for Obsidian vaults |

## Operator guides (daily workflow)

| Doc | What it covers |
|---|---|
| [QUICKSTART.md](./QUICKSTART.md) | Zero to a running stack in 15 minutes (local install) |
| [CLIENTS.md](./CLIENTS.md) | Per-tool wiring snippets — Claude Code / Cursor / Windsurf / Claude Desktop |
| [USING_BRAIN.md](./USING_BRAIN.md) | **Daily workflow** — install one-liners, `claude mcp list` verification, trigger-phrase map, narrated session, debug recipes, operator habits that compound |
| [HOW_IT_WORKS.md](./HOW_IT_WORKS.md) | End-to-end mental model: sign-up → token → first session → KEA → KRA → Oracle |
| [END_USER.md](./END_USER.md) | If your team set up a Brain — sign in, wire your editor, ask the Oracle |
| [tutorials/](./tutorials/README.md) | **Step-by-step tutorials** — getting started, asking the Oracle, teaching knowledge, token scope, exporting rules, troubleshooting |

## Usecases & roadmap

| Doc | What it covers |
|---|---|
| [USECASES.md](./USECASES.md) | Knowledge→code-quality + autoskill scenarios |
| [ROADMAP.md](./ROADMAP.md) | Phase 0→4 plan with gates; Phase 0 wiring complete; deferred items listed |

## Research body (not in this folder)

The 7,900-line prior-art body lives at `../research/knowledge/`. Start with `../research/knowledge/README.md`. Reference-system folders: `../research/{hermes,honcho,obsidian,livesync,autoskill}/`. Each reference folder pairs a captured `spec.md` (or `architecture.md` + `platform_blueprint.md`) with an `integration_notes.md` describing what we adopt and where we diverge.

## Reading orders

**To build today (engineer):** BLUEPRINT → ARCHITECTURE → MCP_TOOLS → KNOWLEDGE → GUIDELINES → ROADMAP.

**To understand the product (PM / stakeholder):** BLUEPRINT → USECASES → BUSINESS → APPROACH → KNOWN_ISSUES.

**To contribute code (new dev):** APPROACH → GUIDELINES → KNOWLEDGE → then the relevant package README.

**To use the Brain day-to-day (operator on a team that already has one):** END_USER → tutorials/ (start at `01-getting-started.md`) → CLIENTS → USING_BRAIN → MCP_TOOLS (when curious).

**To evaluate whether to build it (decision-maker):** BLUEPRINT → KNOWN_ISSUES → BUSINESS → ROADMAP.
