# Skills — Deep Dive Across Every Dimension
*Third pass: Opus 4.7 | The core value objects of the platform*

---

## 1. Why Skills Deserve Their Own Document

A "skill" in this platform is not just a saved file. It's the **canonical unit of transferable, valuable knowledge.** Everything else — patterns, preferences, anti-principles — either feeds into skills or decorates them.

Skills are:
- What users share
- What gets exported to other tools
- What makes the platform compound value over time
- What a mature AI tool ultimately converges toward (recipes, templates, approaches)

This document addresses skills across **every dimension** the user asked about.

---

## 2. The Skill Ontology Refined

From doc 08, we established 5 knowledge categories. Skills are one of them — specifically, **Recipes**. But the common usage of "skill" is broader. To avoid confusion:

### 2.1 Terms and Scope

| Term | Formal type | What it is | Exported? |
|------|-------------|-----------|-----------|
| **Skill** (colloquial) | Recipe | A reusable template for a specific task | Yes |
| **Wisdom Skill** (internal) | Meta-rule | Rules about *how* to extract / retrieve / apply | Rarely |
| **Reflex** | Reflex | Always-applied rule (e.g., "2-space indent") | Yes, as part of style profile |
| **Heuristic** | Heuristic | Context-sensitive guidance | Yes, as patterns |
| **Principle** | Principle | Abstract value | Yes |
| **Anti-principle** | Anti-principle | Thing to avoid | Yes |

**When we say "skill" in this doc, we mean Recipe** unless noted. Internal wisdom skills are addressed in Section 9.

### 2.2 Anatomy of a Skill (Recipe)

```typescript
interface Skill {
  // Identity
  id: string;
  version: string;          // "1.2.0" — semantic versioning
  name: string;             // "React Tailwind Dark Todo"
  slug: string;             // url-safe
  description: string;      // one-sentence summary
  
  // Classification
  category: SkillCategory;  // 'fullstack' | 'frontend' | 'backend' | 'cli' | ...
  tags: string[];
  framework: string;
  language: string;
  
  // The skill content (what makes it reusable)
  triggers: string[];       // phrases that should activate this skill
  context: string;          // "when building a small persistent todo/list app"
  
  // The recipe
  keyDecisions: KeyDecision[];
  fileStructure: FileTemplate[];
  dependencies: Dependency[];
  scripts: Script[];
  environmentVars: EnvVar[];
  
  // Composition
  parentSkillIds: string[]; // composed from other skills
  childSkillIds: string[];  // skills that extend this
  
  // Quality
  confidence: number;
  usageStats: {
    totalUses: number;
    successRate: number;
    avgTimeToComplete: number;
    lastUsed: Date;
  };
  
  // Scope
  scope: 'personal' | 'team' | 'community';
  ownerUserId?: string;
  ownerTeamId?: string;
  
  // Lifecycle
  createdAt: Date;
  updatedAt: Date;
  deprecated: boolean;
  supercededById?: string;
  
  // Provenance
  extractedFromSessionIds: string[];
  importedFrom?: string;    // 'claude-code' | 'cursor' | etc.
  author: string;
  
  // Relations
  relatedSkillIds: string[];
  conflictsWithSkillIds: string[];
  
  // Testing (Section 7)
  tests?: SkillTest[];
  
  // Embeddings for retrieval
  embedding: number[];
}

interface KeyDecision {
  question: string;         // "Which state management?"
  answer: string;           // "useState — overkill to add Redux"
  rationale: string;
  alternatives?: string[];
}

interface FileTemplate {
  path: string;             // "src/App.tsx"
  purpose: string;
  template: string;         // Handlebars-like, with ${variables}
  language: string;
}

interface Dependency {
  name: string;
  version: string;
  type: 'prod' | 'dev' | 'peer';
  why: string;              // "for form validation"
}

interface Script {
  name: string;             // "dev", "build", "test"
  command: string;
}
```

**Notice:** A skill is richly structured, not just a markdown file. Markdown is one *export format*; internal storage is typed.

---

## 3. Skill Lifecycle

