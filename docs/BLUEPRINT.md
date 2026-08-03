# External Brain — Master Blueprint

*Version 0.1 · 2026-04-20 · Synthesis of `research/knowledge` + adaptations from Hermes, Honcho, Obsidian, LiveSync*

This document is the single source of truth for what the External Brain is, why it exists, how it is built, and how it makes money. It sits on top of ~7,900 lines of prior analysis in `research/knowledge/` — if anything here is unclear, those documents are the authority.

---

## 1. Product Thesis

> **The knowledge you build while coding with any AI tool, made permanent, portable across tools, and compounding over time.**

Every developer using AI coding tools (Claude Code, Cursor, Windsurf, Autobahn, custom agents) today throws away 95 % of the knowledge created in each session the moment the context window closes. CLAUDE.md files and `.cursorrules` try to fix this but they are manual, per-tool, and don't learn.

The External Brain is a **persistent, queryable, evolving, shareable layer of coding knowledge that serves any AI tool via MCP**. It is not itself an AI coding tool — it is the substrate that makes every AI coding tool smarter the longer you use it.

### What the platform IS (Path B)
- An **MCP server** that AI agents call before generating code, and report outcomes to after.
- A **webapp** where humans browse, teach, edit, and chat with their Brain.
- An **intelligence layer** that extracts knowledge from sessions, retrieves it by meaning, evolves it over time, and lets users query it in natural language (the Oracle).
- A **multi-tenant store** with personal / team / community scopes.

### What the platform IS NOT
- Not a code editor, not an agentic loop, not a preview server, not a prompt → code generator.
- Not a single-vendor tool — we *serve* Claude Code, Cursor, Windsurf, Autobahn, and anything that speaks MCP.

The platform's reach is the union of every AI tool that connects to it.

---

## 2. Philosophy & Mental Model

### 2.1 Two parables from the usecase brief

**The doctor.** A good doctor listens to patients, notes what matters, and leaves out what doesn't. Her notes are readable by the next doctor who treats this patient *or* any patient like them. She follows individual patients across thousands. → The **Knowledge Extraction Agent (KEA)** is the doctor.

**The secretary.** A good secretary writes a memo aimed at who will read it. Same meeting, different audience → different memo. She knows what to filter. → The **retrieval path (KRA)** is the secretary.

Both need **meta-skills** — internal wisdom that tells them what is worth writing down, what belongs to this patient vs. every patient, and when an old note has expired. Those meta-skills are themselves learnable (and shareable) artifacts. This is why **skills come in two kinds** in our system: *output skills* (for humans/AI to apply elsewhere) and *internal wisdom skills* (for the Brain itself to get smarter at extraction, retrieval, synthesis).

### 2.2 How the brain works, for AI and for users

**For AI (the MCP client):**
1. Before generating code, call `brain_retrieve_knowledge({ prompt, context })` → receives a typed bundle (reflexes, recipes, heuristics, principles, anti-principles) already formatted for injection into a system prompt.
2. After the user accepts/rejects the generated code, call `brain_report_session_outcome({ sessionId, success, knowledgeUsed, ... })` → closes the feedback loop so good knowledge rises and stale knowledge decays.
3. During the session, call `brain_log_event(...)` for significant events — file created, build failed, correction applied. These events are the raw material for future extraction.

**For users (the webapp):**
1. A **dashboard** that shows "Your Brain right now" with real data, not mocks — active skills, recent extractions, SQS trend, knowledge conflicts awaiting review.
2. **Skills browser** — view, edit, export, import, share.
3. **Graph view** — an Obsidian-style map of skills and their relations (depends_on, specializes, contradicts, deepens).
4. **Oracle chat** — "how did I solve the CORS issue last month?", "what do I usually use for auth?", "show me my React anti-patterns". Answers cite the knowledge items used.
5. **Sync settings** — connect an Obsidian vault or local folder for two-way sync via the LiveSync-style protocol.

### 2.3 DIKW-T-R-R

Research doc 02 extends the classic DIKW-T (Data → Information → Knowledge → Wisdom → Transformation) framework with two orthogonal axes that are usually invisible but actually dominate quality: **Retrieval** (can we find it?) and **Representation** (what form is it stored in?). The platform is organized around this extended framework:

