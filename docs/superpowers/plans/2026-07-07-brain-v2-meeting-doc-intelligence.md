# Brain V2.0 — Meeting & Document Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two flagged platform features of the V2.0 spec (addressed action-item injection; Oracle task-awareness) plus the four protocol skills, dark (flags default-off), with zero Prisma migrations.

**Architecture:** Action items and open questions are `Knowledge` rows with a new code-only `type` value `"action_item"`, assignee in a `for:<email>` tag, project-bounded via the existing Phase-4 visibility helpers. Deterministic queries (not semantic retrieval) surface them: at `brain_start_session` for the assignee, and in the Oracle's context for anyone in the project. Retirement rides `brain_report_session_outcome`.

**Tech Stack:** TypeScript strict, Prisma (no schema change), zod, vitest (db-guarded integration tests), pnpm/turbo via CI only (this checkout cannot run gates locally — Node 18, no pnpm).

**Spec:** `docs/superpowers/specs/2026-07-07-brain-v2-meeting-doc-intelligence-design.md`

## Global Constraints

- **NO Prisma migrations** — `packages/db/prisma/migrations/**` must be untouched (keeps the autonomous CD envelope valid).
- **Flags default OFF**: `V2_ACTION_ITEMS` and `V2_ORACLE_TASKS`, `boolish(false)` in the `Shared` zod object of `packages/core/src/env.ts`. Flag-off behavior must be byte-identical to today.
- **`action_item` rows must never appear** in semantic retrieval bundles (`kra.ts`), the Oracle's semantic knowledge block, KEA/learnings validation (already excluded by its zod enum), or `SessionKnowledgeApplication` "injected" rows (metric purity for gate #149).
- **Assignee tag format**: `for:<email-lowercased>`. Kind tags: `action-item` or `open-question`; urgency tag: `blocker`; origin tag: `meeting:<YYYY-MM-DD-slug>`.
- Package boundary: `types → db → core → (mcp-server | web | worker)`.
- Conventional Commits; PR-1 branch `feature/v2-action-items` off `main`; PR-2 branch `feature/v2-oracle-tasks` off PR-1's branch; PR-3 (protocol docs) `docs/v2-protocol-skills` off `main`.
- Tests follow the db-guard pattern (`const guard = dbReachable ? describe : describe.skip`) used in `apps/mcp-server/src/__tests__/start-inject.test.ts`.
- Test env note: `envFor*()` memoizes — call `_resetEnvCache()` after mutating `process.env` in tests.

---

### Task 1: `action_item` type value + flags (PR-1 foundation)

**Files:**
- Modify: `packages/types/src/index.ts:13` (KnowledgeType union)
- Modify: `packages/core/src/env.ts` (Shared schema)
- Modify: `.env.example`
- Test: `packages/core/src/__tests__/env.test.ts` (extend)

**Interfaces:**
- Produces: `KnowledgeType` includes `"action_item"`; `envForMcp().V2_ACTION_ITEMS: boolean`; `envForWeb().V2_ORACLE_TASKS: boolean` (both on all three parsers via `Shared`).

- [ ] **Step 1:** Add `| "action_item"` to the `KnowledgeType` union in `packages/types/src/index.ts` (line 13 block), with a comment: `// V2.0: meeting action items / open questions — a task, not a rule; excluded from semantic retrieval (spec 2026-07-07)`.
- [ ] **Step 2:** In `packages/core/src/env.ts` add to the `Shared` z.object:

```ts
  // V2.0 (spec 2026-07-07) — dark-launch flags, default OFF until gate #149 passes.
  V2_ACTION_ITEMS: boolish(false),
  V2_ORACLE_TASKS: boolish(false),
```

- [ ] **Step 3:** Extend `packages/core/src/__tests__/env.test.ts` with a case: unset → both flags `false`; `process.env.V2_ACTION_ITEMS = "true"` + `_resetEnvCache()` → `envForMcp().V2_ACTION_ITEMS === true`.
- [ ] **Step 4:** Add to `.env.example` under the feature-flag block:

