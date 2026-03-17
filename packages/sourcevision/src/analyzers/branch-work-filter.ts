/**
 * Branch-scoped work item filter — identifies which rex work items are
 * relevant to the current branch based on git branch metadata and work
 * item timestamps.
 *
 * ## Architecture
 *
 * Follows the same patterns as the sibling modules (`branch-work-collector`,
 * `branch-work-classifier`):
 *
 * - **Pure functions** for filtering logic (no I/O, no side effects)
 * - **Git helper** for detecting branch lifecycle metadata
 * - **Graceful degradation** when git is unavailable or timestamps are missing
 *
 * ## Filtering Strategy
 *
 * 1. Determine the branch lifecycle: creation timestamp (via `git merge-base`),
 *    branch naming pattern, and base branch.
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

import { execFileSync } from "node:child_process";
import { getCurrentBranch } from "@n-dx/llm-client";
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

/** Options for detecting the branch lifecycle. */
interface LifecycleDetectionOptions {
  /** Project root directory. */
  dir: string;
  /** Base branch to compare against. Auto-detected when omitted. */
  baseBranch?: string;
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

// ---------------------------------------------------------------------------
// Git helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Check whether this directory is inside a git repository.
 */
function isGitRepo(dir: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a git branch exists locally.
 */
function branchExists(dir: string, branch: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", branch], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-detect the base branch: prefers "main", falls back to "master".
 * Returns "main" as default when neither exists.
 */
function detectBaseBranch(dir: string): string {
  if (branchExists(dir, "main")) return "main";
  if (branchExists(dir, "master")) return "master";
  return "main";
}

/**
 * Get the merge-base commit between HEAD and the base branch.
 * Returns null if the merge-base cannot be determined.
 */
function getMergeBase(dir: string, baseBranch: string): string | null {
  try {
    const sha = execFileSync("git", ["merge-base", "HEAD", baseBranch], {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * Get the author date of a specific commit as an ISO string.
 * Returns null if the commit cannot be read.
 */
function getCommitDate(dir: string, sha: string): string | null {
  try {
    const date = execFileSync(
      "git",
      ["log", "-1", "--format=%aI", sha],
      {
        cwd: dir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
    // Validate it's a parseable date
    if (date && !Number.isNaN(new Date(date).getTime())) {
      return new Date(date).toISOString();
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Branch lifecycle detection
// ---------------------------------------------------------------------------

/**
 * Detect the lifecycle metadata for the current branch.
 *
 * Reads git metadata to determine:
 * - Current branch name
 * - Base branch (main or master)
 * - Branch creation timestamp (from merge-base commit)
 * - Branch naming pattern classification
 *
 * Gracefully handles:
 * - Non-git directories (returns lifecycle with null createdAt)
 * - Detached HEAD (returns "unknown" branch name)
 * - Missing base branch (returns null createdAt)
 *
 * @param options - Detection configuration
 * @returns Branch lifecycle metadata
 * @internal Not part of the public API — used only within this module
 */
function detectBranchLifecycle(
  options: LifecycleDetectionOptions,
): BranchLifecycle {
  const { dir } = options;

  // Non-git directory — graceful degradation
  if (!isGitRepo(dir)) {
    const branchName = "unknown";
    return {
      branchName,
      baseBranch: options.baseBranch ?? "main",
      createdAt: null,
      pattern: classifyBranchPattern(branchName),
    };
  }

  const branchName = getCurrentBranch(dir) ?? "unknown";
  const baseBranch = options.baseBranch ?? detectBaseBranch(dir);
  const pattern = classifyBranchPattern(branchName);

  // On the base branch itself — no branch creation point
  if (branchName === baseBranch || pattern === "main") {
    return { branchName, baseBranch, createdAt: null, pattern };
  }

  // Find the branch creation point via merge-base
  const mergeBaseSha = getMergeBase(dir, baseBranch);
  const createdAt = mergeBaseSha ? getCommitDate(dir, mergeBaseSha) : null;

  return { branchName, baseBranch, createdAt, pattern };
}
