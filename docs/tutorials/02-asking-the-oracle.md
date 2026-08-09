# Tutorial 02 — Asking the Oracle

**You'll have:** working query patterns for the Oracle, an understanding
of citations + groundedness, and a feel for when the Oracle is
trustworthy vs when it's hallucinating.

**Time:** ~10 minutes after Tutorial 01.

---

## What the Oracle is

A conversational layer over your Brain. You type a question; it runs
semantic retrieval against your Knowledge + recent Sessions, builds a
prompt with the top-N matches as citations, and asks an LLM (Claude
Sonnet by default) to answer **only from the cited context**.

What it's not: a general-purpose assistant. Off-topic questions
("what's the weather?") get redirected. The Oracle is bounded to your
own coding history — by design.

## How the retrieval pipeline runs

```mermaid
flowchart LR
    Q[Your question] --> E[Embed via Gemini]
    E --> P[(pgvector<br/>Knowledge + Sessions)]
    P --> S[Score: 0.40·sim + 0.20·success<br/>+ 0.15·recency + 0.15·ctx + 0.10·conf]
    S --> T[Top 12 Knowledge<br/>+ Top 10 Sessions]
    T --> L{Any matches<br/>above threshold?}
    L -- yes --> Prompt[Build prompt<br/>with citations]
    L -- no --> Honest[System prompt:<br/>'no Brain context']
    Prompt --> LLM[LLM<br/>Claude Sonnet]
    Honest --> LLM
    LLM --> A[Streamed answer<br/>with [^N] markers]
```

The dotted line — *"no Brain context"* — is the path you'll see when
your Brain doesn't have anything relevant. The Oracle says so
explicitly rather than hallucinating; that's a feature, not a bug.

## The Oracle UI

Visit `/#oracle`. You'll see:

- **Question input** at the bottom. Press Enter to submit.
- **Answer area** above. Streams back as the LLM generates.
- **Inspector** on the right (after first turn). Shows what was
  retrieved: which Knowledge rows, which Sessions, with similarity
  scores.
- **Reasoning level** segmented control next to the input. Trades
  cost/latency for depth: `minimal` < `low` < `medium` (default) <
  `high` < `max`. Most queries do fine on `medium`. Use `high` for
  multi-step questions; `max` is overkill unless you're stuck.
- **Scope pill** in the top toolbar. Choose between "this project"
  (default — only knowledge + sessions tagged to your active project)
  and "all projects" (cross-project search). Use `all` when you want
  to surface a pattern from a different repo.

## Query patterns that work

The Oracle answers best when the question implies a clear semantic target:

| Ask… | Because… |
|---|---|
| ✗ "How do I do auth?" | Too vague — no framework, no project signal. Generic answer or "not enough context" |
| ✓ "How did I solve the CORS issue in the MCP server last month?" | Framework + symptom + time anchor → retrieves the exact session and its Knowledge |
| ✓ "What do I usually use for forms in Next.js?" | Matches high-confidence `recipe`/`heuristic` Knowledge by trigger |
| ✓ "What React patterns do I avoid?" | Targets `anti_principle` Knowledge specifically |
| ✓ "Why did I switch from Formik to react-hook-form?" | Strings together the session that made the switch + the rule that recorded why |

## Reading the answer

Every Oracle answer has three components you should read:

1. **The text answer** with `[^N]` citation markers. Each marker links
   to either a Knowledge row (`[^K1]`) or a Session (`[^S1]`) in the
   inspector panel.

2. **Groundedness pill** at the top of the answer ("Grounded on 3
   rules · 2 sessions"). Tells you how much retrieval the LLM had to
   work with. If it says "no context" — that's an honest no, not a
   bug. The Brain will then answer from general knowledge with an
   explicit "I have no Brain context for this" disclaimer.

3. **Inspector panel** on the right. Shows each retrieved row with its
   similarity score (0.0 to 1.0; >0.7 is a strong match). If the
   similarity scores are all <0.4 the answer is essentially a guess —
   trust it accordingly.

## When to trust the answer

| Signal | Trust level |
|---|---|
| Multiple citations, top similarity >0.7, sessions recent | High — this is your own well-trodden ground |
| One citation, similarity 0.5-0.7 | Medium — verify by clicking the citation |
| "No Brain context" disclaimer | The Oracle is being honest. The text is general knowledge, not yours |
| All citations <0.4 similarity | Low — the Oracle is reaching. Reframe the question |

## Citations are clickable

Click a `[^K1]` marker in the answer. The inspector highlights the
Knowledge row. Click again to navigate to the full Knowledge detail
(rule text, rationale, source sessions, success/failure counts).

For session citations (`[^S1]`), clicking opens the session timeline —
every event the Brain captured during that coding task, in order.

## What to do with a bad answer

The "thumbs down" button in the Oracle UI tells the Brain the answer
wasn't useful. This signal feeds back into the effectiveness scoring
on the cited Knowledge — repeated downvotes on a Knowledge row push it
lower in future retrievals.

If the answer is bad because the **retrieval was wrong** (the Oracle
pulled in the wrong rules), thumbs-down is the right action.

If the answer is bad because **the Brain just doesn't know** (no
relevant retrieval), don't downvote — it's not the Oracle's fault.
Instead, **teach** the missing knowledge directly: see
[Tutorial 03](./03-teaching-knowledge.md).

## Next

- **[Tutorial 03 — Teaching the Brain](./03-teaching-knowledge.md):** put new rules into the pool without waiting for sessions to surface them.
- **[Tutorial 06 — Troubleshooting](./06-troubleshooting.md):** "the Oracle says it has no context — but I have lots of sessions".
