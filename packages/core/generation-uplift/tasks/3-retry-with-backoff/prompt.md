Implement a `retryWithBackoff` utility in TypeScript.

```ts
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts: number; baseDelayMs: number },
): Promise<T> {
  // ...
}
```

Requirements:
- Calls `fn()`. If it resolves, return the result immediately (no retry).
- If it rejects, retry up to `opts.maxAttempts` total attempts, waiting
  `opts.baseDelayMs * attemptNumber` between attempts (simple linear-ish
  backoff is fine — exact curve is not being tested).
- If every attempt fails, the returned promise must reject.

Write the implementation to `solution.ts` in this directory. Export exactly
one function named `retryWithBackoff` with this signature. Do not add a test
file or any other files — just `solution.ts`.