```bash
# V2.0 meeting/doc intelligence (spec 2026-07-07) — dark until flywheel gate #149 passes
V2_ACTION_ITEMS="false"           # addressed open-action-item block at brain_start_session
V2_ORACLE_TASKS="false"           # Oracle task-awareness (deterministic open-task context)
```

- [ ] **Step 5:** Commit `feat(core): action_item knowledge type + V2 dark-launch flags`.

### Task 2: core `action-items.ts` — list / format / resolve

**Files:**
- Create: `packages/core/src/action-items.ts`
- Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/src/__tests__/action-items.test.ts`

**Interfaces:**
- Consumes: `buildKnowledgeWhereV2(args: VisibilityScopeArgs)` from `./scope-filter.js`.
- Produces:
  - `listOpenActionItemsFor(opts: { userId: string; email: string; projectId: string | null; accessibleProjectIds?: string[]; limit?: number }): Promise<ActionItemRow[]>` — assignee view (has `for:<email>` tag), blockers first then oldest, `deletedAt: null`, `decayScore > 0.3`.
  - `listProjectActionItems(opts: { userId: string; projectId: string | null; accessibleProjectIds?: string[]; limit?: number }): Promise<ActionItemRow[]>` — project view for the Oracle (no email filter).
  - `formatActionItemsForInjection(items: ActionItemRow[]): string` — markdown block headed `## Your Open Action Items`.
  - `resolveActionItems(opts: { ids: string[]; userId: string; projectId: string | null; accessibleProjectIds?: string[] }): Promise<number>` — sets `deletedAt` on matching **action_item** rows within the caller's project bounds; returns count.
  - `ActionItemRow = Pick<Knowledge, "id" | "ruleText" | "triggerText" | "tags" | "createdAt">`.

- [ ] **Step 1:** Write failing tests (db-guarded, mirroring `evolution-decision.test.ts` setup style): create user A (creator) + user B (assignee, email `b-<rand>@test.local`) + one project P owned by A's org; insert via `db.knowledge.create` three rows of `type: "action_item"`, `visibility: "project"`, `ownerProjectId: P`: (a) tags `["action-item","for:<B email>"]` created older, (b) tags `["action-item","for:<B email>","blocker"]` newer, (c) tags `["action-item","for:other@test.local"]`. Plus one row in a different project P2 with B's email tag. Assert:
  - `listOpenActionItemsFor({userId: B, email, projectId: P})` returns exactly (b) then (a) — blocker first, no (c), no P2 row (cross-project leak).
  - `resolveActionItems({ids: [a.id], userId: B, projectId: P})` returns 1; re-list returns only (b); resolving a non-action_item knowledge id returns 0 and does not soft-delete it.
  - `formatActionItemsForInjection([(b),(a)])` contains `## Your Open Action Items`, the `ruleText` of both, and marks (b) with `[BLOCKER]`.
- [ ] **Step 2:** Run: `pnpm --filter @brain/core test action-items` — expect FAIL (module missing). (In this checkout: rely on CI; hand-verify imports.)
- [ ] **Step 3:** Implement `packages/core/src/action-items.ts`:

