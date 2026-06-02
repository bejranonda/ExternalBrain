# Scope and Limits — What the Research Covers, What It Doesn't
*Added 2026-04-20 | Honest bounds for AI agents starting implementation*

---

## 1. Why This Document Exists

An AI agent given the task "build this" from the research folder needs to know explicitly what the research specifies vs. what it delegates.

Without this boundary statement, an AI will either:
- **Under-deliver** — assume the research is comprehensive, stall on gaps
- **Over-invent** — fill gaps with low-quality assumptions that drift from intent
- **Over-ask** — interrupt the human for every missing spec

The right behavior is:
- **Use research for architecture + decisions + priorities**
- **Use external canonical sources for standard library APIs**
- **Use [15-implementation-stubs.md](./15-implementation-stubs.md) for the critical seeds**
- **Ask the human for genuinely new product decisions**

---

## 2. In Scope — What the Research Specifies

### Architecture (strongly specified)
- Three-layer model (Data / Intelligence / Experience)
- Eight core subsystems and their responsibilities
- Multi-tenancy model (personal / team / community)
- MCP-first principle
- Knowledge as immutable + versioned
- Fail-soft behavior requirements
- Provenance mandatory

### Design decisions (strongly specified)
- Five-category knowledge ontology (Reflex / Recipe / Heuristic / Principle / Anti-principle)
- Scope field semantics (global / user / project / session / community)
- Five representations (text / structured / embeddings / graph / symbolic)
- Retrieval-first prioritization
- Noise filter requirement at extraction boundary

### Build guidance (moderately specified)
- Three paths (R / A / B) with different scopes and risks
- Week-by-week phasing for each path
- File paths to create and modify
- Feature flags for rollback
- Verification checkpoints and red flags
- Existing-code reuse map

### Evaluation (strongly specified)
- Session Quality Score formula
- A/B testing harness design
- Go/no-go gates (especially Gate 1 after Phase 1)

---

## 3. Out of Scope — What to Get From Elsewhere

### Standard library APIs (get from official docs)
- Next.js App Router patterns → nextjs.org/docs
- NextAuth v5 configuration → authjs.dev
- Prisma schema + migrations → prisma.io/docs
- pgvector usage → github.com/pgvector/pgvector
- OpenAI embedding API → platform.openai.com/docs
- MCP protocol details → modelcontextprotocol.io
- Tailwind + shadcn components → ui.shadcn.com
- Turborepo setup → turborepo.com

**Rule:** If a question is answerable by "what does the library do?" — use the library's official docs. Don't ask the human, don't invent.

### Agentic loop implementation (get from existing Autobahn)
The 2,620-line `src/lib/vibe-coding/glm-agent.ts` is the canonical reference for:
- Streaming with SSE
- Tool-call parsing (including hallucinated / malformed cases)
- Recovery loops
- Intent-to-act detection
- Garbage content filtering
- Phase emission
- Session compaction
- Provider fallback

For Path A/B: either port this code (60-70% reusable), or study it as a reference implementation.

### UI component specifics (get from adjacent patterns)
- Autobahn's existing dashboard, sidebar, prompt input, chat bubble are production-tested
- Use them as templates for equivalent greenfield components
- Design tokens in `src/lib/design-system/` are reusable

### Business logic the research doesn't resolve
- Pricing model details
- Moderation policies for community
- Legal T&Cs for publishing
- SOC 2 / GDPR implementation specifics (Autobahn has existing legal docs)

**Rule:** If a question is a business/product decision — ask the human.

---

## 4. Per-Path Readiness Assessment

### Path R — Retrofit (existing Autobahn)
**Research sufficiency: 90%.**

The Build Guide in the README is nearly complete. The existing codebase fills all remaining gaps. An AI agent can execute this path almost autonomously.

**Remaining 10%:** specific environment credentials (OpenAI API key), human approval at gate checkpoints, decisions about feature-flag default state.

### Path A — New Vibe-Coding App
**Research sufficiency: 60%.**

The architecture is clear, but building vibe-coding from scratch requires the agentic loop implementation. Without it, the AI must either:
- Port from Autobahn's `glm-agent.ts` (recommended — most value)
- Read [15-implementation-stubs.md](./15-implementation-stubs.md) for seed prompts + event schema, then flesh out the full loop

**Remaining 40%:** agentic loop implementation, UI component implementation, deployment config, library version pinning.

### Path B — Brain Platform (No Vibe-Coding Inside)
**Research sufficiency: 85%.** (Updated after doc 15 implementation stubs added and Path B scope explicitly clarified.)

📘 **See [16-path-b-sufficiency-notes.md](./16-path-b-sufficiency-notes.md) for the detailed Path B assessment** — coverage audit tables, typical AI stall points, joint pre-build checklist, and the explicit list of ~5-7 product decisions the human must make.

Because Path B has **no vibe-coding engine inside the platform**, it does NOT need:
- An agentic loop
- Tool-call parsing
- SSE streaming of AI output
- Container isolation / preview infrastructure
- Code-editing UI

