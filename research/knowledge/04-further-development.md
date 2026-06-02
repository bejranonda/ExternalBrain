# Further Development — Re-prioritized Roadmap
*Second pass: Opus 4.7 | First pass roadmap was reasonable but missed the retrieval-first priority.*

---

## 1. Reordered Top Priorities

The first-pass roadmap led with KEA (extraction). The second pass reorders based on impact analysis:

| Rank | Initiative | Why First | Effort |
|------|-----------|-----------|--------|
| **1** | **Semantic Retrieval Layer (KRA)** | Unlocks value of *existing* knowledge immediately. Zero-downside — even noisy data becomes more useful. | 5-7 days |
| **2** | **Knowledge Extraction Agent (KEA)** | Better raw input → better knowledge over time. Compounds with retrieval. | 3-5 days |
| **3** | **Outcome → Confidence Feedback** | Closes the learning loop. Without it, flywheel runs backward. | 2-3 days |
| **4** | **Honest Dashboard (kill mocks)** | Trust/credibility. User can't evaluate the Brain if the dashboard lies. | 1-2 days |
| **5** | **Knowledge → AppSpec integration** | Direct, visible lift to first-turn build quality. | 2-3 days |

**Ship order rationale:** Retrieval first because it improves every subsequent feature. Extraction second because with retrieval in place, every new pattern becomes immediately useful. Outcome feedback third because it prevents noise accumulation. Dashboard fourth because it's a trust prerequisite. AppSpec integration fifth because it's the most visible end-user win.

**Three weeks of focused work** closes the structural gaps.

---

## 2. Initiative 1: Semantic Retrieval Layer

### Scope
Add a vector embedding to every LearningPattern, Skill, TroubleshootingRecord. Index them. Replace Jaccard/keyword retrieval with hybrid (semantic + metadata filter + recency) ranking.

### Technical Choices

**Vector DB:**
- **Option A:** pgvector extension on existing Postgres — no new infrastructure, works with Prisma via `Unsupported("vector")`, ~100ms query on 100K vectors
- **Option B:** Pinecone MCP (already scaffolded) — separates concerns, horizontally scalable, ~50ms query, but adds an external dependency
- **Recommendation:** pgvector. Simpler, faster-to-ship, no external cost, sufficient for expected scale.

**Embedding model:**
- **Option A:** OpenAI `text-embedding-3-small` — 1536 dims, $0.02/M tokens, high quality
- **Option B:** `bge-small-en` via sentence-transformers — self-hosted, 384 dims, free, decent quality
- **Option C:** Qwen embedding via DashScope — already have the API key, compatible with existing infra
- **Recommendation:** Start with OpenAI text-embedding-3-small for quality. Migrate to self-hosted later if cost matters.

### Schema Changes

```prisma
model LearningPattern {
  ...
  embedding  Unsupported("vector(1536)")?
  scope      String                          @default("user")  // global|user|project|session|community
  decayScore Float                           @default(1.0)
  confirmedAt DateTime?
  @@index([userId, scope])
}

model Skill {
  ...
  embedding Unsupported("vector(1536)")?
  scope     String                         @default("user")
  @@index([userId, scope])
}

model TroubleshootingRecord {
  ...
  embedding Unsupported("vector(1536)")?
  scope     String                         @default("user")
  @@index([userId, category])
}
```

### Code Changes

New file `src/lib/knowledge/embedding-service.ts`:
```typescript
export async function generateEmbedding(text: string): Promise<number[]>
export async function batchGenerateEmbeddings(texts: string[]): Promise<number[][]>
```

New file `src/lib/knowledge/retrieval-agent.ts` (the KRA):
```typescript
export async function retrieveRelevantKnowledge(
  userPrompt: string,
  context: { userId, projectId?, sessionMode? }
): Promise<KnowledgeBundle>
```

Modify:
- Every insert to LearningPattern, Skill, TroubleshootingRecord also generates and stores embedding
- `buildAgentSystemPrompt()` calls `retrieveRelevantKnowledge()` instead of the current four separate loaders
- Backfill script to generate embeddings for existing rows

