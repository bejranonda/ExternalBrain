## Relevant knowledge from your Brain

- `heuristic` (confidence 0.9): Debounce/throttle utilities in this codebase
  always expose a `.cancel()` method on the returned function, so callers can
  clear a pending invocation (e.g. on component unmount). Callers and tests
  rely on this method existing — omitting it is a recurring review comment.
