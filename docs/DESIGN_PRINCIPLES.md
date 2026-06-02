# Design Principles

How the Brain Platform UI decides what to show, what to hide, and when to surface depth.

> **TL;DR** — Brain is a *learning* product: it accumulates knowledge over time. The UI has to honor that arc. We use **progressive disclosure** as the headline principle, but we extend it with two principles that matter specifically for tools that compound: **earned surface area** and **quiet by default**.

---

## 1. Progressive disclosure

Show the user what they need *right now*. Keep everything else one interaction away.

**What this looks like in Brain:**

- The session card shows title + outcome + timestamp. It does *not* show the extracted Brain learnings, user benefits, or KEA findings inline. Those live behind a click-to-expand (PR #263, dashboard-wired in #266).
- The project row on the dashboard shows project name + active marker. Click it to reveal "Brain helped this project / Brain learned from this project" + a one-line value summary (PR #266).
- The Oracle answer renders the response. Citations, retrieval scores, and the underlying knowledge rows are accessible but collapsed.
- The skills panel lists skill names + a one-line purpose. Full body, frontmatter, and version history are revealed on selection.

**What this is NOT:**

- Hiding important state behind opaque icons.
- Making the user discover features through trial and error.
- "Mobile-first" as an excuse to amputate desktop information density.

The test: a new user should grasp the surface in 5 seconds, AND a power user should reach any feature in ≤2 clicks.

---

## 2. Earned surface area

A panel ships when its data exists, not before.

Brain has a cold-start problem most apps don't: on day one, a new user has zero sessions, zero knowledge, zero skills. A naive UI shows six empty dashboards with "no data yet" placeholders — which trains the user to ignore the entire surface before it has anything to say.

**The rule:** every panel, tab, or card declares a precondition. Until the precondition is met, the surface is absent — not greyed out, not "coming soon," absent.

**Examples from the codebase:**

- Project switcher (#262): only renders when the user has ≥2 projects. One-project users never see the switcher's stale-state bugs because they never see the switcher.
- Per-session value drill-down (#263): the expand affordance only appears on sessions that *have* a closed outcome. Sessions still in flight don't pretend they have insights to reveal.
- Dashboard `ProjectsList` (#266): returns `null` at 0 projects; collapses to one compact row at 1 project; shows the full clickable list only at ≥2. A list of one is not a list — and a zero-state list with a "no projects yet" placeholder would train users to ignore the section.
- Cross-session knowledge (PRs #213 / #217 / #219): the user-scope retrieval panel only surfaces once the daily `kea.cross_extract` job has produced ≥1 cross-session row.

The corollary: when you add a new feature, write down the precondition before you write the component. If you can't name a precondition, the feature isn't ready.

---

## 3. Quiet by default, loud on demand

Brain is always working in the background. The KEA worker is extracting. The KRA index is updating. Decay is running. Cross-session compounding fires at 06:00 UTC daily.

If the UI surfaced every one of these, it would be a notification firehose. So:

- **Whisper** routine state through small, persistent surfaces — last-extracted timestamp, "N new this week" badges, count deltas in tab labels.
- **Speak** when the user can act on something — a new proposal awaiting approval, a session that closed and has new insights worth viewing.
- **Shout** only when the user *must* act — auth expired, deploy blocked, data-loss risk.

The default volume is the first level. Most surfaces never escalate.

---

## 4. How to apply this when you're editing the UI

Before you open `app.tsx`, ask three questions:

1. **What does this surface show by default?** (progressive disclosure)
2. **What has to be true before this surface should appear at all?** (earned surface area)
3. **At what volume does this surface speak — whisper, speak, or shout?** (quiet by default)

If you can answer all three in one sentence each, the change is probably scoped right. If any answer is "everything / always / shout," reconsider.

---

## 5. References

- [`docs/GUIDELINES.md §10`](./GUIDELINES.md#10-frontend--design-system) — design tokens, i18n, state-based navigation.
- [`docs/GUIDELINES.md §10a`](./GUIDELINES.md#10a-design-principles-when-to-show-what) — terse rulebook version of this doc.
- [`docs/USING_BRAIN.md`](./USING_BRAIN.md) — operator-facing walkthrough showing the principles in action.
- PRs #261 (mobile Loop 1), #262 (project switcher), #263 (per-session value) — the cluster that crystallized these rules.
- PR #266 — the first feature whose entire shape was driven by these principles: dashboard projects + sessions value drill-down. See `APPROACH.md §5ai` for the validate-then-aggregate cycle the PR closed.
