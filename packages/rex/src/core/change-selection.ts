/**
 * Work selection over the change layer: which change or task `ndx work` runs
 * next. Pure; nothing here writes. The v1 counterpart is `core/next-task.ts`.
 *
 * ## Units of work
 *
 * A task is a unit. A change with no live tasks and no live nested changes is
 * itself the unit; a change with tasks is worked through them and is never
 * selected while it has any (completing it is the completion path's job). A
 * change holding a change is a container: selection descends into it, and the
 * enclosing change's gates apply to everything inside. Subtasks belong to
 * their task. {@link changeWorkShape} is the one judgement of which a change
 * is; selection, {@link resolveWorkById} and `claim_task` all use it.
 *
 * ## Autonomous selection
 *
 * A unit is a candidate when it is `pending`, `in_progress` or `failing`, its
 * `blockedBy` refs all name completed nodes, and its change is open
 * (`isOpenChange`), itself in one of those statuses, unblocked and placed. A
 * change with `needsPlacement` is in the Inbox: neither it nor its tasks are
 * selected autonomously, but {@link resolveWorkById} still returns them, so
 * `ndx work --task` runs them.
 *
 * ## Explicit refs
 *
 * {@link resolveWorkById} answers a ref by name. A ref naming a change with
 * open tasks ({@link openChangeTasks}) answers that change's next runnable
 * task, ranked as below, never the change: the change closes once its tasks
 * do, so a run of the whole change could not complete it.
 *
 * `ready` is informational. `readyOnly` and `assignee` (`--ready-only`,
 * `--mine`) narrow the candidates only when asked; a task inherits either
 * value from its change unless it sets its own `ready`.
 *
 * ## Order
 *
 * 1. Started work first: `failing`, then `in_progress` (as in v1).
 * 2. Priority: the task's own, else its change's; `medium` when neither sets one.
 * 3. Nearest `plannedRelease` of the change; a change without one sorts last.
 * 4. Dependency order: a unit more items are `blockedBy` goes first, then tree order.
 *
 * @module rex/core/change-selection
 */

import { indexTree, isOpenChange, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { PRIORITY_ORDER, type ItemStatus } from "../schema/v1.js";
import type { ChangeNode, TaskNode } from "../schema/v2.js";
import { SUCCESSFUL_CHILD_STATUSES } from "./parent-completion.js";

export type WorkKind = "change" | "task";
type ChangeRule = RuleNode & ChangeNode;
type TaskRule = RuleNode & TaskNode;

export interface WorkUnit {
  kind: WorkKind;
  /** The change or task to run. */
  node: ChangeRule | TaskRule;
  /** The change the unit belongs to; `node` itself for a task-less change. */
  change: ChangeRule;
}

export interface WorkSelectionOptions {
  /**
   * Ids to pass over, e.g. units another worktree has claimed. A change's id
   * also passes over everything inside it, at any depth: a claim on a
   * task-less change covers the task it later splits into.
   */
  excludeIds?: ReadonlySet<string>;
  /** Only units marked `ready` (`--ready-only`). */
  readyOnly?: boolean;
  /** Only units this identity is assigned, directly or through the change (`--mine`). */
  assignee?: string;
}

/** A child as {@link changeWorkShape} reads it: a change-layer node or its projected item. */
export interface WorkShapeChild {
  type?: string;
  status?: string;
}

/** `unit`: the change is itself the work. `tasks`: worked through its tasks. `container`: holds a change, never a unit. */
export type ChangeWorkShape = "unit" | "tasks" | "container";

/** How a change is worked, judged on its live children (a deleted one is a tombstone and does not count). */
export function changeWorkShape(change: { children?: readonly WorkShapeChild[] }): ChangeWorkShape {
  const live = (change.children ?? []).filter((c) => c.status !== "deleted");
  if (live.some((c) => c.type === "change")) return "container";
  return live.some((c) => c.type === "task") ? "tasks" : "unit";
}

const ACTIONABLE: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["pending", "in_progress", "failing"]);

