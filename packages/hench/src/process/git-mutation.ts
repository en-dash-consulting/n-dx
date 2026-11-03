/** Checked Git mutations for lifecycle operations that must preserve failures. */

import { exec } from "./exec.js";
import type { ExecResult } from "./exec.js";
import { prepareConfinedHooks } from "../guard/git-hooks.js";

/**
 * Turn a failed structured Git result into the original command failure.
 *
 * `exec` synthesizes its message from stderr alone, but a pre-commit hook
 * runner or a signing helper usually prints its refusal on stdout — so an
 * stderr-silent failure reached the operator as "Command failed: git commit"
 * with no cause. When stdout carried the only reason, it is appended and the
 * original kept as `cause`.
 */
function gitMutationError(result: ExecResult): Error {
  const reported = result.stderr.trim() || result.stdout.trim();
  if (!result.error) return new Error(reported || "Git command failed");
  if (!reported || result.error.message.includes(reported)) return result.error;

  const separator = result.error.message.endsWith("\n") ? "" : "\n";
  const wrapped = new Error(`${result.error.message}${separator}${reported}`, {
    cause: result.error,
  });
  // Callers that branch on the exit code must still see it after the wrap.
  const code = (result.error as { code?: unknown }).code;
  if (code !== undefined) Object.assign(wrapped, { code });
  return wrapped;
}

/**
 * Execute Git and reject when the command did not complete successfully.
 *
 * Repository hooks run, as they would for a human commit. When the run has
 * an OS sandbox, each hook git starts is re-executed inside it (see
 * `guard/git-hooks.ts`): `commit` and `merge` run the commit hooks, and any
 * index or ref write can run `post-index-change` or `reference-transaction`,
 * so every command here goes through the same path. With the sandbox off or
 * unavailable the hooks run unconfined, which the run's posture line reports.
 */
export async function execCheckedGit(
  projectDir: string,
  args: string[],
  timeout: number,
): Promise<ExecResult> {
  const hooks = await prepareConfinedHooks(projectDir);
  try {
    const argv = hooks ? ["-c", `core.hooksPath=${hooks.hooksPath}`, ...args] : args;
    const result = await exec("git", argv, { cwd: projectDir, timeout });
    if (!result.launched || result.exitCode !== 0) {
      throw gitMutationError(result);
    }
    return result;
  } finally {
    hooks?.dispose();
  }
}

/** Execute a Git mutation and reject when Git did not complete it. */
export async function execGitMutation(
  projectDir: string,
  args: string[],
  timeout: number,
): Promise<void> {
  await execCheckedGit(projectDir, args, timeout);
}
