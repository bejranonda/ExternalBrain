Implement a `parseCsvLine` function in TypeScript that parses one line of CSV
into an array of field strings.

```ts
export function parseCsvLine(line: string): string[] {
  // ...
}
```

Requirements:
- Fields are comma-separated.
- A field may be wrapped in double quotes (`"..."`), in which case it may
  contain commas that should NOT split the field.
- Unquoted fields have no special escaping.

Write the implementation to `solution.ts` in this directory. Export exactly
one function named `parseCsvLine` with this signature. Do not add a test file
or any other files — just `solution.ts`.
