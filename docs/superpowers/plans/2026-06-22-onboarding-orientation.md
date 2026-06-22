# First-time-user Orientation Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a brand-new user the literal prompts to drive the Brain from their AI agent, complete the concept glossary (graph/decisions), and make in-surface jargon self-explaining — all content/UI only, no backend change.

**Architecture:** Reuse the existing `docs-content.ts` registry (parallel `DOCS`/`DOCS_DE`/`DOCS_TH` resolved by `getDoc`), the i18n dictionary (`i18n.ts`), and the dashboard. Add three concept docs, one dashboard card, one inline tooltip primitive, and wire the existing page-level `HelpPopover` docHrefs that currently dead-link.

**Tech Stack:** Next.js (app router), TypeScript strict, React client components, existing i18n + docs registry. No Prisma, no API.

**Cannot run gates locally** (Node 18, no pnpm) → rely on CI for typecheck/test/build; hand-verify cross-file refs; Playwright run + first-time-user review against a throwaway account post-deploy.

---

### Task 1: New concept docs — `using-from-your-agent`, `graph`, `decisions` (EN)

**Files:**
- Modify: `apps/web/lib/brain/docs-content.ts` (add to `DOCS`, then `DOCS_SECTIONS`)

- [ ] **Step 1:** In `DOCS` (the EN record), after the `vocabulary` entry, add the `using-from-your-agent` page:

```ts
  "using-from-your-agent": {
    slug: "using-from-your-agent",
    title: "Using Brain from your agent",
    summary:
      "The exact prompts to type to Claude Code, Cursor, or any MCP client to drive your Brain day-to-day.",
    surfaces: ["dashboard"],
    sections: [
      {
        heading: "The daily loop, in plain prompts",
        body: [
          "Once your token is wired, you talk to the Brain through your AI agent in natural language. You don't call tools by hand — you ask, and the agent picks the right brain_* tool. Here are the prompts that map to each step.",
        ],
      },
      {
        heading: "1. Check the connection",
        body: ["Confirm the agent can see your Brain and projects before relying on it."],
        callout: "Do you have a connection to the Brain? Can you see any projects?",
      },
      {
        heading: "2. Point it at this workspace",
        body: ["Create or select the project this repo belongs to, so knowledge files under the right project."],
        callout: "Create a project in the Brain for this workspace and make it active.",
      },
      {
        heading: "3. Pull knowledge before you work",
        body: ["At the start of a task, have the agent open a session and apply what the Brain already knows."],
        callout: "Start a Brain session for this task and apply anything relevant it already knows.",
      },
      {
        heading: "4. Bank what you learned",
        body: ["At the end, close the session so the Brain can extract skills. This is the step that makes the Brain improve — skipping it is the #1 reason a Brain feels stagnant."],
        callout: "Transfer what we learned this session into the Brain, then close the session.",
      },
      {
        heading: "5. Ask the Oracle anything",
        body: ["Recall past decisions and patterns without re-deriving them."],
        callout: "Ask the Brain: what did we decide about <topic>?",
      },
    ],
    related: ["vocabulary", "tokens", "sessions", "oracle"],
    repoDoc: {
      label: "MCP tools reference",
      href: "https://github.com/bejranonda/BrainPlatform/blob/main/docs/MCP_TOOLS.md",
    },
  },
```

- [ ] **Step 2:** In `DOCS`, after the `decay` entry (end of core concepts), add the `graph` page:

```ts
  graph: {
    slug: "graph",
    title: "Graph",
    summary:
      "A visual map of how your skills connect — which rules relate, supersede, or cluster around the same topic.",
    surfaces: ["graph"],
    sections: [
      {
        heading: "What the graph shows",
        body: [
          "The graph is a bird's-eye view of your Brain. Each node is a skill; each edge is a relationship the Brain inferred — skills that share a topic, build on each other, or where one supersedes another.",
        ],
      },
      {
        heading: "How to read it",
        body: ["Use it to spot clusters (areas you've taught a lot) and orphans (skills with no connections, often one-offs)."],
        bullets: [
          "Node — one skill. Larger / brighter nodes are higher-confidence or more-used.",
          "Edge — a relationship between two skills (related topic or supersedes).",
          "Cluster — a group of tightly-linked skills around one theme.",
        ],
      },
      {
        heading: "Why it's useful",
        body: ["Clusters tell you where your Brain is strong; isolated nodes hint at knowledge that hasn't connected yet. It's a map, not a to-do list — nothing here needs action."],
      },
    ],
    related: ["skills", "decisions", "decay"],
  },
```

