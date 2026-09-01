/**
 * Post-merge structural validation of the PRD folder tree.
 *
 * A git merge of `.rex/prd_tree/` can leave corruption no ordinary rex code
 * path produces — both branches adding the same item at different paths,
 * conflict resolutions deleting an `index.md` but not its directory, files
 * landing at the wrong depth, references to items the other branch deleted,
 * or unresolved conflict markers. None of it errors on its own: the parser
 * tolerates what it can and the rest survives silently.
 *
 * This module scans the RAW tree (filesystem walk + lightweight frontmatter
 * reads), deliberately not the store: a corrupt tree is exactly the input the
 * parser may normalize, choke on, or silently repair, and the point here is
 * to see the corruption, not the parser's best guess.
 *
 * Corruption classes and their repair policy:
 *
 * | class               | meaning                                        | repair |
 * |---------------------|------------------------------------------------|--------|
 * | conflict-markers    | unresolved `<<<<<<<` blocks in a file          | refused — a human owns conflict resolution |
 * | duplicate-id        | one item id at two or more paths               | refused — which copy wins is ambiguous |
 * | orphaned-directory  | a directory with no `index.md`                 | removed when empty of items; refused when items remain inside |
 * | level-mismatch      | frontmatter `level` disagrees with nesting     | rewritten to the depth-implied level |
 * | dangling-blocked-by | `blockedBy` id that exists nowhere in the tree | dangling ids dropped, valid ones kept |
 *
 * @module rex/core/post-merge-validate
 */

import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// ── Public types ──────────────────────────────────────────────────────────────

export type PostMergeIssueClass =
  | "conflict-markers"
  | "duplicate-id"
  | "orphaned-directory"
  | "level-mismatch"
  | "dangling-blocked-by";

export interface PostMergeIssue {
  class: PostMergeIssueClass;
  /** Path relative to the tree root (the directory itself for orphaned dirs). */
  path: string;
  /** Item id, where one could be read. */
  itemId?: string;
  /** Human-readable description including everything needed to act. */
  message: string;
  /** Whether `repairPostMergeIssues` can fix this deterministically. */
  repairable: boolean;
  /** Repair payload — interpretation depends on the class. */
  detail?: string[];
}

export interface PostMergeReport {
  issues: PostMergeIssue[];
  /** How many markdown files the scan covered. */
  scannedFiles: number;
}

// ── Detection ─────────────────────────────────────────────────────────────────

interface ScannedEntry {
  /** Path relative to treeRoot of the markdown file. */
  relPath: string;
  /** Item depth: 1 for a root-level item, matching the parser's convention. */
  depth: number;
  id?: string;
  level?: string;
  blockedBy: string[];
  hasConflictMarkers: boolean;
}

const CONFLICT_MARKERS = /^(<{7} |={7}$|>{7} )/m;
const LEVELS_BY_DEPTH: Record<number, string> = { 1: "epic", 2: "feature", 3: "task" };
const VALID_LEVELS = new Set(["epic", "feature", "task", "subtask"]);

/** The level nesting depth implies: epic/feature/task, then subtask all the way down. */
function depthImpliedLevel(depth: number): string {
  return LEVELS_BY_DEPTH[depth] ?? "subtask";
}

/**
 * Scan the tree at `treeRoot` for post-merge corruption.
 * A missing tree root yields an empty report — nothing to validate is not an error.
 */
export async function detectPostMergeIssues(treeRoot: string): Promise<PostMergeReport> {
  const entries: ScannedEntry[] = [];
  const issues: PostMergeIssue[] = [];

  await walk(treeRoot, treeRoot, entries, issues);

  // Per-file classes were collected during the walk; cross-file classes need
  // the complete id census.
  const byId = new Map<string, ScannedEntry[]>();
  for (const entry of entries) {
    if (!entry.id) continue;
    const list = byId.get(entry.id) ?? [];
    list.push(entry);
    byId.set(entry.id, list);
  }

  for (const [id, holders] of byId) {
    if (holders.length < 2) continue;
    issues.push({
      class: "duplicate-id",
      path: holders[0].relPath,
      itemId: id,
      message:
        `id ${id} appears at ${holders.length} paths: ${holders.map((h) => h.relPath).join(", ")} — ` +
        `two branches created or moved the same item; keep one and delete the rest by hand`,
      repairable: false,
    });
  }

  for (const entry of entries) {
    const dangling = entry.blockedBy.filter((ref) => !byId.has(ref));
    if (dangling.length === 0) continue;
    issues.push({
      class: "dangling-blocked-by",
      path: entry.relPath,
      itemId: entry.id,
      message: `blockedBy references item${dangling.length === 1 ? "" : "s"} that exist nowhere in the tree: ${dangling.join(", ")}`,
      repairable: true,
      detail: dangling,
    });
  }

  issues.sort((a, b) => a.path.localeCompare(b.path) || a.class.localeCompare(b.class));
  return { issues, scannedFiles: entries.length };
}

