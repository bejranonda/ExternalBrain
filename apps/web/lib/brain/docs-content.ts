/**
 * In-app documentation content.
 *
 * Source of truth for the /docs route and the "Learn more" links inside
 * HelpPopover. Keeps content close to the surfaces it explains so they
 * can stay in sync. The longer reference docs (HOW_IT_WORKS.md,
 * KNOWLEDGE.md, tutorials/*.md) remain in the repo for operator and
 * developer audiences — these in-app pages are user-facing primers.
 */

export interface DocSection {
  /** Section heading. */
  heading: string;
  /** Body paragraphs. Markdown-grade plain text; no html. */
  body: string[];
  /** Optional bullet list. */
  bullets?: string[];
  /** Optional code/callout block (rendered in a tinted panel). */
  callout?: string;
}

export interface DocPage {
  /** URL slug — `/docs/concepts/<slug>`. */
  slug: string;
  /** Plain-English title shown in the header and the docs index. */
  title: string;
  /** One-sentence summary used on the index card and OG-style preview. */
  summary: string;
  /** Which surfaces in the app link here (used by the page footer). */
  surfaces?: string[];
  /** Body sections — order matters; renders top-to-bottom. */
  sections: DocSection[];
  /** Slugs of related concept pages. */
  related?: string[];
  /** Optional pointer to a deeper repo doc on GitHub for power users. */
  repoDoc?: { label: string; href: string };
}

