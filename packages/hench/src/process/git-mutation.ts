/** Checked Git mutations for lifecycle operations that must preserve failures. */

import { exec } from "./exec.js";
import type { ExecResult } from "./exec.js";

/** Turn a failed structured Git result into the original command failure. */
function gitMutationError(result: ExecResult): Error {
  return result.error ?? new Error(result.stderr.trim() || result.stdout.trim() || "Git command failed");
}

/** Execute Git and reject when the command did not complete successfully. */
export async function execCheckedGit(
  projectDir: string,
  args: string[],
  timeout: number,
): Promise<ExecResult> {
  const result = await exec("git", args, { cwd: projectDir, timeout });
  if (!result.launched || result.exitCode !== 0) {
    throw gitMutationError(result);
  }
  return result;
}

/** Execute a Git mutation and reject when Git did not complete it. */
export async function execGitMutation(
  projectDir: string,
  args: string[],
  timeout: number,
): Promise<void> {
  await execCheckedGit(projectDir, args, timeout);
}
