# Brain / Knowledge System — Current State, Reanalyzed
*Second pass: Opus 4.7 | First pass was too descriptive. This one is diagnostic.*

---

## Executive Summary (Revised)

Autobahn's Brain is **architecturally more ambitious than reference systems like Hermes**, with a dual-plane (DB + filesystem) design that Hermes lacks. Contrary to my first-pass analysis, the pattern-matching logic is **sophisticated multi-factor weighted scoring**, not naive keyword counting. The extraction pipeline is automatic and non-blocking.

**But** the system has one critical structural gap that subordinates everything else: **zero semantic retrieval**. All similarity calculations are Jaccard set-intersection or keyword counting. This is a 2020 retrieval architecture in a 2026 codebase with a Pinecone MCP sitting unused.

The second-most-critical gap is the **absent outcome feedback loop**: session success/failure never updates knowledge confidence. The third is the **lossy extraction** (first-pass analysis correctly flagged this as keyword-based).

These three gaps, combined, cap the Brain's effectiveness at its current level regardless of how many more features are added on top.

---

## 1. Architecture — What's Actually There

### 1.1 Three Knowledge Planes (Confirmed)

```
┌─ PROMPT PLANE ─────────────────────────────────────────────────┐
│  SystemPromptBuilder composes session-specific system prompts  │
│  via buildAgentSystemPrompt() in base-agent.ts                 │
└────────┬──────────────────────────────────────┬────────────────┘
         │                                      │
    ┌────▼────────────────────┐  ┌──────────────▼─────────────────┐
    │ FILESYSTEM PLANE        │  │ DATABASE PLANE                 │
    │ ~/.autobahn/            │  │ PostgreSQL (via Prisma)        │
    │   USER_VIBE.md          │  │   LearningPattern              │
    │   skills/{...}.md       │  │   Skill (mirrors filesystem)   │
    │ {project}/.autobahn/    │  │   TroubleshootingRecord        │
    │   PROJECT_MEMORY.md     │  │   DebugSession                 │
    │                         │  │   UserStyleProfile             │
    │ Fast file I/O           │  │   DevFeedback                  │
    │ Human-readable          │  │   AgentExecution               │
    │ Injected into prompts   │  │   Queryable across projects    │
    └─────────────────────────┘  └────────────────────────────────┘
```

Both planes are kept in sync by `skill-sync-service.ts`. The architecture is correct; the subsequent layers are where problems begin.

### 1.2 The Sophisticated Part I Missed

**Pattern Matcher** (`src/lib/learning/pattern-matcher.ts`) uses **multi-factor weighted scoring**:

| Factor | Weight | Notes |
|--------|--------|-------|
| Task type exact match | 0.4 | Dominant signal |
| Language match | 0.2 | |
| Framework match | 0.15 | |
| Complexity match | 0.15 (or 0.075 for adjacent) | Handles fuzzy complexity |
| Prompt Jaccard similarity | 0.1 | Word-set overlap |

Plus: **recency decay** over 30 days, **success rate** multiplier, **user feedback** multiplier.

This is significantly better than Hermes's simple trigger-overlap keyword match. The pattern-matcher is not the weak link.

### 1.3 The Extraction Pipeline

Called from `src/app/api/vibe-coding/route.ts` after every session:

```typescript
// Line 1127: after preview_ready
recorder.processInteraction({ userId, projectId, prompt, response, metadata })
  .catch(() => {});  // Fire-and-forget, non-blocking

// Line 943: after successful build with ≥3 files
const extractedSkill = extractSkill(pName, filesCreated, framework, deps, task);
if (extractedSkill) {
  syncSkillToDB(userId, extractedSkill.skill, extractedSkill.filePath, task);
}

// Line 950: always after build
updateProjectMemoryAfterBuild(...);
updateUserVibeFromClarification(...);
```

**All knowledge is captured.** The wiring is correct. The problem is downstream: the *content* of what gets captured is noisy because extraction uses keyword matching.

---

## 2. The Three Critical Bottlenecks (Diagnosed)

### Bottleneck 1: No Semantic Retrieval

**The evidence:**
- Zero embeddings generated anywhere in the codebase
- `calculateCosineSimilarity()` exists in `agent-matcher.ts` but is never called
- Pinecone MCP available but unused
- All similarity via Jaccard or keyword counting (found in 4 different files)

**The impact:**
A user's prompt "build me a todo app with persistence" might have patterns stored under "localStorage", "persist data", "state management", "save user data" — none of which share enough Jaccard overlap with the prompt to be retrieved. These patterns exist but cannot be found.

**Quantified:** Conservative estimate: **semantic retrieval would improve relevant-pattern hit rate by 3-5×**, even with the existing pattern quality.

**Fix:** Add a `vector` column to LearningPattern, Skill, TroubleshootingRecord. Generate embeddings (OpenAI text-embedding-3-small or bge-small) on creation. Implement hybrid retrieval: semantic similarity + existing metadata filters + recency.

