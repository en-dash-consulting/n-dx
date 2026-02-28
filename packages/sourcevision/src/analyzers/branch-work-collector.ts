/**
 * Branch work collector — identifies completed rex PRD items on the current branch.
 *
 * ## Architecture
 *
 * Sourcevision and rex are peer domain packages that **never import each other
 * at runtime**. This module reads `.rex/prd.json` directly from the filesystem
 * (and from git history) using lightweight local type definitions that mirror
 * the rex PRDItem shape. No `import from "rex"` exists here.
 *
 * ## Algorithm
 *
 * 1. Read the current PRD from `.rex/prd.json` on disk.
 * 2. Detect the base branch (main or master) and read its PRD via `git show`.
 * 3. Diff: completed IDs on current branch minus completed IDs on base branch.
 * 4. Build enriched work items with parent chain and epic summaries.
 *
 * When git is unavailable (non-repo directory), all completed items in the
 * current PRD are returned — the service degrades gracefully rather than
 * failing.
 *
 * @module sourcevision/analyzers/branch-work-collector
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { getCurrentBranch, PROJECT_DIRS } from "@n-dx/llm-client";

// ---------------------------------------------------------------------------
// Lightweight PRD types (mirrors rex schema — no runtime import from rex)
// ---------------------------------------------------------------------------

/** Minimal PRDItem shape needed for collection. */
interface PRDItemShape {
  id: string;
  title: string;
  status: string;
  level: string;
  description?: string;
  acceptanceCriteria?: string[];
  completedAt?: string;
  priority?: string;
  tags?: string[];
  children?: PRDItemShape[];
}

/** Minimal PRDDocument shape. */
interface PRDDocumentShape {
  schema: string;
  title: string;
  items: PRDItemShape[];
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Reference to an ancestor in the PRD hierarchy. */
export interface ParentRef {
  id: string;
  title: string;
  level: string;
}

/** A completed work item attributed to the current branch. */
export interface BranchWorkItem {
  id: string;
  title: string;
  level: string;
  completedAt?: string;
  priority?: string;
  tags?: string[];
  description?: string;
  acceptanceCriteria?: string[];
  parentChain: ParentRef[];
}

/** Per-epic summary of branch work. */
export interface EpicSummary {
  id: string;
  title: string;
  completedCount: number;
}

/** Full result from the collector. */
export interface BranchWorkResult {
  /** Current branch name (or "unknown" when git is unavailable). */
  branch: string;
  /** Base branch used for diffing (e.g. "main", "master"). */
  baseBranch: string;
  /** ISO timestamp when the collection was performed. */
  collectedAt: string;
  /** Completed work items unique to this branch. */
  items: BranchWorkItem[];
  /** Per-epic aggregation of branch-specific completions. */
  epicSummaries?: EpicSummary[];
  /** Non-fatal errors encountered during collection. */
  errors?: string[];
}

/** Options for the collector. */
export interface CollectorOptions {
  /** Project root directory. */
  dir: string;
  /** Base branch to diff against. Auto-detected when omitted. */
  baseBranch?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string into a PRD document shape.
 * Returns null if the input is empty, malformed, or lacks an `items` array.
 */
export function parsePRDDocument(raw: string): PRDDocumentShape | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed as PRDDocumentShape;
  } catch {
    return null;
  }
}

/**
 * Walk the PRD tree and collect IDs of completed items.
 */
