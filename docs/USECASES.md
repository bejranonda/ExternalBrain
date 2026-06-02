# Usecases

Two usecases anchor the platform. Both come from the project brief.

## 1. Knowledge → Code Quality

**Core claim.** We have logs from thousands of vibe-coding sessions. Those logs contain latent wisdom (what works, what doesn't, what the user prefers) that today is thrown away. If we extract it, store it, and feed it back to the AI at the right moments, code quality rises session over session.

**Two analogies** (from the brief):

- **Doctor.** A good doctor listens and notes *selectively*. Her notes must be useful to any doctor treating this patient — or similar patients. She follows individuals across thousands. → our KEA.
- **Secretary.** A good secretary writes the memo with a specific reader in mind. Same meeting, different reader → different memo. → our KRA.

**Two kinds of skill we must build:**

1. **Output skills** (Knowledge). What the doctor/secretary produces. Used by humans and AI in other projects, exported as markdown.
2. **Internal wisdom skills** (Wisdom). What the doctor/secretary *relies on internally* to know what to write and what to skip. Used by the platform to improve future extraction and retrieval.

**How we implement it** (concrete mapping to this repo):

| Concept | Component |
|---|---|
| Session log ingestion | `brain_log_event` + `SessionEvent` table |
| Selective note-taking (doctor) | `packages/core/src/kea.ts` — LLM-based extraction + quality filter |
| Audience-specific retrieval (secretary) | `packages/core/src/kra.ts` — scored retrieval + injection formatter |
| Output skill | `Skill` table, exportable via `skill:export` |
| Internal wisdom skill | `Skill.kind === "internal"` — runs inside KEA/KRA prompts |
| Friction reduction | `autoskill` pipeline — proposals auto-generated post-session |
| Self-improvement | `evolution.ts` + internal skill curation |

**Success criteria** (from research doc 06):
- KEA produces ≥ 70 % specific/actionable findings (human spot-check of 50 sessions).
- KRA NDCG@5 > 0.5 on a 100-query labelled benchmark.
- SQS trends upward across a user's sessions within 4 weeks.

## 2. Autoskill

**Core claim** (from the sample story). After every session, a tool scans for **correction patterns** (the user re-prompted or reversed the AI twice+). It proposes skill-file edits with HIGH/MEDIUM confidence. User approves with one click. The skill file gets sharper; the AI understands the user better next session — without the user having to hand-edit anything.

**Why it's a real solution:**
- Corrections are the highest-signal events in any session. Ignoring them wastes the best training data we'll ever see.
- Humans don't reliably write down their own patterns. A pipeline that proposes with low friction is more likely to actually improve the rules than "please remember to update your skill file".
- **Routing matters** — a style correction should update the style skill, a behavior correction should update `.claude/rules/`, an architecture correction should become a new anti-principle. Our `routeSignal()` in `autoskill.ts` does this.

**Why it's not enough on its own:**
- Autoskill only catches *self-corrections*. It misses successful patterns where nothing was corrected — those have to come from KEA looking at outcome + diff.
- Without filter for one-off vs. cross-session patterns, it will suggest noise. Our cross-session bump (`crossSessionBump` in `autoskill.ts`) raises score by +1 to +3 when similar priors exist in the last 30 days.
- It needs a queue UI for user review. MVP spec in `ROADMAP.md` Phase 4.

**How we score (adopted from nicknisi/autoskill — see `research/autoskill/spec.md`):**

| Signal | Points |
|---|---|
| Explicit correction with "always/never" | 5 (+2 if repeated ≥ 3×) |
| Repeated pattern (≥ 2× in session) | 3 |
| Single correction | 2 |
| Approval / "perfect" / "keep doing it" | 1 |
| Multi-session bonus (similar prior in last 30 days) | +1, or +3 if ≥ 3 priors |

Tiers: **HIGH ≥ 7**, **MEDIUM 4–6**, **LOW < 3** (filtered out, no proposal).

**Conflict resolution priority** (highest first): recency → explicitness → repetition → score. Equal-score contradictions are kept marked so the webapp asks the user for clarification.

**Quality filter** (4 questions, all must pass):
1. Repeated or stated as a general rule?
2. Applies to future sessions or just this task?
3. Specific and actionable?
4. New information (not a generic best practice)?

**Routing rules:**
| Condition | Target |
|---|---|
| Score ≥ 3 AND matches active skill | append to that Skill |
| Project convention OR session-behavior | exportable rules file (`.claude/rules/`, `.cursor/rules/`, `.windsurfrules`, `AGENTS.md`) |
| Score ≥ 5 AND no skill match | new atomic `Knowledge` item (typed, embedded) |
| Score < 2 OR no skill match for skill-only signal | ignore |

**Reversibility constraints:** additive changes only. `op: "replace"` and `op: "delete"` are forbidden in autoskill patches and trip an invariant check in `applyProposal()`.

**How we implement it** (concrete):

1. `brain_report_session_outcome` enqueues `autoskill.run` on the worker.
2. `autoskill.runForSession(sessionId)` runs the 6-step pipeline: detectSignals → scoreSignals → resolveConflicts → passesQualityFilter → routeSignal → proposeChange.
3. Creates `AutoskillProposal` rows with `confidence: "high" | "medium"`.
4. Webapp shows a review queue at `/dashboard/autoskill`.
5. User approves → `autoskill.applyProposal(id)` writes to the right place (skill, rules file export, new knowledge item).
6. Never apply without approval (except HIGH when user opts in via setting).

**UI surface (Phase 4):**

```
Pending Autoskill Proposals — from session 2026-04-20

[HIGH · score 8] Append style rule to "typescript-style":
       Signal: "Always use 2-space indentation"
       Reason: Explicit "always" correction (5) + 3 prior similar (+3)
       [Apply] [Reject] [Edit]

[MEDIUM · score 5] Create new anti-principle:
       Signal: "Don't inline Tailwind arbitrary values"
       Reason: Repeated 2× this session (3) + 2 prior similar (+2)
       [Apply] [Reject] [Edit]

[Equal-score conflict — needs clarification]
       Signal A: "Always add try-catch around fs calls"
       Signal B: "Don't add try-catch for internal functions"
       [Choose one] [Add both with context] [Skip]
```

## 3. Oracle with-Brain indicator

**Core claim.** When you ask the Oracle a question, you should immediately see how much of the Brain contributed — not just a one-word confidence level at the bottom of the answer.

**Screenshot-worthy experience:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ YOU · 14:32                                                         │
│ What React form validation approach do I use?                       │
├─────────────────────────────────────────────────────────────────────┤
│ 🧠 ORACLE                                                           │
│ 🧠 Grounded on 7 rules · 3 sessions   [moderate]                   │
│                                                                     │
│ Based on your history, you consistently use react-hook-form         │
│ with Zod for validation. You've cited schema co-location [^K1]      │
│ and avoiding Formik due to maintenance concerns [^K2]...            │
│                                                                     │
│ Sources used by the Brain (4) ▾                                     │
└─────────────────────────────────────────────────────────────────────┘
```

When the Brain has no relevant context:

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🧠 ORACLE                                                           │
│ ⚠️ No relevant memories in your Brain — answering from general      │
│    knowledge.  Teach a rule about this for next time? [Teach a rule]│
│                                                                     │
│ React form validation options include...                            │
└─────────────────────────────────────────────────────────────────────┘
```

**Why it matters:** the user sees the Brain's contribution on every question without needing to understand retrieval mechanics. The "no memories" state turns a potential trust problem ("is the Brain even helping?") into a growth moment — the button opens the Teach modal pre-filled with the question, so adding the missing knowledge takes 30 seconds.

**Implementation:** `groundedness: "strong"|"moderate"|"weak"|"none"` + `retrievedCounts: { knowledge, sessions }` are computed from the retrieval bundle before the LLM call and returned on both the streaming and non-streaming Oracle endpoints. The frontend `GroundednessHeader` component renders the pill as soon as the `meta` SSE event arrives (while the answer is still streaming), so the user sees the context signal from the first moment.

**Phase extension — enriched citation cards.** Opening "Sources used by the Brain" now reveals per-citation reasoning:

```
[K1]  recipe  ✓ 87% useful (12 sessions)  · last used 3 days ago
Use react-hook-form + zod for form validation.
WHEN: User scaffolding a React form component
```

```
[S1]  thaisim2026  · 2 days ago  · ✓ success  · claude_code
Build a login form with email + password fields.
```

Each knowledge card shows: type chip (recipe/reflex/heuristic/principle/anti-principle), effectiveness badge (✓/~/✗/—/○ — same visual as the Skills tab), last-used relative time, and a dim `WHEN: <triggerText>` line showing the trigger pattern. Each session card shows: project name, relative age, outcome indicator, and client type. The user sees at a glance why each source was relevant — not just the text excerpt.

## 4. Knowledge effectiveness signal

**Core claim.** Users should be able to see which teachings are paying off — and which are not — so they can prune, refine, or reinforce their Brain with confidence.

**What the user sees in the Skills tab:**

```
✓ 87% useful (12 sessions)   ← green: the rule fires and helps
~ 50% useful (4 sessions)    ← yellow: mixed signal; worth refining
✗ 18% useful (5 sessions)    ← red: consider rewriting or archiving
— Untested (used 8 times)    ← gray: retrieved but no outcomes yet
○ Unused                      ← dim: never appeared in an Oracle answer
```

Each badge has a tooltip explaining the computation ("score = successCount / (successCount + failureCount) — requires ≥3 session outcomes to display").

**What the user sees on the dashboard:**

A "Most useful rules" card shows the top 5 rules with ≥5 outcomes, sorted by effectiveness score. Each row shows type chip + title + percentage + session count. Click "All rules" navigates to the Skills tab.

**Why it matters:** without this signal, users know their Brain has rules but can't tell if those rules are helping. A rule that fires often but correlates with failed sessions is worse than no rule — it's actively misleading the AI. The effectiveness badge turns a trust question ("is this rule worth keeping?") into an observable fact. The design presents it as signal, not judgment: low effectiveness means "time to refine", not "you wrote a bad rule".

**How the feedback loop closes:**
1. A Knowledge row is retrieved and cited in an Oracle answer → `usageCount += 1`, `lastUsedAt = now` (best-effort, in the Oracle routes).
2. A session ends with an outcome → `successCount` or `failureCount` bumped for every Knowledge row injected into that session (via `SessionKnowledgeApplication` rows in `brain_report_session_outcome`).
3. **Live thumbs feedback (MVP complete):** clicking thumbs up/down on an Oracle answer immediately bumps `successCount` (up) or `failureCount` (down) on each cited Knowledge row (`POST /api/oracle/feedback` with `citedKnowledgeIds`). This wires the user's in-the-moment reaction directly into the counters without waiting for a session-end MCP call.
4. The daily decay job flags `score < 0.3 + ≥5 outcomes + no recent usage` with `"flagged:low-effectiveness"` tag for review — no auto-delete.
5. The effectiveness badge renders in real-time from the `KnowledgeItemView.effectiveness` field (computed server-side from the live counters).

**Implementation:** `packages/core/src/knowledge-stats.ts` provides `bulkBumpKnowledgeUsage`, `bulkBumpKnowledgeOutcome`, `effectivenessScore`, and `getTopRules`. `KnowledgeItemView` gains `effectiveness` (0..1 or -1 sentinel) and `outcomes` fields. See `KNOWLEDGE.md §5 invariant 13`.