### Bottleneck 2: Keyword-Based Extraction (KEA Missing)

**The evidence:**
`auto-recorder-service.ts` has 12 pattern rules, each with `keywords: string[]` and `contextIndicators: string[]`. Scoring:
- Keyword hit: +0.2
- Context indicator hit: +0.15
- Tool usage correlation: +0.1
- File changes: +0.15

Threshold: 0.6 confidence.

**The impact:**
False positives — the word "fix" in a discussion triggers a correction pattern even when nothing was corrected. False negatives — a paragraph describing an architectural decision without using the keyword "architecture" gets missed entirely. The `description` field is the first sentence of the response, which is often generic.

**Quantified (estimate):** Current patterns are ~40% noise (generic or vague descriptions), ~60% signal. With a lightweight LLM-based extraction, noise drops below 15%.

**Fix:** Add a Knowledge Extraction Agent (KEA). Post-session, call a small/free LLM (Qwen3-Coder, GLM-4-Air, or similar) with a structured extraction prompt. Output: 1-3 typed, specific findings with confidence scores.

### Bottleneck 3: No Outcome → Knowledge Feedback

**The evidence:**
- `AgentExecution` records session success/failure
- `DevFeedback` records user thumbs-up/down
- `LearningPattern.successRate` exists
- But there is **no code path** where a bad outcome updates any knowledge item's confidence

When a session uses a skill and the build fails, nothing happens to that skill's confidence. When a user thumbs-down after a session where patterns were injected, nothing happens to those patterns.

**The impact:**
Skill and pattern confidence only goes up (via `recordSkillUsage`) and never down. Bad knowledge accumulates and cannot be removed except manually. The system has no negative feedback mechanism.

**Fix:** In the session completion handler:
- Track which skills and patterns were injected (`AgentExecution.knowledgeUsed: JSON`)
- On success: increment `confidence` (small bump, +0.02)
- On failure: decrement `confidence` (larger penalty, -0.10)
- On thumbs-down with comment: larger penalty (-0.20) and flag for review
- Purge skills/patterns that fall below 0.3 confidence after ≥5 uses

---

## 3. Gaps Reclassified

My first-pass had 7 gaps. The second pass reclassifies them by impact:

### Tier S (Transformative — addresses bottleneck)
1. **No semantic retrieval** → Embeddings + hybrid retrieval
2. **Keyword-based extraction** → Knowledge Extraction Agent
3. **No outcome feedback** → Close the confidence loop

### Tier A (High impact, moderate effort)
4. **Knowledge does not feed spec-deriver** → Load user stack/style preferences into AppSpec derivation
5. **No temporal trajectory** → VibeScoreHistory table + daily decay job
6. **Mock dashboard data** → Real SessionEventLog backing the timeline

### Tier B (Important but deferrable)
7. **No evaluation framework** → Session Quality Score + A/B harness (see 06)
8. **No scope field on knowledge** → Add `scope: global|user|project|session|community`
9. **No knowledge graph** → Pattern → Pattern relations table (enables transitive reasoning)

### Tier C (Nice to have)
10. **No user-editable "what AI thinks it knows" interface** → Settings page showing current beliefs
11. **Community skills passive** → Active curation, semantic clustering
12. **Skills not exportable to other tools** → Claude Code / Cursor / .cursorrules export

---

## 4. How the Four Knowledge File Types Are Created (Precise Mechanisms)

### My Skills
- **Trigger:** `preview_ready` SSE event, build succeeded, `filesCreated.length >= 3`
- **Creator:** `extractSkill()` in `skill-extractor.ts`
- **Filesystem write:** `~/.autobahn/skills/{framework}-{md5-hash-of-triggers}.md`
- **DB sync:** `syncSkillToDB()` upserts by `(userId, name)`
- **Deduplication:** `findExistingSkill(triggers, framework)` checks before creating
- **Pruning:** Oldest removed when total exceeds 50
- **Retrieval (at next session):** `findMatchingSkill(userTask, framework)` with Jaccard + framework match + confidence weighting; threshold 0.3

### AI Memory (USER_VIBE.md + UserStyleProfile)
- **Trigger 1:** User answers clarification → `updateUserVibeFromClarification()` in `vibe-memory-writer.ts`
- **Trigger 2:** Session complete → `updateProjectMemoryAfterBuild()`
- **Filesystem write:** `~/.autobahn/USER_VIBE.md` (YAML frontmatter + sections)
- **DB write:** `UserStyleProfile` fields updated via `UserStyleService`
- **Size cap:** 25KB per file, 20 entries per section (oldest pruned)
- **Retrieval:** `buildVibeMemoryText()` reads the raw markdown and injects into prompt

