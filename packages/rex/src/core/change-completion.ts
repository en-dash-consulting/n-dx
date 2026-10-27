/**
 * Completion over the change layer: a change completes when its tasks do, or
 * on its own when task-less, and its amendments apply per `rex.applyOn`. Pure;
 * nothing here writes, locks or reads config. The caller passes `applyOn`
 * (from `loadApplyOn`) and writes the returned tree. The v1 counterpart is
 * `core/parent-completion.ts`, whose child predicate this reuses.
 *
 * ## Completion
 *
 * A change completes when every live task and nested change under it is
 * completed ({@link SUCCESSFUL_CHILD_STATUSES}); a cancelled one blocks it and
 * deleted tombstones are ignored. Completing a change (on its own or with its
 * last task) then checks each enclosing change outward. Only a `pending`
 * change auto-completes: an `in_progress` change is never swept (#368), so it
 * completes through {@link completeChange}. A change held for placement
 * (`awaitsPlacement`: `needsPlacement` on a product layer with a capability
 * or constraint to place it on) may not close (`change-placed-at-close`). On
 * a product layer with neither, an Inbox change closes; with no target it
 * stays unapplied until placed (`applyOnTrigger`).
 *
 * A completed change goes through `applyOnTrigger(…, "complete", …)`: applied
 * under `complete`, left open and unapplied under `review` or `release`. A
 * refused apply (`ApplyAmendmentsError`) is reported, and the change stays
 * completed and unapplied for a steward. A container is never applied while a
 * nested change is unapplied: inner amendments land first. A change a steward
 * applied before it completed closes the same way, without applying again.
 *
 * {@link completeWork} is what a status update to `completed` runs on a v2
 * tree (`update_task_status`, `rex update --status`): it dispatches on the
 * node's type and stamps every node it completes as a v1 status update does.
 *
 * ## Split
 *
 * When an `in_progress` change with no live task gains its first task, the
 * in-flight work becomes that task: it takes `in_progress` and the change's
 * `startedAt`, the change returns to `pending`, and the change's typed
 * `acceptanceCriteria` list ("done when") moves to the task, after any the
 * task already has. `requirements`, `amends` and `touches` stay on the
 * change. The change keeps `startedAt`, so it still
 * reads started (`isBuildingChange`). An open `activeIntervals` entry on the
 * change is closed at the split time and the task opens one from then, so
 * each node's duration stays its own and the pending change stops accruing.
 *
 * A change that is completed, applied, cancelled or deleted takes no new
 * task: work found after it closed is a follow-up change whose
 * `discoveredFrom.item` names it ({@link ClosedChangeError}).
 *
 * @module rex/core/change-completion
 */

import { awaitsPlacement, indexTree, isAppliedChange, isOpenChange, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import type { ResolutionType } from "../schema/index.js";
import { AUTO_COMPLETABLE_STATUSES, SUCCESSFUL_CHILD_STATUSES } from "./parent-completion.js";
import { computeTimestampUpdates } from "./timestamps.js";
import { applyOnTrigger, type ApplyOnTriggerOptions, type ApplyOnTriggerResult } from "./apply-policy.js";
import { ApplyAmendmentsError, describeWork, unfinishedWork } from "./apply-amendments.js";

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
  /** `applyOnTrigger`'s result for the first change completed; `null` when no change completed. */
  apply: CompletionApplyResult | null;
  /** Every completed change's apply result, innermost first: the change, then each enclosing change completed with it. */
  applies: Array<{ changeId: string; apply: CompletionApplyResult }>;
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
  return closeEnclosing(emptyResult(next, completed), change, options);
}

/**
 * Complete the change `changeRef` on its own: a task-less change whose work
 * is done, or a change (such as an `in_progress` one) whose live tasks are all
 * completed. A change already applied closes without applying again. Throws
 * when a live task is not completed or the change is cancelled or deleted.
 */
export function completeChange(tree: V2Tree, changeRef: string, options: ChangeCompletionOptions): ChangeCompletionResult {
  const next = structuredClone(tree);
  const { node: change } = locate(next, changeRef, "change");
  const label = change.displayId ?? change.id;
  if (!closable(change)) throw new ChangeCompletionError(`Cannot complete change ${label}: it is ${change.status}`);
  const open = unfinishedWork(change);
  if (open.length > 0) throw new ChangeCompletionError(`Cannot complete change ${label}: ${describeWork(open)} not completed`);
  const result = emptyResult(next, []);
  if (change.status === "completed") return result;
  closeChange(result, change, options);
  return result.held ? result : closeEnclosing(result, enclosingChange(result.tree, change.id), options);
}

export interface CompleteWorkOptions extends ChangeCompletionOptions {
  /** Recorded on the completed node itself, not on a node completed with it. */
  resolutionType?: ResolutionType;
  resolutionDetail?: string;
}

export interface CompleteWorkResult extends ChangeCompletionResult {
  /** The change `ref` belongs to (itself when `ref` is a change). */
  changeId: string | undefined;
}