```ts
/**
 * V2.0 action items (spec 2026-07-07) — meeting to-dos and open questions
 * stored as Knowledge rows (type "action_item"), addressed via `for:<email>`
 * tags. Deliberately NOT part of semantic retrieval: these are tasks, not
 * rules. Queries are deterministic and project-bounded (assignee ≠ creator,
 * so no ownerUserId filter — the project boundary is the isolation line).
 */
import type { Knowledge } from "@brain/types";
import { db } from "@brain/db";
import { buildKnowledgeWhereV2 } from "./scope-filter.js";

export type ActionItemRow = Pick<
  Knowledge,
  "id" | "ruleText" | "triggerText" | "tags" | "createdAt"
>;

const BLOCKER_TAG = "blocker";
export const ACTION_ITEM_TYPE = "action_item";

function baseWhere(opts: {
  userId: string;
  projectId: string | null;
  accessibleProjectIds?: string[];
}): object {
  return {
    AND: [
      buildKnowledgeWhereV2({
        userId: opts.userId,
        activeProjectId: opts.projectId,
        activeOrgId: null,
        accessibleProjectIds: opts.accessibleProjectIds ?? [],
        scope: "project",
      }),
      { type: ACTION_ITEM_TYPE },
      { decayScore: { gt: 0.3 } },
    ],
  };
}

function blockersFirst(rows: ActionItemRow[]): ActionItemRow[] {
  return [...rows].sort((a, b) => {
    const ab = a.tags.includes(BLOCKER_TAG) ? 0 : 1;
    const bb = b.tags.includes(BLOCKER_TAG) ? 0 : 1;
    if (ab !== bb) return ab - bb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

const SELECT = {
  id: true, ruleText: true, triggerText: true, tags: true, createdAt: true,
} as const;

export async function listOpenActionItemsFor(opts: {
  userId: string;
  email: string;
  projectId: string | null;
  accessibleProjectIds?: string[];
  limit?: number;
}): Promise<ActionItemRow[]> {
  const rows = await db.knowledge.findMany({
    where: {
      AND: [
        baseWhere(opts),
        { tags: { has: `for:${opts.email.toLowerCase()}` } },
      ],
    },
    select: SELECT,
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 10,
  });
  return blockersFirst(rows);
}

export async function listProjectActionItems(opts: {
  userId: string;
  projectId: string | null;
  accessibleProjectIds?: string[];
  limit?: number;
}): Promise<ActionItemRow[]> {
  const rows = await db.knowledge.findMany({
    where: baseWhere(opts),
    select: SELECT,
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 30,
  });
  return blockersFirst(rows);
}

export function formatActionItemsForInjection(items: ActionItemRow[]): string {
  if (items.length === 0) return "";
  const parts = [
    "## Your Open Action Items",
    "_Assigned to you in meetings — resolve done ones via `resolvedActionItemIds` when you close the session._",
  ];
  for (const it of items) {
    const blocker = it.tags.includes(BLOCKER_TAG) ? "[BLOCKER] " : "";
    const question = it.tags.includes("open-question") ? "[OPEN QUESTION] " : "";
    const meeting = it.tags.find((t) => t.startsWith("meeting:"));
    parts.push(
      `- ${blocker}${question}${it.ruleText}${it.triggerText ? ` — ${it.triggerText}` : ""}${meeting ? ` (${meeting})` : ""} [id: ${it.id}]`,
    );
  }
  return parts.join("\n");
}

export async function resolveActionItems(opts: {
  ids: string[];
  userId: string;
  projectId: string | null;
  accessibleProjectIds?: string[];
}): Promise<number> {
  if (opts.ids.length === 0) return 0;
  const res = await db.knowledge.updateMany({
    where: {
      AND: [baseWhere(opts), { id: { in: opts.ids } }],
    },
    data: { deletedAt: new Date() },
  });
  return res.count;
}
```

  Note `resolveActionItems` reuses `baseWhere` — it can only retire `action_item` rows visible in the caller's project scope; `decayScore > 0.3` is acceptable there (already-decayed items are already invisible).
- [ ] **Step 4:** Export from `packages/core/src/index.ts` following its existing namespace style (check how `kra`/`formatter` are exported and match it — e.g. `export * as actionItems from "./action-items.js";`).
- [ ] **Step 5:** Run tests (CI), expect PASS. Commit `feat(core): action-items module — addressed list, format, resolve (V2 spec §4b)`.

### Task 3: teach tool accepts `action_item`

