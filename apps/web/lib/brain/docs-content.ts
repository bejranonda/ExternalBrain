/**
 * In-app documentation content.
 *
 * Source of truth for the /docs route and the "Learn more" links inside
 * HelpPopover. Keeps content close to the surfaces it explains so they
 * can stay in sync. The longer reference docs (HOW_IT_WORKS.md,
 * KNOWLEDGE.md, tutorials/*.md) remain in the repo for operator and
 * developer audiences — these in-app pages are user-facing primers.
 *
 * i18n: `DOCS` is the canonical EN content (also the source of truth for slugs
 * and `related` lookups). `DOCS_TH` / `DOCS_DE` are parallel translations;
 * `getDoc(lang, slug)` falls back to the EN page per-slug so a missing
 * translation degrades to English instead of a 404. AI-translated — TH/DE
 * prose still wants a native-speaker pass (issue #59).
 */

// Type-only import: erased at build time, so this server-renderable module
// does not pull in the "use client" i18n runtime.
import type { Lang } from "./i18n";

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
        body: [
          "Create or select the project this repo belongs to, so knowledge is filed under the right project.",
        ],
        callout: "Create a project in the Brain for this workspace and make it active.",
      },
      {
        heading: "3. Pull knowledge before you work",
        body: ["At the start of a task, have the agent open a session and apply what the Brain already knows."],
        callout: "Start a Brain session for this task and apply anything relevant it already knows.",
      },
      {
        heading: "4. Bank what you learned",
        body: [
          "At the end, close the session so the Brain can extract skills. This is the step that makes the Brain improve — skipping it is the #1 reason a Brain feels stagnant.",
        ],
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
      href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/MCP_TOOLS.md",
    },
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
        heading: "Five rule types",
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
        heading: "Decisions — a view, not a sixth type",
        body: [
          "The Decisions chip in the type filter is not a new type — it is a view of the principle / anti-pattern skills above that record a settled team choice (tagged as a decision). They carry the rejected alternative and never fade; they stay until a newer decision overturns them. \"We deploy from main only (not a develop branch).\"",
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
    repoDoc: { label: "Skill types explained for everyone (tutorial 07)", href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/tutorials/07-skill-types-explained.md" },
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
    repoDoc: { label: "HOW_IT_WORKS.md · Oracle", href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/HOW_IT_WORKS.md" },
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
          "Node — one skill. Larger or brighter nodes are higher-confidence or more-used.",
          "Edge — a relationship between two skills (related topic or supersedes).",
          "Cluster — a group of tightly-linked skills around one theme.",
        ],
      },
      {
        heading: "Why it's useful",
        body: [
          "Clusters tell you where your Brain is strong; isolated nodes hint at knowledge that hasn't connected yet. It's a map, not a to-do list — nothing here needs action.",
        ],
      },
    ],
    related: ["skills", "decisions", "decay"],
  },

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
        body: [
          "The agent records one when you state a project choice during a session, or you can teach one directly. A decision can name the rejected alternative and, if it reverses an earlier call, point at the decision it supersedes.",
        ],
        bullets: [
          "Supersedes — this decision replaces an older one; the old one is retired, not deleted.",
          "Instead — the alternative that was considered and rejected.",
          "Scope — project decisions are visible to the whole project, not just you.",
        ],
      },
      {
        heading: "Why they're separate from skills",
        body: [
          "Skills are patterns the Brain learned and scores by how often they pay off; decisions are facts you asserted. Mixing them would let a stated choice quietly decay — so decisions get their own decay-exempt surface.",
        ],
      },
    ],
    related: ["skills", "sessions", "vocabulary"],
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
    repoDoc: { label: "tutorials/04-managing-tokens.md", href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/tutorials/04-managing-tokens.md" },
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

/**
 * Ordered list for the docs index, grouped by section. `id` keys the localized
 * heading in DOCS_CHROME; `heading` is the EN fallback.
 */
export const DOCS_SECTIONS: Array<{ id: string; heading: string; slugs: string[] }> = [
  { id: "start", heading: "Start here", slugs: ["vocabulary", "using-from-your-agent"] },
  { id: "core", heading: "Core concepts", slugs: ["skills", "oracle", "sessions", "autoskill", "decay", "graph", "decisions"] },
  { id: "connection", heading: "Connection & setup", slugs: ["tokens", "connection-status"] },
  { id: "deeper", heading: "Deeper", slugs: ["groundedness"] },
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

// ───────────────────────────────────────────────────────────────────────────
// Translations (AI-generated; pending native-speaker review — issue #59).
// Convention mirrors lib/brain/i18n.ts: translate prose, keep technical /
// product terms in Latin script (Brain, Skill, Oracle, Session, Proposal, KEA,
// KRA, MCP, SQS, CORS, JWT, Prisma, Claude Code, Cursor, Windsurf, Autobahn).
// ───────────────────────────────────────────────────────────────────────────

/** German (Deutsch). */
const DOCS_DE: Record<string, DocPage> = {
  vocabulary: {
    slug: "vocabulary",
    title: "Vokabular — die Wörter, die du sehen wirst",
    summary:
      "Ein einseitiges Glossar, damit die Wörter auf jedem Bildschirm dasselbe bedeuten. Neue Nutzer fangen hier an.",
    surfaces: [],
    sections: [
      {
        heading: "Die fünf Wörter",
        body: [
          "External Brain hat nur fünf nutzerseitige Begriffe, auf die es ankommt. Alles andere baut darauf auf.",
        ],
        bullets: [
          "Brain — die geteilte Gedächtnisschicht für deine AI-Coding-Sessions. Dein Brain ist die Sammlung von Skills, die es über dich kennt.",
          "Skill — eine einzelne Regel, ein Rezept oder ein Prinzip, das das Brain gelernt (aus Sessions) oder das du ihm direkt beigebracht hast. Skills tragen einen Typ (Rezept / Faustregel / Prinzip / Reflex / Anti-Pattern).",
          "Session — ein Gespräch zwischen dir und einem AI-Coding-Tool (Claude Code, Cursor, Windsurf, Autobahn). Sessions speisen das Brain — jede geschlossene Session kann Skills erzeugen.",
          "Oracle — die Frage-und-Antwort-Oberfläche. Frag alles; das Oracle antwortet mit deinen eigenen Skills + Sessions, mit Quellenangaben.",
          "Proposal — ein Skill-Kandidat, den das Brain über jüngste Sessions hinweg bemerkt hat. Du nimmst an oder lehnst ab; nur angenommene werden zu Skills.",
        ],
      },
      {
        heading: "Warum diese Namen",
        body: [
          "Skill ist der nutzerseitige Name für das, was die Datenbank Knowledge nennt. Der DB-Begriff ist für Power-User + die API; überall sonst in der UI heißt es „Skill“.",
          "Oracle ist die Oberfläche, die Fragen beantwortet. Das eigentliche LLM dahinter (Claude usw.) ist bewusst abstrahiert — du fragst das Oracle, nicht Claude.",
          "Proposal ist das, was die Autoskill-Pipeline produziert — ausstehende Skills, die auf deine Prüfung warten. Die Route ist /autoskill aus Kompatibilitätsgründen, aber das nutzerseitige Label ist Proposals.",
        ],
      },
      {
        heading: "Wörter, die du in Tooltips siehst (fortgeschritten)",
        body: ["Das sind echte Namen, aber du musst sie nicht kennen, um die App zu nutzen."],
        bullets: [
          "KEA — Knowledge Extraction Agent. Der Hintergrund-Worker, der fertige Sessions liest und Skills vorschlägt.",
          "KRA — Knowledge Retrieval Agent. Der Schritt der semantischen Suche, der auswählt, welche Skills das Oracle zitiert.",
          "MCP — Model Context Protocol. Das Wire-Format, mit dem dein AI-Tool über HTTP mit dem Brain spricht.",
          "SQS — Session Quality Score. Eine Zahl von 0..1, die zusammenfasst, ob deine jüngsten Sessions erfolgreich sind (Ziel ≥ 0,70).",
        ],
      },
    ],
    related: ["skills", "oracle", "sessions", "autoskill"],
  },

  "using-from-your-agent": {
    slug: "using-from-your-agent",
    title: "Brain aus deinem Agenten nutzen",
    summary:
      "Die genauen Prompts, die du an Claude Code, Cursor oder einen beliebigen MCP-Client schickst, um dein Brain im Alltag zu steuern.",
    surfaces: ["dashboard"],
    sections: [
      {
        heading: "Die tägliche Schleife, in einfachen Prompts",
        body: [
          "Sobald dein Token eingerichtet ist, sprichst du über deinen AI-Agenten in natürlicher Sprache mit dem Brain. Du rufst keine Tools von Hand auf — du fragst, und der Agent wählt das passende brain_*-Tool. Hier sind die Prompts für jeden Schritt.",
        ],
      },
      {
        heading: "1. Verbindung prüfen",
        body: ["Vergewissere dich, dass der Agent dein Brain und deine Projekte sieht, bevor du dich darauf verlässt."],
        callout: "Do you have a connection to the Brain? Can you see any projects?",
      },
      {
        heading: "2. Auf diesen Workspace ausrichten",
        body: [
          "Erstelle oder wähle das Projekt, zu dem dieses Repo gehört, damit Wissen unter dem richtigen Projekt abgelegt wird.",
        ],
        callout: "Create a project in the Brain for this workspace and make it active.",
      },
      {
        heading: "3. Wissen abrufen, bevor du arbeitest",
        body: ["Lass den Agenten zu Beginn einer Aufgabe eine Session öffnen und anwenden, was das Brain bereits weiß."],
        callout: "Start a Brain session for this task and apply anything relevant it already knows.",
      },
      {
        heading: "4. Gelerntes sichern",
        body: [
          "Schließe am Ende die Session, damit das Brain Skills extrahieren kann. Dieser Schritt lässt das Brain besser werden — ihn auszulassen ist der häufigste Grund, warum sich ein Brain stagnierend anfühlt.",
        ],
        callout: "Transfer what we learned this session into the Brain, then close the session.",
      },
      {
        heading: "5. Frag das Oracle alles",
        body: ["Rufe frühere Entscheidungen und Muster ab, ohne sie neu herzuleiten."],
        callout: "Ask the Brain: what did we decide about <topic>?",
      },
    ],
    related: ["vocabulary", "tokens", "sessions", "oracle"],
    repoDoc: {
      label: "MCP-Tools-Referenz",
      href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/MCP_TOOLS.md",
    },
  },

  skills: {
    slug: "skills",
    title: "Skills",
    summary:
      "Was dein Brain weiß. Jeder Skill ist eine wiederverwendbare Regel, ein Rezept oder ein Prinzip, das das Brain aus deinen Sessions erfasst hat oder das du ihm direkt beigebracht hast.",
    surfaces: ["Skills page", "Dashboard · Rules in your Brain", "Oracle citations"],
    sections: [
      {
        heading: "Was ein Skill ist",
        body: [
          "Ein Skill ist ein Stück Wissen, das das Brain erfasst hat. Er hat einen Trigger („wenn diese Situation auftritt“), eine Regel („tu dies“ oder „vermeide dies“) und eine optionale Begründung („weil …“). Zusammen ergeben sie eine wiederverwendbare Antwort, die das Oracle beim nächsten Mal zitieren kann.",
        ],
      },
      {
        heading: "Fünf Regeltypen",
        body: ["Skills tragen einen Typ, damit das Retrieval sie passend einordnen kann:"],
        bullets: [
          "Rezept — konkrete Anleitung. „Wenn CORS mit Credentials fehlschlägt, gib den Origin aus der Allowlist zurück + Vary: Origin.“",
          "Faustregel — ein Standard, sofern kein Grund dagegen spricht. „Bevorzuge react-hook-form gegenüber Formik.“",
          "Prinzip — eine wertegetriebene Entscheidung. „Performance vor Abstraktion im Hot Path.“",
          "Reflex — automatisch, schnell. „Bei einer Prisma-Migration auch die Seed-Datei anpassen.“",
          "Anti-Pattern — was man NICHT tun sollte. „Niemals ein JWT in einem Query-String übergeben.“",
        ],
      },
      {
        heading: "Decisions — eine Ansicht, kein sechster Typ",
        body: [
          "Der Decisions-Chip im Typ-Filter ist kein neuer Typ, sondern eine Ansicht der oben genannten Prinzip-/Anti-Pattern-Skills, die eine beschlossene Team-Festlegung festhalten (als Decision getaggt). Sie enthalten die verworfene Alternative und verblassen nie; sie gelten, bis eine neuere Entscheidung sie ablöst. „Deploy nur von main (kein develop-Branch).“",
        ],
      },
      {
        heading: "Woher Skills kommen",
        body: [
          "Zwei Quellen: Extraktion und Beibringen. Nach jeder Session scannt KEA (Knowledge Extraction Agent) die Events und schlägt neue Skills als Skill Proposals vor — du prüfst sie auf der Autoskill-Seite. Du kannst einen Skill auch jederzeit direkt über den Teach-Button beibringen.",
        ],
      },
      {
        heading: "Wie Skills bewertet werden",
        body: [
          "Jeder Skill trägt einen Effektivitätswert, der aus seinen Ergebnissen bei der Anwendung abgeleitet wird. ✓ grün ≥ 0,70 (hilft durchgängig), ~ gelb 0,40–0,69 (gemischt), ✗ rot < 0,40 (oft nutzlos), — ungetestet bei Skills mit weniger als 3 Ergebnissen. Das Retrieval hebt Skills mit hoher Effektivität an und lässt solche mit niedriger verfallen.",
        ],
      },
    ],
    related: ["autoskill", "oracle", "decay"],
    repoDoc: { label: "Skill types explained for everyone (tutorial 07)", href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/tutorials/07-skill-types-explained.md" },
  },

  oracle: {
    slug: "oracle",
    title: "Oracle",
    summary:
      "Konversationelle Schnittstelle zu deinem eigenen Wissen. Frag in natürlicher Sprache; Antworten zitieren die Skills und Sessions, die jede Aussage gestützt haben.",
    surfaces: ["Oracle page", "CmdK quick prompts", "Topbar search"],
    sections: [
      {
        heading: "Was das Oracle tut",
        body: [
          "Das Oracle nimmt deine Frage, holt die relevantesten Skills und vergangenen Sessions aus deinem Brain und bittet das LLM, nur mit diesem Kontext zu antworten. Jede Aussage in der Antwort ist mit einer Quellenangabe versehen, die auf ihren Ursprung zurückverweist — klicke [^K1] für einen Skill, [^S2] für eine Session.",
        ],
      },
      {
        heading: "Groundedness — wie viel Brain-Kontext genutzt wurde",
        body: [
          "Jede Antwort trägt ein Groundedness-Label: strong, moderate, weak oder none. Strong heißt, viele hochrelevante Skills wurden abgerufen; none heißt, dein Brain hatte nichts zum Thema und die Antwort stammt aus dem Allgemeinwissen des LLM. Das Oracle sagt das ehrlich — keine erfundenen Quellenangaben.",
        ],
      },
      {
        heading: "Feedback formt künftiges Retrieval",
        body: [
          "Daumen hoch/runter zu einer Antwort verschiebt die Effektivitäts-Zähler der zitierten Skills. Mit der Zeit erscheinen Skills mit hoher Effektivität früher; solche mit niedriger verfallen schneller. Du kannst bei einem Daumen runter auch auf „Warum?“ klicken, um den Grund zu markieren (irrelevant, falsch, veraltet, fehlender Kontext).",
        ],
      },
    ],
    related: ["skills", "decay", "groundedness"],
    repoDoc: { label: "HOW_IT_WORKS.md · Oracle", href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/HOW_IT_WORKS.md" },
  },

  sessions: {
    slug: "sessions",
    title: "Sessions",
    summary:
      "Jede Coding-Aufgabe, die deine AI-Tools starten, landet hier. Sessions sind das Rohmaterial, aus dem das Brain lernt.",
    surfaces: ["Sessions page", "Dashboard · Recent sessions"],
    sections: [
      {
        heading: "Was eine Session ist",
        body: [
          "Eine Session ist eine Aufgabe in deinem AI-Tool — Start (mit einem Prompt), Mitte (Events: Datei-Änderungen, Tool-Aufrufe, Build-Fehler), Ende (ein Ergebnis: success, partial, failed oder in_progress, wenn das Tool nie zurückgemeldet hat).",
        ],
      },
      {
        heading: "Was das Brain aus einer Session extrahiert",
        body: [
          "Nach Ende der Session scannt KEA deren Events nach Mustern und schlägt bis zu 3 neue Skills vor. Die Skills werden nicht automatisch angewendet — sie erscheinen in Autoskill zu deiner Prüfung. Du siehst diese Schleife im Live-Activity-Panel auf dem Dashboard.",
        ],
      },
      {
        heading: "Qualitätswert (SQS)",
        body: [
          "Jede beendete Session erhält einen Qualitätswert (0–1) — eine Zusammensetzung aus Akzeptanz, angewandtem Wissen und Fehlern. ≥ 0,70 ist das Ziel. Trends über die letzten 12 Sessions zeigt das Dashboard-Diagramm.",
        ],
      },
    ],
    related: ["skills", "autoskill", "tokens"],
  },

  autoskill: {
    slug: "autoskill",
    title: "Autoskill — Skill-Vorschläge",
    summary:
      "Muster, die das Brain bemerkt, aber noch nicht zu echten Skills befördert hat. Du prüfst und nimmst an, lehnst ab oder bearbeitest.",
    surfaces: ["Autoskill page", "Dashboard · Awaiting review", "Notifications drawer"],
    sections: [
      {
        heading: "Warum es Proposals gibt",
        body: [
          "Wenn KEA ein Muster über mehrere Sessions hinweg entdeckt, fügt es das nicht automatisch deiner Skills-Liste hinzu — so würde Rauschen einsickern. Stattdessen stellt es ein Proposal mit einem Konfidenz-Label (high / medium / low) in die Warteschlange und wartet auf deine Entscheidung.",
        ],
      },
      {
        heading: "Was du hier tust",
        body: ["Drei Aktionen pro Proposal:"],
        bullets: [
          "Apply — befördert das Proposal zu einem echten Skill. Erscheint sofort in Skills und wird abgerufen.",
          "Reject — verwirft es. KEA lernt aus Ablehnungen und schlägt Ähnliches seltener vor.",
          "View diff — sieh, was sich in deinem Brain ändern würde, wenn du annimmst.",
        ],
      },
      {
        heading: "High-Konfidenz automatisch anwenden",
        body: [
          "Schalte es ein, wenn du High-Konfidenz-Proposals zutraust, direkt zu landen. Medium und low warten weiterhin auf Prüfung. Standardmäßig aus.",
        ],
      },
    ],
    related: ["skills", "sessions"],
  },

  decay: {
    slug: "decay",
    title: "Decay & Frische",
    summary:
      "Skills, die nicht genutzt werden oder nicht effektiv sind, verblassen mit der Zeit. Du siehst das als Zähler „Stale skills“ auf dem Dashboard.",
    sections: [
      {
        heading: "Warum es Decay gibt",
        body: [
          "Ein Brain, das nie vergisst, sammelt Widersprüche und veralteten Rat an. Decay ist ein Halbwertszeit-Mechanismus — jeder Skill hat einen decayScore zwischen 0 und 1, wobei 1 frisch und ≤ 0,3 stale ist.",
        ],
      },
      {
        heading: "Was einen Skill verfallen lässt",
        body: [
          "Die Zeit seit der letzten Nutzung ist die Basis (standardmäßig 90 Tage Halbwertszeit). Effektivität verändert das: Skills mit niedriger Effektivität und ≥ 5 Ergebnissen verfallen 2× schneller (45 Tage Halbwertszeit); Skills mit hoher Effektivität verfallen halb so schnell (180 Tage Halbwertszeit). Neue Skills (< 3 Ergebnisse) verfallen mit der Basisrate.",
        ],
      },
      {
        heading: "Was stale in der Praxis bedeutet",
        body: [
          "Ein staler Skill wird in der Skills-Liste gedimmt und im Retrieval niedriger eingestuft. Er wird nicht gelöscht — du kannst ihn auffrischen (erneut anwenden oder eine aktualisierte Version beibringen), ihn ausdrücklich zurückziehen oder ihn weiter verfallen lassen. Der Zähler „Stale skills“ auf dem Dashboard ist deine Warteschlange.",
        ],
      },
    ],
    related: ["skills", "oracle"],
  },

  graph: {
    slug: "graph",
    title: "Graph",
    summary:
      "Eine visuelle Karte, wie deine Skills zusammenhängen — welche Regeln verwandt sind, einander ersetzen oder sich um dasselbe Thema gruppieren.",
    surfaces: ["graph"],
    sections: [
      {
        heading: "Was der Graph zeigt",
        body: [
          "Der Graph ist die Vogelperspektive auf dein Brain. Jeder Knoten ist ein Skill; jede Kante ist eine Beziehung, die das Brain abgeleitet hat — Skills, die ein Thema teilen, aufeinander aufbauen oder bei denen einer einen anderen ersetzt.",
        ],
      },
      {
        heading: "Wie man ihn liest",
        body: ["Nutze ihn, um Cluster (Bereiche, in denen du viel beigebracht hast) und Ausreißer (Skills ohne Verbindungen, oft Einzelfälle) zu erkennen."],
        bullets: [
          "Knoten — ein Skill. Größere oder hellere Knoten haben höhere Konfidenz oder werden öfter genutzt.",
          "Kante — eine Beziehung zwischen zwei Skills (verwandtes Thema oder Ersetzung).",
          "Cluster — eine Gruppe eng verbundener Skills zu einem Thema.",
        ],
      },
      {
        heading: "Warum er nützlich ist",
        body: [
          "Cluster zeigen, wo dein Brain stark ist; isolierte Knoten deuten auf Wissen hin, das sich noch nicht verbunden hat. Es ist eine Karte, keine To-do-Liste — hier ist keine Aktion nötig.",
        ],
      },
    ],
    related: ["skills", "decisions", "decay"],
  },

  decisions: {
    slug: "decisions",
    title: "Entscheidungen",
    summary:
      "Feststehende Projektentscheidungen — die Festlegungen deines Teams, die nicht neu verhandelt werden sollten. Geteilt und vom Verfall ausgenommen.",
    surfaces: ["decisions"],
    sections: [
      {
        heading: "Was eine Entscheidung ist",
        body: [
          "Eine Entscheidung ist eine bewusste Projektfestlegung: „wir nutzen X“, „Y wird abgekündigt“, „Z verantwortet Auth“. Anders als ein normaler Skill ist eine Entscheidung geteiltes Projektgedächtnis — sie taucht in der nächsten Session jedes Teammitglieds auf — und sie verfällt nie. Sie bleibt, bis eine neuere Entscheidung sie ersetzt.",
        ],
      },
      {
        heading: "Woher Entscheidungen kommen",
        body: [
          "Der Agent hält eine fest, wenn du während einer Session eine Projektfestlegung äußerst, oder du bringst sie direkt bei. Eine Entscheidung kann die verworfene Alternative benennen und, falls sie eine frühere Festlegung umkehrt, auf die Entscheidung verweisen, die sie ersetzt.",
        ],
        bullets: [
          "Ersetzt — diese Entscheidung löst eine ältere ab; die alte wird zurückgezogen, nicht gelöscht.",
          "Stattdessen — die Alternative, die erwogen und verworfen wurde.",
          "Scope — Projektentscheidungen sind für das ganze Projekt sichtbar, nicht nur für dich.",
        ],
      },
      {
        heading: "Warum sie von Skills getrennt sind",
        body: [
          "Skills sind Muster, die das Brain gelernt hat und danach bewertet, wie oft sie sich auszahlen; Entscheidungen sind Fakten, die du behauptet hast. Eine Vermischung würde eine getroffene Festlegung still verfallen lassen — deshalb bekommen Entscheidungen ihre eigene, verfallsfreie Fläche.",
        ],
      },
    ],
    related: ["skills", "sessions", "vocabulary"],
  },

  tokens: {
    slug: "tokens",
    title: "MCP-Tokens",
    summary:
      "Bearer-Tokens, die deine AI-Tools bei diesem Brain authentifizieren. Eins pro Maschine × Tool hält den Entzug präzise.",
    surfaces: ["/settings/tokens", "Token install wizard", "Connection status card"],
    sections: [
      {
        heading: "Warum es Tokens gibt",
        body: [
          "Der MCP-Server des Brains sichert jeden Aufruf hinter einem Bearer-Token (einschließlich initialize). Tokens sind die Art, wie Claude Code, Cursor, Windsurf usw. nachweisen, dass sie berechtigt sind, dein Brain zu lesen und zu schreiben.",
        ],
      },
      {
        heading: "Ausstellen und installieren",
        body: [
          "Erstelle ein Token unter /settings/tokens, kopiere es einmal (es wird im Ruhezustand gehasht — wir können es nicht erneut anzeigen) und füge es in die MCP-Konfiguration deines Clients ein. Der Install-Wizard erzeugt das genaue Snippet für jeden unterstützten Client.",
        ],
      },
      {
        heading: "Scope, Rotation, Entzug",
        body: [
          "Ein Token kann unscoped, org-scoped oder project-scoped sein. Rotate ändert das Secret an Ort und Stelle; Clients funktionieren weiter, bis du es erneut einfügst. Revoke deaktiviert das Token vollständig. Der Verify-Button prüft serverseitig, ob das Token noch aktiv ist.",
        ],
      },
    ],
    related: ["connection-status", "sessions"],
    repoDoc: { label: "tutorials/04-managing-tokens.md", href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/tutorials/04-managing-tokens.md" },
  },

  "connection-status": {
    slug: "connection-status",
    title: "Verbindungsstatus",
    summary:
      "Spricht deine Maschine wirklich mit dem Brain, und wird Wissen erfasst? Die Karte auf dem Dashboard beantwortet beides.",
    surfaces: ["Dashboard top card"],
    sections: [
      {
        heading: "Heartbeat pro Token",
        body: [
          "Jede Zeile ist eines deiner Tokens. Grüner Punkt + „vor Xs“ = das Token hat innerhalb der letzten 5 Minuten einen Aufruf authentifiziert. Grau + relative Zeit = inaktiv. Tokens, die in den letzten 24 h beigetragen haben, zeigen auch „Ns · Me“-Badges (Sessions · Events).",
        ],
      },
      {
        heading: "24-Stunden-Zähler",
        body: [
          "Sessions, Events und in den letzten 24 Stunden extrahierte Skills. Zahlen > 0 beweisen, dass Wissen erfasst wird, nicht nur authentifiziert. Die Zähler gelten nutzerweit — sie schließen Sessions von all deinen Tokens plus webapp-initiierte Aktivität ein.",
        ],
      },
      {
        heading: "KEA-Warteschlangentiefe",
        body: [
          "Ausstehende kea.extract-Jobs in pg-boss. Eine stetig nicht-null Tiefe heißt, der Worker arbeitet nicht ab — meist ein Zeichen, dass der Worker-Container geprüft werden muss. Zeigt „—“, wenn das pgboss-Schema von der Webapp-Rolle nicht erreichbar ist.",
        ],
      },
    ],
    related: ["tokens", "sessions", "autoskill"],
  },

  groundedness: {
    slug: "groundedness",
    title: "Groundedness",
    summary:
      "Wie viel von deinem Brain-Kontext das Oracle bei der Antwort heranziehen musste. Sichtbar bei jeder Oracle-Antwort.",
    sections: [
      {
        heading: "Vier Stufen",
        body: ["Vor dem LLM-Aufruf aus dem Retrieval-Bündel berechnet:"],
        bullets: [
          "Strong — viele hochrelevante Skills abgerufen; die Antwort ist eng verankert.",
          "Moderate — etwas relevanter Kontext; die Antwort mischt Brain + Allgemeinwissen.",
          "Weak — wenige oder gering relevante Einträge; die Antwort stützt sich auf Allgemeinwissen.",
          "None — dein Brain hatte nichts zum Thema. Das Oracle sagt das ausdrücklich und unterdrückt erfundene Quellenangaben.",
        ],
      },
      {
        heading: "Warum Ehrlichkeit hier zählt",
        body: [
          "Ein Brain, das Quellenangaben erfindet, um beeindruckend zu wirken, ist schlimmer als eines, das „kein Kontext“ zugibt. Wenn du „none“ siehst, ist das kein Fehlerfall — es ist das richtige Signal, dass du zu diesem Thema einen Skill beibringen solltest, damit die nächste Antwort verankert sein kann.",
        ],
      },
    ],
    related: ["oracle", "skills"],
  },
};

/** Thai (ไทย). */
const DOCS_TH: Record<string, DocPage> = {
  vocabulary: {
    slug: "vocabulary",
    title: "คำศัพท์น่ารู้ — ศัพท์สำคัญที่คุณจะได้พบ",
    summary:
      "อภิธานศัพท์สรุปในหน้าเดียว เพื่อให้คำศัพท์บนทุกหน้าจอตรงกัน ผู้ใช้ใหม่เริ่มต้นได้ที่นี่",
    surfaces: [],
    sections: [
      {
        heading: "5 คำหลักที่สำคัญ",
        body: [
          "External Brain มีคำศัพท์สำคัญฝั่งผู้ใช้ที่ต้องจำเพียง 5 คำเท่านั้น ส่วนประกอบอื่นๆ ทั้งหมดต่อยอดมาจาก 5 คำนี้",
        ],
        bullets: [
          "Brain — คลังความรู้และหน่วยความจำกลางสำหรับเซสชันเขียนโค้ด AI ของคุณ Brain คือชุดรวมของสกิลทั้งหมดที่ระบบเรียนรู้เกี่ยวกับคุณ",
          "Skill — กฎ ข้อสรุป สูตร หรือหลักการที่ Brain เรียนรู้ (จากเซสชัน) หรือที่คุณเพิ่มเข้าไปโดยตรง สกิลมีประเภทกำกับ (สูตรขั้นตอน / แนวทางปฏิบัติ / หลักการ / การตอบสนองอัตโนมัติ / สิ่งที่ควรหลีกเลี่ยง)",
          "Session — บทสนทนาและการทำงาน 1 ครั้งระหว่างคุณกับเครื่องมือเขียนโค้ด AI (Claude Code, Cursor, Windsurf, Autobahn) เซสชันคือวัตถุดิบป้อนเข้า Brain — เมื่อจบเซสชันจะสกัดออกมาเป็นสกิลได้",
          "Oracle — หน้าถาม-ตอบระบบอัจฉริยะ ถามอะไรก็ได้ Oracle จะประมวลผลคำตอบโดยใช้อ้างอิงจากสกิลและเซสชันใน Brain ของคุณ",
          "Proposal — ข้อเสนอสกิลใหม่ที่ Brain ตรวจพบจากเซสชันล่าสุด คุณสามารถเลือกอนุมัติหรือปฏิเสธได้ โดยมีเฉพาะข้อเสนอที่อนุมัติแล้วเท่านั้นที่จะกลายเป็นสกิลจริง",
        ],
      },
      {
        heading: "ที่มาของชื่อเหล่านี้",
        body: [
          "Skill คือชื่อเรียกฝั่ง UI สำหรับสิ่งที่ฐานข้อมูลเรียกว่า Knowledge (คำว่า Knowledge จะใช้ใน API และสำหรับ Power user เท่านั้น ส่วนหน้าจอ UI ทั้งหมดจะใช้คำว่า 'Skill')",
          "Oracle คือระบบถาม-ตอบของ External Brain โดยตั้งใจซ่อนชื่อโมเดล LLM ทีู่่เบื้องหลัง (Claude ฯลฯ) เพื่อให้คุณสื่อสารผ่าน Oracle โดยตรง",
          "Proposal คือข้อเสนอที่สร้างจากไปป์ไลน์ Autoskill — เป็นสกิลรอดำเนินการที่รอการตรวจสอบของคุณ (เส้นทาง URL ใช้ /autoskill แต่บนหน้าจอจะแสดงคำว่า Proposals หรือข้อเสนอสกิล)",
        ],
      },
      {
        heading: "คำศัพท์ระดับสูงใน Tooltip",
        body: ["คำศัพท์เหล่านี้เป็นชื่อทางเทคนิค ซึ่งคุณไม่จำเป็นต้องจำก็สามารถใช้งานแอปได้ตามปกติ"],
        bullets: [
          "KEA — Knowledge Extraction Agent เวิร์กเกอร์เบื้องหลังที่อ่านเซสชันที่จบแล้วและเสนอสกิลใหม่",
          "KRA — Knowledge Retrieval Agent ระบบค้นคืนเชิงความหมายที่เลือกว่า Oracle จะอ้างอิงสกิลใดบ้าง",
          "MCP — Model Context Protocol โปรโตคอลมาตรฐานที่เครื่องมือ AI ของคุณใช้สื่อสารกับ Brain ผ่าน HTTP",
          "SQS — Session Quality Score คะแนน 0..1 สรุปคุณภาพเซสชันล่าสุดของคุณว่าราบรื่นเพียงใด (เป้าหมาย ≥ 0.70)",
        ],
      },
    ],
    related: ["skills", "oracle", "sessions", "autoskill"],
  },

  "using-from-your-agent": {
    slug: "using-from-your-agent",
    title: "วิธีสั่งงาน Brain ผ่าน AI Agent",
    summary:
      "ตัวอย่างคำสั่งธรรมชาติสำหรับป้อนให้ Claude Code, Cursor หรือ MCP Client ใดก็ได้ เพื่อใช้งาน Brain ในประจำวัน",
    surfaces: ["dashboard"],
    sections: [
      {
        heading: "ขั้นตอนประจำวัน ด้วยคำสั่งภาษาธรรมชาติ",
        body: [
          "เมื่อเชื่อมต่อโทเค็นแล้ว คุณสามารถสื่อสารกับ Brain ผ่าน AI agent ด้วยภาษาธรรมชาติได้ทันที ไม่ต้องเรียกใช้เครื่องมือด้วยตัวเอง เพียงแค่พิมพ์คำถาม แล้ว agent จะเลือกใช้เครื่องมือ brain_* ที่ถูกต้องให้อัตโนมัติ",
        ],
      },
      {
        heading: "1. ตรวจสอบการเชื่อมต่อ",
        body: ["ยืนยันว่า agent เชื่อมต่อกับ Brain และมองเห็นโปรเจกต์ของคุณเรียบร้อยแล้ว"],
        callout: "Do you have a connection to the Brain? Can you see any projects?",
      },
      {
        heading: "2. กำหนดพื้นที่ทำงาน (Workspace)",
        body: [
          "สร้างหรือเลือกโปรเจกต์สำหรับ repo นี้ เพื่อให้บทเรียนและสกิลถูกจัดเก็บลงโปรเจกต์ที่ถูกต้อง",
        ],
        callout: "Create a project in the Brain for this workspace and make it active.",
      },
      {
        heading: "3. ดึงความรู้ก่อนเริ่มงาน",
        body: ["เมื่อเริ่มงานใหม่ ให้สั่ง agent เปิดเซสชันและนำบทเรียนที่ Brain รู้อยู่แล้วมาปรับใช้"],
        callout: "Start a Brain session for this task and apply anything relevant it already knows.",
      },
      {
        heading: "4. บันทึกบทเรียนหลังจบงาน",
        body: [
          "เมื่อทำงานเสร็จแล้ว ให้สั่งปิดเซสชันเพื่อให้ Brain สกัดเป็นสกิลใหม่ ขั้นตอนนี้สำคัญที่สุดในการทำให้ Brain ฉลาดขึ้น (การข้ามขั้นตอนนี้เป็นสาเหตุหลักที่ทำให้ Brain ไม่เกิดการเรียนรู้ใหม่)",
        ],
        callout: "Transfer what we learned this session into the Brain, then close the session.",
      },
      {
        heading: "5. ถาม Oracle ได้ทุกเมื่อ",
        body: ["ดึงความรู้ การตัดสินใจ และรูปแบบเดิมกลับมาใช้โดยไม่ต้องคิดใหม่"],
        callout: "Ask the Brain: what did we decide about <topic>?",
      },
    ],
    related: ["vocabulary", "tokens", "sessions", "oracle"],
    repoDoc: {
      label: "คู่มืออ้างอิงเครื่องมือ MCP",
      href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/MCP_TOOLS.md",
    },
  },

  skills: {
    slug: "skills",
    title: "สกิล (Skills)",
    summary:
      "คลังบทเรียนและแนวทางใน Brain ของคุณ แต่ละสกิลคือกฎ สูตร หรือหลักการที่นำกลับมาใช้ใหม่ได้ ซึ่งสกัดมาจากเซสชัน หรือคุณสอนให้โดยตรง",
    surfaces: ["Skills page", "Dashboard · Rules in your Brain", "Oracle citations"],
    sections: [
      {
        heading: "สกิลคืออะไร",
        body: [
          "สกิลคือองค์ความรู้หนึ่งชิ้นที่ Brain บันทึกไว้ ประกอบด้วยเงื่อนไขกระตุ้น (Trigger - 'เมื่อพบสถานการณ์นี้'), กฎปฏิบัติ (Rule - 'ให้ทำสิ่งนี้' หรือ 'หลีกเลี่ยงสิ่งนี้') และเหตุผลประกอบ (Rationale - 'เพราะว่า...'). ทั้งหมดรวมกันเป็นแนวทางปฏิบัติตัวเดิมที่ Oracle นำไปใช้อ้างอิงตอบคำถามในครั้งถัดไป",
        ],
      },
      {
        heading: "ประเภทของสกิลทั้ง 5",
        body: ["สกิลถูกแบ่งประเภทเพื่อให้ระบบค้นคืนความรู้สามารถจัดลำดับความสำคัญได้อย่างเหมาะสม:"],
        bullets: [
          "สูตรขั้นตอน (Recipe) — ขั้นตอนการแก้ปัญหาที่เป็นรูปธรรม เช่น “เมื่อ CORS ล้มเหลวพร้อม credentials ให้ส่ง origin จาก allowlist กลับ + Vary: Origin”",
          "แนวทางปฏิบัติ (Rule of thumb) — ค่าเริ่มต้นที่ควรทำเว้นแต่มีเหตุผลจำเป็น เช่น “ให้เลือกใช้ react-hook-form มากกว่า Formik”",
          "หลักการ (Principle) — การตัดสินใจเชิงค่านิยม เช่น “เน้นประสิทธิภาพ (Performance) มากกว่า Abstraction ในจุดประมวลผลหลัก”",
          "การตอบสนองอัตโนมัติ (Reflex) — สิ่งที่ต้องทำทันที เช่น “เมื่อสร้าง Prisma migration ให้ bump เวอร์ชันในไฟล์ seed ด้วย”",
          "สิ่งที่ควรหลีกเลี่ยง (Anti-pattern) — ข้อห้ามและสิ่งที่อย่าทำ เช่น “อย่าส่ง JWT ผ่าน query string เด็ดขาด”",
        ],
      },
      {
        heading: "Decisions — มุมมองพิเศษ ไม่ใช่ประเภทที่ 6",
        body: [
          "แท็บ Decisions ในตัวกรองประเภทไม่ใช่ประเภทสกิลใหม่ แต่เป็นมุมมองเฉพาะสำหรับสกิลประเภทหลักการหรือข้อห้ามข้างต้น ที่บันทึกข้อสรุปถาวรของทีม (ติดแท็ก decision) โดยจะเก็บบันทึกตัวเลือกที่ถูกปฏิเสธไว้ด้วย และไม่มีวันเสื่อมถอย (Decay) จนกว่าจะมีข้อสรุปใหม่มาทดแทน เช่น “เราจะ Deploy จาก main branch เท่านั้น (ไม่ใช้ develop branch)”",
        ],
      },
      {
        heading: "สกิลมาจากไหน",
        body: [
          "มาจาก 2 ช่องทาง: การสกัดอัตโนมัติและการสอนโดยตรง หลังจบทุกเซสชัน KEA (Knowledge Extraction Agent) จะวิเคราะห์กิจกรรมและเสนอกฎใหม่เป็น Skill Proposals ให้คุณตรวจสอบในหน้า Autoskill นอกจากนี้คุณยังสามารถเพิ่มสกิลได้เองตลอดเวลาผ่านปุ่ม Teach",
        ],
      },
      {
        heading: "การประเมินคะแนนของสกิล",
        body: [
          "แต่ละสกิลจะมีคะแนนประสิทธิผลที่คำนวณจากผลลัพธ์การนำไปใช้งานจริง: ✓ สีเขียว ≥ 0.70 (ช่วยแก้ปัญหาได้สม่ำเสมอ), ~ สีเหลือง 0.40–0.69 (ผลลัพธ์ปานกลาง), ✗ สีแดง < 0.40 (มักไม่ช่วยแก้ปัญหา), — ยังไม่ได้ทดสอบ (สำหรับสกิลที่มีประวัติการใช้น้อยกว่า 3 ครั้ง) ระบบค้นคืนจะดันสกิลที่มีประสิทธิผลสูงขึ้น และลดความสำคัญของสกิลที่ประสิทธิผลต่ำ",
        ],
      },
    ],
    related: ["autoskill", "oracle", "decay"],
    repoDoc: { label: "คำอธิบายประเภทสกิลสำหรับทุกคน (Tutorial 07)", href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/tutorials/07-skill-types-explained.md" },
  },

  oracle: {
    slug: "oracle",
    title: "Oracle",
    summary:
      "ระบบถาม-ตอบอัจฉริยะกับคลังความรู้ของคุณเอง พิมพ์ถามด้วยภาษาธรรมชาติ คำตอบทั้งหมดระบุอ้างอิงตรงไปยังสกิลและเซสชันต้นทาง",
    surfaces: ["Oracle page", "CmdK quick prompts", "Topbar search"],
    sections: [
      {
        heading: "หน้าที่ของ Oracle",
        body: [
          "Oracle รับคำถามของคุณ ค้นคืนสกิลและเซสชันที่เกี่ยวข้องที่สุดจาก Brain จากนั้นส่งต่อให้ LLM ประมวลผลคำตอบโดยอิงตามบริบทนั้นเท่านั้น ทุกข้อความในคำตอบจะมีเครื่องหมายอ้างอิงชี้กลับไปยังต้นทาง — คลิก [^K1] เพื่อดูสกิล หรือ [^S2] เพื่อดูเซสชันต้นทาง",
        ],
      },
      {
        heading: "ระดับความแน่นของข้อมูล (Groundedness)",
        body: [
          "ทุกคำตอบจะมีป้ายระบุระดับ Groundedness: Strong, Moderate, Weak หรือ None โดย Strong หมายถึงพบบทเรียนที่ตรงและเกี่ยวข้องมากที่สุด ส่วน None หมายถึงใน Brain ยังไม่มีข้อมูลเรื่องนั้น และคำตอบมาจากความรู้ทั่วไปของ LLM ซึ่ง Oracle จะแจ้งตามจริงโดยไม่มีการเมคอ้างอิงปลอม",
        ],
      },
      {
        heading: "ฟีดแบ็กช่วยปรับปรุงการค้นคืนความรู้",
        body: [
          "การกดนิ้วโป้งขึ้น/ลงในคำตอบจะช่วยปรับคะแนนประสิทธิผลของสกิลที่ถูกอ้างอิง สกิลที่ได้รับคะแนนดีจะถูกค้นคืนก่อนในอนาคต หากกดนิ้วโป้งลง คุณสามารถระบุเหตุผลได้ (เช่น ไม่เกี่ยวข้อง, ไม่ถูกต้อง, ล้าสมัย, ขาดบริบท)",
        ],
      },
    ],
    related: ["skills", "decay", "groundedness"],
    repoDoc: { label: "คู่มือการทำงานของ Oracle (HOW_IT_WORKS.md)", href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/HOW_IT_WORKS.md" },
  },

  sessions: {
    slug: "sessions",
    title: "เซสชัน (Sessions)",
    summary:
      "ประวัติการเขียนโค้ดทั้งหมดที่ดำเนินการโดย AI ของคุณจะถูกรวบรวมไว้ที่นี่ เซสชันคือวัตถุดิบสำคัญที่ Brain ใช้เรียนรู้",
    surfaces: ["Sessions page", "Dashboard · Recent sessions"],
    sections: [
      {
        heading: "เซสชันคืออะไร",
        body: [
          "เซสชันคืองานเขียนโค้ด 1 งานในเครื่องมือ AI ของคุณ ประกอบด้วย จุดเริ่มต้น (Prompt คำสั่ง), ระหว่างทาง (Event: แก้ไขไฟล์, เรียกใช้ tool, build ล้มเหลว) และจุดสิ้นสุด (ผลลัพธ์: Success, Partial, Failed หรือ In_progress)",
        ],
      },
      {
        heading: "Brain สกัดอะไรจากเซสชันบ้าง",
        body: [
          "หลังเซสชันเสร็จสิ้น KEA จะสแกนวิเคราะห์กิจกรรมเพื่อสรุปและเสนอสกิลใหม่สูงสุด 3 รายการ สกิลจะไม่ถูกอนุมัติทันที — แต่จะไปแสดงในหน้า Autoskill ให้คุณตรวจสอบก่อนเสมอ",
        ],
      },
      {
        heading: "คะแนนคุณภาพเซสชัน (SQS)",
        body: [
          "ทุกเซสชันที่จบลงจะได้รับการประเมินคะแนนคุณภาพ SQS (0–1) คำนวณจากอัตราการยอมรับโค้ด ความรู้ที่นำมาใช้ และข้อผิดพลาดที่เกิดขึ้น โดยตั้งเป้าหมายไว้ที่ ≥ 0.70 แนวโน้ม 12 เซสชันล่าสุดจะแสดงบนแดชบอร์ด",
        ],
      },
    ],
    related: ["skills", "autoskill", "tokens"],
  },

  autoskill: {
    slug: "autoskill",
    title: "Autoskill — ข้อเสนอสกิลใหม่",
    summary:
      "รูปแบบบทเรียนที่ Brain สังเกตพบแต่ยังไม่ได้อนุมัติเป็นสกิลจริง คุณสามารถเข้ามาตรวจสอบ อนุมัติ ปฏิเสธ หรือแก้ไขได้ที่นี่",
    surfaces: ["Autoskill page", "Dashboard · Awaiting review", "Notifications drawer"],
    sections: [
      {
        heading: "ทำไมต้องมีระบบข้อเสนอ (Proposal)",
        body: [
          "เมื่อ KEA พบรูปแบบการทำงานที่เกิดขึ้นซ้ำในหลายเซสชัน ระบบจะไม่เพิ่มเป็นสกิลจริงทันที เพื่อป้องกันไม่ให้ข้อมูลขยะเล็ดลอดเข้ามา แต่จะจัดคิวเป็น Proposal พร้อมติดป้ายระดับความเชื่อมั่น (High / Medium / Low) เพื่อรอการตัดสินใจของคุณ",
        ],
      },
      {
        heading: "ตัวเลือกในการจัดการข้อเสนอ",
        body: ["คุณสามารถเลือกดำเนินการได้ 3 แบบต่อ 1 ข้อเสนอ:"],
        bullets: [
          "Apply (อนุมัติ) — เลื่อนสถานะเป็นสกิลจริง ปรากฏในคลัง Skills ทันทีและพร้อมถูกค้นคืน",
          "Reject (ปฏิเสธ) — ลบข้อเสนอนี้ทิ้ง KEA จะเรียนรู้การปฏิเสธและเสนอแนวทางคล้ายกันน้อยลง",
          "View diff (ดู Diff) — ตรวจสอบดูว่าจะมีรายละเอียดใดเปลี่ยนแปลงใน Brain บ้างหากอนุมัติ",
        ],
      },
      {
        heading: "การอนุมัติอัตโนมัติเมื่อความเชื่อมั่นสูง",
        body: [
          "คุณสามารถเปิดใช้งานฟีเจอร์นี้ได้หากต้องการให้ข้อเสนอที่มีความเชื่อมั่นสูง (High) ถูกอนุมัติเป็นสกิลโดยอัตโนมัติ ส่วนระดับ Medium และ Low จะยังคงรอการอนุมัติจากคุณเสมอ (ค่าเริ่มต้นคือปิดใช้งาน)",
        ],
      },
    ],
    related: ["skills", "sessions"],
  },

  decay: {
    slug: "decay",
    title: "กลไกการเสื่อมถอย (Decay) และความสดใหม่",
    summary:
      "สกิลที่ไม่ถูกนำมาใช้งานหรือประสิทธิผลต่ำจะค่อยๆ เสื่อมถอยและลดความสำคัญลงตามกาลเวลา โดยแสดงผลในตัวนับ 'Stale skills' บนแดชบอร์ด",
    sections: [
      {
        heading: "ทำไมระบบต้องมี Decay",
        body: [
          "สมองที่ไม่เคยลืมข้อมูลจะสะสมข้อขัดแย้งและแนวทางล้าสมัยไว้มากมาย Decay คือกลไกค่าครึ่งชีวิต (Half-life) โดยทุกสกิลจะมีคะแนน decayScore ระหว่าง 0 ถึง 1 (1 คืออัปเดตสดใหม่ และ ≤ 0.3 คือ Stale หรือล้าสมัย)",
        ],
      },
      {
        heading: "ปัจจัยที่ทำให้สกิลเสื่อมถอย",
        body: [
          "ระยะเวลาตั้งแต่การใช้งานครั้งล่าสุดคือค่าพื้นฐาน (ครึ่งชีวิตปกติ 90 วัน) โดยมีคะแนนประสิทธิผลคอยปรับแต่ง: สกิลที่มีประสิทธิผลต่ำ (ใช้งาน ≥ 5 ครั้ง) จะเสื่อมถอยเร็วขึ้น 2 เท่า (ครึ่งชีวิตเหลือ 45 วัน) ส่วนสกิลที่ประสิทธิผลสูงจะเสื่อมถอยช้าลงครึ่งหนึ่ง (ครึ่งชีวิตยืดเป็น 180 วัน)",
        ],
      },
      {
        heading: "ผลกระทบเมื่อสกิลกลายเป็น Stale",
        body: [
          "สกิลที่ Stale จะแสดงเป็นสีจางในหน้า Skills และถูกจัดลำดับความสำคัญต่ำลงในการค้นคืน สกิลจะไม่ถูกลบทิ้ง — คุณสามารถกดอัปเดต (นำกลับมาใช้ใหม่ หรือสอนเวอร์ชันใหม่), กดปลดระวาง หรือปล่อยให้เสื่อมถอยต่อไป ตัวนับบนแดชบอร์ดจะแสดงรายการที่ต้องตรวจสอบ",
        ],
      },
    ],
    related: ["skills", "oracle"],
  },

  graph: {
    slug: "graph",
    title: "กราฟความรู้ (Graph)",
    summary:
      "แผนภาพแสดงโครงข่ายความเชื่อมโยงระหว่างสกิลต่างๆ ใน Brain — สกิลใดเกี่ยวข้องกัน ต่อยอดกัน หรือกลุ่มความรู้หลักอยู่ตรงไหน",
    surfaces: ["graph"],
    sections: [
      {
        heading: "กราฟความรู้แสดงอะไรบ้าง",
        body: [
          "Graph คือมุมมองภาพรวมจากด้านบนของ Brain แต่ละโหนด (จุด) คュอ 1 สกิล และเส้นเชื่อมคือความสัมพันธ์ที่ระบบวิเคราะห์พบ — สกิลที่มีหัวข้อร่วมกัน ต่อยอดกัน หรือทดแทนกัน",
        ],
      },
      {
        heading: "วิธีการอ่านกราฟ",
        body: ["ใช้สำหรับส่องดูกลุ่มความรู้ (Cluster - จุดที่คุณสะสมบทเรียนไว้มาก) และโหนดอิสระ (Orphan - สกิลที่ไม่มีการเชื่อมโยง)"],
        bullets: [
          "โหนด (Node) — แทน 1 สกิล โหนดที่มีขนาดใหญ่หรือสว่างกว่าหมายถึงมีความเชื่อมั่นสูงหรือถูกใช้งานบ่อย",
          "เส้นเชื่อม (Edge) — แสดงความสัมพันธ์ระหว่าง 2 สกิล (ความเกี่ยวข้องหรือการทดแทน)",
          "กลุ่มความรู้ (Cluster) — กลุ่มของสกิลที่เชื่อมโยงกันแน่นหนาในเรื่องใดเรื่องหนึ่ง",
        ],
      },
      {
        heading: "ประโยชน์ของกราฟ",
        body: [
          "กลุ่มความรู้บอกให้เห็นว่า Brain ของคุณเชี่ยวชาญเรื่องใด ส่วนโหนดอิสระบอกใบ้ถึงบทเรียนเฉพาะกิจที่ยังไม่ถูกเชื่อมโยง กราฟคือแผนที่ภาพรวมสำหรับให้คุณส่องดูโครงสร้างความรู้ของระบบ",
        ],
      },
    ],
    related: ["skills", "decisions", "decay"],
  },

  decisions: {
    slug: "decisions",
    title: "ข้อสรุปการตัดสินใจ (Decisions)",
    summary:
      "แนวทางปฏิบัติของโปรเจกต์ที่ตกลงกันแล้ว — สิ่งที่ทีมตัดสินใจและไม่ควรนำมาถกซ้ำ แชร์ร่วมกันทั้งทีมและได้รับการยกเว้นจากการเสื่อมถอย",
    surfaces: ["decisions"],
    sections: [
      {
        heading: "การตัดสินใจคืออะไร",
        body: [
          "การตัดสินใจคือข้อสรุปตั้งใจของโปรเจกต์ เช่น \"เราจะใช้ X\" \"ยกเลิกการใช้ Y\" \"ให้ Z ดูแลเรื่อง Auth\" ซึ่งต่างจากสกิลทั่วไป การตัดสินใจคือความจำร่วมของทีม — จะถูกป้อนเข้าเซสชันของเพื่อนร่วมทีมทุกคนโดยอัตโนมัติ — และจะไม่เสื่อมถอยตามกาลเวลา จนกว่าจะมีข้อสรุปใหม่มาทดแทน",
        ],
      },
      {
        heading: "การตัดสินใจบันทึกจากไหน",
        body: [
          "AI Agent จะบันทึกให้อัตโนมัติเมื่อคุณแจ้งแนวทางระหว่างเซสชัน หรือคุณสามารถเพิ่มโดยตรงได้ การตัดสินใจสามารถระบุตัวเลือกที่ถูกปฏิเสธไว้ และหากเป็นการเปลี่ยนแนวทางเดิม ก็สามารถระบุชี้ไปยังข้อสรุปเก่าที่ถูกทดแทนได้",
        ],
        bullets: [
          "Supersedes (ทดแทน) — ข้อสรุปนี้มาแทนที่ข้อสรุปเดิม (อันเดิมจะถูกปลดระวาง ไม่ได้ลบทิ้ง)",
          "Instead of (ทางเลือกที่ตัดออก) — ตัวเลือกที่เคยได้รับการพิจารณาแต่ถูกปฏิเสธ",
          "Scope (ขอบเขต) — ข้อสรุประดับโปรเจกต์จะมองเห็นและแชร์ร่วมกันได้ทั้งทีม",
        ],
      },
      {
        heading: "ทำไมจึงแยกหน้าต่างหากจาก สกิลทั่วไป",
        body: [
          "สกิลทั่วไปคือรูปแบบบทเรียนที่ Brain เรียนรู้และปรับคะแนนตามความคุ้มค่า ส่วนการตัดสินใจคือข้อเท็จจริงและกติกาที่ทีมยืนยัน การรวมกันจะทำให้ข้อตกลงทีมค่อยๆ เสื่อมถอยอย่างเงียบๆ การตัดสินใจจึงมีพื้นที่แยกต่างหากที่ไม่เสื่อมถอย",
        ],
      },
    ],
    related: ["skills", "sessions", "vocabulary"],
  },

  tokens: {
    slug: "tokens",
    title: "โทเค็น MCP (MCP Tokens)",
    summary:
      "Bearer tokens สำหรับยืนยันตัวตนเครื่องมือ AI ของคุณกับ Brain 1 โทเค็นต่อ 1 อุปกรณ์ × 1 เครื่องมือ ช่วยให้การจัดการสิทธิ์แม่นยำและปลอดภัย",
    surfaces: ["/settings/tokens", "Token install wizard", "Connection status card"],
    sections: [
      {
        heading: "ทำไมต้องใช้โทเค็น",
        body: [
          "ระบบ MCP Server ของ Brain ป้องกันทุกการเชื่อมต่อด้วย Bearer token (รวมถึงคำสั่ง initialize) โทเค็นคือสิ่งที่ Claude Code, Cursor, Windsurf ใช้พิสูจน์สิทธิ์ในการอ่านและเขียนข้อมูลใน Brain ของคุณ",
        ],
      },
      {
        heading: "การสร้างและการติดตั้ง",
        body: [
          "สร้างโทเค็นได้ที่ /settings/tokens และคัดลอกไว้ทันที (ระบบจะเก็บเฉพาะค่า Hash ไม่สามารถเปิดดูซ้ำได้) จากนั้นนำไปใส่ในการตั้งค่า MCP ของไคลเอนต์ ตัวช่วยติดตั้งจะมีโค้ดคำสั่งพร้อมคัดลอกสำหรับแต่ละเครื่องมือ",
        ],
      },
      {
        heading: "ขอบเขต การหมุนเวียน และการยกเลิก",
        body: [
          "โทเค็นสามารถกำหนดขอบเขตได้แบบไม่จำกัด, จำกัดเฉพาะองค์กร หรือจำกัดเฉพาะโปรเจกต์ ปุ่ม Rotate ใช้สำหรับเปลี่ยน Secret โดยไม่เปลี่ยน ID ส่วนปุ่ม Revoke ใช้ยกเลิกโทเค็นทันที และปุ่ม Verify สำหรับตรวจสอบการเชื่อมต่อกับเซิร์ฟเวอร์",
        ],
      },
    ],
    related: ["connection-status", "sessions"],
    repoDoc: { label: "คู่มือการจัดการโทเค็น (Tutorial 04)", href: "https://github.com/bejranonda/ExternalBrain/blob/main/docs/tutorials/04-managing-tokens.md" },
  },

  "connection-status": {
    slug: "connection-status",
    title: "สถานะการเชื่อมต่อ",
    summary:
      "ตรวจสอบว่าเครื่องของคุณกำลังสื่อสารกับ Brain จริงหรือไม่ และมีการสะสมความรู้อยู่หรือไม่ การ์ดบนแดชบอร์ดมีคำตอบให้อย่างชัดเจน",
    surfaces: ["Dashboard top card"],
    sections: [
      {
        heading: "สัญญาณการเชื่อมต่อ (Heartbeat)",
        body: [
          "แต่ละแถวแสดงสถานะโทเค็นของคุณ: จุดสีเขียว + 'Xs ago' = มีการรับส่งข้อมูลภายใน 5 นาทีล่าสุด ส่วนสีเทา = ไม่มีกิจกรรมล่าสุด โทเค็นที่มีการใช้งานใน 24 ชม. ล่าสุดจะแสดงป้ายสถิติจำนวนเซสชันและกิจกรรมด้วย",
        ],
      },
      {
        heading: "ตัวนับสถิติ 24 ชั่วโมง",
        body: [
          "แสดงจำนวนเซสชัน กิจกรรม และสกิลที่สกัดได้ใน 24 ชั่วโมงล่าสุด ตัวเลขที่มากกว่า 0 เป็นหลักฐานยืนยันว่าระบบกำลังบันทึกความรู้จริง ไม่ใช่แค่เชื่อมต่อได้ โดยตัวนับจะรวบรวมกิจกรรมจากทุกโทเค็นและกิจกรรมบน Webapp",
        ],
      },
      {
        heading: "คิวงานวิเคราะห์ KEA",
        body: [
          "แสดงคิวงาน kea.extract ที่รอประมวลผล หากคิวค้างเป็นตัวเลขสูงต่อเนื่อง อาจหมายถึง worker ไม่ทำงาน ซึ่งเป็นสัญญาณให้ตรวจสอบคอนเทนเนอร์ของ worker",
        ],
      },
    ],
    related: ["tokens", "sessions", "autoskill"],
  },

  groundedness: {
    slug: "groundedness",
    title: "ระดับความแน่นของข้อมูล (Groundedness)",
    summary:
      "วัดว่าคำตอบของ Oracle ดึงบริบทบทเรียนจาก Brain มาใช้อ้างอิงมากน้อยเพียงใด แสดงผลบนทุกคำตอบใน Oracle",
    sections: [
      {
        heading: "4 ระดับความแน่นของข้อมูล",
        body: ["คำนวณก่อนส่งให้ LLM ประมวลผลคำตอบ จากชุดข้อมูลที่ค้นคืนได้:"],
        bullets: [
          "Strong (แน่นมาก) — พบบทเรียนและสกิลที่เกี่ยวข้องสูงจำนวนมาก คำตอบยึดตาม Brain อย่างแน่นหนา",
          "Moderate (ปานกลาง) — พบบริบทที่เกี่ยวข้องบางส่วน คำตอบผสมผสานระหว่าง Brain + ความรู้ทั่วไป",
          "Weak (น้อย) — พบบริบทน้อยหรือเกี่ยวข้องต่ำ คำตอบอิงความรู้ทั่วไปของ LLM เป็นหลัก",
          "None (ไม่มีบริบท) — ใน Brain ไม่มีข้อมูลเรื่องนั้น Oracle จะแจ้งตรงๆ และงดเว้นการใส่อ้างอิงปลอม",
        ],
      },
      {
        heading: "ทำไมความซื่อตรงจึงสำคัญ",
        body: [
          "Brain ที่สร้างอ้างอิงปลอมเพื่อให้ดูดี แย่กว่าระบบที่ยอมรับว่า 'ไม่มีข้อมูล' เมื่อคุณเห็นระดับ 'None' นั่นไม่ใช่ความล้มเหลว — แต่เป็นสัญญาณบอกว่าคุณควรสอนสกิลเรื่องนั้นเพิ่ม เพื่อให้คำตอบในครั้งถัดไปมีบริบทที่ถูกต้อง",
        ],
      },
    ],
    related: ["oracle", "skills"],
  },
};

const DOCS_BY_LANG: Record<Lang, Record<string, DocPage>> = {
  en: DOCS,
  th: DOCS_TH,
  de: DOCS_DE,
};

/**
 * Localized chrome for the /docs surfaces. Link *hrefs* live in the page
 * components; only the prose around them is translated here. Section-group
 * headings are keyed by the `id` on DOCS_SECTIONS.
 */
export interface DocsChrome {
  indexTitle: string;
  indexIntro: string;
  indexHandbookPre: string;
  indexHandbookLink: string;
  needHelpTitle: string;
  helpTutorialsPre: string;
  helpTutorialsLink: string;
  helpTutorialsPost: string;
  helpBrokenPre: string;
  helpBrokenLink: string;
  helpBrokenMid: string;
  helpBrokenLink2: string;
  helpBrokenPost: string;
  helpRunbookPre: string;
  helpRunbookLink: string;
  helpRunbookPost: string;
  allConcepts: string;
  whereYouSee: string;
  relatedConcepts: string;
  deeperReference: string;
  allTutorials: string;
  sourceOnGithub: string;
  notYetTranslated: string;
  sections: Record<string, string>;
}

const DOCS_CHROME: Record<Lang, DocsChrome> = {
  en: {
    indexTitle: "Documentation",
    indexIntro:
      "Plain-English reference for every concept and feature in External Brain. If you came here from a (?) icon in the app, the page you want is below.",
    indexHandbookPre: "For the full technical handbook, see the ",
    indexHandbookLink: "docs/ folder on GitHub",
    needHelpTitle: "Need help?",
    helpTutorialsPre: "New here? Start with the ",
    helpTutorialsLink: "quick start",
    helpTutorialsPost: " — token, install, first conversation in 5 minutes.",
    helpBrokenPre: "Something broken? Check ",
    helpBrokenLink: "the troubleshooting guide",
    helpBrokenMid: " or ",
    helpBrokenLink2: "file an issue",
    helpBrokenPost: ".",
    helpRunbookPre: "Operator / production checklist: ",
    helpRunbookLink: "DEPLOY_CHECKLIST.md",
    helpRunbookPost: ".",
    allConcepts: "← all concepts",
    whereYouSee: "Where you see this",
    relatedConcepts: "Related concepts",
    allTutorials: "← all tutorials",
    sourceOnGithub: "View source on GitHub",
    notYetTranslated: "Not yet translated — showing the English version.",
    deeperReference: "Deeper reference",
    sections: {
      start: "Start here",
      core: "Core concepts",
      connection: "Connection & setup",
      deeper: "Deeper",
      tutorials: "Tutorials",
    },
  },
  th: {
    indexTitle: "เอกสาร",
    indexIntro:
      "เอกสารอ้างอิงภาษาเข้าใจง่ายสำหรับทุกแนวคิดและฟีเจอร์ใน External Brain หากคุณมาจากไอคอน (?) ในแอป หน้าที่คุณต้องการอยู่ด้านล่าง",
    indexHandbookPre: "สำหรับคู่มือทางเทคนิคฉบับเต็ม ดูที่ ",
    indexHandbookLink: "โฟลเดอร์ docs/ บน GitHub",
    needHelpTitle: "ต้องการความช่วยเหลือ?",
    helpTutorialsPre: "เพิ่งเริ่มใช้งาน? เริ่มที่",
    helpTutorialsLink: "คู่มือเริ่มต้นใช้งาน",
    helpTutorialsPost: " — สร้างโทเคน ติดตั้ง และเริ่มสนทนาครั้งแรกใน 5 นาที",
    helpBrokenPre: "มีอะไรเสีย? ดูที่ ",
    helpBrokenLink: "คู่มือแก้ปัญหา",
    helpBrokenMid: " หรือ ",
    helpBrokenLink2: "แจ้งปัญหา (issue)",
    helpBrokenPost: "",
    helpRunbookPre: "คู่มือผู้ดูแล / การใช้งานจริง: ",
    helpRunbookLink: "DEPLOY_CHECKLIST.md",
    helpRunbookPost: "",
    allConcepts: "← แนวคิดทั้งหมด",
    whereYouSee: "คุณเห็นสิ่งนี้ที่ไหน",
    relatedConcepts: "แนวคิดที่เกี่ยวข้อง",
    allTutorials: "← บทเรียนทั้งหมด",
    sourceOnGithub: "ดูต้นฉบับบน GitHub",
    notYetTranslated: "ยังไม่มีคำแปล — แสดงฉบับภาษาอังกฤษ",
    deeperReference: "อ้างอิงเชิงลึก",
    sections: {
      start: "เริ่มที่นี่",
      core: "แนวคิดหลัก",
      connection: "การเชื่อมต่อและการตั้งค่า",
      deeper: "เชิงลึก",
      tutorials: "บทเรียน",
    },
  },
  de: {
    indexTitle: "Dokumentation",
    indexIntro:
      "Allgemein verständliche Referenz für jedes Konzept und Feature in External Brain. Wenn du von einem (?)-Symbol in der App hierherkamst, ist die gesuchte Seite unten.",
    indexHandbookPre: "Für das vollständige technische Handbuch siehe den ",
    indexHandbookLink: "docs/-Ordner auf GitHub",
    needHelpTitle: "Brauchst du Hilfe?",
    helpTutorialsPre: "Neu hier? Beginne mit dem ",
    helpTutorialsLink: "Schnellstart",
    helpTutorialsPost: " — Token, Installation und erstes Gespräch in 5 Minuten.",
    helpBrokenPre: "Etwas kaputt? Sieh in ",
    helpBrokenLink: "den Troubleshooting-Guide",
    helpBrokenMid: " oder ",
    helpBrokenLink2: "melde ein Issue",
    helpBrokenPost: ".",
    helpRunbookPre: "Betreiber- / Produktions-Checkliste: ",
    helpRunbookLink: "DEPLOY_CHECKLIST.md",
    helpRunbookPost: ".",
    allConcepts: "← alle Konzepte",
    whereYouSee: "Wo du das siehst",
    relatedConcepts: "Verwandte Konzepte",
    allTutorials: "← alle Tutorials",
    sourceOnGithub: "Quelle auf GitHub ansehen",
    notYetTranslated: "Noch nicht übersetzt — englische Version wird angezeigt.",
    deeperReference: "Tiefere Referenz",
    sections: {
      start: "Hier starten",
      core: "Kernkonzepte",
      connection: "Verbindung & Einrichtung",
      deeper: "Tiefer",
      tutorials: "Tutorials",
    },
  },
};

/** Normalize an arbitrary string to a supported Lang (EN fallback). */
export function asLang(value: string | undefined): Lang {
  return value === "th" || value === "de" ? value : "en";
}

/** Localized chrome for the /docs surfaces, EN fallback. */
export function getDocsChrome(lang: Lang): DocsChrome {
  return DOCS_CHROME[lang] ?? DOCS_CHROME.en;
}

/** A doc page in the requested language, falling back to the EN page per-slug. */
export function getDoc(lang: Lang, slug: string): DocPage | undefined {
  return (DOCS_BY_LANG[lang] ?? DOCS)[slug] ?? DOCS[slug];
}

/** Localized title for a slug (index cards / related chips), EN fallback. */
export function getDocTitle(lang: Lang, slug: string): string | undefined {
  return getDoc(lang, slug)?.title;
}
