/**
 * Branch work sets: the units of work assigned to a branch, recorded per unit
 * as `delivery: { branch }` in `state.yaml` (`ItemState.delivery`).
 *
 * ## Units
 *
 * The unit is the task. A change with no live tasks (`changeWorkShape`
 * `unit`) counts as one task and carries `delivery` on its own row. A unit
 * sits on at most one branch.
 *
 * - **Assign.** A task names itself; a change names every open unit under it
 *   (pending, in progress or failing; never completed, deferred, cancelled or
 *   deleted), through nested changes. A unit already on another branch is
 *   refused, naming that branch, unless the caller passes `move`; one already
 *   on this branch is left alone. A refusal throws {@link WorkSetError} before
 *   anything is changed.
 * - **Unassign.** Removes `delivery` from the named task, or from a change and
 *   every live node under it, whatever its status.
 * - **Read.** {@link readWorkSet}: the open units on a branch, and whether the
 *   branch has any assignment at all, since a branch without one has no work
 *   set and selection there is unchanged.
 *
 * The plan functions are pure: they return a new tree and write nothing.
 * {@link assignToBranch} and {@link unassignFromBranch} run them inside
 * `withPrdModelTransaction`. The branch is always a parameter; reading the
 * checked-out branch is `currentWorkSetBranch` (`store/branch-naming.ts`).
 *
 * @module rex/core/work-set
 */

