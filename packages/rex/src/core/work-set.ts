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
 * ## Inheritance
 *
 * A change's own `delivery` covers every unit under it that has none of its
 * own, so a task-less change assigned to a branch keeps the tasks it is later
 * split into on that branch. A unit's own `delivery` overrides the nearest
 * enclosing change's. {@link effectiveDelivery} is that one rule, and every
 * reader and both plans use it.
 *
 * - **Assign.** A task names itself; a change names every open unit under it
 *   (pending, in progress or failing; never completed, deferred, cancelled or
 *   deleted), through nested changes. A unit already on another branch, by
 *   its own or an inherited `delivery`, is refused, naming that branch and the
 *   change it inherits from, unless the caller passes `move`, which gives the
 *   unit its own `delivery` and, for a named change, also moves the change's
 *   own `delivery` so tasks it gains later follow it; one already on this
 *   branch is left alone. A
 *   refusal throws {@link WorkSetError} before anything is changed.
 * - **Unassign.** Removes `delivery` from the named task, or from a change and
 *   every live node under it, whatever its status, so the units inheriting
 *   from the change drop out with it. A named task that only inherits keeps
 *   its branch; it is reported with the change it inherits from.
 * - **Read.** {@link readWorkSet}: the open units on a branch, and whether the
 *   branch has any assignment at all, since a branch without one has no work
 *   set and selection there is unchanged.
 * - **Earlier use.** `delivery` is never cleared on merge; it stays as
 *   provenance. Rows that already named the branch where it left the default
 *   branch ({@link earlierUseRows}) belong to an earlier branch of that name,
 *   so a branch cut again under a merged branch's name has no work set.
 * - **Select.** {@link currentWorkSet}: the checked-out branch's set, which
 *   `get_next_task`, `rex next` and `ndx work` narrow selection to unless
 *   asked for `any`. {@link branchWorkState} is the same read for a branch
 *   with no set, for `rex branch show` and the earlier-use line. A set whose
 *   units are all done is finished, and still narrows selection.
 *
 * The plan functions are pure: they return a new tree and write nothing.
 * {@link assignToBranch} and {@link unassignFromBranch} run them inside
 * `withPrdModelTransaction`. The branch is always a parameter; reading the
 * checked-out branch is `currentWorkSetBranch` (`store/branch-naming.ts`).
 *
 * @module rex/core/work-set
 */

import { isAbsolute, join, relative, sep } from "node:path";
import { DeliverySchema, type ItemState } from "../schema/v2.js";
import { indexTree, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { currentWorkSetBranch, readStateFilesAt, workSetForkPoint } from "../store/branch-naming.js";
import { resolveRexPaths } from "../store/paths.js";
import { CHANGES_DIRNAME } from "../store/prd-model-reader.js";
import { parseStateYaml } from "../store/state-writer.js";
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
  /** Named tasks that stay on the branch through their change's `delivery`, with that change's id. */
  inherited: Array<{ id: string; from: string; change: string }>;
}

/** The branch a node is on, and the node whose `delivery` puts it there: itself or an enclosing change. */
export interface EffectiveDelivery {
  branch: string;
  owner: RuleNode;
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
  /**
   * Units, in any status, whose `delivery` already named the branch where it
   * left the default branch: an earlier branch of this name, merged since.
   * They are not in the set and count toward neither `ids` nor `hasAssignments`.
   */
  earlier: string[];
}

/** Assign the units `refs` name to `branch`. Throws {@link WorkSetError} on a refusal. */
export function planAssignToBranch(input: V2Tree, refs: readonly string[], branch: string, options: AssignOptions = {}): WorkSetPlan<AssignReport> {
  assertBranch(branch);
  const tree = structuredClone(input);
  const index = indexTree(tree);
  const problems: string[] = [];
  const units = new Set<RuleNode>();
  /** Named changes, and changes under them, whose own `delivery` their tasks may inherit. */
  const owners = new Set<RuleNode>();
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
      for (const n of liveSubtree(node)) if (n.type === "change" && n.delivery !== undefined) owners.add(n);
    } else problems.push(`${label(node)} is a ${node.type}: a work set holds changes and tasks`);
  }

  const deliveryOf = deliveryResolver(index);
  const report: AssignReport = { branch, assigned: [], moved: [], unchanged: [] };
  for (const unit of units) {
    const current = deliveryOf(unit);
    const from = current?.branch;
    if (from === branch) report.unchanged.push(unit.id);
    else if (current !== undefined && !options.move) {
      const via = current.owner === unit ? "" : ` through change ${label(current.owner)}`;
      problems.push(`${label(unit)} is on branch "${from}"${via}; pass move to take it onto "${branch}"`);
    } else {
      if (from !== undefined) report.moved.push({ id: unit.id, from });
      report.assigned.push(unit.id);
    }
  }
  if (problems.length > 0) throw new WorkSetError(`Cannot assign to branch "${branch}": ${problems.join("; ")}`, problems);

  // Moving a change moves the delivery its tasks inherit, so tasks it gains later follow it.
  const retarget: RuleNode[] = [];
  for (const owner of options.move ? owners : []) {
    const from = owner.delivery?.branch;
    if (units.has(owner) || from === undefined || from === branch) continue;
    retarget.push(owner);
    report.moved.push({ id: owner.id, from });
    report.assigned.push(owner.id);
  }
  const assigned = new Set(report.assigned);
  for (const node of [...units, ...retarget]) if (assigned.has(node.id)) node.delivery = { ...node.delivery, branch };
  return { tree, report, changed: assigned.size > 0 };
}