**Files:**
- Modify: `apps/mcp-server/src/tools/teach.ts:15,38` (both enums) + description
- Test: `apps/mcp-server/src/__tests__/action-items.test.ts` (new, also used by Task 4)

**Interfaces:**
- Produces: `brain_teach_knowledge` accepts `type: "action_item"`; rows persist with `visibility` default `"project"` (schema default, no code change).

- [ ] **Step 1:** Failing test (db-guarded): call `teachKnowledge.handler({ type: "action_item", trigger: "sprint planning 2026-07-07", rule: "Update the deployment runbook", scope: "project", tags: ["action-item", "for:assignee@test.local", "blocker"] }, authFor(creator))` → expect `{ id }`; row in DB has `type === "action_item"` and `visibility === "project"`. (Embedding call fails in CI env — check teach.ts: the embed happens after create; wrap expectation accordingly: if the handler throws on embed failure this test documents it; mirror how existing teach tests handle it — check `apps/mcp-server/src/__tests__/` for a teach test first and copy its guard.)
- [ ] **Step 2:** Add `"action_item"` to the zod enum (line 15) and the JSON-schema enum (line 38). Append to the tool description: `"For a meeting ACTION ITEM or OPEN QUESTION: type:'action_item', tags ['action-item'|'open-question', 'for:<assignee-email-lowercase>', 'meeting:<date-slug>', optionally 'blocker']; it is surfaced to the assignee at session start and via the Oracle, never as a rule."`
- [ ] **Step 3:** Run tests (CI), expect PASS. Commit `feat(mcp): teach accepts action_item type (meeting to-dos / open questions)`.

### Task 4: addressed injection at `brain_start_session` (flagged)

**Files:**
- Modify: `apps/mcp-server/src/tools/start-session.ts` (after the `relevantKnowledge` block, before `return`)
- Test: `apps/mcp-server/src/__tests__/action-items.test.ts` (extend)

**Interfaces:**
- Consumes: `actionItems.listOpenActionItemsFor`, `actionItems.formatActionItemsForInjection` from `@brain/core`; `envForMcp().V2_ACTION_ITEMS`.
- Produces: response field `openActionItems?: { knowledgeIds: string[]; injection: string }`.

- [ ] **Step 1:** Failing tests: with `process.env.V2_ACTION_ITEMS = "true"` + `_resetEnvCache()`:
  - creator teaches an action item `for:<B email>` in project P (insert directly via `db.knowledge.create` to avoid the embed dependency);
  - `startSession.handler({ projectId: P, prompt: "continue work" }, authFor(B))` → `res.openActionItems.knowledgeIds` contains the row id, `injection` contains `## Your Open Action Items`;
  - **no** `SessionKnowledgeApplication` rows exist for those knowledge ids on that session;
  - flag unset (`delete process.env.V2_ACTION_ITEMS` + `_resetEnvCache()`) → `res.openActionItems` undefined;
  - assignee in a different project sees nothing (cross-project).
- [ ] **Step 2:** Implement in `start-session.ts` (imports: add `actionItems` to the `@brain/core` import list, `envForMcp` too):

```ts
    // V2.0 (spec 2026-07-07 §4b): deterministic, addressed open-action-item
    // block — separate from semantic relevantKnowledge, and deliberately NOT
    // recorded as SessionKnowledgeApplication "injected" rows (tasks would
    // pollute the injection→used loop-health metric, gate #149).
    // FAIL-SOFT like relevantKnowledge: never block session open.
    let openActionItems:
      | { knowledgeIds: string[]; injection: string }
      | undefined;
    if (envForMcp().V2_ACTION_ITEMS) {
      try {
        const me = await db.user.findUnique({
          where: { id: auth.userId },
          select: { email: true },
        });
        if (me?.email) {
          const items = await actionItems.listOpenActionItemsFor({
            userId: auth.userId,
            email: me.email,
            projectId: resolvedProjectId,
          });
          if (items.length > 0) {
            openActionItems = {
              knowledgeIds: items.map((i) => i.id),
              injection: actionItems.formatActionItemsForInjection(items),
            };
          }
        }
      } catch (err) {
        log.warn(
          {
            op: "start.action_items_failed",
            sessionId: session.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "start.action_items_failed (session opens without task block)",
        );
      }
    }
```

  and extend the return: `...(openActionItems ? { openActionItems } : {})`.