function collectCompletedIds(items: PRDItemShape[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: PRDItemShape[]): void {
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
 * Compute the set of item IDs completed on the current branch but not on the base.
 *
 * @param currentItems - PRD items from the current branch
 * @param baseItems    - PRD items from the base branch (empty array if unavailable)
 * @returns Set of item IDs uniquely completed on the current branch
 */
export function diffCompletedItems(
  currentItems: PRDItemShape[],
  baseItems: PRDItemShape[],
): Set<string> {
  const currentCompleted = collectCompletedIds(currentItems);
  const baseCompleted = collectCompletedIds(baseItems);

  const branchSpecific = new Set<string>();
  for (const id of currentCompleted) {
    if (!baseCompleted.has(id)) {
      branchSpecific.add(id);
    }
  }
  return branchSpecific;
}

/**
 * Build enriched BranchWorkItem records for the given set of IDs.
 * Traverses the full tree to reconstruct parent chains.
 *
 * @param items     - Full PRD item tree
 * @param branchIds - Set of IDs to include in the result
 */
export function buildBranchWorkItems(
  items: PRDItemShape[],
  branchIds: Set<string>,
): BranchWorkItem[] {
  if (branchIds.size === 0) return [];

  const result: BranchWorkItem[] = [];

  function walk(list: PRDItemShape[], parents: ParentRef[]): void {
    for (const item of list) {
      if (branchIds.has(item.id)) {
        result.push({
          id: item.id,
          title: item.title,
          level: item.level,
          ...(item.completedAt !== undefined && { completedAt: item.completedAt }),
          ...(item.priority !== undefined && { priority: item.priority }),
          ...(item.tags !== undefined && { tags: item.tags }),
          ...(item.description !== undefined && { description: item.description }),
          ...(item.acceptanceCriteria !== undefined && { acceptanceCriteria: item.acceptanceCriteria }),
          parentChain: [...parents],
        });
      }

      if (item.children) {
        walk(item.children, [
          ...parents,
          { id: item.id, title: item.title, level: item.level },
        ]);
      }
    }
  }

  walk(items, []);
  return result;
}

// ---------------------------------------------------------------------------
// Git helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Read a file from a specific git ref.
 * Returns null if the file doesn't exist on that ref or git fails.
 */
function gitShowFile(dir: string, ref: string, filePath: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${filePath}`], {
      cwd: dir,
      encoding: "utf-8",
      // Suppress stderr for expected failures (file not found on ref)
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return null;
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
 * Detect whether this directory is inside a git repository.
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
 * Auto-detect the base branch: prefers "main", falls back to "master".
 * Returns "main" as default when neither exists (covers first-ever branch).
 */
function detectBaseBranch(dir: string): string {
  if (branchExists(dir, "main")) return "main";
  if (branchExists(dir, "master")) return "master";
  return "main";
}

// ---------------------------------------------------------------------------
// Epic summary builder
// ---------------------------------------------------------------------------

/**
 * Build per-epic summaries for branch-specific completed items.
 * Groups items by their top-level epic ancestor.
 */
function buildEpicSummaries(
  items: PRDItemShape[],
  branchIds: Set<string>,
): EpicSummary[] {
  const summaryMap = new Map<string, { title: string; count: number }>();

  function countInSubtree(item: PRDItemShape, epicId: string, epicTitle: string): void {
    if (branchIds.has(item.id) && item.level !== "epic") {
      const existing = summaryMap.get(epicId);
      if (existing) {
        existing.count++;
      } else {
        summaryMap.set(epicId, { title: epicTitle, count: 1 });
      }
    }
    if (item.children) {
      for (const child of item.children) {
        countInSubtree(child, epicId, epicTitle);
      }
    }
  }

  for (const item of items) {
    if (item.level === "epic") {
      countInSubtree(item, item.id, item.title);
    }
  }

  return Array.from(summaryMap.entries()).map(([id, { title, count }]) => ({
    id,
    title,
    completedCount: count,
  }));
}

// ---------------------------------------------------------------------------
// Main collector
// ---------------------------------------------------------------------------

/**
 * Collect completed work items on the current branch that are not
 * present on the base branch.
 *
 * Gracefully handles:
 * - Non-git directories (returns all completed items)
 * - Missing `.rex/prd.json` (returns empty result)
 * - Corrupted PRD JSON (returns empty result with error)
 * - Missing base branch (falls back to treating all completions as branch work)
 */
export async function collectBranchWork(
  options: CollectorOptions,
): Promise<BranchWorkResult> {
  const dir = resolve(options.dir);
  const errors: string[] = [];
  const now = new Date().toISOString();

  // ── 1. Determine branch context ──────────────────────────────

  const gitAvailable = isGitRepo(dir);
  const branch = gitAvailable ? (getCurrentBranch(dir) ?? "unknown") : "unknown";

  const baseBranch = options.baseBranch ?? (gitAvailable ? detectBaseBranch(dir) : "main");

  // ── 2. Read current PRD from disk ────────────────────────────

  const prdPath = join(dir, PROJECT_DIRS.REX, "prd.json");
  let currentDoc: PRDDocumentShape | null = null;

  if (existsSync(prdPath)) {
    try {
      const raw = readFileSync(prdPath, "utf-8");
      currentDoc = parsePRDDocument(raw);
      if (!currentDoc) {
        errors.push("Current PRD file exists but could not be parsed");
      }
    } catch (err) {
      errors.push(`Failed to read current PRD: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!currentDoc) {
    return {
      branch,
      baseBranch,
      collectedAt: now,
      items: [],
      ...(errors.length > 0 && { errors }),
    };
  }

  // ── 3. Read base branch PRD from git history ─────────────────

  let baseDoc: PRDDocumentShape | null = null;

  if (gitAvailable && branch !== baseBranch) {
    const rexRelPath = `${PROJECT_DIRS.REX}/prd.json`;
    const baseRaw = gitShowFile(dir, baseBranch, rexRelPath);

    if (baseRaw) {
      baseDoc = parsePRDDocument(baseRaw);
      if (!baseDoc) {
        errors.push(`Base branch PRD (${baseBranch}) exists but could not be parsed`);
      }
    }
    // If baseRaw is null, the file doesn't exist on base — that's fine,
    // all current completions are considered branch work.
  } else if (gitAvailable && branch === baseBranch) {
    // Running on the base branch itself — diff against itself yields nothing
    return {
      branch,
      baseBranch,
      collectedAt: now,
      items: [],
    };
  }

  // ── 4. Diff completed items ──────────────────────────────────

  const baseItems = baseDoc?.items ?? [];
  const branchIds = diffCompletedItems(currentDoc.items, baseItems);

  // ── 5. Build enriched results ────────────────────────────────

  const items = buildBranchWorkItems(currentDoc.items, branchIds);
  const epicSummaries = buildEpicSummaries(currentDoc.items, branchIds);

  return {
    branch,
    baseBranch,
    collectedAt: now,
    items,
    ...(epicSummaries.length > 0 && { epicSummaries }),
    ...(errors.length > 0 && { errors }),
  };
}
