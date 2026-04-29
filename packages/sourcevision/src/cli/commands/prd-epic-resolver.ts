import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REX_DIR = ".rex";

interface PRDItemLike {
  id: string;
  title: string;
  status: string;
  level: string;
  children?: PRDItemLike[];
}

interface PRDDocumentLike {
  items?: PRDItemLike[];
}

interface LogEntryLike {
  timestamp?: string;
  itemId?: string;
  branch?: string;
  branchName?: string;
  gitBranch?: string;
  context?: {
    branch?: string;
  };
  git?: {
    branch?: string;
  };
  metadata?: {
    branch?: string;
  };
  [key: string]: unknown;
}

interface IndexedNode {
  id: string;
  title: string;
  status: string;
  level: string;
  parentId?: string;
}

function runGit(projectDir: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function readJSONFile<T>(path: string): T | null {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Read the PRD document, preferring `.rex/prd.md` (current source of truth)
 * and falling back to `.rex/prd.json` for legacy projects. Markdown is parsed
 * by spawning `rex parse-md --stdin` so we never import rex at the code level.
 */
function readPRDDocument(projectDir: string): PRDDocumentLike | null {
  const mdPath = join(projectDir, REX_DIR, "prd.md");
  const jsonPath = join(projectDir, REX_DIR, "prd.json");

  try {
    const md = readFileSync(mdPath, "utf-8");
    if (md.trim().startsWith("---")) {
      try {
        const out = execFileSync("rex", ["parse-md", "--stdin"], {
          input: md,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        return JSON.parse(out) as PRDDocumentLike;
      } catch {
        // fall through to JSON
      }
    }
  } catch {
    // prd.md not readable — fall back to JSON
  }

  return readJSONFile<PRDDocumentLike>(jsonPath);
}

function readJSONLFile<T>(path: string): T[] {
  try {
    const raw = readFileSync(path, "utf-8");
    if (!raw.trim()) return [];

    const parsed: T[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        parsed.push(JSON.parse(trimmed) as T);
      } catch {
        // Ignore malformed JSONL lines.
      }
    }
    return parsed;
  } catch {
    return [];
  }
}

function indexPRDItems(
  items: readonly PRDItemLike[],
  parentId: string | undefined,
  byId: Map<string, IndexedNode>,
): void {
  for (const item of items) {
    byId.set(item.id, {
      id: item.id,
      title: item.title,
      status: item.status,
      level: item.level,
      parentId,
    });
    if (item.children && item.children.length > 0) {
      indexPRDItems(item.children, item.id, byId);
    }
  }
}

function findParentEpicTitle(itemId: string, byId: Map<string, IndexedNode>): string | null {
  let current = byId.get(itemId);
  while (current) {
    if (current.level === "epic") {
      if (current.status === "deleted") return null;
      return current.title;
    }
    if (!current.parentId) return null;
    current = byId.get(current.parentId);
  }
  return null;
}

function findParentFeatureTitle(itemId: string, byId: Map<string, IndexedNode>): string | null {
  let current = byId.get(itemId);
  while (current) {
    if (current.level === "feature") {
      if (current.status === "deleted") return null;
      return current.title;
    }
    if (!current.parentId) return null;
    current = byId.get(current.parentId);
  }
  return null;
}

function resolveEntryBranch(entry: LogEntryLike): string | null {
  const candidate =
    (typeof entry.branch === "string" ? entry.branch : null)
    ?? (typeof entry.branchName === "string" ? entry.branchName : null)
    ?? (typeof entry.gitBranch === "string" ? entry.gitBranch : null)
    ?? (typeof entry.context?.branch === "string" ? entry.context.branch : null)
    ?? (typeof entry.git?.branch === "string" ? entry.git.branch : null)
    ?? (typeof entry.metadata?.branch === "string" ? entry.metadata.branch : null);
  if (!candidate) return null;
  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveCurrentBranch(projectDir: string): string | null {
  const branch = runGit(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") return null;
  return branch;
}

export interface ResolvedRexWorkItem {
  id: string;
  level: "task" | "subtask";
  title: string;
  status: string;
  executionState: "completed" | "executed";
  epicTitle: string;
  featureTitle: string | null;
}

export type ResolvedBranchScopedRexWork =
  | {
    status: "found";
    epicTitles: string[];
    completedItems: ResolvedRexWorkItem[];
  }
  | {
    status: "empty";
    signal: "no_branch_scoped_completed_rex_items";
    epicTitles: [];
    completedItems: [];
  };

export function resolveBranchScopedCompletedRexWorkFromData(
  prdItems: readonly PRDItemLike[],
  logEntries: readonly LogEntryLike[],
  currentBranch: string,
): ResolvedBranchScopedRexWork {
  const branch = currentBranch.trim();
  if (branch.length === 0) {
    return {
      status: "empty",
      signal: "no_branch_scoped_completed_rex_items",
      epicTitles: [],
      completedItems: [],
    };
  }

  const byId = new Map<string, IndexedNode>();
  indexPRDItems(prdItems, undefined, byId);

  const touchedIds = new Set<string>();
  const epicTitles = new Set<string>();
  const completedItemsById = new Map<string, ResolvedRexWorkItem>();

  for (const entry of logEntries) {
    if (!entry.itemId) continue;
    const entryBranch = resolveEntryBranch(entry);
    if (entryBranch !== branch) continue;
    touchedIds.add(entry.itemId);
  }

  for (const itemId of touchedIds) {
    const item = byId.get(itemId);
    if (!item) continue;

    if (item.status === "deleted") continue;
    if (item.level !== "task" && item.level !== "subtask") continue;

    const epicTitle = findParentEpicTitle(item.id, byId);
    if (!epicTitle) continue;
    const featureTitle = findParentFeatureTitle(item.id, byId);
    epicTitles.add(epicTitle);
    completedItemsById.set(item.id, {
      id: item.id,
      level: item.level as "task" | "subtask",
      title: item.title,
      status: item.status,
      executionState: item.status === "completed" ? "completed" : "executed",
      epicTitle,
      featureTitle,
    });
  }

  const sortedEpicTitles = [...epicTitles].sort((a, b) => a.localeCompare(b));
  const completedItems = [...completedItemsById.values()].sort((a, b) => {
    if (a.epicTitle !== b.epicTitle) return a.epicTitle.localeCompare(b.epicTitle);
    if (a.featureTitle !== b.featureTitle) return (a.featureTitle ?? "").localeCompare(b.featureTitle ?? "");
    if (a.level !== b.level) return a.level.localeCompare(b.level);
    return a.title.localeCompare(b.title);
  });

  if (completedItems.length === 0) {
    return {
      status: "empty",
      signal: "no_branch_scoped_completed_rex_items",
      epicTitles: [],
      completedItems: [],
    };
  }

  return {
    status: "found",
    epicTitles: sortedEpicTitles,
    completedItems,
  };
}

function parseBaseRef(comparisonRange: string): string | null {
  const idx = comparisonRange.indexOf("...");
  if (idx <= 0) return null;
  const ref = comparisonRange.slice(0, idx).trim();
  return ref.length > 0 ? ref : null;
}

/** @internal Not part of the public API — unused wrapper kept for potential future CLI use. */
function resolveWorkedEpicTitlesForRange(projectDir: string, comparisonRange: string): ResolvedBranchScopedRexWork {
  const baseRef = parseBaseRef(comparisonRange);
  if (!baseRef) {
    return {
      status: "empty",
      signal: "no_branch_scoped_completed_rex_items",
      epicTitles: [],
      completedItems: [],
    };
  }
  const currentBranch = resolveCurrentBranch(projectDir);
  if (!currentBranch) {
    return {
      status: "empty",
      signal: "no_branch_scoped_completed_rex_items",
      epicTitles: [],
      completedItems: [],
    };
  }

  const logPath = join(projectDir, REX_DIR, "execution-log.jsonl");
  const prd = readPRDDocument(projectDir);
  if (!prd?.items) {
    return {
      status: "empty",
      signal: "no_branch_scoped_completed_rex_items",
      epicTitles: [],
      completedItems: [],
    };
  }

  const logs = readJSONLFile<LogEntryLike>(logPath);
  return resolveBranchScopedCompletedRexWorkFromData(prd.items, logs, currentBranch);
}