- [ ] **Step 3:** Update the tool description (start-session.ts line 46) with one sentence: `"When meeting intelligence is enabled the response may also carry openActionItems — your open meeting to-dos; act on or resolve them via resolvedActionItemIds at close."`
- [ ] **Step 4:** Run tests (CI), expect PASS. Commit `feat(mcp): addressed open-action-item block at session start (V2_ACTION_ITEMS, dark)`.

### Task 5: retirement via `brain_report_session_outcome`

**Files:**
- Modify: `apps/mcp-server/src/tools/report.ts` (inputShape + JSON schema + handler)
- Test: `apps/mcp-server/src/__tests__/action-items.test.ts` (extend)

**Interfaces:**
- Consumes: `actionItems.resolveActionItems`.
- Produces: `brain_report_session_outcome` accepts `resolvedActionItemIds?: string[]`; response gains `resolvedActionItems: number` when the field was passed.

- [ ] **Step 1:** Failing test: teach/insert action item for B in P → B opens session → B calls `reportOutcome.handler({ sessionId, outcome: "success", resolvedActionItemIds: [id] }, authFor(B))` → row now has `deletedAt != null`; next `listOpenActionItemsFor` is empty; passing another project's action-item id resolves 0.
- [ ] **Step 2:** Add to `inputShape`: `resolvedActionItemIds: z.array(z.string()).max(50).default([])`; mirror in the JSON schema with description `"IDs from openActionItems that are now DONE or obsolete — they are retired (soft-deleted) so they stop appearing."`. In the handler, after the existing knowledge-confidence step, resolve using the session's projectId:

```ts
    let resolvedActionItems = 0;
    if (input.resolvedActionItemIds.length > 0) {
      resolvedActionItems = await actionItems.resolveActionItems({
        ids: input.resolvedActionItemIds,
        userId: auth.userId,
        projectId: session.projectId,
      });
    }
```

  (Reuse the `session` row the handler already loads — verify the local variable name in report.ts and use it; add `resolvedActionItems` to the return object.)
- [ ] **Step 3:** Run tests (CI), expect PASS. Commit `feat(mcp): resolve action items at session close (resolvedActionItemIds)`.

### Task 6: exclusion sweep — KRA + Oracle semantic query

**Files:**
- Modify: `packages/core/src/kra.ts:157-159` (fetchCandidates SQL)
- Modify: `packages/core/src/oracle.ts:139-141` (buildContext knowledge SQL)
- Test: `packages/core/src/__tests__/action-items.test.ts` (extend; SQL-level assertions need the db guard + a seeded embedding — if no embedding provider in CI, assert via a unit test on the SQL string instead: export nothing new; instead grep-level CI check is NOT acceptable — do the db-guarded test with a manually-set embedding via `db.$executeRawUnsafe(UPDATE ... SET embedding = $1::vector)` and `toVector(new Array(1536).fill(0.001))`).

**Interfaces:** none new — behavioral guarantee only.

- [ ] **Step 1:** Failing test: insert an `action_item` row AND a `principle` row, both owned by user U in project P, both given the same synthetic embedding vector; call `kra.candidatesForPrompt` — stub `embed` is not injectable, so instead call `fetchCandidates` indirectly is impossible → **test via retrieveScored is blocked on embed.** Therefore: make the exclusion testable by exporting the SQL predicate as a constant:

