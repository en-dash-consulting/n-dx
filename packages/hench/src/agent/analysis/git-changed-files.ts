/**
 * Capture changed files from git commits using git diff-tree.
 *
 * Provides accurate, deterministic file-change tracking by querying git
 * after commits are created, avoiding race conditions with staging and
 * ensuring exact alignment between the run record and the commit history.
 *
 * @module hench/agent/analysis/git-changed-files
 */

import { execStdout } from "../../process/exec.js";

/**
 * Git status code for a changed file.
 * - A = added
 * - M = modified
 * - D = deleted
 * - R = renamed
 * - C = copied
 * - T = type changed
 */
export type GitStatusCode = "A" | "M" | "D" | "R" | "C" | "T";

/**
 * A file change with its git status code.
 *
 * Format matches git diff-tree output: "STATUS\tpath"
 * Example: "M\tsrc/foo.ts"
 */
export interface FileChangeWithStatus {
  /** Git status code (A/M/D/R/C/T). */
  status: GitStatusCode;
  /** File path relative to project root. */
  path: string;
}

/**
 * Capture files changed by a single commit using git show.
 *
 * @param commitSha Commit SHA to query.
 * @param projectDir Project directory (working directory for git commands).
 * @returns Array of file changes sorted by path.
 *
 * @throws Error if git command fails.
 *
 * ## Design
 *
 * Uses `git show --name-status <SHA>` which shows the exact files changed
 * by a commit with their status codes. This is deterministic (no race conditions)
 * and produces output that exactly matches what the commit contains.
 *
 * Works correctly for all commits including the initial commit (which has no parent).
 *
 * Format: "STATUS\tPATH" on each line (tab-separated).
 *
 * ## Example
 *
 * ```
 * A src/new-file.ts
 * M src/existing.ts
 * D old-file.ts
 * ```
 */
export async function captureCommitChanges(
  commitSha: string,
  projectDir: string,
): Promise<FileChangeWithStatus[]> {
  try {
    const output = await execStdout("git",
      ["show", "--name-status", "--format=", commitSha],
      {
        cwd: projectDir,
        timeout: 10_000,
      }
    );

    const lines = output.trim().split("\n").filter(Boolean);
    const changes: FileChangeWithStatus[] = [];

    for (const line of lines) {
      // Format: "STATUS\tPATH" (tab-separated)
      const parts = line.split("\t");
      if (parts.length >= 2) {
        const statusStr = parts[0].trim();
        const path = parts.slice(1).join("\t").trim(); // Path might contain tabs

        // Extract status code (first character)
        const status = statusStr.charAt(0);
        if (isValidGitStatus(status)) {
          changes.push({ status: status as GitStatusCode, path });
        }
      }
    }

    // Sort by path for deterministic output
    changes.sort((a, b) => a.path.localeCompare(b.path));
    return changes;
  } catch (error) {
    throw new Error(
      `Failed to capture changed files for commit ${commitSha}: ${(error as Error).message}`
    );
  }
}

/**
 * Capture files changed by multiple commits.
 *
 * Aggregates changes across multiple commits, deduplicating by path.
 * Later commits override earlier ones (last status wins).
 *
 * @param commitShas Array of commit SHAs (order matters for deduplication).
 * @param projectDir Project directory (working directory for git commands).
 * @returns Array of unique file changes across all commits, sorted by path.
 *
 * @throws Error if any git command fails.
 */
export async function captureMultiCommitChanges(
  commitShas: string[],
  projectDir: string,
): Promise<FileChangeWithStatus[]> {
  if (commitShas.length === 0) {
    return [];
  }

  if (commitShas.length === 1) {
    return captureCommitChanges(commitShas[0], projectDir);
  }

  // Aggregate changes across commits, deduplicating by path
  const changeMap = new Map<string, FileChangeWithStatus>();

  for (const sha of commitShas) {
    const changes = await captureCommitChanges(sha, projectDir);
    for (const change of changes) {
      changeMap.set(change.path, change);
    }
  }

  // Sort and return unique changes
  const uniqueChanges = Array.from(changeMap.values());
  uniqueChanges.sort((a, b) => a.path.localeCompare(b.path));
  return uniqueChanges;
}

/**
 * Extract file paths from a list of file changes (removing status codes).
 *
 * Useful for populating `RunSummaryData.filesChanged` from the detailed
 * change records.
 */
export function extractPaths(changes: FileChangeWithStatus[]): string[] {
  return changes.map((c) => c.path);
}

/**
 * Format file changes as "STATUS\tPATH" (matching git diff-tree output).
 *
 * Useful for display or logging.
 */
export function formatChanges(changes: FileChangeWithStatus[]): string[] {
  return changes.map((c) => `${c.status}\t${c.path}`);
}

// ─────────────────────────────────────────────────────────────────────────
// Private
// ─────────────────────────────────────────────────────────────────────────

function isValidGitStatus(code: string): code is GitStatusCode {
  return ["A", "M", "D", "R", "C", "T"].includes(code);
}
