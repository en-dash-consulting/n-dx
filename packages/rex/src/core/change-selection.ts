/**
 * Work selection over the change layer: which change or task `ndx work` runs
 * next. Pure; nothing here writes. The v1 counterpart is `core/next-task.ts`.
 *
 * ## Units of work
 *
 * A task is a unit. A change with no live tasks is itself the unit; a change
 * with tasks is worked through them and is never selected while it has any
 * (completing it is the completion path's job). Subtasks belong to their task.
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
  /** Ids to pass over, e.g. units another worktree has claimed. */
  excludeIds?: ReadonlySet<string>;
  /** Only units marked `ready` (`--ready-only`). */
  readyOnly?: boolean;
  /** Only units this identity is assigned, directly or through the change (`--mine`). */
  assignee?: string;
}

const ACTIONABLE: ReadonlySet<ItemStatus> = new Set<ItemStatus>(["pending", "in_progress", "failing"]);

/** Every autonomous candidate, best first. */
export function findActionableWork(tree: V2Tree, options: WorkSelectionOptions = {}): WorkUnit[] {
  const index = indexTree(tree);
  const blockerOpen = (node: RuleNode): boolean =>
    (node.blockedBy ?? []).some((ref) => index.resolve(ref)?.status !== "completed");
  const runnable = (node: RuleNode): boolean => ACTIONABLE.has(node.status ?? "pending") && !blockerOpen(node);

  const order = new Map<RuleNode, number>();
  const dependents = new Map<RuleNode, number>();
  const units: WorkUnit[] = [];
  index.entries.forEach(({ node }, i) => {
    order.set(node, i);
    for (const ref of node.blockedBy ?? []) {
      const target = index.resolve(ref);
      if (target) dependents.set(target, (dependents.get(target) ?? 0) + 1);
    }
    if (node.type !== "change") return;
    if (!isOpenChange(node) || node.needsPlacement || !runnable(node)) return;
    const tasks = (node.children ?? []).filter((c) => c.type === "task" && c.status !== "deleted");
    const change = node as ChangeRule;
    if (tasks.length === 0) units.push({ kind: "change", node: change, change });
    for (const task of tasks) if (runnable(task)) units.push({ kind: "task", node: task as TaskRule, change });
  });

  const candidates = units.filter(
    (u) =>
      !options.excludeIds?.has(u.node.id) &&
      (!options.readyOnly || (u.node.ready ?? u.change.ready) === true) &&
      (!options.assignee || u.node.assignee === options.assignee || u.change.assignee === options.assignee),
  );
  return candidates.sort(
    (a, b) =>
      urgency(a.node) - urgency(b.node) ||
      priorityRank(a) - priorityRank(b) ||
      compareReleases(a.change.plannedRelease, b.change.plannedRelease) ||
      (dependents.get(b.node) ?? 0) - (dependents.get(a.node) ?? 0) ||
      (order.get(a.node) ?? 0) - (order.get(b.node) ?? 0),
  );
}

/** The unit autonomous selection runs next, or `null` when none is actionable. */
export function findNextWork(tree: V2Tree, options: WorkSelectionOptions = {}): WorkUnit | null {
  return findActionableWork(tree, options)[0] ?? null;
}

/**
 * The change or task a ref names (id, display id or alias), for an explicit
 * `ndx work --task`. Selection gates do not apply: a change awaiting placement
 * runs when asked for by name. `null` when the ref names no live change or task.
 */
export function resolveWorkById(tree: V2Tree, ref: string): WorkUnit | null {
  const index = indexTree(tree);
  const node = index.resolve(ref);
  if (node?.type === "change") return { kind: "change", node: node as ChangeRule, change: node as ChangeRule };
  if (node?.type !== "task") return null;
  const parentOf = new Map(index.entries.map((e) => [e.node, e.parent]));
  let change = parentOf.get(node);
  while (change && change.type !== "change") change = parentOf.get(change);
  return change ? { kind: "task", node: node as TaskRule, change: change as ChangeRule } : null;
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
