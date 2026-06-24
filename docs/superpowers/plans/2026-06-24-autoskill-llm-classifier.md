# Autoskill LLM Classifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `routeSignal`'s keyword classifier (rules | knowledge | ignore) with an LLM classifier grounded in the user's own resolved proposals, behind a default-off flag that shadow-logs agreement.

**Architecture:** Extract a shared `llm.ts` provider-dispatch seam (reused by `kea.ts`). Add `autoskill-classifier.ts` as **pure cores** (prompt build, response parse, verdict→routed, flag/shadow decision) plus one impure orchestrator (`classifySignals`) that calls the LLM seam and assembles few-shot from the DB. `routeSignal` keeps its cheap pre-filters (score gate, skill short-circuit) and delegates the type decision to a precomputed verdict map.

**Tech Stack:** TypeScript (strict), Vitest, `@anthropic-ai/sdk` / `openai` (dynamic import), Prisma, zod-free hand-validation (matches `parseFindings`).

**Spec:** `docs/superpowers/specs/2026-06-24-autoskill-llm-classifier-design.md`

**Constraints:** No DB migration. Local gates can't run (Node 18, no pnpm) — rely on CI; every testable unit is pure (no DB, no network) so CI's keyless `vitest` covers them.

---

## File Structure

- **Create** `packages/core/src/llm.ts` — `callLLMText(prompt, opts, deps?)`: provider dispatch returning raw text; SDK impls injectable for tests.
- **Modify** `packages/core/src/kea.ts:713-791` — `callAnthropic`/`callOpenAI`/`callDashScope` become thin wrappers over `callLLMText` + `parseFindings`. Behaviour-preserving.
- **Create** `packages/core/src/autoskill-classifier.ts` — `Verdict` type, `buildClassifierPrompt`, `parseClassifierResponse`, `routedFromVerdict`, `decideTarget`, `selectFewShot` (impure), `classifySignals` (impure).
- **Modify** `packages/core/src/autoskill.ts` — `runForSession` batch-classifies before the loop; `routeSignal` takes a verdict + uses `decideTarget`; export `ScoredSignal`/`Routed` for the classifier.
- **Create** `packages/core/src/__tests__/autoskill-classifier.test.ts` — pure-unit tests.
- **Create** `packages/core/src/__tests__/llm-dispatch.test.ts` — dispatch parity via injected deps.
- **Modify** `.env.example` — document `AUTOSKILL_*` vars.

---

## Task 1: Extract the LLM dispatch seam (`llm.ts`)

**Files:**
- Create: `packages/core/src/llm.ts`
- Test: `packages/core/src/__tests__/llm-dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// llm-dispatch.test.ts
import { describe, it, expect } from "vitest";
import { callLLMText, type LLMDeps } from "../llm.js";

function recordingDeps(): { deps: LLMDeps; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      anthropic: async (p, o) => { calls.push(`anthropic:${o.model}`); return "A"; },
      openai: async (p, m) => { calls.push(`openai:${m}`); return "O"; },
      dashscope: async (p, m) => { calls.push(`dashscope:${m}`); return "D"; },
    },
  };
}

describe("callLLMText dispatch", () => {
  it("routes claude* to anthropic", async () => {
    const { deps, calls } = recordingDeps();
    const out = await callLLMText("hi", { model: "claude-haiku-4-5" }, deps);
    expect(out).toBe("A");
    expect(calls).toEqual(["anthropic:claude-haiku-4-5"]);
  });
  it("routes qwen*/glm* to dashscope", async () => {
    const { deps, calls } = recordingDeps();
    await callLLMText("hi", { model: "qwen3-coder" }, deps);
    await callLLMText("hi", { model: "glm-5.1" }, deps);
    expect(calls).toEqual(["dashscope:qwen3-coder", "dashscope:glm-5.1"]);
  });
  it("routes everything else to openai", async () => {
    const { deps, calls } = recordingDeps();
    await callLLMText("hi", { model: "gpt-4o-mini" }, deps);
    expect(calls).toEqual(["openai:gpt-4o-mini"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @brain/core test llm-dispatch`
Expected: FAIL — cannot find module `../llm.js`.

- [ ] **Step 3: Write `llm.ts`**

