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

- [x] KEA end-to-end. The model is a configurable route rather than the fixed
      pair planned here (`KEA_MODEL`, `packages/core/src/kea.ts`): `glm-4.5`,
      `glm-4.5-air` (current default), `glm-4.5-flash`, `qwen3-coder`, and
      `claude-haiku-4-5` all dispatch, so both models named above are reachable
      by config.
- [x] KRA with the multi-factor formula + diversification — five weighted
      factors (semantic similarity, success rate, recency decay, context fit,
      confidence) in `packages/core/src/kra.ts`'s `WEIGHTS`, followed by
      `diversify()`. Weights were re-tuned against the benchmark fixture; see
      `docs/VALIDATION.md`.
- [x] Outcome feedback loop in `brain_report_session_outcome` (confidence
      updates + `learnings` capture at close).
- [x] SQS computation (`packages/core/src/evaluation.ts`, surfaced per-session
      via `/api/sessions/[id]` and on the dashboard).
- [ ] Brain-health dashboard **as specced here** (`/api/admin/brain-health`)
      was never built. What exists instead is `/api/dashboard/health` +
      `loop-health-card.tsx` — the flywheel-repair loop-health panel (capture,
      injection→used, corpus validation, duplicate projects), which answers the
      "is the loop alive" question this row was for. Close this row or rescope
      it; do not build a second panel by mistake.
- [x] Evolution jobs scheduled in worker (decay, consolidate, obsolescence, health-snapshot).
- [x] Embedding backfill job (one-shot + pg-boss 10-min schedule).
- [x] Knowledge immutability guard (`PATCH` rejects semantic-core edits; fork-on-edit in UI).
- [x] Rate limiting on `/api/*` via Next.js proxy.
- [x] Oracle streaming (SSE).
- [ ] **Gate 1** — retrieval clause **met**; the other two not run.

      *Restated 2026-08-01.* This row used to demand an absolute NDCG@5 > 0.5,
      and a previous pass flagged that as needing an operator decision. It
      didn't: the project had **already decided**, on 2026-07-06, that "the
      regression bar is the delta vs the cosine baseline on the current
      fixture, not an absolute score" — absolutes are fixture-dependent (the
      retired seed fixture had cosine at 1.0). That decision is written into
      `GUIDELINES §3` invariant 12 and `docs/VALIDATION.md`; it had simply
      never been propagated here. Same shape as
      [#174](https://github.com/bejranonda/ExternalBrain/issues/174): decided
      once, applied in some places, left stale in others.

      **Retrieval, under the project's own bar: PASS.** KRA beats the raw-cosine
      baseline on the real-corpus fixture at both depths measured — +0.1478 at
      candidate-pool 20 (0.4514 vs 0.3036) and **+0.0758 at pool 50** (0.3075 vs
      0.2317), the depth production runs since
      [#146](https://github.com/bejranonda/ExternalBrain/issues/146). Absolutes
      fall as the pool deepens because harder negatives enter; that is expected,
      and is exactly why the bar is the delta. Re-run and re-record on any
      `WEIGHTS` or `CANDIDATE_POOL_SIZE` change — now enforced by the
      `benchmark-coherence` CI check rather than by discipline.

      **Not run:** no 100-session simulation harness exists, and the SQS trend
      needs real telemetry over time rather than a synthetic burst. Phase 2
      shipped regardless — recorded as a knowingly-taken risk, not a passed
      gate.

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

1. ✅ **Retrieval quality on a labelled benchmark.** Shipped 2026-04-23; the scorer lives in `packages/core/src/retrieval-benchmark.ts`, driven by `packages/core/scripts/run-retrieval-benchmark.ts` (fixtures exported by `export-retrieval-fixture.ts`). Two readings, and the difference between them is the point: on the **author-written** 20-query fixture KRA NDCG@5 = **1.000** (Recall@10 = 1.000, MRR = 1.000) — a floor test, not evidence, per `docs/VALIDATION.md §"Honest bias audit"`. On the **real-corpus** fixture: **0.4514** at candidate-pool 20 and **0.3075** at pool 50 (production's depth since #146), each beating the cosine baseline by a positive delta (+0.1478 / +0.0758). Absolutes fall as the pool deepens; the delta is the claim. See Gate 1 above for why this can't be read against an absolute threshold.
2. ✅ **Generation uplift with/without injection.** Superseded the 2026-04-24 Oracle-rubric attempt, which stalled because it needed ~1 hour of human blind-scoring that never happened. Issue #126 replaced the rubric with **executable tests** (pass/fail, no rater): pre-registered task suite in `packages/core/generation-uplift/README.md`, results in `RESULTS.md` — control 4/6, treatment 6/6, **+33.3pp, 0 regressions** (2026-07-23). Small-n and corpus-independent by design; see `docs/VALIDATION.md` for the caveats and the next step (a larger and/or production-fixture-based re-run).
3. ⏳ **End-to-end SQS trend from real coding sessions.** Requires beta users and ≥ 4 weeks of telemetry. Downstream of #2 passing; no point instrumenting SQS on an unproven flywheel.

Deliverables shipped: `packages/core/src/retrieval-benchmark.ts` (+ the `scripts/run-retrieval-benchmark.ts` / `export-retrieval-fixture.ts` pair), `packages/core/generation-uplift/` (pre-registration, task suite, grading harness, results), and `docs/VALIDATION.md`. Must be re-runnable after any KRA / KEA change.

**The CI benchmark-doc coherence gate now exists (2026-08-01).** It was listed
among shipped deliverables from 2026-07 while no such workflow existed — found
and recorded as a gap on 2026-07-28, built now. `benchmark-coherence` in
`.github/workflows/ci.yml` runs `scripts/check-benchmark-coherence.sh` on every
PR: it compares the *values* of `kra.ts`'s `WEIGHTS` and `CANDIDATE_POOL_SIZE`
either side of the merge base, and fails if they changed without
`docs/VALIDATION.md` changing too. Deliberately value-based rather than
file-based — a file-level check would fire on any unrelated edit to `kra.ts`
(the #174 scope work changed that file without touching a weight), and a gate
that cries wolf gets switched off. Verified against real history: silent across
v2.4.0→v2.5.0 (kra.ts edited, weights untouched), fires across v2.2.0→v2.3.0
(the pool 20→50 widening).

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