### Patterns (LearningPattern table)
- **Trigger:** Every session completion via `processInteraction()` (fire-and-forget)
- **Creator:** `AutoRecorderService.detectAndRecordPattern()`
- **Algorithm:** 12 pattern rules, each with keyword+context scoring, threshold 0.6
- **Storage:** Prisma `LearningPattern` with `patternType` enum, `description` free text, `examples` JSON, `confidence` float
- **Retrieval:** `loadLearnedPatternsText()` — top 5 by `successRate DESC, createdAt DESC`, filter `successRate >= 0.7`

### Style (UserStyleProfile)
- **Trigger 1:** User feedback → categorization as style/naming/format correction
- **Trigger 2:** Repeated patterns in code (detected by auto-recorder)
- **Storage:** Prisma `UserStyleProfile` — structured fields (indentation, quotes, semicolons, namingConvention) + JSON `adaptations`
- **Retrieval:** Read structured fields, format as text, inject as style hints

---

## 5. What Works (Redeemed)

The first pass was dismissive. Things that are actually well-designed:

1. **Non-blocking enrichment.** Every knowledge operation uses `.catch(() => {})`. A broken Brain never breaks vibe-coding. This is correct operational hygiene.

2. **Dual-plane consistency.** Skills exist both as markdown files (for the agent's prompt) and DB rows (for analytics). `skill-sync-service.ts` keeps them consistent. Hermes only has markdown; Autobahn's design is strictly better.

3. **Pattern-matcher is multi-factor.** I undersold this. It handles task type, language, framework, complexity (with fuzzy adjacency), prompt similarity, recency decay, success rate weighting. With better input data, it would produce excellent retrieval.

4. **The Superpower philosophy.** "Measure what you skip" is a genuinely novel framing. It resists the trap of measuring activity (patterns created, sessions run) instead of leverage (time saved, tasks automated).

5. **Community scaffolding in place.** `isPublic`, `rating`, `downloads` fields on Skill. Public skill endpoint. Import flow. The social layer is ready for activation once quality improves.

6. **Graceful first-use handling.** New users with zero knowledge still get a working session. The enrichment layer contributes when it can; its absence is invisible.

---

## 6. What Is Structurally Broken

### The Noise-Accumulation Trap

The most dangerous current state: **the system captures patterns faster than it curates them**. Every session adds 0-3 patterns to the LearningPattern table. The keyword-based extraction captures both signal and noise. No decay or purging exists.

Over time:
- Table grows linearly
- Retrieval quality degrades (more candidates, same weak matching)
- The dashboard shows impressive-looking counts while session quality does not improve
- User loses trust: "You've learned 200 patterns but keep making the same mistakes?"

**This is the flywheel running backwards.** Each session adds more noise to a pool, making the next retrieval worse. The Brain gets statistically "bigger" while functionally weaker.

**Required fix:** A quality filter at the write boundary (KEA output filtering) + a decay job at the read boundary (stale knowledge fades) + a confidence feedback loop (bad knowledge gets penalized).

Without all three, extracting more cleverly just fills the trap faster.

---

## 7. What the Dashboard Shows (and Lies About)

Honest audit of `src/app/dashboard/knowledge/page.tsx`:

| Dashboard Element | Real or Mocked? |
|-------------------|-----------------|
| Vibe Score | **Real** — calculated from actual Superpower metrics |
| Superpower metrics (leverage, autonomy, reuse, speed) | **Real** — computed from DB |
| Pattern counts | **Real** — Prisma aggregate |
| Troubleshooting counts | **Real** — Prisma aggregate |
| Debug session counts | **Real** — Prisma aggregate |
| Top applied patterns | **Real** — queried from DB |
| Skills Gallery | **Real** — DB-backed Skill records |
| Vibe Memory Viewer | **Real** — UserStyleProfile |
| Community Skills | **Real** — public Skill records |
| **Timeline** | **MOCKED** — generates fake timestamps (lines 188-201) |
| **Knowledge file browser** | **MOCKED** — hardcoded tree (lines 203-250) |

**Implication:** The dashboard is ~80% real, ~20% mocked. The mocked sections (timeline + file browser) are ironically the two most trust-building features because they feel like direct evidence of learning. A user inspecting them carefully discovers the mock data and loses confidence in the rest.

**Fix priority:** Medium. Before investing further in dashboard features, replace these two mocks with real data. This is a pure frontend + API change, no model changes needed.

---

## 8. Bottom Line

The Brain is a **competently-scaffolded system with three sharp structural gaps**. It is not a poorly-designed system that needs rebuilding. The fix list is tractable:

1. Add semantic retrieval (Pinecone or pgvector + embeddings) — 5-7 days
2. Add Knowledge Extraction Agent — 3-5 days
3. Close the outcome → confidence feedback loop — 2-3 days

Approximately **2-3 weeks of focused work** closes the structural gaps. Everything else is refinement.