async function walk(
  dir: string,
  treeRoot: string,
  entries: ScannedEntry[],
  issues: PostMergeIssue[],
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return; // no tree — nothing to validate
  }

  const isRoot = dir === treeRoot;
  if (!isRoot && !names.includes("index.md")) {
    const itemCount = await countMarkdownInside(dir);
    const relPath = toRel(treeRoot, dir);
    issues.push({
      class: "orphaned-directory",
      path: relPath,
      message:
        itemCount === 0
          ? `directory has no index.md and no items inside — an empty husk left by the merge`
          : `directory has no index.md but still contains ${itemCount} item file${itemCount === 1 ? "" : "s"} — ` +
            `restore its index.md (git checkout) or re-home the children before deleting`,
      repairable: itemCount === 0,
    });
    if (itemCount === 0) return; // nothing inside worth scanning
  }

  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    let isDir: boolean;
    try {
      isDir = (await stat(full)).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      await walk(full, treeRoot, entries, issues);
      continue;
    }
    if (!name.endsWith(".md")) continue;

    const entry = await scanFile(full, treeRoot);
    entries.push(entry);

    if (entry.hasConflictMarkers) {
      issues.push({
        class: "conflict-markers",
        path: entry.relPath,
        itemId: entry.id,
        message: "unresolved merge conflict markers — resolve them, then re-run",
        repairable: false,
      });
      // A file mid-conflict has two of everything; skip its other checks.
      continue;
    }

    if (entry.level !== undefined && VALID_LEVELS.has(entry.level)) {
      const implied = depthImpliedLevel(entry.depth);
      if (entry.level !== implied) {
        issues.push({
          class: "level-mismatch",
          path: entry.relPath,
          itemId: entry.id,
          message: `level is "${entry.level}" but the item sits at ${implied} depth (${entry.depth})`,
          repairable: true,
          detail: [implied],
        });
      }
    }
  }
}

async function scanFile(fullPath: string, treeRoot: string): Promise<ScannedEntry> {
  const relPath = toRel(treeRoot, fullPath);
  let text = "";
  try {
    text = await readFile(fullPath, "utf-8");
  } catch {
    // Unreadable file: report nothing here — git status will surface it.
  }

  // The item's depth: a folder item is its directory (index.md's parent), a
  // leaf file is itself. Both come out as the number of path segments.
  const segments = relPath.split("/");
  const depth = segments[segments.length - 1] === "index.md" ? segments.length - 1 : segments.length;

  return {
    relPath,
    depth,
    id: matchScalar(text, "id"),
    level: matchScalar(text, "level"),
    blockedBy: matchList(text, "blockedBy"),
    hasConflictMarkers: CONFLICT_MARKERS.test(text),
  };
}

async function countMarkdownInside(dir: string): Promise<number> {
  let count = 0;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    try {
      if ((await stat(full)).isDirectory()) {
        count += await countMarkdownInside(full);
      } else if (name.endsWith(".md")) {
        count++;
      }
    } catch {
      // vanished mid-scan
    }
  }
  return count;
}

// ── Repair ────────────────────────────────────────────────────────────────────

/**
 * Apply the deterministic repairs; ambiguous classes are returned untouched
 * in `refused`. Callers re-detect afterwards for the authoritative state.
 */
export async function repairPostMergeIssues(
  treeRoot: string,
  issues: PostMergeIssue[],
): Promise<{ repaired: PostMergeIssue[]; refused: PostMergeIssue[] }> {
  const repaired: PostMergeIssue[] = [];
  const refused: PostMergeIssue[] = [];

  for (const issue of issues) {
    if (!issue.repairable) {
      refused.push(issue);
      continue;
    }
    const fullPath = join(treeRoot, ...issue.path.split("/"));
    try {
      switch (issue.class) {
        case "orphaned-directory":
          await rm(fullPath, { recursive: true, force: true });
          break;
        case "level-mismatch":
          await rewriteFile(fullPath, (text) =>
            text.replace(/^level:.*$/m, `level: ${JSON.stringify(issue.detail?.[0] ?? "subtask")}`),
          );
          break;
        case "dangling-blocked-by":
          await rewriteFile(fullPath, (text) => dropBlockedByRefs(text, new Set(issue.detail ?? [])));
          break;
        default:
          refused.push(issue);
          continue;
      }
      repaired.push(issue);
    } catch {
      refused.push(issue);
    }
  }

  return { repaired, refused };
}

async function rewriteFile(fullPath: string, transform: (text: string) => string): Promise<void> {
  const text = await readFile(fullPath, "utf-8");
  const next = transform(text);
  if (next !== text) await writeFile(fullPath, next, "utf-8");
}

/** Remove the given ids from a block-style blockedBy list; drop the field when empty. */
function dropBlockedByRefs(text: string, dangling: Set<string>): string {
  const chunk = /^blockedBy:[^\S\n]*\n((?:[ \t]+-[^\n]*\n)*)/m.exec(text);
  if (!chunk) return text;

  const kept = chunk[1]
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      const value = stripQuotes((/^\s*-\s*(.*)$/.exec(line)?.[1] ?? "").trim());
      return !dangling.has(value);
    });

  const replacement = kept.length > 0 ? `blockedBy:\n${kept.join("\n")}\n` : "";
  return text.replace(chunk[0], replacement);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toRel(treeRoot: string, fullPath: string): string {
  return relative(treeRoot, fullPath).split(sep).join("/");
}

function matchScalar(text: string, key: string): string | undefined {
  const m = new RegExp(`^${key}:[^\\S\\n]*(.+)$`, "m").exec(frontmatterOnly(text));
  return m ? stripQuotes(m[1].trim()) : undefined;
}

function matchList(text: string, key: string): string[] {
  const m = new RegExp(`^${key}:[^\\S\\n]*\\n((?:[ \\t]+-[^\\n]*\\n?)*)`, "m").exec(frontmatterOnly(text));
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((line) => /^\s*-\s*(.*)$/.exec(line)?.[1])
    .filter((v): v is string => v !== undefined)
    .map((v) => stripQuotes(v.trim()))
    .filter(Boolean);
}

/** The frontmatter block, so body prose cannot fake a field. */
function frontmatterOnly(text: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(text);
  return m ? m[1] : "";
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}
