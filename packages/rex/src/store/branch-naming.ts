/**
 * Git branch detection utilities and branch-scoped PRD filename composers.
 *
 * Provides helpers for resolving the current git branch, the date of its first
 * unique commit, and composing branch-scoped `prd_{branch}_{date}.json` filenames.
 */

import { execFileSync } from "node:child_process";
import { sanitizeBranchName } from "@n-dx/llm-client";

export { sanitizeBranchName };

const QUIET_GIT = { stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"] };

/**
 * Resolve the current git branch name.
 *
 * Returns the branch name as-is (unsanitized) for downstream composition.
 * Falls back to the short commit hash for detached HEAD, or `"unknown"`
 * if git is unavailable or the directory is not a repository.
 */
export function resolveGitBranch(cwd: string): string {
  try {
    const branch = execFileSync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, encoding: "utf-8", ...QUIET_GIT },
    ).trim();

    if (branch && branch !== "HEAD") {
      return branch;
    }

    // Detached HEAD — use short commit hash as a deterministic identifier
    const hash = execFileSync(
      "git",
      ["rev-parse", "--short", "HEAD"],
      { cwd, encoding: "utf-8", ...QUIET_GIT },
    ).trim();

    return hash || "unknown";
  } catch {
    return "unknown";
  }
}

/** Well-known default branch names, checked in order. */
export const DEFAULT_BRANCHES = ["main", "master"] as const;

const ORIGIN_PREFIX = "refs/remotes/origin/";

/**
 * The branch `origin/HEAD` points at, or null when the clone has no
 * `origin/HEAD` (no remote, or one added without `--set-head`).
 */
function resolveOriginDefaultBranch(cwd: string): string | null {
  try {
    const ref = execFileSync(
      "git",
      ["symbolic-ref", "--quiet", `${ORIGIN_PREFIX}HEAD`],
      { cwd, encoding: "utf-8", ...QUIET_GIT },
    ).trim();
    return ref.startsWith(ORIGIN_PREFIX) ? ref.slice(ORIGIN_PREFIX.length) : null;
  } catch {
    return null;
  }
}

/**
 * Whether `branch` is this clone's default branch.
 *
 * Prefers what `origin/HEAD` names, so a repository whose default is neither
 * `main` nor `master` is read correctly, and falls back to
 * {@link DEFAULT_BRANCHES} when the clone has no `origin/HEAD`.
 *
 * Lives here rather than beside its caller because this module is where rex
 * talks to git about branches — the allowlist in
 * `tests/e2e/architecture-policy.test.js` names it for exactly that, and a
 * second `execFileSync("git", …)` site elsewhere in rex would have to widen
 * that allowlist to say the same thing twice.
 */
export function isDefaultBranch(cwd: string, branch: string): boolean {
  const origin = resolveOriginDefaultBranch(cwd);
  return origin ? branch === origin : (DEFAULT_BRANCHES as readonly string[]).includes(branch);
}

/**
 * Get the YYYY-MM-DD date of the first commit on the current branch.
 *
 * Resolution order:
 * 1. First commit unique to this branch (not on main/master)
 * 2. Root commit of the repository (when on the default branch itself
 *    or when no default branch exists)
 * 3. Today's date (no commits at all, or not a git repo)
 */
export function getFirstCommitDate(cwd: string): string {
  // 1. First commit unique to this branch vs. a known default branch
  for (const base of DEFAULT_BRANCHES) {
    try {
      const output = execFileSync(
        "git",
        ["log", `${base}..HEAD`, "--reverse", "--format=%aI"],
        { cwd, encoding: "utf-8", ...QUIET_GIT },
      ).trim();

      if (output) {
        return output.split("\n")[0].slice(0, 10);
      }
    } catch {
      // Base branch doesn't exist — try the next one
    }
  }

  // 2. Root commit date (works when on the default branch or no default found)
  try {
    const roots = execFileSync(
      "git",
      ["rev-list", "--max-parents=0", "HEAD"],
      { cwd, encoding: "utf-8", ...QUIET_GIT },
    ).trim();

    if (roots) {
      const rootHash = roots.split("\n")[0];
      const date = execFileSync(
        "git",
        ["log", "-1", "--format=%aI", rootHash],
        { cwd, encoding: "utf-8", ...QUIET_GIT },
      ).trim();

      if (date) {
        return date.slice(0, 10);
      }
    }
  } catch {
    // No commits yet or not a git repo
  }

  // 3. Final fallback
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build the canonical branch-scoped PRD filename.
 *
 * Format: `prd_{sanitized-branch}_{YYYY-MM-DD}.json`
 * Example: `prd_feature-my-thing_2025-04-01.json`
 */
export function generatePRDFilename(branch: string, date: string): string {
  return `prd_${sanitizeBranchName(branch)}_${date}.json`;
}

/**
 * Compose a branch-scoped PRD filename for the current working directory.
 *
 * Combines `resolveGitBranch` + `getFirstCommitDate` + `generatePRDFilename`.
 * Returns `null` when the branch cannot be resolved (not a git repo, detached HEAD
 * with no hash, etc.).
 */
export function resolvePRDFilename(cwd: string): string | null {
  const branch = resolveGitBranch(cwd);
  if (!branch || branch === "unknown") return null;
  const date = getFirstCommitDate(cwd);
  return generatePRDFilename(branch, date);
}
