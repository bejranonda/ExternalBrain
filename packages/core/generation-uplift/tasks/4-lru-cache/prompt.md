Implement a generic `LRUCache<K, V>` class in TypeScript.

```ts
export class LRUCache<K, V> {
  constructor(maxSize: number) { /* ... */ }
  get(key: K): V | undefined { /* ... */ }
  set(key: K, value: V): void { /* ... */ }
  get size(): number { /* ... */ }
}
```

Requirements:
- `set` inserts or updates a key/value pair.
- When the number of entries would exceed `maxSize`, evict the
  least-recently-used entry before inserting the new one.
- `get` returns the value for a key, or `undefined` if absent.

Write the implementation to `solution.ts` in this directory. Export exactly
one class named `LRUCache` with this shape. Do not add a test file or any
other files — just `solution.ts`.
