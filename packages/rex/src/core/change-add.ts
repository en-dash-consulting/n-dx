/**
 * Add a node to the change layer (rex schema v2): a change, a task under a
 * change, or a subtask under a task.
 *
 * - A **change** with no `amends` and no `touches` goes to the Inbox: it is
 *   stamped `needsPlacement` so a person confirms its targets before it closes.
 *   One with a target is placed. Without a parent it sits at the change-layer
 *   root; a parent must be a change.
 * - A **task** goes through {@link addTask}, so the split rule applies and a
 *   completed, applied, cancelled or deleted change is refused.
 * - A **subtask** goes under a task.
 *
 * Product nodes are not added here: they are created by a change's `added`
 * amendment when the change applies.
 *
 * The new node is checked against the v2 rules; an error finding about it
 * refuses the add (an unresolved `blockedBy`, `touches` or amendment target,
 * for instance). Findings about other nodes are not this add's to report.
 * A change with amends is also dry-run through apply
 * ({@link applyAmendmentsProblems}) and refused with apply's problems: no
 * tool edits an amendment once stored, so one apply always refuses never would
 * apply. A problem only another open change causes is a warning, not a refusal.
 *
 * Pure: works on a copy and leaves writing to the caller.
 *
 * @module rex/core/change-add
 */

import { randomUUID } from "node:crypto";
import type { Priority } from "../schema/v1.js";
import type { Amendment, ChangeNodeType, DiscoveredFrom, SavedRunSettings } from "../schema/v2.js";
import { checkV2Rules, indexTree, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { applyAmendmentsProblems, freeSlug, NO_PROBLEMS, pendingWarnings } from "./apply-amendments.js";
import { addTask, closedState, ClosedChangeError, type ChangeSplit } from "./change-completion.js";

export interface AddChangeNodeInput {
  type: ChangeNodeType;
  title: string;
  /** Id, display id or alias of the parent: a change for a change or task, a task for a subtask. */
  parentId?: string;
  /** A change's `intent`; a task's or subtask's `description`. */
  description?: string;
  acceptanceCriteria?: string[];
  tags?: string[];
  source?: string;
  blockedBy?: string[];
  /** Change and task only. */
  priority?: Priority;
  /** Change and task only. */
  run?: SavedRunSettings;
  /** Change only. */
  amends?: Amendment[];
  /** Change only. */
  touches?: string[];
  /** Change only. */
  discoveredFrom?: DiscoveredFrom;
}

export interface AddChangeNodeOptions {
  /** Split time for {@link addTask} and the reference time for the rules. */
  now: Date;
  /** Id for the new node. Default `randomUUID`. */
  newId?: () => string;
}

export interface AddChangeNodeResult {
  /** The new tree; the input is not modified. */
  tree: V2Tree;
  /** The node as added. */
  node: RuleNode;
  /** The split a first task of an `in_progress` change performed. */
  split: ChangeSplit | null;
  /** Problems only other open changes cause: apply refuses until they close, and the change is stored anyway. */
  warnings: string[];
}

export class AddChangeNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddChangeNodeError";
  }
}

/** Fields a type does not carry, so passing one is refused rather than dropped. */
const UNCARRIED: Readonly<Record<ChangeNodeType, readonly (keyof AddChangeNodeInput)[]>> = {
  change: [],
  task: ["amends", "touches", "discoveredFrom"],
  subtask: ["amends", "touches", "discoveredFrom", "priority", "run"],
};

/** The parent type each type takes, and whether it must have one. */
const PARENT_TYPE: Readonly<Record<ChangeNodeType, { type: ChangeNodeType; required: boolean }>> = {
  change: { type: "change", required: false },
  task: { type: "change", required: true },
  subtask: { type: "task", required: true },
};