| Tier | What it is | Where it lives |
|---|---|---|
| **Data** | raw session events, messages, tool calls | `SessionEvent` table, object storage |
| **Information** | typed session summaries, diffs, outcomes | `Session.metadata`, session archive |
| **Knowledge** | atomic, actionable rules (Reflex/Recipe/Heuristic/Principle/Anti-principle) | `Knowledge` table + embeddings |
| **Wisdom** | internal skills that improve extraction/retrieval itself | `InternalSkill` + reflection workers |
| **Transformation** | applying knowledge to new AI sessions | MCP `brain_retrieve_knowledge` responses |
| **Retrieval** | hybrid semantic + metadata + graph search | `kra.ts` + pgvector + tag index |
| **Representation** | text + structured + embedding + graph + symbolic | five storage backends on the same item |

A mature Brain uses **all five representations of the same knowledge item** — markdown for humans, structured JSON for agents, embeddings for similarity, graph edges for context expansion, and optional symbolic when/then for deterministic guards.

---

## 3. Architecture (Three Layers, Eight Subsystems)

```
  EXTERNAL CLIENTS  (Claude Code, Cursor, Autobahn, custom agents, Obsidian)
          │ MCP / REST / LiveSync
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EXPERIENCE LAYER                                                   │
│    Webapp (Next.js)   MCP Server   REST API   JS SDK   Obsidian     │
│                                                        sync bridge  │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  INTELLIGENCE LAYER (8 subsystems)                                  │
│    Ingestion · Extraction (KEA) · Storage · Retrieval (KRA)         │
│    Evolution · Oracle · Evaluation · Trust/Audit                    │
│    + Graph engine (Obsidian-style) + Autoskill loop (Hermes-style)  │
│    + Peer Cards & Conclusions (Honcho-style)                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  DATA LAYER                                                         │
│    Postgres (+ pgvector) · Object storage (session archives,        │
│    skill markdown) · pg-boss (jobs) · CouchDB (optional, for        │
│    LiveSync bridge to Obsidian clients)                             │
└─────────────────────────────────────────────────────────────────────┘
```

Eight core subsystems (detailed in research doc 09 §5):

1. **Ingestion** — normalize events from every MCP client into a canonical `SessionEvent` log.
2. **Extraction (KEA)** — LLM-based, typed, quality-filtered. Two modes: auto (conservative, fire-and-forget) and high-sensitivity (first 5 sessions of a new user, aggressive + user-confirmed).
3. **Storage** — five representations per item (see §2.3). Postgres + pgvector + object storage + graph edges.
4. **Retrieval (KRA)** — hybrid scoring: `0.40·semantic + 0.20·success + 0.15·recency + 0.15·context_fit + 0.10·confidence`. Scope-respecting, diversified, at most 8 items returned.
5. **Evolution** — confidence feedback, temporal decay, consolidation (merge near-duplicates), contradiction detection, obsolescence detection, preference-shift detection. Runs daily/weekly.
6. **Oracle** — RAG chat with citations. Premium model (Claude Sonnet 4.6 or GPT-4-class). Streamed SSE response.
7. **Evaluation** — Session Quality Score (SQS), A/B test harness, NDCG@5 retrieval benchmark, knowledge health metrics. Ship alongside v1 or the flywheel can't be measured.
8. **Trust / Audit** — confidence floor (0.7 for KEA, 1.0 for user-taught), decay curves, provenance (every knowledge item links to source sessions), GDPR export/erase.

---

## 4. Adaptations from the Four Reference Systems

The research dedicates a separate folder to each system. The table below lists the *stolen ideas* — what we adopt and how.

### 4.1 Hermes (conversational agent with evolving skills)

| Idea | Adopted as |
|---|---|
| **Session-scoped background review** — fork-and-forget agent runs after every N turns, extracts skills asynchronously without blocking the hot path | `packages/core/src/autoskill.ts` — runs after every `brain_report_session_outcome` call on the worker. |
| **Skill format: SKILL.md with YAML frontmatter + Markdown body** | Our `Skill.content` is exactly this. Frontmatter is stored as `Skill.frontmatter` JSON, body as markdown. One file per skill, exportable. |
| **Inject procedures as *user* messages, not system prompt** (preserves Anthropic prefix cache) | The MCP `brain_retrieve_knowledge` response is structured so the client can inject it as a user message block. |
| **FTS5 cross-session search as a first-class tool** | Our `brain_session_search` MCP tool uses Postgres FTS + pgvector hybrid. |
| **Profiles (`HERMES_HOME=/profiles/<slug>/`)** | Maps 1:1 to our tenant workspaces — personal / team / community. |
| **Parent-session chains across compactions** | `Session.parentSessionId` column + graph edges to preserve continuity. |

