# Knowledge → Code Quality — The Extraction AND Retrieval Problem
*Second pass: Opus 4.7 | First pass treated extraction as THE problem. Retrieval is the bigger one.*

---

## 1. The Reframe: Extraction Is Half the Problem

The user posed the question as an extraction problem: "We have session logs — how do we turn them into knowledge?" My first pass took that at face value and designed a Knowledge Extraction Agent (KEA).

The deeper analysis reveals that extraction is one of **four bottlenecks**, and not even the biggest one:

```
Session Log  →  Extraction  →  Storage  →  Retrieval  →  Injection  →  AI Use
              (bottleneck 1)  (bottleneck 2)  (bottleneck 3)  (bottleneck 4)
```

- **Bottleneck 1 (Extraction):** What gets extracted from the session? (KEA addresses this)
- **Bottleneck 2 (Storage):** In what representation? (Structured vs text. Doc 07.)
- **Bottleneck 3 (Retrieval):** When a new session starts, which stored knowledge gets loaded? (The biggest current gap — see doc 02.)
- **Bottleneck 4 (Injection):** How is the retrieved knowledge presented to the LLM so it actually uses it?

**The first-pass KEA design addressed bottleneck 1.** But you can have perfect extraction and still have a bad Brain if retrieval is noisy or injection is sloppy. A complete solution addresses all four.

---

## 2. The Doctor/Secretary Analogy, Precisely Parsed

The user gave two metaphors. They map onto the four bottlenecks unevenly, and the mapping matters.

### The Doctor

A doctor's job has four distinct phases:
1. **Listening** — patient tells their story (raw data)
2. **Examination + noting** — doctor writes the chart (extraction)
3. **Records system** — chart is filed, searchable (storage + retrieval)
4. **Next visit** — doctor reads the chart before seeing the patient (retrieval + injection)

The doctor's *clinical training* is what makes each phase effective:
- In phase 2, training tells them what's worth noting
- In phase 3, training dictates which records exist and how they're structured
- In phase 4, training tells them what to re-read and how to apply it

**Clinical training = internal wisdom skills.** It's not data; it's the know-how that shapes how data is processed.

### The Secretary

A secretary's job is audience-shaped extraction:
- The CEO's memo emphasizes strategic decisions, de-emphasizes process
- The engineer's memo emphasizes action items with technical context
- The legal's memo emphasizes statements that might have legal consequences

Same meeting, three different memos. The secretary knows who reads which memo.

**For Autobahn:** The "audience" of extracted knowledge is varied:
- **The AI in the next session** wants terse, immediately applicable rules ("don't inline styles")
- **The user's dashboard** wants human-readable highlights ("You built 3 todo apps this week")
- **The community** wants generic, sharable recipes ("React + Tailwind dark-mode starter")
- **The evaluation system** wants structured, measurable events

One extraction, four output formats. This is the secretary's talent applied to our domain.

### What the Analogies Miss

Both analogies are **about extraction, not retrieval.** They assume the problem is capturing information well.

The real challenge in AI systems is different: we capture easily (the data is cheap and voluminous), but we have trouble *bringing the right past knowledge to bear on the current moment*. A doctor has this problem too — when they see a complex case, they search memory/literature for similar cases. That search is the retrieval problem.

**The missing analogy: the Medical Librarian.** In a hospital, specialists often consult a medical librarian for relevant prior cases. The librarian's skill is not writing notes — it's *finding* the right notes among thousands, for the specific patient the doctor is seeing now.

**Our system needs both:** a KEA (doctor) and a Knowledge Retrieval Agent (KRA, the medical librarian).

---

## 3. The Knowledge Extraction Agent (KEA) — Revised Design

### What It Is

A lightweight LLM call that runs post-session, transforming unstructured session data into structured, typed knowledge items. The design from the first pass is sound; this pass adds precision.

### Structured Input

```typescript
interface KEAInput {
  // Session outcome
  sessionId: string;
  userId: string;
  projectId?: string;
  success: boolean;
  userFeedback?: 'up' | 'down' | null;
  userFeedbackComment?: string | null;

  // Session compressed trace (NOT full transcript)
  prompt: string;                      // User's original request
  clarificationAnswers?: string[];     // If any clarification was used
  skillInjected?: {
    name: string;
    matched_triggers: string[];
  };
  patternsInjected?: string[];         // Descriptions of top patterns
  
  // Session execution facts
  filesCreated: string[];
  filesModified: string[];
  filesRejected?: string[];            // Files the user rejected
  buildAttempts: number;
  errorsEncountered: string[];
  finalBuildSuccess: boolean;

  // Session meta
  framework?: string;
  language?: string;
  durationMs: number;
  tokensUsed: number;
}
```

**Notice:** This is ~500 tokens of structured input, not a 10K-token transcript. We're already doing 100:1 compression before the KEA even runs.

### Structured Output

