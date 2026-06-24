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
  openai: (
    prompt: string,
    model: string,
    systemPrompt: string,
    maxTokens: number,
    jsonObject: boolean,
  ) => Promise<string>;
  dashscope: (
    prompt: string,
    model: string,
    systemPrompt: string,
    maxTokens: number,
  ) => Promise<string>;
}

const DEFAULT_SYSTEM =
  "You are a helpful assistant. Respond only with the requested JSON.";

const realDeps: LLMDeps = {
  anthropic: async (prompt, opts) => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    // Honor ANTHROPIC_BASE_URL explicitly — on Z.ai-gateway dev brains the SDK
    // must be told to route through the gateway, otherwise it falls back to
    // api.anthropic.com which won't recognize the key.
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      ...(process.env.ANTHROPIC_BASE_URL
        ? { baseURL: process.env.ANTHROPIC_BASE_URL }
        : {}),
    });
    const res = await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.systemPrompt ?? DEFAULT_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content
      .flatMap((c) => (c.type === "text" ? [c.text] : []))
      .join("");
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
      ...(jsonObject
        ? { response_format: { type: "json_object" as const } }
        : {}),
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message.content ?? "";
  },
  dashscope: async (prompt, model, systemPrompt, maxTokens) => {
    // DashScope is OpenAI-compatible via its /compatible-mode endpoint. Guard
    // up-front: passing undefined apiKey makes the OpenAI SDK throw a misleading
    // "set the OPENAI_API_KEY env variable" error that sends operators chasing
    // the wrong env var. Fail loud with the right variable name.
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

/**
 * Dispatch a single text completion by model family:
 *   claude*       → Anthropic SDK (system param)
 *   qwen* / glm*  → DashScope (OpenAI-compatible)
 *   everything else → OpenAI (json_object response format)
 * Returns the raw assistant text. Callers own parsing.
 */
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