import { DeliverySchema } from "../schema/v2.js";
import { indexTree, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { currentWorkSetBranch } from "../store/branch-naming.js";
import { withPrdModelTransaction } from "../store/prd-model-transaction.js";
import { changeWorkShape, isActionableStatus } from "./change-selection.js";

/** A refused assignment or an unusable ref or branch. Nothing was changed. */
export class WorkSetError extends Error {
  constructor(message: string, readonly problems: readonly string[] = [message]) {
    super(message);
    this.name = "WorkSetError";
  }
}

export interface AssignOptions {
  /** Take units already on another branch onto this one instead of refusing. */
  move?: boolean;
}

export interface AssignReport {
  branch: string;
  /** Units given `delivery` on this branch, moved ones included. */
  assigned: string[];
  /** Units taken from another branch (`move`), with the branch they left. */
  moved: Array<{ id: string; from: string }>;
  /** Units already on this branch. */
  unchanged: string[];
}

export interface UnassignReport {
  /** Nodes whose `delivery` was removed, with the branch they were on. */
  removed: Array<{ id: string; from: string }>;
}

export interface WorkSetPlan<R> {
  /** The tree with the edit made; the input tree is not modified. */
  tree: V2Tree;
  report: R;
  /** Whether `tree` differs from the input. */
  changed: boolean;
}

export interface WorkSet {
  branch: string;
  /** Ids of the open units on the branch, in tree order. */
  ids: string[];
  /** Whether any live node, in any status, is on the branch. False: the branch has no work set. */
  hasAssignments: boolean;
}

/** Assign the units `refs` name to `branch`. Throws {@link WorkSetError} on a refusal. */
export function planAssignToBranch(input: V2Tree, refs: readonly string[], branch: string, options: AssignOptions = {}): WorkSetPlan<AssignReport> {
  assertBranch(branch);
  const tree = structuredClone(input);
  const index = indexTree(tree);
  const problems: string[] = [];
  const units = new Set<RuleNode>();
  for (const ref of refs) {
    const node = index.resolve(ref);
    if (!node) problems.push(`No change or task "${ref}"`);
    else if (node.type === "task") {
      if (isActionableStatus(node.status)) units.add(node);
      else problems.push(`Task ${label(node)} is ${node.status}: only open tasks (pending, in progress or failing) join a work set`);
    } else if (node.type === "change") {
      const open = openUnits(node);
      if (open.length === 0) problems.push(`Change ${label(node)} has no open task to assign`);
      for (const unit of open) units.add(unit);
    } else problems.push(`${label(node)} is a ${node.type}: a work set holds changes and tasks`);
  }

  const report: AssignReport = { branch, assigned: [], moved: [], unchanged: [] };
  for (const unit of units) {
    const from = unit.delivery?.branch;
    if (from === branch) report.unchanged.push(unit.id);
    else if (from !== undefined && !options.move) {
      problems.push(`${label(unit)} is on branch "${from}"; pass move to take it onto "${branch}"`);
    } else {
      if (from !== undefined) report.moved.push({ id: unit.id, from });
      report.assigned.push(unit.id);
    }
  }
  if (problems.length > 0) throw new WorkSetError(`Cannot assign to branch "${branch}": ${problems.join("; ")}`, problems);

  const assigned = new Set(report.assigned);
  for (const unit of units) if (assigned.has(unit.id)) unit.delivery = { ...unit.delivery, branch };
  return { tree, report, changed: assigned.size > 0 };
}

/** Remove `delivery` from the nodes `refs` name, and from everything under a named change; with `onBranch`, only where it names that branch. */
export function planUnassignFromBranch(input: V2Tree, refs: readonly string[], onBranch?: string): WorkSetPlan<UnassignReport> {
  const tree = structuredClone(input);
  const index = indexTree(tree);
  const problems: string[] = [];
  const nodes = new Set<RuleNode>();
  for (const ref of refs) {
    const node = index.resolve(ref);
    if (!node) problems.push(`No change or task "${ref}"`);
    else if (node.type === "task") nodes.add(node);
    else if (node.type === "change") for (const n of liveSubtree(node)) nodes.add(n);
    else problems.push(`${label(node)} is a ${node.type}: a work set holds changes and tasks`);
  }
  if (problems.length > 0) throw new WorkSetError(`Cannot unassign: ${problems.join("; ")}`, problems);

  const report: UnassignReport = { removed: [] };
  for (const node of nodes) {
    if (node.delivery === undefined || (onBranch !== undefined && node.delivery.branch !== onBranch)) continue;
    report.removed.push({ id: node.id, from: node.delivery.branch });
    delete node.delivery;
  }
  return { tree, report, changed: report.removed.length > 0 };
}

/** The work set of `branch`: its open units, and whether it has any assignment at all. */
export function readWorkSet(tree: V2Tree, branch: string): WorkSet {
  const ids: string[] = [];
  let hasAssignments = false;
  for (const { node } of indexTree(tree).entries) {
    if (node.delivery?.branch !== branch) continue;
    hasAssignments = true;
    if (isUnit(node) && isActionableStatus(node.status)) ids.push(node.id);
  }
  return { branch, ids, hasAssignments };
}

/** A unit as output names it. */
export interface UnitInfo {
  id: string;
  displayId?: string;
  title: string;
  status: string;
}

/** One change of a work set with its units. A task-less change lists itself as its only unit. */
export interface WorkSetGroup {
  change: { id: string; displayId?: string; title: string };
  units: UnitInfo[];
}

/**
 * The checked-out branch of `projectDir`. Throws {@link WorkSetError} on the
 * default branch or a detached HEAD, which have no work set.
 */
export function requireWorkSetBranch(projectDir: string): string {
  const branch = currentWorkSetBranch(projectDir);
  if (branch === null) {
    throw new WorkSetError(
      "A work set belongs to a feature branch, and this checkout is on the default branch or a detached HEAD. Switch to a feature branch first.",
    );
  }
  return branch;
}

/** `ids` as output names them, in the order given; an id the tree does not hold is skipped. */
export function describeUnits(tree: V2Tree, ids: readonly string[]): UnitInfo[] {
  const index = indexTree(tree);
  return ids.flatMap((id) => {
    const node = index.resolve(id);
    return node ? [unitInfo(node)] : [];
  });
}

/** The open units on `branch`, grouped by the change they belong to, in tree order. */
export function groupWorkSet(tree: V2Tree, branch: string): WorkSetGroup[] {
  const ids = new Set(readWorkSet(tree, branch).ids);
  const groups = new Map<string, WorkSetGroup>();
  for (const { node, parent } of indexTree(tree).entries) {
    if (!ids.has(node.id)) continue;
    const owner = node.type === "task" && parent ? parent : node;
    let group = groups.get(owner.id);
    if (!group) {
      group = { change: { id: owner.id, ...(owner.displayId ? { displayId: owner.displayId } : {}), title: owner.title }, units: [] };
      groups.set(owner.id, group);
    }
    group.units.push(unitInfo(node));
  }
  return [...groups.values()];
}

function unitInfo(node: RuleNode): UnitInfo {
  return { id: node.id, ...(node.displayId ? { displayId: node.displayId } : {}), title: node.title, status: node.status ?? "pending" };
}

/** {@link planAssignToBranch} on the tree under `rexDir`, inside the PRD transaction. */
export async function assignToBranch(rexDir: string, refs: readonly string[], branch: string, options: AssignOptions = {}): Promise<AssignReport> {
  const { result } = await withPrdModelTransaction(rexDir, ({ tree }) => {
    const plan = planAssignToBranch(tree, refs, branch, options);
    return { tree: plan.tree, result: plan.report };
  });
  return result;
}

/** {@link planUnassignFromBranch} on the tree under `rexDir`, inside the PRD transaction. */
export async function unassignFromBranch(rexDir: string, refs: readonly string[], onBranch?: string): Promise<UnassignReport> {
  const { result } = await withPrdModelTransaction(rexDir, ({ tree }) => {
    const plan = planUnassignFromBranch(tree, refs, onBranch);
    return { tree: plan.tree, result: plan.report };
  });
  return result;
}

function assertBranch(branch: string): void {
  if (!DeliverySchema.safeParse({ branch }).success || branch.trim() !== branch) {
    throw new WorkSetError(`Invalid branch name ${JSON.stringify(branch)}: expected a non-empty name without surrounding whitespace`);
  }
}

/** A task, or a change worked as one unit. */
function isUnit(node: RuleNode): boolean {
  return node.type === "task" || (node.type === "change" && changeWorkShape(node) === "unit");
}

/** The open units under a change, the change itself when it is one, through nested changes. */
function openUnits(change: RuleNode): RuleNode[] {
  if (changeWorkShape(change) === "unit") return isActionableStatus(change.status) ? [change] : [];
  return live(change).flatMap((child) =>
    child.type === "change" ? openUnits(child) : child.type === "task" && isActionableStatus(child.status) ? [child] : [],
  );
}

/** A node and every live node under it. */
function liveSubtree(node: RuleNode): RuleNode[] {
  return [node, ...live(node).flatMap(liveSubtree)];
}

function live(node: RuleNode): RuleNode[] {
  return (node.children ?? []).filter((c) => c.status !== "deleted");
}

function label(node: RuleNode): string {
  return node.displayId ? `${node.displayId} "${node.title}"` : `"${node.title}" (${node.id})`;
}
