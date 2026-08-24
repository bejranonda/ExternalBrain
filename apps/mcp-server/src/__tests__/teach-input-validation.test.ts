/**
 * Malformed teach calls must fail loudly instead of storing corruption.
 *
 * An agent that types a later parameter INSIDE a field's value gets the whole
 * tail stored as text in that field, and every parameter after it silently
 * dropped — while the call still returns `{ id, confidence: 1 }`, exactly like
 * a clean write.
 *
 * Measured on prod 2026-08-23: two rows landed this way. One was a project
 * DECISION that lost its `decision` tag — the tag that promotes a rule to
 * `visibility: "org"` and makes it shared project memory — so it was silently
 * filed as private. Nothing surfaced it until a `retrieve_knowledge` dump
 * happened to show the markup in the rationale.
 *
 * Storing it is strictly worse than refusing it: a corrupted rationale is
 * served back to future agents as fact, and a dropped tag changes who can see
 * the rule.
 */
import { describe, it, expect } from "vitest";
// The REAL predicate, not a copy. A replica here would pass while the shipped
// guard drifted — the vacuous-gate failure this repo keeps rediscovering.
import { LEAKED_MARKUP } from "@brain/core/text-guards";

describe("leaked tool-call markup detection", () => {
  it("catches the exact shape observed in production", () => {
    const corrupted =
      'trap that hid the crash for months.</rationale>\n<parameter name="tags">["brain-usage"]';
    expect(LEAKED_MARKUP.test(corrupted)).toBe(true);
  });

  it("catches a bare closing tag for any text field", () => {
    for (const f of ["rationale", "rule", "trigger", "instead"]) {
      expect(LEAKED_MARKUP.test(`some text</${f}>`), f).toBe(true);
    }
  });

  it("catches an opening parameter block regardless of spacing or case", () => {
    expect(LEAKED_MARKUP.test('x <parameter name="tags">')).toBe(true);
    expect(LEAKED_MARKUP.test('x <PARAMETER   name="tags">')).toBe(true);
  });

  it("does NOT fire on legitimate prose containing angle brackets", () => {
    // Rules routinely discuss code. Rejecting these would make the guard
    // worse than the bug it prevents.
    for (const ok of [
      "use `a < b` rather than a.lessThan(b)",
      "the <Skills/> component renders Knowledge rows",
      "generic types like Array<string> are fine",
      "prefer `if (x) return;` over nested blocks",
      "HTML comments <!-- like this --> mark autoskill blocks",
    ]) {
      expect(LEAKED_MARKUP.test(ok), ok).toBe(false);
    }
  });
});
