# Brain V2.0 — Meeting & Document Intelligence (2026-07-07)

**Status:** approved design, pending implementation plan
**Audience:** the operator + the agents working this repo
**Build window:** after the Stage-3 flywheel gate reads on 2026-07-17 (issue
#149); protocol/spec work only until then
**Depends on:** flywheel-repair program (2026-07-02 spec) — a healthy loop is
a precondition, not a nice-to-have

---

## 1. Problem statement

The original "V2" brief listed seven expansion areas (meeting intelligence,
PRD/document templates, kanban/PM, ISO/process compliance, admin assistance,
agentic guardrails, Jira/GitHub integration). Grilling reduced it to **two
live pains in the operator's own organization**, observed in the
currently-running project (mostly-English artifacts):

1. **Meetings produce artifacts nobody acts on.** Auto transcripts and
   human-written notes exist, but: nobody reads them, no per-person to-do
   emerges, and there is no decision memory — a claim made in a meeting that
   later proves wrong cannot be challenged with a record.
2. **Every project re-fills the same document set from scratch.** The
   knowledge inside the previous project's documents (structure, conventions,
   content decisions) evaporates at project end.

Adoption reality: developers work through AI agents daily and can connect to
the Brain; non-developers (scrum master, stakeholders — the primary consumers
of meeting outputs) do not and will not soon. Any design requiring non-devs to
open a new app repeats the exact failure it is trying to fix ("no one reads
the meeting notes"). The operator knowingly accepts a residual form of this
risk: with email/push rejected (§2), non-devs consume via the existing webapp
Oracle, which requires them to sign in and ask — non-dev Oracle adoption is
the explicit bet of goal 3.

Root-cause honesty: pain 1 is partly social (no accountability culture), not
purely technical. This design lowers the friction of accountability — items
appear where devs already work, and stale items are surfaced to stakeholders —
but it does not claim software alone changes stakeholder behavior.

## 2. Scope

### Goals

1. A meeting (transcript or notes) ingested through a normal agent session
   yields: a **summary** (session close), **decisions** (existing
   decision-knowledge: `scope: "project"`, `"decision"` tag, supersession —
   this is the "challenge the wrong claim" mechanism), **action items**
   assigned to people, and **open questions** (unresolved points tracked
   until a decision answers them).
2. Developers see *their* open action items **deterministically** at every
   `brain_start_session` — addressed by identity, not retrieval-matched.
3. Non-developers get answers through the **existing webapp Oracle** —
   "what are my open action items?", "what did we decide about X?", "which
   items have gone stale?" — by making the Oracle task-aware. **Operator
   decision (2026-07-07): no email (or other push) notifications, to anyone.**
   The only channels are the harness (MCP) and the Oracle.
4. Document knowhow is harvested as knowledge (`doc-harvest`) and reused to
   draft the next project's free-form/wiki/repo docs (`doc-draft`) — this is
   also what makes specs queryable via the Oracle.
5. Lightweight agile visibility without a PM tool: **blockers** are flagged
   action items (sorted first everywhere), and the Oracle can give a
   **status overview** (recent decisions + open items + blockers + open
   questions). Reports are **on-demand only** — an agent skill
   (`report-draft`) composes a stakeholder report when asked; nothing is
   scheduled or pushed (consistent with the no-email decision).

### Use-case map (operator's five-pillar summary, 2026-07-07)

| Pillar | Where it lands |
|---|---|
| Developer Productivity (Code Q&A, rule injection, onboarding, guardrails, patterns) | **Already V1** — shipped |
| Knowledge & Decision Memory (auto-capture, decision archive, cross-team reuse) | **Already V1** — shipped |
| Meeting Intelligence (owned actions, open-question tracking, searchable decisions, action-focused summaries) | **This spec** (goals 1–3) |
| Project & Agile Execution (status overview, blocker tracking, queryable specs, on-demand reports) | **This spec** (goals 4–5); ART/SAFe dashboards deferred (§8) |
| Integrations & Enterprise (GitHub/Jira/Confluence, Copilot-ready, private & compliant, multilingual) | Copilot-ready + private/compliant **already V1**; integrations + multilingual deferred (§8) |

### Non-goals (deferred, not rejected)

- Kanban / task-board UI or any task state machine
- ISO / SOP process-compliance guidance
- Word/Excel fixed-form generation (agent-side tooling later if needed)
- Jira / GitHub task sync
- Meeting bots, live capture, speech-to-text
- Any new webapp surface
- Email or any push notifications (operator decision 2026-07-07 — Oracle +
  harness are the only channels)
- Scheduled/auto-pushed reports (follows from the above; reports exist only
  on demand via the `report-draft` skill or live Oracle answers)

Revisit each only if the meeting/doc loop proves itself in real use.

## 3. Architecture — one loop, zero new entities, zero migrations

A meeting is a session; its outputs are knowledge. No new Prisma models, no
schema migration (keeps the autonomous merge→release→deploy envelope valid).

```
transcript/notes ──▶ agent session (meeting-miner skill)
                       ├─ decisions    → brain_teach_knowledge (existing path)
                       ├─ action items → Knowledge rows: type="action_item",
                       │                 tags ["action-item","for:<email>","meeting:<date>"]
                       └─ summary      → brain_report_session_outcome (existing)

injection (devs):    deterministic "open action items" block in the
                     brain_start_session response, alongside relevantKnowledge
oracle (non-devs):   existing webapp Oracle answers meeting/task questions
                     over decisions + action items (task-aware retrieval)
docs:                doc-harvest + doc-draft skills over existing tool paths
```

Design decisions and their rationale:

- **`action_item` is a new `type` value, not a new entity.** `Knowledge.type`
  is a plain string column; the new value is code-only. A distinct type (vs
  tag-only) lets semantic retrieval, KEA, decay stats, and Oracle
  rule-citations **exclude** action items cleanly — tasks are not rules and
  must never pollute `relevantKnowledge`.
- **Assignee lives in a `for:<email>` tag**, resolved at injection time.
  `ownerUserId` keeps meaning "creator" — scope-isolation logic is untouched.
- **No status field.** Open = active row; done/obsolete = existing retire path
  (supersession or knowledge patch); abandoned = decay expiry. No state
  machine to build or migrate.

## 4. Components

### 4a. `meeting-miner` skill (protocol, no platform code)

Drives any connected agent: open a session (`prompt: "meeting: <title>
<date>"`), read the transcript/notes, extract →

- each **decision**: `brain_teach_knowledge` with `scope: "project"`,
  `"decision"` in tags, `instead` = rejected alternative,
  `supersedesKnowledgeId` when it reverses a prior decision;
- each **action item**: `type: "action_item"`, tags
  `["action-item", "for:<email>", "meeting:<date-slug>"]`, `ruleText` = the
  task, `triggerText` = context/deadline; add a `"blocker"` tag when the
  item blocks other work;
- each **open question**: same `action_item` type value (one exclusion sweep),
  tags `["open-question", "meeting:<date-slug>"]` plus `for:<email>` when
  someone owns finding the answer; retired when answered — ideally by the
  decision that answers it (link via supersession);
- close with summary + learnings.

Also the completion path: when an item is done or obsolete, retire it via the
existing patch/supersede path.

### 4b. Addressed injection (platform, `packages/core`)

`brain_start_session` response gains an `openActionItems` block:

- Query: `type = 'action_item'` AND project matches AND tags contain
  `for:<caller's email>` AND not retired/deleted (covers owned open
  questions too — same type value).
- Cap ~10; `blocker`-tagged items first, then oldest-first; rendered by
  `formatter.ts` as a distinct section after `relevantKnowledge`.
- Exclusion sweep: semantic retrieval, KEA extraction, decay statistics, and
  Oracle rule-citation paths treat `action_item` as a task, not a rule.

### 4c. Oracle task-awareness (platform, `packages/core`)

The §4b exclusion sweep gets one deliberate exemption: the **Oracle**. It
must be able to answer task-shaped and meeting-shaped questions:

- Include `action_item` rows in Oracle retrieval, with prompt guidance that
  they are tasks (`for:<email>` = assignee, `meeting:<date>` = origin), not
  rules — cite them as tasks, never as learned knowledge.
- Deterministic enumeration for the canonical questions ("open items for
  <person>", "items open >14 days", "current blockers", "unanswered open
  questions", "status overview" = recent decisions + open items + blockers +
  open questions for a project), so answers are complete, not
  embedding-lucky — same query core as §4b, exposed to the Oracle.
- No new surface: this is the existing Oracle page; non-devs sign in with
  the normal voucher flow.

### 4d. Doc knowledge (protocol, no platform code)

- `doc-harvest`: point an agent at a finished project's documents; it teaches
  per-doc-type recipes (structure, conventions, embedded decisions, reusable
  boilerplate) as `recipe` knowledge.
- `doc-draft`: on a new project, retrieve the recipe + relevant decisions and
  draft the document (Markdown / wiki / repo docs). Fixed-layout Word/Excel
  is explicitly out of scope.
- `report-draft`: on demand only, compose a stakeholder status report from
  the same data the Oracle enumerates (recent decisions, open items,
  blockers, open questions). Never scheduled, never pushed.

## 5. Security & tenancy

- Teammates join the existing live instance via the normal voucher flow;
  everything is bounded by existing per-project/org scope isolation.
- Action items carry `visibility: "project"`.
- The operator's other projects (real client data) are untouched by
  construction — different project scope.
- New test obligation: cross-tenant coverage extends to `action_item` rows
  in both the injection query and Oracle answers (an Oracle answer must never
  surface another org's tasks).

## 6. Rollout

1. **Now (freeze-safe):** this spec + implementation plan; manual dry-run of
   the meeting-miner protocol on real meetings of the running project —
   validates extraction quality and the `for:` convention with zero platform
   code, and produces test fixtures.
2. **2026-07-17 — gate reads (#149).** Pass → build. Fail → flywheel
   diagnosis takes priority (flywheel spec §5: do not proceed anyway); the V2
   build waits. V2 depends on a healthy loop.
3. **Build order, two PRs, no migrations:**
   - **PR-1:** `action_item` type + addressed injection + retrieval/KEA/decay
     exclusion + tests.
   - **PR-2:** Oracle task-awareness (retrieval inclusion + deterministic
     enumeration + prompt guidance) + tests.
   Each lands via the standing PR → green-CI → release → deploy workflow.

## 7. Testing

- **Unit:** injection query (addressing, cap, retired-exclusion); retrieval
  exclusion of `action_item` everywhere except the Oracle; deterministic
  enumeration (grouping + >14-day staleness).
- **Integration/e2e:** fixture meeting ingested → assignee's next
  `brain_start_session` carries the item → retire → gone; Oracle answers the
  canonical task/status questions (§4c) correctly from the fixture, including
  blockers-first ordering and open-question resolution; cross-tenant
  leak tests for both paths.
- **Manual:** the §6.1 dry-run doubles as extraction-prompt validation on
  real (anonymized-in-writeups) meetings.

## 8. Deferred-items register

| Item | Trigger to revisit |
|---|---|
| GitHub/Jira/Confluence integration | Action-item/doc loop proves out but artifacts need to live in the org's existing tools |
| Multilingual (Thai) extraction & search | Non-English meeting notes/docs become a real share of inputs |
| ART/SAFe visibility dashboards | Oracle status answers prove insufficient for release-train stakeholders |
| Word/Excel form filling | doc-draft succeeds on free-form docs and fixed forms remain a real cost |
| ISO/process guidance | An audit or SOP mandate arrives with a named standard |
| Task-board UI | Non-dev consumption via Oracle proves insufficient *and* adoption evidence exists |
| Email/push notifications | Rejected by operator decision (2026-07-07); revisit only if the operator reverses it after Oracle adoption evidence |
| Meeting bots / STT | Transcript coverage gaps become the bottleneck |
| Agentic guardrails hardening | Treated separately from V2 — it is loop work (injection policy), not expansion |