```ts
// kra.ts — near the top
/** V2.0: tasks are not rules — semantic retrieval must never serve them. */
export const RULE_TYPES_PREDICATE = ` AND "type" <> 'action_item'`;
```

  and unit-test that both `kra.ts` and `oracle.ts` queries include it (import the constant in the test and assert it's non-empty; the real assertion is Step 2's SQL usage).
- [ ] **Step 2:** Apply in `kra.ts` `fetchCandidates`:

```sql
    WHERE embedding IS NOT NULL
      AND "decayScore" > 0.3
      AND "ownerUserId" = $2${RULE_TYPES_PREDICATE}${projectFilter}
```

  (append via template literal: `` `... AND "ownerUserId" = $2${RULE_TYPES_PREDICATE}${projectFilter}` ``) and in `oracle.ts` `buildContext`:

```sql
    WHERE "ownerUserId" = $2
      AND embedding IS NOT NULL${RULE_TYPES_PREDICATE}${kProjectFilter}
```

  (import `RULE_TYPES_PREDICATE` from `./kra.js` in oracle.ts).
- [ ] **Step 3:** db-guarded integration case (skips without DB, like the others): with embeddings set manually via `$executeRawUnsafe`, run the raw candidate SQL shape through `db.$queryRawUnsafe` mirroring fetchCandidates' WHERE clause with the predicate, assert the action_item row is absent and the principle present.
- [ ] **Step 4:** Run tests (CI), expect PASS. Commit `feat(core): exclude action_item from semantic retrieval and Oracle knowledge context`.

### Task 7: PR-1 assembly — docs touch + PR + CI green + merge

**Files:**
- Modify: `docs/MCP_TOOLS.md` (teach + start_session + report sections: the new type value, `openActionItems`, `resolvedActionItemIds` — copy the exact field descriptions from Tasks 3-5)
- Modify: `docs/KNOWLEDGE.md` (one subsection: "Action items (V2.0)" — type value, tags contract, lifecycle open→resolved/decayed, exclusion invariant)

**Interfaces:** none.

- [ ] **Step 1:** Write the two doc sections; hand-verify every field name against the code (`openActionItems`, `resolvedActionItemIds`, `for:<email>`, `action-item`/`open-question`/`blocker`/`meeting:<date>` tags).
- [ ] **Step 2:** Commit `docs: action-item contract in MCP_TOOLS + KNOWLEDGE`. Push branch, open PR-1 titled `feat: V2.0 addressed action items (dark, V2_ACTION_ITEMS)` with an honest test plan (CI-only gates noted).
- [ ] **Step 3:** Watch `gh pr checks` until green (fix anything red: typecheck/test/build). Read CodeRabbit inline comments; address or answer each. Merge (policy B: green CI + no migration).

### Task 8: Oracle task-awareness (PR-2, stacked)

**Files:**
- Modify: `packages/core/src/oracle.ts` (`buildContext`, SYSTEM_PROMPT area, `mapCitations` if `[^T]` refs are added)
- Test: `packages/core/src/__tests__/oracle.test.ts` (extend, follow its existing stub pattern)

**Interfaces:**
- Consumes: `listProjectActionItems`, `envForWeb().V2_ORACLE_TASKS`.
- Produces: Oracle context gains an `OPEN TASKS` block; `buildContext` return unchanged in shape (tasks folded into `userPrompt`; `knowledge` array untouched so groundedness/citations semantics stay).

- [ ] **Step 1:** Failing test: with flag on, seed 2 open action items (one blocker, one >14 days old via backdated `createdAt`) + 1 resolved; call the exported context-building path (check what `oracle.test.ts` already invokes — reuse its harness) and assert the prompt contains `OPEN TASKS`, the blocker line first with `[BLOCKER]`, the old one with `[stale >14d]`, and not the resolved one; flag off → no `OPEN TASKS` block and prompt byte-identical to before (snapshot or contains-not).
- [ ] **Step 2:** Implement in `buildContext` after the sessions fetch:

```ts
  // V2.0 (spec 2026-07-07 §4c): deterministic open-task context — complete
  // enumeration, not embedding-lucky. Flag-gated; tasks are cited as tasks,
  // never as learned knowledge (kept out of `knowledge` so groundedness and
  // [^K] citations are unaffected).
  let taskBlock = "";
  if (envForWeb().V2_ORACLE_TASKS) {
    const tasks = await listProjectActionItems({
      userId,
      projectId: projectId ?? null,
      accessibleProjectIds: visibilityArgs?.accessibleProjectIds ?? [],
    });
    const STALE_MS = 14 * 86_400_000;
    taskBlock = tasks
      .map((t) => {
        const forTag = t.tags.find((x) => x.startsWith("for:"));
        const stale =
          Date.now() - new Date(t.createdAt).getTime() > STALE_MS
            ? " [stale >14d]"
            : "";
        const blocker = t.tags.includes("blocker") ? "[BLOCKER] " : "";
        const kind = t.tags.includes("open-question") ? "open question" : "task";
        return `- ${blocker}(${kind}) ${t.ruleText} — assignee: ${forTag ? forTag.slice(4) : "unassigned"}${stale}`;
      })
      .join("\n");
  }
```

  and extend `userPrompt` between the knowledge and sessions blocks:

```ts
${taskBlock ? `\nOPEN TASKS (complete list for this project — authoritative for "what is open/blocked/unanswered" questions):\n${taskBlock}\n` : ""}
```