What it DOES need, and what the research covers:
- MCP server with tool schemas (doc 10 §2.3 lists them; stub 15 provides JSON Schemas)
- Intelligence Layer (KEA, KRA, Oracle) — doc 03 and stubs
- Multi-tenant data model — doc 09 §6
- Dashboard + skills browser + Oracle UI — doc 10 §3
- Team + community governance — doc 09 §4 and doc 13 §7

**Remaining 20%:** MCP protocol implementation details (get from official MCP SDK docs), NextAuth v5 specifics, Prisma migration specifics, specific UI copy and microcopy.

**Key insight:** Path B is *easier* than Path A for an AI agent building from scratch, because no agentic loop code is needed. The platform's job is to be a knowledge backend that serves any AI tool — the AI tool itself remains external.

---

## 5. Decision Framework When Stuck

When the AI agent hits a gap:

```
Is the question...
    │
    ├── "What does library X do?" → Check library docs; do not ask human
    │
    ├── "What's a standard pattern for X?" → Check library docs or well-known patterns; do not ask human
    │
    ├── "What prompt should I use for X?" → Check 15-implementation-stubs.md; if not there, propose a stub and ask
    │
    ├── "Which option should I pick for an architectural choice?" → Check the research docs; if genuinely unspecified, ask human
    │
    ├── "What's the product requirement for X?" → Ask human
    │
    ├── "What's the business/legal requirement?" → Ask human
    │
    └── "What should I name / style / color / arrange?" → Propose reasonable default, document, proceed
```

**Never:**
- Invent product requirements
- Invent pricing or legal policies
- Invent critical algorithm parameters without testing

**Always OK:**
- Use sensible defaults for naming, styling, file organization
- Extrapolate patterns from existing Autobahn code
- Reference official library documentation

---

## 6. Critical Questions to Ask the Human Upfront

Before writing code, confirm these with the human:

### Tier 1 — Must confirm
1. Build path (R / A / B)
2. LLM provider for KEA (OpenAI / Anthropic / hosted / self-hosted)
3. Embedding model choice
4. Target timeline for MVP
5. Existing Autobahn codebase: leverage or ignore?

### Tier 2 — Should confirm before major work
6. Target first user segment (individual dev / team / enterprise?)
7. Pricing strategy (free / freemium / paid)
8. Data residency requirements (EU / US / both)
9. Open-source vs. closed-source scope

### Tier 3 — Can surface decisions during work
10. Specific UI copy and microcopy
11. Specific moderation thresholds
12. Specific decay constants

Tier 1 must be locked before any code. Tier 2 should be locked before Phase 2. Tier 3 can surface as decisions arise.

---

## 7. Scope of the Stubs Document

[15-implementation-stubs.md](./15-implementation-stubs.md) provides:

- Complete KEA system prompt (copy-pasteable)
- Complete KRA ranking formula (with constants)
- Complete Oracle system prompt
- MCP tool JSON Schemas for 6 core tools
- SSE event TypeScript types for vibe-coding
- Request/response shapes for 6 must-have API endpoints
- Prisma schema extensions ready to paste
- Complete environment variables list

Stubs cover the highest-leverage gaps. Everything else is either in the research prose or the external references.

---

## 8. What "Done" Looks Like For An AI Agent

An AI agent successfully using this research body produces:

- Code that compiles and runs
- Migrations that apply cleanly
- Tests that pass for the happy path
- A reproducible setup (env vars, dependencies documented)
- Acceptance criteria from the relevant Build Guide met
- No surprises for the human at review time (everything ambiguous was asked, not invented)

If the AI cannot achieve this, the most likely causes (in order of probability):
1. Skipped the AI Agent Quickstart in README (didn't read in order)
2. Tried to invent what should have been asked
3. Stalled instead of using [15-implementation-stubs.md](./15-implementation-stubs.md)
4. Attempted Path A/B without porting existing Autobahn code
5. Didn't ask for Tier 1 decisions upfront

---

## 9. Honest Assessment Summary

- **The research is architectural + diagnostic + prescriptive** — strong at "what" and "why"
- **The research is NOT implementation-complete** — weaker at "exactly how"
- **Stubs close the critical gaps** for prompts, schemas, contracts, formulas
- **External library docs** cover the rest
- **Existing Autobahn code** is the essential reference for agentic loop, UI patterns, deployment

For **Path R (retrofit)**: the research + existing code is enough (~90%).  
For **Path A (new vibe-coding app)**: the research + stubs + Autobahn reference (for agentic loop) is enough (~85%).  
For **Path B (Brain Platform, no vibe-coding)**: the research + stubs + official MCP/Prisma/NextAuth docs is enough (~85%). No Autobahn reference needed for the platform itself — but integration-testing with Autobahn as a client validates end-to-end flow.

**Surprise finding:** Path B is *not* harder than Path A despite being called "full platform." The Brain-only scope actually removes the most code-heavy component (agentic loop). The platform codebase stays small and focused.

**There is no path where the research folder alone — with nothing external — is sufficient. That's not a flaw; that's intentional scoping. Research specifies. Implementation executes.**
