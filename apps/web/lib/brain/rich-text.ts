import { Fragment, createElement, type ReactNode } from "react";

/**
 * Fill `{{name}}` slots in an already-translated string with React nodes.
 *
 * Sentences that wrap a word in <code> or <strong> cannot be split into
 * "before" / "after" keys without fixing English word order on every locale —
 * German and Thai put the emphasised term elsewhere in the sentence. Keeping
 * the whole sentence as one key and slotting the markup in lets each
 * translation place it. Call `t(path)` WITHOUT vars so the slots survive.
 */
export function rich(template: string, slots: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\{\w+\}\})/).map((part, i) => {
    const m = /^\{\{(\w+)\}\}$/.exec(part);
    const node = m && Object.hasOwn(slots, m[1]!) ? slots[m[1]!] : part;
    return createElement(Fragment, { key: i }, node);
  });
}
