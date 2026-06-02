/**
 * Lightweight fuzzy scorer — returns 0 when the query doesn't match at all.
 *
 * Scoring favors matches that (a) cover all query chars in order,
 * (b) are compact (consecutive runs), and (c) align with word boundaries
 * (start-of-word). A substring hit is a fast-path short-circuit that
 * always beats non-contiguous fuzzy matches.
 *
 * Used by the command palette in `apps/web/components/brain/shell.tsx`.
 */
export function fuzzyScore(label: string, query: string): number {
  const L = label.toLowerCase();
  const Q = query.toLowerCase();
  if (Q.length === 0) return 0;
  if (L.includes(Q)) return 1000 - L.indexOf(Q);

  let score = 0;
  let qi = 0;
  let prevMatchIdx = -2;
  for (let i = 0; i < L.length && qi < Q.length; i++) {
    if (L[i] === Q[qi]) {
      let bonus = 1;
      if (i === prevMatchIdx + 1) bonus += 5; // consecutive run
      const prev = L[i - 1];
      if (i === 0 || prev === " " || prev === "-" || prev === "/") bonus += 3; // word start
      score += bonus;
      prevMatchIdx = i;
      qi++;
    }
  }
  if (qi < Q.length) return 0; // missed chars
  return score;
}
