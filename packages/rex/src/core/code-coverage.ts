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
 * Matches common file path patterns (e.g. src/foo/bar.ts, ./lib/util.js,
 * .github/x.yml) and returns them relative: a leading `/`, `./` or `../` is
 * stripped, so `../lib/x.ts` gives `lib/x.ts`, the tail the old pattern gave,
 * and the suffix match in crossReferenceChanges still finds it.
 *
 * @internal Exported for its unit test only; not part of rex's public API.
 */
export function extractFilePaths(text: string): string[] {
  // A match starts only at a token boundary: the lookbehind refuses a start
  // right after a path character, so a pattern that fails on a long run of
  // `-` or `a/` fails once rather than once per position (quadratic: PRD text
  // of 50k such characters took 0.9 s; 256 KiB takes under 10 ms now). It also
  // stops a match beginning in the middle of a token — `foo.bar/baz.ts`, a
  // URL, `v1.2/foo.ts` — which used to leak tails like `bar/baz.ts`. Because
  // `.` is in the lookbehind class, `./` and `../` prefixes and a `.`-led
  // segment (`.github/`, `src/.hidden/`) are matched explicitly, whole, where
  // the old pattern skipped to the segment after them.
  const pattern = /(?<![\w@.\/-])\/?(?:\.\.?\/)*(?:\.?[\w@-]+\/)+[\w.-]+\.\w+/g;
  const matches = text.match(pattern);
  if (!matches) return [];
  return [...new Set(matches.map((path) => path.replace(/^\/?(?:\.\.?\/)*/, "")))];
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
 * Applied to the caller's changed files too, so it leaves an absolute or UNC
 * path as given: the result is reported back in matchedFiles/uncoveredChanges.
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

  return {
    affectedTasks,
    uncoveredChanges: normalizedChanges
      .filter((f) => !coveredFiles.has(f))
      .map((file) => ({ file })),
  };
}
