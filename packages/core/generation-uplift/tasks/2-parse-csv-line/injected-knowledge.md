## Relevant knowledge from your Brain

- `heuristic` (confidence 0.88): This codebase's CSV parsing helpers must
  handle the standard escaped-quote convention: a doubled double-quote (`""`)
  inside a quoted field represents one literal `"` character in the output,
  not a field terminator. Parsers that don't unescape this produce corrupted
  output on real-world exports (e.g. Excel/Google Sheets CSV).
