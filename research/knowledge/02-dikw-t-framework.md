# DIKW-T Framework, Critiqued and Extended
*Second pass: Opus 4.7 | First pass applied DIKW-T too mechanically. This pass engages with its limitations.*

---

## 1. The Original DIKW-T Framework

```
                    ╔══════════╗
                    ║  WISDOM  ║  applied knowledge with judgment
                    ╚═════╦════╝
              ╔═══════════╩═══════════╗
              ║      KNOWLEDGE         ║  patterns, principles — "what works"
              ╚═══════════╦════════════╝
         ╔════════════════╩════════════════╗
         ║         INFORMATION              ║  structured facts — "what happened"
         ╚════════════════╦═════════════════╝
    ╔════════════════════╩═══════════════════╗
    ║               DATA                       ║  raw events, logs
    ╚══════════════════════════════════════════╝

                  ───────── TIME (T) ─────────▶
```

The DIKW hierarchy has intellectual appeal: a clean progression from raw data to actionable wisdom. Adding time (T) turns a static snapshot into a dynamic system. The user's framing is sound.

---

## 2. The Known Problems with DIKW

The information science literature has extensively criticized DIKW. Common critiques relevant here:

### Critique 1: The Hierarchy Is Not Strictly Hierarchical
Wisdom can exist without detailed information below it. A seasoned engineer has wisdom ("strong types prevent many bugs") that was not derived bottom-up from data. DIKW implies a directional flow (data → info → knowledge → wisdom) that real cognitive systems don't follow.

**Relevance here:** Autobahn's Brain can have explicit wisdom rules ("never inline secrets") without bottom-up derivation. Treating DIKW as strictly bottom-up constrains the design.

### Critique 2: The Boundaries Are Fuzzy
What's the difference between "information" and "knowledge"? Between "knowledge" and "wisdom"? The boundaries shift with context. This makes DIKW useful as a mental scaffold but unreliable as a taxonomy.

**Relevance here:** Trying to cleanly classify a LearningPattern as "information" vs "knowledge" is not meaningful. The pattern has aspects of both. The model's value is in identifying layer-specific gaps, not cataloging items.

### Critique 3: DIKW Ignores Retrieval
The framework models *accumulation* (data → wisdom) but says nothing about *access*. Storing wisdom is half the system; retrieving the right wisdom at the right moment is the other half, and arguably the harder half. DIKW has no concept of this.

**Relevance here:** This is the *biggest* gap for Autobahn's Brain. Adding a retrieval axis transforms the framework from descriptive to operational.

### Critique 4: DIKW Ignores Representation
"Knowledge" is abstract. Knowledge represented as free-text markdown supports different reasoning than knowledge represented as a graph or as embeddings. DIKW treats representation as invisible.

**Relevance here:** Autobahn's knowledge is represented as text strings in DB columns. This forecloses whole classes of reasoning (graph traversal, semantic similarity, rule composition).

---

## 3. DIKW-T-R-R: Extending the Framework

I propose extending DIKW-T with two orthogonal axes, giving a 5-dimensional framework:

```
  Vertical axis: D → I → K → W (hierarchy of abstraction)
  Axis 1: T — Time (decay, trajectory, trend)
  Axis 2: R — Retrieval (how items are accessed and filtered)
  Axis 3: R — Representation (shape of the data: text, graph, vector, symbolic)
```

Any knowledge system can be audited against **all 5 dimensions** simultaneously.

### Dimension 1: Abstraction (D/I/K/W)
The classic vertical axis. Where in the hierarchy does each artifact sit?

### Dimension 2: Time
- Is there a timestamp?
- Is there decay?
- Is there trend analysis?
- Is there a time-series history?

### Dimension 3: Retrieval
- How is this knowledge retrieved when needed?
- Keyword / semantic / hybrid?
- Top-N fixed or relevance-ranked?
- Context-sensitive or context-free?

### Dimension 4: Representation
- Is this stored as text, graph, vector, symbolic rule, executable?
- What queries does the representation enable?
- What reasoning does the representation block?

---

## 4. Autobahn Brain Audit Across All 5 Dimensions

### Layer: DATA (raw session events)

| Dimension | Current | Target |
|-----------|---------|--------|
| **Abstraction** | ✓ Properly at data level | — |
| **Time** | Partial — AgentExecution has timestamps, SSE events are ephemeral | Add SessionEventLog table with full event timeline |
| **Retrieval** | ✗ No way to query raw session events | Searchable event log by userId, sessionId, eventType |
| **Representation** | Text + JSON blobs | Structured events with typed payloads |

### Layer: INFORMATION (extracted facts)

