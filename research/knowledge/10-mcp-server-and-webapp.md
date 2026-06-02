# MCP Server + Webapp Design
*Third pass: Opus 4.7 | The Experience Layer*

---

## 1. The Two Surfaces

The platform has two primary user-facing surfaces, both sitting on the same Intelligence Layer:

**MCP Server — for AI agents.**
Any AI coding tool (Claude Code, Cursor, Windsurf, custom agents) can connect and query the user's Brain. This is how the knowledge becomes portable across tools.

**Webapp — for humans.**
Dashboard, chat, skills browser, settings. Built with Next.js. Uses the same internal APIs as the MCP server.

Both are clients. Neither has privileged access. The Brain itself is the product.

---

## 2. MCP Server Design

### 2.1 What It Is

A Model Context Protocol server that exposes the user's Brain as a set of callable tools. When an AI agent (like Claude Code) is working on a coding task, it can call these tools to:

- Query relevant knowledge before generating code
- Report outcomes back
- Ask the Brain's Oracle questions
- Teach new knowledge explicitly

### 2.2 Authentication

Each user generates an MCP token in the webapp. They configure their AI tool (Claude Code's `mcp.json`, Cursor's MCP settings, etc.) with this token. All MCP calls are authenticated per user.

Teams can generate team-scoped tokens for shared knowledge access. Enterprise can use SSO-integrated tokens.

### 2.3 The Tools Exposed

**Core retrieval tools:**

```json
{
  "name": "brain_retrieve_knowledge",
  "description": "Retrieve knowledge relevant to a coding task. Call this BEFORE generating code to ensure consistency with the user's preferences and past successful patterns.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "prompt": { "type": "string", "description": "The user's coding request" },
      "context": {
        "type": "object",
        "properties": {
          "projectId": { "type": "string" },
          "framework": { "type": "string" },
          "language": { "type": "string" },
          "sessionMode": { "enum": ["building", "debugging", "refactoring"] }
        }
      },
      "maxItems": { "type": "integer", "default": 10 }
    }
  }
}
```

Returns a structured knowledge bundle: reflexes, recipes, heuristics, principles, anti-principles — each with confidence and source.

```json
{
  "name": "brain_get_user_style",
  "description": "Get the user's coding style preferences (indentation, quotes, naming, framework defaults).",
  "inputSchema": { "type": "object", "properties": {} }
}
```

Returns `UserStyleProfile` data — useful for scaffolding to match user conventions from the first file.

```json
{
  "name": "brain_find_skill",
  "description": "Find a skill (reusable recipe) that matches the current task. Returns the best match above confidence threshold, or nothing if no good match.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "taskDescription": { "type": "string" },
      "framework": { "type": "string" }
    }
  }
}
```

**Outcome reporting tools:**

```json
{
  "name": "brain_report_session_outcome",
  "description": "Report the outcome of a coding session after completion. Call this after the user accepts/rejects generated code.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "sessionId": { "type": "string" },
      "success": { "type": "boolean" },
      "filesCreated": { "type": "array", "items": { "type": "string" } },
      "filesModified": { "type": "array", "items": { "type": "string" } },
      "filesRejected": { "type": "array", "items": { "type": "string" } },
      "knowledgeUsed": { "type": "array", "items": { "type": "string" } },
      "buildAttempts": { "type": "integer" },
      "errors": { "type": "array", "items": { "type": "string" } }
    }
  }
}
```

This is how the feedback loop closes. When an AI agent reports a successful session, the knowledge used in that session has its confidence incremented.

**Teaching tools:**

```json
{
  "name": "brain_teach_knowledge",
  "description": "Record a piece of knowledge the user explicitly taught. Use when the user says 'remember that I prefer X' or similar.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "type": { "enum": ["reflex", "recipe", "heuristic", "principle", "anti_principle"] },
      "trigger": { "type": "string" },
      "rule": { "type": "string" },
      "rationale": { "type": "string" },
      "scope": { "enum": ["personal", "project"], "default": "personal" }
    }
  }
}
```

