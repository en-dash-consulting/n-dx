/**
 * Code coverage cross-reference for PRD items.
 *
 * Matches file paths mentioned in task descriptions and acceptance criteria
 * against a list of changed files to suggest:
 * - Tasks that may be addressed by recent changes
 * - Changed files not covered by any task
 *
 * @module rex/core/code-coverage
 */

import type { PRDItem } from "../schema/index.js";
import { walkTree } from "./tree.js";

/** A task that may be related to changed files. */
export interface AffectedTask {
  id: string;
  title: string;
  level: string;
  status: string;
  matchedFiles: string[];
}

/** A changed file not covered by any task. */
export interface UncoveredChange {
  file: string;
}

/** Result of cross-referencing changes with PRD tasks. */
export interface CrossReferenceResult {
  /** Tasks whose descriptions/criteria mention changed files. */
  affectedTasks: AffectedTask[];
  /** Changed files not mentioned in any task. */
  uncoveredChanges: UncoveredChange[];
}

/**
 * Extract file path references from a text string.
 * Matches common file path patterns (e.g. src/foo/bar.ts, ./lib/util.js).
 */
function extractFilePaths(text: string): string[] {
  // Match paths like src/foo.ts, ./lib/bar.js, packages/x/y.ts
  const pattern = /(?:\.\/)?(?:[\w@-]+\/)+[\w.-]+\.\w+/g;
  const matches = text.match(pattern);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Collect all file path references from a PRD item's text fields.
 */
function collectItemFilePaths(item: PRDItem): string[] {
  const paths: string[] = [];

  if (item.description) {
    paths.push(...extractFilePaths(item.description));
  }

  if (item.acceptanceCriteria) {
    for (const criterion of item.acceptanceCriteria) {
      paths.push(...extractFilePaths(criterion));
    }
  }

  return [...new Set(paths)];
}

/**
 * Normalize a file path for matching (strip leading ./ and trailing whitespace).
 */
function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").trim();
}

/**
 * Cross-reference changed files with PRD items.
 *
 * @param items - PRD item tree
 * @param changedFiles - list of file paths that have changed
 * @returns tasks related to changes + uncovered change files
 */
export function crossReferenceChanges(
  items: PRDItem[],
  changedFiles: string[],
): CrossReferenceResult {
  const normalizedChanges = changedFiles.map(normalizePath);
  const coveredFiles = new Set<string>();
  const affectedTasks: AffectedTask[] = [];

  for (const { item } of walkTree(items)) {
    const itemPaths = collectItemFilePaths(item).map(normalizePath);
    if (itemPaths.length === 0) continue;

    const matchedFiles: string[] = [];
    for (const changed of normalizedChanges) {
      for (const itemPath of itemPaths) {
        // Match if the changed file ends with the item's referenced path
        // or if the item's path ends with the changed file
        if (changed.endsWith(itemPath) || itemPath.endsWith(changed) || changed === itemPath) {
          matchedFiles.push(changed);
          coveredFiles.add(changed);
          break;
        }
      }
    }

    if (matchedFiles.length > 0) {
      affectedTasks.push({
        id: item.id,
        title: item.title,
        level: item.level,
        status: item.status,
        matchedFiles: [...new Set(matchedFiles)],
      });
    }
  }

  const uncoveredChanges: UncoveredChange[] = normalizedChanges
    .filter((f) => !coveredFiles.has(f))
    .map((file) => ({ file }));

  return { affectedTasks, uncoveredChanges };
}
