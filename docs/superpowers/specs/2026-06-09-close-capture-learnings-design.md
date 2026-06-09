# Close-capture learnings — capture-at-close + validate-not-mine

**Date:** 2026-06-09 · **Status:** approved (design review 2026-06-09)
**Problem:** per-session KEA yield is ~17% (documented in `kea.ts`) because the
brain is passive — it only sees what the agent volunteers, and agents rarely
emit mid-session `brain_log_event` calls. The highest-signal moments (user
corrections, rejected approaches, decisions) live in the agent's context but
never reach the brain.

## Core idea

Capture durable learnings at the **one touchpoint every agent reliably hits**
— `brain_report_session_outcome` — as a structured, optional `learnings` array
shaped like the project's own knowledge model (`trigger, rule, rationale`;
APPROACH §1.1). KEA gains a **refine** mode that *validates, types, and dedups*
agent-submitted learnings instead of *mining* a thin summary. The agent
distills in its own context (where the whole session is loaded, at zero server
cost); the server validates with a cheap LLM pass.

Fully backward-compatible: sessions closed without `learnings` keep today's
mine path; cross-session KEA is untouched.

## Capture protocol

`brain_report_session_outcome` input gains an optional field:

```ts
learnings?: Array<{            // 0–5 items; extras beyond 5 dropped + counted
  trigger:   string            // "when scaffolding a React form in this repo"
  rule:      string            // "use react-hook-form + zod, not Formik"
  rationale: string            // "Formik abandoned; team standard"
  type:      "reflex" | "recipe" | "heuristic" | "principle" | "anti_principle"
  source:    "user_correction" | "decision" | "discovery"
  confidence?: number          // 0–1 agent self-estimate; server clamps
}>
```

- **Never blocks the outcome report.** Items are validated per-item
  (`safeParse`) inside the handler; invalid items are dropped and counted in
  the log — the feedback loop (confidence updates, SQS, autoskill) always
  closes.
- **Persistence:** each valid item is written as a
  `SessionEvent { eventType: "learning_captured", payload: <learning> }`.
  `SessionEvent.eventType` is a plain `String` and `payload` is `Json` → **no
  schema migration**.
- **Light-A elicitation:** the MCP server `instructions` + the
  `report_session_outcome` / `log_event` tool descriptions are tightened so
  agents (a) fill `learnings` at close — especially corrections and rejected
  approaches — and (b) emit `user_correction` / `knowledge_rejected` events
  in-the-moment (those drive the confidence loop).

## Extraction: validate-not-mine

- `buildPayload` collects `learning_captured` events →
  `submittedLearnings?: Learning[]` on `KEAInputPayload`.
- `extractFromSession` routes: `submittedLearnings?.length` →
  **`refineSubmittedLearnings()`** (new, in `kea.ts` beside the miner);
  otherwise → today's mine path unchanged.
- `refineSubmittedLearnings()`: one cheap-LLM pass (same `KEA_MODEL` default)
  over the submitted items — judge durability/specificity, normalize to the
  ontology, clamp confidence to ≤0.95 — then reuse the **existing**
  quality-filter + persist path (embedding + cosine dedup against current
  knowledge). Persisted rows are tagged `close_capture`. Precision is
  unchanged: the same ≥0.7 gate + dedup applies, so an agent can't inject junk
  straight to knowledge.

## Measurement (APPROACH §1.3)

The `kea.funnel` log + AuditLog payload gain `mode: "refine" | "mine"` and
`submitted` / `dropped_invalid` counts, so yield is queryable split by
`hadLearnings`. **Success:** close-capture sessions persist meaningfully more
durable knowledge than the ~17% mine baseline at ≤ current KEA cost.

## Error handling

- Malformed `learnings` → item dropped, counted, outcome report unaffected.
- Refine-LLM failure → fall back to the mine path for that session (log
  `op:"kea.refine_fallback"`), so a provider blip never loses the session.
- Old clients (no field) → exact current behaviour.

## Boundaries & testing

| Unit | Change | Tests |
|---|---|---|
| `apps/mcp-server/src/tools/report.ts` | accept + persist `learnings` as events | contract test: with/without field; >5 items; invalid items dropped, outcome still succeeds |
| `packages/core/src/kea.ts` | `refineSubmittedLearnings()`, routing, funnel fields | unit: submitted → typed/deduped Knowledge; junk dropped; confidence clamped; LLM-failure fallback to mine |
| `buildPayload` | collect `learning_captured` events | covered by kea unit tests |
| MCP `instructions` / tool descriptions | elicitation text | prose only |

No UI change, no migration, no e2e change. Cross-session KEA untouched.
