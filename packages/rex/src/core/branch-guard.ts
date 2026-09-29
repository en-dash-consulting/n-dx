/**
 * Whole-tree PRD rewrite guard.
 *
 * `reshape`, `reorganize`, `prune`, the migrate-* commands, and
 * `import-bundle --replace` each rewrite the *entire* `.rex/prd_tree/` in one
 * pass. Run on a feature branch, that rewrite has repeatedly ridden into
 * `main` inside an unrelated pull request — the tree looks correct on the
 * branch it was made on, the diff is large, and reviewers focused on the
 * PR's actual change don't catch that every item in the tree was touched.
 *
 * `checkBranchGuard` refuses those commands unless the caller is on the
 * default branch (the branch `origin/HEAD` names, else `main`/`master`) or
 * passed `--allow-on-branch`. It fails
 * open *only* when the branch cannot be determined at all — no git repo, or
 * git unavailable — both of which `resolveGitBranch` reports as `"unknown"`.
 * Blocking those would break every `.rex/` tree that is not (yet) inside a
 * git repository.
 *
 * A detached HEAD does **not** fail open. `resolveGitBranch` returns the
 * short commit hash, which is neither `"unknown"` nor a default branch, so
 * the guard refuses and names the hash. That is deliberate — a detached HEAD
 * is not the default branch — but note the consequence: a CI checkout that
 * detaches (the default for `actions/checkout`) needs `--allow-on-branch`
 * even when the commit it detached at is the tip of `main`.
 *
 * @module core/branch-guard
 */

import { resolveGitBranch, isDefaultBranch } from "../store/branch-naming.js";

/** CLI flag that opts a command back into running on a feature branch. */
export const ALLOW_ON_BRANCH_FLAG = "allow-on-branch";

export interface BranchGuardResult {
  /** True when the caller must refuse unless `--allow-on-branch` was passed. */
  blocked: boolean;
  /** The resolved branch name, or `"unknown"` when it could not be determined. */
  branch: string;
}

/**
 * Decide whether a whole-tree rewrite command should refuse to run.
 *
 * Blocks when the current directory resolves to a real branch other than
 * the default branch and the caller has not passed `--allow-on-branch`.
 * Never blocks when the branch cannot be resolved (fails open).
 *
 * @param cwd   Project directory to resolve the git branch from.
 * @param flags Raw CLI flags — `allow-on-branch=true` opts back in.
 */
export function checkBranchGuard(
  cwd: string,
  flags: Record<string, string>,
): BranchGuardResult {
  const branch = resolveGitBranch(cwd);
  const allowed = flags[ALLOW_ON_BRANCH_FLAG] === "true";
  const isFeatureBranch = branch !== "unknown" && !isDefaultBranch(cwd, branch);
  return { blocked: isFeatureBranch && !allowed, branch };
}

/**
 * Build the refusal message and suggestion for a blocked command. Names the
 * branch and the flag, per the guard's contract.
 */
export function branchGuardRefusal(
  command: string,
  branch: string,
): { message: string; suggestion: string } {
  return {
    message: `'rex ${command}' rewrites the whole PRD tree and refuses to run on branch "${branch}" — not the default branch.`,
    suggestion: `Switch to the default branch, or pass --${ALLOW_ON_BRANCH_FLAG} to run anyway.`,
  };
}
