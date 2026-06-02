# Chat with Your Brain — The Oracle Interface
*Third pass: Opus 4.7 | Natural-language queries over the user's knowledge*

---

## 1. What the Oracle Is

A dedicated conversational interface where users can ask their Brain natural-language questions and get answers grounded in their own knowledge, sessions, and preferences.

**Distinct from vibe-coding chat.** Vibe-coding is action-oriented ("build me X"). Oracle is **query-oriented** ("what do I know about X?"). They are related but fundamentally different modes.

**Example queries:**
- "How did I solve the CORS issue last month?"
- "What do I usually use for form validation?"
- "Show me my anti-principles about testing"
- "Which projects have I built with Supabase?"
- "What's my pattern for auth in Next.js?"
- "Am I consistent about naming conventions?"
- "What have I learned about TypeScript strict mode?"
- "Compare how I handled state in Project A vs. Project B"

The Oracle answers these by retrieving and synthesizing from the user's own data.

---

## 2. Why It Matters

### 2.1 Transforms Passive Brain Into Active Collaborator

Today, the Brain is a background system that silently injects knowledge into AI prompts. Users can't inspect, query, or converse with it directly. The Oracle makes the Brain **conversational** — an AI that knows *you* specifically and can answer questions about *your* patterns.

### 2.2 Closes the User-Model-Sync Loop

From doc 00 premise 5: users need to know what the Brain knows about them. The Oracle is the primary interface for this. It answers "what do you think about my coding style?" with explicit evidence.

### 2.3 Competes on Knowledge, Not Just Code Generation

Most AI coding tools compete on code generation quality. The Oracle gives our platform a unique differentiator: it has *your* context, not just training data.

### 2.4 A Gateway to Knowledge Curation

When users chat with the Oracle and notice mistakes ("no, that's not right"), they can correct in the chat. This flows directly into knowledge updates.

---

## 3. Architecture

The Oracle is a RAG system over a richly-typed knowledge store. The retrieval is the same KRA used by the MCP server; the generation is an LLM synthesis step.

```
User question
    │
    ▼
[Query understanding]
    Classify query type:
      - factual ("what do I usually do for X?")
      - retrospective ("how did I solve Y?")
      - synthesis ("compare my approaches")
      - introspective ("what do you think about my coding?")
    │
    ▼
[Retrieval: KRA]
    Semantic + metadata + graph expansion
    Returns: relevant knowledge items + supporting sessions
    │
    ▼
[LLM synthesis]
    Given retrieved context + question,
    generate grounded answer.
    Must cite sources.
    │
    ▼
[Post-processing]
    Parse citations, link back to knowledge items
    │
    ▼
Answer + citations (clickable)
```

### 3.1 Query Classification

Different query types need different retrieval and prompt strategies.

**Factual queries** ("what do I usually do?"): retrieve top-5 most relevant knowledge items by semantic similarity. Simple synthesis.

**Retrospective queries** ("how did I solve X?"): search both knowledge items AND session events. Include session outcomes in context.

**Synthesis queries** ("compare A vs. B"): retrieve comprehensively for both topics, prompt for comparison.

**Introspective queries** ("what do you think about my coding?"): retrieve across user's entire Brain, use summary-style prompts.

### 3.2 Retrieval Strategy

Different from KRA-for-injection:
- **More items retrieved** (top-20 vs. top-5) — chat can present more context
- **More diverse** (avoid clustering on one pattern type)
- **Includes provenance** (cite source sessions)
- **Less scope-filtered** (user is asking, so fewer restrictions)

### 3.3 LLM Synthesis

**Model choice:** Claude Sonnet or GPT-4 equivalent. Quality matters here — the Oracle is user-facing and needs to feel smart.

**Prompt structure:**

```
You are the user's coding Brain Oracle. You answer questions using ONLY
the user's own knowledge and session history provided below.

When answering:
- Cite sources using [^N] markers, linking to knowledge items by ID
- If you don't have enough context, say so — don't hallucinate
- Be specific: use actual numbers, names, dates from the retrieved data
- Distinguish high-confidence from low-confidence knowledge

USER'S QUESTION: {question}

RELEVANT KNOWLEDGE:
[1] type: reflex, confidence: 0.95
    "Always use 2-space indentation"
    Source: 47 sessions, last confirmed 3 days ago

[2] type: heuristic, confidence: 0.78
    "For complex forms, use react-hook-form"
    Source: 12 sessions, extracted from project "saas-dashboard"

[3] type: anti-principle, confidence: 0.85
    "Don't use any in TypeScript — always specify or use unknown"
    Source: rejected 8 times in feedback, last on 2026-04-15

...

RELEVANT SESSION SUMMARIES:
[S1] 2026-04-15 — "Add auth to my app"
     Framework: Next.js, duration: 12min, SQS: 89
     Resolution: Implemented NextAuth with Google OAuth, JWT tokens

...

ANSWER (with citations):
```

### 3.4 Response Format

Oracle responses are structured:

```typescript
interface OracleResponse {
  answer: string;                  // markdown with [^N] citations
  citations: Array<{
    id: string;                     // knowledge item or session ID
    type: 'knowledge' | 'session';
    preview: string;                // short description
    confidence?: number;
    link: string;                   // webapp URL
  }>;
  confidence: 'high' | 'medium' | 'low';
  relatedQuestions: string[];      // suggested follow-ups
}
```

UI shows citations as clickable chips below the answer.

---

## 4. UX Design

### 4.1 Layout

```
┌──────────────────────────────────────────────────────┐
│  Oracle                           [Settings] [Share] │
├──────────┬──────────────────────────────────┬────────┤
│          │                                  │        │
│ Sessions │    Chat area                     │Citations│
│          │                                  │        │
│ (recent) │    User: "What do I..."          │ [1] Ref│
│          │                                  │ [2] Pat│
│          │    Oracle: "Looking at your 47   │ [3] Ses│
│          │    sessions with auth... You     │        │
│          │    usually... [^1] ... [^2]"     │        │
│          │                                  │        │
│          │    [Input box________]   [Send]  │        │
│          │                                  │        │
└──────────┴──────────────────────────────────┴────────┘
```

### 4.2 Conversation Persistence

- Every chat is saved as a session (with `client_type: oracle`)
- Users can return to past conversations
- Conversations searchable

### 4.3 Multi-Turn Context

Follow-ups use previous turn's retrieved knowledge + new retrieval:
- "What do I usually use for forms?" → answer
- "Any exceptions to that?" → Oracle knows "that" refers to forms

### 4.4 Rich Input

Users can include context:
- Paste a code snippet: "Is this consistent with my style?"
- Attach a file from current project
- Reference a specific session: "@session-abc123 — what happened here?"

### 4.5 Response Interactions

User can:
- Click citation → jump to knowledge item or session
- Click "Correct" on any citation → "this is wrong" → triggers knowledge update workflow
- "Explain more about [citation]" → Oracle elaborates
- Thumbs up / down on the whole answer — feeds evaluation

---

## 5. Query Types in Detail

### 5.1 "What do I usually do for X?"

```
User: "What do I usually do for authentication?"

Oracle: "Based on your last 8 projects with auth, here's your typical approach:

• You use NextAuth.js in 7 of 8 projects [^1]
• You prefer JWT with httpOnly cookies (never localStorage) [^2]
• You add Google OAuth first, then add email/password [^3]
• For database adapters, you've used Prisma consistently [^4]

The one exception was 'legacy-app' where you used Passport.js for compatibility. [^5]

Your most recent auth implementation (2026-04-15) took 12 minutes with 
100% file acceptance, which is your fastest. [^6]"

Citations:
[^1] Heuristic: "Use NextAuth for Next.js auth" (confidence 0.88)
[^2] Anti-principle: "Don't store JWT in localStorage"
[^3] Recipe: "OAuth-first signup flow"
[^4] Pattern: "Prisma adapter for NextAuth"
[^5] Session: 2025-09-12 "legacy-app migration"
[^6] Session: 2026-04-15 "Add auth to my app"
```

### 5.2 "How did I solve X?"

```
User: "How did I solve the CORS issue last month?"

Oracle: "You hit a CORS issue on March 18 in your 'api-gateway' project. [^1]
The error was: 'Access to fetch at X from origin Y has been blocked by CORS policy'.

You solved it by:
1. Adding explicit CORS middleware in the Express app [^2]
2. Setting allowed origins from an env variable instead of hardcoding
3. Adding the preflight OPTIONS handler

The fix took 2 build iterations (about 8 minutes total). 

You've extracted this as a troubleshooting record [^3], so if you hit a similar
issue again, I'll suggest this solution automatically."

Citations:
[^1] Session: 2026-03-18 "api-gateway CORS error"
[^2] Troubleshooting: "CORS blocked in Express"
[^3] Pattern (debugging): "Express CORS setup"
```

### 5.3 "Compare A vs. B"

```
User: "Compare my approach to state management in my dashboard vs. todo apps"

Oracle: "Interesting comparison — they diverge clearly:

**Dashboard projects (3):** [^1][^2][^3]
- You use Zustand in all 3
- State slices organized by feature (auth, user, ui)
- Persist middleware for user preferences

**Todo apps (5):** [^4][^5][^6][^7][^8]
- 4 of 5 use just React useState (simple enough)
- 1 uses Zustand (the one with offline sync)

Your pattern seems to be: local state for simple lists, Zustand when state
is shared across >2 components or needs persistence. This matches your
principle [^9]: 'don't reach for state libraries until you need them'."

Citations:
[^1-3] Dashboard sessions
[^4-8] Todo app sessions
[^9] Principle: "Don't over-engineer state management"
```

### 5.4 "What do you think about my X?"

```
User: "What do you think about my testing practices?"

Oracle: "Looking at your last 20 sessions with test files... I notice some patterns:

**What's consistent:**
- You use Vitest for frontend, Jest for Node [^1]
- You co-locate tests with source (`foo.ts` + `foo.test.ts`) [^2]
- You prefer testing-library over Enzyme [^3]

**What's inconsistent:**
- Test coverage varies wildly — 3 recent projects have no tests [^4][^5][^6]
- You rarely mock external services (some projects do, others don't)

**What I'm unsure about:**
- Your preference for unit vs. integration ratio — I don't have enough signal yet

Based on this, I can confidently apply your testing conventions, but for
coverage expectations I'd need more data or explicit teaching."
```

