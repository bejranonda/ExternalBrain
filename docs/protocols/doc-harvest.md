# doc-harvest — mine a finished project's documents into reusable knowledge

**Audience:** any AI agent connected to this Brain. **Trigger:** a project (or
milestone) wraps up and the user says "harvest the docs" / "make the next
project not start from zero".
**Spec:** `docs/superpowers/specs/2026-07-07-brain-v2-meeting-doc-intelligence-design.md` §4d.

The pain this kills: every new project re-fills the same document set from
scratch. The knowledge inside the finished documents — structure, conventions,
what content goes where, which sections caused review pain — evaporates.
Harvesting converts each **document type** into a `recipe` the next project's
`doc-draft` run can retrieve.

## Protocol

1. **Open a session**
   `brain_start_session(prompt: "doc-harvest: <project> <doc types>", projectName: <project>)`.

2. **Inventory the documents** the user points you at (PRD, spec, test plan,
   handover, README, ADRs, wiki pages). One recipe per *document type*, not
   per document.

3. **For each doc type, teach one recipe:**

   ```
   brain_teach_knowledge(
     type: "recipe",
     scope: "project",              // "user" if the template transcends projects
     trigger: "filling the <doc-type> for a new project",
     rule: "<the recipe: section list in order; per-section one-line guidance
            on what goes there; conventions (naming, length, sign-off flow);
            reusable boilerplate worth copying verbatim>",
     rationale: "harvested from <project>'s <doc name(s)>, <date>",
     tags: ["doc-template", "doc:<doc-type-slug>"]
   )
   ```

   Keep the `rule` under ~1500 characters — a recipe is a map, not the
   territory. If the boilerplate is long, teach a second recipe tagged
   `doc:<type>-boilerplate` rather than inflating one row.

4. **Capture content decisions separately.** If a document encodes a decision
   ("we commit to 99.9% SLA", "auth is OAuth-only"), teach it as a decision
   (see `meeting-miner.md` step 3) — decisions are decay-exempt; recipes are not.

5. **Close** with `brain_report_session_outcome(success: true)`.

## Worked example

Harvesting a finished project's PRD:

```
brain_teach_knowledge(
  type: "recipe",
  scope: "user",
  trigger: "filling the PRD for a new project",
  rule: "Sections in order: 1) Problem (2 paragraphs max, cite the requesting
         stakeholder) 2) Goals/Non-goals (bulleted, non-goals mandatory —
         review always asks) 3) Personas 4) Requirements table (id | must/should |
         acceptance criterion) 5) Milestones 6) Risks. Conventions: requirement
         ids REQ-nnn; every 'must' needs an acceptance criterion; sign-off row
         at the bottom (PM + tech lead). Reviews stall when Non-goals is empty
         — fill it first.",
  rationale: "harvested from the 2026-Q2 project's PRD set, 2026-07-07",
  tags: ["doc-template", "doc:prd"]
)
```

Out of scope (deferred by spec): fixed-layout Word/Excel forms — harvest their
*content structure* as a recipe if useful, but generating the files is not part
of V2.0.