```typescript
/**
 * Shared LLM call seam — one copy of provider dispatch (Anthropic / DashScope /
 * OpenAI), honoring ANTHROPIC_BASE_URL for Z.ai-gateway deployments. Returns raw
 * text; callers parse. The real SDK impls are injectable (`deps`) so dispatch is
 * unit-testable without API keys.
 */
export interface LLMCallOpts {
  model: string;
  systemPrompt?: string;
  maxTokens?: number;
}

export interface LLMDeps {
  anthropic: (prompt: string, opts: LLMCallOpts) => Promise<string>;
  openai: (prompt: string, model: string, systemPrompt: string, maxTokens: number, jsonObject: boolean) => Promise<string>;
  dashscope: (prompt: string, model: string, systemPrompt: string, maxTokens: number) => Promise<string>;
}

const DEFAULT_SYSTEM = "You are a helpful assistant. Respond only with the requested JSON.";

const realDeps: LLMDeps = {
  anthropic: async (prompt, opts) => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
    });
    const res = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.systemPrompt ?? DEFAULT_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  },
  openai: async (prompt, model, systemPrompt, maxTokens, jsonObject) => {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      ...(jsonObject ? { response_format: { type: "json_object" as const } } : {}),
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message.content ?? "";
  },
  dashscope: async (prompt, model, systemPrompt, maxTokens) => {
    if (!process.env.DASHSCOPE_API_KEY) {
      throw new Error(
        `model=${model} routes to DashScope but DASHSCOPE_API_KEY is unset. ` +
          `Set DASHSCOPE_API_KEY, or switch the model to a configured provider ` +
          `(claude-* needs ANTHROPIC_API_KEY; gpt-* needs OPENAI_API_KEY).`,
      );
    }
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    });
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message.content ?? "";
  },
};

export async function callLLMText(
  prompt: string,
  opts: LLMCallOpts,
  deps: LLMDeps = realDeps,
): Promise<string> {
  const model = opts.model;
  const system = opts.systemPrompt ?? DEFAULT_SYSTEM;
  const maxTokens = opts.maxTokens ?? 1024;
  if (model.startsWith("claude")) return deps.anthropic(prompt, opts);
  if (model.startsWith("qwen") || model.startsWith("glm")) {
    return deps.dashscope(prompt, model, system, maxTokens);
  }
  return deps.openai(prompt, model, system, maxTokens, true);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @brain/core test llm-dispatch`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/llm.ts packages/core/src/__tests__/llm-dispatch.test.ts
git commit -m "feat(core): shared callLLMText provider-dispatch seam"
```

---

## Task 2: Route kea.ts through the seam (behaviour-preserving)

**Files:**
- Modify: `packages/core/src/kea.ts:713-791`

- [ ] **Step 1: Replace the three call helpers with wrappers**

Replace `callAnthropic`/`callOpenAI`/`callDashScope` bodies (keep signatures + `parseFindings`):

```typescript
import { callLLMText } from "./llm.js"; // add to the import block at top

async function callAnthropic(
  userPrompt: string,
  opts: { model?: string; systemPrompt?: string; maxTokens?: number } = {},
): Promise<KEAFinding[]> {
  const text = await callLLMText(userPrompt, {
    model: opts.model ?? "claude-haiku-4-5",
    systemPrompt: opts.systemPrompt ?? SYSTEM_PROMPT,
    maxTokens: opts.maxTokens ?? 1024,
  });
  return parseFindings(text);
}

async function callOpenAI(
  userPrompt: string,
  model: string,
  systemPrompt: string = SYSTEM_PROMPT,
): Promise<KEAFinding[]> {
  return parseFindings(await callLLMText(userPrompt, { model, systemPrompt, maxTokens: 1024 }));
}

async function callDashScope(
  userPrompt: string,
  model: string,
  systemPrompt: string = SYSTEM_PROMPT,
): Promise<KEAFinding[]> {
  return parseFindings(await callLLMText(userPrompt, { model, systemPrompt, maxTokens: 1024 }));
}
```

- [ ] **Step 2: Verify kea tests still pass (they inject seams above this layer)**

Run: `pnpm --filter @brain/core test kea`
Expected: PASS — `kea-refine`, `kea-decision-route`, `kea-cross-extract`, `kea-audit-writes` unchanged (none reach the real call path; they inject `judge`).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/kea.ts
git commit -m "refactor(core): route kea LLM calls through callLLMText (no behaviour change)"
```

