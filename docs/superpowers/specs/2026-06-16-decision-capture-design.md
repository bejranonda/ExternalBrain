# Decision capture → shared project memory (Phase 1)

**Date:** 2026-06-16 · **Status:** approved (design review 2026-06-16)
**Problem:** the most shareable, most durable, least privacy-fraught knowledge a
project produces is its **decisions and status changes** ("we chose Postgres over
Mongo for pgvector", "the v1 API is deprecated", "auth is owned by billing"). A
decision carries no pasted secrets, never goes stale silently, and is exactly
what a *teammate's* `inject-at-open` should surface. Yet today it only reaches the
brain if it happens to fall out of a session close as an agent-paraphrased
`learning`, stored at **personal** scope. Decisions made in planning, review, or
chat — the majority — never land, and the ones that do don't reach anyone else.

This is the keystone wedge of a larger program (elicit-from-human + richer
provenance + cross-user sharing fused into one feature). It turns the Brain from
"my personal reflexes" into "our project's institutional memory."

## Core idea

A **decision is a first-class, user-stated, project-scoped `Knowledge` row** —
not a new knowledge type (GUIDELINES §10 / APPROACH §4.1: "new type? almost
certainly no — use tags/scope"). It is captured through the **same frictionless
elicitation mechanism that lifted close-capture from ~17%** (tool-description +
house-rule nudge, zero human friction), consumed through the **already-shipped**
inject-at-open and Oracle read paths, and — the one genuinely new model rule —
**exempt from effectiveness-decay**, retired only by explicit supersession.

Fully backward-compatible: nothing about existing reflex/recipe/heuristic capture
or retrieval changes. A decision is a `Knowledge` row that happens to carry a
`decision` tag and obeys two extra invariants (no-decay, supersede-to-retire).

## What a decision row is

| Field | Value | Notes |
|---|---|---|
| `type` | `principle` \| `anti_principle` | a settled truth, or a "stop doing X" status change |
| `tags` | includes `"decision"` | the provenance + behavior marker (no new enum) |
| `extractedBy` | `"user"` | user-stated, not inferred |
| `confidence` | `1.0` (teach) · ≤`0.95` (refine) | explicit `brain_teach_knowledge` decisions are `1.0` and bypass KEA; `source:"decision"` learnings inherit the refine-path clamp (≤0.95). Both clear the ≥0.7 drop gate comfortably — a decision is never dropped for low confidence. The `decision` tag + no-decay invariant, not the exact number, are what carry the behavior. |
| `instead` | rejected alternative | "Mongo", "the v1 API" — what makes it a *decision*, not a preference |
| `rationale` | the why | |
| `scope` | `"project"` (default) | promotion to team/community is later + explicit |
| `ownerProjectId` / `ownerUserId` | set | attribution for the provenance badge |

**No migration for the core object** — every field already exists on `Knowledge`
(`packages/db/prisma/schema.prisma`). The `decision` tag rides the existing
`String[] tags` column, exactly as `close_capture` rides it today.

## Intake — three reused channels, no new MCP tool

Composing existing tools (anti-pattern avoided: "inventing a new MCP tool for
every need"):

1. **`source:"decision"` routing (the free win).** `brain_report_session_outcome`
   `learnings[].source` already accepts `"decision"` (see the close-capture
   spec). Today a decision-sourced learning is persisted like any personal
   reflex. Phase 1 routes a refined learning whose `source === "decision"` to
   **`scope:"project"` + `tags:["decision"]`** (and `type` normalized to
   `principle`/`anti_principle`). Decisions distilled at close become shared, for
   free, via a field that already ships.
2. **`brain_teach_knowledge` description nudge.** Name decisions/status-changes
   explicitly as a thing to capture, with the `(rule, rationale, instead)` shape
   and `scope:"project"`. The tool already accepts `type, trigger, rule,
   rationale, instead, scope, tags` — Phase 1 adds prose, not parameters.
3. **AGENTS.md house rule.** "When the user states a project decision or status
   change ('we'll use X', 'deprecate Y', 'Z owns auth'), capture it immediately
   as a decision (`scope: project`), including the rejected alternative." Same
   elicitation pattern as close-capture; no human friction.

## Consumption — the read side already exists

- **inject-at-open** (`brain_start_session`) already serves project-scoped
  `Knowledge` to every teammate opening a session in that project. One change:
  the injection formatter renders decision-tagged rows under a distinct
  **"## Decisions in this project"** heading so the agent treats them as *settled
  context*, not suggestions to re-litigate. This is the cross-user payoff — a
  teammate's session opens already knowing what was decided.
- **Oracle** (`brain_ask_oracle`) already cites `Knowledge` rows. Phase 1 only
  ensures decisions are retrievable and **labeled `decision`** in citation meta
  (re-ranking for "what did we decide…" intent is deferred).

## The two model rules (the only real departures)

### Decay-exemption invariant
The decay job retires rows scoring `< 0.3` with `≥5 outcomes` and no recent
usage. A *decision* is a stated fact, not a heuristic being scored — "we use
Postgres" is not less true because a session failed. **A `decision`-tagged row is
skipped by the decay / low-effectiveness flagging job entirely**, and is not
subject to `successCount/failureCount`-driven retirement. It is retired only by
supersession (below). This is the sharpest change from the current model and the
first thing to challenge if it's wrong.

### Supersession / status changes
The failure mode worse than not capturing is **serving a stale decision to a
whole team.** A superseding decision:
- reuses the existing **`parentKnowledgeId`** lineage link to point at the
  decision it replaces, and
- **retires the predecessor** (soft-delete via `deletedAt`, so KRA stops serving
  it — the existing visibility filter already excludes `deletedAt IS NOT NULL`).

The agent supplies the superseded id when known (it was likely injected at open);
semantic auto-linking is deferred. **Caveat (conscious choice):** `parentKnowledgeId`
currently means "edit = fork"; reusing it for "supersede" conflates reword-vs-
reverse. Acceptable for Phase 1 (both retire the old row). If the Phase 2
changelog UI must distinguish them, add a dedicated `supersedesKnowledgeId` then.

## Scope gate (privacy)

Capture at **`project` scope only** in Phase 1. Promotion to `team`/`community`
stays explicit user action (existing invariant: "auto-promotion across scopes is
always explicit user action") — a decision can name a client. No promotion path
ships here.

## Measurement (APPROACH §1.3)

The proof is not "decisions captured"; it is **decisions retrieved by someone who
didn't author them.** Phase 1 ships:
- a `decision.captured` funnel log (count, scope, intake channel),
- a dashboard count "Project decisions,"
- **the success criterion as an integration test:** user A captures a decision in
  project P → user B opens a session in P → inject-at-open surfaces it. That
  cross-user retrieval is the thesis of the wedge in one test.

## Error handling

- Malformed decision input → dropped per-item, counted, the close/teach call
  unaffected (same discipline as close-capture).
- Supersede target not found / not owned → capture the new decision *without* the
  lineage link, log `op:"decision.supersede_orphan"`; never fail the capture.
- Old clients (no decision nudge) → exact current behavior; `source:"decision"`
  learnings simply weren't routed before, so this is strictly additive.

## Boundaries & testing

| Unit | Change | Tests |
|---|---|---|
| `packages/core/src/learnings.ts` + `kea.ts` refine path | route `source:"decision"` → `scope:"project"` + `decision` tag + `principle`/`anti_principle` | unit: decision learning → project-scoped tagged Knowledge; non-decision unchanged |
| `packages/core/src/` decay job | skip `tags ∋ "decision"` rows | unit: decision row survives a decay pass that would retire an equivalent heuristic |
| supersession helper (`packages/core/src/knowledge-*.ts`) | set `parentKnowledgeId`, soft-delete predecessor | unit: supersede retires old row, KRA stops serving it; orphan target → no link, no throw |
| injection formatter (`packages/core/src/kra.ts`) | "## Decisions in this project" section | unit: decision rows grouped + headed distinctly in the injection string |
| Oracle citation meta | label `decision` | unit/contract: a decision row cited carries the label |
| measurement | `decision.captured` log + dashboard count | covered by the funnel unit + a count query test |
| cross-user retrieval | — | **integration: A captures in P → B's inject-at-open in P surfaces it** |
| `brain_teach_knowledge` / report tool descriptions + AGENTS.md | elicitation prose | prose only |

**Phase 1 non-goals (explicitly deferred):** "Project Decisions" webapp surface ·
human-confirm card · team/community promotion UI · dedicated `brain_record_decision`
tool · semantic auto-supersession · Oracle re-ranking. All Phase 2+, gated on
Phase 1 showing yield. No e2e change beyond the cross-user integration test; no
schema migration.
