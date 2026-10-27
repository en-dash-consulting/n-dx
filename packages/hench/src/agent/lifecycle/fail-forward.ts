/**
 * Fail-forward mode: commit what a run produced instead of stopping over it.
 *
 * With the mode off, an autonomous loop that finds work left in the tree after
 * an iteration refuses to continue — the leftover might be something the
 * operator cares about, and sweeping it into a later task's commit would
 * misattribute it. That refusal is right by default, and it is also the thing
 * that stalls a long unattended loop over a file nobody was going to miss.
 *
 * With the mode on, that leftover is committed on the spot, scoped to exactly
 * the paths that were dirty, with a constant message, and the loop carries on.
 *
 * ## What this refuses to touch, and why
 *
 * An adversarial review found three ways an unattended commit here could
 * destroy work rather than save it. Each has a guard:
 *
 * - **A conflicted path.** `git add` on an unmerged file is git's way of
 *   *marking the conflict resolved* — it collapses the index stages using the
 *   working-tree bytes, markers and all. Mid-merge the follow-up partial
 *   commit then fails, leaving the operator without `git checkout --merge`;
 *   mid-*rebase* there is no `MERGE_HEAD`, so the commit **succeeds** and the
 *   conflict markers land in history. Verified by reproduction. So an
 *   in-progress merge, rebase, cherry-pick or revert refuses outright, and any
 *   unmerged path is skipped even outside one.
 * - **Staged or partially staged work.** A file the operator staged by hand —
 *   especially a `git add -p` hunk selection, which porcelain reports as
 *   `MM` — belongs to them. `git add` would overwrite the selection with the
 *   whole working-tree file, and a pathspec commit would commit the
 *   working-tree content regardless. Anything with content in the index is
 *   left alone.
 * - **A half-staged index after a failure.** The add loop is not atomic. If a
 *   later path fails, what was already staged is unstaged again, so a failed
 *   fail-forward leaves the index exactly as it found it.
 *
 * ## The properties that make it safe to leave on
 *
 * - **Scoped.** Staging and the commit both name paths explicitly, with
 *   `:(literal)` on both so a filename containing a glob character cannot
 *   widen the commit.
 * - **Constant messages.** Nothing is generated per commit, so there is
 *   nothing to review before it lands and the history reads uniformly.
 * - **Never pushes.** Committing is the whole promise. Nothing in this module
 *   runs `git push`, and a test asserts the remote never moves.
 *
 * @module hench/agent/lifecycle/fail-forward
 */

import { execGitMutation } from "../../process/git-mutation.js";
import { execStdout } from "../../process/exec.js";
import { buildCoAuthoredByTrailerLine } from "./shared.js";
import { operationInProgress } from "./git-operation.js";

/** Why a fail-forward commit was made. One constant message per kind. */
export type FailForwardKind = "loop-leftover";

/**
 * Commit subjects, fixed per kind.
 *
 * Deliberately not generated: these commits record a step having happened, so
 * a per-commit summary would be noise an operator has to read past, and would
 * make the history harder to scan rather than easier.
 */
const SUBJECT: Record<FailForwardKind, string> = {
  "loop-leftover": "chore(run): fail-forward commit of work left after the run",
};

/** What the producer trailer says, so these commits are greppable by kind. */
const PRODUCER: Record<FailForwardKind, string> = {
  "loop-leftover": "fail-forward (loop boundary)",
};

export interface FailForwardCommitResult {
  /** True when a commit was actually made. */
  committed: boolean;
  /** Paths staged and committed. Empty when nothing was eligible. */
  paths: string[];
  /** Paths deliberately left alone, with the reason, for the caller to report. */
  skipped: Array<{ path: string; reason: "unmerged" | "staged" }>;
  /** Set when git refused; the caller falls back to its normal behaviour. */
  error?: Error;
}

async function git(projectDir: string, args: string[]): Promise<string> {
  return execStdout("git", args, { cwd: projectDir, timeout: 15_000 });
}

/**
 * Split `paths` into those safe to commit and those that belong to someone
 * else, by re-reading each one's porcelain status.
 *
 * `core.quotepath=false` matters: without it git renders a non-ASCII path as
 * an escaped, quoted string that matches no file, so a repository with a
 * unicode filename would silently fail every fail-forward commit.
 */