### Success Criteria
- Semantic retrieval returns relevant patterns for user prompts that have zero keyword overlap
- Retrieval time under 200ms
- Measurable increase in "pattern injected and actually matched" rate
- Unit tests: 20 test prompts, each with known-relevant patterns, retrieval precision@5 ≥ 0.7

---

## 3. Initiative 2: Knowledge Extraction Agent

### Scope
Replace `AutoRecorderService.detectAndRecordPattern()` keyword matching with an LLM-based extraction that produces typed, structured findings.

### Technical Choices

**Model:**
- Qwen3-Coder (DashScope free tier) or GLM-4.5-Air — both cheap, fast, structured output capable
- **Recommendation:** Start with Qwen3-Coder. Free tier covers early usage; can switch to paid GLM if needed.

**Trigger timing:**
- Post-session, fire-and-forget (current `processInteraction()` location)
- No blocking of user experience
- Target latency: <3s

### Design

See doc 03 Section 3 for full KEA design including input schema, output schema, extraction prompt, and quality filter.

### Code Changes

New file `src/lib/knowledge/extraction-agent.ts`:
```typescript
export async function runKEA(input: KEAInput): Promise<KEAOutput>
export async function filterAndStoreKEAFindings(output: KEAOutput, userId: string): Promise<FilteredResult>
```

Modify `auto-recorder-service.ts`:
- Deprecate `detectAndRecordPattern` (keep for rollback)
- Add `runLLMExtraction` as the new default
- Feature flag: `KEA_ENABLED=true` (default on), allow rollback

### Success Criteria
- KEA produces findings with >70% confirmed-useful rate (human spot-check of 100 random findings)
- Deduplication rate: >85% of KEA findings that already exist are caught by the filter
- Pattern noise rate drops from ~40% to <15%

---

## 4. Initiative 3: Outcome → Confidence Feedback

### Scope
Track which knowledge items were injected in each session. On session outcome, update confidence.

### Schema Changes

```prisma
model AgentExecution {
  ...
  injectedSkillId       String?
  injectedPatternIds    String[]        @default([])
  injectedTroubleshootingIds String[]  @default([])
}

model LearningPattern {
  ...
  failureCount Int @default(0)
  successCount Int @default(0)
}

model Skill {
  ...
  failureCount Int @default(0)
  successCount Int @default(0)
}
```

### Code Changes

In `route.ts` (session completion handler):
```typescript
// On success:
await prisma.learningPattern.updateMany({
  where: { id: { in: injectedPatternIds } },
  data: { 
    successCount: { increment: 1 },
    confidence: { increment: 0.02 },  // capped at 1.0 by check
    confirmedAt: new Date(),
  }
});

// On failure or thumbs-down:
await prisma.learningPattern.updateMany({
  where: { id: { in: injectedPatternIds } },
  data: { 
    failureCount: { increment: 1 },
    confidence: { decrement: 0.10 },  // floor at 0.0
  }
});
```

Add weekly purge job:
- Patterns with confidence < 0.3 AND failureCount > 3 AND >30 days old → archived
- Archived patterns removed from retrieval pool but kept for provenance

### Success Criteria
- After 4 weeks of operation, low-quality patterns have visibly decayed out of top retrievals
- Dashboard shows "confidence trend" graph per pattern — trends are meaningful
- Purge job removes ≥10% of patterns per month (noise reduction visible)

---

## 5. Initiative 4: Honest Dashboard

### Scope
Replace the two mocked sections of `/dashboard/knowledge`:
1. Timeline events (currently fake timestamps on real pattern data)
2. Knowledge file browser (currently hardcoded tree)

### Technical Approach

**Timeline:**
- Create `SessionEventLog` Prisma model (lightweight)
- Record key events: session_started, skill_injected, pattern_learned, build_failed, build_succeeded, user_thumbs_up, user_thumbs_down
- Timeline queries last-N events for user, filters by type

**File browser:**
- API endpoint `GET /api/knowledge/files` — list `~/.autobahn/` directory for authed user
- Return tree structure with name, path, size, mtime, optional content preview
- Dashboard reads real file tree

### Code Changes

