# autoskill (nicknisi/claude-plugins) — Captured Specification

*Captured 2026-04-21 from https://skills.sh/nicknisi/claude-plugins/autoskill. This is a verbatim summary of the upstream spec — the canonical source is the URL above.*

---

## 1. Core function

> autoskill is a learning mechanism that analyzes coding sessions to extract user preferences from corrections and approvals, then proposes targeted updates to active Skills.

It detects feedback signals during a session, **filters for quality and durability**, **maps them to relevant Skill files**, and proposes **minimal, reversible edits** for user review.

## 2. Session scope

- Default: **current session only** (SessionStart → present).
- Multi-session analysis only on explicit user request ("analyze last 5 sessions").
- Rationale: prevents noise from accumulated old feedback.

## 3. Activation triggers

Explicit user request, never implicit:
- "autoskill", "learn from this session", "update skills from these corrections"
- "remember this pattern", "make sure you do X next time"

Does **not** activate for one-off corrections or when users decline modifications.

## 4. Signal detection — types & weights

| Category | Examples | Value |
|---|---|---|
| Corrections | "No, use X instead"; "We always do it this way" | Highest |
| Repeated patterns | Same feedback 2+ times across files | High |
| Approvals | "Yes, that's right"; "Perfect, keep doing it" | Supporting |
| Ignored | One-off context-specific feedback; ambiguous input | N/A |

## 5. Confidence scoring

| Signal type | Points |
|---|---|
| Explicit correction with "always/never" | 5 |
| Repeated pattern (2+ occurrences) | 3 |
| Single correction | 2 |
| Approval/confirmation | 1 |

**Conflict resolution priority** (highest first):
1. Recency (current session > past sessions)
2. Explicitness (direct corrections > approvals)
3. Repetition (3+ instances override single corrections)
4. Confidence scoring

Equal-score contradictions trigger a clarification request.

## 6. Signal quality filter (4 questions)

Before proposing changes, verify:
1. Was this repeated or stated as a general rule?
2. Applies to future sessions or just this task?
3. Specific and actionable?
4. New information (not standard best practices)?

**Worth capturing:**
- Project-specific conventions ("use `cn()` not `clsx()`")
- Custom locations and paths
- Non-standard architectural decisions
- Stack-specific integrations and quirks

**Not worth capturing** (standard knowledge):
- General best practices (DRY, separation of concerns)
- Language/framework conventions
- Universal security practices
- Standard accessibility guidelines

## 7. Signal → file routing

**Update existing Skill when:**
- Signal relates to active Skill, score ≥ 3.
- Signal affects skill behavior or trigger conditions.

**Propose new Skill when:**
- Multiple related signals (total ≥ 5) don't fit active Skills.
- Pattern spans sessions with consistent behavior.
- Describes a reusable, well-defined capability.

**Update CLAUDE.md instead when:**
- Signals describe project conventions (not skill-specific behavior).
- Total score < 5 for a new skill.
- Pattern too context-specific.

**Ignore signals when:**
- Don't map to any Skill used in session.
- Confidence score < 2.
- Contradict established patterns without strong justification.

### File routing examples

| Signal | Target |
|---|---|
| "Don't add error handling for internal functions" | Skill (e.g. `code-simplifier`) |
| "We use `cn()` utility for className merging" | CLAUDE.md (project convention) |
| "Auth logic lives in middleware, not components" | CLAUDE.md (architecture) |

## 8. Confidence tiers (output)

| Tier | Score | Meaning |
|---|---|---|
| HIGH | ≥ 7 | explicit, repeated, or strongly justified |
| MEDIUM | 4–6 | review carefully; may request clarification |
| LOW | < 3 | typically ignored unless accumulating |

## 9. Proposed-change format

```
File: path/to/SKILL.md
Section: [existing section or "new section: X"]
Confidence: HIGH | MEDIUM
Score: [confidence points]

Signal: "[exact user quote or paraphrase]"

Current text (if modifying):
> existing content

Proposed text:
> updated content

Rationale: [one sentence]
```

## 10. Review & approval flow

```
## autoskill summary

Detected [N] durable preferences from this session.

### HIGH confidence (recommended to apply)
- [change 1] — Score: X
- [change 2] — Score: X

### MEDIUM confidence (review carefully)
- [change 3] — Score: X

Apply high confidence changes? [y/n/selective]
```

User approval is required before any file edits. `selective` lets the user pick a subset.

## 11. Processing order (multi-update batches)

1. HIGH confidence first (≥ 7).
2. Group by file to minimize context switching.
3. Flag potential conflicts between proposals.
4. CLAUDE.md updates before Skill updates.
5. Skill updates by usage frequency (most-used first).

## 12. Apply step

When approved:
1. Edit the target file with minimal, focused changes.
2. If git is available: `git commit -m "chore(autoskill): [brief description]"`.
3. Report what was changed.

## 13. Rollback

All changes are reversible.

```bash
# With git
git log --grep="autoskill" --oneline
git revert <commit-hash>

# Or revert all autoskill changes
git log --grep="autoskill" --format="%H" | xargs -n1 git revert
```

Manual rollback is feasible because each edit is minimal and focused.

**Prevention practices:**
- Commit each skill change separately (no batching).
- Use descriptive messages: `chore(autoskill): add error handling rule`.
- Test after each change.

## 14. When to request clarification

Use an "ask user" interaction when:

**Ambiguous signals:**
- Correction doesn't specify what to do instead.
- Pattern observed but unclear if intentional.
- Signal could apply to multiple skills.

**Contradictory feedback:**
- Equal confidence scores for opposing signals.
- Recent correction conflicts with established pattern.
- Unclear precedence.

**Boundary decisions:**
- Uncertain whether change belongs in CLAUDE.md or Skill.
- Score near threshold (4–6).
- Could be project-wide convention or skill-specific.

**Scope uncertainty:**
- Unclear whether it applies to all cases or specific context.
- Signal uses "here" / "this case" without "always/never".
- Need to verify generalization.

## 15. Core constraints

- Never delete existing rules without explicit instruction.
- Prefer additive changes over rewrites.
- One concept per change (easy to revert).
- Preserve existing file structure and tone.
- When uncertain, downgrade to MEDIUM and ask.

## 16. Distribution / community signals (April 2026)

- Weekly installs: 65
- GitHub stars: 77
- Security audits: pass (Agent Trust Hub, Socket, Snyk)
- Installed on: opencode, gemini-cli, codex, github-copilot, cursor, cline platforms
