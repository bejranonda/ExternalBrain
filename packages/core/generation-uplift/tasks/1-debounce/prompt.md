Implement a `debounce` utility in TypeScript.

```ts
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  wait: number,
): (...args: Args) => void {
  // ...
}
```

Requirements:
- Calling the returned function repeatedly should only invoke `fn` once,
  `wait` milliseconds after the *last* call.
- Each call resets the pending timer.
- `fn` is invoked with the arguments from the most recent call.

Write the implementation to `solution.ts` in this directory. Export exactly
one function named `debounce` with this signature. Do not add a test file or
any other files — just `solution.ts`.
