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
          "Create or select the project this repo belongs to, so knowledge files under the right project.",
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
      href: "https://github.com/bejranonda/BrainPlatform/blob/main/docs/MCP_TOOLS.md",
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
      href: "https://github.com/bejranonda/BrainPlatform/blob/main/docs/MCP_TOOLS.md",
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
        heading: "Fünf Typen — verschiedene Formen von Wissen",
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
    repoDoc: { label: "KNOWLEDGE.md (full ontology)", href: "https://github.com/bejranonda/BrainPlatform/blob/main/docs/KNOWLEDGE.md" },
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
    repoDoc: { label: "HOW_IT_WORKS.md · Oracle", href: "https://github.com/bejranonda/BrainPlatform/blob/main/docs/HOW_IT_WORKS.md" },
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
    repoDoc: { label: "tutorials/04-managing-tokens.md", href: "https://github.com/bejranonda/BrainPlatform/blob/main/docs/tutorials/04-managing-tokens.md" },
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
    title: "คำศัพท์ — คำที่คุณจะได้เห็น",
    summary:
      "อภิธานศัพท์หน้าเดียว เพื่อให้คำบนทุกหน้าจอมีความหมายเดียวกัน ผู้ใช้ใหม่เริ่มที่นี่",
    surfaces: [],
    sections: [
      {
        heading: "ห้าคำสำคัญ",
        body: [
          "External Brain มีคำที่ผู้ใช้ต้องรู้เพียงห้าคำเท่านั้น ทุกอย่างที่เหลือสร้างขึ้นจากคำเหล่านี้",
        ],
        bullets: [
          "Brain — ชั้นความจำที่แชร์ร่วมกันสำหรับเซสชันการเขียนโค้ดกับ AI ของคุณ Brain ของคุณคือชุดของ Skill ที่มันรู้เกี่ยวกับตัวคุณ",
          "Skill — กฎ สูตร หรือหลักการเดียวที่ Brain เรียนรู้ (จากเซสชัน) หรือที่คุณสอนมันโดยตรง Skill มีประเภทกำกับ (สูตร / กฎทั่วไป / หลักการ / รีเฟล็กซ์ / Anti-pattern)",
          "Session — การสนทนาหนึ่งครั้งระหว่างคุณกับเครื่องมือเขียนโค้ด AI (Claude Code, Cursor, Windsurf, Autobahn) เซสชันป้อนข้อมูลให้ Brain — ทุกเซสชันที่ปิดแล้วสามารถสร้าง Skill ได้",
          "Oracle — หน้าถาม-ตอบ ถามอะไรก็ได้ Oracle จะตอบโดยใช้ Skill + เซสชันของคุณเอง พร้อมการอ้างอิงแหล่งที่มา",
          "Proposal — Skill ที่เป็นตัวเลือก ซึ่ง Brain สังเกตเห็นจากเซสชันล่าสุด คุณเลือกนำไปใช้หรือปฏิเสธ มีเฉพาะอันที่นำไปใช้เท่านั้นที่จะกลายเป็น Skill",
        ],
      },
      {
        heading: "ทำไมต้องใช้ชื่อเหล่านี้",
        body: [
          "Skill คือชื่อฝั่งผู้ใช้สำหรับสิ่งที่ฐานข้อมูลเรียกว่า Knowledge คำในฐานข้อมูลมีไว้สำหรับ power user + API ส่วนที่อื่นใน UI ทั้งหมดใช้คำว่า ‘Skill’",
          "Oracle คือหน้าที่ตอบคำถาม ส่วน LLM จริงที่อยู่เบื้องหลัง (Claude ฯลฯ) ถูกซ่อนไว้โดยตั้งใจ — คุณถาม Oracle ไม่ใช่ถาม Claude",
          "Proposal คือสิ่งที่ไปป์ไลน์ Autoskill สร้างขึ้น — Skill ที่รอการตรวจสอบจากคุณ เส้นทางคือ /autoskill เพื่อความเข้ากันได้ย้อนหลัง แต่ป้ายชื่อฝั่งผู้ใช้คือ Proposals",
        ],
      },
      {
        heading: "คำที่คุณจะเห็นใน tooltip (ขั้นสูง)",
        body: ["คำเหล่านี้เป็นชื่อจริง แต่คุณไม่จำเป็นต้องรู้ก็ใช้แอปได้"],
        bullets: [
          "KEA — Knowledge Extraction Agent ตัวงานเบื้องหลังที่อ่านเซสชันที่เสร็จแล้วและเสนอ Skill",
          "KRA — Knowledge Retrieval Agent ขั้นตอนการค้นหาเชิงความหมายที่เลือกว่า Oracle จะอ้างอิง Skill ใด",
          "MCP — Model Context Protocol รูปแบบการสื่อสารที่เครื่องมือ AI ของคุณใช้คุยกับ Brain ผ่าน HTTP",
          "SQS — Session Quality Score ตัวเลข 0..1 ที่สรุปว่าเซสชันล่าสุดของคุณกำลังไปได้ดีหรือไม่ (เป้าหมาย ≥ 0.70)",
        ],
      },
    ],
    related: ["skills", "oracle", "sessions", "autoskill"],
  },

  "using-from-your-agent": {
    slug: "using-from-your-agent",
    title: "ใช้ Brain จาก agent ของคุณ",
    summary:
      "prompt ที่ใช้พิมพ์ให้ Claude Code, Cursor หรือ MCP client ใดก็ได้ เพื่อสั่งงาน Brain ของคุณในแต่ละวัน",
    surfaces: ["dashboard"],
    sections: [
      {
        heading: "วงจรประจำวัน ในรูปแบบ prompt ง่าย ๆ",
        body: [
          "เมื่อต่อ token แล้ว คุณคุยกับ Brain ผ่าน AI agent ด้วยภาษาธรรมดา คุณไม่ต้องเรียกเครื่องมือเอง — แค่ถาม แล้ว agent จะเลือกเครื่องมือ brain_* ที่เหมาะสมให้ ต่อไปนี้คือ prompt ที่ตรงกับแต่ละขั้น",
        ],
      },
      {
        heading: "1. ตรวจการเชื่อมต่อ",
        body: ["ยืนยันว่า agent มองเห็น Brain และโปรเจกต์ของคุณก่อนจะพึ่งพามัน"],
        callout: "Do you have a connection to the Brain? Can you see any projects?",
      },
      {
        heading: "2. ชี้ไปที่ workspace นี้",
        body: ["สร้างหรือเลือกโปรเจกต์ที่ repo นี้สังกัด เพื่อให้ความรู้ถูกจัดเก็บใต้โปรเจกต์ที่ถูกต้อง"],
        callout: "Create a project in the Brain for this workspace and make it active.",
      },
      {
        heading: "3. ดึงความรู้ก่อนเริ่มงาน",
        body: ["ตอนเริ่มงาน ให้ agent เปิดเซสชันและนำสิ่งที่ Brain รู้อยู่แล้วมาใช้"],
        callout: "Start a Brain session for this task and apply anything relevant it already knows.",
      },
      {
        heading: "4. เก็บสิ่งที่เรียนรู้",
        body: [
          "เมื่อจบงาน ให้ปิดเซสชันเพื่อให้ Brain สกัด Skill ได้ ขั้นนี้คือสิ่งที่ทำให้ Brain ดีขึ้น — การข้ามมันคือเหตุผลอันดับหนึ่งที่ทำให้ Brain รู้สึกหยุดนิ่ง",
        ],
        callout: "Transfer what we learned this session into the Brain, then close the session.",
      },
      {
        heading: "5. ถาม Oracle ได้ทุกเรื่อง",
        body: ["เรียกคืนการตัดสินใจและแพตเทิร์นในอดีตโดยไม่ต้องคิดใหม่"],
        callout: "Ask the Brain: what did we decide about <topic>?",
      },
    ],
    related: ["vocabulary", "tokens", "sessions", "oracle"],
    repoDoc: {
      label: "เอกสารอ้างอิงเครื่องมือ MCP",
      href: "https://github.com/bejranonda/BrainPlatform/blob/main/docs/MCP_TOOLS.md",
    },
  },

  skills: {
    slug: "skills",
    title: "Skills",
    summary:
      "สิ่งที่ Brain ของคุณรู้ แต่ละ Skill คือกฎ สูตร หรือหลักการที่นำกลับมาใช้ซ้ำได้ ซึ่ง Brain เก็บมาจากเซสชันของคุณหรือที่คุณสอนมันโดยตรง",
    surfaces: ["Skills page", "Dashboard · Rules in your Brain", "Oracle citations"],
    sections: [
      {
        heading: "Skill คืออะไร",
        body: [
          "Skill คือความรู้หนึ่งชิ้นที่ Brain เก็บไว้ ประกอบด้วย trigger (‘เมื่อสถานการณ์นี้เกิดขึ้น’), กฎ (‘ทำสิ่งนี้’ หรือ ‘หลีกเลี่ยงสิ่งนี้’) และเหตุผลประกอบ (‘เพราะ…’) แบบไม่บังคับ เมื่อรวมกันก็กลายเป็นคำตอบที่ใช้ซ้ำได้ ซึ่ง Oracle อ้างอิงได้ในครั้งถัดไปที่คุณถาม",
        ],
      },
      {
        heading: "ห้าประเภท — รูปแบบความรู้ที่ต่างกัน",
        body: ["Skill มีประเภทกำกับเพื่อให้การค้นคืนจัดอันดับได้เหมาะสม:"],
        bullets: [
          "สูตร (Recipe) — วิธีทำแบบเป็นรูปธรรม “เมื่อ CORS ล้มเหลวพร้อม credentials ให้ส่ง origin จาก allowlist กลับ + Vary: Origin”",
          "กฎทั่วไป (Rule of thumb) — ค่าตั้งต้นเว้นแต่มีเหตุผลเป็นอื่น “เลือกใช้ react-hook-form มากกว่า Formik”",
          "หลักการ (Principle) — การตัดสินใจที่ขับด้วยคุณค่า “Performance มาก่อน abstraction ในเส้นทางที่วิกฤต”",
          "รีเฟล็กซ์ (Reflex) — อัตโนมัติ รวดเร็ว “เมื่อทำ Prisma migration ให้อัปเดตไฟล์ seed ด้วย”",
          "Anti-pattern — สิ่งที่ไม่ควรทำ “อย่าส่ง JWT ใน query string เด็ดขาด”",
        ],
      },
      {
        heading: "Skill มาจากไหน",
        body: [
          "มีสองแหล่ง: การสกัดและการสอน หลังจากทุกเซสชัน KEA (Knowledge Extraction Agent) จะสแกน event และเสนอ Skill ใหม่เป็น Skill Proposal — คุณตรวจสอบได้ในหน้า Autoskill นอกจากนี้คุณยังสอน Skill โดยตรงผ่านปุ่ม Teach ได้ทุกเมื่อ",
        ],
      },
      {
        heading: "Skill ถูกให้คะแนนอย่างไร",
        body: [
          "แต่ละ Skill มีคะแนนประสิทธิผลที่ได้จากผลลัพธ์เมื่อถูกนำไปใช้ ✓ เขียว ≥ 0.70 (ช่วยได้สม่ำเสมอ), ~ เหลือง 0.40–0.69 (ปนกัน), ✗ แดง < 0.40 (มักไม่ช่วย), — ยังไม่ทดสอบ สำหรับ Skill ที่มีผลลัพธ์น้อยกว่า 3 ครั้ง เครื่องค้นคืนจะดัน Skill ที่ประสิทธิผลสูงขึ้นและลดทอน Skill ที่ประสิทธิผลต่ำ",
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
      "หน้าจอสนทนากับความรู้ของคุณเอง ถามด้วยภาษาธรรมดา คำตอบจะอ้างอิง Skill และเซสชันที่สนับสนุนแต่ละข้อความ",
    surfaces: ["Oracle page", "CmdK quick prompts", "Topbar search"],
    sections: [
      {
        heading: "Oracle ทำอะไร",
        body: [
          "Oracle รับคำถามของคุณ ค้นคืน Skill และเซสชันที่เกี่ยวข้องที่สุดจาก Brain ของคุณ แล้วให้ LLM ตอบโดยใช้เฉพาะบริบทนั้น ทุกข้อความในคำตอบจะมีการอ้างอิงชี้กลับไปยังแหล่งที่มา — คลิก [^K1] สำหรับ Skill, [^S2] สำหรับเซสชัน",
        ],
      },
      {
        heading: "Groundedness — ใช้บริบทจาก Brain มากแค่ไหน",
        body: [
          "ทุกคำตอบมีป้าย groundedness: strong, moderate, weak หรือ none Strong หมายถึงมี Skill ที่เกี่ยวข้องสูงถูกค้นคืนจำนวนมาก ส่วน none หมายถึง Brain ของคุณไม่มีข้อมูลเรื่องนั้น และคำตอบมาจากความรู้ทั่วไปของ LLM Oracle บอกสิ่งนี้อย่างตรงไปตรงมา — ไม่มีการอ้างอิงปลอม",
        ],
      },
      {
        heading: "Feedback กำหนดการค้นคืนในอนาคต",
        body: [
          "การกดนิ้วโป้งขึ้น/ลงต่อคำตอบจะปรับตัวนับประสิทธิผลของ Skill ที่ถูกอ้างอิง เมื่อเวลาผ่านไป Skill ที่ประสิทธิผลสูงจะปรากฏก่อน ส่วนที่ต่ำจะเสื่อมเร็วขึ้น คุณยังคลิก ‘ทำไม?’ เมื่อกดนิ้วโป้งลงเพื่อระบุเหตุผลได้ (ไม่เกี่ยวข้อง, ผิด, ล้าสมัย, ขาดบริบท)",
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
      "ทุกงานเขียนโค้ดที่เครื่องมือ AI ของคุณเริ่มจะมาอยู่ที่นี่ เซสชันคือวัตถุดิบที่ Brain ใช้เรียนรู้",
    surfaces: ["Sessions page", "Dashboard · Recent sessions"],
    sections: [
      {
        heading: "เซสชันคืออะไร",
        body: [
          "เซสชันคืองานหนึ่งงานในเครื่องมือ AI ของคุณ — เริ่ม (ด้วย prompt), ระหว่างทาง (event: การแก้ไขไฟล์, การเรียก tool, build ล้มเหลว), สิ้นสุด (ผลลัพธ์: success, partial, failed หรือ in_progress หากเครื่องมือไม่เคยรายงานกลับ)",
        ],
      },
      {
        heading: "Brain สกัดอะไรจากเซสชัน",
        body: [
          "หลังเซสชันสิ้นสุด KEA จะสแกน event เพื่อหารูปแบบและเสนอ Skill ใหม่ได้สูงสุด 3 รายการ Skill จะไม่ถูกนำไปใช้โดยอัตโนมัติ — มันจะแสดงใน Autoskill เพื่อให้คุณตรวจสอบ คุณเห็นวงจรนี้ในแผง Live activity บนแดชบอร์ด",
        ],
      },
      {
        heading: "คะแนนคุณภาพ (SQS)",
        body: [
          "ทุกเซสชันที่จบแล้วจะได้คะแนนคุณภาพ (0–1) — เป็นองค์ประกอบจากการยอมรับ, ความรู้ที่นำไปใช้ และข้อผิดพลาด เป้าหมายคือ ≥ 0.70 แนวโน้มของ 12 เซสชันล่าสุดแสดงบนกราฟแดชบอร์ด",
        ],
      },
    ],
    related: ["skills", "autoskill", "tokens"],
  },

  autoskill: {
    slug: "autoskill",
    title: "Autoskill — ข้อเสนอ Skill",
    summary:
      "รูปแบบที่ Brain สังเกตเห็นแต่ยังไม่ได้เลื่อนขึ้นเป็น Skill จริง คุณตรวจสอบแล้วเลือกยอมรับ ปฏิเสธ หรือแก้ไข",
    surfaces: ["Autoskill page", "Dashboard · Awaiting review", "Notifications drawer"],
    sections: [
      {
        heading: "ทำไมต้องมี Proposal",
        body: [
          "เมื่อ KEA พบรูปแบบที่เกิดซ้ำในหลายเซสชัน มันจะไม่เพิ่มลงในรายการ Skill ของคุณโดยอัตโนมัติ — เพราะจะทำให้สิ่งรบกวนเล็ดลอดเข้ามา แต่มันจะเข้าคิวเป็น Proposal พร้อมป้ายความเชื่อมั่น (high / medium / low) และรอการตัดสินใจของคุณ",
        ],
      },
      {
        heading: "คุณทำอะไรที่นี่",
        body: ["มีสามการกระทำต่อหนึ่ง Proposal:"],
        bullets: [
          "Apply — เลื่อน Proposal ขึ้นเป็น Skill จริง ปรากฏใน Skills ทันทีและเริ่มถูกค้นคืน",
          "Reject — ทิ้งไป KEA เรียนรู้จากการปฏิเสธและจะเสนอสิ่งคล้ายกันน้อยลง",
          "View diff — ดูว่ามีอะไรจะเปลี่ยนใน Brain ของคุณหากคุณยอมรับ",
        ],
      },
      {
        heading: "ใช้อัตโนมัติเมื่อความเชื่อมั่นสูง",
        body: [
          "เปิดไว้หากคุณไว้ใจให้ Proposal ความเชื่อมั่นสูงลงตรงเลย ส่วน medium และ low ยังรอการตรวจสอบ ค่าเริ่มต้นคือปิด",
        ],
      },
    ],
    related: ["skills", "sessions"],
  },

  decay: {
    slug: "decay",
    title: "Decay และความสดใหม่",
    summary:
      "Skill ที่ไม่ถูกใช้หรือไม่มีประสิทธิผลจะจางลงเมื่อเวลาผ่านไป คุณเห็นสิ่งนี้เป็นตัวนับ ‘Stale skills’ บนแดชบอร์ด",
    sections: [
      {
        heading: "ทำไมต้องมี Decay",
        body: [
          "Brain ที่ไม่เคยลืมจะสะสมความขัดแย้งและคำแนะนำที่ล้าสมัย Decay คือกลไกครึ่งชีวิต — ทุก Skill มี decayScore ระหว่าง 0 ถึง 1 โดย 1 คือสดใหม่ และ ≤ 0.3 คือ stale",
        ],
      },
      {
        heading: "อะไรทำให้ Skill เสื่อม",
        body: [
          "เวลาตั้งแต่ใช้งานครั้งล่าสุดเป็นค่าพื้นฐาน (ครึ่งชีวิต 90 วันโดยค่าเริ่มต้น) ประสิทธิผลปรับค่านี้: Skill ที่ประสิทธิผลต่ำและมีผลลัพธ์ ≥ 5 ครั้งจะเสื่อมเร็วขึ้น 2 เท่า (ครึ่งชีวิต 45 วัน) ส่วน Skill ที่ประสิทธิผลสูงเสื่อมช้าลงครึ่งหนึ่ง (ครึ่งชีวิต 180 วัน) Skill ใหม่ (< 3 ผลลัพธ์) เสื่อมที่อัตราพื้นฐาน",
        ],
      },
      {
        heading: "stale หมายความว่าอย่างไรในทางปฏิบัติ",
        body: [
          "Skill ที่ stale จะถูกหรี่แสงในรายการ Skills และถูกจัดอันดับต่ำลงในการค้นคืน มันไม่ถูกลบ — คุณรีเฟรชได้ (นำไปใช้ใหม่หรือสอนเวอร์ชันที่อัปเดต), ปลดระวางอย่างชัดเจน หรือปล่อยให้มันเสื่อมต่อไป ตัวนับ ‘Stale skills’ บนแดชบอร์ดคือคิวของคุณ",
        ],
      },
    ],
    related: ["skills", "oracle"],
  },

  graph: {
    slug: "graph",
    title: "Graph",
    summary:
      "แผนที่ภาพแสดงว่า Skill ของคุณเชื่อมโยงกันอย่างไร — กฎใดเกี่ยวข้องกัน แทนที่กัน หรือรวมกลุ่มรอบหัวข้อเดียวกัน",
    surfaces: ["graph"],
    sections: [
      {
        heading: "Graph แสดงอะไร",
        body: [
          "Graph คือมุมมองจากด้านบนของ Brain ของคุณ แต่ละโหนดคือหนึ่ง Skill แต่ละเส้นคือความสัมพันธ์ที่ Brain อนุมานได้ — Skill ที่มีหัวข้อร่วมกัน ต่อยอดกัน หรือที่อันหนึ่งแทนที่อีกอัน",
        ],
      },
      {
        heading: "อ่านอย่างไร",
        body: ["ใช้มันเพื่อมองหากลุ่ม (พื้นที่ที่คุณสอนไว้มาก) และโหนดโดดเดี่ยว (Skill ที่ไม่มีการเชื่อมต่อ มักเป็นกรณีครั้งเดียว)"],
        bullets: [
          "โหนด — หนึ่ง Skill โหนดที่ใหญ่หรือสว่างกว่ามีความเชื่อมั่นสูงกว่าหรือถูกใช้บ่อยกว่า",
          "เส้น — ความสัมพันธ์ระหว่างสอง Skill (หัวข้อเกี่ยวข้องกันหรือการแทนที่)",
          "กลุ่ม — กลุ่ม Skill ที่เชื่อมโยงกันแน่นรอบหนึ่งหัวข้อ",
        ],
      },
      {
        heading: "ทำไมจึงมีประโยชน์",
        body: [
          "กลุ่มบอกว่า Brain ของคุณแข็งแรงตรงไหน ส่วนโหนดโดดเดี่ยวบอกใบ้ถึงความรู้ที่ยังไม่เชื่อมโยง มันคือแผนที่ ไม่ใช่รายการสิ่งที่ต้องทำ — ที่นี่ไม่มีอะไรต้องลงมือ",
        ],
      },
    ],
    related: ["skills", "decisions", "decay"],
  },

  decisions: {
    slug: "decisions",
    title: "การตัดสินใจ",
    summary:
      "ทางเลือกของโปรเจกต์ที่ตกลงแล้ว — สิ่งที่ทีมตัดสินและไม่ควรนำมาถกใหม่ ใช้ร่วมกันและได้รับการยกเว้นจากการเสื่อม",
    surfaces: ["decisions"],
    sections: [
      {
        heading: "การตัดสินใจคืออะไร",
        body: [
          "การตัดสินใจคือทางเลือกของโปรเจกต์ที่จงใจ: \"เราจะใช้ X\" \"เลิกใช้ Y\" \"Z ดูแล auth\" ต่างจาก Skill ทั่วไป การตัดสินใจคือความจำของโปรเจกต์ที่ใช้ร่วมกัน — มันจะปรากฏในเซสชันถัดไปของเพื่อนร่วมทีมทุกคน — และมันไม่เสื่อม มันคงอยู่จนกว่าจะมีการตัดสินใจใหม่มาแทนที่",
        ],
      },
      {
        heading: "การตัดสินใจมาจากไหน",
        body: [
          "agent จะบันทึกเมื่อคุณระบุทางเลือกของโปรเจกต์ระหว่างเซสชัน หรือคุณจะสอนมันโดยตรงก็ได้ การตัดสินใจสามารถระบุทางเลือกที่ถูกปฏิเสธ และหากมันกลับทิศการตัดสินใจก่อนหน้า ก็ชี้ไปยังการตัดสินใจที่มันแทนที่",
        ],
        bullets: [
          "แทนที่ — การตัดสินใจนี้แทนที่อันเก่า อันเก่าถูกปลดระวาง ไม่ได้ถูกลบ",
          "แทนที่จะเป็น — ทางเลือกที่ถูกพิจารณาและปฏิเสธ",
          "ขอบเขต — การตัดสินใจของโปรเจกต์มองเห็นได้ทั้งโปรเจกต์ ไม่ใช่แค่คุณ",
        ],
      },
      {
        heading: "ทำไมจึงแยกจาก Skill",
        body: [
          "Skill คือแพตเทิร์นที่ Brain เรียนรู้และให้คะแนนตามว่ามันคุ้มค่าบ่อยแค่ไหน ส่วนการตัดสินใจคือข้อเท็จจริงที่คุณยืนยัน การปนกันจะทำให้ทางเลือกที่ตัดสินแล้วค่อย ๆ เสื่อมอย่างเงียบ ๆ — การตัดสินใจจึงมีพื้นที่ของตัวเองที่ไม่เสื่อม",
        ],
      },
    ],
    related: ["skills", "sessions", "vocabulary"],
  },

  tokens: {
    slug: "tokens",
    title: "MCP tokens",
    summary:
      "Bearer token ที่ยืนยันตัวตนเครื่องมือ AI ของคุณกับ Brain นี้ หนึ่ง token ต่อหนึ่งเครื่อง × หนึ่งเครื่องมือ ทำให้การเพิกถอนแม่นยำ",
    surfaces: ["/settings/tokens", "Token install wizard", "Connection status card"],
    sections: [
      {
        heading: "ทำไมต้องมี token",
        body: [
          "MCP server ของ Brain กั้นทุกการเรียกไว้หลัง Bearer token (รวมถึง initialize) token คือวิธีที่ Claude Code, Cursor, Windsurf ฯลฯ พิสูจน์ว่าได้รับอนุญาตให้อ่านและเขียน Brain ของคุณ",
        ],
      },
      {
        heading: "การออกและติดตั้ง",
        body: [
          "สร้าง token ใน /settings/tokens คัดลอกครั้งเดียว (มันถูก hash ไว้ตอนเก็บ — เราแสดงซ้ำไม่ได้) แล้ววางลงในการตั้งค่า MCP ของไคลเอนต์ ตัวช่วยติดตั้งจะสร้าง snippet ที่ถูกต้องสำหรับไคลเอนต์ที่รองรับแต่ละตัว",
        ],
      },
      {
        heading: "ขอบเขต หมุน เพิกถอน",
        body: [
          "token เป็นแบบไม่จำกัดขอบเขต, จำกัดที่ org หรือจำกัดที่ project ได้ Rotate เปลี่ยน secret ในที่เดิม ไคลเอนต์ยังทำงานต่อจนกว่าคุณจะวางใหม่ Revoke ปิดการใช้งาน token ทั้งหมด ปุ่ม Verify ตรวจสอบฝั่งเซิร์ฟเวอร์ว่า token ยังใช้งานอยู่",
        ],
      },
    ],
    related: ["connection-status", "sessions"],
    repoDoc: { label: "tutorials/04-managing-tokens.md", href: "https://github.com/bejranonda/BrainPlatform/blob/main/docs/tutorials/04-managing-tokens.md" },
  },

  "connection-status": {
    slug: "connection-status",
    title: "สถานะการเชื่อมต่อ",
    summary:
      "เครื่องของคุณกำลังคุยกับ Brain จริงไหม และมีการเก็บความรู้อยู่หรือเปล่า การ์ดบนแดชบอร์ดตอบทั้งสองข้อ",
    surfaces: ["Dashboard top card"],
    sections: [
      {
        heading: "Heartbeat ต่อ token",
        body: [
          "แต่ละแถวคือ token หนึ่งอันของคุณ จุดเขียว + ‘Xs ago’ = token ยืนยันตัวตนการเรียกภายใน 5 นาทีล่าสุด เทา + เวลาแบบสัมพัทธ์ = ไม่มีการใช้งาน token ที่มีส่วนร่วมใน 24 ชม. ล่าสุดจะแสดงป้าย ‘Ns · Me’ ด้วย (เซสชัน · event)",
        ],
      },
      {
        heading: "ตัวนับ 24 ชั่วโมง",
        body: [
          "เซสชัน, event และ Skill ที่สกัดได้ใน 24 ชั่วโมงล่าสุด ตัวเลข > 0 พิสูจน์ว่ามีการเก็บความรู้จริง ไม่ใช่แค่ยืนยันตัวตน ตัวนับครอบคลุมทั้งผู้ใช้ — รวมเซสชันจาก token ใดก็ตามของคุณบวกกับกิจกรรมที่เริ่มจาก webapp",
        ],
      },
      {
        heading: "ความลึกของคิว KEA",
        body: [
          "งาน kea.extract ที่ค้างใน pg-boss หากความลึกค้างไม่เป็นศูนย์อย่างต่อเนื่องแปลว่า worker ไม่ได้ระบายงาน — มักเป็นสัญญาณว่าควรตรวจ container ของ worker แสดง ‘—’ เมื่อ schema ของ pgboss เข้าถึงไม่ได้จาก role ของ webapp",
        ],
      },
    ],
    related: ["tokens", "sessions", "autoskill"],
  },

  groundedness: {
    slug: "groundedness",
    title: "Groundedness",
    summary:
      "Oracle ต้องดึงบริบทจาก Brain ของคุณมาใช้มากแค่ไหนในการตอบ แสดงบนทุกคำตอบของ Oracle",
    sections: [
      {
        heading: "สี่ระดับ",
        body: ["คำนวณก่อนเรียก LLM จากชุดข้อมูลที่ค้นคืนมา:"],
        bullets: [
          "Strong — ค้นคืน Skill ที่เกี่ยวข้องสูงได้จำนวนมาก คำตอบยึดโยงแน่น",
          "Moderate — มีบริบทที่เกี่ยวข้องบ้าง คำตอบผสม Brain + ความรู้ทั่วไป",
          "Weak — มีรายการน้อยหรือเกี่ยวข้องต่ำ คำตอบพึ่งความรู้ทั่วไปเป็นหลัก",
          "None — Brain ของคุณไม่มีข้อมูลเรื่องนั้น Oracle บอกตรงๆ และระงับการอ้างอิงปลอม",
        ],
      },
      {
        heading: "ทำไมความซื่อตรงจึงสำคัญตรงนี้",
        body: [
          "Brain ที่กุการอ้างอิงเพื่อให้ดูน่าประทับใจ แย่กว่าตัวที่ยอมรับว่า ‘ไม่มีบริบท’ เมื่อคุณเห็น ‘none’ มันไม่ใช่ความล้มเหลว — แต่เป็นสัญญาณที่ถูกต้องว่าคุณควรสอน Skill เรื่องนี้ เพื่อให้คำตอบครั้งถัดไปยึดโยงได้",
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
    helpTutorialsPre: "For end-user walkthroughs: ",
    helpTutorialsLink: "tutorials/",
    helpTutorialsPost: " (six step-by-step guides).",
    helpBrokenPre: "Something broken? Check ",
    helpBrokenLink: "the troubleshooting guide",
    helpBrokenMid: " or ",
    helpBrokenLink2: "file an issue",
    helpBrokenPost: ".",
    helpRunbookPre: "Operator / production runbook: ",
    helpRunbookLink: "RUNBOOK.md",
    helpRunbookPost: ".",
    allConcepts: "← all concepts",
    whereYouSee: "Where you see this",
    relatedConcepts: "Related concepts",
    deeperReference: "Deeper reference",
    sections: {
      start: "Start here",
      core: "Core concepts",
      connection: "Connection & setup",
      deeper: "Deeper",
    },
  },
  th: {
    indexTitle: "เอกสาร",
    indexIntro:
      "เอกสารอ้างอิงภาษาเข้าใจง่ายสำหรับทุกแนวคิดและฟีเจอร์ใน External Brain หากคุณมาจากไอคอน (?) ในแอป หน้าที่คุณต้องการอยู่ด้านล่าง",
    indexHandbookPre: "สำหรับคู่มือทางเทคนิคฉบับเต็ม ดูที่ ",
    indexHandbookLink: "โฟลเดอร์ docs/ บน GitHub",
    needHelpTitle: "ต้องการความช่วยเหลือ?",
    helpTutorialsPre: "สำหรับคู่มือทีละขั้นสำหรับผู้ใช้: ",
    helpTutorialsLink: "tutorials/",
    helpTutorialsPost: " (คู่มือทีละขั้นหกชุด)",
    helpBrokenPre: "มีอะไรเสีย? ดูที่ ",
    helpBrokenLink: "คู่มือแก้ปัญหา",
    helpBrokenMid: " หรือ ",
    helpBrokenLink2: "แจ้งปัญหา (issue)",
    helpBrokenPost: "",
    helpRunbookPre: "คู่มือผู้ดูแล / การใช้งานจริง: ",
    helpRunbookLink: "RUNBOOK.md",
    helpRunbookPost: "",
    allConcepts: "← แนวคิดทั้งหมด",
    whereYouSee: "คุณเห็นสิ่งนี้ที่ไหน",
    relatedConcepts: "แนวคิดที่เกี่ยวข้อง",
    deeperReference: "อ้างอิงเชิงลึก",
    sections: {
      start: "เริ่มที่นี่",
      core: "แนวคิดหลัก",
      connection: "การเชื่อมต่อและการตั้งค่า",
      deeper: "เชิงลึก",
    },
  },
  de: {
    indexTitle: "Dokumentation",
    indexIntro:
      "Allgemein verständliche Referenz für jedes Konzept und Feature in External Brain. Wenn du von einem (?)-Symbol in der App hierherkamst, ist die gesuchte Seite unten.",
    indexHandbookPre: "Für das vollständige technische Handbuch siehe den ",
    indexHandbookLink: "docs/-Ordner auf GitHub",
    needHelpTitle: "Brauchst du Hilfe?",
    helpTutorialsPre: "Für Schritt-für-Schritt-Anleitungen: ",
    helpTutorialsLink: "tutorials/",
    helpTutorialsPost: " (sechs Schritt-für-Schritt-Anleitungen).",
    helpBrokenPre: "Etwas kaputt? Sieh in ",
    helpBrokenLink: "den Troubleshooting-Guide",
    helpBrokenMid: " oder ",
    helpBrokenLink2: "melde ein Issue",
    helpBrokenPost: ".",
    helpRunbookPre: "Betreiber- / Produktions-Runbook: ",
    helpRunbookLink: "RUNBOOK.md",
    helpRunbookPost: ".",
    allConcepts: "← alle Konzepte",
    whereYouSee: "Wo du das siehst",
    relatedConcepts: "Verwandte Konzepte",
    deeperReference: "Tiefere Referenz",
    sections: {
      start: "Hier starten",
      core: "Kernkonzepte",
      connection: "Verbindung & Einrichtung",
      deeper: "Tiefer",
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
