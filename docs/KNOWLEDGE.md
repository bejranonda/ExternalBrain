# Knowledge — Representation, Ontology, and Lifecycle

This doc defines what "knowledge" is inside the External Brain, how it's represented in storage, how it moves through the pipeline, and the invariants any implementation must respect.

This knowledge is **typed, inspectable, and user-editable** by design — the property that separates External Brain from the opaque, per-tool memory built into AI coding tools ([README §Why](../README.md)). The model defined here *is* that differentiation, not just an implementation detail.

> This is normative. If code disagrees with this doc, the code is wrong — raise a PR to either fix the code or amend this doc.
>
> **Rebuilding the system?** The implementation specs for the knowledge layer live in
> [`REBUILD/01-foundation.md`](../REBUILD/01-foundation.md) (schema) and
> [`REBUILD/02-core-intelligence.md`](../REBUILD/02-core-intelligence.md) (KRA · KEA ·
> Oracle · decay). This doc defines the *what*; those files define the *how*.

---

## 1. Definitions

| Term | Meaning |
|---|---|
| **Data** | raw events from a session: prompts, tool calls, diffs, build output |
| **Information** | typed summaries of a session: outcome, files touched, metrics |
| **Knowledge** | an atomic, actionable rule extracted from one or more sessions |
| **Wisdom** | an internal skill that improves how the Brain itself extracts/retrieves |
| **Skill** | a user-visible markdown document bundling multiple knowledge items |
| **Transformation** | the act of applying knowledge to a new AI session |
| **Retrieval** | the operation of finding the right knowledge for a task |
| **Representation** | the form knowledge takes in storage (text, structured, embedding, graph, symbolic) |

We call the extended framework **DIKW-T-R-R**. See `BLUEPRINT.md §2.3`.

---

## 2. The 5-category ontology

Every `Knowledge` row is exactly one of:

| Type | Semantics | Example |
|---|---|---|
| `reflex` | unconditional rule, always applies | "Always end files with a newline" |
| `recipe` | template for a specific task type | "For React forms, use react-hook-form + zod" |
| `heuristic` | context-sensitive guidance (UI: "Rule of thumb") | "When debugging Next.js build errors, clear `.next` first" |
| `principle` | abstract value | "Prefer composition over inheritance" |
| `anti_principle` | something to avoid | "Don't inline styles (user corrected 3×) — use Tailwind instead" |

**Plus one non-rule type (V2.0, 2026-07-07):** `action_item` — a meeting
to-do or open question. It is a **task, not a rule**, and sits outside the
ontology's retrieval semantics:

- **Tag contract:** `action-item` *or* `open-question`; assignee as
  `for:<email-lowercase>`; origin as `meeting:<YYYY-MM-DD-slug>`; `blocker` when it
  blocks other work.
- **Lifecycle:** open (active row) → resolved (`resolvedActionItemIds` at
  session close soft-deletes it) → or abandoned (normal decay expires it;
  threshold `decayScore ≤ 0.3`).
- **Exclusion invariant:** `action_item` never appears in semantic retrieval
  (KRA), the Oracle's semantic knowledge context, KEA output, or
  injected-knowledge metrics (`SessionKnowledgeApplication`). The Oracle's
  deterministic OPEN TASKS enumeration (`V2_ORACLE_TASKS`) is the single
  deliberate exemption. Surfacing is deterministic: `for:`-tag match at
  `brain_start_session` (flag `V2_ACTION_ITEMS`), blockers first.
- **Containment invariant (2026-07-10):** action items never cross the
  project boundary by any path — promote-to-org and fork-to-project reject
  them (422), and every task query is hard-bounded to the active project
  regardless of org visibility. Their text is also injected with
  untrusted-content framing (it is authored by other project members).
- **Assignee-validation invariant (2026-07-17).** Every `for:<email>` tag on
  an `action_item` row is checked server-side against real org membership
  before persisting — on every path that can set the tag, not just the
  `/meetings` UI's dropdown (create via `POST /api/knowledge`, and edit via
  `PATCH /api/knowledge/[id]`, share one helper,
  `apps/web/lib/brain/assignee-validation.ts`). Client dropdown state was
  never the trust boundary. A request with multiple `for:` tags has every one
  validated, not just the first, and the persisted tags are canonicalized to
  lowercase — `packages/core/src/action-items.ts`'s `for:`-tag lookup is an
  exact-match filter, so an unnormalized case would silently never surface
  the item to its assignee even though it "validated."

### Scope

| Scope | Visible to | When set |
|---|---|---|
| `global` | all of user's work across all projects | rare; user-taught |
| `user` | this user's work, **across every project** | default KEA output, and `brain_teach_knowledge`'s default |
| `project` | one project only | framework/language-specific rules |

