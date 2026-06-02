# Platform Blueprint — A Knowledge Operating System for AI-Assisted Development
*Third pass synthesis: Opus 4.7 | The greenfield design*

---

## 1. Reframing the Product

**The current framing (implicit in Autobahn today):**
> "Autobahn is an AI-assisted coding platform. It has a Brain feature that helps the AI learn your preferences."

**The greenfield framing:**
> "This is a Knowledge Platform for AI-assisted development. The Brain is the *entire* product — a persistent, queryable, evolving, shareable layer of coding knowledge that serves any AI tool via MCP."

**Critical scope boundary:**

The Brain Platform is **not an AI coding tool.** It does not:
- Generate code
- Parse or execute tool calls
- Stream AI output
- Run an agentic loop
- Host containers or preview servers
- Have a prompt input for code generation

It **receives events** from external AI tools that *do* those things, processes those events into knowledge, and serves that knowledge back to any AI tool on demand.

Think of it like **GitHub for AI-generated knowledge** — a shared backbone that every code editor and AI agent can talk to, without GitHub itself being an editor or agent.

**External clients in the ecosystem:**
- Claude Code — adds our MCP server, gains Brain access
- Cursor — same
- Windsurf — same
- Autobahn's existing vibe-coding app — same (becomes one of many clients)
- Custom agents and IDE plugins — same

The platform's reach is the union of all connected clients. The platform's size stays small because it never implements code generation.

**Why the reframe matters:**
- The Brain is the entire product surface, not a feature
- Anyone can build an AI tool that connects — the platform is open-API-first
- Teams, not just individuals, have Brains
- Community intelligence emerges from aggregated anonymized patterns
- The chat interface (Oracle) makes the Brain directly queryable by users

The product value proposition: **"the knowledge you build while coding with any AI tool, made permanent, portable across tools, and compounding over time."**

---

## 2. Stakeholders and Use Cases

| Stakeholder | Primary Use |
|------------|-------------|
| **Individual developer** | Personal Brain that makes their AI sessions smarter over time; queryable via chat |
| **Team** | Shared team Brain for engineering standards, architectural decisions, known pitfalls |
| **Enterprise** | Custom internal wisdom skills, compliance-aware knowledge, SSO-integrated team Brains |
| **AI agent (MCP client)** | Query user's knowledge before generating code; report outcomes back |
| **Tool integrator** | Embed the Brain in their own IDE/tool via SDK or MCP |
| **Community member** | Publish skills, browse others' skills, build reputation |

Six stakeholders. Today's Autobahn serves only stakeholder #1 directly. The platform vision addresses all six.

---

## 3. The Three-Layer Architecture

```
            ┌─ OUTSIDE THE PLATFORM ──────────────────────┐
            │                                             │
            │   Claude Code  │  Cursor  │  Windsurf       │
            │   Autobahn     │  Custom  │  IDE plugins    │
            │   (these do the actual vibe-coding)         │
            │                                             │
            │                  │ MCP                      │
            │                  ▼                          │
            └──────────────────┬──────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      EXPERIENCE LAYER (platform surface)            │
│                                                                     │
│   Webapp         MCP Server      Native SDK     REST API            │
│   (humans)       (AI agents)     (integrators) (automation)         │
│                                                                     │
│   NOTE: No vibe-coding UI. No code-generation loop. No tool         │
│   execution. The platform's surfaces serve knowledge — they do      │
│   not generate or run code.                                         │
│                                                                     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                    INTELLIGENCE LAYER                               │
│                                                                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │
│  │  Ingestion │  │ Extraction │  │ Retrieval  │  │ Evolution  │     │
│  │ (sessions) │  │   (KEA)    │  │   (KRA)    │  │ (curation) │     │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘     │
│                                                                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐     │
│  │   Oracle   │  │ Evaluation │  │   Trust    │  │   Audit    │     │
│  │ (Q&A RAG)  │  │   (SQS)    │  │(confidence)│  │(provenance)│     │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                       DATA LAYER                                    │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │Knowledge │  │ Session  │  │Community │  │   Team   │             │
│  │  Vault   │  │  Events  │  │   Pool   │  │  Vaults  │             │
│  │(per user)│  │   Log    │  │(anonymous)│  │(shared)  │             │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘             │
│                                                                     │
│  Postgres + pgvector + Object Storage (session archives)            │
└─────────────────────────────────────────────────────────────────────┘
```