- [ ] **Step 3:** In `DOCS`, after `graph`, add the `decisions` page:

```ts
  decisions: {
    slug: "decisions",
    title: "Decisions",
    summary:
      "Settled project choices — the calls your team made and shouldn't re-litigate. Shared, and exempt from decay.",
    surfaces: ["decisions"],
    sections: [
      {
        heading: "What a decision is",
        body: [
          "A decision is a deliberate project choice: \"we'll use X\", \"deprecate Y\", \"Z owns auth\". Unlike an ordinary skill, a decision is shared project memory — every teammate's next session surfaces it — and it never decays. It stays until a newer decision supersedes it.",
        ],
      },
      {
        heading: "Where decisions come from",
        body: ["The agent records one when you state a project choice during a session, or you can teach one directly. A decision can name the rejected alternative (\"instead of …\") and, if it reverses an earlier call, point at the decision it supersedes."],
        bullets: [
          "Supersedes — this decision replaces an older one; the old one is retired, not deleted.",
          "Instead — the alternative that was considered and rejected.",
          "Scope — project decisions are visible to the whole project, not just you.",
        ],
      },
      {
        heading: "Why they're separate from skills",
        body: ["Skills are patterns the Brain learned and scores by how often they pay off; decisions are facts you asserted. Mixing them would let a stated choice quietly decay — so decisions get their own decay-exempt surface."],
      },
    ],
    related: ["skills", "sessions", "vocabulary"],
  },
```

- [ ] **Step 4:** Update `DOCS_SECTIONS` so the new slugs appear in the index. Change:

```ts
export const DOCS_SECTIONS: Array<{ id: string; heading: string; slugs: string[] }> = [
  { id: "start", heading: "Start here", slugs: ["vocabulary", "using-from-your-agent"] },
  { id: "core", heading: "Core concepts", slugs: ["skills", "oracle", "sessions", "autoskill", "decay", "graph", "decisions"] },
  { id: "connection", heading: "Connection & setup", slugs: ["tokens", "connection-status"] },
  { id: "deeper", heading: "Deeper", slugs: ["groundedness"] },
];
```

- [ ] **Step 5:** Verify EN structure compiles (typecheck depends on TH/DE parity? No — `getDoc` falls back to EN per-slug, so EN-only is valid at this step). Hand-check braces/commas.

- [ ] **Step 6:** Commit.

```bash
git add apps/web/lib/brain/docs-content.ts
git commit -m "feat(docs): add using-from-your-agent, graph, decisions concept pages (EN)"
```

---

### Task 2: TH/DE translations for the three new docs

**Files:**
- Modify: `apps/web/lib/brain/docs-content.ts` (`DOCS_DE`, `DOCS_TH`)