Explicit teaching produces high-confidence (1.0) knowledge.

**Oracle tools:**

```json
{
  "name": "brain_ask_oracle",
  "description": "Ask a natural-language question about the user's Brain. Useful when the user asks 'how did I solve X before' or 'what do I usually do for Y'.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "question": { "type": "string" }
    }
  }
}
```

The AI agent can delegate to the Brain's Oracle — a useful pattern when the user asks retrospective questions.

**Session tools:**

```json
{
  "name": "brain_start_session",
  "description": "Declare the start of a coding session. Returns a sessionId to use in subsequent calls.",
  "inputSchema": { ... }
}

{
  "name": "brain_log_event",
  "description": "Log an event during a session (tool use, file edit, error, user interaction). Events feed the knowledge extraction pipeline.",
  "inputSchema": { ... }
}
```

### 2.4 Resources (MCP Pattern)

In addition to tools, the MCP server exposes **resources** (read-only data the AI can load):

- `brain://user/style-profile` — compact markdown of user's coding style
- `brain://user/active-skills` — top-10 most-used skills, with content
- `brain://user/anti-principles` — list of things to avoid
- `brain://project/{projectId}/context` — project-specific knowledge
- `brain://team/{teamId}/conventions` — team-level conventions (if user is in a team)

The AI agent can include these in its context at session start without tool calls.

### 2.5 Protocol Details

- **Transport:** stdio (for local clients like Claude Code) + HTTP/SSE (for web-based clients)
- **Versioning:** Semantic versioning in server capabilities; clients negotiate
- **Rate limiting:** Per-token, to prevent runaway queries
- **Telemetry:** Every tool call logged (anonymized) for improving tool design

### 2.6 MCP Server Is the AI's Knowledge API

The critical insight: **any AI tool becomes Brain-aware by installing our MCP server.** The user's knowledge follows them across tools. This is the portability story made real.

---

## 3. Webapp Design

The webapp is a Next.js app with seven top-level areas:

### 3.1 Dashboard — Home Base

The primary landing page after login.

**Sections (scroll order):**

1. **Your Brain Right Now**
   - Vibe Score (0-100, with trend arrow)
   - Knowledge counts by type (reflex, recipe, heuristic, principle, anti-principle)
   - "Since last week:" delta ("+3 new skills, +12 patterns, +4 anti-principles")

2. **Recent Sessions**
   - Last 10 sessions, across all tools (vibe-coding, Claude Code, Cursor, etc.)
   - Each shows: time, client, outcome, SQS score, knowledge applied
   - Click to replay with knowledge overlay

3. **What Your Brain Is Learning**
   - Top knowledge items added this week
   - User can confirm, edit, or delete directly

4. **What I Believe About You**
   - The "user-visible belief model" (from premise 5)
   - Grouped by confidence: strong / medium / learning
   - User can correct or delete any belief

5. **Improvement Suggestions**
   - System-generated suggestions: "I have 12 similar patterns — consolidate?" / "3 knowledge items contradict — resolve?"

### 3.2 Oracle — Chat with Your Brain

See doc 12 for full design.

Left panel: chat history (sessions with the Oracle).  
Main panel: current chat.  
Right panel: citations — the knowledge items the Oracle used in its answer.

### 3.3 Skills — Browse, Edit, Share, Export

**Tabs:**
- **My Skills** — all skills in personal vault
- **Team Skills** — if user is in a team
- **Community** — browse and import community skills

**Per-skill view:**
- Details: trigger, recipe, key decisions, file structure, dependencies
- Usage: times used, success rate, last used
- Versions: history of this skill
- Similar: skills related via graph edges
- Actions: edit, publish to community, promote to team, delete, export

**Export dropdown:**
- Copy as markdown
- Copy as Claude Code command (`.claude/commands/...`)
- Copy as Cursor rules (`.cursorrules` snippet)
- Copy as Windsurf rules
- Copy as AGENTS.md snippet
- Download as JSON
- Download as zip (skill + metadata + file templates)

