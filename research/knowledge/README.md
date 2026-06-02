# Brain / Knowledge System — Research Index & Implementation Guide
*Updated: 2026-04-20 | Four analytical passes: Sonnet → Opus rewrite → Opus platform synthesis → Opus implementation stubs*

---

## 📖 Overview

This folder contains a comprehensive investigation of the **Brain / Knowledge system** — a persistent, self-improving layer of coding knowledge for AI-assisted development. The research progresses through four analytical passes and produces a complete design for a greenfield platform.

**At a glance:**

| | |
|---|---|
| **Total documents** | 17 (this README + 16 numbered) |
| **Total length** | ~7,900 lines of technical writing |
| **Analysis passes** | 4 (descriptive → diagnostic → platform synthesis → implementation stubs) |
| **Build paths proposed** | 3 (R / A / B) with concrete week-by-week plans |
| **Grounded in** | Real code reads of the existing Autobahn codebase |

**What's in the research — by phase:**

- **Phase A + B: Analysis and Critique** (docs 00-08) — premises, current-state diagnosis, DIKW-T framework, knowledge representations, ontology, evaluation, brainstorm threads
- **Phase C: Greenfield Platform Design** (docs 09-13) — three-layer architecture, MCP server + webapp, skills deep-dive, Oracle chat, build roadmap
- **Phase D: Implementation-Ready Seeds** (docs 14-16) — scope & limits, copy-paste stubs (prompts, schemas, contracts), Path B sufficiency notes

**Three build paths:**

| Path | Scope | Timeline | Team |
|------|-------|----------|------|
| **R — Retrofit** | Fix 3 structural gaps in existing Autobahn | ~3 weeks | 2 engineers |
| **A — New Vibe-Coding App** | Standalone AI coding tool with embedded Brain | ~6 weeks MVP | 2 engineers |
| **B — Brain Platform** | MCP server + Intelligence Layer + Webapp; no vibe-coding inside | ~6 months | 3-4 engineers |

---

## Document Structure — Full Index

### Phase A + B: Analysis and Critique (documents 00-08)

| # | File | What It Establishes |
|---|------|--------------------|
| 00 | [00-premises.md](./00-premises.md) | Six foundational premises that reframe everything. Knowledge is procedural (not factual), extraction is lossy compression, retrieval matters more than storage, knowledge is a graph, user's mental model of AI matters, knowledge needs explicit scope. |
| 01 | [01-current-state.md](./01-current-state.md) | Autobahn is more ambitious than Hermes; pattern-matcher is sophisticated; three structural bottlenecks: no semantic retrieval, keyword-based extraction, no outcome feedback loop. |
| 02 | [02-dikw-t-framework.md](./02-dikw-t-framework.md) | DIKW-T is structurally incomplete. Extended with Retrieval and Representation axes (DIKW-T-R-R). Framework for systematic gap analysis. |
| 03 | [03-knowledge-to-code-quality.md](./03-knowledge-to-code-quality.md) | Doctor/secretary analogy refined. Extraction is one of four bottlenecks. Knowledge Extraction Agent (KEA) + Knowledge Retrieval Agent (KRA) designs. |
| 04 | [04-further-development.md](./04-further-development.md) | Re-prioritized roadmap: Retrieval #1, Extraction #2, Feedback loop #3, Honest dashboard #4, AppSpec integration #5. |
| 05 | [05-brainstorm-session.md](./05-brainstorm-session.md) | Nine deeper threads: lossy compression, knowledge as graph, cache hit/miss framing, user-model-sync, adversarial concerns, bootstrap paradox, negative space, dream state scenarios, when the Brain is harmful. |
| 06 | [06-evaluation-framework.md](./06-evaluation-framework.md) | Session Quality Score (SQS), A/B testing harness, knowledge health metrics, NDCG@5 for retrieval. The measurement infrastructure without which improvement is impossible. |
| 07 | [07-knowledge-representations.md](./07-knowledge-representations.md) | Five representations (text, structured, embeddings, graphs, symbolic). A mature Brain uses all five for different operations. Migration path. |
| 08 | [08-knowledge-ontology.md](./08-knowledge-ontology.md) | The current 12-type taxonomy blurs. Clean 5-category system: Reflex, Recipe, Heuristic, Principle, Anti-principle. Per-category storage/retrieval/injection rules. |

### Phase C: Greenfield Platform Design (documents 09-13)