| Dimension | Current | Target |
|-----------|---------|--------|
| **Abstraction** | ✓ LearningPattern, TroubleshootingRecord at info level | — |
| **Time** | `createdAt` only | Add `confirmedAt`, `decayScore`, `supercededById` |
| **Retrieval** | Keyword matching + Jaccard, top-5 fixed | Hybrid: semantic (embeddings) + metadata filters + relevance ranking |
| **Representation** | Free-text `description` field | Structured fields: `trigger`, `approach`, `rationale`, `context` |

### Layer: KNOWLEDGE (reusable approaches)

| Dimension | Current | Target |
|-----------|---------|--------|
| **Abstraction** | ✓ Skills, patterns at knowledge level | — |
| **Time** | `timesUsed`, `confidence` increment | Add decay for unused skills, confidence penalty on failure |
| **Retrieval** | Keyword + framework match, threshold 0.3 | Semantic similarity + scope filter + recency-weighted |
| **Representation** | Markdown files + DB rows | + Graph relations (skill A implies B, skill X conflicts with Y) |

### Layer: WISDOM (context-sensitive rules)

| Dimension | Current | Target |
|-----------|---------|--------|
| **Abstraction** | Partial — Policy Engine, Recovery Recipes | + Wisdom selection rules (which knowledge fits which context) |
| **Time** | Static rules | Rule effectiveness tracked over time; rules evolve |
| **Retrieval** | Static if-then | Context-sensitive selection based on session state |
| **Representation** | Hard-coded in TypeScript | + Declarative wisdom rules stored in DB, editable |

---

## 5. The Lossy Compression View of DIKW-T-R-R

Every upward step in the abstraction hierarchy is **lossy compression**:

```
Data (10K tokens per session)
  ↓ compress by ~100:1 through extraction
Information (100 tokens per pattern)
  ↓ compress by ~10:1 through consolidation/selection
Knowledge (10-50 tokens injected into prompt per pattern)
  ↓ no further compression — direct use
Wisdom (applied — zero tokens, affects AI behavior)
```

The compression ratio from raw data to active wisdom is **~1000:1 or more**. This means:

1. **Almost all information is discarded at each step.** Good.
2. **What's kept must be chosen carefully.** The selection criterion is retrieval value: will this fragment be useful in future retrieval?
3. **Reversibility is lost at each step.** We can't reconstruct the session from the pattern. This is fine for storage economy but means we can't easily "zoom in" on a pattern to understand its context.

**Design principle:** Preserve *pointers* alongside compression. Each pattern should link back to the session event(s) that generated it, so zoom-in is possible when needed (debug, curation, dispute).

---

## 6. The Retrieval Axis — Deep Dive

Retrieval is the axis where the current system is weakest. Here's the current state in detail:

### Current Retrieval Paths

```
User prompt → buildAgentSystemPrompt()
                  │
                  ├── findMatchingSkill(userTask, framework)
                  │     Jaccard on triggers + framework match × confidence
                  │     → returns 1 skill if score > 0.3
                  │
                  ├── loadLearnedPatternsText(userId)
                  │     SELECT * WHERE successRate >= 0.7
                  │     ORDER BY successRate DESC, createdAt DESC
                  │     LIMIT 5
                  │
                  ├── loadFeedbackCorrectionsText(userId)
                  │     SELECT * WHERE rating='down' AND comment IS NOT NULL
                  │     ORDER BY createdAt DESC
                  │     LIMIT 5
                  │
                  └── buildVibeMemoryText()
                        readFile('~/.autobahn/USER_VIBE.md')
                        → full contents up to 25KB
```

### Problems with This Retrieval

1. **No relevance to current task for patterns.** `loadLearnedPatternsText` returns top 5 by overall success rate. The patterns might be completely unrelated to what the user is currently trying to build.

2. **No relevance to current task for feedback.** Same issue.

3. **Single-skill retrieval is brittle.** `findMatchingSkill` returns one skill. If the task is novel, no skill matches, and no skill is injected — but maybe a *partial* match would help.

4. **No scope filtering.** Retrieval doesn't distinguish between user-level and project-level patterns. A project-specific decision leaks into other projects.

5. **No semantic understanding.** "Build a todo app" doesn't retrieve patterns stored under "task list", "checklist", "TODO manager" because of keyword mismatch.

### Proposed Retrieval Architecture

**Hybrid Retrieval Pipeline:**