- New schema: SessionEventLog
- New file: `src/lib/knowledge/session-event-logger.ts`
- Wire into SSE handlers in `route.ts`
- New API: `/api/knowledge/timeline`, `/api/knowledge/files`
- Update `dashboard/knowledge/page.tsx` to use real data

### Success Criteria
- Timeline reflects actual user activity with correct timestamps
- File browser shows real files in `~/.autobahn/`
- No hardcoded data on the dashboard

---

## 6. Initiative 5: Knowledge → AppSpec

### Scope
`spec-deriver.ts` should query user's knowledge and influence the derived AppSpec.

### Technical Approach

Modify `deriveAppSpec()` to accept a `userKnowledgeContext`:
```typescript
interface UserKnowledgeContext {
  preferredFramework?: string;      // from UserStyleProfile
  preferredStyling?: string;
  commonPatterns: string[];         // top 5 retrieved patterns
  antiPrinciples: string[];         // top 3 things to avoid
}
```

Within spec derivation:
- If `framework` is undetermined in prompt, use `userKnowledgeContext.preferredFramework`
- If `palette` is ambiguous, use `userKnowledgeContext.preferredStyling`
- Inject `antiPrinciples` into the personality field so the AI doesn't do things the user dislikes

### Success Criteria
- For returning users, spec-deriver chooses their preferred stack 80%+ of the time when prompt is ambiguous
- Anti-principles appear in generated code quality (e.g., no inline styles when user has rejected inline styles)

---

## 7. Initiatives 6-10: Follow-On

Once the top 5 are shipped, these become valuable:

### 6. Evaluation Framework
Doc 06. Session Quality Score, before/after measurement, A/B harness for extraction prompts and retrieval ranking weights.

### 7. Knowledge Scope Field
Add `scope` enum to all knowledge tables. Retrieval respects scope. Project-specific decisions stop leaking into other projects.

### 8. Knowledge Graph / Relations
Add PatternRelation table (`patternA_id → patternB_id, relation_type, strength`). Enable transitive reasoning and contradiction detection.

### 9. Temporal Trajectory
VibeScoreHistory table. Daily snapshot job. Trend charts on dashboard. Preference-shift detection.

### 10. Internal Wisdom Skills
Meta-layer: rules about how to extract, retrieve, inject. Evolvable via A/B testing. See doc 03 Section 6.

---

## 8. Knowledge Portability

Once the top 5 ship, knowledge becomes portable:

### Export Targets
- **Claude Code** — skill as `.claude/commands/{name}.md`
- **Cursor** — skill patterns as `.cursorrules`
- **Windsurf** — skill patterns as `.windsurfrules`
- **Universal** — skill as `AGENTS.md` snippet
- **GitHub Copilot** — skill as `.github/copilot-instructions.md`
- **Plain markdown** — for copy/paste into any prompt

Export button on each skill in the gallery. One-click bundled export: "my top 10 skills to a zip."

### Knowledge API
For integration with external tools:

```
GET /api/v1/knowledge/top-skills?framework=react&limit=5
GET /api/v1/knowledge/style-profile
GET /api/v1/knowledge/anti-principles?limit=10
POST /api/v1/knowledge/retrieve  { prompt, context }
```