/**
 * Complete the task, change or subtask `ref`: what a status update to
 * `completed` does on a v2 tree. A task goes through {@link completeTask} and
 * a change through {@link completeChange}. A subtask completes on its own, and
 * when it was the last live subtask of a `pending` task, the task completes
 * through {@link completeTask}, as v1 auto-completes a parent. Every node
 * completed also gets the timestamps a v1 status update writes
 * (`computeTimestampUpdates`): `startedAt` when unset, `endedAt`, and its
 * open active interval closed. A change that still needs placement is
 * refused rather than reported held, because it is the node asked for.
 */
export function completeWork(tree: V2Tree, ref: string, options: CompleteWorkOptions): CompleteWorkResult {
  const node = indexTree(tree).resolve(ref);
  let out: ChangeCompletionResult;
  if (node?.type === "change") out = completeChange(tree, node.id, options);
  else if (node?.type === "task") out = completeTask(tree, node.id, options);
  else if (node?.type === "subtask") out = completeSubtask(tree, node.id, options);
  else throw new ChangeCompletionError(`No live task, change or subtask "${ref}"`);
  // A held change is not completed: refuse, so no caller reports a completion that was not written.
  if (out.held?.changeId === node.id) {
    throw new ChangeCompletionError(`Cannot complete change ${node.displayId ?? node.id}: ${out.held.reason}`);
  }

  const before = indexTree(tree);
  const after = indexTree(out.tree);
  for (const id of out.completed) {
    const prior = before.resolve(id)!;
    const done = after.resolve(id)!;
    const stamps = computeTimestampUpdates(prior.status ?? "pending", "completed", prior, options.now);
    delete stamps.completedAt; // stamped by markCompleted
    Object.assign(done, stamps);
  }
  const target = after.resolve(node.id)!;
  if (options.resolutionType) target.resolutionType = options.resolutionType;
  if (options.resolutionDetail) target.resolutionDetail = options.resolutionDetail;
  return { ...out, changeId: node.type === "change" ? node.id : locate(tree, node.id, node.type).change?.id };
}

function completeSubtask(tree: V2Tree, subtaskRef: string, options: ChangeCompletionOptions): ChangeCompletionResult {
  const next = structuredClone(tree);
  const index = indexTree(next);
  const subtask = index.resolve(subtaskRef)!;
  if (subtask.status === "completed") return emptyResult(next, []);
  markCompleted(subtask, options.now);
  const task = index.entries.find((e) => e.node === subtask)?.parent;
  const subtasks = (task?.children ?? []).filter((c) => c.type === "subtask" && c.status !== "deleted");
  const taskCompletes =
    task?.type === "task" &&
    AUTO_COMPLETABLE_STATUSES.has(task.status ?? "pending") &&
    subtasks.every((s) => SUCCESSFUL_CHILD_STATUSES.has(s.status ?? "pending"));
  if (!taskCompletes) return emptyResult(next, [subtask.id]);
  const out = completeTask(next, task.id, options);
  return { ...out, completed: [subtask.id, ...out.completed] };
}

/** Why a change takes no new task: work found after it closed is a follow-up change. */
export type ClosedChangeState = "completed" | "applied" | "cancelled" | "deleted";

/** Thrown for a node added under a change that is completed, applied, cancelled or deleted. */
export class ClosedChangeError extends ChangeCompletionError {
  constructor(
    readonly changeId: string,
    readonly state: ClosedChangeState,
    label: string,
    /** What was being added, for the message. */
    adding: "task" | "change" | "subtask" = "task",
  ) {
    super(
      `Cannot add ${adding === "change" ? "a change under" : `a ${adding} to`} change ${label}: it is ${state}. ` +
        `Add a follow-up change instead, with discoveredFrom: { item: "${changeId}" }.`,
    );
    this.name = "ClosedChangeError";
  }
}

/** The state that closes `change` to new tasks; `retired` when it sits under a deleted node. Undefined while open. */
export function closedState(change: RuleNode, retired: boolean): ClosedChangeState | undefined {
  if (retired || change.status === "deleted") return "deleted";
  if (change.appliedAt) return "applied";
  if (change.status === "completed" || change.status === "cancelled") return change.status;
  return undefined;
}

/**
 * Add `task` as the last child of the change `changeRef`, splitting the
 * change when this is the first live task of an `in_progress` change. `now`
 * is the split time: it closes the change's open active interval. A change
 * that is completed, applied, cancelled or deleted is refused with
 * {@link ClosedChangeError}.
 */
