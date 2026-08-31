/**
 * Guard for tests that spawn a POSIX shell.
 *
 * `sh -c` is load-bearing in the process-tree tests — libuv puts every
 * non-detached child it spawns on Windows into a global job object, so a node
 * intermediate is reaped for free and proves nothing, while `sh` is not
 * libuv-managed and its children genuinely escape.
 *
 * It is no longer the only production path: since 2026-08-31 `execShellCmd`
 * falls back to `cmd.exe` on win32 without `sh` (see `resolveShellInvocation`).
 * These tests still need `sh` specifically, for the job-object reason above.
 *
 * But `sh` is absent from a stock Windows PATH: it ships with Git for Windows,
 * which Git Bash exposes and PowerShell/cmd.exe do not. Without this guard the
 * same commit passed from Git Bash and failed from PowerShell, and the failures
 * read as tree-kill defects rather than as a missing shell.
 *
 * Twin of tests/helpers/posix-shell.js, which serves the root suite. Kept
 * separate rather than imported across the boundary: a package's tests do not
 * reach into the repo-root test tree. Both delegate to the same production probe,
 * so only the wording is duplicated.
 *
 * @see tests/shell-spawn-inventory.md — every shell-spawning test and its guard
 */

import { describe } from "vitest";
import { isExecutableOnPath } from "../../src/exec.js";

/** The shell these tests spawn. */
export const POSIX_SHELL = "sh";

let resolved: boolean | undefined;

/** Whether `sh` can be resolved on PATH. Probed once per process. */
export function hasPosixShell(): boolean {
  if (resolved === undefined) resolved = isExecutableOnPath(POSIX_SHELL);
  return resolved;
}

let announced = false;

function announceOnce(): void {
  if (announced) return;
  announced = true;
  console.warn(
    `\n[posix-shell] \`${POSIX_SHELL}\` is not on PATH, so tests that spawn it were skipped.\n` +
      "  On Windows it ships with Git for Windows at C:\\Program Files\\Git\\usr\\bin\\sh.exe.\n" +
      "  Run the suite from Git Bash, or add that directory to PATH, to exercise them.\n" +
      "  See tests/shell-spawn-inventory.md.\n",
  );
}

/**
 * `describe` for a suite whose every case needs `sh`.
 *
 * Skipping rather than failing: without the shell the suite cannot speak to the
 * behaviour it covers, and red that means "wrong shell" teaches developers to
 * ignore red. The reason travels in the suite name so the reporter states it.
 */
export function describeNeedsPosixShell(name: string, fn: () => void): void {
  if (hasPosixShell()) {
    describe(name, fn);
    return;
  }
  announceOnce();
  describe.skip(`${name} [skipped: no \`${POSIX_SHELL}\` on PATH]`, fn);
}

/**
 * `describe.each` for a parameterised suite whose every case needs `sh`.
 *
 * The caller keeps its own `$name`-style title template; the skip reason is
 * announced rather than spliced into it.
 */
export function describeEachNeedsPosixShell<T>(cases: readonly T[]): ReturnType<typeof describe.each<T>> {
  if (hasPosixShell()) return describe.each(cases);
  announceOnce();
  return describe.skip.each(cases);
}
