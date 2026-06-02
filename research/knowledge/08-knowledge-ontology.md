# Knowledge Ontology — Five Categories, Clearly Separated
*New document, second pass only | Opus 4.7*

---

## 1. The Problem

The current Brain has knowledge types that blur:

- `LearningPattern.patternType` has 12 values: `style, convention, correction, preference, troubleshooting, debugging, architecture, performance, testing, refactoring, documentation, workflow`
- `Skill` is separate from LearningPattern but structurally similar
- `TroubleshootingRecord` overlaps with `LearningPattern.patternType = 'troubleshooting'`
- `UserStyleProfile` overlaps with `LearningPattern.patternType = 'style'`

**The categories don't carve reality at its joints.** A "preference" might be a style choice (reflex-like) or a strategic decision (heuristic-like). A "workflow pattern" might be a principle or a recipe. The taxonomy is flat where it should be hierarchical, and overlapping where it should be disjoint.

**Proposal:** A 5-category ontology that is orthogonal, exhaustive, and drives distinct storage/retrieval rules.

---

## 2. The Five Categories

| Category | What It Is | Example | When Applied |
|----------|-----------|---------|--------------|
| **Reflex** | Unconditional, automatic rule | "Always end files with newline" | Every time, no context check |
| **Recipe** | Template for a known task | "React todo app with Tailwind" | When task matches template |
| **Heuristic** | Context-sensitive guidance | "For complex forms, use react-hook-form" | When context matches |
| **Principle** | Abstract value | "Prefer composition over inheritance" | Prompt influence, not rule |
| **Anti-principle** | Thing to avoid, with reason | "Don't inline styles — user rejects" | Prompt influence, negation |

### Why These Five

- **Reflex** vs. **Heuristic** distinguishes unconditional rules (always apply) from conditional ones (check context first). Current system conflates these.
- **Recipe** vs. **Principle** distinguishes concrete templates ("here's what to do") from abstract values ("here's what to prefer"). Current system treats them the same.
- **Anti-principle** is called out separately because rejection signals are quantitatively different from positive preferences.

### Exhaustiveness Check

Can every existing LearningPattern.patternType be mapped?

| Old type | New category | Notes |
|----------|-------------|-------|
| `style` | **Reflex** | "Always use 2 spaces" |
| `convention` | **Reflex** (naming conventions are automatic) | |
| `correction` | **Anti-principle** (context of what was corrected) | |
| `preference` | **Heuristic** if context-sensitive, **Reflex** if universal | Must split |
| `troubleshooting` | Not a pattern — separate `TroubleshootingRecord` entity | |
| `debugging` | **Heuristic** (apply specific strategy in specific context) | |
| `architecture` | **Recipe** (templates) or **Principle** (abstract values) | Must split |
| `performance` | **Heuristic** | |
| `testing` | **Recipe** (templates) or **Heuristic** (patterns) | Must split |
| `refactoring` | **Heuristic** | |
| `documentation` | **Heuristic** (usually context-specific) | |
| `workflow` | **Recipe** (templates for workflow) or **Principle** (values about workflow) | Must split |

Mapping is clean. Several old types need splitting, which is a correctness improvement.

---

## 3. Per-Category Rules

Each category has distinct rules for storage, retrieval, and injection.

### 3.1 Reflex

**Storage:**
- Structured symbolic rule: `{ when: always, then: action }`
- Optional: scope filter ("only in TypeScript files")
- High confidence (0.8+) by default; reflexes should be near-certain

**Retrieval:**
- Always-loaded, not conditional
- Very cheap — just filter by scope

**Injection:**
- Injected as a short "always do" list at the top of the system prompt
- Format: `- Always use 2-space indentation`

**Extraction by KEA:**
- Only create a reflex if observed consistently (10+ times)
- High bar to prevent false reflexes

### 3.2 Recipe

**Storage:**
- Markdown skill file (already exists) + structured metadata
- Embedding for semantic retrieval
- Higher token budget — recipes can be detailed

**Retrieval:**
- Semantic similarity against user prompt
- Threshold: cosine similarity > 0.6 (high bar — only match when clear)
- At most 1 recipe injected per session

**Injection:**
- Formatted as "A skill that might apply: [name]... key decisions..."
- Clearly marked as optional ("consider using this approach")

**Extraction by KEA:**
- Created for sessions with ≥3 files created AND build success
- Updates existing recipe if semantic similarity > 0.85

### 3.3 Heuristic

**Storage:**
- Structured: `{ when, then, because }`
- Embedding for retrieval
- Medium confidence (0.5-0.9 range); heuristics have exceptions

**Retrieval:**
- Semantic similarity + context fit
- Up to 3-5 heuristics injected per session

**Injection:**
- Format: `- For [context], [approach]. (reason: [because])`
- Grouped in "Your preferred approaches" section

**Extraction by KEA:**
- Most common KEA output
- Created when a context-specific preference is observed

### 3.4 Principle

**Storage:**
- Short text, structured category
- No embedding needed (few principles total)
- High confidence — principles are explicit statements

**Retrieval:**
- Always-loaded (few of them)
- Filter only by scope

