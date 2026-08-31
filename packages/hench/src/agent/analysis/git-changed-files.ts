/**
 * Capture changed files from git commits using git diff-tree.
 *
 * Provides accurate, deterministic file-change tracking by querying git
 * after commits are created, avoiding race conditions with staging and
 * ensuring exact alignment between the run record and the commit history.
 *
 * @module hench/agent/analysis/git-changed-files
 */

import { exec, execStdout } from "../../process/exec.js";

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
// Pre-commit discovery (test gate input)
// ─────────────────────────────────────────────────────────────────────────

/** What {@link discoverChangedFiles} found, and whether it could look. */
export interface ChangedFileDiscovery {
  /** Discovered paths, merged with the seed and sorted. */
  files: string[];
  /**
   * True when at least one git query could not be run.
   *
   * Load-bearing: an empty {@link files} means "nothing changed" only when this
   * is false. Callers must not read the two as the same thing.
   */
  failed: boolean;
  /** One human-readable reason per failed query. Empty when `failed` is false. */
  failures: string[];
}

/** Options for {@link discoverChangedFiles}. */
export interface DiscoverChangedFilesOptions {
  /** Project directory — the git working directory. */
  projectDir: string;
  /** Run's starting commit. When set, commits made during the run are included. */
  startingHead?: string;
  /** Paths already known from tool-call analysis. Merged, never replaced. */
  seed?: string[];
}

/**
 * Discover every path this run touched, for the mandatory test gate.
 *
 * Asks git three questions and merges the answers with the seed:
 *
 *  1. `startingHead..HEAD` — committed during the run (the agent self-committed)
 *  2. `--cached` — staged but not yet committed (the normal end-of-run state)
 *  3. working tree — modified but not staged
 *
 * ## Why argv rather than a shell
 *
 * These ran through `execShellCmd` (`sh -c`) until run a4197298 showed what
 * that costs: `sh` is absent from a stock Windows PATH, `spawn` fails ENOENT,
 * `exec` resolves rather than rejects, and reading only `stdout` turns a shell
 * that never launched into "no files changed". The gate then skipped itself on
 * a run that shipped source and tests — the third such skip, and the first
 * after the previous fix. None of these queries needs a shell: no pipes, no
 * globs, no redirection. Passing argv removes the dependency instead of
 * repairing it.
 *
 * ## Why failure is returned rather than thrown
 *
 * The caller finalizes a run either way; a git that will not answer should not
 * abort the run. But it must not be silent either, which is what a bare
 * `catch` around the old code produced. {@link ChangedFileDiscovery.failed}
 * makes "could not look" a distinct state from "looked, found nothing", so the
 * gate can refuse to skip on the strength of an answer nobody got.
 */
export async function discoverChangedFiles(
  options: DiscoverChangedFilesOptions,
): Promise<ChangedFileDiscovery> {
  const { projectDir, startingHead, seed } = options;

  const queries: { label: string; args: string[] }[] = [];
  if (startingHead) {
    queries.push({
      label: `committed since ${startingHead}`,
      args: ["diff", "--name-only", startingHead, "HEAD"],
    });
  }
  queries.push({ label: "staged", args: ["diff", "--name-only", "--cached"] });
  queries.push({ label: "unstaged", args: ["diff", "--name-only"] });

  const found = new Set<string>(seed ?? []);
  const failures: string[] = [];

  for (const query of queries) {
    const result = await exec("git", query.args, { cwd: projectDir, timeout: 10_000 });

    // exec never rejects — a spawn failure arrives as `error`, and git's own
    // refusal as a non-zero code. Both mean the answer is unknown, so both are
    // recorded rather than read as an empty result.
    if (result.error || result.exitCode !== 0) {
      const reason = result.error?.message || result.stderr.trim();
      failures.push(
        `git ${query.args.join(" ")} (${query.label}) failed` +
          `${result.exitCode !== null ? ` with exit ${result.exitCode}` : ""}` +
          `${reason ? `: ${reason}` : ""}`,
      );
      continue;
    }

    for (const line of result.stdout.trim().split("\n")) {
      const path = line.trim();
      if (path) found.add(path);
    }
  }

  return {
    files: [...found].sort(),
    failed: failures.length > 0,
    failures,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Private
// ─────────────────────────────────────────────────────────────────────────

function isValidGitStatus(code: string): code is GitStatusCode {
  return ["A", "M", "D", "R", "C", "T"].includes(code);
}
