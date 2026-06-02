# Build Roadmap

*Derived from `research/knowledge/13-build-roadmap.md` + `16-path-b-sufficiency-notes.md`.*

## Phase 0 — Foundation (weeks 1-4) — COMPLETE

- [x] Monorepo bootstrap (Turborepo + pnpm).
- [x] Postgres 16 + `CREATE EXTENSION vector` wired via `@brain/db`.
- [x] First migration from `packages/db/prisma/schema.prisma`.
- [x] GUI-to-backend wiring pass — all six surfaces (Dashboard, Oracle, Skills, Graph, Autoskill, Sessions) wired to live REST endpoints; 40+ orphan elements resolved across nine build waves (see `APPROACH.md §5b` and `WIRING.md`).
- [x] NextAuth v5 (GitHub OAuth, JWT strategy, dual-mode with dev shim).
- [x] Acceptance: `pnpm turbo run dev` brings up webapp, MCP server (stdio), worker; a seeded Knowledge row retrievable via pgvector.
- [x] Dockerized deploy — `./scripts/deploy.sh` on a fresh VM brings up db + web + mcp-server + worker.

## Phase 1 — Core Brain (weeks 5-12)

- [ ] KEA end-to-end with Qwen3-Coder (cheap) and Claude Haiku 4.5 (fallback).
- [ ] KRA with the multi-factor formula + diversification.
- [ ] Outcome feedback loop in `brain_report_session_outcome`.
- [ ] SQS computation + `/api/admin/brain-health` dashboard.
- [x] Evolution jobs scheduled in worker (decay, consolidate, obsolescence, health-snapshot).
- [x] Embedding backfill job (one-shot + pg-boss 10-min schedule).
- [x] Knowledge immutability guard (`PATCH` rejects semantic-core edits; fork-on-edit in UI).
- [x] Rate limiting on `/api/*` via Next.js proxy.
- [x] Oracle streaming (SSE).
- [ ] **Gate 1**: simulate 100 sessions via test harness; SQS trends up; retrieval NDCG@5 > 0.5 on a labeled benchmark. If not, **stop and investigate** before Phase 2.

## Phase 2 — MCP + Webapp (weeks 13-18)

- [x] Ship all 8 MCP tools + 4 resources.
- [x] MCP HTTP transport (Streamable HTTP, stateless per-request) alongside stdio.
- [x] Session FTS (Postgres `to_tsvector`/`websearch_to_tsquery` + GIN indexes, ILIKE fallback).
- [x] Rules exporter (`@brain/core/exporter` + `/api/export/rules` + Skills UI download).
- [x] Webapp: dashboard, Oracle chat (streamed SSE), skills browser, MCP-token settings (`/settings/tokens`).
- [ ] Integration test: run Claude Code + this MCP server + real coding session × 5.
- [ ] **Gate 2**: beta user plugs into Claude Code, 5 real sessions, Brain populates, Oracle answers sensible questions with citations.

## Phase 3 — Teams + Community (weeks 19-28)

- [ ] Team vaults + RBAC + SSO.
- [ ] Promotion flow: personal → team → community.
- [ ] Community pool with moderation (automated + human).
- [ ] Graph view (Obsidian-style).
- [ ] Skill export in 5 formats (Claude Code, Cursor, Windsurf, Codex, markdown).
- [ ] **Gate 3**: 30 % of active users import at least one community skill.

## Phase 4 — Advanced (weeks 29+)

Prioritize by actual user signal; do not pre-commit.

- Autoskill UI with approval queue.
- Internal-wisdom skill authoring (`kind: internal`).
- Proactive Oracle (push suggestions instead of waiting to be asked).
- LiveSync bridge to Obsidian vaults via CouchDB.
- Native SDKs (JS ✓, Python, Go).
- Enterprise: VPC deploy, on-prem models, SSO.

## Phase 6 — Brain Gateway (bet, not commitment)

**Idea (noted 2026-04-23):** Ship an Anthropic/OpenAI-compatible proxy endpoint. Users point Claude Code / Cursor / custom agents at `ANTHROPIC_BASE_URL=https://brain.tld/proxy` with a Brain-issued token; we forward to GLM / Qwen / upstream and capture every byte of traffic for KEA. Zero-config knowledge capture; no MCP wiring required.

