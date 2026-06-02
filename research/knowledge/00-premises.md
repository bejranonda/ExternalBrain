# Foundational Premises — What Is Knowledge in AI-Assisted Coding?
*Second-pass deep rethink | Opus 4.7*

---

## Why This Document Exists

Before designing a learning system, I need to be honest about what "knowledge" actually *is* in this domain, what it *isn't*, and what common misconceptions are baked into most attempts. The first-pass analysis treated knowledge as an obvious concept. It isn't.

These six premises reframe everything downstream. If the premises are wrong, the architecture is wrong.

---

## Premise 1: Knowledge in Coding Is Procedural, Not Factual

**Common misconception:** "The Brain stores facts about the user."

**Reality:** What we call "knowledge" in coding contexts is almost entirely **procedural and relational**: "When this user asks for X in context Y, the successful approach was Z." Factual knowledge ("user is named Alice") is trivial and uninteresting. The valuable knowledge is the *conditional rule*.

**Implication:** Storage formats that treat knowledge as flat records (a markdown file, a database row) lose the conditional structure. A richer representation is: `when(context) → use(approach)`. The current `LearningPattern.description` field (free text) loses this conditional structure and is why retrieval is weak.

---

## Premise 2: All Knowledge Extraction Is Lossy Compression

**Common misconception:** "If we extract more carefully, we capture more of what happened."

**Reality:** Every extraction step discards information. A session is tens of thousands of tokens. A pattern is tens of words. A prompt injection fragment is hundreds of characters. The compression ratio from session to injected knowledge is easily 100:1 or 1000:1.

**Implication:** The question is not "can we extract more?" (always yes — but it becomes noise). The question is **"which information is worth preserving for future retrieval, given that we'll lose 99% of it?"** This reframes the design problem: extraction is a *prioritization* problem, not a *capture* problem.

Candidates for the "must preserve" list:
- What specifically failed and why (higher info value than what succeeded)
- What was rejected by the user (strong preference signal)
- What was changed after being written (indicates local uncertainty)
- The handful of decisions that differentiate this session from a generic template

---

## Premise 3: Retrieval Matters More Than Storage

**Common misconception:** "If we capture more data, the AI will learn more."

**Reality:** Capturing is easy; retrieving the right knowledge at the right moment is hard. A system that captures 10 patterns perfectly but retrieves the wrong one at injection time is no better than a system with no knowledge at all. A system with 10 noisy patterns but excellent retrieval can still be highly useful.

**Implication:** The most valuable engineering work is on the **retrieval side**, not the extraction side. Specifically:
- Semantic similarity (embeddings, vector search) beats keyword matching
- Hybrid retrieval (semantic + metadata filters + recency) beats single-signal retrieval
- Relevance ranking beats fixed top-N thresholds
- Context-aware retrieval beats context-free retrieval

This is exactly the modern RAG problem. Autobahn today has no vector retrieval at all — this is the single biggest gap.

---

## Premise 4: Knowledge Is a Graph, Not a List

**Common misconception:** "Knowledge items are independent records."

**Reality:** Patterns relate to each other. "Use React hooks" connects to "avoid class components" connects to "prefer functional composition" connects to "useEffect cleanup" connects to "React 19 use hook". A flat list of patterns hides these relationships; a graph exposes them.

**Implication:** A graph representation enables:
- **Transitive reasoning:** If pattern A implies B and B implies C, injecting A is equivalent to injecting A+B+C
- **Consolidation:** Multiple specific patterns can fold into a general principle
- **Contradiction detection:** If pattern A and pattern B conflict, the system should know
- **Substitution:** When pattern A becomes obsolete, the graph shows what replaces it

Autobahn's current storage is all flat tables. No graph exists. This is an opportunity, not just a gap.

---

## Premise 5: The User's Model of the AI's Knowledge Matters as Much as the Knowledge Itself

**Common misconception:** "Improving the AI's behavior improves the user experience."

**Reality:** There's a third party: the user's *mental model of what the AI knows about them*. If the user believes the AI has learned nothing, they won't trust it even when it performs well. If the user believes the AI has learned the wrong things, they will work around it or leave.

**Implication:** Product UX is not cosmetic — it's a direct input to the learning loop. Specifically:
- The dashboard must show real data (not mocks), because it is how the user verifies the Brain
- The user must be able to correct the AI's beliefs about them
- The AI should occasionally *show* what it thinks it knows ("I believe you prefer X — correct me?")

The current dashboard has mock timeline and mock file browser data. This undermines trust and makes every other improvement feel fake.

---

## Premise 6: There Is No Generic "User Knowledge" — Only Context-Scoped Knowledge

**Common misconception:** "What I learn about this user applies to all their projects."

**Reality:** Knowledge is bundled with *scope*. "This user prefers TypeScript" is global (user-level). "This project uses a custom design system" is local (project-level). "In debugging mode, this user wants concise outputs" is contextual (session-state-level). Applying project-level knowledge globally is wrong. Applying session-level state as a permanent preference is wrong.

**Implication:** Every knowledge item should have an explicit **scope** field:
- `global` — applies to all the user's work (e.g., coding style)
- `user` — applies across this user's projects (e.g., preferred framework)
- `project` — applies only within this project (e.g., architectural decisions for this codebase)
- `session-context` — applies during a specific mode (e.g., "while debugging")
- `community` — anonymized pattern observed across users (opt-in)

The current schema lacks scope explicitly. `LearningPattern` and `Skill` default to user-scope, which leaks project-specific knowledge into all projects and misses opportunities for community-level wisdom.

---

## The Implications, Taken Together

Given these six premises, the Brain's target architecture should:

1. **Store knowledge as structured conditional rules**, not free-text descriptions (Premise 1)
2. **Prioritize what to preserve** aggressively, accepting information loss by design (Premise 2)
3. **Invest primarily in retrieval quality** — semantic search, hybrid ranking (Premise 3)
4. **Represent relationships between knowledge items** — a graph, not a flat list (Premise 4)
5. **Expose what the AI thinks it knows** to the user, editably (Premise 5)
6. **Scope every knowledge item** explicitly — global/user/project/session/community (Premise 6)

Autobahn's current system is weakest on (1), (3), and (6), strongest on (5) in scaffolding but not in execution. The roadmap in Document 04 reflects this prioritization.

---

## Anti-Premises — Ideas to Explicitly Reject

1. **"More data = smarter AI."** False. More relevant, retrievable, structured data = smarter AI. More raw data = noisier AI.

2. **"The AI should know everything about the user."** Wrong goal. The AI should know the *load-bearing* things — the decisions that differentiate this user from a generic user.

3. **"Learning is automatic background activity."** False. The best learning signals are explicit: user accepts/rejects, user thumbs-up/down, user corrects a generated file. The background auto-recording is noisier than the explicit signals.

4. **"The Brain is measured by how much it has stored."** Wrong metric. The Brain is measured by **how much the user's sessions improve over time**. A Brain that has 10K patterns but doesn't improve session quality is worthless. A Brain with 20 well-used patterns that measurably improves session quality is valuable.

5. **"Community sharing is just copying skill files."** Naive. Community sharing has adversarial concerns (poisoned skills), quality concerns (one user's pattern is noise for another), and privacy concerns. A trivial copy mechanism creates a broken system.

6. **"If it's in the prompt, the AI will use it."** False. LLMs don't always follow instructions consistently. Injected knowledge needs to be structured for the LLM to actually *use*, not just *see*. This is a prompt engineering problem, not just a data retrieval problem.
