# Knowledge Representations — One Shape Is Not Enough
*New document, second pass only | Opus 4.7*

---

## 1. The Observation

Autobahn's Brain stores knowledge in one shape: text. Patterns have string `description` fields. Skills are markdown files. USER_VIBE.md is prose.

**Text is great for being consumed by LLMs.** But it's bad for:
- Querying (can't SQL-join on "patterns that imply this other pattern")
- Semantic retrieval (text is opaque to vector operations until embedded)
- Symbolic reasoning (can't combine rules systematically)
- Execution (can't directly run a skill's procedure)
- Validation (no schema constraints on what's a valid pattern)

A mature knowledge system uses **multiple representations for different purposes**.

---

## 2. The Five Representations

### 2.1 Free Text (Current Default)
- **What:** Markdown, string descriptions
- **Best for:** LLM consumption, human reading, flexible unstructured thought
- **Worst for:** Querying, reasoning, validation
- **Currently used for:** Pattern descriptions, skill files, memory files

### 2.2 Structured Records
- **What:** Typed fields in a database schema — `{trigger, condition, action, rationale}`
- **Best for:** Querying, filtering, validation, type safety
- **Worst for:** Expressing novel/unforeseen knowledge shapes
- **Currently used for:** Partial — some fields (framework, confidence, timesUsed) are structured; `description` is not

### 2.3 Embeddings (Vectors)
- **What:** Dense vector representation in high-dim space (e.g., 1536-dim)
- **Best for:** Semantic similarity, clustering, retrieval
- **Worst for:** Interpretability, precise logical operations
- **Currently used for:** Nothing — this is the biggest gap

### 2.4 Graphs
- **What:** Nodes (patterns) and typed edges (`implies`, `specializes`, `contradicts`, `supercedes`)
- **Best for:** Transitive reasoning, dependency tracking, visualization
- **Worst for:** Efficient retrieval-at-scale, fuzzy matching
- **Currently used for:** Nothing — relations between patterns are not represented

### 2.5 Symbolic Rules
- **What:** Declarative rules — `when(context) then(action) unless(exception)`
- **Best for:** Composable reasoning, deterministic application, explainability
- **Worst for:** Handling ambiguity, novel situations
- **Currently used for:** Partial — policy-engine.ts and recovery-recipes.ts have rule-like structures

### 2.6 Executable Skills (Procedures)
- **What:** Code/scripts that perform a task when invoked
- **Best for:** Direct automation, exact reproducibility
- **Worst for:** Flexibility, safety, unforeseen inputs
- **Currently used for:** Nothing formally — skills are recipes for the AI, not runnable code

---

## 3. Matching Representation to Purpose

Different operations require different representations:

| Operation | Needed Representation |
|-----------|----------------------|
| LLM consumes a pattern in a prompt | Text |
| Retrieve similar patterns for a query | Embedding |
| Check if pattern A implies pattern B | Graph |
| Filter patterns by framework and recency | Structured record |
| Apply a pattern deterministically (e.g., always-format) | Symbolic rule |
| Execute a skill end-to-end (e.g., scaffolding) | Executable |
| Explain why a pattern was applied | Graph + structured record |
| Merge two similar patterns | Embedding (similarity) + structured (comparison) |
| Detect contradictions | Graph or symbolic |
| Rank patterns by recent success rate | Structured |
| Find "patterns similar to this but for Vue instead of React" | Embedding + structured filter |

**No single representation handles all operations.** A Brain that uses only text is crippled for most of these.

---

## 4. The Recommended Hybrid Schema

Instead of choosing one representation, store each knowledge item in multiple:

```typescript
interface EnrichedPattern {
  // Identity
  id: string;
  
  // Structured record fields
  type: PatternType;              // reflex | recipe | heuristic | principle | anti-principle
  scope: Scope;                   // global | user | project | session | community
  framework?: string;
  language?: string;
  
  // Text representation (for prompt injection)
  trigger_text: string;           // "when building React forms"
  rule_text: string;              // "use react-hook-form"
  rationale_text: string;         // "cleaner validation + less re-rendering"
  
  // Embedding representation (for semantic retrieval)
  embedding: number[];             // vector(1536)
  
  // Symbolic representation (for composable rules, optional)
  symbolic?: {
    when: string;                 // predicate
    then: string;                 // action
    unless?: string;              // exception
  };
  
  // Graph metadata (edges stored separately in PatternRelation table)
  relatedIds: string[];           // cached neighbor IDs for quick lookup
  
  // Quality / temporal
  confidence: number;
  successCount: number;
  failureCount: number;
  createdAt: Date;
  confirmedAt: Date;
  decayScore: number;
  
  // Provenance
  sourceSessionId?: string;
  sourceExtractor: 'kea' | 'user' | 'imported-community';
}
```

**Storage cost:** An embedding is ~6KB per pattern (1536 floats × 4 bytes). At 10K patterns per user, that's 60MB. Manageable.

**Query cost:** pgvector with an HNSW index does cosine-similarity search in <100ms for 1M vectors. Comfortable.

---

## 5. The Representation Pipeline

When a new pattern is created (by KEA):

```
KEA output: { type, trigger, rule, rationale, confidence, ... }
    │
    ▼
[Structured fields written to DB]
    │
    ▼
[Embed(trigger + rule + rationale)] → embedding vector
    │
    ▼
[Stored alongside structured record]
    │
    ▼
[Graph relations inferred?]
    │
    ├─ Semantic similarity > 0.9 with existing pattern? → "duplicate" — merge or reject
    ├─ Semantic similarity 0.7-0.9? → "specializes" or "related" edge
    └─ Semantic similarity 0.0-0.3 with high-confidence pattern of opposite rule? → "contradicts" edge (flag for review)
    │
    ▼
[Pattern written, graph updated]
```

When a knowledge item is retrieved:
```
Query: user prompt
    │
    ▼
[Embed query] → query_vector
    │
    ▼
[pgvector: top-N by cosine similarity]
    │
    ▼
[Filter by structured fields: scope, framework, recency]
    │
    ▼
[Expand via graph: for each top result, include related-implies]
    │
    ▼
[Re-rank with multi-factor]
    │
    ▼
[Format text for prompt injection]
```

---

## 6. Symbolic Rules — When They Pay Off

Symbolic rules look attractive in theory but often over-engineer simple systems. Here's when they're worth building:

**When symbolic pays off:**
- **Reflexes** (unconditional rules like "always add semicolons") — cleanly expressed as symbolic
- **Policy-like constraints** (not user-learned, but configured — e.g., "never use deprecated API X")
- **Composition across domains** (rules that combine cleanly: "user prefers strict TS" + "this framework has strict TS support" → "enable strict TS for this project")

**When symbolic is overkill:**
- **Natural language preferences** ("user likes detailed explanations") — text representation is fine
- **One-off observations** (most KEA outputs) — store as structured record, don't try to formalize

**Recommendation:** Implement symbolic rules only for the **Reflex** type. Other types stay as text + embeddings.

---

## 7. Executable Skills — The Sharp Edge

Executable skills (actual code that runs) are powerful but dangerous:

**Power:** A skill becomes repeatable beyond the AI. User says "run my Next.js starter skill" — a script scaffolds the project identically every time.

**Danger:** Code execution with side effects. Must be sandboxed (Autobahn has container isolation — see section 4.4 of CLAUDE.md). Must be auditable. Must be limited in scope.

**Recommendation:**
- Don't implement executable skills in the first 6 months
- When implementing, restrict to read/write within the project directory only
- Require explicit user consent per-skill execution
- Prefer declarative templates (JSON describing files to create) over imperative scripts

Actually — Autobahn *already has* a form of this via the automation scripts system (`src/lib/automation/`). That's the right place to converge skill execution with, not a new subsystem.

---

## 8. Graph Storage — Practical Design

If implementing the graph layer:

```prisma
model PatternRelation {
  id         String   @id @default(cuid())
  fromId     String
  toId       String
  relation   String   // 'implies' | 'specializes' | 'generalizes' | 'contradicts' | 'supercedes' | 'related'
  strength   Float    @default(0.5)
  derivedBy  String   @default('inferred')  // 'user' | 'kea' | 'inferred'
  confirmedBy Int     @default(0)            // times user confirmed this relation
  disputedBy  Int     @default(0)
  createdAt  DateTime @default(now())
  
  @@unique([fromId, toId, relation])
  @@index([fromId, relation])
  @@index([toId, relation])
}
```

**Queries enabled:**
- `SELECT relatedPatterns FROM PatternRelation WHERE fromId = X AND relation IN ('implies', 'related')`
- Transitive: `WITH RECURSIVE ...` for k-hop neighborhoods
- Contradiction detection: find all edges where `relation = 'contradicts'`

**When to query graph:**
- During retrieval expansion: given top-5 patterns, expand to immediate neighbors, rank all candidates
- During pattern insertion: check for contradictions with existing patterns
- During periodic curation: detect cycles, find orphans, merge duplicates

**When NOT to query graph:**
- In the hot path of every prompt — too much latency
- For simple one-off lookups — structured records suffice

---

## 9. Representation Migration Path

Current state: text + minimal structured.
Target state: all five representations, hybrid storage.

**Phase 1 (week 1-2): Add embeddings**
- Schema: add `embedding` column to all knowledge tables
- Backfill: embed all existing records
- Query: use for retrieval

**Phase 2 (week 3-4): Harden structured records**
- Schema: add explicit `trigger`, `rule`, `rationale` fields (replace free-text `description`)
- KEA outputs structured, not text
- Backfill: run KEA over existing text descriptions to produce structured fields

**Phase 3 (month 2): Add graph**
- Schema: PatternRelation table
- Auto-infer obvious relations (high similarity → `related`, contradicting rules → `contradicts`)
- UI: show relations in dashboard (optional for v1)

**Phase 4 (month 3): Selective symbolic**
- Identify Reflex-type patterns
- Add `symbolic` field with when/then/unless structure
- Policy engine can evaluate symbolic rules directly, bypassing LLM

**Phase 5 (month 6+): Converge with executable skills**
- Connect Skill → automation script mapping
- User can promote a skill to an executable by defining script template

---

## 10. Anti-Pattern: Over-Generalized Representation

**Wrong approach:** Try to represent all knowledge uniformly in the most expressive format (e.g., graph-of-graphs).

**Why wrong:** Most knowledge is simple. Over-generalized representation is expensive to construct, slow to query, and rarely delivers value proportional to complexity.

**Right approach:** Use the simplest representation that supports the operation you need. Upgrade representation only when operations demand it.

Example: A style preference ("user prefers single quotes") doesn't need a graph node. It needs a structured field. Simple = best.

---

## 11. Bottom Line

The single most impactful representation addition is **embeddings**. It unlocks semantic retrieval, which is the biggest current gap.

The second most impactful is **hardening structured records** to replace free-text descriptions. It unlocks querying and rule composition.

Graph and symbolic representations are valuable but can wait until after these two are in place. Executable representation should wait until there's a proven need.

**Three-month representation roadmap:**
- Month 1: Embeddings on everything + pgvector retrieval
- Month 2: Structured records replace free text (KEA produces structured output)
- Month 3: Graph relations inferred and stored; used for retrieval expansion

Post-month-3, the Brain has the representation infrastructure to support arbitrarily sophisticated knowledge operations. Everything above that is feature development on a solid foundation.