```
[1] CREATION
    ├── Auto-extracted from successful session (KEA identifies recipe)
    ├── Manually created by user
    ├── Imported from CLAUDE.md / .cursorrules / etc.
    ├── Forked from community
    └── Composed from existing skills

[2] APPLICATION
    Skill matched to user prompt (by KRA)
    Injected into AI context
    AI uses skill during session
    Session reports outcome

[3] MEASUREMENT
    Success → increment usageStats.successRate
    Failure → decrement confidence
    User rating → adjust

[4] EVOLUTION
    Iteration → create new version
    Specialization → create child skill
    Consolidation → merge with similar
    Promotion → personal → team → community

[5] GOVERNANCE
    Low-confidence + unused → auto-archive
    User can manually edit, delete, restore
    Team admin can deprecate team skills
    Community moderator can flag/remove

[6] EXPORT
    Generate markdown, .cursorrules, CLAUDE.md, JSON, zip
    User can download or share URL

[7] DEPRECATION
    Mark as deprecated, suggest alternative
    Retention: kept indefinitely for provenance
    Optionally hidden from default views
```

Every stage has specific operations and triggers.

---

## 4. Skill Composition

Skills are **composable**. A large skill can be assembled from smaller ones:

```
"React Full SaaS Starter"
    ├── "React Vite Base" (child)
    ├── "Tailwind Dark Theme" (child)
    ├── "NextAuth OAuth Setup" (child)
    ├── "Prisma Postgres Schema" (child)
    └── "Stripe Subscription Flow" (child)
```

### 4.1 Why Composition Matters

- **Modularity:** Update "NextAuth OAuth Setup" once, all composing skills benefit
- **Quality:** Testing a small skill is easier than testing a monolithic one
- **Reuse:** The same "Tailwind Dark Theme" feeds dozens of parent skills
- **Clarity:** Users understand "these are the 5 parts of this build"

### 4.2 How Composition Works

At skill application time:
1. KRA matches the parent skill
2. System recursively resolves child skills
3. Merged into a single augmented prompt
4. Child skill order matters — dependencies first, then feature skills

Conflict resolution:
- If two children both define `src/App.tsx`, the parent specifies which wins, or user chooses
- If two children conflict semantically (e.g., "use Zustand" + "use Redux"), flag as incompatibility

### 4.3 Composition Metadata

```typescript
interface SkillComposition {
  parentId: string;
  children: Array<{
    childId: string;
    order: number;          // application order
    required: boolean;      // is this child required or optional?
    conflictResolution?: 'parent_wins' | 'child_wins' | 'prompt_user';
  }>;
}
```

---

## 5. Skill Versioning

Skills evolve. Versioning is git-like but simpler.

### 5.1 Semantic Versioning

```
1.2.0
│ │ │
│ │ └─ PATCH: bug fix, minor text change, no API change
│ └─── MINOR: new optional capability, backward compatible
└───── MAJOR: breaking change to structure or behavior
```

### 5.2 Version Events

- **Skill updated in place** → patch bump (`1.2.0 → 1.2.1`)
- **New file added to template** → minor bump (`1.2.0 → 1.3.0`)
- **Framework changed** → major bump (`1.2.0 → 2.0.0`) — practically, create a new skill
- **User explicitly saves new version** → user-chosen bump

### 5.3 Version Storage

Option A: Separate rows per version (more storage, cleaner queries)
Option B: JSONB column with version history (compact, more complex queries)

**Recommendation: Option A with `parentSkillId` linking versions.** Enables:
- `SELECT * FROM Skill WHERE slug = 'react-todo' ORDER BY version DESC LIMIT 1` — get latest
- Full history visible in UI
- Rollback is just "use this version instead"

### 5.4 Which Version Gets Retrieved

By default, retrieve latest stable version. User can pin a specific version in their context.

Community skills: users see latest version by default, can browse history.

---

## 6. Skill Sharing

Three scopes; three sharing mechanisms.

### 6.1 Personal → Team

User has a skill. Their team would benefit.

