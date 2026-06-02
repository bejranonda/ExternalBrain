# Build Roadmap — From Zero to Platform
*Third pass: Opus 4.7 | Realistic sequencing of a greenfield build*

---

## 1. The Core Question

If starting from scratch with the full vision of docs 09-12, how do we build it in the right order?

Naïve answer: "build everything." Real answer: **build a thin vertical slice that validates the core flywheel, then expand.**

A thin slice that proves the flywheel compounds is worth more than a half-built platform with every feature.

---

## 2. Sequencing Principles

### 2.1 Validate the Flywheel Early
The platform's thesis is that knowledge compounds over time. Prove this as soon as possible. Each subsequent feature rides on an already-working flywheel.

### 2.2 Start Personal, Go Social Later
Personal Brain is simpler than team Brain is simpler than community. Each adds complexity (ACLs, moderation, economics). Ship personal first; layer social on top.

### 2.3 MCP Before Rich Webapp
The MCP server is smaller surface area than a full webapp. Ship a useful MCP server early; any user with Claude Code can use it. Webapp follows.

### 2.4 Measurement Infrastructure Before Features
Without evaluation (doc 06), you can't know what's working. Ship SQS + basic A/B before expensive feature work.

### 2.5 Honest Data Always
Never ship mock data. Better to ship a sparse but real dashboard than a rich but fake one.

---

## 3. The Five Phases

> 📘 **For Path B builders (Brain Platform, no vibe-coding inside):** read [16-path-b-sufficiency-notes.md](./16-path-b-sufficiency-notes.md) first. It gives a shared operating picture for AI agent + human, coverage audit, joint pre-build checklist, and the explicit list of product decisions needed from the human.

```
Phase 0: Foundation          (weeks 1-4)
Phase 1: Core Brain          (weeks 5-12)
Phase 2: MCP Server + Webapp (weeks 13-20)   — Brain-only, no vibe-coding inside
Phase 3: Teams + Community   (weeks 21-30)   — 2 weeks shorter without vibe-coding overhead
Phase 4: Advanced            (weeks 31+)
```

**Total time to Phase 2 complete: ~5 months with 2-3 engineers.**  
**Total time to Phase 3 complete: ~7.5 months.**

**Note on scope:** The platform does NOT include a vibe-coding engine. External AI tools (Claude Code, Cursor, Autobahn, custom agents) connect via MCP and do their own code generation. The platform processes the session events they send. This keeps the platform codebase small and lets any AI tool benefit from the Brain — including tools not yet built.

---

## 4. Phase 0: Foundation (Weeks 1-4)

**Goal:** Infrastructure and data model are in place. Nothing user-visible yet.

### Deliverables

- [ ] Monorepo setup (Turborepo)
- [ ] Package structure: `@brain/core`, `@brain/types`, `@brain/db`, `@brain/mcp`, `@brain/webapp`
- [ ] Postgres with pgvector extension
- [ ] Data model: Knowledge, KnowledgeRelation, Session, SessionEvent, User, Team, Feedback
- [ ] Auth: email + OAuth (GitHub, Google)
- [ ] CI/CD: tests, linting, type checking, deploy pipeline
- [ ] Object storage: S3/R2 for session archives
- [ ] Background job infrastructure: pg-boss
- [ ] Embedding service: OpenAI `text-embedding-3-small` (initially)
- [ ] Deployment: staging + production environments
- [ ] Basic observability: logs, errors, metrics

### Success Criteria

- A developer can `npm run dev` and have the full stack running locally
- Database migrations work
- Can manually insert a Knowledge row with an embedding and retrieve it via pgvector similarity

### Not Included

- Any user-facing features
- MCP server
- KEA / KRA logic

---

## 5. Phase 1: Core Brain (Weeks 5-12)

**Goal:** The Brain can extract knowledge, retrieve it, and the outcome loop closes. Internal tool only — no UI.

### Sub-Phase 1a: Session Ingestion (Week 5-6)

- [ ] Session API: `POST /api/session/start`, `POST /api/session/event`, `POST /api/session/end`
- [ ] SessionEvent schema with typed payloads
- [ ] Test harness: simulate a session end-to-end, verify events stored

### Sub-Phase 1b: Extraction — KEA v1 (Week 7-8)

- [ ] KEA service: post-session, LLM-based, structured output
- [ ] Quality filter: dedup, specificity, confidence floor
- [ ] Write Knowledge rows from KEA findings
- [ ] Unit tests with known-good session fixtures → expected extractions

### Sub-Phase 1c: Retrieval — KRA v1 (Week 9-10)

