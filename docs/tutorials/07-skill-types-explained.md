# Tutorial 07 — Skill types, explained for everyone

**You'll have:** a plain-language understanding of every label you see
on the Skills page — Recipe, Rule of thumb, Principle, Reflex,
Anti-pattern, Decisions — what the little numbers on each card mean,
and how skills come to exist in the first place.

**Audience:** anyone. No programming background needed. If you can read
a recipe card and a sticky note, you can read this.

**Time:** ~10 minutes.

---

## Start with the right mental picture

Imagine a new colleague joins your team. They're brilliant, but every
morning they show up with a **blank notebook** — nothing about yesterday
carried over unless someone wrote it down. Each day you re-explain how
your team likes things done, which shortcuts work, which mistakes
you've already made once.

The Brain is the notebook that fixes this. Every time you (or your AI
assistant) work, the Brain writes down small, reusable lessons. Each
lesson is one card: **"in this situation → do this."** The next morning,
the right cards are read back at exactly the right moment — so nobody
re-explains, and nobody repeats an old mistake.

Those cards are what the Skills page shows. The **type** labels in the
left sidebar just answer one question: *what kind of lesson is this?*

---

## The six types, one by one

### 🧾 Recipe — "follow these steps for this dish"

A recipe is a **step-by-step way of doing one specific task** that has
worked before. Like a cooking recipe: when you're making *this dish*,
do *these steps in this order*.

> **Everyday version:** "When setting up a new client folder: copy the
> template, rename it with the date, share it with accounting, then
> send the kickoff email."
>
> **From a real Brain:** a card describing the exact steps for
> publishing a new version of the software — update the documentation,
> wait until all automated safety checks pass, put a version label on
> the result, then publish it live. Same steps, same order, every time.

The Brain serves recipes when you start a task that looks like one it
has a recipe for.

### 👍 Rule of thumb — "usually, try this first"

A rule of thumb is **experienced judgment, not a strict law**. It's what
a veteran colleague means by "nine times out of ten, it's the fuse box."
It depends on the situation and can be wrong — it's just the smart
first bet.

> **Everyday version:** "If the printer acts up, turn it off and on
> before calling IT."
>
> **From a real Brain:** "If a routine automated task suddenly fails
> instantly, with no output at all, suspect the account ran out of its
> monthly quota — don't waste time troubleshooting the task itself
> first."

### 🧭 Principle — "this is how we do things here"

A principle is a **value or standing policy** — broader than any single
task. It shapes many decisions rather than prescribing one.

> **Everyday version:** "We always confirm appointments in writing."
>
> **From a real Brain:** "Check whether a person's invite code is valid
> *before* checking whether their email is already registered." Why the
> order matters: checking the email first would let a stranger with no
> valid invite discover whether someone's address is already signed up.
> Reordering the two checks closes that leak — in every sign-up flow,
> not just one.

### ⚡ Reflex — "always, no exceptions, don't even think"

A reflex is the **strictest type: an unconditional instruction for a
very specific trigger.** Like fastening your seatbelt — you don't weigh
the pros and cons each time; the situation appears, the action fires.

> **Everyday version:** "Every outgoing invoice gets a second pair of
> eyes. Always."
>
> **From a real Brain:** "When writing text in the owner's personal
> voice, avoid em-dashes and AI-sounding clichés like 'delve' or
> 'game-changer'." The owner corrected this once — now it fires
> automatically every time, so they never have to say it again.

### 🚫 Anti-pattern — "we tried that; it burned us"

An anti-pattern is a **recorded mistake**: something that looks
reasonable but is known to go wrong — usually with a note about what to
do instead. It's the "do NOT use the freight elevator for catering"
sign, written by whoever learned it the hard way.

> **Everyday version:** "Don't schedule client calls on Friday
> afternoons — half of them no-show. Book mornings instead."
>
> **From a real Brain:** "Do NOT describe AI coding tools as 'they
> forget everything'" — a phrasing the owner rejected in the product's
> marketing, recorded so no future draft makes the same mistake.
> (You may notice this very tutorial opens with a "blank notebook"
> image instead of that phrase — the rule at work.)

### 📌 Decisions — "we settled this; stop re-debating it"

Decisions are slightly different from the other five: they're **facts
the team chose**, not lessons the Brain inferred. "We picked supplier
A over supplier B." "The project is named X." "We deploy from one
branch only."

