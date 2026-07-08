# External Brain — End-User Tutorials

Hands-on, task-focused guides for someone who's been given a Brain URL
and a token. Each tutorial is self-contained, takes ≤15 minutes, and
ends with a working capability.

If you're installing External Brain yourself (operator role), read
[`../QUICKSTART.md`](../QUICKSTART.md) and [`../USING_BRAIN.md`](../USING_BRAIN.md)
first — they cover the server side.

## Pick where to start

| You want to… | Tutorial | Time |
|---|---|---|
| Wire your AI tool (Claude Code / Cursor / Windsurf) to your Brain for the first time | [01 — Getting started](./01-getting-started.md) | 10 min |
| Ask your Brain questions about your own coding history | [02 — Asking the Oracle](./02-asking-the-oracle.md) | 10 min |
| Teach the Brain a new pattern, rule, or preference | [03 — Teaching the Brain](./03-teaching-knowledge.md) | 10 min |
| Issue a token scoped to a specific organization or project | [04 — Token scope + management](./04-managing-tokens.md) | 10 min |
| Export your accumulated rules into a project's `.claude/` / `.cursor/` / `AGENTS.md` | [05 — Exporting rules](./05-exporting-rules.md) | 5 min |
| Diagnose "the Brain doesn't seem to be helping" | [06 — Troubleshooting](./06-troubleshooting.md) | as needed |
| Understand the skill types (Recipe, Rule of thumb, Reflex…) — no tech background needed | [07 — Skill types, explained](./07-skill-types-explained.md) | 10 min |

## Big picture in one paragraph

Your AI coding tool talks to your Brain over MCP-over-HTTP. Before the
model generates code, the Brain quietly injects relevant rules from your
past sessions ("we use react-hook-form here, not Formik"). After the
session, the Brain extracts new rules from what worked. Over time the
loop tightens — your tool stops repeating the same mistakes, you stop
re-explaining the same constraints. The webapp is where you see what
the Brain knows, ask it questions, and curate the rules.

The deeper "why" lives in [`../HOW_IT_WORKS.md`](../HOW_IT_WORKS.md);
these tutorials are the "how".