```typescript
interface KEAOutput {
  // Zero, one, or multiple typed findings
  findings: Array<{
    type: 'reflex' | 'recipe' | 'heuristic' | 'principle' | 'anti-principle';
    scope: 'global' | 'user' | 'project' | 'session-context' | 'community-candidate';
    trigger: string;           // When does this apply?
    rule: string;              // What is the rule?
    rationale: string;         // Why (so the AI can adapt it)
    confidence: number;        // 0-1, how sure the KEA is
    source_session: string;    // Back-link for provenance
  }>;
  
  // Metadata
  kea_model: string;           // Which model did the extraction
  extraction_confidence: number; // Overall confidence in this extraction
  extraction_notes?: string;    // Optional KEA commentary
}
```

### The Extraction Prompt

```
You are extracting reusable knowledge from a coding session.
Output JSON matching the schema exactly.

Session summary:
- User prompt: {prompt}
- Framework: {framework}
- Success: {success}
- Build attempts before success: {buildAttempts}
- Files created: {filesCreated.join(', ')}
- Files user REJECTED: {filesRejected.join(', ') || 'none'}
- User feedback: {userFeedback || 'none'} {userFeedbackComment && `— "${userFeedbackComment}"`}
- Errors: {errorsEncountered.join('; ') || 'none'}

Extract at most 3 findings. Only include findings you are >= 0.7 confident about.

Types:
- REFLEX: "Always/never do X" — unconditional style/format rules
- RECIPE: "For task Y, approach is Z" — full templates for a task type
- HEURISTIC: "When context is A, prefer B" — context-sensitive guidance
- PRINCIPLE: abstract value ("prefer composition over inheritance")
- ANTI-PRINCIPLE: something to avoid, with reason

Scope:
- GLOBAL: applies to all this user's work
- USER: applies across this user's projects
- PROJECT: applies only in this project
- SESSION-CONTEXT: applies in a specific mode (e.g., "while debugging")
- COMMUNITY-CANDIDATE: might be valuable to others too

If there is no meaningful extraction, return {"findings": []}. Don't force findings.

Output JSON:
```

### Model Selection

- **Qwen3-Coder 7B (free tier via DashScope)** or **GLM-4.5-Air** — cost-efficient, structured-output capable
- **Expected cost:** $0.0005–$0.002 per session
- **Latency:** <2s post-session (fire-and-forget)

### Quality Filter After KEA

KEA output goes through a filter before writing to storage:

1. **Duplication check** — is this finding already in the DB (by semantic similarity > 0.85)?
2. **Specificity check** — reject findings shorter than 20 chars or containing only generic words
3. **Triggerability check** — does `trigger` field look applicable? (Heuristic: must mention task type or context)
4. **Confidence floor** — reject findings with confidence < 0.7
5. **Rate limit** — at most 3 findings per session accepted, to prevent KEA from over-producing

Findings that pass the filter are written to storage. Findings that fail are logged for KEA prompt debugging.

---

## 4. The Knowledge Retrieval Agent (KRA) — New Proposal

This is the piece the first-pass analysis missed. Retrieval deserves its own agent-level component.

### What It Is

A retrieval subsystem that, given a user prompt and session context, produces an optimally-ranked, context-filtered knowledge bundle for injection into the system prompt.

### Not (Just) An LLM Call

Unlike the KEA, the KRA is **mostly code, possibly augmented by an LLM**:

**Deterministic core (fast, no LLM call):**
1. Generate embedding of user prompt (cached per session)
2. Vector similarity search against LearningPattern, Skill, TroubleshootingRecord
3. Metadata filtering (framework, scope, recency)
4. Score and rank top-20 candidates

**Optional LLM layer (only for ambiguous cases):**
- If top-20 candidates are similar in score, call a small LLM to disambiguate
- If the user prompt is very short (high ambiguity), expand it first via a clarifying LLM call
- If the domain is novel (no good matches), decide whether to inject community patterns

### Retrieval Pipeline

```
User prompt (+ optional session context: debugging, refactoring, new-project)
    │
    ▼
[1] Embed prompt → prompt_vector
    │
    ▼
[2] For each knowledge table (LearningPattern, Skill, TroubleshootingRecord):
    Query: top-20 by cosine_similarity(prompt_vector, knowledge.vector)
    Filter: scope matches user/project/global as appropriate
    Filter: not decayed below threshold
    │
    ▼
[3] Merge candidates, deduplicate
    │
    ▼
[4] Re-rank with multi-factor scoring:
    score = 0.40 × semantic_similarity
          + 0.20 × success_rate
          + 0.15 × recency_decay
          + 0.15 × context_fit (does it match session context?)
          + 0.10 × confidence
    │
    ▼
[5] Take top-K per category:
    - 1 skill recipe (if any score > 0.6)
    - 3-5 heuristics/anti-principles relevant to current task
    - 2-3 reflexes (always-applied rules)
    - 1-2 troubleshooting records if user's prompt suggests a known error
    │
    ▼
[6] Format for injection with clear structure
```

### Injection Format (Bottleneck 4)

How the retrieved knowledge is formatted in the system prompt matters enormously. Some rules:

**Good structure:**
```markdown
## What I've Learned About You

### Your Preferred Approaches
- [HEURISTIC] For React apps, you prefer functional components with named exports
- [HEURISTIC] For data fetching, you use tanstack/query, not useEffect

### Things You've Told Me To Avoid
- [ANTI-PRINCIPLE] Don't inline styles — you rejected this twice in March
- [ANTI-PRINCIPLE] Don't use any types — you've corrected me 8 times on this

### A Skill That Might Apply
[Skill: React Tailwind Dark Todo]
- Used 3 times, 100% success rate
- Key decisions: Vite over CRA, Tailwind for styling, localStorage for persistence
- Files: src/App.tsx, src/components/TodoItem.tsx, tailwind.config.js

### Known Issue For This Framework
- [TROUBLESHOOTING] "Module not found: @/*" → Add paths to tsconfig.json compilerOptions
```

**Bad structure (what's happening today):**
```
Past corrections — learn from these:
- 2026-04-15 [poor_code]: Don't inline everything, use separate files
- 2026-04-10 [unclear]: Be more specific
...
```

Unstructured blocks of correction text bury the useful signal in noise. LLMs follow structured instructions much better than unstructured context.

---

## 5. The Full Pipeline, End-to-End

```
[Session N happens]
    │
    ▼
[KEA extracts findings] ──┐
    │                     │
    ▼                     ▼
[Quality filter]   [Update outcomes on injected knowledge]
    │                     │
    ▼                     ▼
[Write to DB]      [Update confidences up/down]
    │                     │
    ├─────────────────────┤
    ▼
[Embed + index new findings]
    │
    ▼
[Session N+1 starts]
    │
    ▼
[KRA retrieves relevant knowledge]
    │
    ▼
[Inject in structured format]
    │
    ▼
[AI produces better output]
    │
    ▼
[Measure: did quality improve?]
    │
    ▼
[Feed back to KEA prompt if systematic issue]
```

The pipeline has six distinct subsystems. The KEA (extraction) is one. The KRA (retrieval) is the bigger engineering effort. The quality filter, outcome feedback, embedding+indexing, and structured injection are all required for the whole system to work.

---

## 6. The Two-Part Skills Architecture (Refined)

The user's insight: there are skills that are *output* (for users) and skills that are *internal* (improve the extraction process).

**Refining this:**

### External (Knowledge) Layer
Skills in the sense currently implemented — reusable recipes, patterns, anti-patterns. These are what the KRA retrieves. These are what users see in the Skills Gallery. These are what power the AI's improvement.

### Internal (Wisdom) Layer
Meta-knowledge about how to extract, retrieve, and apply external skills:
- **Extraction rules** — "when a session has >=3 build failures, extract a troubleshooting record"
- **Retrieval rules** — "when user is in debug mode, boost troubleshooting records, de-emphasize style patterns"
- **Injection rules** — "when the user has >50 patterns, don't inject more than 5; when they have <5, inject all"
- **Evolution rules** — "if a pattern hasn't been retrieved in 180 days, decay its confidence by 30%"

**These internal rules are themselves improvable.** A/B testing two different extraction prompts, measuring which produces patterns with higher future reuse → the winning prompt becomes the new default. This is the **meta-learning loop**.

### Why This Separation Matters

Most "learning systems" conflate these two layers. Training a model → model produces outputs. But a mature system has:
- **Domain knowledge** (the external layer) that the AI uses to help users
- **Process knowledge** (the internal layer) that the system uses to improve itself

When the external layer stagnates, you're stuck. When the internal layer can evolve, the whole system compounds over time.

---

## 7. Friction Reduction — Session to Skill

The first-pass discussion is still correct:
- Show a session summary card after every session
- Lower the extraction threshold (not just ≥3 files)
- Allow user to confirm/edit/dismiss extracted findings
- Make skills exportable to other tools

Adding:
- **User can teach directly.** A "Teach the AI" button in settings: paste a rule, assign scope, save. Bypasses all extraction. The highest-quality input.
- **User can inspect retrieval.** For a given prompt, show "what would have been retrieved?" This debugs the retrieval system and builds trust.
- **Session replay with knowledge overlay.** For past sessions, show which knowledge was injected and what the outcome was. This is the provenance trail.

---

## 8. Bottom Line Rewriting the First Pass

The first-pass "KEA is the fix" was correct but partial. The complete picture:

| Bottleneck | Fix | Relative Priority |
|------------|-----|-------------------|
| Extraction | KEA + quality filter | #2 |
| Storage | Structured representation + embeddings | #3 |
| **Retrieval** | **KRA with semantic + hybrid ranking** | **#1** |
| Injection | Structured prompt sections | #4 |
| Feedback | Outcome → confidence closed loop | #1 tied |

Retrieval is the biggest unlock because:
- All current patterns exist but can't be found for novel prompts (semantic gap)
- Fixing retrieval improves the value of existing data immediately
- Better retrieval creates better signals for which patterns are truly useful → improves curation → feeds back into extraction quality

**If only one thing could be built, build the KRA** (semantic retrieval layer). Even with today's noisy patterns, better retrieval surfaces the diamonds.
