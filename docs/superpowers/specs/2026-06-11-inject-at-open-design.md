# Inject-at-open — read-side mirror of close-capture

**Date:** 2026-06-11 · **Status:** approved · **Issue:** #64
**Problem (measured on prod):** 27 knowledge rows, **0% ever retrieved, 0%
ever received outcome feedback**, across 22 sessions. `brain_retrieve_knowledge`
requires a separate mid-flow call no agent makes — the same elicitation failure
close-capture fixed at the close call.

## Core idea

`brain_start_session` already receives `prompt` (the task description) and
reliably happens at open. When present, run the existing scored retrieval in
the same round-trip and hand the agent the knowledge it should apply — no
second call to remember. The feedback loop downstream is ALREADY wired and
merely starved: `kra.retrieveScored` records
`SessionKnowledgeApplication(role:"injected")`, and `report.ts` step 3b bumps
success/failure from those rows on close.

## Behaviour

In `apps/mcp-server/src/tools/start-session.ts`, after the session row +
`session_started` event are created, when `input.prompt` is non-empty:

1. `kra.retrieve(prompt, { sessionId, userId, projectId, framework, language }, 5)`
   — this records the injection rows and sets `bundle.injectedIds`.
2. Response gains, only when ≥1 row was injected:
   ```ts
   relevantKnowledge: {
     knowledgeIds: string[],          // pass back as knowledgeUsed at close
     injection: string,               // formatter.formatForInjection(bundle)
   }
   ```
3. **Fail-soft is non-negotiable:** any retrieval error (no embedding provider,
   vector blip) logs `op:"start.inject_failed"` and omits the field — opening a
   session must never fail or block on retrieval. (Keyless CI exercises exactly
   this path.)
4. Elicitation: `brain_start_session` + server `instructions` text tell the
   agent to apply the returned rules and pass `knowledgeIds` back as
   `knowledgeUsed` when closing.

No schema migration. `brain_retrieve_knowledge` stays for mid-task re-query.

## Tests

- DB-gated handler tests (`apps/mcp-server/src/__tests__/start-inject.test.ts`):
  - prompt + keyless env → session opens normally, **no** `relevantKnowledge`
    (fail-soft proven in CI);
  - no prompt → no retrieval attempted (no application rows);
  - both assert the session row + `session_started` event still exist.
- Happy path (real embedding) is validated live post-deploy: open a session
  with a prompt → `relevantKnowledge` returns; `SessionKnowledgeApplication`
  rows exist; `usageCount`/feedback move off zero after a close with
  `knowledgeUsed`.

## Measurement

Acceptance = the prod metrics that motivated this: % knowledge with
applications > 0 and outcome feedback > 0 must move off zero within days of
deploy.
