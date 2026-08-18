/**
 * Embedding service — one function, cached by content hash.
 *
 * Provider strategy (per project preference):
 *   1. Primary:  Gemini Embedding 1  (`gemini-embedding-001`) — the
 *      currently-released Gemini embedding model. The previously-listed
 *      `gemini-embedding-002` is not a model Google's API recognises
 *      (returns 404 from both the native and OpenAI-compat endpoints);
 *      it has been removed from the chain to avoid a guaranteed first-
 *      provider failure on every call.
 *   2. Final fallback: whatever `EMBEDDING_MODEL` is set to (default
 *      OpenAI `text-embedding-3-small`) — keeps existing deployments
 *      working when Gemini isn't configured.
 *
 * Fallbacks are surfaced via the structured logger (NOT silent), so a
 * spike of "fell back" lines is visible in the dashboard. We retry once
 * on rate-limit / transient errors before giving up and re-throwing.
 */
import OpenAI from "openai";
import { createHash } from "node:crypto";
import { BrainError, getLogger } from "./logger.js";

const log = getLogger("core").child({ subsystem: "embedding" });

const DIM = Number(process.env.EMBEDDING_DIMENSIONS ?? "1536");
/**
 * Legacy override — used only when no Gemini API key is configured.
 *
 * Read lazily, NOT snapshotted at module load. As a module-load constant this
 * made `activeEmbeddingModel()` honour a runtime EMBEDDING_MODEL change on the
 * Gemini branch but silently ignore it on the fallback branch, and made the
 * unit tests pass only in a shell where EMBEDDING_MODEL happened to be unset —
 * while `.env.example` ships one and docker-compose passes it through.
 */
function fallbackModel(): string {
  return process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
}

/** Provider chain. Highest-priority entry tried first; on transient
 * failure we walk to the next. */
type Provider = {
  name: string;
  model: string;
  baseURL?: string;
  apiKey: string;
};

function geminiKey(): string {
  return process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
}

/** Primary Gemini model when a Gemini key is present. */
const DEFAULT_GEMINI_MODEL = "gemini-embedding-001";

/**
 * The Gemini model the primary chain entry will use.
 *
 * `EMBEDDING_MODEL` used to name ONLY the fallback entry, so an operator who
 * set it to a Gemini model saw no effect whatsoever — the hardcoded default
 * still won, and they believed they had upgraded. Honour the override when it
 * names a Gemini model; anything else stays a fallback-only setting, because
 * a non-Gemini name can't be served by the Gemini endpoint.
 */
function geminiModel(): string {
  const override = process.env.EMBEDDING_MODEL;
  return override?.startsWith("gemini-") ? override : DEFAULT_GEMINI_MODEL;
}

/**
 * The model that will actually produce vectors right now.
 *
 * Persisted next to each embedding so a model change is detectable. Vectors
 * from different models are NOT comparable — measured cosine similarity for
 * the same sentence across gemini-embedding-001 and gemini-embedding-2-preview
 * was -0.024, i.e. orthogonal. Without this, changing the model leaves a
 * silently mixed index that returns garbage with no error.
 */
export function activeEmbeddingModel(): string {
  return geminiKey() ? geminiModel() : fallbackModel();
}

function buildProviderChain(): Provider[] {
  const chain: Provider[] = [];
  const gem = geminiKey();
  if (gem) {
    // Gemini exposes an OpenAI-compatible endpoint at this base.
    const baseURL = "https://generativelanguage.googleapis.com/v1beta/openai";
    chain.push({ name: "gemini", model: geminiModel(), baseURL, apiKey: gem });
  }
  const otherKey =
    process.env.EMBEDDING_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    "";
  if (otherKey) {
    const baseURL = process.env.EMBEDDING_BASE_URL;
    chain.push({
      name: "fallback",
      model: fallbackModel(),
      apiKey: otherKey,
      ...(baseURL ? { baseURL } : {}),
    });
  }
  return chain;
}

const clientCache = new Map<string, OpenAI>();
function clientFor(p: Provider): OpenAI {
  const key = `${p.baseURL ?? ""}::${p.apiKey}`;
  let c = clientCache.get(key);
  if (!c) {
    c = new OpenAI({ apiKey: p.apiKey, ...(p.baseURL ? { baseURL: p.baseURL } : {}) });
    clientCache.set(key, c);
  }
  return c;
}

// Simple in-process LRU; production should use Redis or Postgres-backed cache.
const cache = new Map<string, number[]>();
const MAX_CACHE = 5_000;

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Errors we should walk to the next provider for (transient/quota). */
function isTransient(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string; message?: string };
  if (e.status === 429 || e.status === 408 || (e.status ?? 0) >= 500) return true;
  const msg = (e.message ?? "").toLowerCase();
  return /rate.?limit|quota|timeout|exceeded|unavailable|temporarily/.test(msg);
}

