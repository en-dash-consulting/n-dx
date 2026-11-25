/**
 * Dependency view for status displays: which open items an item waits on,
 * and a sibling order that puts every item after the siblings it waits on.
 *
 * "Open" matches selection (`traversalBlock` in next-task.ts): any blocker
 * that is not `completed` — including an id that names no item — is open.
 */

import type { PRDItem } from "../schema/index.js";
import { collectCompletedIds } from "./next-task.js";

/** Blocker statuses and titles, built once from the full (unfiltered) tree. */
export interface DependencyIndex {
  completedIds: ReadonlySet<string>;
  titles: ReadonlyMap<string, string>;
}

export function buildDependencyIndex(items: PRDItem[]): DependencyIndex {
  const titles = new Map<string, string>();
  const walk = (list: PRDItem[]): void => {
    for (const item of list) {
      titles.set(item.id, item.title);
      if (item.children) walk(item.children);
    }
  };
  walk(items);
  return { completedIds: collectCompletedIds(items), titles };
}

/**
 * Ids of the open blockers a pending or in-progress item waits on.
 * Empty for every other status: a `blocked` item already says why.
 */
export function waitingOnIds(item: PRDItem, index: DependencyIndex): string[] {
  if (item.status !== "pending" && item.status !== "in_progress") return [];
  return (item.blockedBy ?? []).filter((dep) => !index.completedIds.has(dep));
}

/**
 * Copy of `items` in which each item with open blockers gains a `waitingOn`
 * list of their ids. Order and every existing field are unchanged.
 */
export function withWaitingOn(
  items: PRDItem[],
  index: DependencyIndex,
): Array<PRDItem & { waitingOn?: string[] }> {
  return items.map((item) => {
    const open = waitingOnIds(item, index);
    const children = item.children ? withWaitingOn(item.children, index) : undefined;
    return {
      ...item,
      ...(children ? { children } : {}),
      ...(open.length > 0 ? { waitingOn: open } : {}),
    };
  });
}

/**
 * Stable topological order of one sibling list over `blockedBy` edges
 * between those siblings. Unrelated siblings keep their input order; when a
 * cycle leaves no sibling free, the earliest remaining one is emitted next,
 * so every item appears exactly once.
 */
export function orderSiblingsByDependencies<T extends Pick<PRDItem, "id" | "blockedBy">>(
  siblings: readonly T[],
): T[] {
  const ids = new Set(siblings.map((s) => s.id));
  if (!siblings.some((s) => s.blockedBy?.some((dep) => dep !== s.id && ids.has(dep)))) {
    return [...siblings];
  }

  const remaining = [...siblings];
  const emitted = new Set<string>();
  const ordered: T[] = [];
  const ready = (s: T): boolean =>
    (s.blockedBy ?? []).every((dep) => dep === s.id || !ids.has(dep) || emitted.has(dep));

  while (remaining.length > 0) {
    const at = Math.max(0, remaining.findIndex(ready));
    const [next] = remaining.splice(at, 1);
    emitted.add(next.id);
    ordered.push(next);
  }
  return ordered;
}