**Flow:**
1. User clicks "Promote to Team"
2. Review screen: "Share this skill with Team X?"
3. Content check: potential leakage (project names, secrets)
4. Confirm → skill copied to team vault
5. Team members see it immediately
6. Original personal copy remains (it's a copy, not a move)

Team admins can edit, deprecate, or remove team skills.

### 6.2 Team → Community

Team admin decides a team skill is generic enough to share publicly.

**Flow:**
1. Admin clicks "Publish to Community"
2. Anonymization review: strip team/project names, generalize language
3. License agreement (CC-BY)
4. Moderation queue
5. After approval, visible in community

### 6.3 Community → Personal / Team

User browses community, finds a skill they want.

**Flow:**
1. Click "Import"
2. Choose scope: personal or team
3. Skill copied to their vault (with reference to source)
4. User can edit their copy freely — doesn't affect community version

### 6.4 No Auto-Promotion

Knowledge never auto-promotes between scopes. All promotion is explicit user action. This is a **privacy invariant**.

---

## 7. Skill Testing

Skills should be testable. Otherwise, a skill with 87% success rate is a black box.

### 7.1 Skill Tests

```typescript
interface SkillTest {
  name: string;
  description: string;
  type: 'dry_run' | 'build' | 'runtime';
  
  // For dry_run: check that applying the skill produces expected structure
  expectedFiles?: string[];
  expectedDependencies?: string[];
  
  // For build: actually run `npm install && npm run build`
  buildShouldSucceed?: boolean;
  maxBuildTimeMs?: number;
  
  // For runtime: spin up the app and check behavior
  runtimeTests?: Array<{
    command: string;
    expectedOutput?: string;
  }>;
}
```

### 7.2 Test Execution

Sandboxed container (Autobahn already has container isolation — `src/lib/containers/`). When a skill is:
- Published to community
- Updated to a new version
- Scheduled for weekly quality check

Run tests. If tests fail:
- Block publication (for new skills)
- Flag the skill with a quality warning
- Auto-decrement confidence

### 7.3 Test Authoring

Skills extracted by KEA get auto-generated tests:
- If the skill produced files, add `expectedFiles` test
- If the skill had a successful `npm run build`, add `build` test
- Runtime tests are optional, author-provided

Users can edit tests.

---

## 8. Skill Discovery

How does a user find a skill they need?

### 8.1 Search

**Full-text + semantic hybrid:**
- User types query: "todo app with dark mode"
- Search finds skills with matching text, title, triggers
- Re-ranked by semantic similarity
- Filtered by user's framework preferences

### 8.2 Recommendation

On dashboard and chat:
- "Based on your recent sessions, you might want: [Skill A]"
- "Popular this week in React: [Skill B]"
- "Team recommendation (new): [Skill C]"

### 8.3 Browse

Faceted browsing in the Skills Gallery:
- By framework (React, Vue, Next.js, ...)
- By category (frontend, backend, fullstack, ...)
- By tags (dark-theme, mobile-first, a11y-first, ...)
- By popularity, recency, rating, your-usage

### 8.4 Graph Traversal

Given a skill, show related skills:
- "Users who use this also use: [...]"
- "Alternatives to this: [...]"
- "Extends this: [...]"
- "Extended by: [...]"

---

## 9. Internal Wisdom Skills

The meta-layer — skills that improve the Brain itself.

### 9.1 What They Are

Examples:
- Extraction rule: "When a session has >3 build fix iterations, always extract a troubleshooting record"
- Retrieval rule: "When user is in debug mode, boost troubleshooting records by 1.3x"
- Injection rule: "When user has <5 patterns total, inject all; else inject top-5 by match score"
- Evolution rule: "Merge two patterns when semantic similarity >0.9 and same user"

Internal wisdom skills are **configuration for the Intelligence Layer**, stored like skills but with different scope and application.

### 9.2 Storage

```prisma
model InternalWisdomSkill {
  id            String
  name          String
  appliesTo     String    // 'extraction' | 'retrieval' | 'injection' | 'evolution'
  
  ruleType      String    // 'threshold' | 'weight' | 'filter' | 'transform'
  rule          Json      // structured rule definition
  
  scope         String    // 'global' | 'user-tier' | 'team-tier'
  
  effectivenessScore Float  // A/B tested metric
  appliedCount  Int
  successCount  Int
  
  source        String    // 'system-default' | 'user-defined' | 'auto-evolved'
  author        String?
  
  createdAt, updatedAt, lastValidatedAt
}
```

### 9.3 Evolution of Internal Wisdom

Internal wisdom skills A/B test against each other:
- Two extraction rule variants: "min 30 tokens" vs. "min 50 tokens"
- Randomly assign sessions to variant A or B
- After N sessions, compare outcomes (pattern reuse rate, SQS)
- Winner becomes new default; loser archived

**This is the meta-learning loop.** The system learns how to learn better over time.

### 9.4 User-Defined Internal Wisdom

Advanced users (or team admins) can write their own internal wisdom skills:

Example for a team:
- "For our team, always include security audit as a required step when extracting skills from auth-related sessions"

This is powerful for enterprises that want custom knowledge curation policies.

### 9.5 Internal Wisdom Is Rarely Exported

External recipes are meant to be shared. Internal wisdom is tied to the Brain's internals — it's not useful outside. Exception: team-level internal wisdom is shared within the team.

---

## 10. Skill Marketplace Economics

When skills are shared in the community, economic dynamics emerge.

### 10.1 The Problem

- Bad actors publishing malicious skills
- Quality races to bottom if there's no reputation
- No incentive to publish high-quality skills
- Duplicate skills proliferating

### 10.2 Reputation System

Each user has a reputation score based on:
- Skills published
- Skills' aggregate success rate (weighted)
- Upvotes from other users
- Negative: reports for malicious content

Higher reputation → higher visibility for new skills → incentive to publish quality.

### 10.3 Quality Filter

New skills pass through:
1. **Automated scan** — secrets detection, malicious patterns, SSRF code
2. **Threshold gate** — skill must be used by creator in ≥3 sessions successfully before community visibility
3. **Moderation queue** — flagged skills reviewed (automated + optional human for high-impact)
4. **Ongoing monitoring** — skills with rising report rate are auto-demoted

### 10.4 Attribution and License

- Skills published to community are CC-BY licensed by default
- Forks must credit original author
- Original author sees usage stats ("your skill was downloaded 300 times this month")

### 10.5 Optional Monetization (Future)

- Curated "premium skills" collections by trusted authors
- Revenue share with platform
- Free tier: unlimited community skills; Paid: premium
- Not essential for v1

---

## 11. Skill Security

Skills are user-generated content. They include code templates, dependencies, scripts. All of these are risk vectors.

### 11.1 Threat Model

- **Malicious dependencies:** Skill recommends a package that's malware
- **Data exfiltration:** Template includes code that sends data to attacker
- **Supply chain:** Skill references a legitimate package's older vulnerable version
- **Script execution:** Skill's `scripts` field includes dangerous commands

### 11.2 Mitigations

- **Dependency scanning:** All dependencies checked against npm audit / safety db
- **Template analysis:** Static analysis for suspicious patterns (eval, fetch to unknown domains, etc.)
- **Script allowlist:** Scripts must be standard (npm scripts, vite, next, etc.) — unusual commands flagged
- **Sandbox execution:** Skill tests run in isolated containers (Autobahn has this already)
- **User consent:** When applying a community skill, show a summary of what it will do and get explicit OK

### 11.3 Responsible Disclosure

Security issues in community skills:
- Report mechanism in UI
- Automatic quarantine of reported skills pending review
- Affected users notified if they imported a quarantined skill

---

## 12. Skill Export Formats

Skills must flow to other tools. Support at minimum:

### 12.1 Claude Code Format

```markdown
---
description: Build a React Tailwind todo app with dark theme
argument-hint: <project-name>
allowed-tools: ["Read", "Write", "Bash"]
category: fullstack
model: claude-sonnet
---

You are building: React Tailwind Dark Todo App

## File Structure
- src/App.tsx
- src/components/TodoItem.tsx
- tailwind.config.js

## Key Decisions
- ...

## Dependencies
- react, react-dom, vite, tailwindcss

## Implementation
${ARGS && `Project name: ${ARG1}`}
Build the application following the structure above.
```

### 12.2 Cursor / .cursorrules Format

```
# Skill: React Tailwind Dark Todo

## Context
When user asks for a React todo app with persistence...

## Key Decisions
- Use Vite, not CRA
- Use Tailwind with dark mode class strategy
- Use localStorage for persistence

## File Structure
- src/App.tsx
- src/components/TodoItem.tsx

## Code Style
- Functional components with hooks
- Named exports
```

### 12.3 AGENTS.md Format

```markdown
## Known Pattern: React Tailwind Dark Todo

### Triggers
- "build a todo app"
- "persistent list with dark mode"

### Approach
...

### Files
...
```

### 12.4 JSON Export

Full skill data as JSON — for programmatic consumption.

### 12.5 Portable Skill Bundle (Zip)

- `skill.json` — full metadata
- `README.md` — human-readable description
- `templates/` — file templates as raw files
- `tests.json` — test definitions

Download + share via any channel.

### 12.6 MCP Resource

Exposed as `brain://skill/{skill-id}` resource. Any MCP-aware tool can load it.

---

## 13. Skill Provenance and Audit

Every skill traces back to its origin.

### 13.1 Provenance Data

- Source: which sessions produced this skill (auto-extracted)
- Author: the user who created or imported it
- Fork history: if forked from community, original author
- Version history: chain of version IDs
- Application history: sessions that used this skill

### 13.2 UI

Skill detail page shows:
- "Extracted from: 3 sessions (clickable to view)"
- "Latest version: 1.2.1, updated 2 weeks ago"
- "Version history: 1.0.0 → 1.1.0 → 1.2.0 → 1.2.1"
- "Used in 47 sessions, 89% success rate"

### 13.3 For Enterprise

Audit logs: who applied which skills, when, outcomes. Required for compliance.

---

## 14. Per-Project and Per-Personal Distinction

The user explicitly asked about project-level vs. personal-level knowledge. Here's how skills handle it.

### 14.1 Personal Skills

- Stored in user's personal vault
- Apply across all their projects
- Examples: "my preferred React setup", "my auth pattern"

### 14.2 Project Skills

- Associated with a specific project
- Apply only when working on that project
- Examples: "this project's custom design system", "this project's deployment flow"

### 14.3 Project Memory vs. Project Skills

| Concept | Storage | Scope |
|---------|---------|-------|
| Project Memory | PROJECT_MEMORY.md / DB records | Specific decisions, file list, last build status |
| Project Skills | Skill with scope=project | Reusable recipes specific to this project |

Project memory is a kind of context. Project skills are reusable templates.

### 14.4 Cross-Project Promotion

User works in Project A with a skill. Later, working in Project B, they realize the same approach would help. Actions:

1. In Project B, use the Project A skill (cross-project reference)
2. Or promote the skill from project → personal scope
3. Or copy + generalize for both

UI supports all three. Default suggestion: promote if the skill has succeeded in 3+ projects.

---

## 15. Skills for Many Purposes — Summary Matrix

| Aspect | Answer |
|--------|--------|
| **What is a skill?** | A reusable Recipe — structured template for a coding task |
| **How are they created?** | Auto (KEA), manual, imported, forked, composed |
| **How stored?** | Structured DB row + embedding + markdown export |
| **How retrieved?** | KRA semantic matching + metadata filters |
| **How applied?** | Injected into AI system prompt via MCP |
| **How versioned?** | Semantic versioning (major.minor.patch) |
| **How tested?** | Skill tests (dry run, build, runtime) in sandbox |
| **How shared?** | Personal → team → community; explicit promotion only |
| **How discovered?** | Search, recommend, browse, graph traversal |
| **How exported?** | Markdown, Claude Code, Cursor, AGENTS.md, JSON, zip, MCP |
| **How composed?** | Parent-child links; recursive resolution at application time |
| **How governed?** | Scope-based ownership, ACLs, team admin controls |
| **How secured?** | Dep scan, template analysis, sandbox tests, user consent |
| **How monetized?** | (future) premium skills; reputation-weighted visibility |
| **How evolved?** | Versions, confidence feedback, A/B tests, auto-consolidation |
| **Provenance?** | Full source session link, fork history, author attribution |
| **Project vs. personal?** | Explicit scope; promotion is user action |
| **Internal wisdom skills?** | Separate entity, meta-layer, governs extraction/retrieval/injection |

Every dimension is designed. No dimension is afterthought.

---

## 16. Bottom Line

Skills are the platform's core currency. Designed right, they are:

- Structured enough to be reasoned over
- Typed enough to be validated
- Composable enough to scale
- Versioned enough to evolve safely
- Exportable enough to be portable
- Governed enough to be safe
- Discoverable enough to be valuable
- Testable enough to be trusted

This is a mature product category. The implementation requires sustained investment, but each dimension has a known pattern from adjacent domains (package managers, open source ecosystems, content platforms).

The platform's long-term defensibility comes from **the quality of its skill ecosystem** — both quantity and curation. Early investment in skill infrastructure pays compound returns.
