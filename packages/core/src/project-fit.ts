/**
 * Which project should this knowledge have gone to?
 *
 * The fallback picks `projects[0]` — oldest-first — which for essentially
 * every user is the auto-created "Default". So the system's default behaviour
 * funnels knowledge into its least meaningful project, and the hint that
 * reported the fallback told the caller to "pass projectName" without ever
 * saying WHICH NAMES EXIST. An agent cannot pass a name it was never shown;
 * it would have to already suspect the problem and call `brain_list_projects`
 * unprompted. Measured on prod 2026-08-30: an agent following the documented
 * discipline still filed four rules into Default across one session, including
 * one that superseded a rule about not doing exactly that.
 *
 * So the missing information is the candidate list, and the ranking is what
 * makes it act-on-able rather than another thing to read.
 *
 * DELIBERATELY NOT EMBEDDINGS. Similarity against each project's existing
 * knowledge sounds better and is worse here: it needs a vector query per call
 * on a hot path, and it is weakest exactly when it matters most — a genuinely
 * new topic has, by definition, nothing similar filed yet, so the "best fit"
 * would be whichever project is merely largest. Framework, language and name
 * are cheap, already loaded by `getUserProjects`, and — the property that
 * decides it — produce a reason a human can check. A suggestion an operator
 * cannot audit is one they will eventually follow off a cliff.
 */

export interface ProjectCandidate {
  id: string;
  name: string;
  framework?: string | null;
  language?: string | null;
}

export interface ProjectSuggestion {
  projectId: string;
  name: string;
  /** 0–1. Compared against SUGGESTION_THRESHOLD, never shown as a percentage. */
  score: number;
  /** Why this ranked — an agent reads it, and an operator audits it. */
  why: string;
}

/**
 * Below this, a candidate is listed but not called a match.
 *
 * Set so that a lone signal (language alone) does not read as a recommendation:
 * "typescript" matches most of this user's projects and distinguishes nothing.
 * Two signals, or a name that literally appears in the task text, does.
 */
export const SUGGESTION_THRESHOLD = 0.5;

const W_FRAMEWORK = 0.35;
const W_LANGUAGE = 0.25;
const W_NAME_IN_TEXT = 0.5;

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

/**
 * Does the project's name actually occur in the task text?
 *
 * Word-boundary matched and length-gated: a project called "API" would
 * otherwise match the word "rapid", and a two-character project name matches
 * everything. This is the strongest single signal when it fires, because a
 * caller who names the project in their prompt has already told you the
 * answer — they simply did not put it in the right parameter.
 */
function nameOccursIn(name: string, text: string): boolean {
  const n = norm(name);
  if (n.length < 3) return false;
  // "Default" is the auto-created bucket, not a topic. Matching it on the word
  // "default" appearing in prose would recommend the very project this module
  // exists to steer away from.
  if (n === "default") return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

/**
 * Rank the caller's projects by fit for a piece of knowledge or a task.
 *
 * `excludeProjectId` is the project the call already resolved to — there is no
 * point recommending the thing you just did. Passing it also removes the need
 * for a magic "Default" string here: the resolver knows which project it fell
 * back to, so this module does not have to guess.
 *
 * Returns every remaining candidate, ranked, so a caller can show the list
 * even when nothing clears the threshold. Deciding what to display is the
 * caller's job; deciding what fits is this function's.
 */
export function suggestProjects(
  candidates: ProjectCandidate[],
  signal: { text?: string | undefined; framework?: string | undefined; language?: string | undefined },
  opts: { limit?: number; excludeProjectId?: string | undefined } = {},
): ProjectSuggestion[] {
  const { limit = 3, excludeProjectId } = opts;
  const text = signal.text ?? "";
  const sf = norm(signal.framework);
  const sl = norm(signal.language);

  const scored = candidates
    .filter((p) => p.id !== excludeProjectId)
    .map((p) => {
      const reasons: string[] = [];
      let score = 0;

      if (sf && norm(p.framework) === sf) {
        score += W_FRAMEWORK;
        reasons.push(`framework ${sf}`);
      }
      if (sl && norm(p.language) === sl) {
        score += W_LANGUAGE;
        reasons.push(`language ${sl}`);
      }
      if (text && nameOccursIn(p.name, text)) {
        score += W_NAME_IN_TEXT;
        reasons.push("its name appears in the task text");
      }

      return {
        projectId: p.id,
        name: p.name,
        score: Math.min(1, score),
        why: reasons.length ? `matches ${reasons.join(" + ")}` : "no matching signal",
      };
    });

  // Ties broken by name so two runs never disagree — the same
  // nondeterminism that made the `[0]` fallback resolve differently between
  // consecutive calls before `getUserProjects` was given an explicit order.
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit);
}

/**
 * The line a tool puts in front of an agent when a call fell back.
 *
 * Names the candidates, because the old hint asked for a `projectName` without
 * ever listing one. Recommends only above the threshold, and otherwise just
 * shows the options — a confident-sounding suggestion built from no signal is
 * how you teach a caller to stop reading suggestions.
 */
export function fallbackHint(
  fellBackTo: string,
  suggestions: ProjectSuggestion[],
): string {
  const base =
    `Filed under "${fellBackTo}" because no projectId/projectName was given. ` +
    `Project scoping is per-call and is NOT inherited from brain_start_session.`;

  if (suggestions.length === 0) return base;

  const top = suggestions[0]!;
  if (top.score >= SUGGESTION_THRESHOLD) {
    return (
      `${base} This looks like it belongs in "${top.name}" (${top.why}) — ` +
      `re-send with projectName: "${top.name}" if so. ` +
      `Other projects: ${suggestions.slice(1).map((s) => `"${s.name}"`).join(", ") || "none"}.`
    );
  }
  return (
    `${base} Your projects: ${suggestions.map((s) => `"${s.name}"`).join(", ")} — ` +
    `pass projectName on the call if one of these fits better.`
  );
}