| # | File | What It Designs |
|---|------|----------------|
| 09 | [09-platform-blueprint.md](./09-platform-blueprint.md) | The three-layer architecture (Data / Intelligence / Experience). Multi-tenancy (personal / team / community). Eight core subsystems. The flywheel and its conditions. **Vibe-coding clients are external, not inside the platform.** |
| 10 | [10-mcp-server-and-webapp.md](./10-mcp-server-and-webapp.md) | MCP server for AI agents (Claude Code, Cursor, Windsurf all become clients). Webapp for humans. SDK for integrators. Seven webapp screens, six core MCP tools. |
| 11 | [11-skills-deep-dive.md](./11-skills-deep-dive.md) | Skills in every dimension: anatomy, lifecycle, composition, versioning, sharing, testing, discovery, security, export formats. Internal wisdom skills and their meta-learning role. |
| 12 | [12-chat-with-brain.md](./12-chat-with-brain.md) | The Oracle — conversational interface to user's own knowledge. Query types, retrieval strategy, UX design, privacy model. Transforms Brain from invisible layer to conversational collaborator. |
| 13 | [13-build-roadmap.md](./13-build-roadmap.md) | Five-phase build plan. MVP as thin slice (6 weeks). Team sizing, critical decisions, risks, go/no-go gates. Phase 2 is Brain-only — no vibe-coding client sub-phase. |

### Phase D: Implementation-Ready Seeds (documents 14-16)

| # | File | What It Provides |
|---|------|------------------|
| 14 | [14-scope-and-limits.md](./14-scope-and-limits.md) | Honest boundary of what's covered. Per-path sufficiency assessment. External sources to consult. Decision framework when stuck. Questions to ask the human upfront. |
| 15 | [15-implementation-stubs.md](./15-implementation-stubs.md) | Copy-paste seeds: complete KEA / KRA / Oracle prompts, 6 MCP tool JSON Schemas, SSE event types, 6 API contracts, Prisma schema extensions, full environment variables, package dependencies, first 10 files to create. |
| 16 | [16-path-b-sufficiency-notes.md](./16-path-b-sufficiency-notes.md) | **Start here if building Path B.** Shared AI+human operating picture: ~85% autonomous sufficiency. Coverage audit tables, typical AI stall points with solutions, joint pre-build checklist, decision framework, list of ~5-7 product decisions the human must make. |

---

## The Three Most Important Takeaways

### 1. Retrieval is THE Bottleneck
The single most impactful change is adding semantic retrieval (pgvector + embeddings). Zero embeddings exist today; all similarity is Jaccard/keyword. This alone would improve knowledge relevance 3-5× without changing anything else.

### 2. MCP-First Changes the Game
When the MCP server becomes the primary knowledge access API, any AI tool (Claude Code, Cursor, Windsurf, custom agents) becomes Brain-aware. The Brain follows users across tools. This is the portability moat.

### 3. Measure the Flywheel or Fail
Without SQS and evaluation infrastructure, every change is a belief. With it, improvements are visible and priorities become evidence-based. Ship evaluation alongside the first Brain features, not after.

---

## Navigation by Purpose

Jump directly to what you need:

