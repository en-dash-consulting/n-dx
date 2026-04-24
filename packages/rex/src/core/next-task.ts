import type { PRDItem, Priority, Requirement } from "../schema/index.js";
import { PRIORITY_ORDER } from "../schema/index.js";
import type { TreeEntry } from "./tree.js";
import { walkTree, findItem } from "./tree.js";
import { extractKeywords, scoreMatch } from "./keywords.js";
import { collectRequirements } from "./requirements.js";

/** Safe ancestor priority: returns medium (2) when no parents exist. */
function bestAncestorPriority(parents: PRDItem[]): number {
  if (parents.length === 0) return PRIORITY_ORDER.medium;
  return Math.min(...parents.map((p) => PRIORITY_ORDER[p.priority ?? "medium"]));
}

// ---------------------------------------------------------------------------
// Advanced scoring helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Ratio of completed/deferred siblings to total siblings under the immediate
 * parent. Tasks in nearly-finished features score higher, encouraging
 * feature completion before starting new work.
 *
 * Returns 0 for root-level items (no parent) or only-children.
 */
export function siblingCompletionRatio(entry: TreeEntry): number {
  const parent = entry.parents[entry.parents.length - 1];
  if (!parent?.children || parent.children.length <= 1) return 0;
  // Exclude deleted siblings from both numerator and denominator
  const activeSiblings = parent.children.filter((c) => c.status !== "deleted");
  if (activeSiblings.length <= 1) return 0;
  const done = activeSiblings.filter(
    (c) => c.status === "completed" || c.status === "deferred",
  ).length;
  return done / activeSiblings.length;
}

/**
 * Count how many items in the tree list `taskId` in their `blockedBy` array.
 * Tasks that unblock more downstream work are more valuable to complete.
 */
export function countDependents(taskId: string, items: PRDItem[]): number {
  let count = 0;
  for (const { item } of walkTree(items)) {
    if (item.blockedBy && item.blockedBy.includes(taskId)) {
      count++;
    }
  }
  return count;
}

/**
 * Build a map of taskId → dependent count for all tasks that appear in any
 * blockedBy list. Pre-computed once to avoid O(n²) per comparison.
 */