- [ ] **Step 3:** Append one sentence to the Oracle SYSTEM_PROMPT (locate the exported/module-level system prompt constant in oracle.ts): `"If an OPEN TASKS block is present it is the complete, authoritative list of open action items, blockers, and open questions — answer status questions from it directly and never present a task as a learned rule."` Keep `[^K]/[^S]` citation rules unchanged (tasks are uncited plain lines — do NOT extend mapCitations; simpler and the enumeration is already deterministic).
- [ ] **Step 4:** envForWeb import: oracle.ts currently reads `process.env` directly for models — for the flag use the same direct style to avoid the zod cache in a hot path: `const tasksEnabled = /^(1|true|yes|on)$/i.test(process.env.V2_ORACLE_TASKS ?? "");` **Decision:** use this direct read (matches oracle.ts's existing `process.env.ORACLE_MODEL` style); drop the envForWeb consumption note above.
- [ ] **Step 5:** Run tests (CI), expect PASS. Commit `feat(core): Oracle task-awareness — deterministic OPEN TASKS context (V2_ORACLE_TASKS, dark)`.

### Task 9: PR-2 cross-tenant test + assembly

**Files:**
- Test: `packages/core/src/__tests__/action-items.test.ts` (extend) or `oracle.test.ts`
- Modify: `docs/REST_API.md` only if the Oracle REST contract documents context composition (check; likely no change), `docs/KNOWLEDGE.md` (one line: Oracle exemption from the exclusion invariant).

**Interfaces:** none.

- [ ] **Step 1:** Cross-tenant test: org O1 project P1 with open items; user in org O2/project P2 with flag on → `listProjectActionItems({userId: u2, projectId: P2})` returns none of P1's rows; Oracle context for u2 contains no O1 task text.
- [ ] **Step 2:** Doc line in KNOWLEDGE.md: "`action_item` is excluded from semantic retrieval everywhere; the Oracle's OPEN TASKS block is the single deliberate exemption and is deterministic, not semantic."
- [ ] **Step 3:** Push branch, open PR-2 `feat: V2.0 Oracle task-awareness (dark, V2_ORACLE_TASKS)` **based on PR-1's branch** (`gh pr create --base feature/v2-action-items`); retarget to `main` after PR-1 merges (`gh pr edit --base main`). Honest test plan. CI green → merge after PR-1.

### Task 10: protocol skills (PR-3, docs-only, parallel-safe)

**Files:**
- Create: `docs/protocols/meeting-miner.md`
- Create: `docs/protocols/doc-harvest.md`
- Create: `docs/protocols/doc-draft.md`
- Create: `docs/protocols/report-draft.md`
- Modify: `AGENTS.md` ("Working with the Brain" section: one link line), `docs/KNOWLEDGE.md` index table if present

**Interfaces:** each file is an agent-executable protocol: trigger, exact tool-call sequence with the tag contract from Global Constraints, worked example, completion path.

- [ ] **Step 1:** Write `meeting-miner.md`: input = transcript/notes path or paste; steps = open session (`prompt: "meeting: <title> <date>"`) → extract decisions (teach with `scope:"project"`, `"decision"` tag, `instead`, `supersedesKnowledgeId` when reversing) → extract action items/open questions (teach `type:"action_item"` with the exact tag contract, emails lowercased, `blocker` when blocking) → close with summary + learnings; completion path = `resolvedActionItemIds` at any later session close. Include one full worked example with realistic fake names/emails.
- [ ] **Step 2:** Write `doc-harvest.md` (mine finished project docs → teach `recipe` rows per doc type: structure, conventions, boilerplate, embedded decisions) and `doc-draft.md` (retrieve recipe + decisions → draft Markdown/wiki doc; Word/Excel out of scope). Each with a worked example.
- [ ] **Step 3:** Write `report-draft.md`: on-demand stakeholder report from Oracle-enumerable data (recent decisions, open items, blockers, open questions); explicitly "never scheduled, never pushed".
- [ ] **Step 4:** Link the four from AGENTS.md. Commit `docs(protocols): meeting-miner, doc-harvest, doc-draft, report-draft (V2 spec §4a/4d)`; PR `docs/v2-protocol-skills`; merge on green.

### Task 11: release + verification

- [ ] **Step 1:** After all three PRs merged: `git checkout main && git pull`; confirm `git status` clean and `packages/db/prisma/migrations` untouched in the merged range (`git diff v1.14.0..HEAD --stat -- packages/db/prisma/migrations` → empty).
- [ ] **Step 2:** Doc sweep check (README mentions? — flags are dark, so README feature copy does NOT change yet; KNOWLEDGE/MCP_TOOLS already updated in-PR). Cut `./scripts/release.sh v2.0.0 --publish` (major version signals the V2 program start even though features are dark — semver-wise it's additive/minor, but the operator's V2 framing wins; **if you prefer strict semver use v1.15.0** — decide at release time with the operator's framing: default `v2.0.0`).
- [ ] **Step 3:** `./scripts/deploy.sh` + post-deploy smoke + `./scripts/verify-lockdown.sh` (MCP surface changed). Verify flags OFF in prod env (deployed behavior V1-identical); report release URL + deploy result.
- [ ] **Step 4:** Close the Brain session with learnings; note in issue #149 that V2 flag-enable awaits the gate.

## Self-Review

- **Spec coverage:** §4a → Task 10; §4b → Tasks 1-4 (+5 retirement); §4c → Task 8-9; §4d → Task 10; §5 security → cross-project/cross-tenant tests in Tasks 2, 4, 9; §6 rollout → Tasks 7, 9, 11; §7 testing → per-task steps. Open-questions + blockers (§2 goals 1/5) → tag contract + formatter/oracle markers (Tasks 2, 8). Gap check: staleness in injection block (spec caps at 10, staleness flag only specced for Oracle) — OK as specced.
- **Placeholders:** none (Task 8 Step 4 resolves its own decision inline; Task 11 v2.0.0-vs-v1.15.0 defaults to v2.0.0).
- **Type consistency:** `ActionItemRow`, `listOpenActionItemsFor`, `listProjectActionItems`, `formatActionItemsForInjection`, `resolveActionItems`, `RULE_TYPES_PREDICATE`, `openActionItems`, `resolvedActionItemIds` — names checked consistent across Tasks 2, 4, 5, 6, 8.