- [ ] **Step 1:** Add `using-from-your-agent`, `graph`, `decisions` entries to `DOCS_DE` mirroring the EN structure (same slugs, same section count), translated to German. AI-generated — these inherit the existing "awaiting native sweep" caveat already documented in the file header and `docs/KNOWN_ISSUES.md` (#59).

- [ ] **Step 2:** Add the same three entries to `DOCS_TH`, translated to Thai.

- [ ] **Step 3:** Hand-verify: each new slug exists in all three of `DOCS`, `DOCS_DE`, `DOCS_TH` with the **same `sections.length`** (parity the docs test asserts — see Task 6).

- [ ] **Step 4:** Commit.

```bash
git add apps/web/lib/brain/docs-content.ts
git commit -m "feat(docs,i18n): TH/DE for new concept pages (AI-generated, awaiting native sweep)"
```

---

### Task 3: `InfoDot` inline tooltip primitive

**Files:**
- Create: `apps/web/components/brain/info-dot.tsx`

- [ ] **Step 1:** Create `info-dot.tsx`:

```tsx
"use client";

import Link from "next/link";

interface InfoDotProps {
  /** One-line plain-English definition shown as the native tooltip. */
  tip: string;
  /** Concept slug to deep-link into /docs/concepts/<slug>. Optional —
   *  omit for terms with no dedicated concept page. */
  conceptSlug?: string;
  /** Accessible label prefix, e.g. the term being defined. */
  term: string;
}

/**
 * Inline, term-level "?" affordance. Distinct from the page-level
 * HelpPopover: this explains a single word where it appears (a badge, a
 * column header) and optionally links to the matching concept doc.
 *
 * Renders a superscript "?" that is keyboard-focusable and carries the
 * definition in its title + aria-label. When conceptSlug is set it is a
 * link to the concept page; otherwise a plain <span> (still tooltipped).
 */
export function InfoDot({ tip, conceptSlug, term }: InfoDotProps) {
  const label = `${term}: ${tip}`;
  const sharedStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: 14,
    marginLeft: 4,
    borderRadius: 7,
    border: "1px solid var(--line)",
    color: "var(--ink-3)",
    fontSize: 9,
    fontWeight: 600,
    lineHeight: 1,
    cursor: "help",
    verticalAlign: "middle",
    textDecoration: "none",
  };
  if (conceptSlug) {
    return (
      <Link
        href={`/docs/concepts/${conceptSlug}`}
        title={label}
        aria-label={`${label} — read more`}
        style={sharedStyle}
      >
        ?
      </Link>
    );
  }
  return (
    <span role="note" title={label} aria-label={label} style={sharedStyle}>
      ?
    </span>
  );
}
```

- [ ] **Step 2:** Typecheck mentally: `React.CSSProperties` requires importing nothing extra (global JSX namespace). Confirm `Link` import path matches repo usage (`next/link`, used in `docs/page.tsx`).

- [ ] **Step 3:** Commit.

```bash
git add apps/web/components/brain/info-dot.tsx
git commit -m "feat(ui): add InfoDot inline term-level tooltip primitive"
```

---

### Task 4: Apply `InfoDot` to skill-type badges + wire dead HelpPopover doc links

**Files:**
- Modify: `apps/web/components/brain/skills.tsx` (skill-type label/badge area)
- Modify: `apps/web/components/brain/graph.tsx` (HelpPopover `docHref`)
- Modify: `apps/web/components/brain/dashboard.tsx` — only if a decisions HelpPopover lives there; otherwise the decisions surface component

- [ ] **Step 1:** In `skills.tsx`, locate where the skill type is rendered (the badge/label showing recipe/heuristic/principle/reflex/anti_principle). Add an `InfoDot` next to the type filter header with `term="Skill type"`, `conceptSlug="skills"`, and `tip="recipe = step-by-step; rule of thumb = heuristic; principle = value; reflex = always-do; anti-pattern = never-do."`. Import: `import { InfoDot } from "./info-dot";`.

- [ ] **Step 2:** In `graph.tsx`, find the `HelpPopover` `content` object and set `docHref: "/docs/concepts/graph"` (the doc now exists from Task 1). If it already had a `docHref` pointing elsewhere/missing, replace it.

- [ ] **Step 3:** Find the decisions surface's `HelpPopover` (grep `HelpPopover` in the decisions component) and set `docHref: "/docs/concepts/decisions"`.

- [ ] **Step 4:** Hand-trace: every `docHref="/docs/concepts/<slug>"` now resolves to a slug present in `DOCS`. Grep: `grep -rn "docs/concepts/" apps/web/components apps/web/app` and confirm each slug ∈ DOCS keys.

- [ ] **Step 5:** Commit.

```bash
git add apps/web/components/brain/skills.tsx apps/web/components/brain/graph.tsx apps/web/components/brain/*.tsx
git commit -m "feat(ui): explain skill types inline; wire graph/decisions help to concept docs"
```

---

### Task 5: `AgentPromptsCard` on the dashboard

**Files:**
- Create: `apps/web/components/brain/agent-prompts-card.tsx`
- Modify: `apps/web/components/brain/dashboard.tsx` (render the card)
- Modify: `apps/web/lib/brain/i18n.ts` (`agentPrompts.*` keys in en/th/de)

- [ ] **Step 1:** Add an `agentPrompts` namespace under `en`, `th`, `de` in `i18n.ts`. EN keys:

```ts
    agentPrompts: {
      title: "Talk to your Brain",
      body: "Type these to your AI agent (Claude Code, Cursor, …). It picks the right tool for you.",
      copy: "Copy",
      copied: "Copied",
      more: "See all prompts →",
      collapsed: "Talk to your Brain →",
      p_check: "Do you have a connection to the Brain? Can you see any projects?",
      p_project: "Create a project in the Brain for this workspace and make it active.",
      p_close: "Transfer what we learned this session into the Brain, then close the session.",
    },
```

TH/DE: translate the human-readable strings (`title`, `body`, `copy`, `copied`, `more`, `collapsed`); **keep the `p_*` prompt values in English** — they are prompts the user types to an English-speaking agent, not UI chrome. (Document this choice in a code comment.)

- [ ] **Step 2:** Create `agent-prompts-card.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { useT } from "@/lib/brain/i18n";

const STORAGE_KEY = "bp_agent_prompts_dismissed";

interface Props {
  /** Total sessions ever. When 0, the card is expanded; once the user has a
   *  session it collapses to a one-line link (they've clearly connected). */
  sessionsAllTime: number;
}

/**
 * Dashboard card teaching the literal prompts to drive the Brain from an
 * agent. Expanded for brand-new users (no sessions, not dismissed); collapses
 * to a single link otherwise. Dismiss persists in localStorage — mirrors the
 * bp_onboarded pattern in onboarding.tsx.
 */
export function AgentPromptsCard({ sessionsAllTime }: Props) {
  const t = useT();
  const [dismissed, setDismissed] = useState(true); // SSR-safe default: collapsed
  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  const expanded = sessionsAllTime === 0 && !dismissed;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const prompts: Array<{ key: string; text: string }> = [
    { key: "p_check", text: t("agentPrompts.p_check") },
    { key: "p_project", text: t("agentPrompts.p_project") },
    { key: "p_close", text: t("agentPrompts.p_close") },
  ];

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      /* clipboard blocked (no HTTPS/iframe) — no-op, text is selectable */
    }
  };

  if (!expanded) {
    return (
      <a
        href="/docs/concepts/using-from-your-agent"
        className="btn btn-ghost"
        style={{ fontSize: 12, textDecoration: "none" }}
      >
        <Icon name="sparkle" size={11} /> {t("agentPrompts.collapsed")}
      </a>
    );
  }

  return (
    <div
      className="panel"
      style={{
        padding: "18px 20px",
        marginBottom: 14,
        borderLeft: "3px solid var(--accent)",
        background: "var(--bg-elev-1)",
      }}
    >
      <div className="row" style={{ alignItems: "center", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, letterSpacing: "-0.01em" }}>
          {t("agentPrompts.title")}
        </h2>
        <div className="grow" />
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 11, height: 22 }}
          aria-label="Dismiss"
          onClick={() => {
            window.localStorage.setItem(STORAGE_KEY, "true");
            setDismissed(true);
          }}
        >
          <Icon name="x" size={10} />
        </button>
      </div>
      <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
        {t("agentPrompts.body")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {prompts.map((p) => (
          <div
            key={p.key}
            className="row"
            style={{
              gap: 8,
              alignItems: "center",
              border: "1px solid var(--line)",
              borderRadius: 4,
              padding: "8px 10px",
              background: "var(--bg)",
            }}
          >
            <code className="mono" style={{ fontSize: 12, color: "var(--ink)", flex: 1, lineHeight: 1.5 }}>
              {p.text}
            </code>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 11, height: 24, whiteSpace: "nowrap" }}
              onClick={() => void copy(p.key, p.text)}
            >
              <Icon name="copy" size={11} /> {copiedKey === p.key ? t("agentPrompts.copied") : t("agentPrompts.copy")}
            </button>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <a
          href="/docs/concepts/using-from-your-agent"
          className="btn btn-ghost"
          style={{ fontSize: 12, textDecoration: "none" }}
        >
          {t("agentPrompts.more")}
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 2b:** Confirm `Icon` exports `sparkle`, `x`, `copy` (verified: present in `icons.tsx`).

- [ ] **Step 3:** In `dashboard.tsx`, import `AgentPromptsCard` and render it. Place it in BOTH the empty-state branch (near `EmptyBrainCallout`, around line 859) and the normal branch top, passing `sessionsAllTime={s.sessionsAllTime}`. The card self-collapses, so it's safe to render unconditionally in the normal branch. Import: `import { AgentPromptsCard } from "./agent-prompts-card";`.

- [ ] **Step 4:** Hand-trace `useDashboardStats` returns `s.sessionsAllTime` (verified at dashboard.tsx:804/878).

- [ ] **Step 5:** Commit.

```bash
git add apps/web/components/brain/agent-prompts-card.tsx apps/web/components/brain/dashboard.tsx apps/web/lib/brain/i18n.ts
git commit -m "feat(dashboard): add AgentPromptsCard with copyable agent prompts"
```

---

### Task 6: Polish existing flow + extend docs-parity test

**Files:**
- Modify: `apps/web/components/brain/onboarding.tsx` (final step link)
- Modify: `apps/web/components/brain/welcome-flow.tsx` (success-state link)
- Modify/Create: the docs registry test (find via `grep -rl "DOCS_SECTIONS\|getDoc" apps/web/**/*.test.ts apps/web/tests`)

- [ ] **Step 1:** In `onboarding.tsx`, in the final "Ask the Oracle" step body, add a line linking to `/docs/concepts/using-from-your-agent`: "New to driving Brain from your agent? See the prompts to type." (open same tab).

- [ ] **Step 2:** In `welcome-flow.tsx`, in the `firstSessionArrived` success block, add a secondary link to `/docs/concepts/using-from-your-agent` ("See the prompts to keep using it →").

- [ ] **Step 3:** Locate the docs test. If one exists asserting slug parity across langs, extend its slug list with the three new slugs. If none exists, create `apps/web/tests/docs-content.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DOCS, DOCS_SECTIONS, getDoc } from "@/lib/brain/docs-content";