Note the **calibrated uncertainty** — the Oracle is explicit about what it knows, what's mixed, and what it doesn't know. This builds trust.

---

## 6. Oracle as Knowledge Curation Interface

A critical underappreciated use: **the Oracle is where users curate their Brain.**

Chat interactions naturally surface:
- Incorrect beliefs ("no, I don't do that anymore")
- Outdated patterns ("I used to, but now I use X")
- Missing context ("there's a reason I do this in this one project")

Each becomes a knowledge edit opportunity:

```
Oracle: "You usually use Redux for complex state."

User: "No, I switched to Zustand 6 months ago."

Oracle: "Good to know — let me update. [Updates knowledge: promotes Zustand
as preferred, demotes Redux to 'legacy-only']. I'll also look for Redux
references in older patterns and mark them as outdated. Done."
```

This is **conversational curation**. Lower-friction than any dashboard edit.

---

## 7. Implementation Notes

### 7.1 LLM Selection

- Use a capable model: Claude Sonnet 4.6 or equivalent
- Cost: Oracle queries are more expensive than vibe-coding sessions because of synthesis
- Rate limit: prevent abuse — e.g., 100 queries/day for free tier

### 7.2 Caching

- Cache common queries (per user) with short TTL
- Invalidate when knowledge changes

### 7.3 Latency

- Target p50 < 3s
- Stream the response (SSE) so user sees text arriving
- Retrieval is < 200ms; most latency is LLM generation

### 7.4 Failure Modes

- If retrieval returns nothing: Oracle acknowledges "I don't have enough context yet" rather than hallucinating
- If LLM fails: fallback to cheaper model, explicit error message if both fail
- If user asks something off-topic ("what's the capital of France?"): redirect to "I'm your coding Brain — I can answer questions about your patterns and past work"

---

## 8. Privacy and Data Boundaries

Oracle reveals a lot about a user's Brain. Care is needed.

### 8.1 What the Oracle Can Access

- User's personal vault (all knowledge, sessions)
- Team vaults the user has access to (with clear indication: "from your team knowledge...")
- Community pool (for reference: "the community approach is...")

### 8.2 What the Oracle Cannot Do

- Cross-user leakage: never reveal another user's personal knowledge
- Team leakage: never reveal team knowledge to non-members
- Community leakage: public skills are public; sessions are never public

### 8.3 Chat History Sensitivity

Oracle conversations reveal user's workflow, struggles, preferences.
- Stored encrypted at rest
- User can delete conversations
- Never used for training without explicit opt-in
- Not shared with team members even for team accounts

### 8.4 Enterprise

Enterprise tier may require:
- On-premise Oracle deployment
- No external LLM calls (use self-hosted model)
- Full audit log of every Oracle query

---

## 9. Oracle Features Roadmap

### 9.1 V1 (MVP)
- Basic chat with knowledge retrieval
- Citations clickable
- Conversation history

### 9.2 V2
- Multi-turn context
- Rich input (paste code, attach files)
- Correction workflow in-chat
- Related questions suggestions

### 9.3 V3
- Voice input/output
- Proactive Oracle: surfaces insights unprompted ("I noticed you've switched from X to Y — should I update your defaults?")
- Comparison mode: compare two projects, users (with permission), or time periods
- Trend analysis: "show me how my style evolved over the last year"

### 9.4 V4
- Oracle as a team collaboration tool: "Ask the team's Oracle"
- Shared insights: "The team Oracle found: 40% of members use X for Y"
- Enterprise: "Company Oracle" for organizational knowledge

---

## 10. Measurement

How do we know the Oracle is working?

### 10.1 Per-Query Metrics

- User satisfaction (thumbs up/down on answer)
- Citation click rate (indicates answer was grounded and useful)
- Follow-up rate (good Oracle answers spawn follow-up questions)

### 10.2 Aggregate Metrics

- % of users using Oracle weekly
- Mean queries per active user
- Correction rate (answers that users correct → indicates Brain drift)
- Conversion to action (queries that lead to vibe-coding actions)

### 10.3 Target

- Oracle weekly active rate > 30% of MAU (Brain users who engage with it)
- Thumbs-up rate > 70%
- Correction rate < 15% (decreasing over time as Brain improves)

---

## 11. Bottom Line

The Oracle transforms the Brain from an invisible inference layer into a **conversational expert on you**. This:

- Makes the Brain's value legible (users can *see* what the Brain knows)
- Enables knowledge curation through natural dialogue
- Differentiates the platform from generic AI coding tools (they don't know *you*)
- Creates a sticky daily-use interface (beyond just when you're coding)

Build after the core Brain (retrieval + extraction + feedback) is working. The Oracle's quality is gated on the Brain's quality — a noisy Brain produces a hallucinating Oracle. Invest in the foundation first.
