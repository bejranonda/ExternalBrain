## Relevant knowledge from your Brain

- `principle` (confidence 0.85): Retry helpers in this codebase must reject
  with the *original* underlying error from the last failed attempt, not a
  wrapped `RetryError` or similar — callers do `catch (e) { if (e instanceof
  SpecificError) ... }` and a wrapper breaks that pattern silently.