/** Remove `delivery` from the nodes `refs` name, and from everything under a named change; with `onBranch`, only where it names that branch. */
export function planUnassignFromBranch(input: V2Tree, refs: readonly string[], onBranch?: string): WorkSetPlan<UnassignReport> {
  const tree = structuredClone(input);
  const index = indexTree(tree);
  const problems: string[] = [];
  const nodes = new Set<RuleNode>();
  const tasks = new Set<RuleNode>();
  for (const ref of refs) {
    const node = index.resolve(ref);
    if (!node) problems.push(`No change or task "${ref}"`);
    else if (node.type === "task") {
      nodes.add(node);
      tasks.add(node);
    } else if (node.type === "change") for (const n of liveSubtree(node)) nodes.add(n);
    else problems.push(`${label(node)} is a ${node.type}: a work set holds changes and tasks`);
  }
  if (problems.length > 0) throw new WorkSetError(`Cannot unassign: ${problems.join("; ")}`, problems);

  const report: UnassignReport = { removed: [], inherited: [] };
  for (const node of nodes) {
    if (node.delivery === undefined || (onBranch !== undefined && node.delivery.branch !== onBranch)) continue;
    report.removed.push({ id: node.id, from: node.delivery.branch });
    delete node.delivery;
  }
  // Read after the removals, so a task named beside its change no longer inherits.
  const deliveryOf = deliveryResolver(index);
  for (const task of tasks) {
    const current = deliveryOf(task);
    if (current && current.owner !== task && (onBranch === undefined || current.branch === onBranch)) {
      report.inherited.push({ id: task.id, from: current.branch, change: current.owner.id });
    }
  }
  return { tree, report, changed: report.removed.length > 0 };
}

/**
 * The work set of `branch`: its open units, by their own or an inherited
 * `delivery`, and whether it has any assignment at all. Nodes in `earlier`
 * (rows that already named `branch` at its fork point, {@link earlierUseRows})
 * belong to an earlier use of the name: they and the units inheriting from
 * them are not in the set, and are listed in `earlier` instead.
 */
export function readWorkSet(tree: V2Tree, branch: string, earlier: ReadonlySet<string> = new Set()): WorkSet {
  const index = indexTree(tree);
  const deliveryOf = deliveryResolver(index);
  const ids: string[] = [];
  const earlierUnits: string[] = [];
  let hasAssignments = false;
  for (const { node } of index.entries) {
    if (node.delivery?.branch === branch && !earlier.has(node.id)) hasAssignments = true;
    if (!isUnit(node)) continue;
    const delivery = deliveryOf(node);
    if (delivery?.branch !== branch) continue;
    if (earlier.has(delivery.owner.id)) earlierUnits.push(node.id);
    else if (isActionableStatus(node.status)) ids.push(node.id);
  }
  return { branch, ids, hasAssignments, earlier: earlierUnits };
}

