# meeting-miner — turn a meeting artifact into Brain memory

**Audience:** any AI agent connected to this Brain (Claude Code, Copilot,
Cursor, …). **Trigger:** the user hands you a meeting transcript or notes
("mine this meeting", "process Monday's standup notes").
**Spec:** `docs/superpowers/specs/2026-07-07-brain-v2-meeting-doc-intelligence-design.md` §4a.

A meeting is a session; its outputs are knowledge. You extract four things:
**decisions**, **action items**, **open questions**, and a **summary**. Nothing
else — do not teach general observations as rules from a meeting.

The `/meetings` webapp surface (flag-gated, `MEETING_UPLOAD_ENABLED`, default
off) is an alternative front door onto the same underlying
`brain_teach_knowledge` calls this protocol describes: paste a transcript,
review the extracted decisions and action items, and confirm them
individually. Useful when there's no agent handy, or for a single quick
import — it doesn't replace this protocol for an agent already in the loop.

## Protocol

1. **Open a session**
   `brain_start_session(prompt: "meeting: <title> <YYYY-MM-DD>", projectName: <project>)`.
   Save the `sessionId`. If the response carries `openActionItems`, show the
   user their still-open items from previous meetings before mining the new one.

2. **Read the artifact** (transcript file, pasted notes, wiki page). Language
   is typically English; keep extracted text in the artifact's language.

3. **Extract decisions** — statements of settled choice ("we'll use X",
   "deprecate Y", "Z owns auth"). For each:

   ```
   brain_teach_knowledge(
     type: "principle",            // or "anti_principle" for "we will NOT do X"
     scope: "project",
     trigger: "<when this decision applies>",
     rule: "<the decision as stated>",
     instead: "<the rejected alternative, verbatim if possible>",
     rationale: "<why, as argued in the meeting>",
     tags: ["decision", "meeting:<YYYY-MM-DD-slug>"],
     supersedesKnowledgeId: "<id>"  // ONLY if it reverses a prior decision —
   )                                //   search first with brain_ask_oracle
   ```

   This is the accountability record: when someone later claims the opposite,
   the Oracle cites this row — and if the meeting *itself* reversed an earlier
   decision, supersession retires the stale one.

4. **Extract action items** — concrete to-dos with an owner. For each:

   ```
   brain_teach_knowledge(
     type: "action_item",
     scope: "project",
     trigger: "<context/deadline, e.g. 'agreed in sprint planning, due before release'>",
     rule: "<the task, imperative: 'Update the deployment runbook'>",
     tags: ["action-item", "for:<owner-email-lowercase>",
            "meeting:<YYYY-MM-DD-slug>", "blocker"?]   // blocker ONLY if it blocks other work
   )
   ```

   Map spoken names to emails via the project's member list; if you cannot
   resolve an owner, ask the user rather than guessing. Emails must be
   lowercase — addressing is an exact tag match. **Use the assignee's Brain
   account email** (the address they sign into this Brain with — see the org
   member list in the webapp), which may differ from their work/external
   email; a `for:` tag with the wrong address matches nobody and the item
   never surfaces.

5. **Extract open questions** — raised but unresolved points:

   ```
   brain_teach_knowledge(
     type: "action_item",
     scope: "project",
     trigger: "<why it matters / what it blocks>",
     rule: "<the question verbatim>",
     tags: ["open-question", "meeting:<YYYY-MM-DD-slug>",
            "for:<email>"?]        // only if someone owns finding the answer
   )
   ```

   When a later meeting answers the question, teach the answer as a decision
   and retire the question via `resolvedActionItemIds` at that session's close.

6. **Close the session**
   `brain_report_session_outcome(sessionId, success: true, learnings: [...])`
   — the summary goes in the session close; `learnings` carries at most the
   1–2 *durable rules* the meeting surfaced (usually none — meetings mostly
   produce decisions and tasks, which you already taught above).

## Completion path (any later session)

When work covered by an open action item is done — or the item is obsolete —
pass its id at close:
`brain_report_session_outcome(..., resolvedActionItemIds: ["<id>"])`.
The ids are printed in the `openActionItems` block (`[id: …]`).

## Worked example

Input notes (fictional):

> Sprint planning 2026-07-07. Anna: staging DB is broken, nothing ships until
> fixed — Ben takes it. We discussed ORMs again and settled on keeping Prisma;
> Drizzle rejected (migration cost > benefit). Nobody knows who owns the auth
> migration — Anna will find out. Chris updates the deployment runbook.

Calls:

1. `brain_start_session(prompt: "meeting: sprint planning 2026-07-07", projectName: "Acme-Shop")`
2. Decision: `teach(type:"principle", scope:"project", trigger:"choosing the ORM for Acme-Shop", rule:"Keep Prisma as the ORM", instead:"Drizzle", rationale:"migration cost outweighs benefit", tags:["decision","meeting:2026-07-07-sprint-planning"])`
3. Action item (blocker): `teach(type:"action_item", scope:"project", trigger:"staging DB broken, blocks all shipping — sprint planning", rule:"Fix the staging database", tags:["action-item","for:ben@acme.test","blocker","meeting:2026-07-07-sprint-planning"])`
4. Action item: `teach(type:"action_item", scope:"project", trigger:"agreed in sprint planning", rule:"Update the deployment runbook", tags:["action-item","for:chris@acme.test","meeting:2026-07-07-sprint-planning"])`
5. Open question: `teach(type:"action_item", scope:"project", trigger:"unclear ownership blocks the migration plan", rule:"Who owns the auth migration?", tags:["open-question","for:anna@acme.test","meeting:2026-07-07-sprint-planning"])`
6. `brain_report_session_outcome(sessionId, success: true)`

Next morning, Ben's `brain_start_session` opens with:

```
## Your Open Action Items
- [BLOCKER] Fix the staging database — staging DB broken, blocks all shipping — sprint planning (meeting:2026-07-07-sprint-planning) [id: …]
```