- [ ] Embedding generation on knowledge insert
- [ ] pgvector similarity search
- [ ] Hybrid ranking: semantic + metadata filters + recency
- [ ] Retrieval API: `POST /api/knowledge/retrieve`
- [ ] Benchmark: NDCG@5 on test queries > 0.6

### Sub-Phase 1d: Outcome Feedback (Week 11)

- [ ] SessionKnowledgeApplication table: track what was retrieved in a session
- [ ] Outcome handler: on session end, update knowledge confidence
- [ ] Decay job: daily, applies time-based confidence decrease
- [ ] Purge job: archive low-confidence + old + unused knowledge

### Sub-Phase 1e: Evaluation — SQS v1 (Week 12)

- [ ] Compute Session Quality Score per session
- [ ] Store SessionQualityScore records
- [ ] Admin dashboard: SQS distribution, trends

### Success Criteria

- Internal test: simulate 100 sessions with varying outcomes → SQS trends visible, high-quality knowledge retrieved for new similar queries
- Brain health metrics in admin dashboard
- Can say quantitatively: "After X sessions, retrieval improved by Y%"

### Not Included

- User-facing UI
- MCP server
- Oracle / chat

---

## 6. Phase 2: MCP Server + Webapp (Weeks 13-20)

**Goal:** Users can interact with the Brain via both MCP (AI agents) and webapp (humans).

### Sub-Phase 2a: MCP Server (Week 13-14)

- [ ] MCP server implementation (TypeScript, official SDK)
- [ ] Tools: `brain_retrieve_knowledge`, `brain_report_session_outcome`, `brain_teach_knowledge`, `brain_get_user_style`, `brain_find_skill`
- [ ] Resources: `brain://user/style-profile`, `brain://user/active-skills`
- [ ] Token-based auth
- [ ] Docs: "Configure Claude Code with your Brain"

### Sub-Phase 2b: Webapp — Dashboard + Sessions (Week 15-16)

- [ ] Next.js webapp with auth
- [ ] Dashboard: Vibe Score, knowledge counts, recent sessions, what-Brain-believes panel
- [ ] Sessions list + detail view (replay with knowledge overlay)
- [ ] Settings: account, MCP tokens

### Sub-Phase 2c: Webapp — Skills Browser (Week 17)

- [ ] Skills list with search, filters, sort
- [ ] Skill detail: view, edit, delete, export (markdown, Claude Code format, .cursorrules)
- [ ] Teaching UI: "Teach the Brain" form

### Sub-Phase 2d: Oracle v1 (Week 18)

- [ ] Chat UI
- [ ] Oracle RAG pipeline
- [ ] Citations with clickable links
- [ ] Conversation persistence

### Sub-Phase 2e: External Client Integration Testing (Weeks 19-20)

**Important:** The platform has no vibe-coding engine inside it. This sub-phase validates that external AI tools can connect and use the platform productively.

- [ ] Write integration guides: "Configure Claude Code with your Brain", "Configure Cursor", "Configure Autobahn"
- [ ] Test with Claude Code: configure MCP server, run 10 coding sessions, verify knowledge flows in
- [ ] Test with another external client (Cursor / custom agent): repeat
- [ ] Test with Autobahn (if available): validate that Autobahn's vibe-coding sessions populate the Brain
- [ ] Edge case testing: session mid-way abort, duplicate events, malformed payloads
- [ ] Rate limit and auth tests

### Success Criteria

- External user can: sign up, generate MCP token, install our MCP server in any supported AI client (Claude Code / Cursor / Autobahn / custom), do 5 coding sessions with THEIR usual AI tool, see their Brain populate, use the Oracle to query
- The beta user never uses our platform to write code — they use their own AI tool
- Beta with 20-50 users, positive feedback on Brain helpfulness
- Zero vibe-coding / agentic-loop code in our platform codebase

### Not Included

- Teams
- Community
- Advanced evolution (consolidation, graph relations)

---

## 7. Phase 3: Teams + Community (Weeks 21-32)

**Goal:** Multi-tenancy: teams can collaborate; community can form.

### Sub-Phase 3a: Team Vaults (Week 21-23)

- [ ] Team model: Team, TeamMembership, team-scoped Knowledge
- [ ] Team creation, invitation, role management
- [ ] Promote personal → team (explicit action)
- [ ] Team dashboard
- [ ] MCP tokens: team-scoped tokens

### Sub-Phase 3b: Community Publishing (Week 24-26)