**Data Layer:** Where knowledge and raw data live. Postgres + pgvector for everything structured + embedded. Object storage for session replays and large artifacts.

**Intelligence Layer:** Eight subsystems that operate on data. Each has a clear contract; each can be developed and scaled independently.

**Experience Layer:** Four surfaces for humans, agents, and integrators to interact with the system. All sit on the same Intelligence Layer.

---

## 4. Multi-Tenancy Model

Three knowledge scopes with strict data boundaries:

### 4.1 Personal Vault
- Every user has one
- Contains all their knowledge: skills, patterns, memory, style preferences
- Default scope for auto-extracted knowledge
- Fully private — not visible to team, community, or ops (except for anonymized aggregation)

### 4.2 Team Vault
- Teams can create shared vaults
- Team members can read team knowledge; editors can write; admins can govern
- Team knowledge does NOT auto-propagate from individuals — explicit promotion
- Use case: team engineering conventions, architectural decisions, institutional knowledge

### 4.3 Community Pool
- Opt-in publishing of skills and anti-principles
- Aggregated and anonymized — no user attribution by default (pseudonymous username optional)
- Moderated: new skills gated behind usage threshold before public visibility
- Curated: semantic clustering prevents duplicate proliferation

### 4.4 Boundaries

| Data | Personal Vault | Team Vault | Community Pool |
|------|---------------|-----------|---------------|
| Session events | ✓ | ✗ (unless explicitly shared to team) | ✗ |
| Skills | ✓ (all) | ✓ (promoted from personal) | ✓ (opt-in publish) |
| Patterns | ✓ (all) | ✓ (promoted) | ✗ (too personal) |
| Anti-principles | ✓ (all) | ✓ (promoted) | ✓ (opt-in, anonymized) |
| Style profile | ✓ | ✗ (team-level style exists separately) | ✗ |
| Preferences | ✓ | ✗ | ✗ |

**Default is always personal.** Promotion to team is explicit user action. Publishing to community is explicit user action with content review.

---

## 5. The Eight Core Subsystems

### 5.1 Ingestion
**Purpose:** Capture every vibe-coding session, IDE interaction, git event, and user-taught knowledge into a canonical event stream.

**Inputs:**
- Vibe-coding sessions (current)
- IDE plugin events (future: VS Code extension, JetBrains plugin)
- Git hooks (commits, PR descriptions, review comments)
- User-taught knowledge (explicit "teach" actions)
- Import from other tools (CLAUDE.md, .cursorrules files)

**Output:** Canonical `SessionEventLog` records — typed events with timestamps.

**Design note:** Treat this as a data pipeline with idempotency, replay capability, and schema evolution from day 1.

### 5.2 Extraction (KEA)
**Purpose:** Transform session events into structured knowledge items.

**Design:** LLM-based extraction (not keyword matching). Lightweight model (Qwen/GLM-Air tier). Typed output (Reflex, Recipe, Heuristic, Principle, Anti-principle). Quality filter before write. Rate-limited per session.

**Two modes:**
- **Auto** — post-session, fire-and-forget, conservative threshold
- **High-sensitivity** — for first 5 sessions of a new user, aggressive + user-confirmed

See doc 03 for full KEA design.

### 5.3 Storage
**Purpose:** Persist knowledge in the right representation for the right operation.

**Layers:**
- Structured records (Postgres): metadata, confidence, relations
- Vector embeddings (pgvector): semantic retrieval
- Full-text (Postgres FTS): keyword fallback
- Markdown files (object storage): skill definitions, session replays
- Graph edges (Postgres): pattern relations

See doc 07 for representations, doc 08 for ontology.

### 5.4 Retrieval (KRA)
**Purpose:** Given a query (user prompt, chat question, tool call from MCP), return the optimal knowledge bundle.

**Design:** Hybrid retrieval (semantic + metadata filters + graph expansion) with multi-factor ranking. Context-aware. Scope-respecting.

See doc 03 Section 4 for full KRA design.

### 5.5 Evolution
**Purpose:** Keep knowledge fresh, relevant, non-contradictory, non-stale.