/** Every autonomous candidate, best first. */
export function findActionableWork(tree: V2Tree, options: WorkSelectionOptions = {}): WorkUnit[] {
  const index = indexTree(tree);
  const runnable = (node: RuleNode): boolean => runnableIn(index, node);

  // Whether a change may yield work: its own gates and every enclosing change's.
  const parentOf = new Map(index.entries.map((e) => [e.node, e.parent]));
  const workable = new Map<RuleNode, boolean>();
  const changeWorkable = (node: RuleNode): boolean => {
    const parent = parentOf.get(node);
    const ok = isOpenChange(node) && !node.needsPlacement && runnable(node) && (parent?.type !== "change" || workable.get(parent) === true);
    workable.set(node, ok);
    return ok;
  };

  // Whether a change or one enclosing it is excluded, which excludes all it holds.
  const exclude = options.excludeIds ?? new Set<string>();
  const held = (change: RuleNode): boolean =>
    exclude.size > 0 && [change, ...enclosingChanges(change, parentOf)].some((c) => exclude.has(c.id));

  const units: WorkUnit[] = [];
  // Entries are in tree order, so an enclosing change is judged before what it holds.
  for (const { node } of index.entries) {
    if (node.type !== "change" || !changeWorkable(node)) continue;
    const change = node as ChangeRule;
    if (changeWorkShape(change) === "unit") units.push({ kind: "change", node: change, change });
    // A container's own tasks are units beside its nested changes.
    for (const task of node.children ?? []) {
      if (task.type === "task" && task.status !== "deleted" && runnable(task)) units.push({ kind: "task", node: task as TaskRule, change });
    }
  }

  const candidates = units.filter(
    (u) =>
      !exclude.has(u.node.id) &&
      !held(u.change) &&
      (!options.readyOnly || (u.node.ready ?? u.change.ready) === true) &&
      (!options.assignee || u.node.assignee === options.assignee || u.change.assignee === options.assignee),
  );
  return rank(index, candidates);
}

type TreeIndex = ReturnType<typeof indexTree>;

/** `units` best first, in the documented order. */
function rank(index: TreeIndex, units: WorkUnit[]): WorkUnit[] {
  const order = new Map<RuleNode, number>();
  const dependents = new Map<RuleNode, number>();
  index.entries.forEach(({ node }, i) => {
    order.set(node, i);
    for (const ref of node.blockedBy ?? []) {
      const target = index.resolve(ref);
      if (target) dependents.set(target, (dependents.get(target) ?? 0) + 1);
    }
  });
  return units.sort(
    (a, b) =>
      urgency(a.node) - urgency(b.node) ||
      priorityRank(a) - priorityRank(b) ||
      compareReleases(a.change.plannedRelease, b.change.plannedRelease) ||
      (dependents.get(b.node) ?? 0) - (dependents.get(a.node) ?? 0) ||
      (order.get(a.node) ?? 0) - (order.get(b.node) ?? 0),
  );
}

/** The blocker refs of `node` naming something not completed; an unresolvable ref counts. */
function openBlockers(index: TreeIndex, node: RuleNode): string[] {
  return (node.blockedBy ?? []).filter((ref) => index.resolve(ref)?.status !== "completed");
}

/** Pending, in progress or failing, with every blocker completed. */
function runnableIn(index: TreeIndex, node: RuleNode): boolean {
  return ACTIONABLE.has(node.status ?? "pending") && openBlockers(index, node).length === 0;
}

/** The unit autonomous selection runs next, or `null` when none is actionable. */
export function findNextWork(tree: V2Tree, options: WorkSelectionOptions = {}): WorkUnit | null {
  return findActionableWork(tree, options)[0] ?? null;
}

export interface ResolveWorkOptions {
  /** Tasks to pass over when the ref names a change with open tasks, e.g. ones another worktree has claimed. */
  excludeIds?: ReadonlySet<string>;
}

/**
 * The unit an explicit `ndx work --task` runs for a ref (id, display id or
 * alias). Selection gates do not apply: a change awaiting placement runs when
 * asked for by name. A change with open tasks ({@link openChangeTasks})
 * answers its best runnable task outside `excludeIds`, never itself. `null`
 * when the ref names no live change or task, names a container
 * ({@link changeWorkShape}: its work is its nested changes and tasks), or
 * names a change none of whose open tasks can run; a caller explaining the
 * refusal checks the shape or the open tasks.
 */
