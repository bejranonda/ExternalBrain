Implement a `safeJsonParse` function in TypeScript.

```ts
export function safeJsonParse<T>(input: unknown, fallback: T): T {
  // ...
}
```

Requirements:
- If `input` is a string containing valid JSON, return the parsed value.
- If parsing fails for any reason, return `fallback` instead of throwing.

Write the implementation to `solution.ts` in this directory. Export exactly
one function named `safeJsonParse` with this signature. Do not add a test
file or any other files — just `solution.ts`.
