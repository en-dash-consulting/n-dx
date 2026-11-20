/**
 * Branch-scoped work item filter — identifies which rex work items are
 * relevant to a branch, given its lifecycle metadata and the work items'
 * timestamps.
 *
 * ## Architecture
 *
 * Follows the same patterns as the sibling modules (`branch-work-collector`,
 * `branch-work-classifier`):
 *
 * - **Pure functions** for filtering logic (no I/O, no side effects)
 * - **Graceful degradation** when the branch creation time or an item's
 *   timestamp is missing
 *
 * ## Filtering Strategy
 *
 * 1. The caller supplies the branch lifecycle: creation timestamp (the
 *    merge-base with the base branch), branch naming pattern, and base branch.
 * 2. Filter work items by timestamp: only items completed *on or after* the
 *    branch creation time are considered relevant to the branch.
 * 3. Exclude items when on main/master (no branch work on the base branch).
 * 4. When the branch creation timestamp is unavailable, include all items
 *    (graceful degradation).
 *
 * ## Branch pattern support
 *
 * Recognizes standard Git Flow and trunk-based patterns:
 * - `feature/`, `feat/` → feature
 * - `hotfix/` → hotfix
 * - `bugfix/`, `fix/` → bugfix
 * - `release/` → release
 * - `main`, `master` → main
 *
 * @module sourcevision/analyzers/branch-work-filter
 */

import type { BranchWorkRecordItem } from "../schema/v1.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Recognized branch naming patterns. */
export type BranchPattern =
  | "feature"
  | "hotfix"
  | "bugfix"
  | "release"
  | "main"
  | "other";

/** Metadata about the current branch's lifecycle. */
export interface BranchLifecycle {
  /** Current branch name. */
  branchName: string;
  /** Base branch used for comparison (e.g. "main", "master"). */
  baseBranch: string;
  /**
   * ISO timestamp of the branch creation point (merge-base with the base
   * branch). Null when git is unavailable or the merge-base cannot be
   * determined.
   */
  createdAt: string | null;
  /** Classified branch naming pattern. */
  pattern: BranchPattern;
}

/** Why an item was excluded from branch-scoped results. */
export type ExclusionReason =
  | "before_branch_creation"
  | "on_main_branch"
  | "invalid_timestamp";

/** An excluded item with the reason for exclusion. */
export interface ExcludedItem {
  /** PRD item ID. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Why this item was excluded. */
  reason: ExclusionReason;
}

/** Result of filtering work items by branch scope. */
export interface BranchFilterResult {
  /** Items that fall within the branch lifecycle. */
  included: BranchWorkRecordItem[];
  /** Items excluded from the branch scope with reasons. */
  excluded: ExcludedItem[];
  /** Branch lifecycle metadata used for filtering. */
  lifecycle: BranchLifecycle;
}

// ---------------------------------------------------------------------------
// Branch pattern classification
// ---------------------------------------------------------------------------

/**
 * Classify a branch name into a recognized pattern.
 *
 * Case-insensitive matching against common Git Flow and trunk-based
 * conventions.
 *
 * @param branchName - Git branch name (e.g. "feature/add-auth")
 * @returns The classified pattern
 */
export function classifyBranchPattern(branchName: string): BranchPattern {
  if (!branchName) return "other";

  const lower = branchName.toLowerCase();

  // Main/master branches
  if (lower === "main" || lower === "master") return "main";

  // Feature branches: feature/, feat/
  if (/^feat(?:ure)?[/-]/.test(lower)) return "feature";

  // Hotfix branches: hotfix/
  if (/^hotfix[/-]/.test(lower)) return "hotfix";

  // Bugfix branches: bugfix/, fix/
  if (/^(?:bug)?fix[/-]/.test(lower)) return "bugfix";

  // Release branches: release/
  if (/^release[/-]/.test(lower)) return "release";

  return "other";
}

// ---------------------------------------------------------------------------
// Timestamp comparison
// ---------------------------------------------------------------------------

/**
 * Determine whether a work item's completion timestamp falls within the
 * branch lifecycle (on or after branch creation).
 *
 * Graceful degradation:
 * - When `branchCreatedAt` is null or invalid → returns true (include the item)
 * - When `completedAt` is empty or invalid → returns false (exclude the item)
 *
 * @param completedAt      - ISO timestamp of item completion
 * @param branchCreatedAt  - ISO timestamp of branch creation (null if unknown)
 */
export function isWithinBranchLifecycle(
  completedAt: string,
  branchCreatedAt: string | null,
): boolean {
  // No branch creation info — include everything (graceful degradation)
  if (branchCreatedAt === null) return true;

  // Invalid or empty completedAt — exclude
  if (!completedAt) return false;

  const completedMs = new Date(completedAt).getTime();
  if (Number.isNaN(completedMs)) return false;

  // Invalid branchCreatedAt — include everything (graceful degradation)
  const createdMs = new Date(branchCreatedAt).getTime();
  if (Number.isNaN(createdMs)) return true;

  // Item must be completed on or after the branch creation point
  return completedMs >= createdMs;
}

// ---------------------------------------------------------------------------
// Core filter
// ---------------------------------------------------------------------------

/**
 * Filter work items to only those relevant to the given branch lifecycle.
 *
 * Pure function — no I/O, no side effects. Does not mutate input arrays.
 *
 * Rules:
 * 1. If the branch pattern is "main", all items are excluded (no branch work
 *    on the base branch itself).
 * 2. Items with completedAt on or after the branch creation are included.
 * 3. Items with completedAt before branch creation are excluded.
 * 4. Items with invalid timestamps are excluded.
 * 5. When branch creation time is unknown, all items are included.
 *
 * @param items     - Work items to filter
 * @param lifecycle - Branch lifecycle metadata
 */
export function filterItemsByBranchScope(
  items: readonly BranchWorkRecordItem[],
  lifecycle: BranchLifecycle,
): BranchFilterResult {
  const included: BranchWorkRecordItem[] = [];
  const excluded: ExcludedItem[] = [];

  // Main branch: no branch-scoped work
  if (lifecycle.pattern === "main") {
    for (const item of items) {
      excluded.push({
        id: item.id,
        title: item.title,
        reason: "on_main_branch",
      });
    }
    return { included, excluded, lifecycle };
  }

  for (const item of items) {
    // Validate the completedAt timestamp first
    if (!item.completedAt || Number.isNaN(new Date(item.completedAt).getTime())) {
      excluded.push({
        id: item.id,
        title: item.title,
        reason: "invalid_timestamp",
      });
      continue;
    }

    if (isWithinBranchLifecycle(item.completedAt, lifecycle.createdAt)) {
      included.push(item);
    } else {
      excluded.push({
        id: item.id,
        title: item.title,
        reason: "before_branch_creation",
      });
    }
  }

  return { included, excluded, lifecycle };
}