export function resolveWorkById(tree: V2Tree, ref: string, options: ResolveWorkOptions = {}): WorkUnit | null {
  const index = indexTree(tree);
  const node = index.resolve(ref);
  if (node?.type === "change" && changeWorkShape(node) === "container") return null;
  if (node?.type === "change") {
    const change = node as ChangeRule;
    const open = openTasks(change);
    if (open.length === 0) return { kind: "change", node: change, change };
    const runnable = open.filter((t) => !options.excludeIds?.has(t.id) && runnableIn(index, t));
    return rank(index, runnable.map((t) => ({ kind: "task" as const, node: t, change })))[0] ?? null;
  }
  if (node?.type !== "task") return null;
  const [change] = enclosingChanges(node, new Map(index.entries.map((e) => [e.node, e.parent])));
  return change ? { kind: "task", node: node as TaskRule, change: change as ChangeRule } : null;
}

/** A change's open task, with its blocker refs that are not completed. */
export interface OpenChangeTask {
  node: TaskRule;
  openBlockers: string[];
}

/**
 * The open tasks of the change a ref names: live and not completed, the work
 * that keeps the change from closing. `[]` when the ref names no change, a
 * container, or a change without open tasks, which runs as one unit.
 */
export function openChangeTasks(tree: V2Tree, ref: string): OpenChangeTask[] {
  const index = indexTree(tree);
  const node = index.resolve(ref);
  if (node?.type !== "change" || changeWorkShape(node) === "container") return [];
  return openTasks(node as ChangeRule).map((t) => ({ node: t, openBlockers: openBlockers(index, t) }));
}

function openTasks(change: ChangeRule): TaskRule[] {
  return (change.children ?? []).filter(
    (c): c is TaskRule => c.type === "task" && c.status !== "deleted" && !SUCCESSFUL_CHILD_STATUSES.has(c.status ?? "pending"),
  );
}

/**
 * Ids of the changes enclosing the node a ref names, innermost first, not the
 * node itself: a claim on any of them covers the node. `[]` when the ref names
 * nothing.
 */
export function enclosingChangeIds(tree: V2Tree, ref: string): string[] {
  const index = indexTree(tree);
  const node = index.resolve(ref);
  return node ? enclosingChanges(node, new Map(index.entries.map((e) => [e.node, e.parent]))).map((c) => c.id) : [];
}

function enclosingChanges(node: RuleNode, parentOf: ReadonlyMap<RuleNode, RuleNode | undefined>): RuleNode[] {
  const out: RuleNode[] = [];
  for (let p = parentOf.get(node); p; p = parentOf.get(p)) if (p.type === "change") out.push(p);
  return out;
}

function urgency(node: RuleNode): number {
  return node.status === "failing" ? 0 : node.status === "in_progress" ? 1 : 2;
}

function priorityRank({ node, change }: WorkUnit): number {
  return PRIORITY_ORDER[node.priority ?? change.priority ?? "medium"];
}

/**
 * Nearest release first; absent last. Compares dot-separated parts numerically
 * where both are numbers, ignores a leading `v` or `<package>@`, and orders a
 * prerelease (`1.0.0-rc.1`) before its release.
 */
export function compareReleases(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const [coreA, preA] = splitRelease(a);
  const [coreB, preB] = splitRelease(b);
  return compareParts(coreA, coreB) || (preA === preB ? 0 : !preA ? 1 : !preB ? -1 : compareParts(preA, preB));
}

function splitRelease(version: string): [string, string] {
  const bare = version.slice(version.lastIndexOf("@") + 1).replace(/^v/i, "");
  const dash = bare.indexOf("-");
  return dash < 0 ? [bare, ""] : [bare.slice(0, dash), bare.slice(dash + 1)];
}

function compareParts(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const diff = pa[i].localeCompare(pb[i], undefined, { numeric: true });
    if (diff !== 0) return diff;
  }
  return 0;
}
