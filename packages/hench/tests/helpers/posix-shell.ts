/**
 * Guard for tests that exercise hench's shell-backed tools.
 *
 * Unlike the process-tree tests, `sh` here is not a test-scaffold choice — it is
 * the behaviour under test. `execShell` runs `exec("sh", ["-c", command])` on
 * EVERY platform (see src/tools/exec-shell.ts and src/tools/test-runner.ts), so
 * `run_command` and the post-task test runner depend on a POSIX shell even on
 * Windows, where it arrives with Git for Windows rather than with the OS.
 *
 * That makes a missing `sh` a real product limitation, not a test artifact. The
 * tests still skip rather than fail, because a red suite that means "this machine
 * has no sh" teaches developers to ignore red — but the skip says which product
 * capability went unverified, and the limitation is recorded in the inventory.
 *
 * Two failure modes this replaces, both from running the suite in PowerShell:
 *   - false failures — 13 cases in tools/shell.test.ts and 2 in
 *     tools/test-runner.test.ts, none of whose messages mentioned a shell;
 *   - a false PASS — "reports exit code on failure without output" asserts the
 *     result contains "Exit code", which a failed spawn satisfies for the wrong
 *     reason.
 *
 * Twin of tests/helpers/posix-shell.js (root suite) and
 * packages/llm-client/tests/helpers/posix-shell.ts. Each delegates to the same
 * production probe; only the wording differs, because what a missing shell means
 * differs per suite.
 *
 * @see tests/shell-spawn-inventory.md — every shell-spawning test and its guard
 */

import { describe, it } from "vitest";
// Through the gateway, like every other hench import from llm-client.
import { isExecutableOnPath } from "../../src/prd/llm-gateway.js";

/** The shell hench's tools spawn, on every platform. */
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
    `\n[posix-shell] \`${POSIX_SHELL}\` is not on PATH, so hench's shell-backed tools ` +
      "could not be exercised.\n" +
      "  These are not scaffolding: run_command and the post-task test runner spawn\n" +
      "  `sh -c` on every platform, so on this machine those tools would not work either.\n" +
      "  On Windows `sh` ships with Git for Windows at C:\\Program Files\\Git\\usr\\bin\\sh.exe.\n" +
      "  Run from Git Bash, or add that directory to PATH, to cover them.\n" +
      "  See tests/shell-spawn-inventory.md.\n",
  );
}

const SKIP_SUFFIX = `[skipped: no \`${POSIX_SHELL}\` on PATH — shell tool unverified]`;

/** `describe` for a suite whose every case reaches a real `sh`. */
export function describeNeedsPosixShell(name: string, fn: () => void): void {
  if (hasPosixShell()) {
    describe(name, fn);
    return;
  }
  announceOnce();
  describe.skip(`${name} ${SKIP_SUFFIX}`, fn);
}

/** `it` for a single case that reaches a real `sh`, among others that do not. */
export function itNeedsPosixShell(name: string, fn: () => Promise<void> | void, timeout?: number): void {
  if (hasPosixShell()) {
    it(name, fn, timeout);
    return;
  }
  announceOnce();
  it.skip(`${name} ${SKIP_SUFFIX}`, fn, timeout);
}
