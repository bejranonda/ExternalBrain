/**
 * Detection of tool-call markup leaked into agent-written text fields.
 *
 * The failure shape: an agent types a later parameter INSIDE an earlier
 * field's value, so the tail is stored as text in that field and every
 * parameter after it is silently dropped — while the call returns a normal
 * success token. Measured on prod 2026-08-23 (KNOWN_ISSUES §0as): a project
 * decision lost its `tags`, and `decision` is the tag that promotes a rule to
 * `visibility: "org"`, so it was silently filed private.
 *
 * ONE predicate, because there are two doors for agent-written knowledge text
 * — `brain_teach_knowledge` fields and `brain_report_session_outcome`
 * learnings — and the first fix covered only the first door. Two copies of
 * this regex would drift the same way every duplicated rule in this repo has
 * (GUIDELINES §4).
 *
 * Deliberately narrow: knowledge rules routinely discuss code, so
 * `Array<string>`, `a < b`, `<Skills/>` and HTML comments must all pass. A
 * guard that rejects legitimate prose is worse than the bug it prevents.
 */
export const LEAKED_MARKUP =
  /<\/(?:rationale|rule|trigger|instead|parameter)>|<parameter\s+name=/i;

export function hasLeakedMarkup(value: string | undefined | null): boolean {
  return !!value && LEAKED_MARKUP.test(value);
}
