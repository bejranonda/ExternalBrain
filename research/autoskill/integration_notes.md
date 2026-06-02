# Integration Notes — Adopting nicknisi/autoskill into Brain Platform

*Companion to `spec.md`. This is the design diff between nicknisi's plugin and our implementation.*

---

## 1. What we adopt verbatim

| Idea | Where in our code |
|---|---|
| Point-based confidence scoring (5 / 3 / 2 / 1) | `packages/core/src/autoskill.ts` — `SCORE_*` constants |
| Confidence tiers HIGH ≥ 7 / MEDIUM 4-6 / LOW < 3 | `packages/core/src/autoskill.ts` — `tierForScore()` |
| Conflict resolution priority (recency → explicitness → repetition → score) | `packages/core/src/autoskill.ts` — `resolveConflicts()` |
| 4-question quality filter | `packages/core/src/autoskill.ts` — `passesQualityFilter()` |
| File routing (Skill vs CLAUDE.md vs new Skill vs ignore) | `packages/core/src/autoskill.ts` — `routeSignal()` |
| Approval-before-apply ("y/n/selective") | webapp queue UI (Phase 4) + `applyProposal()` |
| Rollback via git commits per change | `git commit -m "chore(autoskill): …"` per applied proposal |
| 5 core constraints (additive, one-concept-per-change, preserve structure, never delete without instruction, downgrade-when-uncertain) | enforced by `applyProposal()` writing only patches with `op: "append" | "insert"` |

## 2. Where we deliberately diverge

### 2.1 Activation
- **nicknisi:** explicit user phrase ("autoskill", "learn from this session").
- **us:** runs automatically on every `brain_report_session_outcome`, because the platform is multi-tenant and the user isn't always in the same tool that emitted the session. We compensate by **never auto-applying** — every proposal still requires user approval in the webapp queue (or via `brain_apply_autoskill_proposal` MCP tool, future).
- Net: we adopt the *quality bar* but not the activation gate.

### 2.2 File targets
- **nicknisi:** Skill files (markdown) + `CLAUDE.md`.
- **us:** four targets, because we serve more than one client format:
  - `skill` → existing `Skill` row
  - `rules` → exportable file (`.claude/rules/*`, `.cursor/rules/*`, `.windsurfrules`, `AGENTS.md`)
  - `knowledge` → new `Knowledge` row (typed, embedded, scope-aware)
  - `internal_skill` → improvement to KEA/KRA/Oracle prompts (the "wisdom" tier)
- Mapping (our routing rules):
  | nicknisi target | our target |
  |---|---|
  | Skill (specific behavior) | `skill` |
  | CLAUDE.md (project convention) | `rules` (when exportable) or `knowledge` with scope=`project` |
  | New Skill | `knowledge` first (atomic), then promote to `skill` after usage |

### 2.3 Cross-session signal
- **nicknisi:** opt-in via "analyze last 5 sessions".
- **us:** built-in. Our `filterNoise()` checks for similar prior corrections in the last 30 days. A pattern that has never appeared before is downgraded; one that has appeared in three prior sessions is upgraded. This is the platform's structural advantage — we can do this without user instruction because the data is already in our store.

### 2.4 Approval semantics
- **nicknisi:** synchronous prompt at end of session.
- **us:** asynchronous queue (`AutoskillProposal` table, status `pending` → `applied | rejected | superseded`). User reviews in `/dashboard/autoskill` whenever convenient. HIGH-tier proposals can be auto-applied if the user opts in via setting (`autoApplyHigh: true` in user prefs); default is off.

### 2.5 Git commit per change
- **nicknisi:** literal git commit per applied proposal in user's repo.
- **us:** logical "commit" — bump skill version, snapshot diff in `AutoskillProposal.patch`, append to audit log. No git commit unless the user has a sync bridge to Obsidian/local vault, in which case the bridge handles git.

## 3. New invariants this introduces

These should be added to `docs/KNOWLEDGE.md §5` in a future PR:

9. **Autoskill scoring is deterministic and inspectable.** Given the same session events, the same proposal set must be produced. No randomness. Reviewer can see the exact score breakdown per proposal.
10. **Autoskill never deletes or rewrites existing rules without an explicit user instruction.** The only mutation kinds allowed are: append to a section, insert a new section, create a new file. `op: "replace"` and `op: "delete"` are forbidden in autoskill patches.
11. **Autoskill respects the routing table.** A signal that scores 4 with no Skill match goes to `rules` or `knowledge`, never to a Skill it doesn't belong in.

## 4. What the upstream spec is missing (from our perspective)

These are not flaws in nicknisi's design — they're concerns that only arise at platform scale:

- **No multi-tenancy.** nicknisi assumes one user, one repo. Our autoskill must scope every proposal to the right user, never leaking signal across tenants.
- **No outcome feedback on the proposals themselves.** A proposal that the user accepted but later edited is signal — we should learn that our routing was wrong. Our `AutoskillProposal.status` log enables this; we'll build the meta-loop in Phase 4.
- **No telemetry on proposal quality.** What % of HIGH-tier proposals get applied as-is vs edited vs rejected? This is our autoskill-level SQS. Track in `KnowledgeHealthSnapshot` (Phase 3).
- **No anti-principle handling.** A repeated correction is often best stored as an `anti_principle` (from our 5-category ontology) rather than a positive Skill rule. Our `routeSignal()` does this.

## 5. References inside our codebase after adoption

- `packages/core/src/autoskill.ts` — scoring, routing, application
- `packages/types/src/index.ts` — `AutoskillProposal`, `AutoskillTarget`, `AutoskillConfidence`
- `packages/db/prisma/schema.prisma` — `AutoskillProposal` model
- `apps/worker/src/index.ts` — `autoskill.run` job handler
- `apps/mcp-server/src/tools/report.ts` — enqueues `autoskill.run` after every session report
- `docs/USECASES.md §2` — user-facing description
- `docs/BLUEPRINT.md §4.5` — adaptation summary
- `docs/KNOWN_ISSUES.md §1` — Phase-4 upgrade item (replace classifier with this scoring)