export const DOCS: Record<string, DocPage> = {
  // ─── Start here ───────────────────────────────────────────────────────────

  vocabulary: {
    slug: "vocabulary",
    title: "Vocabulary — the words you'll see",
    summary:
      "A one-page glossary so the words on every screen mean the same thing. New users start here.",
    surfaces: [],
    sections: [
      {
        heading: "The five words",
        body: [
          "External Brain has only five user-facing terms that matter. Everything else is built from these.",
        ],
        bullets: [
          "Brain — the shared memory layer for your AI coding sessions. Your Brain is the collection of skills it knows about you.",
          "Skill — a single rule, recipe, or principle the Brain learned (from sessions) or that you taught directly. Skills carry a type (recipe / rule of thumb / principle / reflex / anti-pattern).",
          "Session — one conversation between you and an AI coding tool (Claude Code, Cursor, Windsurf, Autobahn). Sessions feed the Brain — every closed session can produce skills.",
          "Oracle — the Q&A surface. Ask anything; the Oracle answers using your own skills + sessions, with citations.",
          "Proposal — a candidate skill the Brain noticed across recent sessions. You apply or reject; only applied ones become skills.",
        ],
      },
      {
        heading: "Why these names",
        body: [
          "Skill is the user-facing name for what the database calls Knowledge. The DB term is for power users + the API; everywhere else in the UI says 'skill'.",
          "Oracle is the question-answering surface. The actual LLM behind it (Claude, etc.) is intentionally abstracted — you ask the Oracle, not Claude.",
          "Proposal is what the Autoskill pipeline produces — pending skills waiting for your review. The route is /autoskill for backwards compatibility but the user-facing label is Proposals.",
        ],
      },
      {
        heading: "Words you'll see in tooltips (advanced)",
        body: ["These are real names but you don't need to know them to use the app."],
        bullets: [
          "KEA — Knowledge Extraction Agent. The background worker that reads finished sessions and proposes skills.",
          "KRA — Knowledge Retrieval Agent. The semantic-search step that picks which skills the Oracle cites.",
          "MCP — Model Context Protocol. The wire format your AI tool uses to talk to the Brain over HTTP.",
          "SQS — Session Quality Score. 0..1 number summarising whether your recent sessions are succeeding (target ≥ 0.70).",
        ],
      },
    ],
    related: ["skills", "oracle", "sessions", "autoskill"],
  },

  // ─── Core concepts ────────────────────────────────────────────────────────

  skills: {
    slug: "skills",
    title: "Skills",
    summary:
      "What your Brain knows. Each skill is a reusable rule, recipe, or principle the Brain captured from your sessions or that you taught it directly.",
    surfaces: ["Skills page", "Dashboard · Rules in your Brain", "Oracle citations"],
    sections: [
      {
        heading: "What a skill is",
        body: [
          "A skill is one piece of knowledge the Brain has captured. It has a trigger ('when this situation comes up'), a rule ('do this' or 'avoid this'), and an optional rationale ('because…'). Together they form a reusable answer the Oracle can cite next time you ask.",
        ],
      },
      {
        heading: "Five types — different shapes of knowledge",
        body: ["Skills carry a type so retrieval can rank them appropriately:"],
        bullets: [
          "Recipe — concrete how-to. \"When CORS fails with credentials, echo origin from allowlist + Vary: Origin.\"",
          "Rule of thumb — a default unless a reason exists otherwise. \"Prefer react-hook-form over Formik.\"",
          "Principle — a value-driven decision. \"Performance over abstraction in the hot path.\"",
          "Reflex — automatic, fast. \"On a Prisma migration, also bump the seed file.\"",
          "Anti-pattern — what NOT to do. \"Never pass a JWT in a query string.\"",
        ],
      },
      {
        heading: "Where skills come from",
        body: [
          "Two sources: extraction and teaching. After every session, KEA (Knowledge Extraction Agent) scans the events and proposes new skills as Skill Proposals — you review them in the Autoskill page. You can also teach a skill directly via the Teach button at any time.",
        ],
      },
      {
        heading: "How skills are scored",
        body: [
          "Each skill carries an effectiveness score derived from its outcomes when applied. ✓ green ≥ 0.70 (consistently helps), ~ yellow 0.40–0.69 (mixed), ✗ red < 0.40 (often unhelpful), — untested for skills with fewer than 3 outcomes. The retrieval engine boosts high-effectiveness skills and decays low-effectiveness ones.",
        ],
      },
    ],
    related: ["autoskill", "oracle", "decay"],
    repoDoc: { label: "KNOWLEDGE.md (full ontology)", href: "https://github.com/bejranonda/BrainPlatform/blob/main/docs/KNOWLEDGE.md" },
  },

  oracle: {
    slug: "oracle",
    title: "Oracle",
    summary:
      "Conversational interface to your own knowledge. Ask in plain language; answers cite the skills and sessions that supported each claim.",
    surfaces: ["Oracle page", "CmdK quick prompts", "Topbar search"],
    sections: [
      {
        heading: "What the Oracle does",
        body: [
          "The Oracle takes your question, retrieves the most relevant skills and past sessions from your Brain, and asks the LLM to answer using only that context. Every claim in the answer is tagged with a citation pointing back to its source — click [^K1] for a skill, [^S2] for a session.",
        ],
      },
      {
        heading: "Groundedness — how much Brain context was used",
        body: [
          "Each answer carries a groundedness label: strong, moderate, weak, or none. Strong means many high-relevance skills were retrieved; none means your Brain had nothing on the topic and the answer comes from the LLM's general knowledge. The Oracle says this honestly — no fake citations.",
        ],
      },
      {
        heading: "Feedback shapes future retrieval",
        body: [
          "Thumbs up/down on an answer bumps the effectiveness counters of the cited skills. Over time, high-effectiveness skills surface earlier; low-effectiveness ones decay faster. You can also click 'Why?' on a thumbs-down to tag the reason (irrelevant, wrong, outdated, missing context).",
        ],
      },
    ],
    related: ["skills", "decay", "groundedness"],
    repoDoc: { label: "HOW_IT_WORKS.md · Oracle", href: "https://github.com/bejranonda/BrainPlatform/blob/main/docs/HOW_IT_WORKS.md" },
  },

  sessions: {
    slug: "sessions",
    title: "Sessions",
    summary:
      "Every coding task your AI tools start lands here. Sessions are the raw material the Brain learns from.",
    surfaces: ["Sessions page", "Dashboard · Recent sessions"],
    sections: [
      {
        heading: "What a session is",
        body: [
          "A session is one task in your AI tool — start (with a prompt), middle (events: file edits, tool calls, build failures), end (an outcome: success, partial, failed, or in_progress if the tool never reported back).",
        ],
      },
      {
        heading: "What the Brain extracts from a session",
        body: [
          "After the session ends, KEA scans its events for patterns and proposes up to 3 new skills. The skills aren't applied automatically — they show up in Autoskill for your review. You see this loop in the Live activity panel on the dashboard.",
        ],
      },
      {
        heading: "Quality score (SQS)",
        body: [
          "Each ended session gets a Quality score (0–1) — a composite of acceptance, knowledge applied, and errors. ≥ 0.70 is the target. Trends across the last 12 sessions show on the dashboard chart.",
        ],
      },
    ],
    related: ["skills", "autoskill", "tokens"],
  },

  autoskill: {
    slug: "autoskill",
    title: "Autoskill — skill proposals",
    summary:
      "Patterns the Brain noticed but hasn't promoted to real skills yet. You review and accept, reject, or edit.",
    surfaces: ["Autoskill page", "Dashboard · Awaiting review", "Notifications drawer"],
    sections: [
      {
        heading: "Why proposals exist",
        body: [
          "When KEA spots a pattern across multiple sessions, it doesn't add it to your Skills list automatically — that would let noise creep in. Instead it queues a proposal with a confidence label (high / medium / low) and waits for your call.",
        ],
      },
      {
        heading: "What you do here",
        body: ["Three actions per proposal:"],
        bullets: [
          "Apply — promotes the proposal into a real skill. Shows up in Skills immediately and starts being retrieved.",
          "Reject — discards it. KEA learns from rejections and gets less likely to propose similar things.",
          "View diff — see what would change in your Brain if you accepted.",
        ],
      },
      {
        heading: "Auto-apply high confidence",
        body: [
          "Toggle on if you trust high-confidence proposals to land directly. Medium and low still wait for review. Off by default.",
        ],
      },
    ],
    related: ["skills", "sessions"],
  },

  decay: {
    slug: "decay",
    title: "Decay & freshness",
    summary:
      "Skills that aren't used or aren't effective fade over time. You see this as the 'Stale skills' counter on the dashboard.",
    sections: [
      {
        heading: "Why decay exists",
        body: [
          "A Brain that never forgets accumulates contradictions and out-of-date advice. Decay is a half-life mechanism — every skill has a decayScore between 0 and 1, where 1 is fresh and ≤ 0.3 is stale.",
        ],
      },
      {
        heading: "What makes a skill decay",
        body: [
          "Time since last use is the baseline (90-day half-life by default). Effectiveness modifies it: low-effectiveness skills with ≥ 5 outcomes decay 2× faster (45-day half-life); high-effectiveness skills decay half as fast (180-day half-life). New skills (< 3 outcomes) decay at baseline.",
        ],
      },
      {
        heading: "What stale means in practice",
        body: [
          "A stale skill is dimmed in the Skills list and ranked lower in retrieval. It isn't deleted — you can refresh it (re-apply or teach an updated version), retire it explicitly, or let it keep decaying. The 'Stale skills' counter on the dashboard is your queue.",
        ],
      },
    ],
    related: ["skills", "oracle"],
  },

  // ─── Connection / setup ───────────────────────────────────────────────────

  tokens: {
    slug: "tokens",
    title: "MCP tokens",
    summary:
      "Bearer tokens that authenticate your AI tools to this Brain. One per machine × tool keeps revocation precise.",
    surfaces: ["/settings/tokens", "Token install wizard", "Connection status card"],
    sections: [
      {
        heading: "Why tokens exist",
        body: [
          "The Brain's MCP server gates every call behind a Bearer token (including initialize). Tokens are how Claude Code, Cursor, Windsurf, etc. prove they're authorized to read and write your Brain.",
        ],
      },
      {
        heading: "Issuing and installing",
        body: [
          "Create a token in /settings/tokens, copy it once (it's hashed at rest — we can't show it again), paste it into your client's MCP config. The install wizard generates the exact snippet for each supported client.",
        ],
      },
      {
        heading: "Scope, rotate, revoke",
        body: [
          "A token can be unscoped, org-scoped, or project-scoped. Rotate changes the secret in place; clients keep working until you re-paste. Revoke disables the token entirely. The Verify button checks the token is still active server-side.",
        ],
      },
    ],
    related: ["connection-status", "sessions"],
    repoDoc: { label: "tutorials/04-managing-tokens.md", href: "https://github.com/bejranonda/BrainPlatform/blob/main/docs/tutorials/04-managing-tokens.md" },
  },

  "connection-status": {
    slug: "connection-status",
    title: "Connection status",
    summary:
      "Is your machine actually talking to Brain, and is knowledge being captured? The card on the dashboard answers both.",
    surfaces: ["Dashboard top card"],
    sections: [
      {
        heading: "Per-token heartbeat",
        body: [
          "Each row is one of your tokens. Green dot + 'Xs ago' = the token authenticated a call within the last 5 minutes. Grey + relative time = idle. Tokens that contributed in the last 24h also show 'Ns · Me' badges (sessions · events).",
        ],
      },
      {
        heading: "24-hour counters",
        body: [
          "Sessions, events, and skills extracted in the last 24 hours. Numbers > 0 prove that knowledge is being captured, not just authenticating. Counters are user-wide — they include sessions from any of your tokens plus webapp-initiated activity.",
        ],
      },
      {
        heading: "KEA queue depth",
        body: [
          "Pending kea.extract jobs in pg-boss. Steady non-zero depth means the worker isn't draining — usually a sign the worker container needs a look. Renders '—' when the pgboss schema isn't reachable from the webapp role.",
        ],
      },
    ],
    related: ["tokens", "sessions", "autoskill"],
  },

  // ─── Deeper concepts ──────────────────────────────────────────────────────

  groundedness: {
    slug: "groundedness",
    title: "Groundedness",
    summary:
      "How much of your Brain's context the Oracle had to draw from when answering. Visible on every Oracle answer.",
    sections: [
      {
        heading: "Four levels",
        body: ["Computed before the LLM call from the retrieval bundle:"],
        bullets: [
          "Strong — many high-relevance skills retrieved; answer is tightly grounded.",
          "Moderate — some relevant context; answer mixes Brain + general knowledge.",
          "Weak — few or low-relevance items; answer leans on general knowledge.",
          "None — your Brain had nothing on the topic. The Oracle says so explicitly and suppresses fake citations.",
        ],
      },
      {
        heading: "Why honesty matters here",
        body: [
          "A Brain that fabricates citations to look impressive is worse than one that admits 'no context.' When you see 'none', it's not a failure mode — it's the right signal that you should teach a skill on this topic so the next answer can ground.",
        ],
      },
    ],
    related: ["oracle", "skills"],
  },
};

/** Ordered list for the docs index, grouped by section. */
export const DOCS_SECTIONS: Array<{ heading: string; slugs: string[] }> = [
  { heading: "Start here", slugs: ["vocabulary"] },
  { heading: "Core concepts", slugs: ["skills", "oracle", "sessions", "autoskill", "decay"] },
  { heading: "Connection & setup", slugs: ["tokens", "connection-status"] },
  { heading: "Deeper", slugs: ["groundedness"] },
];

/** Helper for the "What surfaces link here" footer on each concept page. */
export function getDocBySurface(surfaceLabel: string): DocPage | null {
  for (const page of Object.values(DOCS)) {
    if (page.surfaces?.some((s) => s.toLowerCase().includes(surfaceLabel.toLowerCase()))) {
      return page;
    }
  }
  return null;
}
