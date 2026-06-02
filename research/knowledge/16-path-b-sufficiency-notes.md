# Path B Sufficiency Notes — Brain Platform (No Vibe-Coding Inside)
*Integrated sample guidance note for AI agents and humans starting Path B*

---

## Why This Document Exists

An AI agent or human engineer starting Path B (the Brain Platform, with no vibe-coding engine inside) needs to know two things immediately:

1. **Is the research in this folder enough to build from?** Short answer: **yes, ~85% autonomously.**
2. **Where are the 15% gaps, and who closes them?** Short answer: library docs close ~10%, human decisions close ~5%.

This note gives both the AI and the human a **shared operating picture** so neither stalls unnecessarily and neither invents when they should ask.

---

## Headline Assessment

| Dimension | Value |
|-----------|-------|
| **Autonomous build coverage** | ~85% |
| **External library docs needed** | ~10% |
| **Human decisions needed** | ~5% |
| **Minimum time to validate foundation** | 4 weeks (Phase 0 + start of Phase 1) |
| **Minimum time to first running MCP server + webapp** | ~20 weeks |
| **Recommended team size** | 3-4 engineers |

The Brain Platform scope is deliberately narrow: MCP server + Intelligence Layer + webapp. No code generation, no agentic loop, no container isolation. This narrowness is what makes the research sufficient — the hardest-to-specify piece (the agentic loop) is explicitly outside the scope.

---

## For AI Agents Starting Path B

### Your Reading Order (exactly this sequence, ~2 hours)

```
1. README.md                 — AI Agent Quickstart + Build Guide Path B
2. 00-premises.md            — Foundational premises (6 of them)
3. 09-platform-blueprint.md  — Architecture + multi-tenancy
4. 13-build-roadmap.md       — Phase-by-phase plan (Path B sections)
5. 10-mcp-server-and-webapp.md — Experience Layer design
6. 11-skills-deep-dive.md    — Core value objects
7. 12-chat-with-brain.md     — Oracle design
8. 14-scope-and-limits.md    — What's in, what's out
9. 15-implementation-stubs.md — Copy-paste starting points
10. This document (16)       — Sufficiency expectations + checklist
```

Only read 01-08 if you need background on the ancestry (the original Autobahn Brain). For Path B specifically, they are optional context.

### Before You Write Any Code

Confirm these with the human first. If any is unconfirmed, ask — do not assume:

- [ ] Build path is explicitly Path B (Brain only, no vibe-coding)
- [ ] LLM provider chosen for KEA (Qwen / GLM / Claude Haiku)
- [ ] Embedding model confirmed (OpenAI text-embedding-3-small is the default)
- [ ] Target MVP delivery date understood
- [ ] Pricing/tier model confirmed (or deferred with explicit "defer to later")
- [ ] Data residency requirements known (EU/US/both/none)

### Your Default Behavior

| Situation | Action |
|-----------|--------|
| You need a prompt template | Check doc 15 §2, §3, §4. Copy and adapt. |
| You need a schema | Check doc 15 §5, §7, §8. Paste. |
| You need an algorithm constant (threshold, weight) | Check doc 15. Use the stated default. |
| You need a library's API | Consult official docs. Don't ask the human. |
| You need a product/policy decision | Ask the human. Don't invent. |
| You need UI copy | Propose a reasonable default, document, proceed. Human can revise later. |
| You need a naming/organization choice | Choose and document. Consistency > perfection. |

### Three Things You Must Not Do

1. **Do not invent a vibe-coding engine.** The platform does not include one. If you catch yourself writing an agentic loop, tool-call parser, or SSE streamer for AI output — stop. That belongs in a client, not the platform.

2. **Do not invent product decisions.** Pricing, moderation thresholds, team ACL details, community rules — these require human judgment. Ask.

3. **Do not skip the evaluation infrastructure.** Session Quality Score (doc 06) must be in place before Phase 2. Without it, no one can tell if the platform is working. This is non-negotiable.

---

## For Humans Overseeing the Path B Build

### Decisions You Will Be Asked For

**Week 1 (must decide before coding starts):**
1. LLM provider for KEA
2. Embedding model
3. Pricing tier structure (even "free for all beta" counts as a decision)
4. Data residency / geographic hosting

**Week 1-2 (should decide early):**
5. Who are the first beta users?
6. Which external clients to prioritize (Claude Code? Cursor? Autobahn?)
7. Open-source scope — which packages, if any, are open source?

**Month 2-3 (decide before Phase 3):**
8. Team ACL model — what roles exist, what can each do?
9. Community moderation policy — automated thresholds, human review triggers?
10. Publishing license for community skills (CC-BY recommended)

**Ongoing (surface as they come up):**
11. Specific UI copy and microcopy refinement
12. Brand identity decisions (colors, fonts, tone)
13. Specific rate limits per tier

