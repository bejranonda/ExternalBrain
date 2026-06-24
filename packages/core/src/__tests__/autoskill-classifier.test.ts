/**
 * Autoskill classifier — pure-core unit tests. No DB, no network: parse,
 * verdict→routed, flag/shadow decision, few-shot ranking, prompt build, and the
 * empty-input short-circuit of the orchestrator (which makes no call).
 */
import { describe, it, expect } from "vitest";
import {
  parseClassifierResponse,
  routedFromVerdict,
  decideTarget,
  rankFewShot,
  buildClassifierPrompt,
  classifySignals,
  GOLD_EXAMPLES,
  type Verdict,
  type FewShotExample,
} from "../autoskill-classifier.js";
import type { ScoredSignal, Routed } from "../autoskill.js";

const sig = (over: Partial<ScoredSignal> = {}): ScoredSignal => ({
  kind: "correction_repeated",
  snippet: "always import shared types from @brain/types not relative paths",
  occurrences: 2,
  lastSeenAt: new Date(0),
  evidence: [],
  score: 3,
  ...over,
});

const heuristicRouted = (): Routed => ({
  target: "rules",
  diff: "h",
  patch: { op: "append" },
  reasoning: "heuristic",
});

describe("parseClassifierResponse", () => {
  it("parses a well-formed batch keyed by index", () => {
    const text = JSON.stringify({
      verdicts: [
        { index: 0, target: "knowledge", confidence: "high", reasoning: "durable rule" },
        { index: 1, target: "ignore", confidence: "medium", reasoning: "generic" },
      ],
    });
    const m = parseClassifierResponse(text, 2);
    expect(m.get(0)?.target).toBe("knowledge");
    expect(m.get(1)?.target).toBe("ignore");
  });

  it("tolerates markdown fences", () => {
    const text = '```json\n{"verdicts":[{"index":0,"target":"rules","confidence":"high","reasoning":"x"}]}\n```';
    expect(parseClassifierResponse(text, 1).get(0)?.target).toBe("rules");
  });

  it("drops malformed / out-of-range entries (caller falls back per signal)", () => {
    const text = JSON.stringify({
      verdicts: [
        { index: 0, target: "nonsense", confidence: "high", reasoning: "x" },
        { index: 5, target: "rules", confidence: "high", reasoning: "x" },
      ],
    });
    expect(parseClassifierResponse(text, 2).size).toBe(0);
  });

  it("returns empty map on non-JSON (total fallback)", () => {
    expect(parseClassifierResponse("the model said no", 3).size).toBe(0);
  });
});

describe("routedFromVerdict", () => {
  it("ignore → null (no proposal)", () => {
    expect(
      routedFromVerdict(sig(), { target: "ignore", confidence: "medium", reasoning: "x" }),
    ).toBeNull();
  });

  it("rules → rules-export patch", () => {
    const r = routedFromVerdict(sig(), { target: "rules", confidence: "high", reasoning: "convention" });
    expect(r?.target).toBe("rules");
    expect((r?.patch as { file: string }).file).toBe(".claude/rules/conventions.md");
  });

  it("knowledge → create patch even at score 3 (widened path)", () => {
    const r = routedFromVerdict(sig({ score: 3 }), { target: "knowledge", confidence: "high", reasoning: "durable" });
    expect(r?.target).toBe("knowledge");
    expect((r?.patch as { op: string }).op).toBe("create");
  });

  it("non-routable target → null (defensive; never accidentally mints knowledge)", () => {
    const r = routedFromVerdict(sig(), { target: "skill" } as unknown as Verdict);
    expect(r).toBeNull();
  });
});

describe("decideTarget", () => {
  it("flag off → returns heuristic routed, plus shadow record", () => {
    const r = decideTarget({
      flagOn: false,
      heuristic: heuristicRouted(),
      verdict: { target: "knowledge", confidence: "high", reasoning: "x" },
      signal: sig(),
    });
    expect(r.routed?.reasoning).toBe("heuristic");
    expect(r.shadow).toEqual({ heuristic: "rules", llm: "knowledge", agree: false });
  });

  it("flag on → returns classifier routed (ignore → null)", () => {
    const r = decideTarget({
      flagOn: true,
      heuristic: heuristicRouted(),
      verdict: { target: "ignore", confidence: "medium", reasoning: "x" },
      signal: sig(),
    });
    expect(r.routed).toBeNull();
  });

  it("flag on + missing verdict → heuristic fallback (never drops)", () => {
    const r = decideTarget({ flagOn: true, heuristic: heuristicRouted(), verdict: undefined, signal: sig() });
    expect(r.routed?.reasoning).toBe("heuristic");
  });

  it("flag off + missing verdict → heuristic, shadow llm=null", () => {
    const r = decideTarget({ flagOn: false, heuristic: heuristicRouted(), verdict: undefined, signal: sig() });
    expect(r.shadow.llm).toBeNull();
    expect(r.shadow.agree).toBe(false);
  });
});

describe("rankFewShot", () => {
  it("always includes gold, appends user examples within token budget (recency order)", () => {
    const user: FewShotExample[] = [
      { source: "user", text: "A".repeat(40), target: "knowledge", recencyRank: 0 },
      { source: "user", text: "B".repeat(40), target: "rules", recencyRank: 1 },
    ];
    const out = rankFewShot(GOLD_EXAMPLES, user, 20); // ~16 tokens/example → fits 1
    expect(out.filter((e) => e.source === "gold").length).toBe(GOLD_EXAMPLES.length);
    const users = out.filter((e) => e.source === "user");
    expect(users.length).toBe(1);
    expect(users[0]?.text.startsWith("A")).toBe(true); // most recent first
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

describe("classifySignals", () => {
  it("empty input → no LLM call, empty map", async () => {
    let called = false;
    const m = await classifySignals([], "u", {
      call: async () => {
        called = true;
        return "";
      },
    });
    expect(m.size).toBe(0);
    expect(called).toBe(false);
  });
});