### 3.4 Knowledge Explorer — The Full Graph

A more advanced UI for power users.

**Features:**
- Filter by type, scope, framework, confidence, recency
- Search by text or semantic similarity
- Graph view: visualize relations (optional, toggleable)
- Bulk operations: select 10 items, edit tags, promote to team, archive
- Import: paste markdown, upload .cursorrules file, link git repo to extract patterns

### 3.5 Sessions — Replay and Inspect

Per-session view:
- Full transcript / event log
- Knowledge injected at session start (with confidence)
- Knowledge extracted at session end (with KEA confidence)
- Outcome (SQS, user feedback)
- Files created/modified/rejected
- Ability to manually add knowledge from this session ("this was a great pattern, save it")

### 3.6 Teams — Shared Knowledge

If user is in a team:
- Team Brain with its own knowledge items
- Team members view: who's in the team, their roles
- Team skills vs. personal skills toggle
- Promote personal knowledge to team (explicit action, with confirmation)
- Team activity: who taught what, when

### 3.7 Settings

**Account:** profile, email, password  
**Billing:** plan, usage  
**MCP Tokens:** generate / revoke MCP access tokens; show config snippets for Claude Code, Cursor, etc.  
**Integrations:** connect GitHub, Slack, IDE plugins  
**Privacy:** data export (GDPR), data deletion, community publishing settings  
**Appearance:** theme, language, notifications  
**Advanced:** feature flags, experiment opt-in

---

## 4. Navigation and IA

```
Top bar:
  [Logo] [Home] [Skills] [Oracle] [Sessions] [Teams] [Settings] [User menu]

Left sidebar (context-sensitive):
  - On Home: recent sessions, quick actions
  - On Skills: framework filter, type filter
  - On Oracle: chat history
  - On Sessions: date range, project filter
  - On Teams: team selector

Main panel: the current view

Right panel (optional, context-sensitive):
  - On Home: suggestions
  - On Oracle: citations
  - On Sessions: knowledge applied
```

Desktop-primary design with responsive fallback. Most knowledge work happens on desktop.

---

## 5. Key UX Flows

### 5.1 Onboarding (New User)

```
1. Sign up → email verify
2. Brief 3-question survey:
   - Primary language (TypeScript / Python / Go / Other)
   - Preferred framework (if applicable)
   - How do you usually use AI for coding? (building / debugging / learning)
3. "Install MCP server?" — walkthrough for Claude Code / Cursor / etc.
4. "Or try our vibe-coding workspace" — alternative entry
5. First session starts; high-sensitivity KEA captures more than default
6. After first session, dashboard shows what was learned
```

Total time to first value: under 5 minutes.

### 5.2 Returning User Session (Via Claude Code)

```
1. User opens Claude Code in their project
2. Claude Code (via MCP) calls brain_retrieve_knowledge(prompt, context) at session start
3. Brain returns knowledge bundle
4. Claude Code incorporates into its system prompt
5. Session proceeds; Claude Code calls brain_log_event for key events
6. At session end, Claude Code calls brain_report_session_outcome(success, files, ...)
7. Brain runs KEA on session events → new knowledge
8. Next session: better knowledge available
```

The user sees no change in their Claude Code workflow. Under the hood, the Brain is making every session smarter.

### 5.3 Teaching the Brain Explicitly

```
1. User realizes: "I always forget to add X"
2. In webapp: Click "Teach the Brain"
3. Form:
   - Type: [Reflex | Heuristic | Anti-principle | ...]
   - When does this apply? [e.g., "when building forms"]
   - What's the rule? [e.g., "Always add react-hook-form for validation"]
   - Why? [optional rationale]
   - Scope: [Personal | Project | Team]
4. Save → high-confidence knowledge item created
5. Immediately active in next session
```

Alternative: "Teach" tool in the MCP server. User can tell their AI "remember this" and the AI calls brain_teach_knowledge.