Two special things about decisions:

1. **They never fade.** Other skills lose strength if unused (more on
   that below). A decision is a stated fact — it stays until it's
   **overturned by a newer decision**, and the Brain keeps the paper
   trail: which decision replaced which, and why.
2. **They carry the rejected option.** "We chose A *(not B, because…)*"
   — so when someone asks "why don't we just use B?", the answer, and
   the original reasoning, is one question away.

If a colleague (or an AI assistant) starts a task tomorrow, settled
decisions are shown to them up front — so nobody relitigates last
month's meeting.

---

## The small print on each card

Every card carries a few numbers. They're the Brain being honest about
**how much each lesson has proven itself:**

| You see | It means |
|---|---|
| `conf 1.02` | **Confidence** — how sure the Brain is this rule is right. Rules a human taught directly start at the top (1.0) and can climb slightly above it as they keep proving themselves in real use. Rules the Brain inferred on its own start lower (0.7) and must earn their way up. |
| `12 uses` | How many times this card was actually pulled out and shown during real work. |
| `✓ 100% · 19 sessions` | Of the work sessions where this card was used, how many ended well. A skill with a high success rate rises; one that keeps failing sinks. |
| `Unused` | An honesty label: this card exists but has never been shown during real work yet. |
| `Untested` | Also an honesty label: the card has been used, but too few times to judge whether it helps. |

And one thing you *don't* see directly: **fading.** A skill that goes
unused for months slowly loses ranking strength — like a sticky note
yellowing on the wall — so the Brain's advice stays current instead of
drowning in stale tips. Good, frequently-confirmed skills fade slowly;
bad or ignored ones fade fast. (Decisions, remember, don't fade at all.)

---

## How do skills get built?

Four ways, from most deliberate to most automatic:

### 1. Someone teaches it directly

A person says, in plain words: *"Remember: we always X."* That becomes
a card immediately, at top confidence, because a human vouched for it.
(That's the **"+ Teach a skill"** button at the top of the Skills page,
or telling your AI assistant "remember this".)

### 2. The assistant hands over lessons at the end of a session

When an AI assistant finishes a piece of work, it's asked to hand over
the durable lessons it learned — **especially moments where a human
corrected it or rejected its approach.** Those corrections are gold:
they're exactly the things nobody wants to repeat next week. Each
handed-over lesson is checked ("is this durable? is it specific?")
before it becomes a card.

### 3. The Brain mines finished sessions automatically

In the background, an extraction process re-reads finished work
sessions and pulls out patterns nobody explicitly flagged: what was
tried, what was corrected, what finally worked. These auto-mined cards
start at lower confidence — they have to prove themselves in use
before they rank highly.

### 4. Meetings and documents (the newest source)

As of the newest update, a meeting transcript can be fed through the
same machinery:
decisions made in the meeting become **Decision** cards (with the
rejected alternatives), to-dos become action items addressed to a
person, and a finished project's documents can be harvested into
**Recipe** cards ("how we fill this kind of document") so the next
project doesn't start from a blank page.

### …and then they live or die by results

Whichever way a card was born, the same life awaits it:

- Every time it's used and the work **succeeds**, its track record
  improves and it ranks higher next time.
- Every time it's used and the work **fails**, its record worsens.
- If it sits unused, it fades.
- If it's contradicted by a newer lesson or decision, it's retired —
  with the replacement linked, so the history stays auditable.

That loop — **capture → serve at the right moment → track whether it
helped → promote or fade** — is the whole product. The Skills page is
simply the window onto it.

---

## One last label: who can see a skill

The **Visibility** filter in the sidebar has three levels:

- 🔒 **Private** — only you. Personal habits and preferences.
- 📁 **Project** — everyone working on that project. Most skills live
  here: "how we do things *on this project*."
- 🌐 **Org** — your whole organization, across all projects. Company-
  wide standards.

---

## Where to go next

- Want to add a skill yourself? → [Tutorial 03 — Teaching the Brain](./03-teaching-knowledge.md)
- Want to ask questions about what the Brain knows? → [Tutorial 02 — Asking the Oracle](./02-asking-the-oracle.md)
- Technical readers who want the formal model (types, lifecycle,
  invariants) → [`../KNOWLEDGE.md`](../KNOWLEDGE.md)
