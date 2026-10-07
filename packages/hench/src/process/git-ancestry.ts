/**
 * Commit-ancestry probe.
 *
 * Routed through the shared exec helper like every other git call in hench —
 * never `node:child_process` (tests/e2e/architecture-policy.test.js).
 */

import { exec } from "./exec.js";

/**
 * True when `commit` is an ancestor of (or equal to) `HEAD` in `projectDir`.
 *
 * `git merge-base --is-ancestor` exits 0 for yes and 1 for no. Anything else —
 * an unknown commit, no repository, git missing — is reported as false: the
 * callers ask "is this work still in HEAD?", and "could not tell" must not
 * read as yes.
 */
export async function isAncestorOfHead(projectDir: string, commit: string): Promise<boolean> {
  const result = await exec("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
    cwd: projectDir,
    timeout: 10_000,
  });
  return result.exitCode === 0;
}
