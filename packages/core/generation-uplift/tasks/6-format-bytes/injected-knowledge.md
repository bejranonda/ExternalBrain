## Relevant knowledge from your Brain

- `heuristic` (confidence 0.83): Formatting helpers in this codebase throw a
  `RangeError` for a negative byte count rather than silently returning a
  nonsensical string like `"-1 B"` or `NaN`-tainted output — callers pass
  attacker-influenced sizes here, so a garbage-in/garbage-out string is worse
  than a loud, typed failure.
