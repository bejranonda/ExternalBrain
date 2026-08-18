/**
 * Which embedding model is actually active.
 *
 * `EMBEDDING_MODEL` used to name only the FALLBACK chain entry while the
 * primary Gemini entry was hardcoded — so an operator who set it to a Gemini
 * model got no change at all and believed the upgrade had happened. These
 * tests pin the resolution order so that trap can't come back, and pin the
 * value the backfill stamps onto each row for staleness detection.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { activeEmbeddingModel } from "../embedding.js";

const KEYS = [
  "GOOGLE_GEMINI_API_KEY",
  "GEMINI_API_KEY",
  "EMBEDDING_MODEL",
  "EMBEDDING_API_KEY",
  "OPENAI_API_KEY",
] as const;

describe("activeEmbeddingModel", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("defaults to gemini-embedding-001 when only a Gemini key is set", () => {
    process.env.GOOGLE_GEMINI_API_KEY = "k";
    expect(activeEmbeddingModel()).toBe("gemini-embedding-001");
  });

  it("honours EMBEDDING_MODEL when it names a Gemini model", () => {
    process.env.GOOGLE_GEMINI_API_KEY = "k";
    process.env.EMBEDDING_MODEL = "gemini-embedding-2-preview";
    expect(activeEmbeddingModel()).toBe("gemini-embedding-2-preview");
  });

  it("accepts the legacy GEMINI_API_KEY spelling", () => {
    process.env.GEMINI_API_KEY = "k";
    expect(activeEmbeddingModel()).toBe("gemini-embedding-001");
  });

  it("ignores a non-Gemini EMBEDDING_MODEL for the Gemini primary", () => {
    // The Gemini endpoint cannot serve an OpenAI model name, so this stays a
    // fallback-only setting rather than silently breaking the primary.
    process.env.GOOGLE_GEMINI_API_KEY = "k";
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    expect(activeEmbeddingModel()).toBe("gemini-embedding-001");
  });

  it("falls back to EMBEDDING_MODEL when no Gemini key is configured", () => {
    process.env.OPENAI_API_KEY = "k";
    process.env.EMBEDDING_MODEL = "text-embedding-3-small";
    expect(activeEmbeddingModel()).toBe("text-embedding-3-small");
  });

  it("returns a stable identity across calls, so staleness is not spurious", () => {
    // The backfill compares this value against the stored column; a value
    // that varied per call would re-embed the whole table on every run.
    process.env.GOOGLE_GEMINI_API_KEY = "k";
    expect(activeEmbeddingModel()).toBe(activeEmbeddingModel());
  });
});
