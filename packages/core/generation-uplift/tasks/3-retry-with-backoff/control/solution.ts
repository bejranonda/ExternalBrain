export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts: number; baseDelayMs: number },
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, opts.baseDelayMs * attempt));
      }
    }
  }

  throw lastError;
}
