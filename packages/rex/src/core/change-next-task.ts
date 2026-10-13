/**
 * `get_next_task` and `rex next` on a v2 tree: the unit {@link findActionableWork}
 * selects, answered in the v1 shape (`item`, `parents`, `explanation`) so
 * callers written for v1 read it unchanged. The item is the unit as
 * `changeLayerItems` projects it, so it also carries its v2 fields (`type`,
 * `displayId`, …). Pure; the v1 counterpart is `core/next-task.ts`.
 *
 * @module rex/core/change-next-task
 */

import type { PRDItem, Priority } from "../schema/index.js";
import { PRIORITY_ORDER } from "../schema/v1.js";
import { indexTree, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { findActionableWork, type WorkUnit } from "./change-selection.js";
import { changeLayerItems } from "./layer-projection.js";
import type { SelectionExplanation } from "./next-task.js";
import { findItem } from "./tree.js";

export interface NextWorkOptions {
  /** Ids to pass over: units another worktree has claimed. */
  excludeIds?: ReadonlySet<string>;
  /** Only units carrying at least one of these tags (the unit's own, as on v1). */
  tags?: readonly string[];
}

export interface NextWorkTask {
  unit: WorkUnit;
  /** The unit as a v1 item, its v2 fields kept. */
  item: PRDItem;
  /** Enclosing changes, outermost first, as v1 items. */
  parents: PRDItem[];
  explanation: SelectionExplanation;
}

/** The unit autonomous selection runs next, in `get_next_task`'s v1 shape; `null` when none is actionable. */
export function findNextWorkTask(tree: V2Tree, options: NextWorkOptions = {}): NextWorkTask | null {
  const actionable = findActionableWork(tree, { excludeIds: options.excludeIds });
  const tags = options.tags ?? [];
  const unit = actionable.find((u) => tags.length === 0 || (u.node.tags ?? []).some((t) => tags.includes(t)));
  if (!unit) return null;
  const entry = findItem(changeLayerItems(tree.changes), unit.node.id);
  if (!entry) throw new Error(`Selected work ${unit.node.id} is missing from the change layer`);
  return { unit, item: entry.item, parents: entry.parents, explanation: explainWork(tree, unit, entry.parents, actionable) };
}

/** Ids of completed change-layer nodes: a claim on one no longer matters to selection. */
export function completedWorkIds(tree: V2Tree): Set<string> {
  return new Set(indexTree(tree).entries.filter((e) => e.root === "changes" && e.node.status === "completed").map((e) => e.node.id));
}

/** {@link SelectionExplanation} for a v2 unit, counting the other units of work the way v1 counts leaves. */
function explainWork(tree: V2Tree, unit: WorkUnit, parents: PRDItem[], actionable: WorkUnit[]): SelectionExplanation {
  const index = indexTree(tree);
  const parentOf = new Map(index.entries.map((e) => [e.node, e.parent]));
  const done = (ref: string): boolean => index.resolve(ref)?.status === "completed";
  const candidateIds = new Set(actionable.map((u) => u.node.id));
  const itemPriority: Priority = unit.node.priority ?? unit.change.priority ?? "medium";
  const rank = PRIORITY_ORDER[itemPriority];

  const skipped = { completed: 0, deferred: 0, blocked: 0, unresolvedDeps: 0, inProgress: 0, actionable: 0, total: 0 };
  let higherPriorityBlocked = 0;
  for (const { node, root } of index.entries) {
    if (root !== "changes" || node === unit.node || !isWorkNode(node)) continue;
    const parent = parentOf.get(node);
    const higher = PRIORITY_ORDER[priorityOf(node) ?? (parent?.type === "change" ? priorityOf(parent) : undefined) ?? "medium"] < rank;
    const status = node.status ?? "pending";
    if (status === "completed") skipped.completed++;
    else if (status === "deferred") skipped.deferred++;
    else if (status === "blocked" || (node.blockedBy ?? []).some((ref) => !done(ref))) {
      if (status === "blocked") skipped.blocked++;
      else skipped.unresolvedDeps++;
      if (higher) higherPriorityBlocked++;
    } else if (candidateIds.has(node.id)) {
      if (status === "in_progress") skipped.inProgress++;
      else skipped.actionable++;
    } else continue;
    skipped.total++;
  }

  const blockers = unit.node.blockedBy ?? [];
  const dependencies: SelectionExplanation["dependencies"] = blockers.length
    ? { status: "resolved", resolvedBlockers: [...blockers] }
    : { status: "none", resolvedBlockers: [] };
  const traversalPath = parents.map((p) => p.title);
  const started = unit.node.status === "in_progress";
  const summary = [
    started ? `"${unit.node.title}" is already in_progress` : `"${unit.node.title}" selected at ${itemPriority} priority`,
    ...(traversalPath.length ? [`via ${traversalPath.join(" → ")}`] : []),
    ...(blockers.length ? [`(${blockers.length} blocker${blockers.length === 1 ? "" : "s"} resolved)`] : []),
    ...(higherPriorityBlocked ? [`(${higherPriorityBlocked} higher-priority item${higherPriorityBlocked === 1 ? "" : "s"} blocked)`] : []),
  ].join(" ");

  return {
    reason: started ? "in_progress" : "priority",
    summary,
    priority: { itemPriority, higherPriorityBlocked },
    dependencies,
    traversalPath,
    skipped,
  };
}

/** A change-layer node's own priority; product nodes have none. */
function priorityOf(node: RuleNode): Priority | undefined {
  return (node as RuleNode & { priority?: Priority }).priority;
}

/** A task, or a change with no live tasks or nested changes: what selection can run. */
function isWorkNode(node: RuleNode): boolean {
  if (node.type === "task") return true;
  if (node.type !== "change") return false;
  return !(node.children ?? []).some((c) => (c.type === "task" || c.type === "change") && c.status !== "deleted");
}
