import type { PRDItem, Priority } from "../schema/index.js";
import type { TreeEntry } from "./tree.js";
import { walkTree } from "./tree.js";

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Safe ancestor priority: returns medium (2) when no parents exist. */
function bestAncestorPriority(parents: PRDItem[]): number {
  if (parents.length === 0) return PRIORITY_ORDER.medium;
  return Math.min(...parents.map((p) => PRIORITY_ORDER[p.priority ?? "medium"]));
}

/** Shared comparator for sorting actionable tasks. */
function compareEntries(a: TreeEntry, b: TreeEntry): number {
  // in_progress always wins — finish what you started
  const aInProgress = a.item.status === "in_progress" ? 0 : 1;
  const bInProgress = b.item.status === "in_progress" ? 0 : 1;
  if (aInProgress !== bInProgress) return aInProgress - bInProgress;

  // Then by own priority
  const pa = PRIORITY_ORDER[a.item.priority ?? "medium"];
  const pb = PRIORITY_ORDER[b.item.priority ?? "medium"];
  if (pa !== pb) return pa - pb;

  // Tiebreak: highest-priority ancestor
  const ancestorA = bestAncestorPriority(a.parents);
  const ancestorB = bestAncestorPriority(b.parents);
  if (ancestorA !== ancestorB) return ancestorA - ancestorB;

  return a.item.title.localeCompare(b.item.title);
}