**Operations:**
- **Confidence feedback** — update knowledge confidence from session outcomes
- **Temporal decay** — unused knowledge fades
- **Consolidation** — similar patterns merge
- **Contradiction detection** — flag conflicting knowledge
- **Obsolescence** — detect and deprecate framework-version-stale knowledge
- **Preference shift detection** — notice when user's patterns change

Runs as background jobs (daily, weekly). Surfaces findings for user review.

### 5.6 Oracle (Chat)
**Purpose:** Natural-language interface to the user's Brain.

**Use cases:**
- "What do I usually do for authentication?"
- "Show me my patterns about testing"
- "How did I solve the CORS issue last month?"
- "What am I confident about in React vs. unsure about?"

**Design:** RAG with structured output, citing knowledge items used in the answer. See doc 12.

### 5.7 Evaluation
**Purpose:** Know if the system is working.

**Design:** Session Quality Score, A/B testing harness, knowledge health metrics. See doc 06.

### 5.8 Trust / Confidence
**Purpose:** Quantified uncertainty for every knowledge item.

**Operations:**
- Initial confidence assigned by KEA or by user (explicit teach = 1.0, KEA = 0.7)
- Updated via outcome feedback
- Decayed over time
- Used in retrieval ranking
- Exposed to users (dashboard shows high-confidence vs. low-confidence knowledge)

### 5.9 Audit / Provenance
**Purpose:** Every piece of knowledge traces back to its source.

**Operations:**
- Every knowledge item links to source session(s)
- Every knowledge-driven AI action logs which knowledge was used
- User can inspect: "why did the AI do X? show me the knowledge that led to this"
- Required for GDPR compliance and enterprise trust

---

## 6. Data Model (Core Tables)

```prisma
// === TENANCY ===
model User { id, email, ... }
model Team { id, name, ownerId, ... }
model TeamMembership { userId, teamId, role }

// === KNOWLEDGE (unified) ===
model Knowledge {
  id            String
  type          KnowledgeType  // reflex|recipe|heuristic|principle|anti_principle
  scope         KnowledgeScope // personal|team|community
  ownerUserId   String?        // null for team or community
  ownerTeamId   String?        // null for personal or community

  triggerText   String
  ruleText      String
  rationale     String?
  symbolicWhen  String?
  symbolicThen  String?
  
  embedding     Vector(1536)
  framework     String?
  tags          String[]
  
  confidence    Float
  successCount  Int
  failureCount  Int
  usageCount    Int
  decayScore    Float
  
  createdAt     DateTime
  confirmedAt   DateTime?
  lastUsedAt    DateTime?
  
  extractedBy   String         // kea|user|imported|promoted
  sourceSessionIds String[]    // provenance
  parentKnowledgeId String?    // for versioning / specialization
}

// === RELATIONS (the graph) ===
model KnowledgeRelation {
  fromId, toId, relation, strength, confirmedBy, disputedBy
}

// === SESSIONS ===
model Session {
  id, userId, projectId?, teamId?, startedAt, endedAt
  clientType     String  // vibe_coding|claude_code|cursor|ide_plugin
  outcome        String  // success|partial|failed
  sqs            Float   // session quality score
  metadata       Json
}

model SessionEvent {
  id, sessionId, eventType, payload, timestamp
}

model SessionKnowledgeApplication {
  sessionId, knowledgeId, role   // injected|retrieved_but_not_used|extracted
}

// === FEEDBACK ===
model Feedback {
  id, sessionId?, knowledgeId?, userId, rating, comment, feedbackType
}

// === COMMUNITY ===
model CommunitySkill {
  id, knowledgeId, publishedByUserId, publishedAt
  downloadCount, successRate, averageRating, reportCount
  moderationStatus  // pending|approved|flagged|removed
}

model SkillImport {
  userId, communitySkillId, importedAt, removedAt?
}
```

Lean, orthogonal, scope-aware. Every table has a clear purpose.

---

## 7. The Knowledge Lifecycle

A single knowledge item's lifecycle:

```
[1] CREATION
    ├── auto-extracted by KEA from session
    ├── explicitly taught by user
    ├── imported from git history or external file
    └── promoted from personal → team → community

[2] STORAGE
    Written to Knowledge table + embedded + indexed
    
[3] RETRIEVAL
    Matched against user queries via KRA
    Injected into AI prompts or returned to Oracle
    
[4] APPLICATION
    AI uses it in generating output
    OR Oracle cites it in chat response
    OR User views it in dashboard
    
[5] FEEDBACK
    Session outcome updates confidence
    User can explicitly confirm, correct, or delete
    
[6] EVOLUTION
    ├── Consolidated with similar items
    ├── Superceded by newer version
    ├── Specialized for a context
    ├── Generalized to a principle
    └── Decayed from disuse
    
[7] ARCHIVAL
    Low-confidence + unused + old → archived (not deleted)
    Provenance preserved for audit
    
[8] DELETION
    User-initiated via GDPR erasure request
    OR 7 years post-archival per retention policy
```

Every stage has:
- Clear input/output
- Observable state changes
- Auditable provenance
- Privacy-respecting boundaries

---

## 8. The Flywheel

The compounding dynamic that makes this platform valuable over time:

```
More sessions → richer session log
    ↓
Richer log → better KEA training data (prompts, quality filters)
    ↓
Better KEA → higher-quality knowledge
    ↓
Higher-quality knowledge → better KRA signal
    ↓
Better retrieval → AI sessions improve
    ↓
Better sessions → users retained and engaged
    ↓
More users → community pool grows
    ↓
Community pool → bootstrap better for new users
    ↓
New users → MORE SESSIONS (cycle reinforces)
```

**Conditions for the flywheel to spin:**
1. Noise filter must work (quality > quantity)
2. Outcome feedback must close (bad knowledge purged)
3. Evaluation must track SQS (can detect if flywheel stalls)
4. New user onboarding must use community pool (otherwise cold-start blocks everything)

**Conditions for the flywheel to stall:**
1. If extraction is noisy, knowledge pool fills with garbage (killed by Evolution subsystem + quality filter)
2. If retrieval is bad, good knowledge can't be surfaced (killed by KRA + evaluation)
3. If user feedback is not captured, confidence never updates (killed by structured feedback UX)
4. If community is not moderated, bad actors poison the pool (killed by Trust + Community moderation)

Each killer is a subsystem we've designed.

---

## 9. Differentiation from Current Autobahn

| Dimension | Current Autobahn | Platform Vision |
|-----------|------------------|-----------------|
| Primary product | AI coding tool with a Brain feature | Knowledge OS; coding is one surface |
| Tenancy | Single-user | Personal + team + community |
| AI access | Only Autobahn's AI | Any MCP client (Claude Code, Cursor, custom agents) |
| Knowledge consumption | Implicit (prompt injection) | Implicit + explicit (chat / Oracle) |
| Knowledge ontology | Flat 12-type | 5-category hierarchical |
| Retrieval | Keyword/Jaccard | Semantic + hybrid |
| Extraction | Keyword matching | LLM-based KEA |
| Feedback loop | Open | Closed |
| Knowledge portability | Minimal | Full export to Claude Code, Cursor, .cursorrules, AGENTS.md, API |
| Teams | Basic | First-class team Brains |
| Community | Passive skill gallery | Active curation, clustering, reputation |
| Evolution | Manual | Background subsystem |
| Evaluation | Absent | SQS + A/B harness |

Every row is an explicit architectural decision for the greenfield design.

---

## 10. Key Architectural Principles

These constraints should guide every design decision:

### 10.1 MCP-First
The MCP server is the primary knowledge access API. The webapp is a client of it, just like any AI agent would be. This means:
- If the webapp wants a feature, it should be exposable via MCP too
- Knowledge operations happen through the MCP contract, not REST ad-hoc
- The MCP server enforces authentication, authorization, scope

### 10.2 Knowledge Is Immutable + Versioned
Once written, a knowledge item is not edited in place. Changes create new versions. The Knowledge table has `parentKnowledgeId` for lineage. This enables:
- Rollback
- Audit trail
- Safe experimentation ("try this new version")

### 10.3 Provenance Is Mandatory
Every knowledge item must trace back to at least one source: session, user teaching, import. Orphan knowledge cannot exist. Provenance enables explainability and GDPR compliance.

### 10.4 Privacy by Default
All new knowledge is personal-scope unless explicitly promoted. No auto-promotion to team or community. Users control their data.

