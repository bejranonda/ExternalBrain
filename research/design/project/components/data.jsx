/* global React */
// Realistic seed data for Brain Platform

window.BRAIN_DATA = {
  user: { name: "Alex Chen", tenant: "personal", handle: "alex" },

  stats: {
    activeKnowledge: 347,
    sessionsAllTime: 1284,
    sessionsWeek: 47,
    sqsTrend: [0.52, 0.58, 0.61, 0.57, 0.64, 0.66, 0.71, 0.68, 0.73, 0.78, 0.76, 0.81],
    sqsCurrent: 0.81,
    retrievalNDCG: 0.62,
    pendingProposals: 4,
    knowledgeHealth: 0.84,
    contradictions: 3,
    decayThisWeek: 12,
    bundleHitRate: 0.73,
  },

  recentSessions: [
    { id: "s_9f4a", client: "claude-code", project: "brain-platform/apps/web", startedAt: "2026-04-20 14:22", duration: "38m", outcome: "accepted", sqs: 0.87, injected: 6, extracted: 3, icon: "claude" },
    { id: "s_9f39", client: "cursor", project: "acme-dash", startedAt: "2026-04-20 11:05", duration: "1h 12m", outcome: "accepted", sqs: 0.79, injected: 8, extracted: 4, icon: "cursor" },
    { id: "s_9f21", client: "claude-code", project: "brain-platform/packages/core", startedAt: "2026-04-19 22:40", duration: "2h 04m", outcome: "partial", sqs: 0.64, injected: 11, extracted: 7, icon: "claude" },
    { id: "s_9f07", client: "windsurf", project: "personal-site", startedAt: "2026-04-19 17:18", duration: "22m", outcome: "accepted", sqs: 0.82, injected: 4, extracted: 1, icon: "windsurf" },
    { id: "s_9ef3", client: "claude-code", project: "brain-platform", startedAt: "2026-04-19 09:51", duration: "3h 40m", outcome: "accepted", sqs: 0.91, injected: 14, extracted: 9, icon: "claude" },
    { id: "s_9ed8", client: "custom-agent", project: "side-mcp-experiment", startedAt: "2026-04-18 20:05", duration: "47m", outcome: "rejected", sqs: 0.41, injected: 3, extracted: 0, icon: "mcp" },
  ],

  knowledge: [
    { id: "k_a71", type: "heuristic", title: "Next.js build errors: clear .next before investigating", body: "When debugging opaque Next.js build errors, `rm -rf .next` first. ~60% are stale-cache artifacts.", scope: "user", confidence: 0.92, uses: 14, success: 0.93, updated: "2 days ago", tags: ["next.js", "debugging"] },
    { id: "k_a6f", type: "anti", title: "Never inline Tailwind arbitrary values", body: "User rejected inline `w-[347px]` 3× this month. Prefer extending the theme or a named class.", scope: "user", confidence: 0.88, uses: 9, success: 0.89, updated: "5 days ago", tags: ["tailwind", "style"] },
    { id: "k_a6c", type: "recipe", title: "React forms: react-hook-form + zod", body: "For this project, always scaffold forms with react-hook-form + zod resolver. Formik is deprecated here.", scope: "project", confidence: 0.95, uses: 22, success: 0.96, updated: "1 week ago", tags: ["react", "forms"] },
    { id: "k_a5a", type: "principle", title: "Prefer composition over inheritance", body: "Abstract value carried from sessions s_9e* onward. Applied during refactors.", scope: "global", confidence: 0.81, uses: 31, success: 0.87, updated: "1 week ago", tags: ["architecture"] },
    { id: "k_a58", type: "reflex", title: "Always end files with newline", body: "Unconditional. Source: POSIX + your ESLint config.", scope: "global", confidence: 1.0, uses: 104, success: 1.0, updated: "3 weeks ago", tags: ["style"] },
    { id: "k_a42", type: "heuristic", title: "SSR + localStorage: guard with typeof window", body: "Any code reading localStorage during render must guard `typeof window !== 'undefined'` or hydration mismatches.", scope: "user", confidence: 0.90, uses: 18, success: 0.94, updated: "4 days ago", tags: ["next.js", "ssr"] },
    { id: "k_a37", type: "anti", title: "Don't import from `@/components/*` in `packages/core`", body: "Package boundary violation. core is framework-agnostic.", scope: "project", confidence: 0.94, uses: 6, success: 1.0, updated: "6 days ago", tags: ["architecture", "monorepo"] },
    { id: "k_a11", type: "recipe", title: "pgvector HNSW index: lists=100, probes=10 for <1M rows", body: "Tested on brain-platform; NDCG within 2% of flat at 40× speedup.", scope: "user", confidence: 0.86, uses: 5, success: 0.80, updated: "2 weeks ago", tags: ["postgres", "pgvector"] },
  ],

  proposals: [
    { id: "p_42", confidence: "high", type: "style", title: "2-space indentation, single quotes", target: "typescript-style skill", reason: "Corrected 4× in session s_9f4a + matches 7 prior sessions", session: "s_9f4a", pattern: 4 },
    { id: "p_41", confidence: "medium", type: "anti_principle", title: "Don't inline Tailwind arbitrary values", target: "new Knowledge item", reason: "Rejected 2× this session, similar prior in s_9e21", session: "s_9f4a", pattern: 2 },
    { id: "p_40", confidence: "high", type: "recipe", title: "Always await `prisma.$transaction` for multi-write", target: "prisma-patterns skill", reason: "User corrected missing await 3× across 2 sessions", session: "s_9f39", pattern: 3 },
    { id: "p_39", confidence: "medium", type: "heuristic", title: "Use `useId()` for form field IDs, not random strings", target: "react-forms-basics skill", reason: "Rewritten 2× this session", session: "s_9f21", pattern: 2 },
  ],

  oracleChat: [
    { role: "user", content: "how did I solve the CORS issue in the MCP server last month?" },
    { role: "oracle", content: "You had two attempts on this. The one that worked — session **s_9d12** on March 14 — used a `Vary: Origin` header plus a dynamic allowlist driven by `BRAIN_ALLOWED_ORIGINS`. A week earlier you tried wildcard `*` with credentials and the browser rejected it.\n\nThe durable rule you taught me afterward:", citations: [
      { id: "k_89c", type: "anti", title: "Never use `Access-Control-Allow-Origin: *` with credentials" },
      { id: "k_89d", type: "recipe", title: "MCP server CORS: echo origin from allowlist + Vary: Origin" },
    ] },
  ],

  // Graph nodes
  graphNodes: [
    { id: "react-forms-basics", label: "react-forms-basics", type: "recipe", x: 0.45, y: 0.38, r: 12, deg: 8 },
    { id: "react-tailwind-dark-todo", label: "react-tailwind-dark-todo", type: "recipe", x: 0.62, y: 0.28, r: 10, deg: 5 },
    { id: "next-build-cache", label: "next-build-cache", type: "heuristic", x: 0.3, y: 0.48, r: 9, deg: 4 },
    { id: "composition-over-inheritance", label: "composition > inheritance", type: "principle", x: 0.7, y: 0.62, r: 14, deg: 12 },
    { id: "no-any-types", label: "no-any-types", type: "anti", x: 0.22, y: 0.7, r: 8, deg: 3 },
    { id: "newline-eof", label: "newline-eof", type: "reflex", x: 0.85, y: 0.45, r: 7, deg: 2 },
    { id: "prisma-transactions", label: "prisma-transactions", type: "recipe", x: 0.52, y: 0.72, r: 11, deg: 6 },
    { id: "pgvector-hnsw", label: "pgvector-hnsw", type: "recipe", x: 0.38, y: 0.82, r: 9, deg: 4 },
    { id: "ssr-localstorage", label: "ssr-localstorage", type: "heuristic", x: 0.55, y: 0.18, r: 8, deg: 3 },
    { id: "cors-mcp", label: "mcp-cors", type: "recipe", x: 0.8, y: 0.78, r: 8, deg: 3 },
    { id: "inline-tailwind", label: "no-inline-tw", type: "anti", x: 0.68, y: 0.45, r: 8, deg: 4 },
    { id: "package-boundaries", label: "pkg-boundaries", type: "anti", x: 0.42, y: 0.58, r: 9, deg: 5 },
    { id: "zod-schema", label: "zod-schema-first", type: "principle", x: 0.3, y: 0.28, r: 9, deg: 4 },
    { id: "useid-form", label: "useid-forms", type: "heuristic", x: 0.5, y: 0.5, r: 7, deg: 3 },
  ],
  graphEdges: [
    ["react-forms-basics", "zod-schema", "depends_on"],
    ["react-forms-basics", "useid-form", "specializes"],
    ["react-tailwind-dark-todo", "react-forms-basics", "depends_on"],
    ["react-tailwind-dark-todo", "ssr-localstorage", "depends_on"],
    ["next-build-cache", "ssr-localstorage", "deepens"],
    ["composition-over-inheritance", "package-boundaries", "specializes"],
    ["composition-over-inheritance", "no-any-types", "deepens"],
    ["prisma-transactions", "composition-over-inheritance", "specializes"],
    ["pgvector-hnsw", "prisma-transactions", "deepens"],
    ["cors-mcp", "composition-over-inheritance", "specializes"],
    ["inline-tailwind", "react-tailwind-dark-todo", "contradicts"],
    ["package-boundaries", "react-forms-basics", "deepens"],
    ["useid-form", "react-forms-basics", "specializes"],
    ["newline-eof", "composition-over-inheritance", "deepens"],
  ],

  liveExtraction: {
    session: "s_9f4a",
    events: [
      { t: 0, type: "event", text: "brain_retrieve_knowledge · prompt=\"add dark mode toggle\"" },
      { t: 300, type: "event", text: "inject · 6 items · react-tailwind-dark-todo · ssr-localstorage · +4" },
      { t: 900, type: "event", text: "user rejected diff @ components/Toggle.tsx (inline tw)" },
      { t: 1400, type: "event", text: "brain_report_session_outcome · success · sqs=0.87" },
      { t: 1700, type: "extract", text: "KEA → anti-principle: don't inline tailwind arbitrary values", conf: 0.88 },
      { t: 2100, type: "extract", text: "KEA → heuristic: prefer dark: class strategy with prefers-color-scheme", conf: 0.91 },
      { t: 2500, type: "autoskill", text: "proposal · HIGH · update typescript-style skill" },
    ],
  },
};
