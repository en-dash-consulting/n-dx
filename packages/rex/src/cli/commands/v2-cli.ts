/**
 * Shared pieces of the v2 (product layer and changes) CLI verbs:
 * `rex product`, `rex change` and `rex add` on a v2 tree.
 *
 * Two kinds of criteria meet here and are never mixed: a capability's
 * **capability criteria** (`--capability-criterion`, `<id>: <text>`) and a
 * work item's **acceptance criteria** (`--criterion`, done when).
 */

import type { Criterion, CriteriaDelta } from "../../schema/v2.js";
import type { RuleNode } from "../../schema/v2-rules.js";
import type { PlacementSuggestion } from "../../core/change-place.js";
import { upsertCriteriaDelta } from "../../core/apply-amendments.js";
import { resolveRexPaths } from "../../store/index.js";
import { prdLayout } from "../../store/prd-model-reader.js";
import { CLIError } from "../errors.js";

/** Flag for a capability's criteria, as `<id>: <text>`; repeatable. */
export const CAPABILITY_CRITERION_FLAG = "capability-criterion";
/** Flag removing a capability criterion by id; repeatable. */
export const REMOVE_CAPABILITY_CRITERION_FLAG = "remove-capability-criterion";

/** Whether the PRD of the project at `dir` uses the v2 layout. */
export async function isV2Dir(dir: string): Promise<boolean> {
  return (await prdLayout(resolveRexPaths(dir).rexDir)) === "v2";
}

/** Refuse a v2-only verb on a v1 tree, naming the layout. */
export async function requireV2(rexDir: string, verb: string): Promise<void> {
  if ((await prdLayout(rexDir)) === "v2") return;
  throw new CLIError(
    `rex ${verb} works on a v2 PRD (product/ and changes/); this PRD uses the v1 layout (.rex/prd_tree/), which has no product layer.`,
    "Use 'rex status' and 'rex add <level>' on a v1 PRD.",
  );
}

/** How a node is named in output: its display id when it has one. */
export function nodeLabel(node: Pick<RuleNode, "id" | "displayId">): string {
  return node.displayId ?? node.id;
}

const CAPABILITY_CRITERION = /^([A-Za-z0-9][\w.-]*)\s*:\s*(\S.*)$/s;

/** Parse `--capability-criterion` values (`<id>: <text>`), refusing a malformed or repeated id. */
export function parseCapabilityCriteria(values: readonly string[] = []): Criterion[] {
  const seen = new Set<string>();
  return values.map((value) => {
    const match = CAPABILITY_CRITERION.exec(value.trim());
    if (!match) {
      throw new CLIError(
        `--${CAPABILITY_CRITERION_FLAG} "${value}" is not "<id>: <text>".`,
        `Name the capability criterion it adds or replaces, e.g. --${CAPABILITY_CRITERION_FLAG}="c3: A refund reaches the card".`,
      );
    }
    const [, id, text] = match;
    if (seen.has(id)) throw new CLIError(`--${CAPABILITY_CRITERION_FLAG} names capability criterion "${id}" twice.`);
    seen.add(id);
    return { id, text: text.trim() };
  });
}

/** Ids passed to `--remove-capability-criterion`. */
export function parseRemovedCapabilityCriteria(values: readonly string[] = []): string[] {
  return values.map((v) => v.trim()).filter(Boolean);
}

/**
 * The capability-criteria delta the flags describe against `current`
 * (`upsertCriteriaDelta`), refusing an id both set and removed. Undefined
 * when no capability-criterion flag was passed.
 */
export function capabilityCriteriaDelta(current: readonly Criterion[], set: readonly Criterion[], remove: readonly string[]): CriteriaDelta | undefined {
  const clash = set.find((c) => remove.includes(c.id));
  if (clash) throw new CLIError(`Capability criterion "${clash.id}" is both set and removed.`);
  return upsertCriteriaDelta(current, set, remove);
}

/** Lines naming the rules' placement shortlist and how to record one. */
export function formatPlacementSuggestion(
  suggestion: PlacementSuggestion,
  changeLabel: string,
  targetOf: (id: string) => Pick<RuleNode, "id" | "displayId" | "title"> | undefined,
): string[] {
  if (!suggestion.shortlist.length) {
    return [
      "  Placement: Inbox (needs placement); no capability or constraint matched.",
      `  Place it: rex change place ${changeLabel} --target=<capability> (see 'rex product show')`,
    ];
  }
  const label = (id: string) => {
    const node = targetOf(id);
    return node ? nodeLabel(node) : id;
  };
  const [best] = suggestion.shortlist;
  return [
    "  Placement: Inbox (needs placement). Suggested, best first:",
    ...suggestion.shortlist.map((c) => `    ${label(c.target)} ${targetOf(c.target)?.title ?? ""} (${c.relation})`),
    `  Place it: rex change place ${changeLabel} --target=${label(best.target)} --relation=${best.relation}`,
  ];
}
