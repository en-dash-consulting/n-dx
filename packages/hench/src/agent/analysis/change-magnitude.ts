/**
 * Measure the magnitude of uncommitted working-tree changes.
 *
 * Checkpoint decisions (pre-run commit gate, future baseline checks) need to
 * know not just *whether* the tree is dirty but *how big* the dirt is, so a
 * one-line tweak can pass quietly while a sprawling refactor escalates.
 * This module is the single shared size check for all such call sites.
 *
 * @module hench/agent/analysis/change-magnitude
 */

import { execStdout } from "../../process/exec.js";

/** Size of the uncommitted changes in the working tree. */
export interface ChangeMagnitude {
  /** Dirty paths reported by `git status --porcelain` (includes untracked). */
  files: number;
  /**
   * Total insertions + deletions vs HEAD from `git diff HEAD --numstat`
   * (staged and unstaged combined). Binary files and untracked files
   * contribute to `files` but not to `linesChanged`.
   */
  linesChanged: number;
}

type ExecFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout: number },
) => Promise<string>;

/**
 * Sum insertions + deletions from `git diff --numstat` output.
 * Numstat lines are "INSERTIONS\tDELETIONS\tPATH"; binary files report "-"
 * for both counts and are skipped.
 */
export function sumNumstatLines(output: string): number {
  let total = 0;
  for (const line of output.split("\n")) {
    const [ins, del] = line.split("\t");
    const insN = Number.parseInt(ins ?? "", 10);
    const delN = Number.parseInt(del ?? "", 10);
    if (Number.isFinite(insN)) total += insN;
    if (Number.isFinite(delN)) total += delN;
  }
  return total;
}

/**
 * Measure the uncommitted change magnitude of a working tree.
 *
 * Never throws: on any git failure (not a repo, no HEAD yet, git missing)
 * the failing dimension degrades to 0 so callers can treat the result as
 * "no measurable changes" rather than aborting the checkpoint decision.
 */
export async function measureChangeMagnitude(
  projectDir: string,
  exec: ExecFn = execStdout,
): Promise<ChangeMagnitude> {
  let files = 0;
  let linesChanged = 0;
  try {
    const status = await exec("git", ["status", "--porcelain"], {
      cwd: projectDir,
      timeout: 15_000,
    });
    files = status.trim().split("\n").filter(Boolean).length;
  } catch {
    // Not a git repo or git unavailable — report zero files.
  }
  try {
    const numstat = await exec("git", ["diff", "HEAD", "--numstat"], {
      cwd: projectDir,
      timeout: 15_000,
    });
    linesChanged = sumNumstatLines(numstat);
  } catch {
    // No HEAD yet (fresh repo) or git failure — report zero lines.
  }
  return { files, linesChanged };
}
