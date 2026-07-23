Implement a `formatBytes` function in TypeScript that formats a byte count
into a human-readable string.

```ts
export function formatBytes(bytes: number): string {
  // ...
}
```

Requirements:
- Uses 1024 as the unit base (KB, MB, GB, ...).
- `formatBytes(0)` returns `"0 B"`.
- `formatBytes(1024)` returns `"1 KB"`.
- `formatBytes(1048576)` returns `"1 MB"`.

Write the implementation to `solution.ts` in this directory. Export exactly
one function named `formatBytes` with this signature. Do not add a test file
or any other files — just `solution.ts`.
