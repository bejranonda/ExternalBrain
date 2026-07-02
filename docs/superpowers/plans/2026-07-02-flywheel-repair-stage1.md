# Flywheel Repair — Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unfragment the Brain's project identities and make capture Brain-first, per Stage 1 of `docs/superpowers/specs/2026-07-02-flywheel-repair-design.md`.

**Architecture:** One platform-code change (normalized project-name matching in `@brain/core`), one operator-run SQL merge script (no platform code), and operator-side harness changes (capture protocol + enforcement hook + backfill via existing MCP tools). No Prisma migration anywhere in Stage 1.

**Tech Stack:** TypeScript strict, vitest (in-memory Prisma mock pattern from `org.test.ts`), plain SQL via `psql`, Claude Code hooks.

## Global Constraints

- No Prisma migration (keeps deploy autonomous per CLAUDE.local.md rule 2).
- Local gates cannot run in this checkout (Node 18, no pnpm) — rely on CI (`typecheck`, `test`, `build`).
- Conventional Commits; one logical change per PR; never push to `main` directly.
- Bulk mutation of `deploy_*` data (the merge) requires a per-turn operator nod + verified backup first.
- Feature freeze: nothing outside these tasks.

---

### Task 1: `normalizeProjectName` + normalized matching in `ensureNamedProject`

**Files:**
- Modify: `packages/core/src/org.ts` (add export near `slugify` ~line 181; change match in `ensureNamedProject` ~line 366)
- Test: `packages/core/src/__tests__/org.test.ts`

**Interfaces:**
- Produces: `export function normalizeProjectName(name: string): string` — lowercase, all non-alphanumerics stripped. `ensureNamedProject` behavior otherwise unchanged (same return shape).

