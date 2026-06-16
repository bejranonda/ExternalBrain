# Decision Capture → Shared Project Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture project decisions/status-changes as first-class, user-stated, project-scoped Knowledge that teammates' inject-at-open and the Oracle surface — turning the Brain into shared institutional memory.

**Architecture:** A decision is a `Knowledge` row tagged `"decision"` (no new type/migration), captured via the existing `brain_teach_knowledge` path (+ a routing of `source:"decision"` close-capture learnings), consumed via the existing inject-at-open formatter + Oracle, and governed by two new invariants: decisions are decay-exempt and retired only by explicit supersession.

**Tech Stack:** TypeScript (strict), Prisma/Postgres, Zod, Vitest. Packages: `@brain/core` (logic), `@brain/db` (schema), `apps/mcp-server` (tools).

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `packages/core/src/evolution.ts` | decay job | decision rows are decay-exempt (pure predicate + skip) |
| `packages/core/src/formatter.ts` | injection string | lead with a "## Decisions in this project" section |
| `packages/core/src/knowledge-stats.ts` | knowledge mutations | `supersedeKnowledge()` helper (retire predecessor + link) |
| `apps/mcp-server/src/tools/teach.ts` | `brain_teach_knowledge` | optional `supersedesKnowledgeId`; decision description nudge; `decision.captured` log |
| `packages/core/src/kea.ts` | extraction | route `source:"decision"` learnings → project scope + `decision` tag (bypass judge) |
| `packages/core/src/oracle.ts` + `packages/types/src/index.ts` | Oracle citations | select `tags`, label `isDecision` |
| `AGENTS.md` | agent house rule | "capture project decisions as decisions" |
| tests under `packages/core/src/__tests__/` | — | one per unit + a cross-user routing test |

**Constant:** the tag string is `"decision"` everywhere. Define it once:
`export const DECISION_TAG = "decision";` in `packages/core/src/learnings.ts` (already the home of close-capture constants), and import it where used.

---

### Task 1: The `DECISION_TAG` constant + decay-exemption

**Files:**
- Modify: `packages/core/src/learnings.ts` (add constant)
- Modify: `packages/core/src/evolution.ts:61-124` (skip decision rows)
- Test: `packages/core/src/__tests__/evolution-decision.test.ts` (create)

- [ ] **Step 1: Add the constant** to `packages/core/src/learnings.ts` after `MAX_SUBMITTED_CONFIDENCE`:

```ts
/** Tag marking a Knowledge row as a user-stated project decision (spec 2026-06-16). */
export const DECISION_TAG = "decision";
```

- [ ] **Step 2: Write the failing test** `packages/core/src/__tests__/evolution-decision.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isDecayExempt } from "../evolution.js";
import { DECISION_TAG } from "../learnings.js";

describe("decay exemption for decisions", () => {
  it("exempts decision-tagged rows", () => {
    expect(isDecayExempt([DECISION_TAG])).toBe(true);
    expect(isDecayExempt(["close_capture", DECISION_TAG])).toBe(true);
  });
  it("does not exempt ordinary rows", () => {
    expect(isDecayExempt([])).toBe(false);
    expect(isDecayExempt(["close_capture"])).toBe(false);
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `pnpm --filter @brain/core test -- evolution-decision`
Expected: FAIL — `isDecayExempt` is not exported.

- [ ] **Step 4: Implement.** In `packages/core/src/evolution.ts`, add the import at top and the pure predicate above `processDecayBatch`:

```ts
import { DECISION_TAG } from "./learnings.js";

/** Decisions are user-stated facts, not scored heuristics — never decay/flag them (spec 2026-06-16). */
export function isDecayExempt(tags: string[]): boolean {
  return tags.includes(DECISION_TAG);
}
```

Then as the FIRST line inside the `for (const r of rows)` loop in `processDecayBatch`:

```ts
    if (isDecayExempt(r.tags)) continue;
```

- [ ] **Step 5: Run it, verify it passes**

Run: `pnpm --filter @brain/core test -- evolution-decision`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/learnings.ts packages/core/src/evolution.ts packages/core/src/__tests__/evolution-decision.test.ts
git commit -m "feat(core): decisions are decay-exempt + add DECISION_TAG constant"
```

---

### Task 2: Injection formatter — "Decisions in this project" section

**Files:**
- Modify: `packages/core/src/formatter.ts:12-43`
- Test: `packages/core/src/__tests__/formatter-decisions.test.ts` (create)

