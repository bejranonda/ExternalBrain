# Flywheel Repair — staged program to make the Brain earn primacy (2026-07-02)

**Status:** approved design, pending implementation plan
**Audience:** the operator (single-user dogfood instance) + the agents working this repo
**Horizon:** ~8–12 weeks, three criteria-gated stages

---

## 1. Problem statement

The knowledge loop is weak at every stage *for the platform's own author* — the
one real user. Evidence gathered 2026-07-02:

1. **Capture loses at the source.** File memory (MEMORY.md, `.remember`,
   CLAUDE.local.md) is written at the moment of insight and enforced by harness
   hooks; Brain capture depends on agents voluntarily closing sessions and on
   extraction from summaries. Files win because they are enforced; the Brain is
   requested.
2. **Project identity fragmentation.** One repo exists as three Brain projects
   ("Brain Platform" 2026-05-09, "BrainPlatform" 2026-06-13, "External Brain"
   2026-06-16). Project-scoped retrieval cannot see knowledge filed under a
   sibling identity. `projectName` is free text and drift silently creates
   duplicates.
3. **Starved, unvalidated corpus.** Injected rules commonly carry
   `effectiveness: -1, outcomes: 0` — written once, never confirmed. A starved
   corpus makes injection feel useless regardless of retrieval quality.
