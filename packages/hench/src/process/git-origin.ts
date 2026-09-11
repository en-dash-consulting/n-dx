/**
 * Bind a run's automatic commits to the checkout it started in.
 *
 * A run's automatic commits (`git commit` with cwd = projectDir) follow HEAD,
 * and the agent's git allowlist includes `checkout` and `stash` — so HEAD can
 * move mid-run and a later commit lands on whatever branch is current rather
 * than the one the work was started against. This module captures the
 * checkout's identity at run start and re-checks it immediately before each
 * automatic commit, so a run that has been moved refuses to commit instead of
 * writing to the wrong branch.
 *
 * The identity is three values: the worktree root (which worktree), the branch
 * (which ref), and the starting HEAD (needed only to make a detached-HEAD run
 * checkable at all — there is no branch name to compare).
 *
 * Both paths resolve through the same {@link GitOriginProbe} seam so a caller
 * can compare against captured state without a real repository.
 *
 * @module hench/process/git-origin
 */

import { getCurrentBranch, getCurrentHead, getWorktreeRoot } from "./exec.js";

/**
 * `git rev-parse --abbrev-ref HEAD` reports the literal string "HEAD" when the
 * checkout is detached, rather than failing. Treated as "no branch" everywhere
 * below so a detached checkout is never mistaken for a branch named HEAD.
 */
const DETACHED_BRANCH_SENTINEL = "HEAD";

/**
 * The checkout a run started in. Shaped so a {@link RunRecord} satisfies it
 * structurally — the recorded fields carry the same names, so a run record can
 * be passed straight to {@link checkRunGitOrigin}.
 *
 * Every field is optional: a project that is not a git repository captures
 * nothing, and run records written before these fields existed have none.
 * Both cases mean "nothing to enforce", not "mismatch".
 */
export interface RunGitOrigin {
  /** Realpath-resolved root of the worktree the run started in. */
  worktreeRoot?: string;
  /** Branch checked out at run start. Absent when HEAD was detached. */
  branch?: string;
  /** Commit HEAD pointed at when the run started. */
  startHead?: string;
}

/** Git probes used to capture and re-check a run's origin. */
export interface GitOriginProbe {
  worktreeRoot(cwd: string): string | null;
  branch(cwd: string): string | undefined;
  head(cwd: string): string | undefined;
}

/**
 * Probe backed by real git. The default for both exported functions.
 *
 * Each helper is called through rather than bound at module load: this module
 * is imported by the lifecycle, and several suites `vi.mock` the exec module
 * with a partial surface. Binding eagerly made those suites fail at import
 * time on a helper they never call.
 */
export const realGitOriginProbe: GitOriginProbe = {
  worktreeRoot: (cwd) => getWorktreeRoot(cwd),
  branch: (cwd) => getCurrentBranch(cwd),
  head: (cwd) => getCurrentHead(cwd),
};

/** Normalize git's detached-HEAD sentinel to "no branch". */
function normalizeBranch(raw: string | undefined): string | undefined {
  return !raw || raw === DETACHED_BRANCH_SENTINEL ? undefined : raw;
}

/** Abbreviate a commit hash for a human-readable message. */
function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 8) : "an unknown commit";
}

/**
 * Capture the checkout identity of `cwd` at run start.
 *
 * Outside a git repository every field comes back undefined, which
 * {@link checkRunGitOrigin} reads as "nothing to enforce" — a non-git project
 * is not a mismatch.
 */
export function captureRunGitOrigin(
  cwd: string,
  probe: GitOriginProbe = realGitOriginProbe,
): RunGitOrigin {
  const worktreeRoot = probe.worktreeRoot(cwd) ?? undefined;
  return {
    worktreeRoot,
    branch: normalizeBranch(probe.branch(cwd)),
    startHead: probe.head(cwd),
  };
}

/**
 * Re-check `cwd` against the origin captured at run start.
 *
 * Returns undefined when it is still safe to commit, or a human-readable
 * sentence naming expected and actual values when it is not. Callers report
 * that sentence and skip the commit, leaving the working tree untouched.
 *
 * A detached HEAD is a mismatch unless the run itself started detached at the
 * same commit — a run that starts on a branch and ends detached has had its
 * HEAD moved, which is exactly the case this guards.
 */
export function checkRunGitOrigin(
  cwd: string,
  origin: RunGitOrigin | undefined,
  probe: GitOriginProbe = realGitOriginProbe,
): string | undefined {
  // Nothing was captured (non-git project, or a run record predating these
  // fields) — there is no expectation to violate.
  if (!origin || (!origin.worktreeRoot && !origin.branch && !origin.startHead)) {
    return undefined;
  }

  if (origin.worktreeRoot) {
    const actualRoot = probe.worktreeRoot(cwd);
    if (actualRoot === null) {
      return `the run started in worktree ${origin.worktreeRoot}, but ${cwd} is no longer inside a git worktree`;
    }
    if (actualRoot !== origin.worktreeRoot) {
      return `the run started in worktree ${origin.worktreeRoot}, but git now reports ${actualRoot}`;
    }
  }

  const actualBranch = normalizeBranch(probe.branch(cwd));

  if (origin.branch) {
    if (!actualBranch) {
      return `the run started on branch "${origin.branch}", but HEAD is now detached at ${shortSha(probe.head(cwd))}`;
    }
    if (actualBranch !== origin.branch) {
      return `the run started on branch "${origin.branch}", but HEAD is now on "${actualBranch}"`;
    }
    return undefined;
  }

  // No branch captured. When a starting commit was captured the run began
  // detached, and staying detached at that same commit is the only safe state.
  if (origin.startHead) {
    if (actualBranch) {
      return `the run started with HEAD detached at ${shortSha(origin.startHead)}, but HEAD is now on branch "${actualBranch}"`;
    }
    const actualHead = probe.head(cwd);
    if (actualHead !== origin.startHead) {
      return `the run started with HEAD detached at ${shortSha(origin.startHead)}, but HEAD is now detached at ${shortSha(actualHead)}`;
    }
  }

  return undefined;
}