Enables:
- CI/CD quality checks (lint rules derived from user patterns)
- IDE extensions (inline suggestions informed by user's brain)
- Code review bots (flag deviations from user's established style)

---

## 9. Cross-Project Knowledge Transfer

Currently: patterns are user-level, applied to all projects. This has the leak problem (project-specific decisions appear elsewhere).

**Target design:**

```
User-level patterns (ALWAYS applied):
  - Coding style preferences
  - Framework preferences
  - Global anti-principles

Project-level patterns (applied only in this project):
  - Architectural decisions
  - Project-specific conventions
  - Custom design system rules

Cross-project transfer (opt-in):
  - User explicitly promotes a project-level pattern to user-level
  - "I use this pattern everywhere now" action
  - System suggests promotion after pattern is used successfully in 3+ projects
```

This preserves context correctness while enabling knowledge accumulation.

---

## 10. Community Layer

Currently passive (public skills with ratings). Target: active curation.

### Curation Mechanisms

1. **Semantic clustering.** Group similar community skills. Show "These 47 skills are variants of a React+Tailwind todo app. Top-rated version is here." Reduces duplicate proliferation.

2. **Quality filtering.** New public skills require ≥5 successful reuses before community visibility. Prevents spam.

3. **Provenance trails.** Community skill shows "derived from X sessions, N% success rate across users." Transparency.

4. **Anti-pattern contribution.** Users can publish anti-principles ("don't use Redux for simple state in 2026") — these are especially valuable because individual users don't learn them quickly.

5. **Trending detection.** Skills whose usage is increasing get surfaced. Skills whose usage is decreasing get de-emphasized (framework obsolescence tracking).

### Privacy

- Community skills are **deliberately anonymized** — no user identity, no project names, no proprietary tech stacks
- Users opt-in at skill-publish time
- Extraction happens only from marked-as-public sessions
- Provenance is aggregate, not individual

---

## 11. The Dream State — Concrete Vignettes

Making the first-pass "dream state" concrete with scenarios:

### Scenario 1: The Returning User
Alice has used Autobahn for 3 months. She types: "Build me a settings page for my new project."

*Today:* AI asks clarifying questions about framework, styling, etc. (same as day 1)

*Target:* 
```
AI: "I know you prefer React + Tailwind + dark theme for projects like this. 
     I have a skill for settings pages that's worked 4 times for you. 
     Proceed with your usual stack?" [Yes / Customize / Something different]
```
If Yes, the AI skips clarification entirely and uses the skill. Time from prompt to working code: 30 seconds instead of 5 minutes.

### Scenario 2: The Build Error
Bob is debugging. He hits an error: "Module not found: @/lib/utils".

*Today:* AI tries to diagnose from scratch, might ask to see tsconfig.

*Target:*
```
AI: "I've seen this error 3 times before in your projects. 
     Every time it was fixed by adding paths to tsconfig.json:
     compilerOptions.paths = { '@/*': ['./src/*'] }
     Apply this fix?" [Apply / Show me / Diagnose fresh]
```

### Scenario 3: The Preference Shift
Carol used Vue for 6 months, now she's exclusively working in React.

*Today:* Vue patterns still show up in her retrieval results, confusing matches.

*Target:* 
```
Dashboard: "📊 I've noticed your last 10 projects are React, not Vue.
           Want me to archive Vue-specific patterns or keep them for reference?"
           [Archive / Keep]
```

### Scenario 4: The User's Own Knowledge Audit
Dave opens his Brain dashboard.

*Today:* Sees counts and charts.

*Target:*
```
┌─ What I know about you ──────────────────────────┐
│                                                  │
│ STRONG CONFIDENCE (I'll apply these automatically)│
│   • You prefer TypeScript strict mode            │
│   • You organize components in feature folders   │
│   • You use Tailwind, not CSS modules            │
│                                                  │
│ MEDIUM CONFIDENCE (I'll suggest these)           │
│   • You might prefer Prisma over Drizzle         │
│   • You seem to like named exports               │
│                                                  │
│ LEARNING (I'm still unsure)                      │
│   • Testing framework preference                 │
│   • State management pattern for complex forms   │
│                                                  │
│                    [Correct me] [Teach me]       │
└──────────────────────────────────────────────────┘
```

The user sees what the Brain believes and can directly correct or reinforce. This is the trust-building UX that turns a black box into a collaborator.

---

## 12. What NOT to Build (Yet)

To keep the roadmap focused:

**Don't build:** Full knowledge graph visualization. Impressive but expensive; graph relations can be added later as a backend-only feature that enables better retrieval without needing a UI.

**Don't build:** Multi-modal knowledge (images, audio, video). Single-mode (text) is sufficient to be transformative; multi-modal is an order of magnitude more complex.

**Don't build:** AI agents that autonomously manage the knowledge base (decide to purge, merge, reclassify patterns). These will be useful eventually but are premature before the basic loop works.

**Don't build:** User-specific fine-tuned models. Overkill for the problem. Retrieval-augmented generation handles the personalization adequately.

**Don't build:** A mobile app. The dashboard can be responsive; a separate app is a maintenance tax we don't need.