Explicit divergence: Hermes runs skills against the live LLM agent directly. We do *not* run an agent — we hand back formatted knowledge to whichever client the user brought.

### 4.2 Honcho (dialectic memory from chat)

| Idea | Adopted as |
|---|---|
| **Two-stage pipeline: Message → Conclusion → Representation** (never build profile from raw chat) | KEA produces atomic `Knowledge` items *first*. Oracle synthesizes narrative answers on demand *from* those items — never from raw session text. |
| **Observer/observed directionality** on every fact | Each `Knowledge` row has `ownerUserId` (the observed) and `extractedBy` (the observer). Team/community knowledge preserves this — we can answer "what does the team believe Alice prefers for React?" |
| **Peer Card** — hard-coded bullet facts that override synthesized representations | `PeerCard` table per user + per project. `brain_get_user_style` returns these *first*, then falls back to KEA-derived knowledge. Critical for things the user has explicitly taught ("I'm allergic to `any`-types"). |
| **`queue_status().pending_work_units == 0`** before querying after an ingest | Worker exposes `GET /api/health/ingest-queue`. Webapp and MCP clients can block on "brain is consolidated" before asking time-sensitive queries. |
| **Dialectic chat with reasoning levels** (`minimal | low | medium | high | max`) | Oracle accepts a `reasoning_level` parameter that trades cost/latency for depth. Default `medium`. |

Explicit divergence: Honcho is a general-purpose memory system for any conversation. We are specialized to coding sessions — our ontology is coding-specific (Reflex/Recipe/Heuristic/Principle/Anti-principle), our retrieval is tuned for "code task → knowledge bundle", our SQS metric is code-specific.

### 4.3 Obsidian (linked markdown notes & graph)

| Idea | Adopted as |
|---|---|
| **MetadataCache** — pre-parsed, async index of links/tags/headings/frontmatter, accessible via single API calls, rebuilt on mutation | Server-side `GraphIndex` in `packages/core/src/graph.ts`. Materialized into `GraphEdge` rows + in-memory adjacency map, rebuilt on every `Knowledge` / `Skill` write. |
| **Typed frontmatter schema (`types.json`)** — properties are schema-backed and queryable | Every `Skill` must carry `skill_id, stage, tags[], dependencies[], scope`. Enforced at write time. |
| **Wikilinks `[[Skill Name]]` with fuzzy resolution + aliases + embeds + block refs** | `kra.ts` expands `[[…]]` when assembling retrieval bundles. Unresolved links surface as "skills-to-create" in the webapp. |
| **Backlinks, orphans, dead-ends as first-class queries** | MCP tools `graph_backlinks`, `graph_orphans`, `graph_dependents` + corresponding REST endpoints. |
| **Daily notes + periodic notes** | Every session auto-produces a daily note linking to the skills that were injected/extracted — free weekly/monthly digest material. |

Explicit divergences: we do **not** support Obsidian's unrestricted plugin model (security), path obfuscation (server must see cleartext paths for indexing), or single-device assumption (we are multi-user from day 1).

### 4.4 LiveSync (CouchDB-based sync protocol)

| Idea | Adopted as |
|---|---|
| **Don't build a custom sync engine** — delegate to CouchDB `_changes` + `_bulk_docs` | Optional CouchDB bridge (`apps/sync-bridge`) so users who already use Obsidian LiveSync can plug in their vault. Skills and knowledge flow both ways. |
| **Content-addressed chunks** (`{_id: "h:<hash>", type: "leaf", data}`) — automatic dedup | Our object storage uses content-addressed keys for skill body text and session transcripts. Saves ~40 % on storage and enables structural sharing for skill versions. |
| **Tombstones as revisions, not purges** | Deletion is never physical until GDPR erasure. Soft-delete with `deletedAt` + tombstone rev preserves provenance. |
| **Debounced git commits** (coalesce mutations in a 2-second window) | Skill/knowledge writes are batched in the worker to produce one git commit per burst, so the history axis stays readable. |
| **Pull-only mode for server vaults** | Team & community vaults default to `pull-only` — KEA writes to them through controlled promotion APIs, not by clients pushing directly. |