- [ ] Community pool: CommunitySkill model
- [ ] Publish flow: user → anonymization review → moderation queue
- [ ] Community browser in webapp
- [ ] Import community skills to personal/team vault

### Sub-Phase 3c: Reputation + Quality (Week 27-28)

- [ ] User reputation system
- [ ] Skill quality filters: scanning, usage thresholds
- [ ] Skill reporting + moderation queue
- [ ] Rating / review system

### Sub-Phase 3d: Enterprise Essentials (Week 29-31)

- [ ] SSO integration
- [ ] Admin panel for teams
- [ ] Audit logs
- [ ] Data residency options

### Sub-Phase 3e: Knowledge Evolution (Week 32)

- [ ] Consolidation job: merge similar patterns
- [ ] Contradiction detection: flag conflicting knowledge
- [ ] Preference shift detection

### Success Criteria

- 3+ teams using team vaults
- 100+ skills published to community
- First enterprise customer signed
- Moderation pipeline working

---

## 8. Phase 4: Advanced (Weeks 33+)

**Goal:** Platform maturity features.

### Beyond-Roadmap Features

- **Knowledge graph**: relation edges, transitive retrieval, visualization
- **Internal wisdom skills**: auto-evolving extraction/retrieval rules
- **Skill composition**: parent-child skills, recursive application
- **Skill testing**: sandbox execution, CI for community skills
- **Skill versioning**: semantic versions, rollback
- **Proactive Oracle**: unsolicited insights
- **Multi-modal Oracle**: voice input/output
- **Federated learning**: cross-user anonymized patterns
- **IDE plugins**: VS Code, JetBrains
- **CI integrations**: Brain-driven code review
- **Mobile app**: browse/query Brain on mobile

These are individually significant projects. Pick based on user signal and strategic priorities.

---

## 9. Team Sizing

### Phase 0 (Foundation)
- 1-2 engineers
- 4 weeks
- No PM, no designer needed yet

### Phase 1 (Core Brain)
- 2-3 engineers (1 ML-focused)
- 8 weeks
- Part-time PM for prioritization

### Phase 2 (MCP + Webapp)
- 3-4 engineers (+1 for webapp UI)
- 1 designer part-time
- 8 weeks
- PM full-time

### Phase 3 (Teams + Community)
- 4-5 engineers
- 1 designer full-time
- 1-2 community/moderation specialists
- 12 weeks

### Phase 4
- Scale as needed

Full platform to Phase 3 completion: roughly **4-5 person team over 8 months.**

---

## 10. Critical Decisions Along the Way

These will recur and need early answers:

### 10.1 Build Your Own Model or Use OpenAI/Anthropic?

**Decision point:** Phase 1 Sub-Phase 1b (KEA)

- **OpenAI/Anthropic APIs:** Fast to ship, high quality, costs scale with usage, data sovereignty concerns
- **Self-hosted:** Slower to ship, variable quality, fixed cost, full control

**Recommendation:** Start with hosted APIs for speed. Migrate to self-hosted when usage justifies (probably Phase 3+).

### 10.2 Embedding Model Choice

- **OpenAI text-embedding-3-small:** Great quality, proven, costs scale
- **BGE small / self-hosted:** Free at runtime, need to host model, good quality

**Recommendation:** Start OpenAI. Migrate to self-hosted at scale if economics demand.

### 10.3 Pricing Model

- **Free forever for personal Brain?** Acquisition engine; cost = KEA calls
- **Free personal, paid teams?** Standard SaaS freemium
- **Usage-based?** Complex to explain, feels like rent-seeking

**Recommendation:** Free personal Brain (limited sessions/month), paid teams ($X/seat/month), enterprise custom.

### 10.4 Monorepo vs. Polyrepo

**Recommendation:** Monorepo (Turborepo). Enables sharing `@brain/core` across webapp, MCP server, SDK.

### 10.5 Open Source Strategy

Options:
- **Closed source:** Traditional SaaS
- **Open-core:** Core Brain open source; enterprise features closed
- **Fully open source:** Monetize services/hosting

**Recommendation:** Open source the MCP server (it enables ecosystem adoption). Closed source the webapp, Intelligence Layer, hosted service.

### 10.6 Data Retention Policy

- How long do we keep session events? Knowledge items? Oracle conversations?
- GDPR requires user deletion; what's the default?

**Recommendation:** Session events 90 days; knowledge kept indefinitely until user-deleted; Oracle conversations 365 days; all user-deletable on demand.

---

## 11. Risk Analysis

### 11.1 Risk: No flywheel (Brain doesn't improve sessions)

