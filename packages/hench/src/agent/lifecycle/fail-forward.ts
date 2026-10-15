/**
 * Fail-forward mode: commit what a step produced instead of stopping over it.
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
 * Three properties this must keep, because they are what make the mode safe to
 * leave on:
 *
 * - **Scoped.** Staging and the commit both name the paths explicitly. An
 *   operator's half-finished `git add -p` stays staged and uncommitted.
 * - **Constant messages.** Nothing is generated per commit, so there is
 *   nothing to review before it lands and the history reads uniformly.
 * - **Never pushes.** Committing is the whole promise.
 *
 * @module hench/agent/lifecycle/fail-forward
 */

import { execGitMutation } from "../../process/git-mutation.js";
import { buildCoAuthoredByTrailerLine } from "./shared.js";

/** Why a fail-forward commit was made. One constant message per kind. */
export type FailForwardKind = "loop-leftover" | "pre-run";

/**
 * Commit subjects, fixed per kind.
 *
 * Deliberately not generated: these commits record a step having happened, so
 * a per-commit summary would be noise an operator has to read past, and would
 * make the history harder to scan rather than easier.
 */
const SUBJECT: Record<FailForwardKind, string> = {
  "loop-leftover": "chore(run): fail-forward commit of work left after the run",
  "pre-run": "chore(run): fail-forward commit of work found before the run",
};

/** What the producer trailer says, so these commits are greppable by kind. */
const PRODUCER: Record<FailForwardKind, string> = {
  "loop-leftover": "fail-forward (loop boundary)",
  "pre-run": "fail-forward (pre-run gate)",
};

export interface FailForwardCommitResult {
  /** True when a commit was actually made. */
  committed: boolean;
  /** Paths staged and committed. */
  paths: string[];
  /** Set when git refused; the caller falls back to its normal behaviour. */
  error?: Error;
}

/**
 * Stage and commit exactly `paths`.
 *
 * @param projectDir Repository root.
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
  if (paths.length === 0) return { committed: false, paths: [] };

  try {
    // One `git add` per path, pathspec-literal, matching stageRunWork: a path
    // is a path here and never a glob, a file named with a bracket or a star
    // stages as itself, and `--` stops a leading-dash name reading as a flag.
    // A deleted file stages as a deletion, which is what `git add` does for a
    // missing path given explicitly.
    for (const path of paths) {
      await execGitMutation(projectDir, ["add", "--", `:(literal)${path}`], 15_000);
    }
  } catch (err) {
    return { committed: false, paths, error: err as Error };
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

    // The pathspec is load-bearing twice over. It keeps anything the operator
    // had staged before out of this commit, and it makes this a *partial*
    // commit, which git refuses mid-merge — the right outcome, since an
    // unattended run should not quietly extend a merge commit.
    await execGitMutation(
      projectDir,
      ["commit", "-m", SUBJECT[kind], "-m", trailers, "--", ...paths],
      30_000,
    );
  } catch (err) {
    return { committed: false, paths, error: err as Error };
  }

  return { committed: true, paths };
}

/** The subject a given kind commits under. Exported for tests and messages. */
export function failForwardSubject(kind: FailForwardKind): string {
  return SUBJECT[kind];
}