Explicit divergence: CouchDB is optional. Our canonical store is Postgres + pgvector, not CouchDB. The CouchDB bridge is for interoperability with existing Obsidian users, not primary storage.

### 4.5 autoskill (nicknisi/claude-plugins)

Captured spec at `research/autoskill/spec.md`. Adaptation diff at `research/autoskill/integration_notes.md`.

| Idea | Adopted as |
|---|---|
| **Point-based scoring**: explicit "always/never" = 5, repeated pattern = 3, single correction = 2, approval = 1 | `packages/core/src/autoskill.ts` — `scoreSignal()`. We add a small repetition bonus (+2 for explicit ≥ 3×) and a multi-session bump (+1 to +3 for similar priors in last 30 days). |
| **Confidence tiers**: HIGH ≥ 7, MEDIUM 4–6, LOW < 3 (filtered out) | `tierForScore()`. LOW never produces a proposal. |
| **Conflict resolution priority**: recency → explicitness → repetition → score; equal scores trigger clarification | `resolveConflicts()`. Equal-score groups remain marked so the webapp UI can ask the user. |
| **4-question quality filter** (specific, actionable, durable future-tense, non-generic) | `passesQualityFilter()`. Combined with our existing generic-phrase deny-list. |
| **File routing**: existing Skill (≥ 3, has match) · CLAUDE.md / rules (project convention) · new Skill (≥ 5, no match) · ignore | `routeSignal()`. We map "CLAUDE.md" to four targets: `skill`, `rules` (exportable), `knowledge` (atomic), `internal_skill` (platform tuning). |
| **Approval-before-apply with "y/n/selective"** | `AutoskillProposal.status` queue + webapp UI. Default never auto-applies; user can opt in to auto-apply HIGH via `autoApplyHigh: true` setting. |
| **Reversibility constraints**: additive only, one concept per change, never delete without explicit instruction | Enforced in `applyProposal()` — `op: "replace"` and `op: "delete"` are forbidden and reject the proposal. |
| **Rollback via descriptive git commits**: `chore(autoskill): add error handling rule` | Per-proposal commit message convention; sync-bridge integrates with user's git when configured. |
| **Clarification triggers** (ambiguous, contradictory, boundary, scope) | Surfaced in webapp queue; future `AskUserQuestion`-style prompt for MCP clients. |

Explicit divergences from upstream:
- **Activation.** nicknisi triggers on user phrase ("autoskill", "learn from this session"). We trigger automatically on every `brain_report_session_outcome` because the platform is multi-tool; the quality bar is preserved by **never auto-applying without approval**.
- **Cross-session signal.** nicknisi defaults to current session only. We always fold in similar-prior-correction signal from the last 30 days because we have the multi-session history that the upstream plugin doesn't.
- **More targets.** We route to four target types (skill / rules / knowledge / internal_skill) instead of two (Skill / CLAUDE.md), because we serve more than one client format and we promote to atomic `Knowledge` rows before bundling into skills.
- **No live git commit on the user's repo.** We snapshot diffs in `AutoskillProposal.patch` and audit log; a connected sync-bridge handles git on the user's side.

---

## 5. The Knowledge Model (5-category ontology)

From research doc 08, every knowledge item is exactly one of:

| Type | Meaning | Example |
|---|---|---|
| `reflex` | unconditional rule | "Always end files with newline" |
| `recipe` | template for a task type | "For React forms, use react-hook-form + zod" |
| `heuristic` | context-sensitive guidance | "When debugging Next.js build errors, clear `.next` first" |
| `principle` | abstract value | "Prefer composition over inheritance" |
| `anti_principle` | something to avoid | "Don't inline styles — user rejected 3×; use Tailwind instead" |

Each item has a **scope** (`global | user | project | session_context | community_candidate`) and a **confidence** (0.0–1.0). Default confidence is 0.7 (KEA-extracted), 1.0 (user-taught), promoted to higher via outcome feedback, decayed via disuse.

Storage is **immutable + versioned**: edits create a new row with `parentKnowledgeId` pointing at the previous version.

---

## 6. Skills — Two Kinds, One Format

Skills are the user-visible unit of knowledge. File format is stolen from Hermes + Obsidian:

```markdown
---
skill_id: react-tailwind-dark-todo
title: React + Tailwind Dark Todo App
stage: knowledge          # inbox | notes | knowledge | wisdom
scope: user               # user | team | community
kind: output              # output | internal
tags: [react, tailwind, localStorage]
dependencies: [[react-forms-basics]]
confidence: 0.92
mastery: 4                # 1-5, calibrated by outcome feedback
created: 2026-03-12
updated: 2026-04-18
---

## Trigger
When the user asks for a React todo app with dark mode.

## Decisions
- Vite over CRA (faster, zero-config).
- Tailwind `dark:` class strategy with `prefers-color-scheme`.
- `localStorage` for persistence, guarded by `typeof window !== 'undefined'`.

## Steps
1. …
2. …

## Gotchas
- Hydration mismatch if you read localStorage during SSR.
```

### 6.1 Output skills
The end product. Exportable in multiple formats: Claude Code (`.claude/skills/`), Cursor (`.cursor/rules/`), Windsurf (`.windsurfrules`), Codex (`AGENTS.md`), generic markdown. One-click share to community pool. See `mcp-tools/skill_export.ts`.

### 6.2 Internal wisdom skills (`kind: internal`)
Used by the platform itself, not exported. Examples:

- `extraction.filter-generic-advice` — prompt addendum for KEA that filters out findings like "use good practices".
- `retrieval.boost-project-scoped-when-path-matches` — hook that re-ranks KRA results when the current file path matches a project-scoped skill.
- `oracle.cite-anti-principles-distinctly` — formatting rule for Oracle.

Internal skills are the mechanism by which **the Brain gets better at being a brain**. They are learnable artifacts, not hard-coded prompts. A human curator (or a meta-agent) can promote a pattern that keeps working across many users into a community-level internal skill.

This answers the user's question *"How can the AI learn from process and smarter in every step?"* — the answer is that every layer of the system (not just output) is promotable and versioned.

---

## 7. Autoskill — from session to skill, automatically

The sample story in the brief describes the "Auto improve skill Flow" the user built on top of `/rrr` + `/autoskill`. We adopt it as a first-class platform feature.

**Trigger.** After every `brain_report_session_outcome`, a worker job runs the `autoskill` pipeline.

**Steps.**
1. Scan the session for **correction patterns** — moments the user re-prompted or explicitly reversed the AI. If a pattern appears ≥ 2 times in the session, flag it.
2. For each flagged pattern, classify *where* it belongs: `style` (update a writing/style skill), `session-behavior` (update `.claude/rules/` export), `architecture` (new heuristic or principle), `one-off` (discard, noise).
3. Filter noise — drop patterns unlikely to recur across sessions (using embedding similarity to prior user corrections).
4. Propose edits with **confidence tiers** (HIGH / MEDIUM). HIGH = apply automatically; MEDIUM = surface for user review.
5. Record the proposal in `AutoskillProposal` table. Webapp UI shows a queue.
6. Never edit a user-confirmed skill without the user's approval. The pipeline *proposes*; the user *approves* (one click in webapp, or via `brain_teach_knowledge` from the MCP client).
7. After approval, bump the skill version, write to the right place (skill file vs. rules vs. Oracle v2), and re-embed.

This maps the user's prior workflow (Claude Code `/autoskill` skill) into a persistent, cross-tool service.

---

## 8. Multi-tenancy — Personal / Team / Community

| | Personal | Team | Community |
|---|---|---|---|
| Default for new knowledge | ✓ | ✗ | ✗ |
| Visible to | owner only | team members | everyone opted-in |
| Auto-extracted | yes | no (explicit promotion) | no |
| Moderation | none | team admin | platform + usage-threshold gate |
| Rate limit | generous | generous | strict publishing quotas |

Boundaries enforced at the ORM layer (every query is scope-filtered) **and** at the MCP auth layer (tokens are scoped to a tenant).

---

## 9. API Surfaces

### 9.1 MCP tools (for AI clients)
All 8 tools are detailed in `docs/MCP_TOOLS.md`. Names:

1. `brain_retrieve_knowledge`
2. `brain_report_session_outcome`
3. `brain_teach_knowledge`
4. `brain_get_user_style`
5. `brain_ask_oracle`
6. `brain_log_event`
7. `brain_find_skill`
8. `brain_session_search`

