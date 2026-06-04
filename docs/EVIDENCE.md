# Does External Brain actually help? — evidence

External Brain's claim is simple: **capture what you learn while coding, then
serve it back so the next session is smarter.** This page shows that loop
working on a real deployment, using counts and a live retrieval — no marketing
numbers, no synthetic data. (All figures are aggregate; no project or customer
data is shown.)

## 1. The capture → extract loop is real and automatic

On a single-developer instance wired to Claude Code over MCP:

| Signal | Value | What it proves |
|---|---|---|
| Coding sessions captured | **27** | The MCP client reports real sessions, hands-free. |
| Sessions with reported outcomes (30d) | **27** | The feedback loop closes — outcomes flow back, not just starts. |
| Skills in the brain | **48** | Knowledge accumulates. |
| — auto-extracted by the KEA pipeline | **10** | The brain mines skills from sessions *without* manual note-taking. |
| — taught directly by the user | **22** | You can also teach it explicitly. |
| Extraction schedule | **daily** | It keeps compounding on its own, no operator action. |

The takeaway: you code as usual; durable, reusable skills appear and grow over
time.

## 2. Knowledge is served back — grounded and cited

A live question to the Oracle on that instance:

> **"Why does the worker need pg-boss?"**

The Oracle:
- **retrieved 20 candidate items** from the brain, each scored by relevance,
  recency, and past success;
- **grounded its answer on 12 rules + 3 sessions** with a **"strong"**
  groundedness rating;
- showed every supporting source in a retrieval inspector, each marked
  **cited** — so the answer is traceable to *your* captured knowledge, not a
  generic model guess.

The takeaway: when you ask, you get an answer built from what your team actually
learned, with the receipts.

## 3. The full loop

```
 code a session ──▶ session + outcome captured (MCP)
        │
        ▼
   KEA extracts durable skills ──▶ skills embedded for semantic search
        │
        ▼
 next time you ask ──▶ relevant skills retrieved + injected ──▶ grounded,
                                                               cited answer
```

Capture → extract → retrieve → grounded answer. That's the product, and it runs
on a single VM you control.

## Reproduce it yourself

Stand up an instance ([QUICKSTART](./QUICKSTART.md)), wire your AI tool
([CLIENTS](./CLIENTS.md)), run a few sessions, then ask the Oracle a question
about your own code. The dashboard's pulse line and the Oracle's groundedness
badge show the loop closing in real time.