async function callEmbeddings(
  p: Provider,
  input: string | string[],
): Promise<number[][]> {
  // Some providers (Gemini) reject the `dimensions` argument when it
  // doesn't match the model's native size; we send it only when it
  // looks intentional (i.e. operator overrode the default 1536).
  const wantsDim = process.env.EMBEDDING_DIMENSIONS !== undefined;
  const res = await clientFor(p).embeddings.create({
    model: p.model,
    input,
    ...(wantsDim ? { dimensions: DIM } : {}),
  });
  return res.data.map((d) => d.embedding as number[]);
}

interface ChainResult {
  vectors: number[][];
  /** The model that actually produced `vectors` — not necessarily the primary. */
  model: string;
}

async function tryChain(input: string | string[]): Promise<ChainResult> {
  const chain = buildProviderChain();
  if (chain.length === 0) {
    throw new BrainError({
      code: "EMBEDDING_NO_PROVIDER",
      category: "config",
      message:
        "No embedding provider configured. Set GOOGLE_GEMINI_API_KEY (preferred) or OPENAI_API_KEY.",
      remediation:
        "Add GOOGLE_GEMINI_API_KEY=... to .env (Gemini Embedding 2 is the primary). OPENAI_API_KEY is accepted as a fallback.",
      retryable: false,
    });
  }
  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i]!;
    try {
      return { vectors: await callEmbeddings(p, input), model: p.model };
    } catch (err) {
      lastErr = err;
      const transient = isTransient(err);
      const hasNext = i < chain.length - 1;
      log.warn(
        {
          op: "embedding.call",
          provider: p.name,
          model: p.model,
          transient,
          willFallback: transient && hasNext,
          err,
        },
        transient && hasNext
          ? `embedding ${p.name} unavailable — falling back to ${chain[i + 1]!.name}`
          : `embedding ${p.name} failed`,
      );
      if (!transient || !hasNext) break;
    }
  }
  throw new BrainError({
    code: "EMBEDDING_ALL_PROVIDERS_FAILED",
    category: "embedding",
    message: "All embedding providers failed.",
    remediation:
      "Check provider API keys and quotas. Logs show which provider failed and why.",
    retryable: true,
    cause: lastErr,
  });
}

/**
 * Embed one text and report the model that actually produced the vector.
 *
 * Callers that persist a vector MUST use this and store `model`, not
 * `activeEmbeddingModel()`. The chain falls back to a different provider on
 * any transient error (429/5xx/quota), so stamping the *primary* model would
 * mark a fallback-produced vector as fresh — permanently exempting it from
 * re-embedding and leaving exactly the silently mixed index this column
 * exists to prevent. The fallback path is the common transient case, so this
 * is not a theoretical concern.
 */
export async function embedWithProvenance(
  text: string,
): Promise<{ vector: number[]; model: string }> {
  const { vectors, model } = await tryChain(text);
  const vec = vectors[0];
  if (!vec) {
    throw new BrainError({
      code: "EMBEDDING_EMPTY_RESPONSE",
      category: "embedding",
      message: "Embedding provider returned no vectors.",
      retryable: true,
    });
  }
  return { vector: vec, model };
}

export async function embed(text: string): Promise<number[]> {
  const key = hash(text);
  const hit = cache.get(key);
  if (hit) return hit;

  const { vectors } = await tryChain(text);
  const vec = vectors[0];
  if (!vec) {
    throw new BrainError({
      code: "EMBEDDING_EMPTY_RESPONSE",
      category: "embedding",
      message: "Embedding provider returned no vectors.",
      retryable: true,
    });
  }

  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(key, vec);
  return vec;
}

/**
 * Batch variant of {@link embedWithProvenance}.
 *
 * `model` describes the provider that served THIS call. Cache hits are
 * returned without a provider round-trip, so when every text is cached the
 * served model is reported as the currently-active one — correct, because no
 * new vector was produced.
 */
export async function embedBatchWithProvenance(
  texts: string[],
): Promise<{ vectors: number[][]; model: string }> {
  const misses: { index: number; text: string }[] = [];
  const out: (number[] | null)[] = texts.map((t) => cache.get(hash(t)) ?? null);
  texts.forEach((t, i) => {
    if (!out[i]) misses.push({ index: i, text: t });
  });

  if (misses.length === 0) {
    return { vectors: out as number[][], model: activeEmbeddingModel() };
  }

  const { vectors, model } = await tryChain(misses.map((m) => m.text));
  vectors.forEach((vec, i) => {
    const miss = misses[i]!;
    out[miss.index] = vec;
    cache.set(hash(miss.text), vec);
  });
  return { vectors: out as number[][], model };
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  // Batched API call — cheaper than N round-trips
  const { vectors } = await embedBatchWithProvenance(texts);
  return vectors;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("vectors must be same length");
  let dot = 0,
    magA = 0,
    magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
