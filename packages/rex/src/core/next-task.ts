import type { PRDItem, Priority } from "../schema/index.js";
import type { TreeEntry } from "./tree.js";

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function sortByPriority(items: PRDItem[]): PRDItem[] {
  return [...items].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority ?? "medium"];
    const pb = PRIORITY_ORDER[b.priority ?? "medium"];
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });
}

export function collectCompletedIds(items: PRDItem[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: PRDItem[]): void {
    for (const item of list) {
      if (item.status === "completed") {
        ids.add(item.id);
      }
      if (item.children) {
        walk(item.children);
      }
    }
  }
  walk(items);
  return ids;
}

/**
 * Collect ALL actionable tasks flattened and sorted globally by priority.
 * Unlike findNextTask (which is depth-first per-level), this returns every
 * leaf task that is pending/in_progress with resolved dependencies.
 */
export function findActionableTasks(
  items: PRDItem[],
  completedIds: Set<string>,
  limit = 20,
): TreeEntry[] {
  const results: TreeEntry[] = [];

  function collect(list: PRDItem[], parentChain: PRDItem[]): void {
    for (const item of list) {
      if (item.status === "completed" || item.status === "deferred" || item.status === "blocked") continue;

      if (item.blockedBy && item.blockedBy.length > 0) {
        if (!item.blockedBy.every((dep) => completedIds.has(dep))) continue;
      }

      if (item.children && item.children.length > 0) {
        collect(item.children, [...parentChain, item]);

        const allChildrenDone = item.children.every(
          (c) => c.status === "completed" || c.status === "deferred",
        );
        if (allChildrenDone) {
          results.push({ item, parents: parentChain });
        }
      } else {
        results.push({ item, parents: parentChain });
      }
    }
  }

  collect(items, []);

  // Sort globally by priority (own priority first, then parent epic priority as tiebreaker)
  results.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.item.priority ?? "medium"];
    const pb = PRIORITY_ORDER[b.item.priority ?? "medium"];
    if (pa !== pb) return pa - pb;
    // Tiebreak: highest-priority ancestor
    const ancestorA = Math.min(...a.parents.map((p) => PRIORITY_ORDER[p.priority ?? "medium"]));
    const ancestorB = Math.min(...b.parents.map((p) => PRIORITY_ORDER[p.priority ?? "medium"]));
    if (ancestorA !== ancestorB) return ancestorA - ancestorB;
    return a.item.title.localeCompare(b.item.title);
  });

  return results.slice(0, limit);
}

export function findNextTask(
  items: PRDItem[],
  completedIds: Set<string>,
): TreeEntry | null {
  function search(
    list: PRDItem[],
    parentChain: PRDItem[],
  ): TreeEntry | null {
    const sorted = sortByPriority(list);
    for (const item of sorted) {
      if (item.status === "completed" || item.status === "deferred" || item.status === "blocked") {
        continue;
      }

      if (item.blockedBy && item.blockedBy.length > 0) {
        const allResolved = item.blockedBy.every((dep) =>
          completedIds.has(dep),
        );
        if (!allResolved) {
          continue;
        }
      }

      if (item.children && item.children.length > 0) {
        const childResult = search(item.children, [...parentChain, item]);
        if (childResult) {
          return childResult;
        }
      }

      const isLeaf = !item.children || item.children.length === 0;
      const allChildrenDone =
        item.children &&
        item.children.length > 0 &&
        item.children.every(
          (c) => c.status === "completed" || c.status === "deferred",
        );

      if (isLeaf || allChildrenDone) {
        return { item, parents: parentChain };
      }
    }
    return null;
  }

  return search(items, []);
}