**`user` and `global` genuinely reach across projects — since 2026-07-30 (#174).**
Before that, the column above described intent rather than behaviour: a row is
stamped with the `ownerProjectId` of whatever session wrote it, and retrieval
matched on project ownership alone, so a `scope: "user"` rule taught while
working in project A was invisible from project B. Personal-rule retrieval
(`kra.ts`, `oracle.ts`) now opts into `includeUserScopeAcrossProjects`, which
admits `scope IN ('user','global')` rows **pinned to `ownerUserId`** — wider
project reach, never wider user reach. It is opt-in per call site because
task/meeting surfaces deliberately keep the project edge (see `scope-filter.ts`).
When there is **no** active project the rows are admitted unconditionally — there
is no boundary left to enforce — and the Prisma listing helper
(`buildKnowledgeWhereV2`) applies the identical rule, so the two never disagree.
| `session_context` | specific mode ("while debugging") | KEA-tagged |
| `team` | team members | explicit promotion |
| `community` | everyone opted-in | explicit publish |

### What is worth extracting

The benchmarks answer this, and the answer is narrower than it looks. Injected
knowledge changes an agent's output where a convention is **locally arbitrary** —
a workspace import subpath, a build-pipeline quirk, a project decision, a
surprising tool default — and *ties* where it coincides with general good
practice a strong model already applies (`docs/VALIDATION.md`, two independent
suites). So general craft is usually not worth capturing: it feels valuable and
measurably changes nothing.

The exception is evidence-shaped: if a session shows the model getting a
well-known practice wrong anyway, that is a demonstrated gap for this user rather
than a platitude, and it is worth keeping. `kea.ts`'s extraction prompt encodes
both halves, and asks itself before emitting: *could a strong model already do
this without being told?*

### Confidence

Starts at `0.7` for KEA output, `1.0` for user-taught. Updated via outcome feedback:

- Session success with knowledge injected → `successCount += 1`.
- Session failure → `failureCount += 1`.
- Duplicate detected → increment on the keeper, drop the duplicate.
- Decayed daily by `evolution.decayUnused()` with half-life 90 days.

The KRA ranking formula uses `success_rate = successCount / (successCount + failureCount + 1)` and `confidence` as separate factors — do not collapse them.

---

## 3. The five representations

A mature item can have **all five** representations of the same underlying rule. Each serves different operations.

| Representation | Storage | Used for | Owner |
|---|---|---|---|
| **Text** | `triggerText`, `ruleText`, `rationale` (Postgres) | human display, Oracle citations, markdown export | KEA, user |
| **Structured** | `type`, `scope`, `framework`, `language`, `tags`, `instead` | filtering, faceted search, ACL | KEA, user |
| **Embedding** | `embedding vector(1536)` (pgvector) | semantic retrieval, dedup, consolidation | `packages/core/src/embedding.ts` |
| **Graph** | `GraphEdge` rows + in-memory adjacency | backlinks, transitive expansion, orphan detection | `packages/core/src/graph.ts` |
| **Symbolic** | `symbolicWhen`, `symbolicThen` (optional) | deterministic guards, verification | user / future rule engine |

Do not drop a representation. Do not add a 6th without a design discussion.

---

## 4. Lifecycle (eight stages)

```
[1] CREATION      — kea | user | imported | promoted
        ↓
[2] STORAGE       — all 5 representations, embed on insert
        ↓
[3] RETRIEVAL     — KRA scoring, injection, SessionKnowledgeApplication row
        ↓
[4] APPLICATION   — AI uses in generation, Oracle cites
        ↓
[5] FEEDBACK      — success/failure counts, user confirm/correct/delete
        ↓
[6] EVOLUTION     — consolidate, supersede, specialize, generalize, decay
        ↓
[7] ARCHIVAL      — low confidence + unused + old → deletedAt set
        ↓
[8] DELETION      — physical only on GDPR erasure OR after 7-year retention
```

Each transition has a clear owner module:

| Stage | Module |
|---|---|
| 1 | `packages/core/src/kea.ts`, MCP `brain_teach_knowledge` |
| 2 | `packages/db` + embed on insert |
| 3 | `packages/core/src/kra.ts` + `formatter.ts` |
| 4 | MCP `brain_retrieve_knowledge` response, Oracle `ask()` |
| 5 | MCP `brain_report_session_outcome` + user feedback endpoints |
| 6 | `packages/core/src/evolution.ts` (scheduled) |
| 7 | `evolution.detectObsolescence()` — soft delete |
| 8 | admin REST `/api/admin/gdpr-erase` — physical delete |

**Operator-initiated bulk reset** — in addition to the natural lifecycle
above, an org-admin can mass-soft-delete rows via
`POST /api/admin/knowledge/reset` (UI: `/settings/reset-knowledge`):
- `scope: "older-than"` with `olderThanDays: N` — prune anything older
- `scope: "all"` — clear the org; optional `hard: true` for physical delete
Each reset writes an `AuditLog` row (`action: "knowledge.reset"`). See
`packages/core/src/knowledge-reset.ts` for the helper and `docs/REST_API.md`
§"Admin / health" for the wire shape.

---

## 5. Invariants (enforce at write time)

1. **Immutability.** A persisted `Knowledge` row is not edited in place. Changes create a new row with `parentKnowledgeId` pointing back.
   - **Enforcement (2026-04-21):** `PATCH /api/knowledge/[id]` rejects any body field in `{ruleText, triggerText, rationale, instead}` with `409 immutable_field` (`instead` added 2026-07-17 alongside its REST-creatable-field support, below, to close the gap between MCP and REST parity). Only metadata (`tags`, `scope`, `confidence`) is patchable. The Skills UI "Save" button now forks on edit — the parent is retained for history, the fork gets a lower starting confidence and is auto-selected. Forking also copies `instead` onto the new row, matching `rationale`.
   - **Explicit supersession (2026-07-17, meeting-transcript-upload).** `POST /api/knowledge` accepts an optional `supersedesKnowledgeId`: inside the same transaction as the create, the target row is soft-deleted and the new row's `parentKnowledgeId` is set to it — a one-call version of the general pattern above, for the case where a reviewer explicitly confirms "this replaces that" (e.g. a meeting-extracted decision superseding an earlier one). `supersedeKnowledge()` (`packages/core/src/knowledge-stats.ts`) checks the target is owned by the caller **and**, when a project is resolvable, that it belongs to the same project — a caller cannot silently retire a same-owner row in an unrelated project by guessing its id. Both callers (`POST /api/knowledge` and the MCP `brain_teach_knowledge` tool) share this check.
2. **Provenance.** `sourceSessionIds` or `extractedBy` must be non-empty. Orphan knowledge cannot exist.
3. **Scope boundary.** A query in user scope X cannot return knowledge in a different user's `user` scope. Enforced at the ORM layer (every query filters by `ownerUserId` / `ownerTeamId`).
4. **Embedding required for retrievability.** Rows without an embedding are not returned by KRA. The worker runs `embeddings.backfill` every 10 minutes (`apps/worker/src/backfill-embeddings.ts`); any row older than 15 minutes with `embedding IS NULL AND deletedAt IS NULL` is a bug. One-shot replay: `pnpm --filter @brain/worker backfill:embeddings`.
5. **Confidence range.** `confidence ∈ [0.0, 1.0]`. `decayScore ∈ [0.05, 1.0]` (floor is 0.05 — we never let decay drive retrieval to zero without an explicit delete).
6. **Anti-principles must have evidence.** An `anti_principle` row must have `failureCount ≥ 1` OR `extractedBy = 'user'`. We do not invent things to avoid.
7. **Peer Card overrides.** When Oracle or retrieval assembles context for a user, `PeerCard.facts` are prepended verbatim and **override** KEA-derived knowledge. This is the Honcho rule.
8. **Autoskill never edits without approval.** Unless user has opted-in to auto-apply HIGH, every `AutoskillProposal` sits in `pending` until a human acts. **(v1.10.0)** The proposal's *type* decision (`rules` / `knowledge` / `ignore`) may be made by an LLM classifier (`packages/core/src/autoskill-classifier.ts`, behind `AUTOSKILL_LLM_CLASSIFIER`, default off), grounded in the user's own resolved-proposal history and **fail-soft** to the keyword heuristic per signal — it changes only *what type* is proposed, never the approval requirement, and never drops a signal. Because the LLM can judge durability, it may promote a durable sub-`score-5` signal to `knowledge` (the heuristic's hard `score>=5` gate stays only on the fallback path). See `GUIDELINES.md §3/§4` and `APPROACH.md §4.7`. **(v2.13.0) Rejection is reversible; application is not.** A `rejected` proposal can return to `pending` via `POST { action: "unreject" }` — rejecting writes no `Knowledge`, so nothing needs unwinding, and the UI can therefore offer undo rather than a confirmation dialog. There is deliberately no inverse for `apply`: retracting knowledge that other rules may already cite is a different and much harder operation. The asymmetry is the point — *the reversible action gets the fast path*.
9. **Audit log is append-only.** Every admin-visible mutation (knowledge create/patch/delete/fork, token create/revoke/rotate, user erase, voucher create/update/delete) writes an `AuditLog` row via `writeAudit()` from `@brain/core/audit`. No code path should ever delete an `AuditLog` row — not even the GDPR erase path. The audit of the erase is the point. Secret redaction happens in `writeAudit()` itself (recursive, 4-deep, matches `token|secret|password|apiKey|authorization`), so raw payloads never reach the DB. (Added Wave 3, 2026-04-22; extended for `token.rotate` action 2026-04-25.)
10. **No silent auth fall-through.** `getCurrentUserId()` resolves via exactly one of three mutually-exclusive modes — OAuth JWT session, explicit dev-shim opt-in (`ALLOW_DEV_AUTH=true`), or `auth_not_configured` (503). A deployment with neither OAuth nor the dev-shim flag MUST return 503 on every authenticated request. Never add a branch that returns a User row when the configured mode can't verify identity; that silent-default behaviour was the 2026-04-23 vulnerability. (Added Phase S, 2026-04-23.)
11. **Voucher claims are transactional.** New-user registration via a voucher code runs through `claimVoucher()` in a single Postgres transaction with a `SELECT … FOR UPDATE` on the voucher row. The `usedCount` increment, User creation, and VoucherRedemption insert all commit atomically. No code path may decompose this into a check-then-act sequence; concurrent claims on the last seat of a multi-use voucher would both succeed. (Added Phase S, 2026-04-23.) **Extension (2026-06-17):** email+password self-service registration (`POST /api/auth/register`) passes a pre-computed `passwordHash` into `claimVoucher()`, which writes the `UserCredential` inside the *same* transaction — so a registration either fully succeeds (user + credential + voucher redemption) or not at all. bcrypt runs *before* the transaction so the row lock is held only for the inserts. The same atomicity rule governs `createOrg()`: the Organization, the owner `OrganizationMember`, and the org's default Project are created in one transaction so a half-built org (no owner, or no project) can never be observed.
12. **Knowledge rows track actual usage; effectiveness = successCount / (successCount + failureCount).** Every time a Knowledge row is cited in an Oracle answer, `usageCount` and `lastUsedAt` are bumped. Every time a session with that row injected reports an outcome, `successCount` or `failureCount` is bumped. Oracle thumbs up/down on an answer also bumps `successCount`/`failureCount` on each cited row in real time (see §12.24). `effectivenessScore(k) = successCount / (successCount + failureCount)` (returns -1 sentinel for fewer than 3 outcomes). Code paths: `bulkBumpKnowledgeUsage` (Oracle citation → usageCount+lastUsedAt), `bulkBumpKnowledgeOutcome` (session outcome via SessionKnowledgeApplication), `POST /api/oracle/feedback` (live thumbs → successCount/failureCount). All three are best-effort — errors are logged but never surface to the user-facing response. (Added Core Value B, 2026-04-28; thumbs loop added MVP complete, 2026-04-29.)

13. **The deployment is the outermost knowledge boundary.** Invariant 3 governs scope *within* one Brain; this one bounds the whole set. A `Knowledge` row exists in exactly one deployment's database and there is no federation, replication, or cross-instance read between Brains — a rule taught to `brain-dev.example.com` is not merely invisible to `brain.example.com`, it does not exist there. Two consequences follow, both of which have bitten (`KNOWN_ISSUES §0t`): (a) knowledge ids are unique per instance, so an id echoed by a successful `brain_teach_knowledge` proves a row was written *somewhere*, never *where* — verify with `select id from "Knowledge" where id = '<id>'` against the instance you believe you are using; (b) moving knowledge between deployments is an explicit export/import (`GET /api/export/rules`) or a `pg_dump` restore, never something that happens because a client was repointed. Corollary for clients: an MCP client binds its endpoint at session start, so the instance a write lands in is decided by the *live connection*, not by the config file on disk.

Violations of these invariants should be caught by unit tests in `packages/core/__tests__` (Phase 1 deliverable).

---

## 6. The knowledge → skill relationship

Skills and knowledge are not redundant; they live at different granularities:

- **Knowledge** = one atomic rule. Injected at session start as part of a bundle. Small, searchable, individually confidence-scored.
- **Skill** = a markdown document bundling multiple knowledge items plus narrative decisions, steps, and gotchas. Exportable as a unit. Has a `stage` (inbox/notes/knowledge/wisdom).

Relationship rules:

- A skill `dependencies: ["other-skill-id"]` in metadata (frontmatter) creates a `GraphEdge(relation: depends_on)`.
- Wikilinks `[[Skill Name]]` in the body create `GraphEdge(relation: related_to)`.
- A skill's `stage` escalates: `inbox → notes → knowledge → wisdom`. Escalation is usage-driven: `wisdom` requires `usageCount ≥ 10` and `mastery = 5`.
- Deleting a skill does not delete its child knowledge items. Knowledge outlives skills.

---

## 7. How extraction works (KEA summary)

1. Worker picks up `kea.extract` job after `brain_report_session_outcome`.
2. Build a `KEAInputPayload` from Session + events + metrics.
3. LLM call (Qwen3-Coder / Haiku / GPT depending on `KEA_MODEL`). System prompt in `packages/core/src/kea.ts`.
4. Parse response — expect `{findings: [...]}`, max 3 per session.
5. Quality filter: drop `confidence < 0.7`, drop short/generic rules, drop semantic duplicates (similarity > 0.85 → bump the keeper's confidence instead).
6. Embed and persist with `extractedBy: "kea"`, `sourceSessionIds: [sessionId]`, `confidence: <from LLM>`.

Cost budget: `MAX_KEA_COST_USD_PER_SESSION=0.05`. Above that the job should abort and log.

**Critical: the entire pipeline gates on `brain_report_session_outcome`.** A Session with `endedAt = null` never enqueues a `kea.extract` job, so the brain never learns from it. This is the single biggest reason a deployed Brain feels "stagnant" — the operator's tokens are connecting, sessions are opening, but no client ever closes them. Diagnose via `docs/RUNBOOK.md §"Tokens connect but brain doesn't learn"` (orphan-session detector). The v2 installer (2026-05-11, an early PR) makes the first such close automatic on every install so KEA has its first input from day 0.

**Second gate (2026-05-12, an early PR): KEA needs a configured LLM provider.** Even with closed sessions, `kea.extract` cannot produce Knowledge rows unless `KEA_MODEL` routes to a provider whose API key is set in the worker's env. Default `qwen3-coder` requires `DASHSCOPE_API_KEY`; `claude*` requires `ANTHROPIC_API_KEY`; everything else requires `OPENAI_API_KEY`. The `op="kea.funnel"` worker log line (`{llmFindings, filterPassed, persisted}`) is the diagnostic for "did KEA fire AND did it produce findings AND did they survive the quality filter." See `docs/MCP_TOOLS.md §"KEA provider routing"` for the routing table and `docs/RUNBOOK.md §"Why is knowledge_by_kea stuck at 0?"` for the three nested failure modes that block extraction.

**Cross-session KEA (2026-05-14, an early PR).** A second extraction pass that complements per-session KEA: instead of looking at one closed session in isolation, the cross-session pipeline bundles a user's last N closed sessions and asks the LLM to find patterns that REPEAT across them (≥2 sessions per finding). On dev, this lifted extraction yield from 17% (1/6 sessions producing any findings) to 50% (3 findings from a 6-session bundle). Runs daily at `0 6 * * *` UTC via the pg-boss `kea.cross_extract` queue. Idempotent: each daily run only processes users whose newest closed session is newer than their last cross-session Knowledge row — users with no new sessions log `op="kea.cross.skip"` and don't burn an LLM call. Findings are persisted with `tags: ["cross_session"]` and `sourceSessionIds` listing every contributing session for audit attribution. See `packages/core/src/kea.ts:runCrossExtractDaily`.

**Close-capture / refine mode (2026-06-09, v1.4.0, PR #49).** A third acquisition path that inverts the mine model: the *agent* distills durable learnings in its own context — where the full session is loaded — and submits them at the one call every client reliably makes, `brain_report_session_outcome(learnings: [...])` (0–5 items shaped `{trigger, rule, rationale, type, source, confidence?}`). Semantics:

- **Capture never blocks the close.** Items are validated per-item (`packages/core/src/learnings.ts`); invalid ones are dropped and counted, the feedback loop always completes. Valid items persist as `SessionEvent {eventType: "learning_captured"}` — no schema migration.
- **KEA routes by submission.** `buildPayload` collects (and re-validates) the events into `submittedLearnings`; `extractFromSession` then runs **refine** mode — a cheap-LLM judge screens each candidate for durability/specificity and may lower (never raise) confidence, clamped ≤ 0.95 — instead of mining the thin summary. Judge failure falls back to mine, so a provider blip never loses the session. Sessions without learnings keep the original mine path byte-for-byte.
- **The same gates apply.** Refine output passes the step-5 quality filter above (≥0.7 confidence, length/generic screens, semantic dedup) and the normal persist path; rows are tagged `close_capture` so yield is queryable split by source (the `kea.funnel` log gains `mode` + `submitted`).
- **Elicitation is part of the design.** The MCP server `instructions` and the `report`/`log_event` tool descriptions actively ask agents for learnings at close and for in-the-moment `user_correction` / `knowledge_rejected` events — the event schema existed long before; the yield problem was that nothing *asked*.

Validated on production day one: a real session submitting 4 learnings persisted 3 `close_capture` rows (vs. the ~17% mine baseline where most sessions persist zero). Spec: `docs/superpowers/specs/2026-06-09-close-capture-learnings-design.md`.

---

## 8. How retrieval works (KRA summary)

**Entry points (inject-at-open, 2026-06-11, v1.5.0, #64).** Retrieval has two
doors, and the load-bearing one is the session open: `brain_start_session`
with a `prompt` runs this pipeline automatically and returns
`relevantKnowledge { knowledgeIds, injection }` in the same round-trip —
because measurement showed agent sessions never make a separate retrieval
call (`brain_retrieve_knowledge` remains for mid-task re-query). Each injected
row is recorded as `SessionKnowledgeApplication(role:"injected")`, and the
close call's `knowledgeUsed` list turns those into success/failure bumps
**and is persisted as `SessionKnowledgeApplication(role:"used_reported")`
rows (v1.13.0)** — the per-session signal behind the loop-health panel's
injection→used rate. Same reliable-touchpoint principle as close-capture
(§7), applied to the read side. Fail-soft: a retrieval error never blocks
the session open, and a `used_reported` persist failure never blocks the close.

1. MCP client calls `brain_retrieve_knowledge({ prompt, context })` — or, in
   the primary path above, `brain_start_session` runs it on the agent's
   behalf.
2. Embed the prompt → `queryVector`.
3. pgvector query for top-50 candidates filtered by scope + decay > 0.3 + user match (widened from top-20 by [#146](https://github.com/bejranonda/ExternalBrain/issues/146), post-Stage-3-gate — see `kra.ts`'s `CANDIDATE_POOL_SIZE`).
4. Score each with `0.70·sim + 0.08·success + 0.08·recency + 0.08·contextFit + 0.06·confidence` (the live `kra.ts` `WEIGHTS`; semantic similarity dominates and the rest act as tie-breakers — see the `WEIGHTS` history comment for the pre-2026-04-23 formula and why it changed).
5. Diversify: ≤ 3 per type, ≤ 10 total, min score 0.45.
6. Record `SessionKnowledgeApplication(role: injected)` for each returned item.
7. Return `{bundle, injection}` — the `injection` is a pre-formatted string ready to drop into a user message block.

> **Validating this ranking.** The re-rank (steps 3–4) is what the retrieval
> benchmark measures: `packages/core/src/retrieval-benchmark.ts` re-ranks a
> fixture pool by this exact `scoreItem` vs a raw-cosine baseline and reports
> NDCG@5. Any change to `WEIGHTS` should be run through it — see
> [`docs/VALIDATION.md`](./VALIDATION.md).

---

## 9. Internal wisdom skills

Skills with `kind: "internal"` are not exported to users. They improve the Brain itself. Examples:

- `extraction.filter-generic-advice` — prompt addendum that hardens the "avoid 'best practices' phrases" rule.
- `retrieval.boost-project-scoped-when-path-matches` — runtime hook re-ranking if current file path matches a project-scoped rule.
- `oracle.cite-anti-principles-distinctly` — formatting contract for Oracle.

They are learnable, versioned, and promotable. A community-internal skill marketplace (Phase 4) lets experts publish tuning improvements.

This is the mechanism by which **the Brain gets better at being a brain**.

---

## 10. Evaluation — how we know this is working

Without visible metrics, the flywheel is invisible. Three canonical measures:

1. **SQS per session** (`packages/core/src/evaluation.ts`) — 0-100 blend of build success, user feedback, diff acceptance, clarification penalty.
2. **Knowledge health snapshot** (weekly) — usage in last 30 days, avg confidence, contradiction count, median age.
3. **Retrieval NDCG@5** — on a 100+ query labelled benchmark. Run before every KRA change.

Stop-conditions (see `KNOWN_ISSUES.md §3`):
- SQS does not trend up after 4 weeks of real usage → stop and investigate.
- KEA noise rate > 30 % on human spot-check → retune prompt/model.
- Retrieval NDCG@5 < 0.4 → retrieval is broken; knowledge cannot reach the client.

---

## 11. How the webapp presents this ontology

The five types surface in `apps/web` as `--k-*` CSS variables (`--k-recipe`, `--k-heuristic`, `--k-principle`, `--k-reflex`, `--k-anti`) used by the Skills browser, Graph inspector, Oracle citations, and Autoskill cards (note: "heuristic" is presented as "Rule of thumb" to end-users). A visible type outside these five is a contract violation — add the type here first (§2), then extend the color and i18n dictionaries.

The Skills surface (`apps/web/components/brain/skills.tsx`) also renders the stage enum — `inbox`, `notes`, `knowledge`, `wisdom` — as the left filter rail. When §8 changes, these filters and their i18n keys (`skills.inbox`, `skills.notes`, `skills.knowledge_stage`, `skills.wisdom`) must change with it.

The narrative *explanation* of this ontology — the in-app `/docs` concept pages (Skills, Oracle, Sessions, Autoskill, Decay, **Graph**, **Decisions**, Tokens, Connection status, Groundedness, plus the vocabulary glossary and the **Using Brain from your agent** cheat-sheet, §12.28) — is localized **EN / TH / DE** (#59). Long-form docs prose does **not** route through the `useT()` dictionary: it lives as parallel `DocPage` data in `apps/web/lib/brain/docs-content.ts` (`DOCS` / `DOCS_TH` / `DOCS_DE`), resolved by `getDoc(lang, slug)` with a **per-slug EN fallback** so a missing translation degrades to English, never a broken page. EN is authoritative; when the ontology changes, update the EN `DocPage` first, then its TH/DE siblings. A new page must also be added to the `DOCS_SECTIONS` index array (it is otherwise unreachable from `/docs`), and any nav-surface `HelpPopover` `docHref` must point at a slug that actually exists — `graph` and `decisions` originally shipped with dead `docHref`s until their pages were authored. (Rationale + rendering strategy in `docs/GUIDELINES.md` i18n section and `APPROACH.md §5at`.)

Two presentation primitives back this glossary: the page-level `HelpPopover` (a "what is this surface?" popover in a route header, with a `docHref` deep-link) and the inline `InfoDot` (`apps/web/components/brain/info-dot.tsx`) — a term-level "?" that tooltips a one-line definition and links to the matching concept page. Apply `InfoDot` only to jargon that has no existing explanation (most terms already carry `title=` tips or a `HelpPopover`); blanket coverage just adds clutter.

---

---

## 12. GUI↔backend wiring patterns (added 2026-04-21)

Patterns established during the wiring pass. Preserve them when adding new surfaces.

### 12.1 Hook-fallback pattern

Every `use-*` data hook (`useKnowledge`, `useSessions`, `useGraph`, etc.) catches fetch errors and falls back to the `BRAIN_DATA` seed constants with `loadState = "mock"`. This keeps every surface demo-able without a running database. The mock banner in the shell signals this state to the user. Do not remove fallback paths — they are a design and onboarding requirement, not dead code.

### 12.2 View-model indirection

Server routes return `*View` shapes defined in `apps/web/lib/brain/views.ts`, not raw Prisma models. This shields the GUI from schema churn: a column rename or relation restructure in `packages/db` requires only a change to `views.ts`, not to every component. Never return a raw Prisma result directly from a route handler.

### 12.3 Scope ownership invariants on write endpoints

Every mutating endpoint (`PATCH`, `DELETE`, `POST` for fork/copy) checks `ownerUserId === userId` before executing. The pattern is: resolve the record, compare owner, return 403 if mismatched, then mutate. See `/api/knowledge/[id]/route.ts` and `/api/autoskill/proposals/[id]/route.ts` for the canonical implementation. Do not skip this check for "internal" endpoints — scope leakage is a hard stop (see `KNOWN_ISSUES.md §2.6`).

### 12.4 retrieveScored — parallel Oracle fetch

Oracle fetches `/api/oracle/stream` (SSE) and `/api/knowledge/retrieve` in parallel. The streaming endpoint yields `event: delta` frames carrying token text, then a single `event: final` with citations, confidence, related questions, and token usage. `/api/knowledge/retrieve` returns per-candidate scoring details for the retrieval inspector panel — it resolves before the LLM finishes, so the inspector lights up while the answer is still streaming. Keeping these as separate endpoints lets the inspector work independently of the Oracle answer (e.g. debug retrieval without invoking the LLM). The current window is `kra.ts`'s `CANDIDATE_POOL_SIZE` candidates scored on every call (50 since v2.3.0/[#146](https://github.com/bejranonda/ExternalBrain/issues/146), previously 20) — acceptable for dev, needs caching before high-QPS use (see `KNOWN_ISSUES.md §1`).

### 12.6 Rules export — tagged-row → per-format materialization

Rules-shaped Knowledge is stored as global-scope rows tagged `rules-export` plus a `target:<path>` tag. `@brain/core/exporter.buildRulesBundle(userId)` groups these by target and renders per format (claude/cursor/windsurf/agents/markdown). `GET /api/export/rules?format=manifest|bundle|<format>` returns either a JSON bundle, a single concatenated manifest, or a per-format markdown file. Skills → "Download rules bundle" button consumes the manifest form.

### 12.7 Session FTS — `to_tsvector` + GIN, ILIKE fallback

`brain_session_search` uses `websearch_to_tsquery('english', $query)` against `to_tsvector('english', coalesce(metadata->>'prompt', ''))` and the same expression over `SessionEvent.payload::text`, ranked by `ts_rank_cd`. Two GIN expression indexes in `packages/db/sql/session-fts-index.sql` back this; if they're absent or the tsquery returns nothing, the handler degrades to the original ILIKE query so pre-migration environments still return useful rows.

### 12.8 Session lifecycle — `brain_start_session` explicitly opens

The 9th MCP tool, `brain_start_session`, is the only supported way to create a `Session` row from an external client. It returns `{ sessionId, startedAt }` and writes a synthetic `session_started` event so `SessionEvent` has something to anchor the FK chain. Earlier versions of the platform allowed clients to invent sessionIds and call `brain_log_event` directly — that path is removed: `brain_log_event` now requires a pre-existing Session row, or the FK rejects the write.

### 12.9 Provider routing via `ANTHROPIC_BASE_URL` (chat) + `EMBEDDING_BASE_URL` (vectors)

`packages/core/src/oracle.ts::useAnthropicSdk(model)` returns `true` if the model name starts with `claude` OR if `ANTHROPIC_BASE_URL` is set. `packages/core/src/embedding.ts::getClient()` independently honours `EMBEDDING_BASE_URL` + `EMBEDDING_API_KEY` (with fallbacks). The two paths are **independent** — swapping chat providers doesn't imply embeddings come with; most Anthropic-compat gateways (Z.ai, Bedrock's anthropic shim) expose chat only.

Recommended layering for a GLM-first deploy:

- **Oracle chat:** `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic` + `ORACLE_MODEL=glm-5.1`
- **Embeddings:** `EMBEDDING_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1` + `EMBEDDING_MODEL=text-embedding-v4` + `EMBEDDING_DIMENSIONS=1536`

Both endpoints speak their SDK's native wire format — no custom client code.

### 12.10 Prisma client output path (pnpm-safe)

`packages/db/prisma/schema.prisma` declares `generator client { output = "../src/generated/client" }`. Every consumer imports from `./generated/client/index.js` (not from the `@prisma/client` facade). Rationale: pnpm's content-addressable store hardlinks files into `.pnpm/...@prisma+client@.../node_modules/.prisma/client/`; `prisma generate` can't overwrite those and silently emits 2 KB stubs. The in-repo output path sidesteps that entirely.

The generated tree is in `.gitignore`. Every fresh clone must run `pnpm --filter @brain/db prisma generate` before `tsc`, `pnpm build`, or `docker build`.

### 12.5 Build toolchain — webpack required for NodeNext imports

`apps/web` must be built with `next build --webpack` (not Turbopack). The cause is NodeNext module resolution: workspace packages export `.js` extensions in their `exports` map but the actual files are `.ts`, and Turbopack does not yet support `extensionAlias` to remap them. The `next.config.ts` sets `bundler: "webpack"` to enforce this. If a future Next.js or Turbopack release adds `extensionAlias`, the override can be removed — but validate with `next build` before switching.

### 12.14 The auth-mode truth table (2026-04-24, updated for Credentials)

Four mutually-exclusive modes, determined at runtime by `adminCredentialsConfigured()` + `authConfigured()` + `devAuthAllowed()` in `apps/web/auth.ts`. Priority is top-down — the first row whose precondition matches is the active mode.

| `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` | `AUTH_GITHUB_ID`+`SECRET`+`AUTH_SECRET` | `ALLOW_DEV_AUTH` | Effective mode | Behaviour |
|---|---|---|---|---|
| Both set, non-empty | any | any | **`CREDENTIALS`** (or `CREDENTIALS+OAUTH` if GitHub also set) | `/signin` renders a username + password form (and a GitHub button when OAuth is also configured). JWT cookie on success; signout clears it. `/api/*` requires the cookie. |
| Empty/missing | All three set, non-empty | any | `OAUTH` | `/` → `/signin`; GitHub button only; same gate semantics |
| Empty/missing | Empty/missing | `"true"` | `DEV_SHIM` | `/api/*` returns first User row to every caller; signout is a no-op |
| Empty/missing | Empty/missing | `"false"` / unset | `UNCONFIGURED` | `/api/*` → 503 `auth_not_configured`; deployment is a locked door |

**Credentials mode is the phase-1 pilot default.** One operator, one admin account, no OAuth App required. Password is stored as a bcrypt hash (cost 12) — anyone with read access to the hash can brute-force it offline but pays ~200 ms per guess, and the file is `chmod 600 .env.local` so read access requires root (or the operator). Generate the hash via `pnpm hash-admin-password '<plaintext>'` (the helper lives at `scripts/hash-admin-password.ts`; it refuses passwords shorter than 12 chars).

**Signout semantics follow the mode.** In `CREDENTIALS` or `OAUTH` mode, `/signout` POSTs a NextAuth signOut server action that clears the JWT cookie; next `/api/*` call returns 401 until the user signs back in. In `DEV_SHIM` mode, signout is cosmetic — there's no session to end, and the app keeps serving the dev user. The canonical "signed out but still see the app" symptom means either (a) the browser has a cached response (hard-refresh), or (b) the deployment is accidentally in DEV_SHIM mode because one of the credentials/OAuth modes is mis-configured.

**Earlier dev-shim trap, now closed**: when `AUTH_GITHUB_ID=""` + `AUTH_GITHUB_SECRET=""` + `ALLOW_DEV_AUTH=true`, `authConfigured()` returned false (empty strings are falsy) and the server took the dev-shim path unnoticed. With Credentials mode as the default pilot posture, the trap is defused — operators populate `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` at setup and never touch the GitHub envs until later.

**The trap the `authConfigured()` check is vulnerable to**: `AUTH_GITHUB_ID=""` (empty-valued) with `ALLOW_DEV_AUTH=true` yields `DEV_SHIM`, **not** OAuth. An operator who "configured" OAuth by putting the key names in `.env.local` but left the values empty gets a silently-dev-shim deployment. Since dev-shim serves every caller as the first User row, public exposure of a dev-shim host is a full read-leak of that user's knowledge corpus.

**Diagnostic for a live stack**:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://<host>:3000/api/me
# 200 → dev-shim or OAuth signed-in
# 401 → OAuth required, not signed in
# 503 → unconfigured (secure-by-default locked door)
```

A 200 with a signed-in browser plus a 200 from curl-with-no-cookies = dev-shim. That's what happened on the legacy host 2026-04-24. See `docs/SECURITY.md §"The 'declared-but-empty OAuth env' trap"` for the fix.

**Signout semantics follow directly from the truth table.** In `OAUTH` mode, signout clears the JWT cookie and the next `/api/*` request returns 401. In `DEV_SHIM` mode, signout is cosmetic — there's no session to end, and the app will keep serving Alex to every visitor until `ALLOW_DEV_AUTH` is flipped off AND the OAuth envs are populated AND the containers are restarted. "I signed out but the app still loads" is the canonical DEV_SHIM-misconfigured-as-OAuth symptom.

### 12.13 Docker build cost is real but cacheable (2026-04-24, measured)

A canonical fact operators need to plan around: the `apps/web` image is the tall pole in every deploy because `next build --webpack` is single-threaded and walks 28 API routes + 6 client surfaces + i18n + RSC. Measured on the legacy host:

| Scenario | Wall time | Webpack compile |
|---|---|---|
| First-ever build (no Docker cache, no BuildKit cache) | ~20–30 min | ~15–20 min |
| Warm Docker cache, cold `.next/cache` | 3 min 9 s | 112 s |
| Warm Docker cache, hot `.next/cache` (1-line source change) | 2 min 29 s | 40 s |

The three BuildKit cache mounts in `deploy/Dockerfile` (pnpm store, webpack module cache, swc intermediates) and the `BUILDX_NO_DEFAULT_ATTESTATIONS=1` flag in the deploy scripts prevent *recurrence* of the 20–30 min cost, not its first occurrence. A new VM takes the hit once; every subsequent rebuild stays in the 2–3 min band until something wipes the builder (`docker buildx prune`, `docker system prune --all --volumes`, or a fresh BuildKit version bumping the cache format).

**Operational implication.** If a deploy suddenly goes back to 20+ min after being consistently ~3 min, something wiped the BuildKit builder — `docker buildx inspect default` will say `Status: stopped` or show a fresh UUID. Re-running the deploy populates it again.

The structural lock-in is `bundler: "webpack"` in `apps/web/next.config.ts`, required because Turbopack doesn't yet support `extensionAlias` (workspace packages publish `.js` in their exports map but the source files are `.ts`). When Turbopack closes that gap we can drop the override and the `.next/cache` mount becomes obsolete. Until then, webpack's module cache is the knob that matters.

See `deploy/DEPLOY.md §"Build speed"` for the full table and `docs/GUIDELINES.md §10` for the Dockerfile pattern.

### 12.12 AI-readable log envelope (2026-04-24)

Errors that cross a service boundary — HTTP response, MCP tool reply, worker job completion — carry a fixed, machine-parseable shape. This is normative: a new error type may not be invented with a different shape, and a new boundary may not omit it.

**The envelope.** `BrainError` from `@brain/core` with fields `{code, category, message, remediation?, retryable, status?, cause?, fields?}`. Values:

- `code` — stable `SCREAMING_SNAKE_CASE` identifier. Never renamed after first release (doing so is a breaking change to observability clients).
- `category` — one of `auth | db | http | llm | embedding | validation | rate-limit | external | config | internal`. Do not add categories casually; each is wired into `statusForCategory()` for HTTP envelope generation.
- `message` — human-readable sentence. Free-form; describes *what happened*.
- `remediation` — short imperative sentence. Describes *what to do*. Optional only when the fix is truly obvious from the code; prefer to fill it.
- `retryable` — whether the caller should expect a retry to succeed.
- `status` — override for the HTTP status when surfaced through `withApi`. Usually inferred from `category`.
- `cause` — the inner error. Serializes to the same shape recursively.
- `fields` — structured context. Redacted by `redactFields()` before logging.

**Serialization.** The pino `err` / `error` serializer is `serializeError()`, which produces `{name, code, category, message, remediation, retryable, stackHead, cause?}` with `stackHead` being the top 3 stack frames trimmed to `file:line:col` strings. This is the shape an AI agent reads.

**Propagation.** `withRequest(id, fn)` scopes a `requestId` via AsyncLocalStorage through all nested `log.*()` calls. `apps/web/lib/brain/log.ts::withApi(op, handler)` wraps a Next.js route with request-id + timing + envelope logging; MCP stdio/HTTP and the pg-boss worker jobs use the equivalent pattern directly. Every mutating boundary emits exactly one structured line with `{op, durMs, outcome}`.

**Secrets.** `redactFields()` walks to depth 4 and scrubs keys matching (case-insensitive) the set in `packages/core/src/logger.ts::REDACT_KEYS`. The audit log, the Sentry `beforeSend` hook, and `captureError` all invoke it. Adding a new secret-shaped field name means extending `REDACT_KEYS` in the same PR.

This envelope is what makes failures debuggable by a future agent — human or AI — reading the logs without access to the current session. See `docs/GUIDELINES.md §7b` for the enforcement checklist and `docs/APPROACH.md §5p` for the rationale.

### 12.16 Installer endpoints + SKILL endpoint (2026-04-26)

Brain ships three public, unauthenticated endpoints per deployment that contain no per-user secrets:

- **`GET /api/onboard.sh`** — POSIX bash installer. Accepts the bearer token as a runtime argument (`bash -s 'bp_…'`) so the URL itself is publicly cacheable. Calls `claude mcp add` with `--scope user` and downloads the SKILL.md.
- **`GET /api/onboard.ps1`** — Windows PowerShell installer. Same bearer-at-runtime pattern; exposes an `Install-Brain -Token 'bp_…'` function after dot-sourcing.
- **`GET /api/skills/brain`** — Serves a templated `SKILL.md` with `{{MCP_URL}}` and `{{WEB_URL}}` substituted per deployment. Teaches MCP-aware clients when and why to use Brain's 9 tools.

**Invariant:** these three endpoints must remain unauthenticated and contain no per-user data. The bearer token is taken at install-time by the operator; the endpoints themselves are safe to CDN-cache and share publicly. Any per-user personalization (e.g. pre-filling the bearer) happens in the client-side wizard at `/settings/tokens`, not in the installer URL.

### 12.15 MCP token rotation chain + `scheduledRevokeAt` semantics (2026-04-25)

`MCPToken` gained two columns in migration `20260425_token_rotation_grace`:

- `scheduledRevokeAt DateTime?` — when this timestamp is set and `<= NOW()`, the auth gate in `apps/mcp-server/src/auth.ts` rejects the token. The revocation is enforced at the gate, not deferred to the worker. The worker tick (`tokens.scheduled-revoke`, every 5 min) bulk-sets `revokedAt = scheduledRevokeAt` on past-grace rows as a cleanup backstop so the normal "active = revokedAt IS NULL" query continues to work.
- `rotatedFromId String? @unique` — back-pointer to the predecessor token in a rotation chain. The `@unique` constraint is the chain-depth-1 enforcement: only one pending rotation per token. A token with an existing `rotatedFromId` entry pointing at it cannot itself be rotated until the chain settles (the endpoint returns `409 token_rotation_pending`).

**Auth gate invariant:** a token is valid for authentication if and only if all of the following hold:
1. `revokedAt IS NULL`
2. `scheduledRevokeAt IS NULL OR scheduledRevokeAt > NOW()`
3. `expiresAt IS NULL OR expiresAt > NOW()`

**Rotation audit:** `writeAudit({ action: "token.rotate", payload: { oldTokenId, newTokenId, graceHours } })` — the raw token value is never logged.

**New token lifetime:** the replacement token's `expiresAt` mirrors the original token's TTL window (days from creation of the original), not days from the rotation date. This preserves the operator's intended token lifetime across routine rotations.

### 12.11 Admin surface + audit log (Wave 3, 2026-04-22)

Six admin endpoints live under `/api/admin/*` gated by `requireAdmin()` from `apps/web/lib/brain/admin-auth.ts` — which reads `User.role === "admin"` and throws `AuthError("admin_required", 403)` otherwise. Admin role is provisioned manually (`UPDATE "User" SET role='admin' WHERE email=…`) because a self-service grant flow would defeat its own purpose.

Every mutating admin action, plus every user-visible knowledge + token mutation, writes an `AuditLog` row via `writeAudit({actorUserId, action, targetType, targetId, payload, ip, userAgent})` from `@brain/core/audit`. The `payload` is deep-redacted against the key pattern `token|secret|password|apiKey|authorization` before serialization. Indexes on `(actorUserId, createdAt)`, `(action, createdAt)`, and `(targetType, targetId)` make the admin-surface queries cheap.

**The log is append-only by contract** — not enforced by DB permissions, but no code path anywhere in the repo deletes an `AuditLog` row. GDPR soft-erase (`POST /api/admin/users/[id]/erase`) cascades through knowledge, sessions, tokens, cost ledger entries, but **leaves audit rows in place** — the audit of the erase is the record compliance requires. User FKs in audit rows therefore need LEFT-JOIN semantics.

---

### 12.17 Organization ownership invariants (Phase 1, 2026-04-27)

Three invariants added when the `Organization` layer landed:

1. **Every `Project` belongs to exactly one Organization.** `Project.organizationId` is `NOT NULL` after migration `20260427125332_organization_required_on_project`. Any code that creates a `Project` row must supply a valid `organizationId`; the DB rejects the insert otherwise.

2. **Every User has at least one Organization (their personal one).** The personal org is created idempotently by `ensurePersonalOrg(db, userId)` from `@brain/core`. This is called on first sign-in and whenever a user-scoped resource is created. The personal org id is `org_<userId>` and slug is `personal-<userId.slice(3,15)>`.

3. **MCP tokens may be scoped to an organization.** `MCPToken.organizationId` is nullable — a personal token (`scope: "personal"`) does not require an org scope; a team or org-scoped token sets this field.

These invariants are enforced at the DB level (FK + NOT NULL on Project) and by the helpers in `packages/core/src/org.ts`. Route handlers that create Projects must call `ensurePersonalOrg` first to obtain the `organizationId`.

---

### 12.18 Project slug + default-project invariants (Phase 2a, 2026-04-27)

Four new invariants established in Phase 2a:

1. **Every `Project` has a `slug` field.** `Project.slug` is `NOT NULL` after migration `20260427_add_project_slug`. Slugs are URL-safe lowercase strings (`[a-z0-9-]+`). The `slugify()` helper in `@brain/core/org` derives the slug from the project name; `uniqueSlugInOrg()` appends `-2`, `-3`, etc. if the candidate is already taken within the org.

2. **Project slugs are unique within an organization.** `@@unique([organizationId, slug])` on the `Project` model enforces this at the DB level. A caller that wants to rename a project should call `uniqueSlugInOrg(db, orgId, candidate, excludeProjectId)` — passing the project's own id as `excludeProjectId` prevents the project from blocking its own rename.

3. **Every user has at least one Project.** `ensureDefaultProject(db, userId)` in `@brain/core/org` is idempotent: if the user has any project in their personal org, it returns that project; otherwise it creates one with `name: "Default"`, `slug: "default"`. Callers in the API layer invoke this lazily on first need (the `getActiveProject` resolver). No automatic creation happens on sign-in — creation is deferred until the active-project cookie is first resolved.

4. **The active project is a session-scoped cookie, not a DB field.** The `bp_active_project` HTTP-only cookie stores the project id of the "currently selected" project. It is set by `POST /api/projects/:id/activate`. The server-side resolver (`apps/web/lib/brain/active-project.ts`) falls back to the first project in the user's org list when the cookie is absent or points to a stale id. Deleting the cookie (or letting the browser session expire) resets to the fallback, never to a broken state.

---

### 12.19 Per-project listing invariant (Phase 2b, 2026-04-25)

By default, any Knowledge/Session/Autoskill-proposal listing shows **the active project's data plus the user's project-less personal knowledge** (rows where `ownerProjectId IS NULL AND ownerUserId = currentUserId`). The listing never shows another user's knowledge or another project's knowledge without an explicit scope opt-out.

**Retrieval is deliberately wider than listing (2026-07-30, #174).** Personal-rule
retrieval — `kra.ts`'s candidate fetch and the Oracle's context build — additionally
admits the caller's own `scope IN ('user','global')` rows regardless of which project
they were written under, via the opt-in `includeUserScopeAcrossProjects` flag. A rule
you taught once should apply everywhere you work; a *listing* is a browsing surface
where project focus is the point. The widening is per-call-site rather than global
because `action-items.ts` treats the project edge as the isolation line for tasks, and
`meeting-extract.ts`'s supersession search is intentionally project-wide but not
owner-scoped — both would be breached by a blanket change. `ownerUserId` remains the
anchor in every branch: cross-project reach never becomes cross-user reach.

The two helpers backing this — `buildKnowledgeWhereV2` (Prisma listings) and
`buildRawProjectFilterV2` (raw pgvector) — express **one** policy on two query
surfaces and must be changed together. The "wider than listing" difference above
applies only where an active project supplies a boundary; with none, both admit
the same rows, and under `?scope=all` with no org context both return everything
the user owns.

**Three surfaces are narrower in their default** — the dashboard, the graph and
the rules exporter still call the pre-Phase-4 V1 helper. V1 does reach across
projects under `DataScope: "all"`, but under its `"project"` default it consults
only `ownerProjectId`, never `Knowledge.scope` — so it cannot filter to a project
while still admitting the caller's `user`-scoped rules from elsewhere. The
**The rules exporter was fixed on 2026-08-01** and now always admits them, so
the exported set matches the served set — a rules bundle is the agent's
configuration, not a project view. The dashboard and graph keep the
project-scoped default on purpose, which is the same retrieval-is-wider-than-
listing distinction drawn above. See `KNOWN_ISSUES §0p`; note the fix is an
owner-anchored opt-in on V1, *not* a migration to V2, because V2's
`visibility: 'project'` arm has no `ownerUserId` predicate and would also
surface teammates' rows.

The "all my projects" scope (`?scope=all`) shows everything the authenticated user owns across all projects. It does not show knowledge owned by other users, even within the same org.

Org-level cross-project sharing (a team member viewing another member's project) is Phase 4. Until Phase 4 lands, `ownerUserId` is always the filter anchor regardless of scope.

These invariants are enforced by the builder helpers in `packages/core/src/scope-filter.ts`. Any new Knowledge/Session-style listing **must** apply the project filter via `getActiveProject(userId)` + the appropriate `buildKnowledgeWhere` / `buildSessionWhere` / `buildProposalWhere` helper. A listing that omits the filter is a data-leak bug.

### 12.20 Last-owner protection invariant (Phase 3a, 2026-04-25)

An organization **always has at least one owner**. `setOrgMemberRole` and `removeOrgMember` both refuse when the operation would remove or demote the last owner row (`count({role:"owner"}) <= 1`). They throw `BrainError{code:"LAST_OWNER", status: 409}` in that case.

This is enforced at the core-helper layer (`packages/core/src/org.ts`) and applies regardless of caller role. Even an org owner cannot self-demote below owner when they are the last one.

To transfer ownership: promote a second member to owner first, then demote the original.

### 12.21 MCP token project-scope invariant (Phase 3c, 2026-04-27)

MCP tokens may be scoped to a specific project by setting `MCPToken.projectId`. The invariant:

**When `token.projectId` is set, the token cannot perform writes against any other project — the auth gate rejects with `BrainError{code:"FORBIDDEN_PROJECT", category:"auth", status:403}`.**

Specifics:
- `authenticate()` in `apps/mcp-server/src/auth.ts` returns `projectId` (and `organizationId`) in the `AuthContext`.
- Tool handlers that write project-scoped data (`brain_start_session`, `brain_teach_knowledge`) compare the caller's requested `projectId` against `auth.projectId`. If both are set and they differ, the handler throws `FORBIDDEN_PROJECT` before touching the DB.
- If `auth.projectId` is set and the caller does not specify a project, `auth.projectId` is used as the default — the write proceeds to the token's bound project.
- If `auth.projectId` is null (unscoped token), the Phase 2b first-project fallback applies unchanged.

**Rotation/change preserve scope.** `POST /api/tokens/:id/rotate` carries `projectId` from the old token to the new row. `POST /api/tokens/:id/change` is in-place and retains `projectId` untouched.

**Null means "any project the user has access to."** A token with `projectId = null` is not scoped — it behaves as before Phase 3c.

**The invariant now covers reads as well as writes (v2.10.0).** It was
write-only until the 2026-08-02 pre-release audit found the gap
(`KNOWN_ISSUES §0q`): `brain_retrieve_knowledge` took `projectId` from *client
input* and never compared it, and the Oracle, skill search, session search and
all four `brain://` resources ignored the token's scope entirely. That was
never a cross-tenant hole — `kra.ts` and `oracle.ts` hard-pin
`"ownerUserId" = $2` outside the visibility filter — but it made the scope a
promise the product only half kept.

Read enforcement lives in **one** resolver, `apps/mcp-server/src/scope.ts`,
which every read path calls. One helper rather than four copies is deliberate:
the audit's central finding was that this codebase's dominant defect shape is
hardening applied in one place and not its siblings (`GUIDELINES §4`).

- **Enforced:** `brain_retrieve_knowledge`, `brain_ask_oracle`,
  `brain_session_search`, `brain://user/style-profile`,
  `brain://user/recent-sessions`.
- **A foreign `projectId` throws `FORBIDDEN_PROJECT`** rather than being
  silently narrowed to the token's project. A caller that asked for project B
  and received project A's answers has been handed wrong data, not less data.
- **Deliberately NOT scoped — a schema fact, not an omission:**
  `brain_find_skill` and `brain://user/active-skills` read `Skill`, which has
  **no `ownerProjectId` column**. There is no project boundary to cross, and
  filtering on one that doesn't exist would return nothing.
  `brain://user/peer-card` reads the user-level card (`ownerProjectId IS
  NULL`), which is a user fact by definition.

**Skills are not project-partitioned, and will not be (decided 2026-08-03).**
`Knowledge` is atomic and project-bound; a Skill is a portable recipe that the
exporter writes into `.claude/skills/` and `.cursor/rules/`, and that
`BLUEPRINT §11.2` plans to distribute as packs. Adding `ownerProjectId` also
has no truthful backfill — a skill is distilled from work that may span several
projects — and would force the `(skillId, ownerUserId)` unique key to either
duplicate skills per project or leave the column advisory. If a scoped token
must be kept away from skills, the right primitive is a **token capability**,
not a partition of the data model — and that primitive now exists.
Rationale in `KNOWN_ISSUES §0q` and `APPROACH §5bi`.

### 12.21a MCP token capabilities (v2.12.0)

`MCPToken.capabilities` is an allow-list of slugs — `knowledge`, `skills`,
`sessions`, `oracle`. **Empty means unrestricted**, and that contract is the
whole reason this was safe to add to a live table: every pre-existing token
keeps exactly the authority it had, and there was no ambiguous value to
backfill. The *absence* of such a value is precisely why `Skill.ownerProjectId`
was rejected above — the same test, applied twice, giving opposite answers.

- **Allow-list, not deny-list.** A deny-list would silently grant every
  capability invented later to every already-restricted token. An allow-list
  fails closed as the surface grows, which is the direction a security
  primitive should fail.
- **One enforcement point** — `apps/mcp-server/src/capability.ts`, called by
  `brain_retrieve_knowledge`, `brain_teach_knowledge`, `brain_find_skill`,
  `brain_session_search`, `brain_ask_oracle`, and the `active-skills` /
  `recent-sessions` resources. The empty-means-unrestricted decision lives in
  `@brain/core`'s `hasCapability`, so no call site can reimplement it wrongly.
- **Session lifecycle is deliberately exempt.** `brain_start_session`,
  `brain_log_event`, `brain_report_session_outcome` and the project tools carry
  no capability check: a token that cannot open a session is not a token, it is
  a confusing way to spell "revoked".

Two axes, kept distinct: `projectId` bounds **where** a token acts (§12.21);
`capabilities` bounds **what it may do**.

### 12.22 Knowledge visibility — three states, promote/fork chain (Phase 4, 2026-04-27)

Knowledge rows carry a `visibility` column (TEXT, NOT NULL, DEFAULT `'project'`) that controls who sees the row in listing and retrieval contexts. It is distinct from the `scope` column (which carries semantic context like `user`/`project`/`team`/`community`/`global`/`session_context` — used by KEA and the formatter).

#### The three visibility states

| Value | Visibility in listings | Use case |
|---|---|---|
| `"private"` | Only `ownerUserId`, regardless of project context | Personal notes not yet ready to share |
| `"project"` | **Default.** All org members whose active project matches `ownerProjectId` | Standard project-local rule |
| `"org"` | All org members across any project in the same org | Shared team conventions; elevated from project |

**Migration.** All rows created before Phase 4 default to `"project"` — no behavioral change for them.

#### Promote-to-org

A project-local rule (`visibility="project"`) can be elevated to org visibility by its owner:

```
POST /api/knowledge/:id/promote
```

- Guard: `ownerUserId === current user`, `visibility === "project"`, `ownerProjectId != null`
- Effect: `visibility → "org"`, `originProjectId → current ownerProjectId`
- After promotion, all projects in the org see the row in their listings.
- The `originProjectId` field records which project first created the rule (audit trail).

#### Fork-into-project

An org-visible rule can be pulled down into a specific project as a local override:

```
POST /api/knowledge/:id/fork-to-project
Body: { projectId? }   // defaults to active project
```

- Guard: `source.visibility === "org"`, source + target projects in same org, user is org member
- Creates a new `Knowledge` row with:
  - `visibility = "project"`
  - `ownerProjectId = targetProjectId`
  - `parentKnowledgeId = source.id` (fork chain — same as fork-on-edit)
  - `originProjectId = source.originProjectId ?? source.ownerProjectId` (chain preserved)
- The fork has `confidence = max(0.5, source.confidence - 0.1)` — forked rules start slightly lower.

#### Chain invariant

`originProjectId` always points back to the project where the rule was first created, even after multiple promote + fork hops. This enables traceability:

```
proj_a → promote → visibility="org", originProjectId="proj_a"
       → fork(proj_b) → visibility="project", ownerProjectId="proj_b", originProjectId="proj_a"
       → fork(proj_c) → visibility="project", ownerProjectId="proj_c", originProjectId="proj_a"
```

#### Visibility as a listing filter (not an ACL)

The `visibility` column is a **listing/retrieval filter** — it controls what appears in the UI and what the KRA/Oracle retrieval surfaces return. It is NOT a hard access-control layer. A project-scoped MCP token still cannot write to another project regardless of what `visibility` values exist on Knowledge rows. For the hard ACL rules, see §12.21.

### 12.23 Password reset token invariants (2026-04-29)

- `PasswordResetToken` rows are one-shot: `usedAt` is set on first use and any subsequent use of the same token returns `invalid_token`.
- Tokens expire after 1 hour (`expiresAt`); server-side validation rejects expired tokens regardless of `usedAt`.
- Tokens are anonymous-friendly: the endpoint that consumes them (`POST /api/auth/reset-password`) requires no session.
- `POST /api/auth/forgot-password` always returns HTTP 200 regardless of whether the email exists (enumeration guard).
- Tokens are cascade-deleted when the owning `User` row is deleted (ON DELETE CASCADE).

### 12.28 Vocabulary lock — the five user-facing words (2026-05-20)

The webapp deliberately uses a small fixed vocabulary in user-visible copy. The full glossary is at `/docs/concepts/vocabulary` (also rendered in the webapp's docs index under "Start here"). Summary:

| User-facing word | Meaning | DB / API name (when different) |
|---|---|---|
| **Brain** | The shared memory layer; your collection of skills | (no separate API term) |
| **Skill** | One rule/recipe/principle the Brain learned or you taught | `Knowledge` (table + Prisma model) |
| **Session** | One conversation with an AI coding tool | `Session` (table) |
| **Oracle** | The Q&A surface | `/api/oracle`, `oracle.ask`, `oracle.askStream` |
| **Proposal** | A candidate skill awaiting review | `AutoskillProposal` (table); route is `/autoskill` for backwards compat |

Advanced acronyms (tooltip-only, never in primary copy): **KEA** (Knowledge Extraction Agent), **KRA** (Knowledge Retrieval Agent), **MCP** (Model Context Protocol), **SQS** (Session Quality Score).

The glossary page is translated (TH/DE) as of #59, but the five user-facing **words themselves stay in Latin script** in every locale — the TH/DE prose explains "Brain / Skill / Session / Oracle / Proposal" rather than substituting native nouns, so the vocabulary stays a single shared lock across languages (matching the `i18n.ts` convention of keeping product/technical terms untranslated).

The discipline behind locking the vocabulary lives in `docs/APPROACH.md §5ag` — "vocabulary drift is the third newcomer-eye finding class." The two earlier classes (decorative state, leaked identifiers) are in §5af.

### 12.27 Newcomer-eye copy & label discipline (2026-05-19)

The user-facing copy in the webapp has a load-bearing relationship to onboarding. The 30-iteration sweep (early PRs) established these conventions:

| Where text appears | Rule |
|---|---|
| Chips for internal identifiers (model id, queue name, client wire-tag) | Humanize via a small mapper (`clientLabel()` for clients, friendly org+project name for scope), OR hide the chip entirely. Never leak raw IDs. |
| Counts that can be zero ("0 pending", "0 items") | Pair with a friendly zero-state ("Up to date", "Just getting started") — bare zeros read as "the app is broken." |
| Page-level breadcrumbs | Render only the current route. Parent-category crumbs ("Workspace / Activity") are decoration; the rail already shows section grouping. |
| Filter chips that update state | Either wire to a visible content filter OR remove them. State-only chips with no consumer fail the newcomer's "did my click do anything?" test. |
| Error messages for misconfiguration | Point the user at the operator or at `docs/SECURITY.md`. Do NOT leak env-var names (ADMIN_USERNAME, ALLOW_DEV_AUTH, …) into copy a first-time visitor reads. |
| Empty-state copy | Pair the observation with the next step ("No sessions yet — start one from Claude Code, Cursor, or any MCP client"). Dead-end empty states leave the visitor stranded. |
| Trend deltas (SQS chip, etc.) | Only render when ≥3 real data points + non-zero delta; format as "+0.32 trend" not "→ -1.00" (arrow + signed number is visually ambiguous). |

The full per-iteration log lives in early PRs commit messages; the longer-form rationale is in `docs/APPROACH.md §5af`.

### 12.25 Deterministic test fixture — `prisma db seed` (2026-05-17)

The platform ships a single canonical fixture used by both local dev iteration and the playwright e2e suite. Wired via `packages/db/prisma.config.ts#migrations.seed` (Prisma 7 location, not the deprecated `package.json#prisma.seed`) and run with `pnpm --filter @brain/db exec prisma db seed`. The local bring-up `scripts/dev-up.sh` seeds the fixture by default (`SEED_ON_DEPLOY=true`); the server `scripts/deploy.sh` hard-sets `SEED_ON_DEPLOY=false` so the live server never seeds fixture data. e2e and ad-hoc setups can also run the seed command directly.

The fixture is **load-bearing** — playwright specs assert on the counts directly:

| Table | Count | Notes | Asserted by |
|---|---|---|---|
| User | 1 | Alex, `role=admin` | implicit (admin pages render) |
| Organization | 1 | Alex personal | — |
| OrganizationMember | 1 | owner | — |
| Project | 1 | Default | — |
| Session | 6 | 4 success / 1 partial / 1 failed | `sessions.spec.ts` ≥ 6 |
| Knowledge | 16 | 5 types covered; `scope=user` | `skills.spec.ts` ≥ 16; `onboarding.spec.ts` keeps modal closed when ≥ 1 |
| AutoskillProposal | 4 | mix of high/medium confidence | `autoskill.spec.ts` ≈ 4 |

Idempotency: all writes are `upsert` with deterministic ids prefixed `seed_`. A second invocation is a no-op. Cleanup is one query: `DELETE WHERE id LIKE 'seed_%'`.

Embeddings are populated by the worker's `embeddings.backfill` job (every 10 min) — the seed itself leaves them NULL. Tests that need semantic retrieval should wait for the backfill OR run `pnpm --filter @brain/worker backfill:embeddings` manually after seeding.

**Why never on the server:** the seed creates an admin user (Alex). Running it on the live server would create a privileged account that bypasses the voucher gate. `scripts/deploy.sh` exports `SEED_ON_DEPLOY=false` explicitly — the audit-friendly form of "we definitely don't want fixture data on the server."

### 12.26 Oracle SSE frame schema — encoder + parser pair (2026-05-17)

The Oracle stream (`POST /api/oracle/stream`) is the only LLM-facing wire-format contract that crosses the HTTP boundary. The TypeScript types in `oracle.ts` (`OracleStreamEvent` discriminated union) constrain server code; they cannot constrain what's actually written to the SSE socket. The encoder/parser pair at `packages/core/src/oracle-sse.ts` (writer) + `packages/core/src/sse.ts` (reader) carries that contract.

**Frame shape:**

```
event: <name>\n
data: <JSON payload>\n
\n
```

Per-event payload schemas (locked by `oracle-sse.test.ts`):

| Event | Fields | Notes |
|---|---|---|
| `meta` | `groundedness`, `retrievedCounts` | Emitted immediately after retrieval, before LLM call |
| `delta` | `text` | Streamed tokens; clients append to current message |
| `final` | `citations`, `confidence`, `groundedness`, `retrievedCounts`, `relatedQuestions`, `tokensUsed` | Terminal answer frame |
| `error` (cap) | `code: "cost_cap_exceeded"`, `message`, `spentUsd`, `capUsd` | UI special-cases `code` to render budget copy |
| `error` (other) | `message` | Generic failure |
| `done` | `{}` | Always last; signals clean close vs socket reset |

The `kind` discriminator on the server-side `OracleStreamEvent` is intentionally **stripped** at the wire layer — leaking it would couple the UI to internal naming.

### 12.29 Per-session value drill-down — `GET /api/sessions/:id` (2026-05-23)

The Sessions table has always shown counts in the `K in/out` column (skills retrieved into the session vs new skills extracted from it), but never the *names* of the items. As a result the round-trip felt opaque — the user could see "5 / 3" but not which 5 skills the Brain provided or which 3 it learned.

`GET /api/sessions/:id` returns:

```ts
{
  session: { id, prompt, clientType, startedAt, endedAt, outcome, sqs, projectName, projectSlug },
  injected:       [{ id, type, triggerText, ruleText, appliedAt }],  // role="injected"       — Brain → session
  extracted_from: [{ id, type, triggerText, ruleText, appliedAt }],  // role="extracted_from" — session → Brain
}
```

**Client provenance.** `clientType` is the wire-tag of the agent that opened the session — an open `String` (not a DB enum), so the client set grows without a migration. As of v1.7.0 it spans `claude_code`, `cursor`, `windsurf`, `gemini` (Gemini CLI), `antigravity`, `github_copilot`, `autobahn`, `custom`, and `webapp`; `clientLabel()` humanizes each for display and falls back to "MCP client" for unknown tags. Provenance is descriptive metadata only — it never affects retrieval or scope filtering, which key off owner/project. **Historical note (2026-08-07):** Google retired Gemini CLI for consumer accounts and folded it into Antigravity CLI (`KNOWN_ISSUES §0z`) — `gemini` now tags sessions from that legacy/enterprise-only path specifically, distinct from `antigravity`. Existing rows keep their original tag; nothing retroactively relabels past sessions when a client is renamed or retired upstream, matching immutability invariant 1.

**Auth invariant.** A session is readable by its owner OR by a member of the org that owns the session's project. The `OR` keeps personal sessions (no `projectId`) reachable for their owner without an org-membership probe; org-scoped sessions are reachable by all members so cross-user collaboration on a shared project surfaces the round-trip correctly. Soft-deleted Knowledge rows are filtered at the API layer — we surface what the user can act on, not what's tombstoned.

**Role split is load-bearing.** `SessionKnowledgeApplication.role` has four values: `injected` (skill retrieved INTO the session by KRA), `retrieved_but_not_used` (matched but skipped — diagnostic, not user-facing), `extracted_from` (new Knowledge KEA pulled OUT of the session), and `used_reported` (v1.13.0 — the close call's `knowledgeUsed` ids, i.e. what the agent claims it actually applied; feeds the loop-health injection→used rate and is deliberately owner-scoped + FK-re-derived so a caller can't write rows against another user's knowledge). The endpoint only returns the first and third — `retrieved_but_not_used` is operator telemetry, not user-facing value. If a future surface needs the "almost-matched" set, add a separate role filter rather than overloading this response.

**Client wiring.** `apps/web/lib/brain/use-session-detail.ts` is intentionally minimal — no SWR cache, no revalidation — because session details are inspected rarely (one user click → one fetch) and stale-while-revalidate adds complexity without benefit. `SessionDetailPanel` renders the two halves as a two-column grid that stacks on mobile via `.session-detail-grid` (a single `@media (max-width: 880px)` rule in `globals.css`). The rows in `Sessions` table become `role="button"` with Enter/Space handlers and `aria-expanded` / `aria-controls`, so keyboard users get the same drill-down.

**Why this is per-session, not per-project (yet).** A project-level "value summary" card on the Dashboard ("Brain has learned N skills from this project; your sessions have used skills M times in the last 30 days") was deliberately deferred. The right time to build the aggregate is after observing whether users actually open the per-session panel — premature aggregation would just add another surface to optimize before knowing if the underlying signal lands. See `APPROACH.md §5ah` on validation-before-aggregation. **Update 2026-05-24:** an early PR landed the aggregate after the per-session view was confirmed to land — see §12.30.

---

### 12.30 Per-project value drill-down — `GET /api/projects/:id` (2026-05-24)

One level up from §12.29, with the same shape and the same load-bearing
role split. The endpoint groups every `SessionKnowledgeApplication` row
under the project by `(knowledge.id, role)`, returning two ranked lists:

```ts
{
  project: { id, slug, name, organizationId, framework, language, createdAt },
  injected:  [{ id, type, triggerText, ruleText, hitCount, lastAppliedAt }], // role="injected"        — Brain → sessions in this project
  extracted: [{ id, type, triggerText, ruleText, hitCount, lastAppliedAt }], // role="extracted_from"  — sessions in this project → Brain
  totals: { sessionCount, injectedCount, extractedCount },
}
```

**Auth invariant.** Any member of the project's organization. Mirrors
§12.29's policy — members already see each other's sessions through
the org-shared scope, so the project roll-up does not widen disclosure.

**Why now, and not at the same time as §12.29.** The per-session view
shipped first (an early PR) deliberately, so we could observe whether users
actually opened the panel before building the aggregate. They did,
which earned the right to ship the project-level aggregate (an early PR).
The principle codified in `APPROACH.md §5ah` (validate-before-aggregate)
held both directions: the per-session signal landed → project aggregate
becomes load-bearing rather than speculative; if it hadn't, we'd have
removed the per-session view instead of building on top of it.

**Aggregation semantics.** `hitCount` is the number of distinct sessions
in this project that applied the knowledge row in the given role —
*not* the total application row count. Two sessions that both retrieved
the same skill contribute `hitCount = 2` even if one of them retrieved
it twice. This matches the user-facing question ("how many of my
sessions has this skill helped?") rather than the operator-side
("how many retrieval events fired?").

**Output ordering.** `hitCount DESC, lastAppliedAt DESC` — relevance
first, recency as the tiebreak. Lets the panel truncate to top-N
without losing the most-load-bearing items.

**No new index.** The query joins
`SessionKnowledgeApplication → Session → projectId` and uses the
existing `(userId, projectId, startedAt)` Session index (DB5, #103).
The application scan is bounded by the project's session count, which
is small for typical org sizes; if a project ever crosses ~10k sessions
this becomes the right place to add a covering index, not before.

**Client wiring.** `apps/web/lib/brain/use-project-detail.ts` mirrors
`use-session-detail.ts` (no SWR, fetched on demand). `ProjectDetailPanel`
renders the two halves as a two-column grid plus a one-line value
summary. `ProjectsList` on the dashboard renders nothing for zero
projects, collapses to a single row for exactly one project, and shows
the full clickable list for ≥2 — the earned-surface-area pattern from
`docs/DESIGN_PRINCIPLES.md §2`.

---

### 12.31 MCP project management — AI-driven knowledge partitioning (v0.14.0, 2026-05-26)

AI agents can now create new Brain projects on demand via `brain_create_project`
or by passing `projectName` to `brain_start_session`. **Name matching is
aggressively normalized (v1.12.0): lowercase with every non-alphanumeric
stripped, so "Brain Platform", "BrainPlatform", and "brain-platform" resolve
to one project.** Free-text matching any looser than this accretes duplicate
identities at the rate agents rephrase names — the dogfood Brain grew three
identities for one repo in 7 weeks, and project-scoped retrieval cannot see a
sibling identity (repair: `scripts/merge-duplicate-projects.sql`; detection:
the loop-health panel's duplicate-identity row). All-punctuation names
(normalized "") never match each other. Two companion tools,
`brain_list_projects` and `brain_get_active_project`, let the agent inspect the
caller's projects before deciding whether to create or reuse one. This lets
knowledge be partitioned by project from the terminal — previously, all
sessions defaulted to the user's first project (the `ensureDefaultProject`
fallback from §12.18.3), causing knowledge from distinct workstreams to pile
into the same bucket.

Partitioning invariants (§12.17 — §12.21) are unchanged: the new tools create
rows that obey the same `organizationId` + `slug` + `ownerProjectId` rules.
Per §12.21, project-scoped MCP tokens cannot create projects — `brain_create_project`
returns `FORBIDDEN_PROJECT` and `brain_start_session` silently ignores
`projectName` for project-scoped tokens. Users who want MCP-driven project
creation must mint a user-scoped token at `/settings/tokens`.

---

### 12.24 Oracle thumbs feedback loop (MVP complete, 2026-04-29)

Oracle thumbs up/down on an answer bumps `successCount` (up) or `failureCount` (down) on each cited Knowledge row owned by the user, in real time.

**Wiring:** `apps/web/lib/brain/use-oracle.ts::sendFeedback` collects `citedKnowledgeIds` from `turn.citations` (filtering to rows where `knowledgeId` is a non-null string) and includes them in the `POST /api/oracle/feedback` body. The route handler (`apps/web/app/api/oracle/feedback/route.ts`) calls `db.knowledge.updateMany({ where: { id: { in: citedKnowledgeIds }, ownerUserId: userId }, data: { [field]: { increment: 1 } } })` where `field` is `"successCount"` for up-votes and `"failureCount"` for down-votes.

**Safety:** the update is scoped to `ownerUserId = userId` — a user cannot bump another user's counters even if they somehow learn a foreign knowledge ID. Best-effort: if the counter update fails, the feedback record (in the `Feedback` table) is still saved and the user is not notified of the error.

**Interaction with §12.13:** `effectivenessScore` is derived from `successCount / (successCount + failureCount)`. Thumbs feedback therefore directly affects the per-rule badge, KRA ranking, and decay half-life. The effect is additive with the MCP `brain_report_session_outcome` path — both code paths increment the same counters; there is no deduplication. In normal operation the two paths are complementary (Oracle answers → immediate thumbs; MCP session outcomes → end-of-session report).

---

## Oracle citation enrichment

Oracle citations now expose enriched metadata so the user can audit which rules contributed and why. Each `OracleCitation` carries an optional `meta` object (populated by `mapCitations` in `packages/core/src/oracle.ts`) with the following fields for knowledge rows: `knowledgeType`, `triggerText`, `effectiveness` (0..1 or -1 sentinel), `outcomes` (successCount + failureCount), `usageCount`, and `lastUsedAt` (ISO string). For session rows: `projectName`, `sessionStartedAt`, `sessionOutcome` ("success"|"failure"|"unknown"), and `clientType`. The `EffectivenessBadge` component shared between the Skills tab and Oracle citation cards uses the same `effectivenessScore()` helper from `knowledge-stats.ts` — no separate computation.

See `USECASES.md §3` for the screenshot-worthy mock and `docs/REST_API.md` for the full `OracleCitation.meta` shape.

## See also

- `BLUEPRINT.md` — product thesis, reference-system adaptations.
- `ARCHITECTURE.md` — 3-layer / 8-subsystem diagram.
- `USECASES.md` — the doctor/secretary analogies, autoskill.
- `APPROACH.md` — philosophy and decision framework.
- `KNOWN_ISSUES.md` — limitations, risks, and open questions.
- `NAVIGATION.md` — how Skills/Graph/Oracle surface the ontology in the UI.
- `USING_BRAIN.md` — daily-workflow guide: how operators trigger Knowledge writes (`remember this`), trigger reads (`ask the oracle:`), close sessions to fire KEA, and use the bulk-reset surface.
- [`AI Application diagram`](./assets/illustrations/ai_application.png) — visual: where LLMs and embeddings are used (KEA, KRA, Oracle, Autoskill).
- [`Process Logic diagram`](./assets/illustrations/process_logic.png) — visual: end-to-end session lifecycle as a sequence diagram.
- [`Skill Development diagram`](./assets/illustrations/skill_development.png) — visual: how knowledge extraction identifies and stores new skills.
- [`Knowledge Algorithm diagram`](./assets/illustrations/knowledge_algorithm.png) — visual: the state progression of knowledge evolution.