**Probability:** Medium  
**Impact:** Existential — the whole thesis fails  
**Mitigation:** Evaluation in Phase 1 catches this early. If SQS doesn't trend up after 4 weeks of real usage, investigate and pivot.

### 11.2 Risk: MCP adoption is slow

**Probability:** Medium  
**Impact:** High — portability story weakens  
**Mitigation:** Make MCP config dead simple. Provide 1-click setup for Claude Code / Cursor. Bundle MCP server install with signup.

### 11.3 Risk: LLM costs spiral

**Probability:** Medium  
**Impact:** Medium — unit economics  
**Mitigation:** Use cheapest models that meet quality bar. Cache aggressively. Rate limit. Pass costs in pricing.

### 11.4 Risk: Community quality issues

**Probability:** High  
**Impact:** Medium  
**Mitigation:** Launch community only after v1 moderation infrastructure in place. Strict threshold for publication. Fast response to reports.

### 11.5 Risk: Privacy concerns block adoption

**Probability:** Medium  
**Impact:** High  
**Mitigation:** Privacy by default (personal scope). Explicit data practices. SOC 2 certification in Phase 3. Self-hosted option for enterprise.

### 11.6 Risk: Competition ships first

**Probability:** High  
**Impact:** Medium  
**Mitigation:** Focus on moats: portability via MCP, quality via evaluation, community via curation. Don't compete on features — compete on flywheel.

### 11.7 Risk: User education is hard

**Probability:** High  
**Impact:** Medium  
**Mitigation:** Oracle is the user education tool. "What does this platform do? Ask it directly." Rich in-product explanations.

---

## 12. Go/No-Go Gates

At each phase transition, evaluate:

### Gate 1 (End of Phase 1)
**Question:** Does the Brain measurably improve session outcomes?  
**Metric:** For users with 10+ sessions, rolling 30-day SQS improves month-over-month.  
**If No:** Reassess extraction/retrieval; don't proceed to Phase 2 until yes.

### Gate 2 (End of Phase 2)
**Question:** Do users engage beyond trial?  
**Metric:** 50%+ of signups still active after 30 days.  
**If No:** Iterate on UX, onboarding, Oracle quality before Phase 3.

### Gate 3 (End of Phase 3)
**Question:** Does the community pool produce value?  
**Metric:** 30%+ of active users import at least one community skill.  
**If No:** Community curation is too weak; fix before investing more.

---

## 13. MVP Definition — The Thin Slice

If you could only build one thing to validate the platform thesis, what would it be?

**The MVP: A Brain that makes Claude Code sessions measurably smarter over time.**

Components needed:
- Session ingestion from Claude Code (via MCP)
- KEA (minimal)
- KRA (minimal with embeddings)
- Outcome feedback loop
- SQS measurement

Timeline: 6 weeks.  
Team: 2 engineers.  
Success: 50 beta users, SQS improves month-over-month for majority.

Everything else (webapp, Oracle, teams, community, skills marketplace) can be layered on if the MVP validates.

---

## 14. What Makes This Different From Today's Autobahn

| Dimension | Today | Platform |
|-----------|-------|----------|
| Product focus | AI coding tool | Knowledge OS for AI coding |
| AI access | Proprietary | Any MCP client |
| Brain quality | Keyword-based extraction | LLM-extracted, semantically-retrieved |
| Tenancy | Single-user | Personal + team + community |
| Portability | Minimal | Full export + MCP |
| Evaluation | None | SQS + A/B harness |
| Oracle | None | Chat with your Brain |
| Evolution | None | Consolidation, contradiction detection, decay |

The greenfield build is substantially larger in scope but **tractable when staged** as above. The current Autobahn codebase contains ~70% of the infrastructure needed for Phase 2 — it's not a rebuild from zero, it's a **refactor + expansion** from a strong foundation.

---

## 15. Bottom Line

The roadmap is ambitious but disciplined:

- **Phase 0-1 (12 weeks):** Prove the flywheel. Internal use only.
- **Phase 2 (8 weeks):** Ship to users via MCP + webapp.
- **Phase 3 (12 weeks):** Add teams + community.
- **Phase 4 (ongoing):** Advanced features.

Total time to full platform: ~8 months with a 4-5 person team. Time to MVP (thin slice): 6 weeks with 2 engineers.

The critical success factor is **gate 1**: by the end of Phase 1, the Brain must measurably improve session quality. If this is true, everything else becomes worthwhile. If not, no amount of features on top will save the thesis.

Start by building the measurement infrastructure alongside the Brain. Let the data tell you what to build next.