/** The branch the node `ref` names is on, by its own or its nearest enclosing change's `delivery`; undefined when on none. */
export function effectiveDelivery(tree: V2Tree, ref: string): EffectiveDelivery | undefined {
  const index = indexTree(tree);
  const node = index.resolve(ref);
  return node ? deliveryResolver(index)(node) : undefined;
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

/**
 * The work set selection is narrowed to in `projectDir`: its checked-out
 * branch's, when that branch has any assignment of its own. Null on the
 * default branch, a detached HEAD or a branch with no assignment, where
 * selection is not narrowed. A set whose `ids` is empty is finished, and
 * still narrows selection.
 */
export function currentWorkSet(tree: V2Tree, projectDir: string): WorkSet | null {
  const state = branchWorkState(tree, projectDir);
  return state?.hasAssignments ? state : null;
}

/**
 * The checked-out branch's work set as every reader states it, whether or not
 * it has one: {@link readWorkSet} with the rows {@link earlierUseRows} finds.
 * Null only on the default branch, a detached HEAD or outside git.
 * {@link currentWorkSet} is this, for a branch that has assignments.
 */
export function branchWorkState(tree: V2Tree, projectDir: string, branch: string | null = currentWorkSetBranch(projectDir)): WorkSet | null {
  if (branch === null) return null;
  return readWorkSet(tree, branch, earlierUseRows(projectDir, branch) ?? new Set());
}

/**
 * Ids of the `state.yaml` rows whose `delivery` already named `branch` at its
 * fork point (`workSetForkPoint`): assignments of an earlier branch of this
 * name, merged into the default branch before this one was cut. Their
 * `delivery` stays as provenance; it is just not this branch's. A branch
 * rebased onto a newer default branch keeps its own rows, which are not on
 * the default branch yet. Null when the fork point cannot be read (no default
 * branch, a shallow clone, a rex directory outside the checkout, a row this
 * build cannot parse); every row then counts, as it did before.
 */
export function earlierUseRows(projectDir: string, branch: string): Set<string> | null {
  const base = workSetForkPoint(projectDir);
  if (base === null) return null;
  const changesDir = relative(projectDir, join(resolveRexPaths(projectDir).rexDir, CHANGES_DIRNAME));
  if (changesDir === "" || changesDir.startsWith("..") || isAbsolute(changesDir)) return null;
  const files = readStateFilesAt(projectDir, base, changesDir.split(sep).join("/"), branch);
  if (files === null) return null;
  const ids = new Set<string>();
  for (const [path, text] of files) {
    const items = parseForkPointRows(text, `${base}:${path}`);
    if (items === null) return null;
    for (const [id, row] of Object.entries(items)) if (row.delivery?.branch === branch) ids.add(id);
  }
  return ids;
}

/** A `state.yaml` read at the fork point; null when this build cannot parse it. */
function parseForkPointRows(text: string, source: string): Record<string, ItemState> | null {
  try {
    return parseStateYaml(text, source, { ignoreSchemaStamp: true }).items;
  } catch {
    return null;
  }
}

/** A branch's {@link WorkSet.earlier} units as every reader reports them. */
export interface EarlierUse {
  branch: string;
  ids: string[];
  /** The line readers print, naming the count and the branch. */
  message: string;
}

/** `state`'s units from an earlier use of its branch name; null when it has none. */
export function earlierUseOf(state: WorkSet | null): EarlierUse | null {
  if (!state || state.earlier.length === 0) return null;
  const n = state.earlier.length;
  const message = n === 1
    ? `1 task on ${state.branch} comes from an earlier branch of this name; it is not in this branch's set`
    : `${n} tasks on ${state.branch} come from an earlier branch of this name; they are not in this branch's set`;
  return { branch: state.branch, ids: [...state.earlier], message };
}

/** Said when a branch's work set has no open unit left: every one is done. */
export function workSetFinishedMessage(anyHint: string): string {
  return `This branch's work set is finished: all its tasks are done; selection stays narrowed to it, and ${anyHint} picks outside it`;
}

/** `ids` as output names them, in the order given; an id the tree does not hold is skipped. */
export function describeUnits(tree: V2Tree, ids: readonly string[]): UnitInfo[] {
  const index = indexTree(tree);
  return ids.flatMap((id) => {
    const node = index.resolve(id);
    return node ? [unitInfo(node)] : [];
  });
}

/** A task that only inherits its branch, as output names it, with the change it inherits from. */
export interface InheritedUnitInfo extends UnitInfo {
  from: string;
  change: { id: string; displayId?: string; title: string };
}

/** {@link UnassignReport.inherited} as output names it; an id the tree does not hold is skipped. */
export function inheritedUnits(tree: V2Tree, inherited: UnassignReport["inherited"]): InheritedUnitInfo[] {
  const index = indexTree(tree);
  return inherited.flatMap(({ id, from, change }) => {
    const node = index.resolve(id);
    const owner = index.resolve(change);
    if (!node || !owner) return [];
    const changeInfo = { id: owner.id, ...(owner.displayId ? { displayId: owner.displayId } : {}), title: owner.title };
    return [{ ...unitInfo(node), from, change: changeInfo }];
  });
}

/** The units `unitIds` names (a work set's `ids` or `earlier`), grouped by the change they belong to, in tree order. */
export function groupWorkSet(tree: V2Tree, unitIds: readonly string[]): WorkSetGroup[] {
  const ids = new Set(unitIds);
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

/** A node's own `delivery`, else the nearest enclosing change's. */
function deliveryResolver(index: ReturnType<typeof indexTree>): (node: RuleNode) => EffectiveDelivery | undefined {
  const parentOf = new Map(index.entries.map((e) => [e.node, e.parent]));
  return (node) => {
    for (let at: RuleNode | undefined = node; at; at = parentOf.get(at)) {
      if (at.delivery !== undefined) return { branch: at.delivery.branch, owner: at };
      if (parentOf.get(at)?.type !== "change") return undefined;
    }
    return undefined;
  };
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
