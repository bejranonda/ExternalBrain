## Relevant knowledge from your Brain

- `heuristic` (confidence 0.87): Cache utilities in this codebase treat `get`
  as a recency-refreshing read, like a real LRU — calling `get` on a key must
  move it to most-recently-used, not just look it up. A `get`-doesn't-touch-
  recency implementation is a recurring bug class here (keys that are read
  constantly but never re-`set` get evicted anyway).