---

## Task 3: Classifier pure cores — types, parse, verdict→routed

**Files:**
- Create: `packages/core/src/autoskill-classifier.ts`
- Modify: `packages/core/src/autoskill.ts` (export `ScoredSignal` + `Routed`)
- Test: `packages/core/src/__tests__/autoskill-classifier.test.ts`

- [ ] **Step 1: Export the shared types from autoskill.ts**

Change `interface ScoredSignal` (line 142) to `export interface ScoredSignal` and `interface Routed` (line 436) to `export interface Routed`.

- [ ] **Step 2: Write the failing test for parse + routedFromVerdict**

```typescript
// autoskill-classifier.test.ts
import { describe, it, expect } from "vitest";
import { parseClassifierResponse, routedFromVerdict, type Verdict } from "../autoskill-classifier.js";
import type { ScoredSignal } from "../autoskill.js";

const sig = (over: Partial<ScoredSignal> = {}): ScoredSignal => ({
  kind: "correction_repeated", snippet: "always import shared types from @brain/types not relative paths",
  occurrences: 2, lastSeenAt: new Date(0), evidence: [], score: 3, ...over,
});

describe("parseClassifierResponse", () => {
  it("parses a well-formed batch keyed by index", () => {
    const text = JSON.stringify({ verdicts: [
      { index: 0, target: "knowledge", confidence: "high", reasoning: "durable rule" },
      { index: 1, target: "ignore", confidence: "medium", reasoning: "generic" },
    ]});
    const m = parseClassifierResponse(text, 2);
    expect(m.get(0)?.target).toBe("knowledge");
    expect(m.get(1)?.target).toBe("ignore");
  });
  it("drops malformed / out-of-range entries (caller falls back per signal)", () => {
    const text = JSON.stringify({ verdicts: [
      { index: 0, target: "nonsense", confidence: "high", reasoning: "x" },
      { index: 5, target: "rules", confidence: "high", reasoning: "x" },
    ]});
    const m = parseClassifierResponse(text, 2);
    expect(m.size).toBe(0);
  });
  it("returns empty map on non-JSON (total fallback)", () => {
    expect(parseClassifierResponse("the model said no", 3).size).toBe(0);
  });
});

describe("routedFromVerdict", () => {
  it("ignore → null (no proposal)", () => {
    expect(routedFromVerdict(sig(), { target: "ignore", confidence: "medium", reasoning: "x" })).toBeNull();
  });
  it("rules → rules-export patch", () => {
    const r = routedFromVerdict(sig(), { target: "rules", confidence: "high", reasoning: "convention" });
    expect(r?.target).toBe("rules");
    expect((r?.patch as { file: string }).file).toBe(".claude/rules/conventions.md");
  });
  it("knowledge → create patch with inferred type (widened path: score 3 allowed)", () => {
    const r = routedFromVerdict(sig({ score: 3 }), { target: "knowledge", confidence: "high", reasoning: "durable" });
    expect(r?.target).toBe("knowledge");
    expect((r?.patch as { op: string }).op).toBe("create");
  });
  it("skill/internal_skill verdicts are not minted here → null (skill match is handled upstream)", () => {
    // @ts-expect-error — classifier only emits the three targets
    expect(routedFromVerdict(sig(), { target: "skill", confidence: "high", reasoning: "x" })).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @brain/core test autoskill-classifier`
Expected: FAIL — cannot find `../autoskill-classifier.js`.

- [ ] **Step 4: Implement the pure cores**

Reuse `inferKnowledgeType`/`deriveTrigger` by exporting them from `autoskill.ts` (change `function inferKnowledgeType` → `export function`, `function deriveTrigger` → `export function`). Then:

```typescript
// autoskill-classifier.ts (pure cores section)
import type { ScoredSignal, Routed } from "./autoskill.js";
import { inferKnowledgeType, deriveTrigger } from "./autoskill.js";

export type ClassifierTarget = "rules" | "knowledge" | "ignore";
export interface Verdict {
  target: ClassifierTarget;
  confidence: "high" | "medium";
  reasoning: string;
}

const TARGETS = new Set<ClassifierTarget>(["rules", "knowledge", "ignore"]);

export function parseClassifierResponse(text: string, batchSize: number): Map<number, Verdict> {
  const out = new Map<number, Verdict>();
  try {
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as { verdicts?: unknown };
    if (!Array.isArray(parsed.verdicts)) return out;
    for (const v of parsed.verdicts as Array<Record<string, unknown>>) {
      const index = v.index;
      const target = v.target;
      if (typeof index !== "number" || index < 0 || index >= batchSize) continue;
      if (typeof target !== "string" || !TARGETS.has(target as ClassifierTarget)) continue;
      const confidence = v.confidence === "high" ? "high" : "medium";
      const reasoning = typeof v.reasoning === "string" ? v.reasoning : "";
      out.set(index, { target: target as ClassifierTarget, confidence, reasoning });
    }
  } catch {
    return out;
  }
  return out;
}

export function routedFromVerdict(s: ScoredSignal, v: Verdict): Routed | null {
  if (v.target === "ignore") return null;
  if (v.target === "rules") {
    return {
      target: "rules",
      diff: `Add to rules export: ${s.snippet}`,
      patch: { op: "append", file: ".claude/rules/conventions.md", text: s.snippet, evidence: s.evidence },
      reasoning: `Classifier (${v.confidence}): ${v.reasoning || "project convention"}.`,
    };
  }
  // knowledge — widened path: durability judged by the LLM, no score>=5 gate
  const type = inferKnowledgeType(s);
  return {
    target: "knowledge",
    diff: `Create new ${type}: ${s.snippet}`,
    patch: {
      op: "create", type, trigger: deriveTrigger(s.snippet), rule: s.snippet,
      rationale: `Auto-extracted by autoskill classifier (${s.kind}, occurrences=${s.occurrences}).`,
      evidence: s.evidence,
    },
    reasoning: `Classifier (${v.confidence}): ${v.reasoning || "durable atomic knowledge"}.`,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @brain/core test autoskill-classifier`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/autoskill-classifier.ts packages/core/src/autoskill.ts packages/core/src/__tests__/autoskill-classifier.test.ts
git commit -m "feat(core): autoskill classifier pure cores (parse + verdict→routed)"
```

---

## Task 4: The flag/shadow decision (`decideTarget`, pure)

**Files:**
- Modify: `packages/core/src/autoskill-classifier.ts`
- Test: `packages/core/src/__tests__/autoskill-classifier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { decideTarget } from "../autoskill-classifier.js";

const heuristic = (): import("../autoskill.js").Routed => ({
  target: "rules", diff: "h", patch: { op: "append" }, reasoning: "heuristic",
});