### 5.4 Querying the Oracle

```
1. User opens Oracle
2. Types: "How did I solve the CORS issue last month?"
3. Oracle (RAG on knowledge + session events):
   - Retrieves 3 relevant patterns + 1 troubleshooting record
   - Synthesizes answer
   - Cites sources
4. User sees answer with clickable citations
5. Can ask follow-up: "Have I done this in any other projects?"
```

See doc 12 for full Oracle design.

### 5.5 Publishing a Skill to Community

```
1. User has a skill that works well ("React Tailwind dark todo template")
2. Click "Publish to Community"
3. Content review:
   - Preview of what's published (anonymized)
   - Flag any potential leakage (project names, secrets, internal terms)
   - System suggests edits for generality
4. License agreement: CC-BY or similar
5. Publish → enters moderation queue
6. After moderation (automated + optional human review for flagged), goes live
7. User sees download count, ratings, reviews on their skill
```

### 5.6 Migrating from Another Tool

```
1. User has existing .cursorrules file, CLAUDE.md, etc.
2. In webapp: "Import Knowledge"
3. Upload files or paste content
4. System parses and extracts knowledge items (using KEA in import mode)
5. Review screen: proposed knowledge items, user can confirm/edit/reject
6. Confirmed items → personal vault
```

---

## 6. Accessibility and Internationalization

- WCAG 2.1 AA compliance target
- All key flows keyboard navigable
- Screen reader tested
- Language: start with English; add Thai, German, Chinese based on user geography
- Knowledge content is user-generated, so we don't auto-translate; but UI chrome must be localized

---

## 7. Technical Implementation Notes

**Webapp:**
- Next.js 16 with App Router
- Server components for data fetching; client components for interactivity
- tRPC or similar for type-safe API (between webapp and Intelligence Layer)
- Tailwind + shadcn for UI
- Framer Motion for thoughtful micro-interactions (but not excessive)
- Streaming SSR where possible

**MCP Server:**
- TypeScript, runs as a local process (stdio) or hosted (HTTP)
- Uses official MCP SDK
- Shares the same Intelligence Layer codebase as webapp
- Deployable as a Docker container for enterprise self-hosted

**Shared:**
- Monorepo (Turborepo or Nx)
- Shared packages: `@brain/core` (Intelligence Layer), `@brain/types`, `@brain/db`, `@brain/mcp`, `@brain/sdk`
- SDK for custom integrations: `@brain/sdk-js`, `@brain/sdk-python`

---

## 8. Performance Targets

**Webapp:**
- TTI < 2s on 3G
- First Contentful Paint < 1s on 4G
- Page transitions < 500ms

**MCP Server:**
- brain_retrieve_knowledge p50 < 150ms, p99 < 500ms
- brain_ask_oracle p50 < 3s (LLM-bound), p99 < 10s
- Concurrent users supported: 1K+ on modest infrastructure

**Retrieval accuracy (from doc 06):**
- NDCG@5 > 0.7
- Injection use rate > 60%

---

## 9. Three Things the MCP Server Changes

1. **The Brain follows the user, not the tool.** They can switch from Claude Code to Cursor and their Brain comes with them.

2. **The AI has a persistent memory layer.** Without MCP, each AI tool has its own context. With our MCP server, every AI tool shares the user's context.

3. **Third-party integrations become possible.** Any developer can build a tool on top of the Brain. IDE plugins, CI tools, code review bots, mobile apps.

This is the portability insight from the earlier docs made architectural.

---

## 10. Bottom Line

The experience layer is two-surfaced and three-customer:
- **MCP server** serves AI agents
- **Webapp** serves humans  
- **SDK + REST API** serves integrators

All three sit on the same Intelligence Layer. This means feature parity — a capability added to webapp is immediately available via MCP and SDK (or should be).

The design treats AI agents and humans as equally important users. Most current products treat AI as an implementation detail; here, AI is a first-class client with its own protocol (MCP).