- [ ] **Step 1: Write the failing tests** (append to the `ensureNamedProject` describe block in `org.test.ts`; if none exists, new describe using the file's in-memory mock builder):

```ts
describe("normalizeProjectName", () => {
  it("strips case, whitespace, and punctuation", () => {
    expect(normalizeProjectName("Brain Platform")).toBe("brainplatform");
    expect(normalizeProjectName("BrainPlatform")).toBe("brainplatform");
    expect(normalizeProjectName("brain-platform!")).toBe("brainplatform");
  });
  it("keeps genuinely distinct names distinct", () => {
    expect(normalizeProjectName("External Brain")).not.toBe(
      normalizeProjectName("Brain Platform"),
    );
  });
});

describe("ensureNamedProject normalized matching", () => {
  it("resolves 'BrainPlatform' to an existing 'Brain Platform' project", async () => {
    const db = mockDb(/* seed: org + project named "Brain Platform" */);
    const r = await ensureNamedProject(db, userId, "BrainPlatform");
    expect(r.created).toBe(false);
    expect(r.projectId).toBe(existingProjectId);
  });
  it("still creates when no normalized match exists", async () => {
    const db = mockDb(/* seed: org + project named "Brain Platform" */);
    const r = await ensureNamedProject(db, userId, "External Brain");
    expect(r.created).toBe(true);
  });
});
```

(Adapt seeding to the file's existing `ProjectRow`/mock-builder helpers; the mock's `project.findMany` must return the org's projects — add that stub if absent, throwing-by-default style preserved.)

- [ ] **Step 2: Verify tests fail** — cannot run locally; push branch `feature/project-name-normalization` and confirm CI `test` job fails on exactly these tests (or hand-verify by reading, per this checkout's standing limitation, and rely on Step 4's green run as the proof).

- [ ] **Step 3: Implement** in `org.ts`:

```ts
/**
 * Aggressive normalization for project-identity matching: lowercase with
 * every non-alphanumeric removed, so "Brain Platform", "BrainPlatform",
 * and "brain-platform" are one identity. Deliberately conservative beyond
 * that — no fuzzy matching (flywheel-repair spec §3.1).
 */
export function normalizeProjectName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}
```

In `ensureNamedProject`, replace the `findFirst` insensitive-equals lookup with:

```ts
  const wanted = normalizeProjectName(trimmed);
  const candidates = await db.project.findMany({
    where: { organizationId: targetOrgId },
    select: { id: true, slug: true, name: true },
  });
  const existing = candidates.find(
    (p) => normalizeProjectName(p.name) === wanted,
  );
```

(Keep the empty-`wanted` guard implicit: `trimmed` is already rejected when empty; if `wanted` is empty — name was all punctuation — fall through to create, slug fallback "project" already handles it. Add `if (!wanted)` skip of the match to avoid uniting all-punctuation names.)

Update the doc comment on `ensureNamedProject` (lines 342–345) to describe normalized matching instead of "case-insensitive and trims whitespace".

- [ ] **Step 4: Push, verify CI green** (`gh pr checks`), fix until green.

- [ ] **Step 5: Commit + PR** — `feat(core): match projectName by aggressive normalization to stop duplicate-project drift`. PR body: honest test plan (CI-only, no local run), link spec + this plan. Merge on green (autonomous-CD policy B).

### Task 2: duplicate-project merge script (operator-run SQL)

**Files:**
- Create: `scripts/merge-duplicate-projects.sql`

**Interfaces:**
- Consumes: normalization semantics from Task 1 (the SQL `lower(regexp_replace(name,'[^a-zA-Z0-9]','','g'))` must equal `normalizeProjectName`).
- Produces: an idempotent script the operator runs; dry-run by default, mutation only when `:apply` is set.

- [ ] **Step 1: Write the script.** Structure (full SQL in the file):

```sql
-- Usage (dry run):  psql ... -f merge-duplicate-projects.sql
-- Usage (apply):    psql ... -v apply=1 -f merge-duplicate-projects.sql
-- Groups projects per organization by normalized name; canonical = most
-- Knowledge rows (ties: oldest). Reassigns children, deletes empty dupes.
BEGIN;
CREATE TEMP TABLE dupe_map AS
  SELECT p.id AS dupe_id, c.id AS canonical_id
  FROM ... (window over lower(regexp_replace(name,'[^a-zA-Z0-9]','','g'))
            + "organizationId", ranked by knowledge count desc, "createdAt" asc)
  WHERE rank > 1;
-- Report section (always runs): per-group names, ids, child counts.
-- Mutation section (only when :apply): for each of
--   "Knowledge"."ownerProjectId", "Knowledge"."originProjectId",
--   "Session"."projectId", "MCPToken"."projectId", "AuditLog"."projectId"
-- UPDATE ... SET col = canonical_id FROM dupe_map WHERE col = dupe_id;
-- "PeerCard"."ownerProjectId": UPDATE the same way but DELETE first any
--   dupe-project PeerCard whose (ownerUserId, canonical_id) already exists
--   (unique constraint @@unique([ownerUserId, ownerProjectId])).
-- DELETE FROM "Project" WHERE id IN (SELECT dupe_id FROM dupe_map);
COMMIT; -- dry-run path executes ROLLBACK instead
```

Write the complete SQL (no ellipses in the real file); every table/column above is verified against `packages/db/prisma/schema.prisma` (no `@@map`, so quoted PascalCase table names).

- [ ] **Step 2: Validate the SQL locally by inspection + `python3 -c` syntax sanity is not possible for SQL — instead** run the dry-run against a disposable stack if one is available, otherwise mark the PR test plan: dry-run to be executed by operator before apply.

- [ ] **Step 3: Commit into the Task 1 PR branch** (same logical change: stop + repair duplicate projects): `feat(scripts): add operator-run duplicate-project merge script (dry-run by default)`.

- [ ] **Step 4: Operator gate (STOP).** Running against prod requires: verified backup (`/api/admin/backup-status` fresh), then
`docker compose -p deploy exec -T db psql -U "${POSTGRES_USER:-brain}" -d "${POSTGRES_DB:-brain}" < scripts/merge-duplicate-projects.sql` (dry run), review, then re-run with `-v apply=1`. The apply transaction takes `SHARE ROW EXCLUSIVE` locks on all six touched tables — an in-database write freeze — and recomputes the merge plan inside that same transaction, so concurrent writes cannot split rows between dry-run and apply (CodeRabbit #135 finding). **The AI does not run this** (CLAUDE.local.md rules 2/4); it hands the operator the exact commands and interprets the dry-run output with them.

### Task 3: Brain-first capture protocol + enforcement (operator harness, this checkout)

**Files:**
- Modify: `CLAUDE.local.md` (new "Memory protocol — Brain-first (2026-07-02)" section)
- Create: `/root/.claude/projects/-root-BrainPlatform/memory/project_brain_first_capture.md` + index line in `MEMORY.md`
- Create: hookify Stop-rule via the `hookify:writing-rules` skill (file location per that skill; gitignored operator config)

**Interfaces:**
- Produces: standing instructions future sessions load; a Stop hook that warns when a conversation opened a Brain session without closing it.

- [ ] **Step 1: CLAUDE.local.md section** stating: teach durable lessons to the Brain first (`brain_teach_knowledge` at the moment of insight, correct scope, mirror to file memory second); close every session with learnings; file memory is failover when MCP transport is dead (never blocked on the Brain).
- [ ] **Step 2: Memory file** with the same rule (type: project) so recall works even when CLAUDE.local.md is trimmed.
- [ ] **Step 3: Hookify rule** — consult `hookify:writing-rules`; event Stop; detection: transcript contains `brain_start_session` without a later `brain_report_session_outcome`; action: warn (never hard-block — MCP may be dead, spec §6).
- [ ] **Step 4: Verify** the hook fires by inspecting `hookify:list` output; commit nothing to the repo (operator-local artifacts).

### Task 4: file-memory backfill into the Brain (supervised, this session)

**Files:** none created — MCP writes only.

**Interfaces:**
- Consumes: `brain_teach_knowledge` (existing tool); sources: `/root/.claude/projects/-root-BrainPlatform/memory/*.md`, `.remember/core-memories.md` + `archive.md`, CLAUDE.local.md standing rules.

- [ ] **Step 1: Enumerate candidates** — read each source; keep only durable engineering/project rules (skip machine-specific trivia, secrets, anything with client names — `feedback_no_private_client_names` applies).
- [ ] **Step 2: Dedupe** — for each candidate, check `brain_retrieve_knowledge` for an existing equivalent; skip hits.
- [ ] **Step 3: Teach** each survivor with tags `["backfill"]` (+ `"decision"` where applicable), correct `scope` (`user` for operator preferences, `project` for repo facts), `instead`/`rationale` filled.
- [ ] **Step 4: Report** the taught count + IDs in the session summary.

### Task 5: docs PR, merges, deploy, smoke

**Files:**
- Already committed on `docs/flywheel-repair-spec`: the spec; add this plan file to the same branch.

- [ ] **Step 1:** Commit this plan to `docs/flywheel-repair-spec`; push; open PR `docs: flywheel-repair spec + stage-1 plan`; merge on green.
- [ ] **Step 2:** After the Task 1/2 feature PR merges: `git checkout main && git pull`; confirm clean worktree, CI green, no migration in diff; run `./scripts/deploy.sh`; then `./scripts/smoke.sh` (or the documented post-deploy smoke); report results.
- [ ] **Step 3:** Cut release per semver (feature → minor) via `./scripts/release.sh vX.Y.Z --publish` **before** deploy per CLAUDE.local.md rule 5, report the URL. Doc-sweep check: KNOWN_ISSUES gains a row noting the duplicate-project failure mode + merge script; README/KNOWLEDGE unaffected (internal behavior).

## Self-review

- Spec coverage: §3.1 merge → Task 2; §3.1 prevention → Task 1; §3.2 routing/enforcement/backfill → Tasks 3–4; §3.3 non-goals respected (no KRA, no new surfaces). Stage 2/3 intentionally out of scope (separate plan).
- No placeholders except Task 2 Step 1's sketch — the real file must contain complete SQL (called out in-task).
- Type consistency: `normalizeProjectName` name used identically in Tasks 1–2.