MCP resources (read-only views):
- `brain://user/style-profile`
- `brain://user/active-skills`
- `brain://user/recent-sessions`
- `brain://team/{teamId}/shared-skills`

### 9.2 REST API (for webapp + automation)
Session lifecycle, Knowledge CRUD, Skills CRUD, Oracle streaming, MCP tokens — see `docs/REST_API.md`. The webapp consumes the same handlers as the MCP server (no duplicate logic).

### 9.3 LiveSync bridge (optional)
For users who already maintain an Obsidian vault, the sync bridge mirrors platform skills into the vault via CouchDB `_changes`. Two-way sync with tombstones and content-addressed chunks. See `docs/SYNC.md`.

---

## 10. Evaluation — the flywheel or it didn't happen

Three metrics, all in the admin dashboard and exposed via REST:

1. **Session Quality Score (SQS) per session** — weighted combination of build success, user feedback, diff acceptance ratio, clarification count. Research doc 06 §4 has the formula.
2. **Knowledge health** — % of knowledge used in last 30 days, average confidence, contradiction count, median age.
3. **Retrieval NDCG@5** — on a labelled benchmark of 100+ queries, how often are the top-5 retrieved items actually the right ones.

If SQS doesn't trend up after 4 weeks of real usage, **stop and investigate** — the research explicitly calls this the Gate 1 red flag.

---

## 11. Business Opportunities

Three model tracks, not mutually exclusive:

### 11.1 Freemium SaaS (primary)

> **CURRENT PHASE (decided 2026-08-02): freemium with NO PAYMENT REQUIRED.**
> The tier table below is the live product shape — what is deferred is
> **payment collection only**.
>
> What that means concretely:
>
> - **Keep and build the freemium machinery.** Tiers, usage tracking, quotas
>   and enforced limits are real features and are expected to work. Building
>   metering now is what lets a paid tier be switched on later without
>   retrofitting usage accounting into every code path; skipping it makes the
>   eventual paid tier a rewrite.
> - **Deferred: checkout, invoicing, card capture, and any paywall that blocks
>   a user.** Nobody is charged in this phase. No tier gate should hard-stop a
>   user on payment grounds.
> - **Every documented limit must actually be enforced in code.** The model to
>   copy is `MAX_ORACLE_COST_USD_PER_DAY`
>   (`packages/core/src/cost.ts::reserveCapSlot`) — atomic, via a
>   `pg_advisory_xact_lock` on `(userId, day)`, so N concurrent callers cannot
>   all pass the same pre-call check. **A limit that is documented but has no
>   reader is a product gap, not a doc bug.** `MAX_KEA_COST_USD_PER_SESSION` is
>   currently in that state — tracked in `KNOWN_ISSUES §0q`.
> - **Limits serve two masters here and both are real:** the tier boundary
>   (product) and the instance operator's LLM bill (operational), since in a
>   self-hosted deployment the operator pays for every token.
>
> When the phase changes — i.e. payment is switched on — this note changes
> first.

| Tier | Price | Who | What they get |
|---|---|---|---|
| Personal Free | $0 | hobbyists, students | unlimited sessions, 200 Oracle queries/month, personal Brain only, community publishing, no team |
| Personal Pro | $12/mo | serious devs | unlimited Oracle, priority KEA (Claude for extraction), private sync bridge, advanced Oracle reasoning levels |
| Team | $25/user/mo | startups to 50-eng orgs | team Brains, role-based ACL, shared style profile, internal wisdom skill authoring, audit log, SSO |
| Enterprise | custom | 50+ eng orgs | VPC deploy, on-prem models, compliance (SOC2/ISO/GDPR evidence), custom retention, dedicated support |

### 11.2 Marketplace (secondary, high-leverage)
- Curated skill packs: "React 19 Expert Pack", "Rust Systems Pack", "DevOps on AWS Pack". 70/30 revenue split with publishing experts.
- Company-internal skill packs: sell to enterprises as preloaded team knowledge.
- Internal-wisdom skill marketplace for the *platform itself* — a small group of experts publishes extraction/retrieval tuning skills; platform curates.

### 11.3 Usage-metered APIs (tertiary)
- Public embedding + retrieval API for other tool builders (competitor to Pinecone for the specific vibe-coding-knowledge use case).
- Oracle-as-a-Service: wrap premium-model Oracle for non-Brain customers (costly, only if demand emerges).

