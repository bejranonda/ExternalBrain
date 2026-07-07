# doc-draft — draft a new project's document from harvested knowledge

**Audience:** any AI agent connected to this Brain. **Trigger:** a new project
needs a standard document ("draft the PRD", "start the test plan").
**Spec:** `docs/superpowers/specs/2026-07-07-brain-v2-meeting-doc-intelligence-design.md` §4d.
**Prerequisite:** a prior `doc-harvest` run taught `doc:<type>` recipes.

## Protocol

1. **Open a session**
   `brain_start_session(prompt: "doc-draft: <doc-type> for <project>", projectName: <project>)`
   — the recipe often arrives in `relevantKnowledge` right here.

2. **Retrieve the template knowledge** if it didn't:
   `brain_retrieve_knowledge(query: "filling the <doc-type>")` and
   `brain_ask_oracle("what do we know about writing the <doc-type>?")`.

3. **Pull the project's decisions** — the content that makes the draft true
   rather than generic: `brain_ask_oracle("what decisions have we made in
   <project>?")`. Open questions surfaced by the Oracle belong in the draft
   marked `TBD(open-question)` — never invent an answer the team hasn't made.

4. **Draft** in Markdown (or directly into the wiki/repo doc), following the
   recipe's section order and conventions. Where the recipe has boilerplate,
   reuse it verbatim and adapt names.

5. **Hand over honestly:** list which sections came from the recipe, which
   from project decisions, and which are placeholders needing a human. The
   draft is a starting point — a human polishes and owns it.

6. **Close** with `brain_report_session_outcome(success: true,
   knowledgeUsed: [<recipe + decision ids actually applied>])` — this is what
   teaches the Brain which templates pay off.

**Out of scope:** fixed-layout Word/Excel output (spec non-goal). If the
target is such a form, produce the content in Markdown mapped to the form's
field names and let a human paste.
