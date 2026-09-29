/**
 * Readiness evaluation: is a PRD item ready to work?
 *
 * An item qualifies as **ready** when both hold:
 *   1. It has at least one `automated` or `metric` requirement, own or
 *      inherited from an ancestor (see `core/requirements.ts`).
 *   2. It has no open blocker: its status is not `blocked`, and every id in
 *      its `blockedBy` list is completed.
 *
 * Items already in a terminal status (`completed`, `deferred`, `cancelled`,
 * `deleted`) never qualify — there is nothing left to "get ready" to work on.
 *
 * This module is read-only: it computes the verdict. `rex ready`
 * (cli/commands/ready.ts) is the only writer of `PRDItem.ready`, applying
 * `applyReadyMarking` inside a store transaction. Nothing else — least of
 * all task selection (`core/next-task.ts`) — reads or writes this field.
 *
 * @module rex/core/ready
 */

import type { ItemLevel, PRDItem } from "../schema/index.js";
import { walkTree } from "./tree.js";
import { collectRequirements } from "./requirements.js";
import { collectCompletedIds } from "./next-task.js";

/** Statuses that make an item's readiness moot — there's nothing to start. */
const TERMINAL_STATUSES = new Set(["completed", "deferred", "cancelled", "deleted"]);

/** Verdict for a single item, with enough detail to explain a "no" to a human. */
export interface ReadyEvaluation {
  itemId: string;
  title: string;
  level: ItemLevel;
  /** Whether this item currently qualifies as ready. */
  qualifies: boolean;
  /** Count of own+inherited `automated`/`metric` requirements. */
  qualifyingRequirementCount: number;
  /** Whether `status` is itself `blocked`. */
  statusBlocked: boolean;
  /** `blockedBy` ids that are not (yet) completed. */
  openBlockerIds: string[];
  /** Human-readable explanation, always populated (for both yes and no). */
  reason: string;
}

/** Build the readiness verdict for one item. Pure — no mutation. */
function evaluate(
  items: PRDItem[],
  item: PRDItem,
  completedIds: ReadonlySet<string>,
): ReadyEvaluation {
  const qualifyingRequirementCount = collectRequirements(items, item.id).filter(
    (tr) =>
      tr.requirement.validationType === "automated" ||
      tr.requirement.validationType === "metric",
  ).length;

  const statusBlocked = item.status === "blocked";
  const openBlockerIds = (item.blockedBy ?? []).filter((dep) => !completedIds.has(dep));
  const terminal = TERMINAL_STATUSES.has(item.status);

  const qualifies =
    !terminal &&
    !statusBlocked &&
    openBlockerIds.length === 0 &&
    qualifyingRequirementCount > 0;

  const reason = terminal
    ? `Item is already ${item.status}.`
    : qualifies
      ? `Has ${qualifyingRequirementCount} automated/metric requirement(s) and no open blocker.`
      : describeWhyNot(qualifyingRequirementCount, statusBlocked, openBlockerIds);

  return {
    itemId: item.id,
    title: item.title,
    level: item.level,
    qualifies,
    qualifyingRequirementCount,
    statusBlocked,
    openBlockerIds,
    reason,
  };
}

function describeWhyNot(
  qualifyingRequirementCount: number,
  statusBlocked: boolean,
  openBlockerIds: string[],
): string {
  const problems: string[] = [];
  if (qualifyingRequirementCount === 0) {
    problems.push("no automated or metric requirement (own or inherited)");
  }
  if (statusBlocked) {
    problems.push("status is blocked");
  }
  if (openBlockerIds.length > 0) {
    problems.push(`open blocker(s): ${openBlockerIds.join(", ")}`);
  }
  return problems.join("; ");
}

/**
 * Evaluate readiness for a single item by id. Returns `null` if the item
 * does not exist. Does not mutate `items`.
 */
export function evaluateReady(
  items: PRDItem[],
  itemId: string,
): ReadyEvaluation | null {
  for (const { item } of walkTree(items)) {
    if (item.id === itemId) {
      return evaluate(items, item, collectCompletedIds(items));
    }
  }
  return null;
}

/** Result of applying readiness marking across a whole tree. */
export interface ReadyMarkOutcome {
  /**
   * Every evaluation worth reporting: items newly or still marked ready,
   * items just unmarked, and items with at least one qualifying requirement
   * that don't qualify (worth explaining). Items with zero qualifying
   * requirements and no prior `ready` flag are omitted here and folded into
   * `skippedNoRequirementCount` instead — reporting them one line each would
   * just be "does not qualify" for most of the tree.
   */
  evaluations: ReadyEvaluation[];
  /** Items newly set to `ready: true` this run (were false/unset before). */
  markedReadyCount: number;
  /** Items that had `ready: true` before and no longer qualify — cleared. */
  unmarkedCount: number;
  /** Items with zero qualifying requirements and no prior `ready` flag. */
  skippedNoRequirementCount: number;
}

/**
 * Evaluate and mark readiness across the whole tree, mutating `items` in
 * place: sets `item.ready = true` for qualifying items, and deletes the
 * field from items that no longer qualify but previously carried it.
 * Items that never qualified and never carried the field are left
 * untouched — `ready` is written only as `true`, never `false` (see
 * {@link PRDItem.ready}).
 *
 * Callers are expected to run this inside a store transaction (e.g.
 * `store.withTransaction`) so the mutation persists.
 */
export function applyReadyMarking(items: PRDItem[]): ReadyMarkOutcome {
  const completedIds = collectCompletedIds(items);
  const evaluations: ReadyEvaluation[] = [];
  let markedReadyCount = 0;
  let unmarkedCount = 0;
  let skippedNoRequirementCount = 0;

  for (const { item } of walkTree(items)) {
    const evaluation = evaluate(items, item, completedIds);
    const wasReady = item.ready === true;

    if (evaluation.qualifies) {
      if (!wasReady) markedReadyCount++;
      item.ready = true;
      evaluations.push(evaluation);
    } else if (wasReady) {
      delete item.ready;
      unmarkedCount++;
      evaluations.push(evaluation);
    } else if (evaluation.qualifyingRequirementCount > 0) {
      evaluations.push(evaluation);
    } else {
      skippedNoRequirementCount++;
    }
  }

  return { evaluations, markedReadyCount, unmarkedCount, skippedNoRequirementCount };
}