### 11.4 Non-monetization levers that compound
- **Open-source the MCP server** under Apache 2 — every AI tool ships with it in the box → free distribution.
- **Open-source skill format** → Obsidian, Cursor, Windsurf all interoperate.
- **Free tier is genuinely useful** → flywheel needs volume more than revenue in year 1.

### 11.5 North-star KPI
*"Share of a user's AI-generated code that is influenced by the Brain"* — measured by `brain_retrieve_knowledge` calls per session × average hit rate. If this number trends up, the product is working. If it stalls, nothing else matters.

---

## 12. Roadmap (Path B, condensed)

| Phase | Weeks | Ship |
|---|---|---|
| 0 — Foundation | 1-4 | monorepo, Postgres+pgvector, auth, first row with embedding |
| 1 — Core Brain | 5-12 | KEA, KRA, outcome feedback, SQS. **Gate 1**: simulate 100 sessions, SQS trends up |
| 2 — MCP + Webapp | 13-18 | 8 MCP tools, webapp dashboard, Oracle, skills browser. **Gate 2**: beta user plugs into Claude Code, 5 real sessions, Brain populates |
| 3 — Teams + Community | 19-28 | team vaults, community publishing, moderation, graph view. **Gate 3**: 30 % of active users import at least one community skill |
| 4 — Advanced | 29+ | autoskill UI, internal wisdom skill authoring, proactive Oracle, LiveSync bridge |

Team: 3-4 engineers. Research doc 16 estimates ~85 % autonomous build coverage with AI assistance; 5-7 product decisions (pricing, moderation level, data residency, OSS scope, etc.) need a human upfront.

---

## 13. Answers to the brief's guiding questions

**Q: How does the brain work for AI and for users?**
A: For AI, MCP tools are the interface — retrieve before generating, report after. For users, the webapp + Oracle make the same Brain queryable in natural language. Same store, two surfaces.

**Q: How do we process data into knowledge and wisdom?**
A: DIKW-T-R-R pipeline. Events → session summaries → KEA extraction → typed knowledge items → graph + embeddings + markdown (five representations). Internal wisdom skills operate on the pipeline itself.

**Q: Is this useful for vibe-coding?**
A: Yes, if and only if (a) extraction is specific (≥ 70 % actionable per human spot-check) and (b) retrieval NDCG@5 > 0.5. Below those thresholds the brain is noise and *harmful* — research doc 05 §7 is explicit. We measure both from day 1.

**Q: How does AI get smarter at every step?**
A: Three feedback loops: (1) outcome feedback updates per-item confidence; (2) autoskill proposes skill edits after each session; (3) internal wisdom skills let curators promote extraction/retrieval tweaks that worked across many users. Every layer is learnable.

**Q: How do we export to other projects/apps?**
A: Skills export in Claude Code, Cursor, Windsurf, Codex, markdown formats. MCP is the runtime interop. LiveSync bridge for Obsidian. REST + SDK for custom tools.

**Q: How does this develop into DIKW-T?**
A: We extend to DIKW-T-R-R (add Retrieval + Representation axes). Each tier has its own storage backend, its own worker, and its own metric. See §2.3.

**Q: How do we improve code quality?**
A: Anti-principles (things to never do) flow into every AI system prompt. Heuristics (context-sensitive preferences) re-rank based on project framework. Principles (abstract values) become session-long constraints. All three are measurable — SQS picks up quality drift and the evolution subsystem decays stale knowledge before it corrupts new code.

---

## 14. Open decisions for the human

Before writing production code, please confirm:

1. **Build path**: Path B confirmed? (research docs recommend Path R first, but the brief explicitly describes Path B.)
2. **LLM providers**: Claude Sonnet 4.6 for Oracle; Qwen3-Coder (DashScope free tier) or Claude Haiku 4.5 for KEA?
3. **Embedding model**: OpenAI `text-embedding-3-small` (1536 dim) — or self-hosted BGE?
4. **Free/paid split**: go with §11.1 default?
5. **Data residency**: EU + US from day 1, or US-only for MVP?
6. **Open-source scope**: MCP server + skill format under Apache 2, rest proprietary?
7. **Community moderation**: automated + usage-threshold gate, or also human review?

Mark any of these changed and we update the blueprint. Everything downstream (schema, infra, pricing UI) flows from these decisions.