```
User prompt
    │
    ▼
[Embedding] → prompt_vector
    │
    ▼
┌───────────────────────────────────────────────────┐
│ PHASE 1: Candidate Generation (recall)            │
│   - Semantic: top-20 by cosine similarity         │
│   - Metadata: filter by framework, scope, freshness│
│   - Union: merge both candidate sets              │
└─────────────────────────┬─────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────┐
│ PHASE 2: Ranking (precision)                      │
│   Score = 0.4 × semantic_sim                      │
│         + 0.2 × success_rate                      │
│         + 0.15 × recency_decay                    │
│         + 0.15 × context_fit (session-specific)   │
│         + 0.1 × confidence                        │
│   Take top-5                                      │
└─────────────────────────┬─────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────┐
│ PHASE 3: Injection (quality)                      │
│   - Structured prompt section per type:          │
│     ## Your preferred approaches                 │
│     ## Things you've told me to avoid            │
│     ## A skill that might apply: {...}           │
│   - Size budget: ~1000 tokens total              │
└───────────────────────────────────────────────────┘
```

This is standard modern RAG. Autobahn has none of it.

---

## 7. The Representation Axis — Deep Dive

Different representations enable different reasoning:

| Representation | Strengths | Weaknesses |
|----------------|-----------|------------|
| **Free text (markdown)** | Human-readable, LLM-consumable | Not queryable, can't reason over |
| **Structured records** | Queryable, filterable | Limited to schema |
| **Embeddings (vectors)** | Semantic similarity | Not interpretable, context-free |
| **Graphs** | Relations, transitive inference | Heavier to implement |
| **Symbolic rules** | Composable, explainable | Rigid, limited expressiveness |
| **Executable skills** | Direct automation | Higher risk, narrower scope |

**The insight:** A mature Brain uses **all of these for different purposes**, not one representation for everything.

- Reflexes (auto-applied style rules) → Symbolic rules
- Recipes (build templates) → Markdown + executable (script)
- Heuristics (context-sensitive guidance) → Structured records + embeddings
- Principles (abstract values) → Short text fragments in prompts
- Anti-principles (things to avoid) → Structured records + embeddings for retrieval

See doc 07 for the full representation design.

---

## 8. The Time Axis — More Than Decay

My first-pass treatment of "T" focused on decay. Time has more dimensions:

### Decay
Knowledge fades when unused or uncorroborated. Covered in first pass. This is one face of time.

### Trajectory
Beyond scalar decay — each user's Vibe Score traces a path over time. Rising, flat, oscillating, declining. The *shape of the trajectory* is informative. A user whose Vibe Score has been flat for 3 weeks may have stopped benefiting from the Brain. This is a retention signal.

### Consolidation
Over time, specific patterns generalize. Five patterns about "preferred React conventions" eventually consolidate into one principle: "user's React style = X". The consolidation operation is time-dependent — it requires accumulated evidence.

### Emergence
New patterns appear from combinations. If the user repeatedly builds React + Tailwind + dark-mode apps, the triad becomes a higher-order pattern. This requires pattern co-occurrence tracking, which is time-indexed.

### Obsolescence
External changes make patterns stale. React 18 patterns become irrelevant when the user moves to React 19's new features. Obsolescence is tied to external calendar time, not just user activity.

### Retrieval Context
What was relevant **last week** or **this sprint** is a retrieval signal. Recency should boost retrieval weight not as a decay function but as a relevance signal ("recent sessions are more likely predictive of current session").

**Summary:** T is not one dimension. It's decay, trajectory, consolidation, emergence, obsolescence, and retrieval context — six sub-dimensions. A mature Brain tracks all six.

---

## 9. What the Framework Prescribes for Autobahn

Applying DIKW-T-R-R to Autobahn's Brain produces a clear prescription:

### Immediate (weeks 1-2)
- **R-Retrieval:** Add semantic retrieval (embeddings + pgvector + hybrid ranking)
- **R-Representation:** Add structured fields to LearningPattern (trigger, approach, rationale)
- **I-layer:** Add KEA for better extraction quality

### Short-term (weeks 3-4)
- **T-Decay:** Implement `decayScore` on patterns, daily decay job
- **T-Trajectory:** VibeScoreHistory table
- **K-layer → W-layer:** Close outcome → confidence feedback loop

### Medium-term (weeks 5-8)
- **R-Representation:** Add pattern relations (graph edges)
- **W-layer:** Context-sensitive selection rules
- **T-Consolidation:** Auto-merge patterns

### Long-term (months 3-6)
- **W-layer:** Internal wisdom skills that auto-evolve
- **T-Obsolescence:** Framework-version awareness
- **Community-layer:** Anonymized cross-user patterns

---

## 10. When NOT to Apply DIKW-T-R-R

This framework is useful for architectural auditing and gap analysis. It is **not** useful for:

- Day-to-day engineering decisions (use the ontology in doc 08 instead)
- User-facing product design (use premises in doc 00)
- Evaluation (use framework in doc 06)

DIKW-T-R-R is a telescope, not a ruler. It reveals the shape of the system; it doesn't measure its performance.