### Your Review Points (Phase Gates)

At each phase boundary, review with the AI agent's output in hand:

| Gate | When | What to verify |
|------|------|----------------|
| **End of Phase 0** | Week 4 | Monorepo runs locally, DB schema applies cleanly, pgvector operational |
| **End of Phase 1** | Week 12 | SQS computed for test sessions, retrieval benchmark passes (NDCG@5 > 0.5), KEA produces ≥70% specific findings on spot-check |
| **End of Phase 2** | Week 20 | External AI tool (Claude Code or similar) connects via MCP and successfully populates a Brain through real sessions |
| **End of Phase 3** | Week 30 | Teams feature works for ≥3 real teams; community has ≥100 published skills; moderation pipeline is responsive |

**Red flag gate:** If at end of Phase 1 the SQS does not trend upward across test sessions, STOP. Diagnose before proceeding to Phase 2. This is the flywheel validation test; skipping it risks building the rest on a broken foundation.

### What You Need to Provide to the AI Agent

- Access credentials: `DATABASE_URL`, `OPENAI_API_KEY` (or equivalent), LLM provider key
- Brand assets if/when UI customization is needed (can be deferred to Phase 2)
- Product decisions as listed above, at the moments they're needed
- Review time: budget ~4 hours per phase gate for thorough review
- Willingness to say "defer" or "I don't know yet" — these are valid answers, not blockers

### What You Should NOT Do

- Don't micromanage the implementation — the Build Guide + stubs are specific; the AI has a path
- Don't change direction mid-phase without discussion — phase gates are the right points for course corrections
- Don't skip the evaluation checkpoints — they exist to protect your investment
- Don't ask for features from docs 11-12 (skills, Oracle) during Phase 0-1 — those are later

---

## Coverage Audit — Detail Tables

### ✅ Fully Covered (AI builds without blocking)

| Area | Primary source |
|------|---------------|
| Three-layer architecture | doc 09 §3 |
| Multi-tenancy (personal / team / community) | doc 09 §4 |
| Knowledge ontology (5 categories) | doc 08 |
| Five representations | doc 07 |
| Complete KEA system prompt | doc 15 §2 |
| Complete KRA ranking formula with constants | doc 15 §3 |
| Complete Oracle system prompt | doc 15 §4 |
| All 6 core MCP tool JSON Schemas | doc 15 §5 |
| Core API contracts (8 endpoints) | doc 15 §7 |
| Complete Prisma schema | doc 15 §8 |
| All environment variables | doc 15 §9 |
| Package dependencies | doc 15 §10 |
| First 10 files to create | doc 15 §11 |
| Build sequence week-by-week | doc 13 |
| Session Quality Score formula | doc 06 §2 |
| Phase gates and red flags | doc 13 §11-12 |
| Scope boundaries | doc 14, doc 15 §12 |

### ⚠️ Partially Covered (fill via official library docs)

| Area | What the research gives | What the library docs fill |
|------|------------------------|----------------------------|
| MCP protocol transport | Tool schemas, concept | stdio framing, HTTP/SSE handshake |
| NextAuth v5 integration | Auth provider chosen | OAuth callback wiring, session shape |
| Prisma migrations | Schema ready to paste | Migration workflow, seed scripts |
| pgvector indexing | Column type and distance fn | HNSW index syntax, tuning |
| pg-boss jobs | Chosen as runner | Job schema, retry semantics, scheduling |
| Next.js App Router | Architecture hints | Server/client component boundaries, caching |
| SSE streaming | Response shape defined | Wire-level chunking pattern |

**Rule:** if the gap can be filled by reading a library's README or docs site, it is not a research gap — it is normal implementation work.

### ❌ Requires Human Decisions (AI should ask)

| Decision | Why the AI cannot make it |
|----------|---------------------------|
| Pricing tier structure | Business strategy |
| Community moderation thresholds | Product policy |
| Data retention beyond GDPR minimums | Legal + business |
| Specific UI copy, tone, microcopy | Brand voice |
| Color palette and brand identity | Design system |
| First target user segment | GTM strategy |
| Terms of service for publishing | Legal |

### 🤔 Reasonable Defaults (AI chooses, documents, proceeds)

| Choice | Default (per research) |
|--------|------------------------|
| Initial knowledge confidence | 0.7 (KEA), 1.0 (user-taught) |
| Decay half-life | 90 days |
| Max items injected per session | 8 (3 per type max) |
| Duplicate threshold | cosine similarity > 0.85 |
| Max KEA findings per session | 3 |
| Embedding dim | 1536 (OpenAI) |
| Session SSE timeout | 30s |
| Vibe-score sensitivity | per doc 06 §2 weights |

---

## Typical AI Stall Points — With Solutions

Walking through Day 1 through Phase 2 completion:

| Question the AI will have | Stall likelihood | Where to look |
|--------------------------|-------------------|---------------|
| "What do I build first?" | Low | README Path B Build Guide → doc 15 §11 |
| "Data model?" | Very low | doc 15 §8 |
| "How does KEA work?" | Very low | doc 15 §2 |
| "How does KRA rank?" | Very low | doc 15 §3 |
| "MCP tools to implement?" | Very low | doc 15 §5 |
| "MCP stdio wire format?" | Medium | **MCP SDK docs** |
| "Oracle implementation?" | Low | doc 15 §4 + doc 12 |
| "Dashboard screens?" | Medium | doc 10 §3 (prose, not mockups — AI picks layouts) |
| "Team roles / permissions?" | High | **Ask human** |
| "Moderation workflow UI?" | High | **Ask human** |
| "Test with what external client?" | Low | doc 13 Phase 2e; typical: Claude Code |
| "When is it done?" | Very low | doc 13 phase gates |

**Observation:** All high-stall cases are product decisions. All technical questions have clear answers in the research or in library docs.

---

## Joint Pre-Build Checklist (AI + Human)

Before the first `git commit`:

### Human confirms
- [ ] Path B is the chosen build
- [ ] LLM provider key is provisioned and accessible
- [ ] Database is provisioned with pgvector extension
- [ ] Initial budget / timeline / team decided
- [ ] Aware of 7 upcoming product decisions (section above)

### AI confirms
- [ ] Read README AI Agent Quickstart section
- [ ] Read this sufficiency note (doc 16)
- [ ] Read doc 15 (implementation stubs) and bookmarked relevant sections
- [ ] Understand what is NOT being built (no vibe-coding engine)
- [ ] Can articulate the three structural bottlenecks from doc 01 §2

### Joint sign-off
- [ ] Phase 0 acceptance criteria understood by both
- [ ] Phase 1 gate criteria explicitly reviewed (SQS must trend up)
- [ ] Communication cadence set (sync at phase gates minimum)
- [ ] Rollback plan discussed (feature flags per doc 04)

When all boxes check: begin Phase 0.

---

## If You Get Stuck — Decision Framework

```
Question:
    │
    ├── Technical: "How does library X do Y?" 
    │   → Consult library docs. Do not ask human.
    │
    ├── Architectural: "Which design pattern fits?"
    │   → Consult research docs 00-13. Use premises (doc 00) to guide.
    │
    ├── Algorithmic: "What threshold / weight / parameter?"
    │   → Consult doc 15. Use stated default. If not stated, use literature norm.
    │
    ├── Product: "What should this feature do for users?"
    │   → Ask human.
    │
    ├── Business: "How should this be priced / licensed / monetized?"
    │   → Ask human.
    │
    ├── Brand: "What should this look / sound like?"
    │   → Propose reasonable default. Document. Human can revise.
    │
    └── Scope: "Does this belong in the platform?"
        → Consult doc 09 §1-2 (scope boundary) + doc 14. If still unsure, ask.
```

---

## What Would Push Sufficiency From 85% to 95%

These are future additions that could reduce human involvement further. Write them only when the corresponding product decisions have been made.

| Future doc | What it would add | When to write |
|-----------|--------------------|---------------|
| `17-product-decisions.md` | Captured human answers to the 7 decisions | After first round of product decisions |
| `18-ui-mockups.md` | ASCII or markdown wireframes for 7 dashboard screens | After design pass |
| `19-workflow-diagrams.md` | Sequence diagrams for team invite, publish/moderate flows | After product policies are set |
| `20-ops-runbook.md` | Incident response, scaling, backup procedures | After first production deploy |

None of these are blocking — the platform is buildable without them at the 85% autonomy level.

---

## Summary Verdict

**The Brain Platform (Path B) is buildable autonomously from `research/knowledge/` with ~85% coverage.**

- The research specifies architecture, data model, algorithms, prompts, schemas, and contracts.
- Implementation stubs (doc 15) provide paste-ready starting points.
- Official library docs fill technical protocol details (~10%).
- A short list of product/business decisions from the human closes the remaining ~5%.

**What makes this possible:** the Brain-only scope. By explicitly not including a vibe-coding engine in the platform, the research avoids the hardest-to-specify component. The platform becomes a knowledge backend — a tractable target.

**What would break this:** reintroducing vibe-coding into the platform scope (that would drop sufficiency to ~55% per doc 14), or attempting it without the implementation stubs in doc 15.

**Bottom line for the AI agent:** you have enough to start. Read in order, ask when genuinely stuck, and follow the phase gates. The foundation is solid.

**Bottom line for the human:** you have ~5-7 decisions to make over the first 3 months. Make them crisply when asked. Trust the architecture; the flywheel validation at Phase 1 will tell you if the design holds.