export function addTask(tree: V2Tree, changeRef: string, task: RuleNode, now: Date): ChangeCompletionResult {
  if (task.type !== "task") throw new ChangeCompletionError(`Cannot add ${task.type} ${task.id} as a task`);
  const next = structuredClone(tree);
  const all = indexTree(next, { includeTombstones: true });
  const target = all.resolve(changeRef);
  const entry = target?.type === "change" ? all.entries.find((e) => e.node === target) : undefined;
  const closed = entry && closedState(entry.node, !!entry.retired);
  if (entry && closed) throw new ClosedChangeError(entry.node.id, closed, entry.node.displayId ?? entry.node.id);
  const { node: change } = locate(next, changeRef, "change");
  const added = structuredClone(task);
  const first = liveTasks(change).length === 0;
  change.children = [...(change.children ?? []), added];
  const result = emptyResult(next, []);
  if (!first || change.status !== "in_progress") return result;

  added.status = "in_progress";
  if (change.startedAt !== undefined) added.startedAt = change.startedAt;
  change.status = "pending";
  const splitAt = now.toISOString();
  const open = change.activeIntervals?.filter((iv) => iv.end === undefined) ?? [];
  if (open.length > 0) {
    for (const iv of open) iv.end = splitAt;
    added.activeIntervals = [...(added.activeIntervals ?? []), { start: splitAt }];
  }
  const movedCriteria = change.type === "change" ? (change.acceptanceCriteria ?? []) : [];
  if (change.type === "change") delete change.acceptanceCriteria;
  if (movedCriteria.length > 0 && added.type === "task") {
    added.acceptanceCriteria = [...(added.acceptanceCriteria ?? []), ...movedCriteria];
  }
  result.split = { changeId: change.id, taskId: added.id, movedCriteria };
  return result;
}

function locate(tree: V2Tree, ref: string, type: "change" | "task" | "subtask"): { node: RuleNode; change?: RuleNode } {
  const node = indexTree(tree).resolve(ref);
  if (node?.type !== type) throw new ChangeCompletionError(`No live ${type} "${ref}"`);
  return { node, change: enclosingChange(tree, node.id) };
}

/** The nearest change above the live node `id`, if any. */
function enclosingChange(tree: V2Tree, id: string): RuleNode | undefined {
  const index = indexTree(tree);
  const parentOf = new Map(index.entries.map((e) => [e.node, e.parent]));
  let change = parentOf.get(index.resolve(id)!);
  while (change && change.type !== "change") change = parentOf.get(change);
  return change;
}

function liveTasks(change: RuleNode): RuleNode[] {
  return (change.children ?? []).filter((c) => c.type === "task" && c.status !== "deleted");
}

/** Whether completion may close `change`: neither cancelled nor deleted. An applied one closes too: a steward applied it before it completed. */
function closable(change: RuleNode): boolean {
  return isOpenChange(change) || (isAppliedChange(change) && change.status !== "cancelled" && change.status !== "deleted");
}

/**
 * Close `change` when it is `pending`, open and all its live work is
 * completed, then each enclosing change outward on the same terms. Stops at
 * the first change that does not close, a held one included.
 */
function closeEnclosing(result: ChangeCompletionResult, change: RuleNode | undefined, options: ChangeCompletionOptions): ChangeCompletionResult {
  for (let at = change; at; at = enclosingChange(result.tree, at.id)) {
    if ((at.status ?? "pending") !== "pending" || !closable(at)) break;
    if (unfinishedWork(at).length > 0) break;
    closeChange(result, at, options);
    if (result.held) break;
  }
  return result;
}

function markCompleted(node: RuleNode, now: Date): void {
  node.status = "completed";
  node.completedAt = now.toISOString();
}

function emptyResult(tree: V2Tree, completed: string[]): ChangeCompletionResult {
  return { tree, completed, split: null, apply: null, applies: [], held: null };
}

function closeChange(result: ChangeCompletionResult, change: RuleNode, options: ChangeCompletionOptions): ChangeCompletionResult {
  if (awaitsPlacement(indexTree(result.tree), change)) {
    result.held = { changeId: change.id, reason: "it still needs placement; a person must confirm its targets before it closes" };
    return result;
  }
  markCompleted(change, options.now);
  result.completed.push(change.id);
  const unapplied = (change.children ?? []).filter((c) => c.type === "change" && c.status !== "deleted" && isOpenChange(c));
  let apply: CompletionApplyResult;
  if (isAppliedChange(change)) {
    apply = { applied: false, reason: `already applied at ${change.appliedAt}` };
  } else if (unapplied.length > 0) {
    const named = unapplied.map((c) => `change ${c.displayId ?? c.id}`).join(", ");
    apply = { applied: false, reason: `${named} ${unapplied.length > 1 ? "are" : "is"} not applied; a change applies after the changes nested in it` };
  } else {
    try {
      apply = applyOnTrigger(result.tree, change.id, "complete", options);
    } catch (error) {
      if (!(error instanceof ApplyAmendmentsError)) throw error;
      apply = { applied: false, reason: error.message, error };
    }
  }
  if (apply.applied) result.tree = apply.result.tree;
  result.apply ??= apply;
  result.applies.push({ changeId: change.id, apply });
  return result;
}