export interface SelectionExplanation {
  /** Human-readable summary of why this task was selected. */
  summary: string;
  /** Priority reasoning. */
  priority: {
    itemPriority: Priority;
    /** Number of higher-priority items that exist but aren't actionable. */
    higherPriorityBlocked: number;
  };
  /** Dependency status for the selected item. */
  dependencies: {
    status: "none" | "resolved";
    resolvedBlockers: string[];
  };
  /** Breadcrumb path through the tree to reach this item. */
  traversalPath: string[];
  /** Summary of items considered but skipped. */
  skipped: {
    completed: number;
    deferred: number;
    blocked: number;
    unresolvedDeps: number;
    /** In-progress items that weren't selected (lost tiebreak). */
    inProgress: number;
    /** Actionable items skipped because a higher-priority item was chosen. */
    actionable: number;
    total: number;
  };
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
 * Collect actionable candidates from the tree.
 * Returns every leaf task (or parent with all children done) that is
 * pending/in_progress with all dependencies resolved.
 */
function collectActionable(
  items: PRDItem[],
  completedIds: Set<string>,
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
  return results;
}

/**
 * Collect ALL actionable tasks flattened and sorted globally by priority.
 * Returns every leaf task that is pending/in_progress with resolved
 * dependencies, sorted: in_progress first, then by priority, then by
 * ancestor priority, then alphabetically.
 */
export function findActionableTasks(
  items: PRDItem[],
  completedIds: Set<string>,
  limit = 20,
): TreeEntry[] {
  const results = collectActionable(items, completedIds);
  results.sort(compareEntries);
  return results.slice(0, limit);
}

export function findNextTask(
  items: PRDItem[],
  completedIds: Set<string>,
): TreeEntry | null {
  const results = collectActionable(items, completedIds);
  if (results.length === 0) return null;
  results.sort(compareEntries);
  return results[0];
}

/** Check if an item is a leaf (no children or empty children array). */
function isLeaf(item: PRDItem): boolean {
  return !item.children || item.children.length === 0;
}

/**
 * Explain why a particular task was selected by findNextTask.
 * Walks the full tree to gather skip counts, dependency info, and priority context.
 * Only counts leaf-level items (and parents whose children are all done) to avoid
 * inflating skip counts with intermediate branch nodes.
 */
export function explainSelection(
  items: PRDItem[],
  selected: TreeEntry,
  completedIds: Set<string>,
): SelectionExplanation {
  const skipped = {
    completed: 0,
    deferred: 0,
    blocked: 0,
    unresolvedDeps: 0,
    inProgress: 0,
    actionable: 0,
    total: 0,
  };
  const selectedPriority = PRIORITY_ORDER[selected.item.priority ?? "medium"];
  let higherPriorityBlocked = 0;

  // Build the set of actionable candidates for accurate actionable/inProgress counts
  const actionableSet = new Set(
    collectActionable(items, completedIds).map((e) => e.item.id),
  );

  // Walk the tree, but only count leaves and parents-with-all-children-done
  for (const { item } of walkTree(items)) {
    if (item.id === selected.item.id) continue;

    // Skip intermediate branch nodes — only count leaves and finalize-ready parents
    if (!isLeaf(item)) {
      const allChildrenDone = item.children!.every(
        (c) => c.status === "completed" || c.status === "deferred",
      );
      if (!allChildrenDone) continue; // branch with active children — don't count
    }

    if (item.status === "completed") {
      skipped.completed++;
      skipped.total++;
    } else if (item.status === "deferred") {
      skipped.deferred++;
      skipped.total++;
    } else if (item.status === "blocked") {
      skipped.blocked++;
      skipped.total++;
      if (PRIORITY_ORDER[item.priority ?? "medium"] < selectedPriority) {
        higherPriorityBlocked++;
      }
    } else if (
      item.blockedBy &&
      item.blockedBy.length > 0 &&
      !item.blockedBy.every((dep) => completedIds.has(dep))
    ) {
      skipped.unresolvedDeps++;
      skipped.total++;
      if (PRIORITY_ORDER[item.priority ?? "medium"] < selectedPriority) {
        higherPriorityBlocked++;
      }
    } else if (actionableSet.has(item.id)) {
      // Item is actionable but wasn't selected
      if (item.status === "in_progress") {
        skipped.inProgress++;
      } else {
        skipped.actionable++;
      }
      skipped.total++;
    }
  }

  // Dependency info for the selected item
  const resolvedBlockers = (selected.item.blockedBy ?? []).filter((dep) =>
    completedIds.has(dep),
  );
  const depStatus: SelectionExplanation["dependencies"] =
    selected.item.blockedBy && selected.item.blockedBy.length > 0
      ? { status: "resolved", resolvedBlockers }
      : { status: "none", resolvedBlockers: [] };

  const traversalPath = selected.parents.map((p) => p.title);
  const itemPriority: Priority = selected.item.priority ?? "medium";

  // Build human-readable summary
  const summaryParts: string[] = [];

  // Status context
  if (selected.item.status === "in_progress") {
    summaryParts.push(`"${selected.item.title}" is already in_progress`);
  } else {
    // Check if this is a parent with all children done
    const allChildrenDone =
      selected.item.children &&
      selected.item.children.length > 0 &&
      selected.item.children.every(
        (c) => c.status === "completed" || c.status === "deferred",
      );
    if (allChildrenDone) {
      summaryParts.push(
        `"${selected.item.title}" — all children completed, ready to finalize`,
      );
    } else {
      summaryParts.push(
        `"${selected.item.title}" selected at ${itemPriority} priority`,
      );
    }
  }

  // Traversal context
  if (traversalPath.length > 0) {
    summaryParts.push(`via ${traversalPath.join(" → ")}`);
  }

  // Dependency context
  if (depStatus.status === "resolved") {
    summaryParts.push(
      `(${resolvedBlockers.length} blocker${resolvedBlockers.length === 1 ? "" : "s"} resolved)`,
    );
  }

  // Higher-priority blocked context
  if (higherPriorityBlocked > 0) {
    summaryParts.push(
      `(${higherPriorityBlocked} higher-priority item${higherPriorityBlocked === 1 ? "" : "s"} blocked)`,
    );
  }

  return {
    summary: summaryParts.join(" "),
    priority: {
      itemPriority,
      higherPriorityBlocked,
    },
    dependencies: depStatus,
    traversalPath,
    skipped,
  };
}