/** Add `input` to the change layer of `tree`. */
export function addChangeNode(tree: V2Tree, input: AddChangeNodeInput, options: AddChangeNodeOptions): AddChangeNodeResult {
  const { type } = input;
  const uncarried = UNCARRIED[type].filter((field) => input[field] !== undefined);
  if (uncarried.length) throw new AddChangeNodeError(`A ${type} does not carry ${uncarried.join(", ")}`);

  const want = PARENT_TYPE[type];
  if (want.required && input.parentId === undefined) throw new AddChangeNodeError(`A ${type} needs parentId: the ${want.type} it belongs to`);
  refuseClosedChange(tree, input.parentId, type);
  const parent = input.parentId === undefined ? undefined : indexTree(tree).resolve(input.parentId);
  // A task's parent is resolved by addTask, which names a closed change's state.
  if (input.parentId !== undefined && type !== "task" && parent?.type !== want.type) {
    throw new AddChangeNodeError(`No live ${want.type} "${input.parentId}" to add the ${type} under`);
  }

  const id = (options.newId ?? randomUUID)();
  if (indexTree(tree, { includeTombstones: true }).resolve(id)) throw new AddChangeNodeError(`The new id ${id} is already taken`);
  const siblings = parent ? (parent.children ?? []) : type === "change" ? tree.changes : [];
  const node = {
    id,
    type,
    title: input.title,
    slug: freeSlug(input.title, id, siblings),
    ...fields(input),
  } as RuleNode;

  let next: V2Tree;
  let split: ChangeSplit | null = null;
  if (type === "task") {
    const added = addTask(tree, input.parentId!, node, options.now);
    next = added.tree;
    split = added.split;
  } else {
    next = structuredClone(tree);
    if (parent) {
      const holder = indexTree(next).resolve(parent.id)!;
      holder.children = [...(holder.children ?? []), node];
    } else {
      next.changes = [...next.changes, node];
    }
  }

  const errors = checkV2Rules(next, { now: options.now }).filter((f) => f.nodeId === id && f.severity === "error");
  if (errors.length) throw new AddChangeNodeError(`Cannot add ${type} "${input.title}": ${errors.map((f) => f.message).join("; ")}`);
  const { always, pending, blockedBy } = input.amends?.length ? applyAmendmentsProblems(next, id, options.now) : NO_PROBLEMS;
  if (always.length) throw new AddChangeNodeError(`Cannot add ${type} "${input.title}": ${always.join("; ")}`);
  return { tree: next, node: indexTree(next).resolve(id)!, split, warnings: pendingWarnings(pending, blockedBy) };
}

/**
 * A closed change (completed, applied, cancelled or deleted) takes no new
 * change, and none of its tasks a subtask: later work is a follow-up change.
 * A task's own parent is checked by {@link addTask}.
 */
function refuseClosedChange(tree: V2Tree, parentId: string | undefined, type: ChangeNodeType): void {
  if (parentId === undefined || type === "task") return;
  const all = indexTree(tree, { includeTombstones: true });
  let entry = all.entries.find((e) => e.node === all.resolve(parentId));
  while (entry && entry.node.type !== "change") entry = all.entries.find((e) => e.node === entry!.parent);
  const closed = entry && closedState(entry.node, !!entry.retired);
  if (entry && closed) throw new ClosedChangeError(entry.node.id, closed, entry.node.displayId ?? entry.node.id, type);
}

/** The intent fields `input` sets, named as `input.type` stores them, plus Inbox placement for an untargeted change. */
function fields(input: AddChangeNodeInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.description) out[input.type === "change" ? "intent" : "description"] = input.description;
  if (input.acceptanceCriteria?.length) out.acceptanceCriteria = input.acceptanceCriteria;
  if (input.tags?.length) out.tags = input.tags;
  if (input.source) out.source = input.source;
  if (input.blockedBy?.length) out.blockedBy = input.blockedBy;
  if (input.priority) out.priority = input.priority;
  if (input.run) out.run = input.run;
  if (input.amends?.length) out.amends = input.amends;
  if (input.touches?.length) out.touches = input.touches;
  if (input.discoveredFrom) out.discoveredFrom = input.discoveredFrom;
  if (input.type === "change" && !input.amends?.length && !input.touches?.length) out.needsPlacement = true;
  return out;
}
