/**
 * Bounds on the context hench hands a task.
 *
 * A task brief is rebuilt and re-sent for every task and every retry, so
 * anything unbounded in it is a cost multiplied by the whole loop. Three
 * sections grew with the *project* rather than with the task: the sibling
 * list, the inherited-requirement chain, and `workflow.md` embedded verbatim.
 * A fourth, `--context-file`, is read straight off disk with no bound at all —
 * and `ndx work` pipes the entire CONTEXT.md plus PRD tree through it.
 *
 * Each helper here states what it dropped. A brief that silently omits a
 * sibling or a requirement is worse than a long one: the agent cannot tell an
 * absent constraint from an unmentioned one, and will confidently act as
 * though the constraint does not exist.
 *
 * @module hench/agent/planning/context-caps
 */

/** Siblings listed in a brief before the list is summarized. */
export const MAX_BRIEF_SIBLINGS = 20;

/** Inherited requirements listed in a brief. */
export const MAX_BRIEF_REQUIREMENTS = 25;

/** Characters of `workflow.md` embedded before it is trimmed. */
export const MAX_WORKFLOW_CHARS = 4_000;

/** Characters accepted from `--context-file`. */
export const MAX_CONTEXT_FILE_CHARS = 24_000;

export interface CappedList<T> {
  items: T[];
  /** How many were dropped; zero when the list fit. */
  omitted: number;
}

/**
 * Take the first `max` items, reporting how many were dropped.
 *
 * Leading order is preserved deliberately rather than sampling: the callers
 * feed lists whose order is meaningful (siblings in PRD order, requirements
 * nearest-parent first), so a stable prefix is more useful than a spread.
 */
export function capList<T>(items: readonly T[], max: number): CappedList<T> {
  if (items.length <= max) return { items: [...items], omitted: 0 };
  return { items: items.slice(0, max), omitted: items.length - max };
}

/**
 * Deduplicate inherited requirements.
 *
 * `collectRequirements` walks the whole parent chain, and a requirement
 * restated at several levels — common when an epic and its features describe
 * the same constraint — arrives once per level. Keeping the first occurrence
 * keeps the nearest-parent attribution, which is the more specific one.
 */
export function dedupeRequirements<
  T extends { id?: string; title: string; acceptanceCriteria?: readonly string[] },
>(requirements: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const req of requirements) {
    // Prefer the id; fall back to title plus criteria so requirements that
    // were restated without a shared id still collapse.
    const key = req.id?.trim()
      ? `id:${req.id.trim()}`
      : `t:${req.title.trim().toLowerCase()}|${(req.acceptanceCriteria ?? []).join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(req);
  }
  return out;
}

/**
 * Trim a document to a character budget, cutting at a line boundary and
 * stating what was dropped.
 *
 * Cutting mid-line would leave a truncated instruction reading as a complete
 * one, which is the specific failure worth avoiding in a file whose whole
 * purpose is to state rules.
 */
export function trimDocument(
  text: string,
  maxChars: number,
  label: string,
): string {
  if (text.length <= maxChars) return text;

  const head = text.slice(0, maxChars);
  const lastBreak = head.lastIndexOf("\n");
  const body = lastBreak > maxChars / 2 ? head.slice(0, lastBreak) : head;
  const omittedChars = text.length - body.length;

  return (
    `${body}\n\n_… ${omittedChars} more character(s) of ${label} not shown ` +
    `(trimmed at ${maxChars} characters). Read the file directly if you need the rest._`
  );
}