4. **No health surface.** The Oracle cannot answer "how is my Brain doing"
   (retrieves zero sessions for aggregate questions); the fragmentation went
   unnoticed for ~7 weeks. The efficacy claim remains unpublished
   (issues #126, #127, #129).

These are one causal chain, not four bugs: weak capture → fragmented, starved
corpus → useless injection → and no instrument that would have made any of it
visible.

## 2. Goals and success criteria (staged)

| Stage | Success test |
|---|---|
| 1. Felt value | In most coding sessions the operator can point at a specific injected rule that changed what the agent did. |
| 2. Numbers | NDCG@5 published in `docs/VALIDATION.md` from a real fixture (#127); KRA weights re-validated (#129); health panel live. |
| 3. Replacement | MEMORY.md shrunk to a bootstrap stub; the Brain demonstrably carries the load; generation-uplift benchmark run (#126). |

**Program-wide rule: feature freeze.** For the duration, platform work is
loop work + critical bugfixes + security only.

## 3. Stage 1 — unfragment + Brain-first capture (weeks 1–3)

### 3.1 Project identity consolidation

- **One-time merge (operator-gated).** An idempotent script reassigns
  `Knowledge`, `Session`, and dependent rows from the two non-canonical
  projects onto the canonical one (chosen by knowledge count; the script
  reports counts and requires explicit confirmation before mutating), then
  **deletes** the emptied duplicate projects — the schema has no archived
  flag, every reference is reassigned first inside the same transaction, and
  the pre-merge backup is the rollback path. The apply pass holds
  `SHARE ROW EXCLUSIVE` locks on every touched table (an in-database write
  freeze) so no child row can slip in between plan computation and mutation.
  This is a bulk mutation against `deploy_*` data: it runs only with a
  per-turn operator nod, after a verified backup (backups healthy again as
  of v1.11.1).
- **Prevention: normalized name matching.** `brain_start_session
  (projectName)` and `brain_create_project` match existing projects after
  stripping case, whitespace, and punctuation — "BrainPlatform" ≡
  "Brain Platform". No schema change; deployable autonomously. Unit tests pin
  the equivalences.
- **Deferred:** a `repoFingerprint` column (normalized git-remote URL) for
  exact matching. Needs a Prisma migration (operator-gated deploy); revisit in
  Stage 2 only if normalization proves insufficient.

### 3.2 Brain-primary, harness-enforced capture (operator-side)

- **Moment-of-insight routing.** The agent memory protocol becomes: teach the
  Brain first (`brain_teach_knowledge`), mirror to file second. The file write
  is the failover — MCP sessions still die silently (KNOWN_ISSUES §0b), so
  Brain-primary must never mean Brain-only. Teaching is fail-soft: if the MCP
  transport is down, write the file and move on; never block work.
- **Enforcement by hook, not etiquette.** A Stop-hook checks whether the
  conversation opened a Brain session and closed it with learnings, and nags
  or blocks accordingly. Hard-block only when the Brain is reachable;
  check-and-warn when the transport is dead.
- **One-time backfill.** A supervised agent session reads MEMORY.md,
  `.remember/`, and CLAUDE.local.md and teaches each durable lesson into the
  Brain with a `backfill` tag and correct scope (user vs project), deduping
  against existing knowledge. Uses existing MCP tools; no platform code.

### 3.3 Explicit non-goals for Stage 1

No retrieval-algorithm changes, no new knowledge types, no new webapp
surfaces. The corpus must be fed and unified before KRA changes are
meaningful.

## 4. Stage 2 — numbers + permanent health surface (weeks 3–6)

### 4.1 Benchmarks on the real corpus

- Export a fixture via the operator recipe in `docs/VALIDATION.md` (PR #124),
  run `retrieval-benchmark.ts`, and **publish the NDCG@5 number in
  VALIDATION.md whatever it is** — a bad number is a finding, not a failure.
  Closes #127.
- Re-validate `kra.ts` WEIGHTS against the fixture. Closes #129.
- Benchmarks run from the operator recipe against the real corpus, not in CI.

### 4.2 Brain health panel (the program's one new webapp feature)

One panel, one API route, all queries over existing tables (no migration).
Last-30-day metrics:

| Metric | Vital sign |
|---|---|
| Sessions opened / closed / **closed-with-learnings** | Is capture alive? |
| **Injection→used rate** (injected `knowledgeIds` returned in `knowledgeUsed`) | Is retrieval helping? |
| **Validation coverage** (% knowledge with ≥1 outcome) + effectiveness distribution | Is the corpus validated or a `-1` graveyard? |
| **Duplicate-project detector** (normalized-name collisions) | Is identity fragmenting again? |

The Oracle deliberately does **not** grow aggregate/SQL capabilities; the
panel answers the meta-questions.

## 5. Stage 3 — earned replacement (weeks 6–12, criteria-gated)

**Entry gate (rolling 2 weeks on the health panel):** ≥60% of sessions closed
with learnings **and** injection→used rate ≥40%. If unmet, Stage 3's work is
diagnosing why — not proceeding anyway.

- Shrink MEMORY.md to a bootstrap stub (pointer to the Brain + machine-specific
  facts only); `.remember` keeps short-term session state only. File memory
  remains the MCP-down failover — never deleted.
- Run the **generation-uplift benchmark** (#126: task pass-rate with vs
  without the Brain). Publish the result either way, per the repo's honesty
  posture (`KNOWN_ISSUES §0d`). Only a good number unlocks efficacy claims in
  positioning, via the standing doc-sweep + release workflow.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Merge script corrupts prod data | Verified backup first; idempotent; dry-run report; per-turn operator nod (CLAUDE.local rule 4). |
| Brain-first teach adds latency / fails mid-task | Fail-soft to file memory; never block the coding task. |
| Enforcement hook bricks sessions when MCP is dead | Reachability check first; warn-only in the dead-transport case. |
| Normalization merges two genuinely distinct projects | Equivalence is conservative (case/whitespace/punctuation only, no fuzzy matching); collisions surface in the duplicate detector. |
| Feature freeze slips | The freeze is named in this spec; violations are visible in the PR stream. |

## 7. Testing

- Unit tests pin the name-normalization equivalences (`@brain/core`).
- Health API covered by the existing authed-e2e pattern.
- Backfill and merge validated by before/after counts reported by the tooling
  and spot-checked in the webapp.
- Benchmarks are themselves the test instrument for retrieval quality.

## 8. Out of scope

Forker onboarding, marketing/SEO, i18n, new MCP tools, new knowledge types,
cross-org bundles (Phase 5), Oracle aggregate answering, `repoFingerprint`
migration (unless Stage 2 shows normalization is insufficient).