**Injection:**
- Format: `- [Principle text]`
- Grouped in "Principles you care about" section

**Extraction by KEA:**
- Rare output. Principles are often user-declared, not KEA-derived.
- If KEA proposes a principle, flag for user confirmation

### 3.5 Anti-Principle

**Storage:**
- Structured: `{ avoid, instead, reason }`
- Embedding for retrieval

**Retrieval:**
- Semantic + strong weighting (user rejection is high-signal)
- Up to 3 anti-principles injected per session

**Injection:**
- Format: `- Don't [avoid] (you [rejected/corrected] this [N] times). Instead: [instead]`
- Grouped in "Things you've asked me to avoid" section

**Extraction by KEA:**
- Created when user rejects a file, gives thumbs-down with comment, or corrects specific code
- Confidence starts higher than patterns — rejections are strong signals

---

## 4. The Cleaner Schema

```prisma
enum KnowledgeType {
  reflex
  recipe
  heuristic
  principle
  anti_principle
}

enum KnowledgeScope {
  global
  user
  project
  session_context
  community
}

model Knowledge {
  id           String        @id @default(cuid())
  userId       String
  projectId    String?
  
  type         KnowledgeType
  scope        KnowledgeScope @default(user)
  
  // Common fields
  triggerText  String        // when does this apply
  ruleText     String        // the rule itself
  rationale    String?       // why
  
  // Representations
  embedding    Unsupported("vector(1536)")?
  
  // Type-specific structured fields (union, only relevant ones used)
  symbolicWhen String?       // for Reflex
  symbolicThen String?       // for Reflex
  instead      String?       // for Anti-principle
  
  // Quality
  confidence   Float         @default(0.7)
  successCount Int           @default(0)
  failureCount Int           @default(0)
  usageCount   Int           @default(0)
  
  // Temporal
  createdAt    DateTime      @default(now())
  confirmedAt  DateTime?
  lastUsedAt   DateTime?
  decayScore   Float         @default(1.0)
  
  // Provenance
  sourceSessionId String?
  extractedBy     String     @default("kea")  // kea | user | imported
  
  // Relations (normalized in KnowledgeRelation table)
  
  @@index([userId, type, scope])
  @@index([userId, type, confidence])
}

model KnowledgeRelation {
  fromId    String
  toId      String
  relation  String         // implies, specializes, contradicts, supercedes
  strength  Float          @default(0.5)
  @@id([fromId, toId, relation])
}
```

**Migration path:** Flatten the current LearningPattern + Skill + TroubleshootingRecord + partial UserStyleProfile into this unified Knowledge table. `TroubleshootingRecord` can remain separate (it's distinct enough — problem + solution pairs) or be modeled as `type = heuristic` with trigger = problem, rule = solution.

---

## 5. Benefits of the Clean Ontology

### For Retrieval
Each type has clear retrieval rules. No ambiguity about how a pattern should be matched.

### For Injection
Each type has a clear injection format. Structured sections in the system prompt replace the current unstructured blob.

### For Extraction
KEA's output schema can enforce one of five types. No ambiguous types.

### For User Understanding
When the dashboard shows "Your Knowledge," it categorizes into 5 clean buckets. Users understand what each bucket means.

### For Quality
Different types have different confidence norms. Reflexes must be high-confidence; heuristics can be medium. No blended confidence.

---

## 6. Migration Without Breaking Things

The current schema works; migration must not break existing functionality.

### Step 1: Add the new Knowledge table
Alongside LearningPattern, Skill, etc. Write dual-path: new data goes to Knowledge, old readers still read LearningPattern.

### Step 2: Migrate existing data
- For each LearningPattern, classify into one of 5 types using mapping table (Section 2)
- Write duplicate record to Knowledge
- Keep LearningPattern intact

### Step 3: Update readers
- `loadLearnedPatternsText()` reads from Knowledge
- `findMatchingSkill()` reads from Knowledge where type = 'recipe'
- Old tables become read-only

### Step 4: Deprecate old tables
- After 30 days of parallel operation with no issues, stop writing to old tables
- After 60 days, archive and drop

---

## 7. Category Quick-Reference

For future reference when implementing or thinking about new knowledge items:

**Is it unconditional and brief?** → **Reflex** (structured symbolic rule)

**Is it a template for a specific task type?** → **Recipe** (markdown + structured + embedding)

**Is it "when X, prefer Y"?** → **Heuristic** (structured trigger/rule/rationale + embedding)

**Is it an abstract value the user holds?** → **Principle** (text, always-loaded)

**Is it something the user has asked to avoid?** → **Anti-principle** (structured avoid/instead/reason + embedding)

---

## 8. Bottom Line

The current 12-type taxonomy is muddled. A 5-category ontology — Reflex, Recipe, Heuristic, Principle, Anti-principle — is cleaner, more actionable, and matches how knowledge is actually used in prompts.

Migrating to this ontology is a foundational correctness improvement. It's not urgent (the system works today), but it unlocks clarity for every subsequent feature. Recommended to do before the graph layer (Section 9 of doc 07) but after the embedding and retrieval work (doc 04 Initiatives 1-2).
