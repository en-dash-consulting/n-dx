/**
 * Git-derived discovery of what a run actually changed.
 *
 * ## Why not ask the model
 *
 * The full-suite gate skips when it believes nothing changed, so this set
 * decides whether a run's tests run at all. It used to come from the model's
 * own summary of what it had done, with a `git diff HEAD` fallback that only
 * fired when the loop recorded no tool calls — which never happens on the
 * Claude CLI. The result was the worst possible failure: on the default path
 * the gate read an empty list and skipped, reporting "no files modified" for
 * runs that had modified files.
 *
 * ## Why the baseline is the pre-run commit, not HEAD
 *
 * `git diff HEAD` answers "what is uncommitted", which is not the question.
 * On the autoCommit path the executor commits its own work before the gate
 * runs, so HEAD already contains it and the diff is empty. Diffing the working
 * tree against the commit the run *started* from captures both what was
 * committed during the run and what is still uncommitted — including repairs
 * the adversarial review pass made after the run summary was parsed.
 *
 * Untracked files are added separately (a diff never lists them), minus the
 * untracked files that were already present when the run started: those are
 * the user's, not this run's.
 *
 * @module hench/validation/changed-files
 */

import { exec } from "../process/exec.js";

const GIT_TIMEOUT = 10_000;

/**
 * Paths that are never the run's work product, excluded from the result.
 *
 * `.rex/` is bookkeeping hench itself writes on every run — the task-status
 * update dirties the task's `index.md` before the agent has done anything —
 * and `.hench/` holds run records and review reports. The agent's own prompt
 * forbids modifying either directly, and the reviewer's repaired-files set
 * already filters them (see cli-loop.ts). Left in, they make every run look
 * like it changed files, so the full-suite gate fires for runs that produced
 * no code at all — and a pre-existing failure anywhere in the workspace then
 * fails the run and resets a task that was never the cause.
 *
 * Git emits forward-slash paths on every platform, so prefix matching is safe.
 */
const BOOKKEEPING_PREFIXES = [".rex/", ".hench/"];

function isBookkeepingPath(path: string): boolean {
  return BOOKKEEPING_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * List untracked files individually.
 *
 * Deliberately not `listUntrackedPaths` from `./review.js`: that uses a plain
 * `--porcelain`, which collapses a new directory to a single `src/` entry.
 * That is the right granularity for the rollback path it serves (`git clean
 * -fd -- src/` removes the tree), but useless here — the test gate aggregates
 * results per file path, and `src/` names no file and maps to no package.
 */
async function listUntrackedFiles(projectDir: string, timeout: number): Promise<string[]> {
  const result = await exec(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: projectDir, timeout },
  );
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => {
      // Paths with spaces or special characters come back double-quoted.
      let path = line.slice(3).trim();
      if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
        path = path.slice(1, -1);
      }
      return path;
    })
    .filter(Boolean);
}

export interface DiscoverChangedFilesOptions {
  projectDir: string;
  /**
   * Commit the run started from. When omitted, falls back to `HEAD`, which
   * sees uncommitted work only — correct for loops that never commit
   * mid-run, and the best available answer when no baseline was captured.
   */
  startingHead?: string;
  /** Untracked paths present before the run; excluded from the result. */
  baselineUntracked?: string[];
  timeout?: number;
}

/**
 * Repo-relative paths this run changed, or undefined when git could not
 * answer.
 *
 * The undefined case is deliberately distinct from an empty array: "git is
 * unavailable, or the baseline commit is unknown" must not be read as
 * "nothing changed", because the caller decides whether to run tests on that
 * answer. Callers should keep their previous behavior on undefined.
 */
export async function discoverChangedFiles(
  opts: DiscoverChangedFilesOptions,
): Promise<string[] | undefined> {
  const { projectDir, startingHead, baselineUntracked, timeout = GIT_TIMEOUT } = opts;
  const baseline = startingHead?.trim() || "HEAD";

  const diff = await exec("git", ["diff", "--name-only", baseline], {
    cwd: projectDir,
    timeout,
  }).catch(() => undefined);

  // A non-zero exit means the question could not be answered — not a git
  // repo, or a baseline commit this repo does not have (e.g. the run started
  // on a branch that was since rewritten). Either way, say so.
  if (!diff || diff.exitCode !== 0) return undefined;

  const changed = new Set(
    diff.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((path) => !isBookkeepingPath(path)),
  );

  // Untracked files never appear in a diff, so add them explicitly. A failure
  // here is not fatal: the diff-derived set is still better than nothing.
  try {
    const untracked = await listUntrackedFiles(projectDir, timeout);
    // The baseline may name a directory (that is what the rollback snapshot
    // records), so exclude by prefix as well as by exact match.
    const excluded = baselineUntracked ?? [];
    for (const path of untracked) {
      if (isBookkeepingPath(path)) continue;
      const wasPresent = excluded.some(
        (base) => base === path || (base.endsWith("/") && path.startsWith(base)),
      );
      if (!wasPresent) changed.add(path);
    }
  } catch {
    // Keep the diff-derived set.
  }

  return [...changed];
}
