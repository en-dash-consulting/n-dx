/**
 * Whether git is mid-operation, for the lifecycle steps that must not commit
 * through one: the fail-forward commit and folding a task's completion into
 * its work commit.
 */

import { existsSync } from "node:fs";

import { execStdout } from "../../process/exec.js";

/** Git state files that mean an operation is mid-flight. */
const IN_PROGRESS_REFS = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"] as const;
const IN_PROGRESS_DIRS = ["rebase-merge", "rebase-apply"] as const;

async function git(projectDir: string, args: string[]): Promise<string> {
  return execStdout("git", args, { cwd: projectDir, timeout: 15_000 });
}

/**
 * Whether a merge, rebase, cherry-pick or revert is mid-flight.
 *
 * `git rev-parse --git-path` resolves each name inside the real git directory,
 * which is a file rather than a directory in a linked worktree — so asking git
 * is the only way to get this right in a worktree.
 */
export async function operationInProgress(projectDir: string): Promise<string | null> {
  for (const ref of IN_PROGRESS_REFS) {
    try {
      // `rev-parse -q --verify` exits non-zero AND prints nothing when the ref
      // is absent. The exit code does not always surface as a throw here, so
      // the emptiness of the output is what decides — testing only for a throw
      // reported every clean repository as mid-merge.
      const sha = (await git(projectDir, ["rev-parse", "-q", "--verify", ref])).trim();
      if (sha) return ref;
    } catch {
      // Not present — which is the normal case.
    }
  }
  for (const dir of IN_PROGRESS_DIRS) {
    try {
      // `--path-format=absolute` so the answer does not depend on this
      // process's cwd, which is not the project directory.
      const path = (await git(projectDir, [
        "rev-parse", "--path-format=absolute", "--git-path", dir,
      ])).trim();
      if (path && existsSync(path)) return dir;
    } catch {
      // Treated as not in progress.
    }
  }
  return null;
}