- [ ] **Step 1: Write the failing test** `packages/core/src/__tests__/formatter-decisions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatForInjection } from "../formatter.js";
import { DECISION_TAG } from "../learnings.js";
import type { Knowledge, KnowledgeBundle } from "@brain/types";

function k(partial: Partial<Knowledge>): Knowledge {
  return {
    id: "k1", type: "principle", scope: "project", ownerUserId: "u1",
    ownerProjectId: "p1", triggerText: "t", ruleText: "use Postgres",
    rationale: null, instead: "Mongo", framework: null, language: null,
    tags: [], confidence: 1, successCount: 0, failureCount: 0, usageCount: 0,
    decayScore: 1, createdAt: new Date(0), confirmedAt: null, lastUsedAt: null,
    extractedBy: "user", sourceSessionIds: [], parentKnowledgeId: null,
    ...partial,
  } as Knowledge;
}

const empty: KnowledgeBundle = {
  reflexes: [], recipes: [], heuristics: [], principles: [], antiPrinciples: [],
};

describe("formatForinjection — decisions section", () => {
  it("renders decision-tagged rows under a Decisions heading, not Coding Principles", () => {
    const bundle = {
      ...empty,
      principles: [
        k({ id: "d1", ruleText: "use Postgres", tags: [DECISION_TAG] }),
        k({ id: "p1", ruleText: "prefer pure functions", tags: [] }),
      ],
    };
    const out = formatForInjection(bundle);
    expect(out).toContain("## Decisions in this project");
    // decision appears in the decisions section
    const decisionsIdx = out.indexOf("## Decisions in this project");
    const principlesIdx = out.indexOf("### Your Coding Principles");
    expect(decisionsIdx).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("use Postgres")).toBeGreaterThan(decisionsIdx);
    if (principlesIdx >= 0) {
      // the non-decision principle stays under principles
      expect(out.indexOf("prefer pure functions")).toBeGreaterThan(principlesIdx);
    }
  });

  it("omits the decisions section when there are none", () => {
    const out = formatForInjection({ ...empty, principles: [k({ tags: [] })] });
    expect(out).not.toContain("## Decisions in this project");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @brain/core test -- formatter-decisions`
Expected: FAIL — no "## Decisions in this project" heading.

- [ ] **Step 3: Implement.** In `packages/core/src/formatter.ts`, import the tag and split decisions out. Replace the body of `formatForInjection` so decisions render FIRST and are excluded from the principle/anti loops:

```ts
import type { Knowledge, KnowledgeBundle } from "@brain/types";
import { DECISION_TAG } from "./learnings.js";

const isDecision = (k: Knowledge): boolean => k.tags?.includes(DECISION_TAG) ?? false;

export function formatForInjection(bundle: KnowledgeBundle): string {
  const parts: string[] = ["## What I've Learned About You"];

  const decisions = [...bundle.principles, ...bundle.antiPrinciples].filter(isDecision);
  if (decisions.length) {
    parts.push(
      "",
      "## Decisions in this project",
      "_Settled choices — treat as given, don't re-litigate._",
    );
    for (const d of decisions) {
      parts.push(
        `- ${d.ruleText}${d.instead ? ` (not ${d.instead})` : ""}${d.rationale ? ` — ${d.rationale}` : ""}`,
      );
    }
  }

  if (bundle.reflexes.length) {
    parts.push("", "### Unconditional Rules (always apply)");
    for (const r of bundle.reflexes) parts.push(line("REFLEX", r));
  }
  if (bundle.recipes.length) {
    parts.push("", "### Recipes You've Used Successfully");
    for (const r of bundle.recipes) parts.push(line("RECIPE", r));
  }
  if (bundle.heuristics.length) {
    parts.push("", "### Your Preferred Approaches");
    for (const r of bundle.heuristics) parts.push(line("HEURISTIC", r));
  }
  const antiNonDecision = bundle.antiPrinciples.filter((r) => !isDecision(r));
  if (antiNonDecision.length) {
    parts.push("", "### Things You've Asked Me To Avoid");
    for (const r of antiNonDecision)
      parts.push(
        `- [ANTI-PRINCIPLE] ${r.ruleText}${r.instead ? ` — use ${r.instead} instead.` : ""} (corrected ${r.failureCount}×)`,
      );
  }
  const principlesNonDecision = bundle.principles.filter((r) => !isDecision(r));
  if (principlesNonDecision.length) {
    parts.push("", "### Your Coding Principles");
    for (const r of principlesNonDecision) parts.push(`- ${r.ruleText}`);
  }
  if (bundle.skill) {
    parts.push("", `### A Skill That Might Apply`, bundle.skill.content);
  }

  return parts.join("\n");
}
```

(Keep the existing `line()` helper unchanged below.)

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @brain/core test -- formatter-decisions`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the existing formatter consumers' tests** to confirm no regression