### 10.5 Separation of Reading and Writing
Fast read path (cached embeddings, indexed graph) is separate from slow write path (KEA extraction, quality filtering). Reads are hot and synchronous; writes are asynchronous and idempotent.

### 10.6 Every Action Is an Event
Session events, knowledge applications, user feedback — all logged as events. This is the source of truth. All derived state (knowledge items, metrics) can be rebuilt from events.

### 10.7 The Model Is Queryable
Users should be able to inspect what the Brain knows about them. Every knowledge item must be visible, describable, and deletable.

### 10.8 Fail Soft
Knowledge retrieval failure never breaks a coding session. Extraction failure never breaks a completed session. Every subsystem degrades gracefully.

---

## 11. Infrastructure Topology

```
                    ┌─────────────────┐
                    │   Load Balancer │
                    └────────┬────────┘
                             │
        ┌────────────────────┼─────────────────────┐
        │                    │                     │
  ┌─────▼──────┐     ┌───────▼───────┐     ┌──────▼──────┐
  │ Webapp     │     │ MCP Server    │     │ REST API    │
  │ (Next.js)  │     │ (stdio/http)  │     │ (Next.js)   │
  └─────┬──────┘     └───────┬───────┘     └──────┬──────┘
        │                    │                     │
        └────────────────────┼─────────────────────┘
                             │
                    ┌────────▼────────┐
                    │ Intelligence    │
                    │ Layer (8 subs.) │
                    └────────┬────────┘
                             │
        ┌────────────────────┼─────────────────────┐
        │                    │                     │
  ┌─────▼──────┐     ┌───────▼───────┐     ┌──────▼──────┐
  │ Postgres   │     │ pgvector      │     │ Object      │
  │ (primary)  │     │ (embeddings)  │     │ Storage     │
  └────────────┘     └───────────────┘     └─────────────┘
                                                  │
                    ┌────────────────┐            │
                    │ Background Jobs│◄───────────┘
                    │ (KEA, evolution)│
                    └────────────────┘
```

**Runtime:**
- Webapp + MCP server + API on Vercel/Hetzner (as today)
- Postgres with pgvector extension (can stay on same DB)
- Object storage: S3 or R2 for session archives + markdown skills
- Background jobs: BullMQ on Redis, or Postgres-based (pg-boss) for simplicity

**Scale assumptions:**
- 10K users, 100K sessions/month initially
- pgvector handles 10M+ vectors with HNSW indexing
- Session archives: ~1MB per session compressed → 100GB/month (affordable on R2)

---

## 12. Open Strategic Questions

Before building, these need decisions:

1. **Business model:** Free personal Brain + paid teams? Freemium session limits? Usage-based?
2. **Community moderation:** Fully automated? Hybrid with human moderators? Trusted-user badges?
3. **Data residency:** EU/US regions? Where do embeddings live? GDPR implications?
4. **Pricing for enterprise:** Per-seat? Per-Brain-size? Usage-based extraction?
5. **IP ownership:** Who owns knowledge extracted from a user's session? (Answer: user. But publishing to community requires CC-BY-style license.)
6. **AI provider strategy:** Host own models for KEA? Use OpenAI/Anthropic? Latency + cost tradeoffs.
7. **Protocol versioning:** MCP is evolving. How do we version our API to support changes?
8. **Exit strategy:** If user wants to leave — full export is guaranteed. Competitor migration path?

These aren't engineering questions; they're product/business/legal. But they shape architecture decisions.

---

## 13. Summary

The platform is not "Autobahn with more features." It's a fundamentally different product:

- **Knowledge is the primary artifact** (sessions produce it; all surfaces consume it)
- **MCP is the primary API** (any AI tool can be a client)
- **Multi-tenant by design** (personal / team / community)
- **Eight subsystems in the Intelligence Layer** (Ingestion, Extraction, Storage, Retrieval, Evolution, Oracle, Evaluation, Trust, Audit)
- **Knowledge is versioned, scoped, provenance-tracked, and privacy-respecting**
- **The flywheel is explicit** — with designed quality filters to prevent stalling

The next four documents detail specific subsystems:
- Doc 10: MCP Server + Webapp Design (the Experience Layer)
- Doc 11: Skills Deep Dive (the core value objects)
- Doc 12: Chat with Your Brain / Oracle (the query interface)
- Doc 13: Build Roadmap (sequencing from zero to platform)