describe("decideTarget", () => {
  it("flag off → returns heuristic routed, plus shadow record", () => {
    const r = decideTarget({ flagOn: false, heuristic: heuristic(), verdict: { target: "knowledge", confidence: "high", reasoning: "x" }, signal: sig() });
    expect(r.routed?.reasoning).toBe("heuristic");
    expect(r.shadow).toEqual({ heuristic: "rules", llm: "knowledge", agree: false });
  });
  it("flag on → returns classifier routed", () => {
    const r = decideTarget({ flagOn: true, heuristic: heuristic(), verdict: { target: "ignore", confidence: "medium", reasoning: "x" }, signal: sig() });
    expect(r.routed).toBeNull(); // ignore
  });
  it("flag on + missing verdict → falls back to heuristic (never drops)", () => {
    const r = decideTarget({ flagOn: true, heuristic: heuristic(), verdict: undefined, signal: sig() });
    expect(r.routed?.reasoning).toBe("heuristic");
  });
  it("flag off + missing verdict → heuristic, shadow llm=null", () => {
    const r = decideTarget({ flagOn: false, heuristic: heuristic(), verdict: undefined, signal: sig() });
    expect(r.shadow?.llm).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @brain/core test autoskill-classifier`
Expected: FAIL — `decideTarget` not exported.

- [ ] **Step 3: Implement**

```typescript
export interface ShadowRecord { heuristic: string | null; llm: string | null; agree: boolean; }
export function decideTarget(args: {
  flagOn: boolean;
  heuristic: Routed | null;
  verdict: Verdict | undefined;
  signal: ScoredSignal;
}): { routed: Routed | null; shadow: ShadowRecord } {
  const { flagOn, heuristic, verdict, signal } = args;
  const hTarget = heuristic ? heuristic.target : "ignore";
  const lTarget = verdict ? verdict.target : null;
  const shadow: ShadowRecord = { heuristic: hTarget, llm: lTarget, agree: lTarget === hTarget };
  if (!flagOn || !verdict) return { routed: heuristic, shadow };
  return { routed: routedFromVerdict(signal, verdict), shadow };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @brain/core test autoskill-classifier`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/autoskill-classifier.ts packages/core/src/__tests__/autoskill-classifier.test.ts
git commit -m "feat(core): flag/shadow decideTarget for autoskill classifier"
```

---

## Task 5: Prompt builder + few-shot selection (pure rank + impure fetch)

**Files:**
- Modify: `packages/core/src/autoskill-classifier.ts`
- Test: `packages/core/src/__tests__/autoskill-classifier.test.ts`

- [ ] **Step 1: Write the failing test for the pure ranker + prompt**

```typescript
import { rankFewShot, buildClassifierPrompt, GOLD_EXAMPLES, type FewShotExample } from "../autoskill-classifier.js";

describe("rankFewShot", () => {
  it("always includes gold, appends user examples within token budget (recency order)", () => {
    const user: FewShotExample[] = [
      { source: "user", text: "A".repeat(40), target: "knowledge", recencyRank: 0 },
      { source: "user", text: "B".repeat(40), target: "rules", recencyRank: 1 },
    ];
    const out = rankFewShot(GOLD_EXAMPLES, user, 60); // ~60 tokens budget → ~1 user example
    expect(out.filter((e) => e.source === "gold").length).toBe(GOLD_EXAMPLES.length);
    expect(out.filter((e) => e.source === "user").length).toBe(1);
    expect(out.find((e) => e.source === "user")?.text.startsWith("A")).toBe(true); // most recent first
  });
  it("zero user examples → gold only (cold start)", () => {
    expect(rankFewShot(GOLD_EXAMPLES, [], 1000).every((e) => e.source === "gold")).toBe(true);
  });
});

describe("buildClassifierPrompt", () => {
  it("includes every signal with its index and the class definitions", () => {
    const p = buildClassifierPrompt([sig({ snippet: "use the logger utility" })], GOLD_EXAMPLES);
    expect(p).toContain("[0]");
    expect(p).toContain("rules");
    expect(p).toContain("knowledge");
    expect(p).toContain("ignore");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @brain/core test autoskill-classifier`
Expected: FAIL — `rankFewShot`/`buildClassifierPrompt`/`GOLD_EXAMPLES` not exported.

- [ ] **Step 3: Implement gold set, ranker, prompt builder**

```typescript
export interface FewShotExample {
  source: "gold" | "user";
  text: string;
  target: ClassifierTarget;
  recencyRank?: number; // user only; 0 = most recent
}

export const GOLD_EXAMPLES: FewShotExample[] = [
  { source: "gold", text: "always import shared types from @brain/types, never via relative ../types paths", target: "knowledge" },
  { source: "gold", text: "in this project we use the central logger utility instead of console.log", target: "rules" },
  { source: "gold", text: "naming convention: hooks live in components/brain and are prefixed use", target: "rules" },
  { source: "gold", text: "never narrate what the code does in comments; only document non-obvious why", target: "knowledge" },
  { source: "gold", text: "be more careful next time", target: "ignore" },
  { source: "gold", text: "good catch, perfect", target: "ignore" },
  { source: "gold", text: "prefer websearch_to_tsquery over ILIKE for session search ranking", target: "knowledge" },
];

const APPROX_CHARS_PER_TOKEN = 4;
const tokenCost = (e: FewShotExample) => Math.ceil(e.text.length / APPROX_CHARS_PER_TOKEN) + 6;

export function rankFewShot(
  gold: FewShotExample[],
  user: FewShotExample[],
  tokenBudget: number,
): FewShotExample[] {
  const ranked = [...user].sort((a, b) => (a.recencyRank ?? 0) - (b.recencyRank ?? 0));
  const out = [...gold];
  let spent = 0;
  for (const e of ranked) {
    const c = tokenCost(e);
    if (spent + c > tokenBudget) break;
    spent += c;
    out.push(e);
  }
  return out;
}

const CLASS_DEFS = `You classify each session signal into exactly one target:
- "rules": a project convention / workflow preference destined for a rules file (e.g. naming, imports, "we use X here").
- "knowledge": a durable, atomic, reusable rule the user should keep (a reflex, principle, anti-principle, heuristic, or recipe).
- "ignore": generic encouragement, transient one-offs, or anything too vague to act on. Use ignore RARELY — when in doubt between capturing and discarding, prefer to capture.`;

export function buildClassifierPrompt(signals: ScoredSignal[], fewShot: FewShotExample[]): string {
  const examples = fewShot.map((e) => `- (${e.target}) ${e.text}`).join("\n");
  const items = signals.map((s, i) => `[${i}] (${s.kind}, score=${s.score}) ${s.snippet}`).join("\n");
  return `${CLASS_DEFS}

EXAMPLES:
${examples}

SIGNALS TO CLASSIFY:
${items}

Respond with JSON: {"verdicts":[{"index":<n>,"target":"rules|knowledge|ignore","confidence":"high|medium","reasoning":"<short>"}]} — one entry per signal index above.`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @brain/core test autoskill-classifier`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/autoskill-classifier.ts packages/core/src/__tests__/autoskill-classifier.test.ts
git commit -m "feat(core): classifier gold few-shot + budgeted ranker + prompt builder"
```

---

## Task 6: Impure orchestration — `selectFewShot` (DB) + `classifySignals` (LLM)

**Files:**
- Modify: `packages/core/src/autoskill-classifier.ts`

- [ ] **Step 1: Implement `selectFewShot` (user-derived, fail-soft, scope-filtered)**

```typescript
import { db } from "@brain/db";
import { callLLMText } from "./llm.js";
import { getLogger } from "./logger.js";

const log = getLogger("autoskill.classify");
const FEWSHOT_BUDGET = () => Number(process.env.AUTOSKILL_FEWSHOT_TOKEN_BUDGET ?? 1500);
const CLASSIFY_MAX = () => Number(process.env.AUTOSKILL_CLASSIFY_MAX ?? 12);
const CLASSIFIER_ON = () => /^(1|true|yes|on)$/i.test(process.env.AUTOSKILL_LLM_CLASSIFIER ?? "");
const MODEL = () => process.env.AUTOSKILL_MODEL ?? process.env.KEA_MODEL ?? "qwen3-coder";

/** User-derived few-shot: resolved proposals (taste) + recent knowledge (taxonomy).
 *  SCOPE INVARIANT: every query filters by the acting userId. Fail-soft → []. */
async function selectFewShot(userId: string): Promise<FewShotExample[]> {
  try {
    const [proposals, knowledge] = await Promise.all([
      db.autoskillProposal.findMany({
        where: { userId, status: { in: ["applied", "rejected"] }, target: { in: ["rules", "knowledge"] } },
        orderBy: { resolvedAt: "desc" }, take: 12,
        select: { target: true, diff: true, status: true },
      }),
      db.knowledge.findMany({
        where: { ownerUserId: userId, tags: { has: "autoskill" } },
        orderBy: { createdAt: "desc" }, take: 8,
        select: { ruleText: true, scope: true },
      }),
    ]);
    const out: FewShotExample[] = [];
    proposals.forEach((p, i) => {
      // rejected rows teach the ignore boundary; accepted teach the positive class
      const target = p.status === "rejected" ? "ignore" : (p.target as ClassifierTarget);
      out.push({ source: "user", text: p.diff.replace(/^[^:]*:\s*/, "").slice(0, 160), target, recencyRank: i });
    });
    knowledge.forEach((k, i) => {
      out.push({ source: "user", text: k.ruleText.slice(0, 160), target: k.scope === "global" ? "rules" : "knowledge", recencyRank: proposals.length + i });
    });
    return out;
  } catch (err) {
    log.warn({ err, userId }, "selectFewShot failed — gold-only fallback");
    return [];
  }
}
```

- [ ] **Step 2: Implement `classifySignals` (one batched call, fail-soft)**

```typescript
export interface ClassifyDeps { call?: typeof callLLMText; }

/** Classify the surviving signals in ONE batched LLM call. Returns a verdict map
 *  keyed by batch index. Empty input → no call. Any error → empty map (caller
 *  falls back to the heuristic per signal). Over-cap signals are not classified. */
export async function classifySignals(
  signals: ScoredSignal[],
  userId: string,
  deps: ClassifyDeps = {},
): Promise<Map<number, Verdict>> {
  if (signals.length === 0) return new Map();
  const batch = signals.slice(0, CLASSIFY_MAX());
  if (batch.length < signals.length) {
    log.info({ dropped: signals.length - batch.length }, "classify batch over cap — remainder routes via heuristic");
  }
  const call = deps.call ?? callLLMText;
  try {
    const fewShot = rankFewShot(GOLD_EXAMPLES, await selectFewShot(userId), FEWSHOT_BUDGET());
    const prompt = buildClassifierPrompt(batch, fewShot);
    const text = await call(prompt, { model: MODEL(), maxTokens: 1024 });
    return parseClassifierResponse(text, batch.length);
  } catch (err) {
    log.warn({ err, userId }, "classifySignals failed — heuristic fallback for all signals");
    return new Map();
  }
}

export function classifierEnabled(): boolean { return CLASSIFIER_ON(); }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @brain/core typecheck`
Expected: PASS (no `any`, all imports resolve).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/autoskill-classifier.ts
git commit -m "feat(core): classifySignals batched call + user-derived few-shot (fail-soft, scope-filtered)"
```

---

## Task 7: Wire into `runForSession` / `routeSignal`

**Files:**
- Modify: `packages/core/src/autoskill.ts:53-120` (runForSession), `:444-503` (routeSignal)

- [ ] **Step 1: Make `routeSignal` heuristic-only + accept a verdict**

Split current `routeSignal` so the skill short-circuit + heuristic type-branch stay, but the final decision goes through `decideTarget`. New shape:

```typescript
import { classifySignals, classifierEnabled, decideTarget, type Verdict } from "./autoskill-classifier.js";

async function routeSignal(
  s: ScoredSignal,
  userId: string,
  verdict: Verdict | undefined,
): Promise<Routed | null> {
  if (s.score < 3) return null;

  // Skill short-circuit stays exact (embedding/tag match, upstream of the LLM).
  const skill = await findRelatedSkill(s.snippet, userId);
  if (skill && s.score >= 3) {
    return {
      target: "skill", targetId: skill.id,
      diff: `Append rule to skill "${skill.title}": ${s.snippet}`,
      patch: { op: "append", section: sectionForSignal(s), text: s.snippet, evidence: s.evidence },
      reasoning: `Signal scored ${s.score} (${s.kind}); matches skill "${skill.title}".`,
    };
  }

  // Heuristic type decision (the legacy path) — computed regardless so it can
  // drive behaviour (flag off) or serve as fail-soft fallback (flag on).
  const heuristic = heuristicRoute(s);

  const { routed, shadow } = decideTarget({ flagOn: classifierEnabled(), heuristic, verdict, signal: s });
  log.info({ kind: s.kind, score: s.score, ...shadow }, "autoskill.classify.shadow");
  return routed;
}

/** The pre-LLM keyword classifier, extracted verbatim from the old routeSignal. */
function heuristicRoute(s: ScoredSignal): Routed | null {
  if (isProjectConvention(s.snippet) || isSessionBehavior(s.snippet)) {
    return {
      target: "rules", diff: `Add to rules export: ${s.snippet}`,
      patch: { op: "append", file: ".claude/rules/conventions.md", text: s.snippet, evidence: s.evidence },
      reasoning: `Signal scored ${s.score}; classified as project convention.`,
    };
  }
  if (s.score >= 5) {
    const type = inferKnowledgeType(s);
    return {
      target: "knowledge", diff: `Create new ${type}: ${s.snippet}`,
      patch: { op: "create", type, trigger: deriveTrigger(s.snippet), rule: s.snippet,
        rationale: `Auto-extracted by autoskill from session events (${s.kind}, occurrences=${s.occurrences}).`,
        evidence: s.evidence },
      reasoning: `Signal scored ${s.score} with no active skill match; promoting to atomic knowledge.`,
    };
  }
  return null;
}
```

Add at top of `autoskill.ts`: `import { getLogger } from "./logger.js"; const log = getLogger("autoskill");`

- [ ] **Step 2: Batch-classify in `runForSession` before the loop**

In `runForSession`, after `const durable = resolved.filter(passesQualityFilter);` and before the `for` loop:

```typescript
  // Batch classification once (one LLM call). Empty/over-cap/error → empty map,
  // and routeSignal falls back to the heuristic per signal.
  const verdicts = await classifySignals(durable, session.userId);
```

Change the loop head from `for (const s of durable) {` to track index:

```typescript
  for (let i = 0; i < durable.length; i++) {
    const s = durable[i]!;
    const routed = await routeSignal(s, session.userId, verdicts.get(i));
    if (!routed) continue;
    // ... existing idempotency + create block unchanged ...
  }
```

- [ ] **Step 3: Typecheck + run the full core suite**

Run: `pnpm --filter @brain/core typecheck && pnpm --filter @brain/core test`
Expected: PASS — existing `autoskill.test.ts` pure-function tests unaffected (scoreSignal/tierForScore/passesQualityFilter/detectSignals/appendToAutoskillBlock unchanged).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/autoskill.ts
git commit -m "feat(autoskill): batch-classify signals, route via decideTarget (flag-gated)"
```

---

## Task 8: Document env + ship

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Append the documented vars to `.env.example`**

```bash
# --- Autoskill LLM classifier (optional; default off) ---
# When true, the worker classifies post-session signals (rules|knowledge|ignore)
# with an LLM instead of keyword heuristics. Off = heuristic stays live and the
# classifier only shadow-logs agreement. No DB migration.
AUTOSKILL_LLM_CLASSIFIER=false
# Model for the classifier (falls back to KEA_MODEL, then qwen3-coder).
# AUTOSKILL_MODEL=
# Max signals per batched classify call (overflow routes via heuristic).
# AUTOSKILL_CLASSIFY_MAX=12
# Token budget for user-derived few-shot examples.
# AUTOSKILL_FEWSHOT_TOKEN_BUDGET=1500
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document AUTOSKILL_* classifier env vars"
```

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feature/autoskill-llm-classifier
gh pr create --title "feat(autoskill): LLM signal classifier behind AUTOSKILL_LLM_CLASSIFIER" --body "<spec summary + honest test plan>"
```

- [ ] **Step 4: Watch CI; merge on green per autonomous-CD policy B (no migration); deploy; smoke.**

---

## Self-Review

**Spec coverage:** D1 surgical (Task 7 keeps score gate + skill match; only type decision moves) ✅. D2 hybrid few-shot (Task 5 gold + Task 6 user-derived) ✅. D3 flag default-off + shadow (Task 4 `decideTarget`, Task 7 log) ✅. D4 extract `llm.ts` (Tasks 1-2) ✅. D5 bias-to-capture + widened knowledge path (Task 3 `routedFromVerdict` no score gate; gold/CLASS_DEFS instruct rare-ignore) ✅. D6 fail-soft (Task 6 empty-map on error; Task 4 missing-verdict → heuristic) ✅. Quality-filter floor unchanged (Task 7 leaves `durable` filter in place) ✅. Scope isolation (Task 6 every query filters `userId`/`ownerUserId`) ✅.

**Deviation from spec (recorded):** §4.3 specified *cosine* ranking for nearest knowledge; v1 ranks user few-shot by **recency** (cheaper, no vector query, validatable without a live pgvector index). Cosine refinement is a fast-follow. Spec note to be added.

**Placeholder scan:** PR body `<spec summary…>` is a fill-at-time marker, not code — acceptable. No code placeholders.

**Type consistency:** `Verdict`/`ClassifierTarget` consistent across Tasks 3-7. `routedFromVerdict`/`decideTarget`/`classifySignals`/`rankFewShot`/`buildClassifierPrompt`/`parseClassifierResponse` signatures match their call sites. `ScoredSignal`/`Routed` exported in Task 3, imported in classifier. `heuristicRoute` defined Task 7, used Task 7.
