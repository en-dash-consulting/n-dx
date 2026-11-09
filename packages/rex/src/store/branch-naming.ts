/**
 * Git branch detection utilities and branch-scoped PRD filename composers.
 *
 * Provides helpers for resolving the current git branch, the date of its first
 * unique commit, and composing branch-scoped `prd_{branch}_{date}.json` filenames.
 */

import { execFileSync } from "node:child_process";
import { sanitizeBranchName } from "@n-dx/llm-client";

export { sanitizeBranchName };

// windowsHide: these run under the dashboard's hidden children too, where an
// unhidden git would get its own console window (tests/e2e/windows-hide-policy).
const QUIET_GIT = { stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"], windowsHide: true };

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
const HEADS_PREFIX = "refs/heads/";

/**
 * The branch `origin/HEAD` points at, or null when the clone has no
 * `origin/HEAD` (no remote, or one added without `--set-head`), or when the
 * ref it names is gone.
 *
 * `git symbolic-ref` only resolves the symref file — it prints the name it
 * points at and exits 0 whether or not that name still exists as a ref. After
 * an upstream default-branch rename (main → master, say) followed by
 * `git remote prune origin`, `origin/HEAD` keeps pointing at the old,
 * now-absent name until the next `git remote set-head`. Trusting that name
 * unverified would make every whole-tree rewrite command's "is this the
 * default branch" answer wrong for exactly the clones this fallback exists to
 * cover.
 */
function resolveOriginDefaultBranch(cwd: string): string | null {
  try {
    const ref = execFileSync(
      "git",
      ["symbolic-ref", "--quiet", `${ORIGIN_PREFIX}HEAD`],
      { cwd, encoding: "utf-8", ...QUIET_GIT },
    ).trim();
    if (!ref.startsWith(ORIGIN_PREFIX)) return null;
    return refExists(cwd, ref) ? ref.slice(ORIGIN_PREFIX.length) : null;
  } catch {
    return null;
  }
}

/** Whether `ref` resolves to a commit this repository actually has. */
function refExists(cwd: string, ref: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd,
      ...QUIET_GIT,
    });
    return true;
  } catch {
    return false;
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
 * The checked-out branch of the workspace at `projectDir`, or null when that
 * workspace has no work-set branch: it is on the default branch, HEAD is
 * detached, or `projectDir` is not in a git repository.
 *
 * Callers pass the workspace directory they resolved (the MCP server's
 * `workspace.projectDir`, the CLI's dir argument), never `process.cwd()`.
 * The default branch is read by {@link isDefaultBranch}, so there is one
 * resolver for it.
 */
export function currentWorkSetBranch(projectDir: string): string | null {
  let ref: string;
  try {
    // Unlike `rev-parse --abbrev-ref`, this fails on a detached HEAD. The full
    // ref, not `--short`: a tag sharing the branch's name makes `--short`
    // print `heads/<name>`.
    ref = execFileSync(
      "git",
      ["symbolic-ref", "--quiet", "HEAD"],
      { cwd: projectDir, encoding: "utf-8", ...QUIET_GIT },
    ).trim();
  } catch {
    return null;
  }
  if (!ref.startsWith(HEADS_PREFIX)) return null;
  const branch = ref.slice(HEADS_PREFIX.length);
  if (!branch || isDefaultBranch(projectDir, branch)) return null;
  return branch;
}

/**
 * Where the checked-out branch of `projectDir` left the default branch: the
 * merge-base of HEAD and the default branch {@link isDefaultBranch} names,
 * local and `origin/` refs both, so the newer of the two counts. Null when
 * no default branch ref exists or git cannot compute a merge-base (a shallow
 * clone, unrelated histories).
 */
export function workSetForkPoint(projectDir: string): string | null {
  const origin = resolveOriginDefaultBranch(projectDir);
  const names = origin ? [origin] : DEFAULT_BRANCHES;
  const refs = names
    .flatMap((name) => [`${HEADS_PREFIX}${name}`, `${ORIGIN_PREFIX}${name}`])
    .filter((ref) => refExists(projectDir, ref));
  if (refs.length === 0) return null;
  try {
    // With several refs, git answers the merge-base of HEAD and their merge:
    // the most recent point HEAD shares with any of them.
    const base = execFileSync("git", ["merge-base", "HEAD", ...refs], { cwd: projectDir, encoding: "utf-8", ...QUIET_GIT }).trim();
    return base || null;
  } catch {
    return null;
  }
}

/**
 * The text of every `state.yaml` under `dir` at `ref` that contains `needle`,
 * by repository path. `dir` is relative to `projectDir`. Empty when none
 * matches; null when git cannot read the tree at `ref`.
 */
export function readStateFilesAt(projectDir: string, ref: string, dir: string, needle: string): Map<string, string> | null {
  let listed: string;
  try {
    listed = execFileSync(
      "git",
      ["grep", "-z", "-l", "--full-name", "-F", "-e", needle, ref, "--", dir],
      { cwd: projectDir, encoding: "utf-8", ...QUIET_GIT, maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (err) {
    // git grep exits 1 when nothing matches; anything else is an unreadable tree.
    return (err as { status?: number }).status === 1 ? new Map() : null;
  }
  const objects = listed.split("\0").filter((name) => name.endsWith("/state.yaml"));
  if (objects.length === 0) return new Map();
  let batch: Buffer;
  try {
    batch = execFileSync("git", ["cat-file", "--batch"], {
      cwd: projectDir,
      input: objects.join("\n") + "\n",
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  const files = new Map<string, string>();
  let at = 0;
  for (const object of objects) {
    const eol = batch.indexOf(0x0a, at);
    const header = batch.subarray(at, eol).toString("utf-8").split(" ");
    if (header[1] !== "blob") return null;
    const size = Number(header[2]);
    files.set(object.slice(object.indexOf(":") + 1), batch.subarray(eol + 1, eol + 1 + size).toString("utf-8"));
    at = eol + 1 + size + 1;
  }
  return files;
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
