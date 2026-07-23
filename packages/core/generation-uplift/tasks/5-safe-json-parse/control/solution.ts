export function safeJsonParse<T>(input: unknown, fallback: T): T {
  if (typeof input !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}