| I want to... | Read |
|--------------|------|
| **Start building today (AI agent)** | [AI Agent Quickstart](#-ai-agent-quickstart--if-youre-starting-implementation) below, then applicable Build Guide |
| **Understand what exists today** | 01 (current state), 08 (ontology) |
| **Understand what's broken** | 00 (premises), 01 (diagnostic), 03 (pipeline analysis) |
| **Know what to build next** | 04 (roadmap), 06 (evaluation), 13 (build plan) |
| **See the architectural vision** | 09 (blueprint), 10 (surfaces), 11 (skills) |
| **See the user experience** | 10 (webapp), 11 (skills), 12 (Oracle) |
| **Evaluate whether this is worth building** | 00 (premises), 13 (roadmap + risks + gates) |
| **Get philosophical grounding** | 00 (premises), 02 (framework), 05 (brainstorm) |
| **Be convinced** | 09 (blueprint), 13 (roadmap) |
| **Be skeptical** | 05 (brainstorm on harm), 13 (risks), 06 (evaluation) |
| **Check Path B is buildable** | 16 (sufficiency notes), 14 (scope & limits) |

---

## 💡 For Humans: What to Read First

If you are a human stakeholder (not an AI agent) and want to understand this research body:

1. **The overview above** — the tables give you the shape in 2 minutes
2. **[00-premises.md](./00-premises.md)** (~10 min) — the six foundational premises reframe everything downstream. If you disagree with a premise, you'll disagree with the whole design built on it
3. **[01-current-state.md](./01-current-state.md)** §1-2 (~10 min) — what's there today and what's broken about it
4. **[09-platform-blueprint.md](./09-platform-blueprint.md)** (~15 min) — the greenfield vision
5. **[13-build-roadmap.md](./13-build-roadmap.md)** (~15 min) — how it gets built, over what timeline
6. **[16-path-b-sufficiency-notes.md](./16-path-b-sufficiency-notes.md)** (~10 min) — whether it's actually buildable with AI assistance, and what decisions you'll need to make

Total human read time for informed decision-making: **~60 minutes.**

The implementation-detail documents (03, 10, 11, 12, 15) are primarily for engineers and AI agents — humans can skim them for scope but don't need to read deeply unless making specific architecture calls.

---

## ⚡ AI Agent Quickstart — If You're Starting Implementation

**If you are an AI agent (or developer) tasked with building from this research, read this section first.**

### Step 1: Decide the Build Path

Three **orthogonal** paths. You can pick one, or combine them.

```
  ┌────────────────────────────────────────────────────────────────┐
  │                                                                │
  │   Path R: RETROFIT                                             │
  │   Fix the 3 structural gaps in existing Autobahn.              │
  │   (~3 weeks, 2 engineers)                                      │
  │   Scope: existing app stays; retrieval + KEA + feedback added. │
  │                                                                │
  └────────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────┐
  │                                                                │
  │   Path A: NEW VIBE-CODING APP                                  │
  │   Standalone AI coding tool, similar to Autobahn but new.      │
  │   Has vibe-coding engine + its own small Brain.                │
  │   (~6 weeks MVP, 2 engineers)                                  │
  │   Scope: prompt → code generation → preview + basic Brain.     │
  │                                                                │
  └────────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────┐
  │                                                                │
  │   Path B: BRAIN PLATFORM — NO VIBE-CODING INSIDE               │
  │   MCP server + Intelligence Layer (Brain) + Webapp.            │
  │   Vibe-coding clients are EXTERNAL: Claude Code, Cursor,       │
  │   Autobahn, custom agents — they connect via MCP.              │
  │   (~6 months, 3-4 engineers)                                   │
  │   Scope: no agentic loop, no code-generation UI. The platform  │
  │   processes sessions it receives from external clients.        │
  │                                                                │
  └────────────────────────────────────────────────────────────────┘
```

**Critical clarification:** Path B does **not** include a vibe-coding app. The Brain Platform is a knowledge service. AI coding tools (including Autobahn, Claude Code, Cursor, Windsurf) are external clients that:
1. Call the platform's MCP server to retrieve knowledge before generating code
2. Report session outcomes back for the Brain to learn from
3. Never live inside the platform itself

This is deliberately the MCP-first architecture. The platform's reach is the union of all AI tools that connect to it — it is not itself an AI tool.

**Common combinations:**
- **R alone** — safest, proves value in existing product
- **B alone** — build the Brain as a standalone service; use existing Autobahn (after Path R or unchanged) as the first MCP client
- **A + B** — new vibe-coding tool AND new Brain Platform, A connects to B's MCP server
- **A alone** — new vibe-coding tool with embedded small Brain, no separate platform

**Most likely starting point:** Path R (retrofit) if Autobahn has users today. It validates the flywheel cheapest.

### Step 2: Read Documents in This Order

**For retrofit (Path R):** 01 → 00 → 04 → 06 → done. ~45 minutes reading.

**For new vibe-coding app (Path A):** 00 → 01 → 08 → 09 → 11 → 13 → 15. ~90 minutes reading.

**For Brain Platform, no vibe-coding inside (Path B):** **16 (first)** → 00 → 09 → 13 → 10 → 11 → 12 → 14 → 15 → then 02-08 for context. ~2 hours reading.

**Note for Path B readers:** When docs describe the platform "receiving sessions" or "processing interactions," treat these as events that arrive from external MCP clients, NOT as events the platform itself generates. The platform has no prompt → code generation loop inside it.

### Step 3: Before Writing Any Code

These **four decisions** must be made by a human before implementation begins:

| # | Decision | Default if unspecified |
|---|----------|----------------------|
| 1 | Build path: R, A, or B? | Path R (retrofit) — lowest risk |
| 2 | LLM provider for KEA/Oracle? | Start with OpenAI API (doc 13 §10.1) |
| 3 | Embedding model? | OpenAI `text-embedding-3-small` (doc 13 §10.2) |
| 4 | Paid features model? | Defer — free for all during v1 |

**If the human has not made these decisions, ask. Do not proceed on assumptions.**

### Step 4: Follow the Applicable Build Guide

Jump to one of:
- [**Build Guide — Path R (Retrofit)**](#build-guide--path-r-retrofit-existing-autobahn)
- [**Build Guide — Path A (New Vibe-Coding App)**](#build-guide--path-a-new-vibe-coding-app)
- [**Build Guide — Path B (Full Platform)**](#build-guide--path-b-full-platform)

---

## Build Guide — Path R: Retrofit Existing Autobahn

**Goal:** Fix the three structural gaps identified in doc 01. Keep everything else. ~3 weeks.

### What to Preserve (Code You Will NOT Touch)
- Existing Prisma models (add fields, don't rewrite)
- Existing UI components and dashboard
- Existing auth and routing
- The filesystem plane (`~/.autobahn/USER_VIBE.md`, skills)
- `src/lib/vibe-coding/skill-extractor.ts` — already solid
- `src/lib/vibe-coding/vibe-memory-writer.ts` — already solid
- `src/lib/learning/pattern-matcher.ts` — multi-factor scoring is good

### What to Add

#### Week 1: Semantic Retrieval (Doc 04 Initiative 1)

1. Install pgvector extension in Postgres
   ```bash
   # In Postgres:
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

2. Extend Prisma schema (`prisma/schema.prisma`):
   ```prisma
   model LearningPattern {
     // ... existing fields
     embedding  Unsupported("vector(1536)")?
     scope      String                          @default("user")
     confirmedAt DateTime?
     decayScore Float                           @default(1.0)
   }
   // Same additions for: Skill, TroubleshootingRecord
   ```

3. Create `src/lib/knowledge/embedding-service.ts` — use OpenAI `text-embedding-3-small`

4. Create `src/lib/knowledge/retrieval-agent.ts` — the KRA from doc 03 §4

5. Modify `src/lib/vibe-coding/base-agent.ts` `buildAgentSystemPrompt()`:
   - Replace `loadLearnedPatternsText()` with KRA call
   - Keep fallback to existing logic if KRA fails

6. Backfill script: generate embeddings for existing rows

7. Test: measure retrieval quality via benchmark queries (doc 06 §7)

#### Week 2: Knowledge Extraction Agent (Doc 04 Initiative 2)

1. Create `src/lib/knowledge/extraction-agent.ts` — KEA per doc 03 §3

2. Modify `src/lib/knowledge/services/auto-recorder-service.ts`:
   - Keep old `detectAndRecordPattern` behind feature flag
   - Add `runLLMExtraction` as the new default
   - Feature flag: `KEA_ENABLED=true` in `src/lib/env.ts`

3. Wire into `src/app/api/vibe-coding/route.ts` at line ~1127:
   ```typescript
   // Replace processInteraction() call with runLLMExtraction()
   ```

4. Quality filter (doc 03 §3.4): dedup via embedding similarity, specificity check, confidence floor

5. Test: compare KEA output quality vs. old keyword output on 50 test sessions

#### Week 3: Outcome Feedback Loop (Doc 04 Initiative 3)

1. Extend Prisma schema:
   ```prisma
   model AgentExecution {
     // ... existing
     injectedSkillId          String?
     injectedPatternIds       String[]     @default([])
     injectedTroubleshootingIds String[]   @default([])
   }

   model Skill {
     // ... existing
     failureCount  Int  @default(0)
     successCount  Int  @default(0)
   }
   // Same for LearningPattern
   ```

2. Modify `src/app/api/vibe-coding/route.ts` session completion handler:
   - Track which knowledge was injected
   - On success: increment confidence of injected items
   - On failure/thumbs-down: decrement

3. Add `src/lib/knowledge/services/decay-service.ts` — daily background job

4. Admin dashboard at `/admin/brain-health` — show SQS trend, knowledge health

### Acceptance Criteria (Path R)

- [ ] Retrieval returns semantically-relevant knowledge for prompts with zero keyword overlap
- [ ] KEA produces ≥70% specific/actionable findings (human spot-check 50)
- [ ] Knowledge confidence updates after session outcomes
- [ ] SQS trends visible in admin dashboard
- [ ] Zero regression in existing vibe-coding functionality
- [ ] Rollback paths tested: all new features have feature flags

### Files You Will Create (Path R)
```
src/lib/knowledge/embedding-service.ts
src/lib/knowledge/retrieval-agent.ts       // the KRA
src/lib/knowledge/extraction-agent.ts      // the KEA
src/lib/knowledge/services/decay-service.ts
src/lib/knowledge/__tests__/retrieval-agent.test.ts
src/lib/knowledge/__tests__/extraction-agent.test.ts
src/app/api/admin/brain-health/route.ts
src/app/admin/brain-health/page.tsx
scripts/backfill-embeddings.ts
```

### Files You Will Modify (Path R)
```
prisma/schema.prisma                                 // add embedding, scope, decayScore fields
src/lib/env.ts                                       // add KEA_ENABLED, OPENAI_API_KEY
src/lib/vibe-coding/base-agent.ts                    // buildAgentSystemPrompt() uses KRA
src/app/api/vibe-coding/route.ts                     // wire KEA + outcome tracking
src/lib/knowledge/services/auto-recorder-service.ts  // feature-flag old path
```

---

## Build Guide — Path A: New Vibe-Coding App

**Goal:** Greenfield vibe-coding app with Brain built-in from day 1. ~6 weeks MVP.

### Architecture Decision

This is **Path B scoped down to a single-surface MVP.** You are building:
- A vibe-coding client
- That reports to a Brain (which you also build)
- With minimal webapp UI

You are **NOT** building teams, community, Oracle, or MCP server yet. Those come in Path B.

### Reference Existing Code

Even though this is "new," you can borrow heavily from current Autobahn:
- `src/lib/vibe-coding/glm-agent.ts` — the agentic loop (2,620 LOC, battle-tested)
- `src/lib/vibe-coding/base-agent.ts` — provider abstraction + prompt enrichment
- `src/lib/vibe-coding/spec-deriver.ts` — AppSpec derivation (critical for quality)
- `src/lib/vibe-coding/tools/` — file/bash tools with safety guards
- `src/lib/vibe-coding/post-build-service.ts` — build + preview pipeline
- `src/lib/vibe-coding/session-compactor.ts` — context window management
- `src/lib/vibe-coding/recovery-recipes.ts` — structured error recovery
- `src/lib/vibe-coding/provider-health.ts` — LLM provider fallback

**Estimate:** 60-70% of current Autobahn vibe-coding is directly reusable for Path A.

### Week-by-Week

**Week 1: Infrastructure**
- Monorepo (Turborepo)
- Postgres + pgvector
- Auth (NextAuth v5)
- Basic Next.js app with session creation UI

**Week 2: Vibe-Coding Engine**
- Port `glm-agent.ts`, `base-agent.ts`, `tools/*`, `post-build-service.ts` from Autobahn
- Integrate with the new auth + session model
- Ship a working "enter prompt → generate code → preview" flow

**Week 3: Core Brain (KEA + KRA)**
- Prisma schema: Knowledge, SessionEvent, Feedback (from doc 09 §6)
- KEA: extraction agent per doc 03 §3
- KRA: retrieval agent per doc 03 §4
- Wire KRA into agent system prompt at session start
- Wire KEA into session completion handler

**Week 4: Outcome Feedback Loop**
- Track knowledge applications per session
- Update confidence based on outcomes
- Session Quality Score per doc 06

**Week 5: Dashboard**
- "Your Brain Right Now" with real data (no mocks)
- Knowledge list
- Session history
- What-Brain-believes panel (doc 10 §3.1)

**Week 6: Polish + Acceptance**
- Teach-the-Brain form
- Knowledge edit/delete
- Export skills as markdown
- Benchmark: 50 real sessions, verify SQS trends up

### Acceptance Criteria (Path A)

- [ ] User can register, create a session, type a prompt, receive generated code
- [ ] Brain extracts at least one knowledge item from most sessions
- [ ] Subsequent sessions show measurably better SQS (after 10+ sessions)
- [ ] Dashboard shows only real data — no mocked timelines or file browsers
- [ ] User can view, edit, delete any knowledge item
- [ ] Export skills as markdown works

### Files You Will Create (Path A — Minimal)
```
# Root structure
/apps/web                    # Next.js app
/apps/worker                 # Background jobs (KEA runs here)
/packages/core              # Intelligence Layer (KEA, KRA, evolution)
/packages/types             # Shared types
/packages/db                # Prisma schema + client
/packages/agent             # Ported from Autobahn's vibe-coding

# Apps/web
src/app/api/session/*
src/app/api/knowledge/*
src/app/dashboard/page.tsx
src/app/dashboard/knowledge/page.tsx

# Packages/core
src/knowledge/extraction-agent.ts
src/knowledge/retrieval-agent.ts
src/knowledge/embedding-service.ts
src/knowledge/feedback-service.ts
src/knowledge/decay-service.ts
src/evaluation/sqs-calculator.ts

# Packages/agent (ported from Autobahn)
src/base-agent.ts
src/glm-agent.ts
src/spec-deriver.ts
src/tools/*
src/post-build-service.ts
```

---

## Build Guide — Path B: Brain Platform (No Vibe-Coding Inside)

> ⭐ **Before reading this Build Guide in depth, read [16-path-b-sufficiency-notes.md](./16-path-b-sufficiency-notes.md)** — it gives both AI agent and human a shared operating picture, coverage audit, joint pre-build checklist, and decision framework. ~85% autonomous build coverage; ~5-7 product decisions needed from human upfront.

**Goal:** Build a platform that *serves* AI coding tools — it doesn't replace them. Users keep using Claude Code / Cursor / Autobahn / custom agents; the platform gives those tools persistent, queryable knowledge via MCP.

**Scope (what's INSIDE the platform):**
- MCP server (for AI clients to query/report)
- Intelligence Layer: KEA, KRA, evolution, Oracle
- Webapp (dashboard, skills browser, Oracle chat, settings)
- Multi-tenancy (personal / team / community)

**Scope (what's OUTSIDE the platform):**
- No vibe-coding / prompt → code generation loop
- No in-platform code editor
- No container isolation / preview servers for generated code
- No SSE streaming of AI output (that's the client's concern)
- No agentic loop / tool parsing / file writing

The platform never generates code. It processes session events reported by external clients.

**Timeline:** ~6 months with 3-4 engineers (no vibe-coding engine = 2 months saved vs. the earlier "full platform" estimate).

### Sequence

```
Phase 0: Foundation            4 weeks
Phase 1: Core Brain            8 weeks   (same as Path R/A Brain work)
Phase 2: MCP Server + Webapp   6 weeks   (cleaner — no vibe-coding client)
Phase 3: Teams + Community    10 weeks
Phase 4: Advanced             ongoing
```

### Critical Platform Decisions

Before starting Phase 0, confirm:

1. **Monorepo layout** (note: no `/packages/agent` — the platform has no agent)
   ```
   /apps
     /web          (Next.js webapp)
     /mcp-server   (TypeScript MCP server, stdio + HTTP)
     /worker       (background jobs: KEA, decay, evolution)
   /packages
     /core         (Intelligence Layer: KEA, KRA, evolution, oracle)
     /types        (shared TypeScript types)
     /db           (Prisma schema + client)
     /mcp-tools    (shared MCP tool definitions — used by mcp-server AND webapp)
     /sdk-js       (customer SDK for integrators)
   ```

2. **MCP server is the primary API**
   - External clients (Claude Code, Cursor, Autobahn, custom) connect here
   - All knowledge operations happen through MCP tools
   - Webapp internally calls the same tool handlers (no duplicate logic)
   - See doc 10 §2.3 for the tool list

3. **Data layer is Postgres + pgvector + object storage**
   - Single Postgres for structured data + embeddings
   - Object storage (S3/R2) for session archives and skill markdown
   - Background jobs via pg-boss (no Redis required)

4. **Authentication**
   - Email + OAuth for humans (NextAuth v5)
   - Token-based for MCP clients (external AI tools)
   - Team tokens scope to team knowledge

5. **What the platform does NOT implement**
   - No `glm-agent.ts` equivalent — clients handle their own AI calls
   - No `post-build-service.ts` equivalent — clients handle their own build/preview
   - No tool-call parsing for file operations — clients do that themselves
   - No container isolation — clients run code in their own sandboxes

### Phase 0 — Foundation (Weeks 1-4)

Follow doc 13 §4. Acceptance: a developer can `npm run dev` and insert a Knowledge row with an embedding, then retrieve it via pgvector similarity.

### Phase 1 — Core Brain (Weeks 5-12)

Follow doc 13 §5. Build: KEA, KRA, outcome feedback, SQS.

Key difference from earlier description: in this phase, you simulate sessions via **direct API/test calls** (not by running a vibe-coding engine). The test harness inserts fake SessionEvent data and verifies extraction/retrieval behavior.

Acceptance (**Gate 1**): simulate 100 sessions with varying outcomes via test harness; SQS trends visible; high-quality knowledge retrievable for similar queries.

**If SQS doesn't trend up, STOP and investigate. Do not proceed to Phase 2.**

### Phase 2 — MCP Server + Webapp (Weeks 13-18)

**Goal:** External AI tools can connect and send real sessions to the platform.

Week 13-14: MCP server
- Implement 6-8 core tools from doc 10 §2.3: `brain_retrieve_knowledge`, `brain_report_session_outcome`, `brain_teach_knowledge`, `brain_get_user_style`, `brain_find_skill`, `brain_ask_oracle`, `brain_start_session`, `brain_log_event`
- Token-based auth
- Resources: `brain://user/style-profile`, `brain://user/active-skills`
- Docs: "How to configure Claude Code / Cursor / your custom agent with this MCP server"

Week 15-16: Webapp
- Dashboard (Your Brain / Recent Sessions / What I Believe)
- Knowledge browser (real data, no mocks)
- Settings (MCP tokens, account, privacy)

Week 17: Skills browser + Oracle
- Skills list with filters, edit, export (Claude Code, Cursor, .windsurfrules formats)
- Oracle chat with citations

Week 18: Integration testing with real client
- Configure Claude Code (or Autobahn, or Cursor) with the MCP server
- Run real coding sessions, verify knowledge flows in, retrievability works
- No vibe-coding engine needed on platform side — the client does all generation

Acceptance: external beta user plugs our MCP server into their AI tool of choice, does 5 coding sessions, sees their Brain populate, uses Oracle to query. **The user did NOT use our platform's UI to code — they used their own client.**

### Phase 3 — Teams + Community (Weeks 19-28)

Follow doc 13 §7. Acceptance (**Gate 3**): 30%+ of active users import at least one community skill; moderation pipeline working.

### Phase 4 — Advanced (Weeks 29+)

Prioritize by user signal:
- Knowledge graph + transitive retrieval
- Internal wisdom skills (meta-learning)
- Skill composition and testing
- Proactive Oracle
- Additional MCP tools as integrators request them

### What Path B Produces — Concretely

At the end of Phase 2:
- A running MCP server at `mcp.brain.example`
- A webapp at `brain.example`
- Documentation pages: "Connect Claude Code", "Connect Cursor", "Connect Autobahn", "Build Your Own Client"
- Beta users running their usual AI tools, now with Brain connected
- Knowledge accumulating in user Brains from external sessions
- Dashboard and Oracle usable for querying accumulated knowledge

At no point does the platform itself generate code, parse tool calls, or run a vibe-coding loop. Those are client responsibilities.

---

## Required Pre-Implementation Decisions (All Paths)

These decisions shape architecture. Make them explicitly, don't default silently.

### Technical Decisions

| Decision | Options | Recommendation | Source |
|----------|---------|----------------|--------|
| Embedding model | OpenAI / Cohere / self-hosted BGE | OpenAI `text-embedding-3-small` | doc 13 §10.2 |
| KEA model | Cheap (Qwen/GLM-Air) / Premium (Claude) | Qwen3-Coder free tier | doc 03 §3 |
| Oracle model | Premium required for quality | Claude Sonnet 4.6 | doc 12 §7 |
| Vector DB | pgvector / Pinecone / Weaviate | pgvector (no new infra) | doc 04 §2 |
| Background jobs | BullMQ+Redis / pg-boss / Inngest | pg-boss (no Redis) | doc 13 §4 |
| Monorepo tool | Turborepo / Nx / pnpm workspaces | Turborepo | doc 13 §10.4 |

### Product/Business Decisions (block implementation if unspecified)

| Decision | Why it matters for engineers |
|----------|----------------------------|
| Free vs. paid tiers | Affects rate limiting, feature gating |
| Data retention policy | Affects archival vs. deletion semantics |
| Open-source scope | Affects licensing of MCP server package |
| GDPR strategy | Affects data model (deletion cascades, export format) |
| Community moderation level | Affects whether to build moderation UI in Phase 3 |

**If these haven't been decided:** ask. Don't guess.

---

## Existing Code Reference Map

For any path, know what's already in the codebase:

### High-Value, Reuse As-Is
| Code | Location | Status |
|------|----------|--------|
| GLM agentic loop | `src/lib/vibe-coding/glm-agent.ts` | 2,620 LOC, production-tested |
| Agent base class | `src/lib/vibe-coding/base-agent.ts` | Dual-provider abstraction |
| Tool implementations | `src/lib/vibe-coding/tools/` | With safety guards |
| Spec deriver | `src/lib/vibe-coding/spec-deriver.ts` | Critical for first-turn quality |
| Skill extraction | `src/lib/vibe-coding/skill-extractor.ts` | Hermes-inspired, works |
| Pattern matcher | `src/lib/learning/pattern-matcher.ts` | Multi-factor scoring |
| Session compactor | `src/lib/vibe-coding/session-compactor.ts` | Context window mgmt |
| Policy engine | `src/lib/vibe-coding/policy-engine.ts` | Rules-based constraints |
| Provider health | `src/lib/vibe-coding/provider-health.ts` | LLM fallback tracking |
| Container isolation | `src/lib/containers/` | Sandbox execution |

### High-Value, Needs Enhancement
| Code | What to add |
|------|-------------|
| `src/lib/knowledge/services/auto-recorder-service.ts` | Replace keyword matching with KEA |
| `src/lib/vibe-coding/prompt-context-loader.ts` | Replace with KRA semantic retrieval |
| `prisma/schema.prisma` | Add `embedding`, `scope`, `decayScore` to knowledge tables |
| `src/app/api/vibe-coding/route.ts` | Wire outcome feedback loop |

### Medium-Value, Leverage for Pattern
| Code | What to learn from |
|------|-------------------|
| `src/lib/env.ts` | Environment validation pattern |
| `src/lib/logger.ts` | Structured logging pattern |
| `src/middleware.ts` | Subdomain routing pattern |
| `src/lib/stores/*.ts` | Zustand store patterns |
| `src/lib/auth/auth-config.ts` | NextAuth v5 setup |

### Low-Value for Greenfield, Still Informative
| Code | Note |
|------|------|
| `src/app/dashboard/knowledge/page.tsx` | Has mocks — read to understand, don't port |
| `src/components/dashboard/knowledge-browser.tsx` | Hardcoded tree — needs real data source |
| Phase 13 admin/monitoring code | Already removed (Apr 12, 2026) — reference history in CLAUDE.md |

### AVOID — Deprecated / Removed
- Gemini agent references (removed Apr 16, 2026 — don't re-add)
- Phase 13 container manager (replaced by sandbox ContainerProxy)
- Direct `process.env` access (use `src/lib/env.ts`)
- Blog functionality (migrated to separate autobahn-homepage repo)

---

## Environment Setup Hints

### Required Environment Variables (all paths)

```bash
# Database
DATABASE_URL="postgresql://user:pass@host:5432/dbname"

# LLM providers
GLM_API_KEY="..."                    # Primary for vibe-coding
DASHSCOPE_API_KEY="..."              # Fallback for Qwen / Claude proxy

# For retrieval + KEA (Path R/A/B — all need this)
OPENAI_API_KEY="..."                 # For embeddings
# OR
ANTHROPIC_API_KEY="..."              # If using Claude for Oracle

# Feature flags (Path R specifically)
KEA_ENABLED="true"                   # Enable LLM-based extraction
SEMANTIC_RETRIEVAL_ENABLED="true"    # Enable KRA
OUTCOME_FEEDBACK_ENABLED="true"      # Enable confidence updates

# For Path B — platform
MCP_SERVER_PORT="3100"               # MCP HTTP transport
STORAGE_S3_BUCKET="brain-sessions"
STORAGE_S3_REGION="..."
```

### Database Setup

```bash
# Install pgvector extension (required for retrieval)
psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Apply migrations
npx prisma migrate deploy

# Generate client
npx prisma generate
```

### Running (Existing Autobahn)

```bash
npm install
npm run build   # Required before dev — compiles Socket.io server
npm run dev     # Starts custom server.js
```

### Running (Greenfield Path B)

```bash
# Monorepo with Turborepo
pnpm install
pnpm turbo run build
pnpm turbo run dev  # Runs webapp + mcp-server + worker in parallel
```

---

## Verification Checkpoints

How an AI agent knows it's on track:

### After 1 Day of Work (Any Path)
- Can read and articulate the three structural bottlenecks (doc 01 §2)
- Has chosen a path (R/A/B) with explicit reasoning
- Has the four pre-implementation decisions confirmed

### After 1 Week (Path R)
- pgvector installed, embeddings being generated for new knowledge
- KRA returns semantically-relevant results for test queries
- Retrieval benchmark: NDCG@5 > 0.5 on 20 hand-labeled queries

### After 3 Weeks (Path R complete)
- All three gaps closed
- SQS metric tracking per session
- Admin dashboard shows real data
- Rollback tested: can disable any new feature via env flag

### After 6 Weeks (Path A MVP)
- New app accepts prompt, generates code, stores knowledge
- Brain dashboard shows real user data
- Can run 50 sessions and see SQS trend

### After 20 Weeks (Path B MVP complete)
- MCP server deployed
- Claude Code user can install and use the Brain
- Oracle answers questions with citations
- Beta with 20-50 users

### Red Flags (Stop and Diagnose)
- SQS doesn't trend up after 4 weeks of real usage (doc 13 Gate 1)
- KEA produces >30% noise rate on spot-check (doc 06 §6)
- Retrieval NDCG@5 < 0.4 after embeddings added (doc 06 §7)
- New feature breaks existing vibe-coding (zero-regression rule)

---

## Testing Strategy (Any Path)

```typescript
// Unit tests for every new module
src/lib/knowledge/extraction-agent.test.ts
src/lib/knowledge/retrieval-agent.test.ts
src/lib/knowledge/embedding-service.test.ts

// Integration tests for pipelines
src/__tests__/integration/session-to-knowledge.test.ts
src/__tests__/integration/outcome-feedback-loop.test.ts

// Benchmark fixtures — known queries, expected retrievals
src/__tests__/benchmarks/retrieval-ndcg.test.ts
src/__tests__/benchmarks/kea-quality.test.ts
```

For Path B (MCP server):
```typescript
// MCP tool tests — each tool has at least one happy-path + error test
src/mcp-server/__tests__/brain-retrieve-knowledge.test.ts
src/mcp-server/__tests__/brain-report-outcome.test.ts
```

---

## Handoff Checklist for AI Agents Starting Implementation

If you are an AI agent picking this up to start building, confirm all boxes before writing code:

- [ ] I have read [00-premises.md](./00-premises.md) fully
- [ ] I have read [01-current-state.md](./01-current-state.md) §1-§7 (architecture + bottlenecks)
- [ ] I understand the three structural bottlenecks (retrieval, extraction, feedback)
- [ ] I know which build path (R / A / B) the human has chosen
- [ ] I have the four pre-implementation decisions from the human (build path, LLM provider, embedding model, pricing)
- [ ] I have confirmed environment access: database URL, API keys for chosen LLM provider
- [ ] I have read the corresponding Build Guide (R, A, or B) in this README
- [ ] I know which verification checkpoint I'm aiming for first
- [ ] If unclear about requirements, I will ask the human BEFORE writing code, not assume

**If any box is unchecked, stop. Read the missing piece. Ask if needed. Only proceed when every box is checked.**

---

## What's Next

This research body is the *input* to implementation. Specific next steps:

1. **Scope decision:** Path R (retrofit, 3 weeks), Path A (new app, 6 weeks), or Path B (platform, 8 months)?
2. **Team decision:** Who builds this, at what capacity?
3. **Business model decision:** Free personal / paid teams, or different model?
4. **MVP scoping:** For whichever path, confirm acceptance criteria match the human's expectations

Each of these is a strategic decision that should be made before implementation begins. The research informs but does not replace those decisions.

---

## Philosophy of This Research

A deliberate design choice: **progress from descriptive to diagnostic to prescriptive, rather than jumping straight to solutions.** This structure:

- Makes premises explicit before proposing designs
- Grounds every proposal in verified observations of the current code
- Distinguishes critique from synthesis
- Enables readers to disagree with specific layers while accepting others

The prescriptive documents (09-13) are the most confident assertions in this body, but they're built on an analytical foundation (00-08) that should be attacked first if anything feels off.

The implementation hints above (Build Guides R, A, B) are the most action-oriented content. They translate the analytical body into concrete file paths, code patches, and acceptance criteria so an AI agent can begin work without re-deriving everything.
