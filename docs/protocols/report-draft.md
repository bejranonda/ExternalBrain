# report-draft — compose an on-demand stakeholder status report

**Audience:** any AI agent connected to this Brain. **Trigger:** the user asks
for a status report ("what do I tell the steering meeting?", "draft the weekly
update").
**Spec:** `docs/superpowers/specs/2026-07-07-brain-v2-meeting-doc-intelligence-design.md` §4d.

**Hard rule (operator decision 2026-07-07): never scheduled, never pushed.**
This protocol runs only when a human asks, and the output goes back to that
human — no email, no chat posting, no cron. The Brain's only channels are the
harness and the Oracle.

## Protocol

1. **Open a session**
   `brain_start_session(prompt: "report-draft: status for <project> <period>", projectName: <project>)`.

2. **Gather the deterministic status data** — the same data the Oracle's
   OPEN TASKS block enumerates:
   - `brain_ask_oracle("status overview for <project>: recent decisions, open action items, blockers, open questions")`
   - If anything is ambiguous, follow up per category ("current blockers?",
     "which items are stale?", "what did we decide since <date>?").

3. **Compose** (Markdown, one page):
   - **Done / decided** — decisions since the last report, one line each,
     with the rejected alternative where it aids the reader.
   - **In progress** — open action items grouped by assignee.
   - **Blocked** — blocker-tagged items, oldest first, each with what it blocks.
   - **Needs an answer** — open questions, each with who owns it.
   - **Stale** — items open >14 days, called out plainly; staleness is the
     report's accountability lever, don't soften it.

4. **Ground every line** in an Oracle citation or a knowledge id — a status
   report that can't cite its source is an opinion. Anonymize any client
   names if the report might leave the project circle.

5. **Close** with `brain_report_session_outcome(success: true)`. If drafting
   revealed stale/dead items, propose resolving them
   (`resolvedActionItemIds`) — with the user's confirmation, since "stale" is
   not "done".
