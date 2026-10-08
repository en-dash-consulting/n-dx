/**
 * Completion over the change layer: a change completes when its tasks do, or
 * on its own when task-less, and its amendments apply per `rex.applyOn`. Pure;
 * nothing here writes, locks or reads config. The caller passes `applyOn`
 * (from `loadApplyOn`) and writes the returned tree. The v1 counterpart is
 * `core/parent-completion.ts`, whose child predicate this reuses.
 *
 * ## Completion
 *
 * A change with tasks completes when every live task is completed
 * ({@link SUCCESSFUL_CHILD_STATUSES}); a cancelled task blocks it and deleted
 * tombstones are ignored. Completing a task checks only that task's change,
 * and only a `pending` change auto-completes: an `in_progress` change is never
 * swept (#368), so it completes through {@link completeChange}. A change that
 * still `needsPlacement` is held: it may not close (`change-placed-at-close`).
 *
 * A completed change goes through `applyOnTrigger(…, "complete", …)`: applied
 * under `complete`, left open and unapplied under `review` or `release`. A
 * refused apply (`ApplyAmendmentsError`) is reported, and the change stays
 * completed and unapplied for a steward.
 *
 * ## Split
 *
 * When an `in_progress` change with no live task gains its first task, the
 * in-flight work becomes that task: it takes `in_progress` and the change's
 * `startedAt`, the change returns to `pending`, and the change's typed
 * `acceptanceCriteria` list ("done when") moves to the task, after any the
 * task already has. `requirements`, `amends` and `touches` stay on the
 * change. The change keeps `startedAt`, so it still
 * reads started (`isBuildingChange`).
 *
 * @module rex/core/change-completion
 */

import { indexTree, isOpenChange, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { SUCCESSFUL_CHILD_STATUSES } from "./parent-completion.js";
import { applyOnTrigger, type ApplyOnTriggerOptions, type ApplyOnTriggerResult } from "./apply-policy.js";
import { ApplyAmendmentsError } from "./apply-amendments.js";

export type ChangeCompletionOptions = ApplyOnTriggerOptions;

/** The split {@link addTask} performed. */
export interface ChangeSplit {
  changeId: string;
  taskId: string;
  /** Acceptance criteria moved from the change to the task; empty when the change had none. */
  movedCriteria: string[];
}

/** Why a change did not complete although its tasks are done. */
export interface CompletionHeld {
  changeId: string;
  reason: string;
}

export type CompletionApplyResult = ApplyOnTriggerResult | { applied: false; reason: string; error: ApplyAmendmentsError };

export interface ChangeCompletionResult {
  /** The new tree; the input is not modified. */
  tree: V2Tree;
  /** Ids completed: the task, then its change when that completed too. */
  completed: string[];
  split: ChangeSplit | null;
  /** `applyOnTrigger`'s result for the completed change; `null` when no change completed. */
  apply: CompletionApplyResult | null;
  held: CompletionHeld | null;
}

export class ChangeCompletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeCompletionError";
  }
}

/**
 * Complete the task `taskRef` and, when it was the last live task of a
 * `pending` change, the change, applying it per `options.applyOn`.
 */
export function completeTask(tree: V2Tree, taskRef: string, options: ChangeCompletionOptions): ChangeCompletionResult {
  const next = structuredClone(tree);
  const { node: task, change } = locate(next, taskRef, "task");
  const completed: string[] = [];
  if (task.status !== "completed") {
    markCompleted(task, options.now);
    completed.push(task.id);
  }
  const result = emptyResult(next, completed);
  if (!change || (change.status ?? "pending") !== "pending" || !isOpenChange(change)) return result;
  if (!liveTasks(change).every((t) => SUCCESSFUL_CHILD_STATUSES.has(t.status ?? "pending"))) return result;
  return closeChange(result, change, options);
}

/**
 * Complete the change `changeRef` on its own: a task-less change whose work
 * is done, or a change (such as an `in_progress` one) whose live tasks are all
 * completed. Throws when a live task is not completed or the change is not open.
 */
export function completeChange(tree: V2Tree, changeRef: string, options: ChangeCompletionOptions): ChangeCompletionResult {
  const next = structuredClone(tree);
  const { node: change } = locate(next, changeRef, "change");
  const label = change.displayId ?? change.id;
  if (!isOpenChange(change)) throw new ChangeCompletionError(`Cannot complete change ${label}: it is not open`);
  const open = liveTasks(change).filter((t) => !SUCCESSFUL_CHILD_STATUSES.has(t.status ?? "pending"));
  if (open.length > 0) {
    throw new ChangeCompletionError(`Cannot complete change ${label}: task ${open.map((t) => t.displayId ?? t.id).join(", ")} is not completed`);
  }
  const result = emptyResult(next, []);
  if (change.status === "completed") return result;
  return closeChange(result, change, options);
}

/**
 * Add `task` as the last child of the change `changeRef`, splitting the
 * change when this is the first live task of an `in_progress` change.
 */
export function addTask(tree: V2Tree, changeRef: string, task: RuleNode): ChangeCompletionResult {
  if (task.type !== "task") throw new ChangeCompletionError(`Cannot add ${task.type} ${task.id} as a task`);
  const next = structuredClone(tree);
  const { node: change } = locate(next, changeRef, "change");
  const added = structuredClone(task);
  const first = liveTasks(change).length === 0;
  change.children = [...(change.children ?? []), added];
  const result = emptyResult(next, []);
  if (!first || change.status !== "in_progress") return result;

  added.status = "in_progress";
  if (change.startedAt !== undefined) added.startedAt = change.startedAt;
  change.status = "pending";
  const movedCriteria = change.type === "change" ? (change.acceptanceCriteria ?? []) : [];
  if (change.type === "change") delete change.acceptanceCriteria;
  if (movedCriteria.length > 0 && added.type === "task") {
    added.acceptanceCriteria = [...(added.acceptanceCriteria ?? []), ...movedCriteria];
  }
  result.split = { changeId: change.id, taskId: added.id, movedCriteria };
  return result;
}

function locate(tree: V2Tree, ref: string, type: "change" | "task"): { node: RuleNode; change?: RuleNode } {
  const index = indexTree(tree);
  const node = index.resolve(ref);
  if (node?.type !== type) throw new ChangeCompletionError(`No live ${type} "${ref}"`);
  const parentOf = new Map(index.entries.map((e) => [e.node, e.parent]));
  let change = parentOf.get(node);
  while (change && change.type !== "change") change = parentOf.get(change);
  return { node, change };
}

function liveTasks(change: RuleNode): RuleNode[] {
  return (change.children ?? []).filter((c) => c.type === "task" && c.status !== "deleted");
}

function markCompleted(node: RuleNode, now: Date): void {
  node.status = "completed";
  node.completedAt = now.toISOString();
}

function emptyResult(tree: V2Tree, completed: string[]): ChangeCompletionResult {
  return { tree, completed, split: null, apply: null, held: null };
}

function closeChange(result: ChangeCompletionResult, change: RuleNode, options: ChangeCompletionOptions): ChangeCompletionResult {
  if (change.needsPlacement) {
    result.held = { changeId: change.id, reason: "it still needs placement; a person must confirm its targets before it closes" };
    return result;
  }
  markCompleted(change, options.now);
  result.completed.push(change.id);
  try {
    result.apply = applyOnTrigger(result.tree, change.id, "complete", options);
  } catch (error) {
    if (!(error instanceof ApplyAmendmentsError)) throw error;
    result.apply = { applied: false, reason: error.message, error };
  }
  if (result.apply.applied) result.tree = result.apply.result.tree;
  return result;
}