**Why wait:** this is a product-shaped version of the substrate thesis, but the engineering + trust + compliance investment is ≥ 10× anything we've shipped. Streaming correctness is brutal (SSE ordering, tool_use ids, stop_reason fidelity); ToS questions are real (reselling Anthropic/Z.ai traffic); retention + GDPR for captured code paste is load-bearing from day one. None of it pays off if KEA isn't already good — which we have NOT yet proven at scale.

**Cheaper first step — local proxy CLI.** Ship a `brain-proxy` binary the user runs on their own machine between Claude Code and the upstream. Captures traffic locally, streams it to BrainPlatform via the existing MCP HTTP endpoint. Keys stay with the user; traffic stays on the box. We get the richer capture signal without the hosted-proxy trust surface. Helicone started here. If local-proxy KEA shows clear quality gains over MCP-event KEA, hosted proxy becomes a natural follow-up with a proven value story.

**Gate before building:** Phase 5 validation (below) must show KEA extraction + KRA retrieval produce Knowledge that measurably improves AI coding output. Without that, the gateway is expensive infrastructure without a flywheel.

## Phase 5 — Validate the core value (next)

Before any new surface or integration, prove the product thesis: **does the Brain actually make AI coding better?**

Three measurements, from cheapest to most expensive:

1. ✅ **Retrieval quality on a labelled benchmark.** Shipped 2026-04-23 as `packages/core/scripts/retrieval-benchmark.ts`. Current reading on the 20-query fixture: KRA NDCG@5 = **1.000**, Recall@10 = 1.000, MRR = 1.000 — matches cosine-only after the weight re-tune. Well above the Phase-1 red-flag (0.4) and exit gate (0.5). **Caveat:** fixture is author-written, so these numbers are a floor test; see `docs/VALIDATION.md §"Honest bias audit"`.
2. 🟡 **Oracle answer correctness with/without injection.** Harness shipped 2026-04-23. **First real run completed 2026-04-24** (40 calls, ~41K tokens, <$0.10 on Z.ai GLM 5.1; artifact at `benchmarks/uplift-first-run.jsonl`). Qualitative signal unambiguous — with-Brain cites user rules; without-Brain refuses to invent. **Still blocks the full claim** until a human blind-scores the 20 pairs on the 0-3 rubric. ~1 hour of rater time.
3. ⏳ **End-to-end SQS trend from real coding sessions.** Requires beta users and ≥ 4 weeks of telemetry. Downstream of #2 passing; no point instrumenting SQS on an unproven flywheel.

Deliverables shipped: `retrieval-benchmark.ts`, `generation-uplift.ts`, `docs/VALIDATION.md`, and the CI benchmark-doc coherence gate that refuses PRs which edit retrieval code without updating the validation numbers. Must be re-runnable after any KRA / KEA change.

## Deferred items (not blocked, just explicit)

These were scoped out of the Phase 0 wiring pass. Each needs a dedicated decision or migration step before implementation.

| Item | Why deferred | Unblocks |
|---|---|---|
| ~~NextAuth v5 — replace dev auth shim~~ | Landed 2026-04-21 in Phase T (dual-mode: GitHub OAuth + dev fallback) | done |
| Tweaks server-side sync (`UserPreference` model) | Needs a new Prisma model + DB migration against the shared DB; requires explicit approval before running | Language/theme/accent/density persisted per user |
| SSE / WebSocket for LiveExtraction | Current 15-second poll is adequate for Phase 0; real-time push adds infra complexity | Sub-second extraction status in Sessions surface |
| ~~Embedding backfill job for Teach-modal Knowledge~~ | Landed 2026-04-21 — worker `embeddings.backfill` runs every 10 min and picks up any null-embedding row. | done |

## Red flags (stop and diagnose)

- SQS doesn't trend up after 4 weeks of real usage.
- KEA produces > 30 % noise rate on human spot-check.
- Retrieval NDCG@5 < 0.4 after embeddings added.
- New feature breaks an existing client integration (zero-regression rule).

## Team sizing

3-4 engineers:
- 1 × backend lead (Intelligence Layer + MCP server)
- 1 × full-stack (webapp + REST API)
- 1 × infra/data (Postgres, pgvector, observability, CI/CD)
- +1 × ML/prompt engineer (KEA, KRA, Oracle tuning)

Plus: PM (product decisions from `BLUEPRINT.md §14`), designer (post-MVP), ops contact.