const NEW = ["using-from-your-agent", "graph", "decisions"];

describe("docs registry", () => {
  it("exposes new concept slugs in the index", () => {
    const indexed = DOCS_SECTIONS.flatMap((s) => s.slugs);
    for (const slug of NEW) expect(indexed).toContain(slug);
  });

  it("resolves new slugs in every language with section parity", () => {
    for (const slug of NEW) {
      const en = getDoc("en", slug);
      expect(en, slug).toBeDefined();
      for (const lang of ["th", "de"] as const) {
        const p = getDoc(lang, slug);
        expect(p, `${slug}/${lang}`).toBeDefined();
        // EN fallback is acceptable, but if a localized page exists it must
        // match EN section count (no half-translated pages).
        expect(p!.sections.length).toBe(en!.sections.length);
      }
    }
  });

  it("has no dangling related slugs", () => {
    for (const slug of Object.keys(DOCS)) {
      for (const rel of DOCS[slug]!.related ?? []) {
        expect(DOCS[rel], `${slug} → ${rel}`).toBeDefined();
      }
    }
  });
});
```

(Adjust import alias / test runner to match the repo — confirm whether tests use vitest or jest by reading an existing `*.test.ts`.)

- [ ] **Step 4:** Commit.

```bash
git add apps/web/components/brain/onboarding.tsx apps/web/components/brain/welcome-flow.tsx apps/web/tests/docs-content.test.ts
git commit -m "feat(onboarding): link agent-prompts doc from modal + welcome; test docs parity"
```

---

### Task 7: Playwright e2e for the new surfaces

**Files:**
- Create: `apps/web/e2e/onboarding-orientation.spec.ts` (match existing e2e naming/patterns — read one first)

- [ ] **Step 1:** Read an existing spec in `apps/web/e2e` to copy the fixture/base-URL/auth pattern.

- [ ] **Step 2:** Write a spec covering (anon-accessible where possible):
  - `/docs` index shows cards titled "Using Brain from your agent", "Graph", "Decisions".
  - `/docs/concepts/using-from-your-agent` renders its heading and at least one `callout` prompt.
  - `/docs/concepts/graph` and `/docs/concepts/decisions` render (no 404).
  - Authenticated (if the fixture provides a session): dashboard shows the AgentPromptsCard, a copy button is present, and the dismiss button hides it across reload (localStorage).

- [ ] **Step 3:** Keep it chromium-only (repo halved e2e runtime to chromium per prior work) and within the existing project config.

- [ ] **Step 4:** Commit.

```bash
git add apps/web/e2e/onboarding-orientation.spec.ts
git commit -m "test(e2e): cover new orientation docs + dashboard prompts card"
```

---

### Task 8: PR, CI, merge, deploy, validate

- [ ] **Step 1:** Push branch, open PR with an honest test plan (what CI runs vs. what the operator must verify on a throwaway account).
- [ ] **Step 2:** `gh pr checks <n>` — wait for all required checks green. If CodeRabbit is the only "review", note it is not a real review (out of credits) and rely on CI + a code-reviewer agent if needed.
- [ ] **Step 3:** Confirm no migration: `git diff HEAD...origin/main -- packages/db/prisma/migrations/ | wc -l` == 0.
- [ ] **Step 4:** Merge on green (autonomous-CD policy B), then `./scripts/deploy.sh` (edge profile) and run the post-deploy smoke.
- [ ] **Step 5:** Playwright run + first-time-user review on a clearly-marked throwaway, non-admin account. Fix what it surfaces (bounded loop), re-verify.
- [ ] **Step 6:** File GitHub issues only for pre-existing bugs the review finds that are out of this PR's scope.
- [ ] **Step 7:** If warranted, cut a patch/minor release per semver (no migration in diff → inside autonomous-release envelope).