Run: `pnpm --filter @brain/core test -- formatter kra`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/formatter.ts packages/core/src/__tests__/formatter-decisions.test.ts
git commit -m "feat(core): surface project decisions as a distinct injection section"
```

---

### Task 3: `supersedeKnowledge()` helper + wire into `brain_teach_knowledge`

**Files:**
- Modify: `packages/core/src/knowledge-stats.ts`
- Modify: `packages/core/src/index.ts` (export)
- Modify: `apps/mcp-server/src/tools/teach.ts`
- Test: `packages/core/src/__tests__/knowledge-supersede.test.ts` (create)

- [ ] **Step 1: Write the failing test** `packages/core/src/__tests__/knowledge-supersede.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { supersedeKnowledge } from "../knowledge-stats.js";

function mockDb(superseded: { id: string; ownerUserId: string } | null) {
  return {
    knowledge: {
      findFirst: vi.fn().mockResolvedValue(superseded),
      update: vi.fn().mockResolvedValue({}),
    },
  } as any;
}

describe("supersedeKnowledge", () => {
  it("retires the predecessor and links the successor when owned by the user", async () => {
    const db = mockDb({ id: "old", ownerUserId: "u1" });
    const linked = await supersedeKnowledge(db, { newId: "new", supersededId: "old", userId: "u1" });
    expect(linked).toBe(true);
    // predecessor soft-deleted
    expect(db.knowledge.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "old" }, data: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
    );
    // successor linked
    expect(db.knowledge.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "new" }, data: { parentKnowledgeId: "old" } }),
    );
  });

  it("does nothing (no throw) when the supersede target is missing or not owned", async () => {
    const db = mockDb(null);
    const linked = await supersedeKnowledge(db, { newId: "new", supersededId: "ghost", userId: "u1" });
    expect(linked).toBe(false);
    expect(db.knowledge.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @brain/core test -- knowledge-supersede`
Expected: FAIL — `supersedeKnowledge` not exported.

- [ ] **Step 3: Implement** in `packages/core/src/knowledge-stats.ts` (append):

```ts
import type { PrismaClient } from "@brain/db";

/**
 * Retire a superseded decision and link its successor (spec 2026-06-16 §5).
 * Reuses parentKnowledgeId lineage; soft-deletes the predecessor so KRA stops
 * serving it. Ownership-checked. Returns false (no throw) when the target is
 * missing or not owned — capture of the new decision must never fail on this.
 */
export async function supersedeKnowledge(
  db: PrismaClient,
  args: { newId: string; supersededId: string; userId: string },
): Promise<boolean> {
  const target = await db.knowledge.findFirst({
    where: { id: args.supersededId, ownerUserId: args.userId, deletedAt: null },
    select: { id: true, ownerUserId: true },
  });
  if (!target) return false;
  await db.knowledge.update({
    where: { id: args.supersededId },
    data: { deletedAt: new Date() },
  });
  await db.knowledge.update({
    where: { id: args.newId },
    data: { parentKnowledgeId: args.supersededId },
  });
  return true;
}
```

Export it from `packages/core/src/index.ts` (add to the `knowledge-stats` re-export line; match the existing style).

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @brain/core test -- knowledge-supersede`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into `teach.ts`.** Add `supersedesKnowledgeId` to both the Zod `inputShape` and the JSON `inputSchema.properties`, import the helper, and call it after the row is created + embedded. Also add the decision-capture description nudge and the `decision.captured` log.

In `apps/mcp-server/src/tools/teach.ts`:

```ts
// imports — add supersedeKnowledge and getLogger:
import {
  embedding, getUserProjects, ensureDefaultProject, userCanAccessProject,
  BrainError, supersedeKnowledge, getLogger,
} from "@brain/core";
```

```ts
// inputShape — add:
  supersedesKnowledgeId: z.string().optional(),
```

```ts
// inputSchema.properties — add:
      supersedesKnowledgeId: { type: "string" },
```

```ts
// description — replace with:
  description:
    "Record a piece of knowledge the user explicitly taught, OR a project DECISION / status change ('we'll use X', 'deprecate Y', 'Z owns auth'). For a decision, set scope:'project', include the rejected alternative in `instead`, add 'decision' to `tags`, and — if it reverses a prior decision — pass that decision's id as `supersedesKnowledgeId`. User-taught knowledge has highest confidence (1.0).",
```

After the embedding `UPDATE` and before `return`:

```ts
    if (input.supersedesKnowledgeId) {
      await supersedeKnowledge(db, {
        newId: row.id,
        supersededId: input.supersedesKnowledgeId,
        userId: auth.userId,
      });
    }
    if (input.tags.includes("decision")) {
      getLogger("mcp", { stream: "stdout" }).info(
        { op: "decision.captured", knowledgeId: row.id, scope: input.scope, channel: "teach",
          superseded: input.supersedesKnowledgeId ?? null },
        "decision.captured",
      );
    }
```

- [ ] **Step 6: Typecheck the server** (no unit harness for the tool; rely on typecheck + the integration test in Task 6)

Run: `pnpm --filter @brain/mcp-server typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/knowledge-stats.ts packages/core/src/index.ts apps/mcp-server/src/tools/teach.ts packages/core/src/__tests__/knowledge-supersede.test.ts
git commit -m "feat(mcp): brain_teach_knowledge captures decisions + supersession"
```

---

### Task 4: Route `source:"decision"` close-capture learnings → project scope + decision tag

**Files:**
- Modify: `packages/core/src/kea.ts:140-200` (extract flow)
- Test: `packages/core/src/__tests__/kea-decision-route.test.ts` (create)

**Design:** a `source:"decision"` learning is user-stated, so it bypasses the durability judge: map it to a project-scoped finding and persist with `["decision","close_capture"]`. Non-decision learnings keep the existing refine path. Reuses `persist` + `applyQualityFilter`.

- [ ] **Step 1: Write the failing test** `packages/core/src/__tests__/kea-decision-route.test.ts` (uses the existing `opts` seams, like `kea-refine.test.ts`):

```ts
import { describe, it, expect, vi } from "vitest";
import { extractFromSession } from "../kea.js";
import type { Learning } from "../learnings.js";

const decision: Learning = {
  trigger: "choosing the primary datastore for this project",
  rule: "use Postgres + pgvector for the brain, not a separate vector DB",
  rationale: "one datastore, transactional embeddings", type: "principle",
  source: "decision", confidence: 0.9,
};
const reflex: Learning = {
  trigger: "scaffolding a form in this repo",
  rule: "use react-hook-form with zod resolver, never Formik",
  rationale: "team standard", type: "reflex", source: "discovery", confidence: 0.8,
};

describe("decision routing in extractFromSession", () => {
  it("persists decision learnings as project-scoped, decision-tagged, bypassing the judge", async () => {
    const persist = vi.fn(async (findings: any[], _p: any, tags: string[]) =>
      findings.map((f, i) => ({ id: `k${i}`, ...f, tags })));
    const judge = vi.fn(async () => []); // judge sees only non-decision learnings
    const filter = vi.fn(async (f: any[]) => f);

    const rows = await extractFromSession(
      { userId: "u1", sessionId: "s1", projectId: "p1", submittedLearnings: [decision, reflex] } as any,
      { judge, filter, persist },
    );

    // judge was called WITHOUT the decision learning
    const judged = judge.mock.calls[0]?.[0] as Learning[];
    expect(judged.every((l) => l.source !== "decision")).toBe(true);

    // persist was called with the decision finding: scope project + decision tag
    const decisionCall = persist.mock.calls.find((c) => (c[2] as string[]).includes("decision"));
    expect(decisionCall).toBeTruthy();
    const findings = decisionCall![0] as any[];
    expect(findings[0].scope).toBe("project");
    expect(findings[0].rule).toContain("Postgres");
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @brain/core test -- kea-decision-route`
Expected: FAIL — decisions are currently judged, not routed; no `"decision"`-tagged persist call.

- [ ] **Step 3: Implement.** In `packages/core/src/kea.ts`, add the import and a mapper near `refineSubmittedLearnings`:

```ts
import { DECISION_TAG } from "./learnings.js";

/** Decision learnings are user-stated — persist directly as project-scoped findings, no judge. */
function decisionFindings(learnings: Learning[]): KEAFinding[] {
  return learnings.map((l) => ({
    type: l.type,
    scope: "project",
    trigger: l.trigger,
    rule: l.rule,
    rationale: l.rationale,
    confidence: l.confidence,
  }));
}
```

In `extractFromSession`, in the `mode === "refine"` branch, split the submitted learnings and route. Replace the refine try-block body so the judge only sees non-decision learnings, and persist decisions separately after the main persist:

```ts
  const decisionLearnings = submitted.filter((l) => l.source === "decision");
  const judgeLearnings = submitted.filter((l) => l.source !== "decision");

  if (mode === "refine") {
    try {
      findings = await refineSubmittedLearnings(payload, judgeLearnings, opts.judge ?? defaultRefineJudge);
    } catch (err) {
      getLogger("kea", { stream: "stdout" }).warn(
        { op: "kea.refine_fallback", sessionId: payload.sessionId,
          err: err instanceof Error ? err.message : String(err) },
        "kea.refine_fallback",
      );
      mode = "mine";
      findings = await mineFn(payload);
    }
  } else {
    findings = await mineFn(payload);
  }

  const filtered = await (opts.filter ?? applyQualityFilter)(findings, payload.userId);
  const persisted = await (opts.persist ?? persist)(
    filtered, payload, mode === "refine" ? ["close_capture"] : [],
  );

  // Route user-stated decisions to project scope + decision tag (spec 2026-06-16).
  if (decisionLearnings.length > 0) {
    const dFiltered = await (opts.filter ?? applyQualityFilter)(decisionFindings(decisionLearnings), payload.userId);
    const dRows = await (opts.persist ?? persist)(dFiltered, payload, [DECISION_TAG, "close_capture"]);
    persisted.push(...dRows);
  }
```

(Note: `mode` stays `"refine"` whenever any learnings were submitted; if ALL submitted learnings are decisions, `judgeLearnings` is empty and `refineSubmittedLearnings` returns `[]` — the main persist writes nothing and only the decision persist runs. That is correct.)

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @brain/core test -- kea-decision-route`
Expected: PASS.

- [ ] **Step 5: Run the existing refine tests** to confirm no regression

Run: `pnpm --filter @brain/core test -- kea-refine kea-audit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/kea.ts packages/core/src/__tests__/kea-decision-route.test.ts
git commit -m "feat(core): route source=decision close-capture learnings to shared project scope"
```

---

### Task 5: Oracle citation label for decisions

**Files:**
- Modify: `packages/types/src/index.ts:256-260` (`OracleCitationMeta`)
- Modify: `packages/core/src/oracle.ts:135` (SELECT `tags`) and `:595-607` (mapCitations)
- Test: `packages/core/src/__tests__/oracle-decision-cite.test.ts` (create) — OR extend `oracle.test.ts`

- [ ] **Step 1: Add `isDecision` to the meta type** in `packages/types/src/index.ts`:

```ts
export interface OracleCitationMeta {
  // ...existing fields...
  isDecision?: boolean;
}
```

- [ ] **Step 2: Write the failing test** `packages/core/src/__tests__/oracle-decision-cite.test.ts`. Inspect how `oracle.test.ts` constructs rows for `mapCitations`; mirror it, adding `tags: ["decision"]` to one row and asserting its citation meta has `isDecision: true`. (If `mapCitations` is not exported, export it for test, matching the repo's ESM-seam convention.)

```ts
import { describe, it, expect } from "vitest";
import { mapCitations } from "../oracle.js";

describe("oracle citations label decisions", () => {
  it("sets isDecision on decision-tagged knowledge rows", () => {
    const answer = "We use Postgres [^K1].";
    const knowledge = [{
      id: "k1", type: "principle", triggerText: "datastore", ruleText: "use Postgres",
      tags: ["decision"], successCount: 0, failureCount: 0, usageCount: 0,
    }] as any[];
    const cites = mapCitations(answer, knowledge, []);
    const k1 = cites.find((c) => c.marker === 1);
    expect(k1?.meta?.isDecision).toBe(true);
  });
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `pnpm --filter @brain/core test -- oracle-decision-cite`
Expected: FAIL — `isDecision` undefined (and/or `tags` not selected).

- [ ] **Step 4: Implement.** Add `tags` to the Oracle SQL select at `oracle.ts:135` (append `, tags` to the column list). In `mapCitations` (~line 595), where `knowledgeType` is built, add:

```ts
        ...(Array.isArray(row.tags) && row.tags.includes("decision") ? { isDecision: true } : {}),
```

Ensure the row type used by `mapCitations` includes `tags: string[]`.

- [ ] **Step 5: Run it, verify it passes**

Run: `pnpm --filter @brain/core test -- oracle-decision-cite oracle`
Expected: PASS (new test + existing oracle tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/index.ts packages/core/src/oracle.ts packages/core/src/__tests__/oracle-decision-cite.test.ts
git commit -m "feat(core): label decisions in Oracle citations"
```

---

### Task 6: Cross-user retrieval — the thesis test + AGENTS.md house rule

**Files:**
- Modify: `AGENTS.md` (house rule)
- Test: `packages/core/src/__tests__/formatter-decisions.test.ts` (extend with the cross-user assertion at the formatter level — the DB-level cross-user path is covered by the existing scope-filter tests, which already prove project-scoped rows reach project members)

- [ ] **Step 1: Add the house rule** to `AGENTS.md` in the "Working with the Brain (agents)" section, as a new bullet after the Close step:

```markdown
5. **Capture decisions**: when the user states a project decision or status
   change ("we'll use X", "deprecate Y", "Z owns auth"), record it immediately
   with `brain_teach_knowledge` as a decision — `scope: "project"`, the rejected
   alternative in `instead`, `"decision"` in `tags`, and (if it reverses a prior
   decision) that decision's id in `supersedesKnowledgeId`. Decisions are shared
   project memory: a teammate's next `brain_start_session` surfaces them.
```

- [ ] **Step 2: Write the cross-user formatter assertion** (append to `formatter-decisions.test.ts`):

```ts
it("a decision authored by one user renders for any consumer of the project bundle", () => {
  // KRA's scope filter (scope-filter tests) already guarantees a project-scoped
  // row reaches every project member; here we prove the formatter surfaces it
  // regardless of which user it came from.
  const bundle = { ...empty, principles: [k({ id: "d1", ownerUserId: "AUTHOR", ruleText: "deploy via scripts/deploy.sh", tags: [DECISION_TAG] })] };
  const out = formatForInjection(bundle);
  expect(out).toContain("## Decisions in this project");
  expect(out).toContain("deploy via scripts/deploy.sh");
});
```

- [ ] **Step 3: Run it, verify it passes**

Run: `pnpm --filter @brain/core test -- formatter-decisions`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md packages/core/src/__tests__/formatter-decisions.test.ts
git commit -m "docs(agents): house rule — capture project decisions as shared memory"
```

---

### Task 7: Full gate + PR

- [ ] **Step 1: Run the full workspace gates**

Run: `pnpm turbo run typecheck && pnpm turbo run test`
Expected: PASS. (Then `pnpm turbo run build` if typecheck/test are green.)

- [ ] **Step 2: Push + open PR** on `feat/decision-capture`, body summarizing the wedge + the two model invariants (decay-exempt, supersede-to-retire) and the Phase 2 deferrals. Surface for merge decision (do not merge without operator go-ahead).

---

## Self-review

**Spec coverage:**
- §"What a decision row is" → Task 3 (teach sets tags/scope) + Task 4 (route). ✓
- §Intake channel 1 (source=decision routing) → Task 4. ✓
- §Intake channel 2 (teach nudge) → Task 3 description. ✓
- §Intake channel 3 (house rule) → Task 6. ✓
- §Consumption inject-at-open → Task 2. ✓
- §Consumption Oracle label → Task 5. ✓
- §Decay-exemption invariant → Task 1. ✓
- §Supersession → Task 3 (`supersedeKnowledge` + `supersedesKnowledgeId`). ✓
- §Scope gate → Task 3 (scope stays caller-set; teach enum already excludes team/community for this path) + house rule says `project`. ✓
- §Measurement → Task 3 `decision.captured` log + Task 6 cross-user test. **Deferred:** the visible dashboard *card* (a webapp surface — a stated Phase 1 non-goal); Phase 1 ships the log + the queryable signal. Noted, consistent with non-goals.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `DECISION_TAG` defined once in `learnings.ts`, imported in `evolution.ts`, `formatter.ts`, `kea.ts`. `supersedeKnowledge(db, {newId, supersededId, userId})` signature identical in Task 3 def + teach call. `isDecision` added to `OracleCitationMeta` (Task 5) matches its use in `mapCitations`. `decisionFindings` returns `KEAFinding[]` matching `persist`'s param.

**Known caveats carried from spec:** (a) `parentKnowledgeId` reused for supersession conflates edit-vs-replace — acceptable for Phase 1; (b) a decision learning on a project-less session persists with `ownerProjectId: null` and is effectively invisible — acceptable edge, most sessions resolve a project at open.