async function partitionPaths(
  projectDir: string,
  paths: string[],
): Promise<{ eligible: string[]; skipped: FailForwardCommitResult["skipped"] }> {
  const eligible: string[] = [];
  const skipped: FailForwardCommitResult["skipped"] = [];

  for (const path of paths) {
    let line: string;
    try {
      line = (await git(projectDir, [
        "-c", "core.quotepath=false",
        "status", "--porcelain", "--untracked-files=all",
        "--", `:(literal)${path}`,
      ])).split("\n").find((l) => l.trim().length > 0) ?? "";
    } catch {
      // Unreadable status for this path: leave it alone rather than guess.
      skipped.push({ path, reason: "staged" });
      continue;
    }
    if (!line) continue; // No longer dirty — nothing to do.

    const index = line[0] ?? " ";
    const worktree = line[1] ?? " ";

    // Unmerged, in any of its porcelain spellings.
    if (index === "U" || worktree === "U" || line.startsWith("AA") || line.startsWith("DD")) {
      skipped.push({ path, reason: "unmerged" });
      continue;
    }
    // Anything with content already in the index is the operator's.
    if (index !== " " && index !== "?") {
      skipped.push({ path, reason: "staged" });
      continue;
    }
    eligible.push(path);
  }

  return { eligible, skipped };
}

/**
 * Stage and commit exactly the eligible subset of `paths`.
 *
 * @param projectDir Repository root for the git invocations.
 * @param paths Project-relative paths, as the dirty-work scan reports them.
 * @param kind Which constant message and producer trailer to use.
 * @param itemId PRD item the work belongs to, when it belongs to one.
 */
export async function commitFailForward(
  projectDir: string,
  paths: string[],
  kind: FailForwardKind,
  itemId?: string,
): Promise<FailForwardCommitResult> {
  if (paths.length === 0) return { committed: false, paths: [], skipped: [] };

  const operation = await operationInProgress(projectDir);
  if (operation) {
    // Committing into a conflicted tree is how markers reach history.
    return {
      committed: false,
      paths: [],
      skipped: [],
      error: new Error(
        `a ${operation.toLowerCase().replace(/_head$/, "").replace("rebase-", "rebase ")} is in progress`,
      ),
    };
  }

  const { eligible, skipped } = await partitionPaths(projectDir, paths);
  if (eligible.length === 0) return { committed: false, paths: [], skipped };

  /** Staged so far, so a later failure can put the index back. */
  const staged: string[] = [];
  const unstage = async (): Promise<void> => {
    if (staged.length === 0) return;
    try {
      await execGitMutation(projectDir, ["reset", "-q", "--", ...staged], 15_000);
    } catch {
      // Best effort. The caller is already reporting a failure, and leaving
      // the index as-is is better than throwing over the cleanup.
    }
  };

  try {
    // One `git add` per path, pathspec-literal: a path is a path here and
    // never a glob, a file named with a bracket or a star stages as itself,
    // and `--` stops a leading-dash name reading as a flag. A deleted file
    // stages as a deletion, which is what `git add` does for a missing path
    // given explicitly.
    for (const path of eligible) {
      await execGitMutation(projectDir, ["add", "--", `:(literal)${path}`], 15_000);
      staged.push(path);
    }
  } catch (err) {
    await unstage();
    return { committed: false, paths: [], skipped, error: err as Error };
  }

  try {
    // One `-m` for the whole trailer block: a second `-m` inserts a blank
    // line, which ends the block and leaves the rest as body text git will
    // not parse as trailers.
    const trailers = [
      `N-DX: ${PRODUCER[kind]}`,
      ...(itemId ? [`N-DX-Item: ${itemId}`] : []),
      buildCoAuthoredByTrailerLine(),
    ].join("\n");

    // `:(literal)` on the commit pathspec too: without it a filename holding a
    // glob character would widen the commit to every path it matches, taking
    // their working-tree content even though they were never added.
    await execGitMutation(
      projectDir,
      [
        "commit", "-m", SUBJECT[kind], "-m", trailers,
        "--", ...eligible.map((p) => `:(literal)${p}`),
      ],
      30_000,
    );
  } catch (err) {
    await unstage();
    return { committed: false, paths: [], skipped, error: err as Error };
  }

  return { committed: true, paths: eligible, skipped };
}

/** The subject a given kind commits under. Exported for tests and messages. */
export function failForwardSubject(kind: FailForwardKind): string {
  return SUBJECT[kind];
}