function buildDependentCounts(items: PRDItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { item } of walkTree(items)) {
    if (item.blockedBy) {
      for (const dep of item.blockedBy) {
        counts.set(dep, (counts.get(dep) ?? 0) + 1);
      }
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Requirements-aware scoring
// ---------------------------------------------------------------------------

/**
 * Risk tolerance levels control how aggressively requirements influence
 * task prioritization. Higher tolerance = less priority boost from requirements.
 *
 * - `low`: critical and security requirements get strong priority boosts
 * - `medium`: balanced — requirements influence but don't dominate
 * - `high`: requirements have minimal influence on ordering
 */
export type RiskTolerance = "low" | "medium" | "high";

/**
 * Multiplier for requirements score based on risk tolerance.
 * Lower tolerance = stronger boost from requirements.
 */
const RISK_TOLERANCE_MULTIPLIER: Record<RiskTolerance, number> = {
  low: 3,
  medium: 2,
  high: 1,
};

/**
 * Compute a requirements-based priority score for a task.
 *
 * Considers:
 * - Number of requirements (own + inherited from parent chain)
 * - Highest-priority requirement attached
 * - Presence of critical-category requirements (security, performance)
 *
 * Returns a score where higher = more important. Items with no requirements
 * score 0, so this acts as a boost rather than a penalty.
 */
export function requirementsScore(
  entry: TreeEntry,
  items: PRDItem[],
  riskTolerance: RiskTolerance = "medium",
): number {
  const traced = collectRequirements(items, entry.item.id);
  if (traced.length === 0) return 0;

  let score = 0;
  const multiplier = RISK_TOLERANCE_MULTIPLIER[riskTolerance];

  for (const tr of traced) {
    const req = tr.requirement;

    // Base score: each requirement adds value
    score += 1;

    // Critical-priority requirements add more weight
    const reqPriority = req.priority ?? "medium";
    if (reqPriority === "critical") score += 3 * multiplier;
    else if (reqPriority === "high") score += 2 * multiplier;
    else if (reqPriority === "medium") score += 1;

    // Security and performance categories are inherently high-value
    if (req.category === "security") score += 2 * multiplier;
    if (req.category === "performance") score += 1 * multiplier;
  }

  return score;
}

/**
 * Options to configure task prioritization behavior.
 */
export interface PrioritizationOptions {
  /**
   * How much requirements influence task ordering.
   * Default: "medium".
   */
  riskTolerance?: RiskTolerance;
  /**
   * Restrict candidates to descendants of a specific feature.
   * When set, only tasks/subtasks under this feature ID are considered.
   */
  featureId?: string;
  /**
   * Only return tasks that have at least one tag in this list.
   * When empty or undefined, no tag filtering is applied.
   */
  tags?: string[];
}

/**
 * Create a comparator for sorting actionable tasks.
 *
 * Sort order:
 *   1. in_progress status (finish what you started)
 *   2. Own priority (critical > high > medium > low)
 *   3. Requirements score (tasks with critical/security requirements get boosted)
 *   4. Ancestor priority (highest-priority parent chain wins)
 *   5. Sibling completion ratio (nearly-done features first)
 *   6. Unblock potential (tasks that unblock more downstream work)
 *   7. Alphabetical title (stable tiebreaker)
 */
function makeComparator(
  items: PRDItem[],
  options?: PrioritizationOptions,
): (a: TreeEntry, b: TreeEntry) => number {
  const depCounts = buildDependentCounts(items);
  const riskTolerance = options?.riskTolerance ?? "medium";

  // Pre-compute requirements scores for all items to avoid repeated tree walks
  const reqScores = new Map<string, number>();
  function precomputeReqScores(list: PRDItem[], parents: PRDItem[]): void {
    for (const item of list) {
      const entry: TreeEntry = { item, parents };
      reqScores.set(item.id, requirementsScore(entry, items, riskTolerance));
      if (item.children) {
        precomputeReqScores(item.children, [...parents, item]);
      }
    }
  }
  precomputeReqScores(items, []);

  return (a: TreeEntry, b: TreeEntry): number => {
    // 1. failing/in_progress always win — retry failures and finish what you started
    const aUrgent = a.item.status === "failing" ? 0 : a.item.status === "in_progress" ? 1 : 2;
    const bUrgent = b.item.status === "failing" ? 0 : b.item.status === "in_progress" ? 1 : 2;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;

    // 2. Then by own priority
    const pa = PRIORITY_ORDER[a.item.priority ?? "medium"];
    const pb = PRIORITY_ORDER[b.item.priority ?? "medium"];
    if (pa !== pb) return pa - pb;

    // 3. Requirements score (higher = more important)
    const reqA = reqScores.get(a.item.id) ?? 0;
    const reqB = reqScores.get(b.item.id) ?? 0;
    if (reqA !== reqB) return reqB - reqA; // higher score wins

    // 4. Tiebreak: highest-priority ancestor
    const ancestorA = bestAncestorPriority(a.parents);
    const ancestorB = bestAncestorPriority(b.parents);
    if (ancestorA !== ancestorB) return ancestorA - ancestorB;

    // 5. Tiebreak: sibling completion ratio (higher = finish the feature)
    const sibA = siblingCompletionRatio(a);
    const sibB = siblingCompletionRatio(b);
    if (sibA !== sibB) return sibB - sibA; // higher ratio wins

    // 6. Tiebreak: unblock potential (more dependents = more valuable)
    const depA = depCounts.get(a.item.id) ?? 0;
    const depB = depCounts.get(b.item.id) ?? 0;
    if (depA !== depB) return depB - depA; // more dependents wins

    // 7. Stable alphabetical tiebreaker
    return a.item.title.localeCompare(b.item.title);
  };
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
      // Blocked/deleted parents are fully inactive — skip them and children.
      if (item.status === "blocked" || item.status === "deleted") continue;

      // Unresolved dependencies — skip item and children.
      if (item.blockedBy && item.blockedBy.length > 0) {
        if (!item.blockedBy.every((dep) => completedIds.has(dep))) continue;
      }

      // Always recurse into children — even for completed/deferred parents,
      // a child may be failing and need to be retried.
      if (item.children && item.children.length > 0) {
        collect(item.children, [...parentChain, item]);
      }

      // Completed/deferred items themselves aren't actionable.
      if (item.status === "completed" || item.status === "deferred") continue;

      if (item.children && item.children.length > 0) {
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
 * dependencies, sorted by: in_progress status, priority, requirements score,
 * ancestor priority, sibling completion ratio, unblock potential, then alphabetically.
 *
 * @param options.riskTolerance — Controls how much requirements influence ordering.
 */
/**
 * Resolve the subtree for a featureId filter.
 * Returns the feature's children wrapped in an array for collectActionable,
 * or null if the feature is not found or has no children.
 */
function resolveFeatureSubtree(
  items: PRDItem[],
  featureId: string,
): PRDItem[] | null {
  const entry = findItem(items, featureId);
  if (!entry) return null;
  return entry.item.children ?? [];
}

/** Filter entries to those with at least one tag in the allowed list. */
function filterByTags(entries: TreeEntry[], tags: string[]): TreeEntry[] {
  if (tags.length === 0) return entries;
  return entries.filter(
    (e) => e.item.tags && e.item.tags.some((t) => tags.includes(t)),
  );
}

export function findActionableTasks(
  items: PRDItem[],
  completedIds: Set<string>,
  limit = 20,
  options?: PrioritizationOptions,
): TreeEntry[] {
  let scope = items;
  if (options?.featureId) {
    const subtree = resolveFeatureSubtree(items, options.featureId);
    if (!subtree || subtree.length === 0) return [];
    scope = subtree;
  }
  let results = collectActionable(scope, completedIds);
  if (options?.tags?.length) {
    results = filterByTags(results, options.tags);
  }
  results.sort(makeComparator(items, options));
  return results.slice(0, limit);
}

export function findNextTask(
  items: PRDItem[],
  completedIds: Set<string>,
  options?: PrioritizationOptions,
): TreeEntry | null {
  let scope = items;
  if (options?.featureId) {
    const subtree = resolveFeatureSubtree(items, options.featureId);
    if (!subtree || subtree.length === 0) return null;
    scope = subtree;
  }
  let results = collectActionable(scope, completedIds);
  if (options?.tags?.length) {
    results = filterByTags(results, options.tags);
  }
  if (results.length === 0) return null;
  results.sort(makeComparator(items, options));
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

// ---------------------------------------------------------------------------
// Keyword-based task matching
// ---------------------------------------------------------------------------

export interface TaskMatch {
  item: PRDItem;
  parents: PRDItem[];
  score: number;
  keywords: string[];
}

/**
 * Extract searchable keywords from a PRD item.
 *
 * Combines keywords from:
 * - Title
 * - Acceptance criteria
 * - Tags
 * - Description
 *
 * Returns deduplicated, lowercased tokens with stop words removed.
 */
export function extractTaskKeywords(item: PRDItem): string[] {
  const sources: string[] = [item.title];

  if (item.acceptanceCriteria) {
    sources.push(...item.acceptanceCriteria);
  }

  if (item.description) {
    sources.push(item.description);
  }

  // Tags are kept as-is (already meaningful identifiers), but lowercased
  const tagKeywords = (item.tags ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2);

  const textKeywords = extractKeywords(sources.join(" "));

  // Deduplicate across all sources
  return [...new Set([...textKeywords, ...tagKeywords])];
}

/**
 * Find tasks matching a set of search keywords.
 *
 * Walks the full tree and scores each item against the search keywords.
 * Returns matching items sorted by score (descending), then by priority
 * (critical first).
 *
 * @param items      - The PRD item tree.
 * @param keywords   - Search keywords to match against.
 * @param minScore   - Minimum score to include (default: 1).
 * @returns Matching tasks sorted by relevance then priority.
 */
export function matchTasksByKeywords(
  items: PRDItem[],
  keywords: string[],
  minScore = 1,
): TaskMatch[] {
  const matches: TaskMatch[] = [];

  for (const { item, parents } of walkTree(items)) {
    const taskKeywords = extractTaskKeywords(item);
    const keywordsStr = taskKeywords.join(" ");
    const score = scoreMatch(keywordsStr, keywords);

    if (score >= minScore) {
      matches.push({ item, parents, score, keywords: taskKeywords });
    }
  }

  // Sort by score descending, then by priority (critical first)
  matches.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const pa = PRIORITY_ORDER[a.item.priority ?? "medium"];
    const pb = PRIORITY_ORDER[b.item.priority ?? "medium"];
    return pa - pb;
  });

  return matches;
}
