## Relevant knowledge from your Brain

- `principle` (confidence 0.92): "Safe" parsing utilities in this codebase
  treat any non-string input as an automatic fallback and never attempt to
  parse it — even though `JSON.parse` silently coerces its argument to a
  string (so e.g. `JSON.parse(42)` "succeeds" and returns `42`, which is
  surprising, not safe). Check `typeof input === "string"` before calling
  `JSON.parse` at all; do not rely on try/catch alone.
