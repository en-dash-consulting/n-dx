/**
 * Guards for tests that spawn a POSIX shell.
 *
 * Several process-tree tests use `sh -c` to start their grandchild. That is
 * load-bearing, not incidental: libuv assigns every non-detached child it spawns
 * on Windows to a global job object, so a node process spawning node directly is
 * reaped when its parent dies and the test passes without proving anything. `sh`
 * is not libuv-managed, so its children escape the job and the tree is worth
 * testing. `sh -c` is also the real production path (hench's execShell).
 *
 * The catch: `sh` is not on PATH in a stock Windows shell. On Windows it comes
 * from Git for Windows (`C:\Program Files\Git\usr\bin\sh.exe`), which Git Bash
 * puts on PATH and PowerShell/cmd.exe do not. So the same commit passed from Git
 * Bash and failed from PowerShell, and the failures pointed at the behaviour
 * under test rather than at the shell: a bare `expected false to be true` after a
 * 5s wait, because the grandchild that never started also never wrote its pid.
 * Twice investigated as a suspected regression during a merge.
 *
 * Worse than the false failures were the false PASSES: a case asserting "nothing
 * was written after the timeout" is trivially true when nothing ever ran.
 *
 * These helpers make the dependency explicit — the tests skip with `sh` named,
 * instead of failing (or passing) for reasons of their own.
 *
 * @see tests/shell-spawn-inventory.md — every shell-spawning test and its guard
 */

import { describe, it } from "vitest";
// The production probe, so tests answer "can spawn find this?" exactly the way
// the shipped code does. Root-suite tests run against dist/ by convention, and
// tests/e2e/verify-build.js guarantees it exists before any of them load.
import { isExecutableOnPath } from "../../packages/llm-client/dist/exec.js";

/** The shell these tests spawn. */
export const POSIX_SHELL = "sh";

let resolved;

/** Whether `sh` can be resolved on PATH. Probed once per process. */
export function hasPosixShell() {
  if (resolved === undefined) resolved = isExecutableOnPath(POSIX_SHELL);
  return resolved;
}

const REMEDY =
  `\`${POSIX_SHELL}\` is not on PATH, so tests that spawn it were skipped.\n` +
  "  On Windows it ships with Git for Windows at C:\\Program Files\\Git\\usr\\bin\\sh.exe.\n" +
  "  Run the suite from Git Bash, or add that directory to PATH, to exercise them.\n" +
  "  See tests/shell-spawn-inventory.md.";

let announced = false;

/** Explain the skip once per process, rather than once per suite. */
function announceOnce() {
  if (announced) return;
  announced = true;
  console.warn(`\n[posix-shell] ${REMEDY}\n`);
}

/** Suffix that carries the reason into the reporter's skip line. */
const SKIP_SUFFIX = `[skipped: no \`${POSIX_SHELL}\` on PATH]`;

/**
 * `describe` for a suite whose every case needs `sh`.
 *
 * Skipping rather than failing: without `sh` the suite cannot say anything about
 * the behaviour it covers, and a red suite that means "wrong shell" trains
 * developers to ignore red.
 */
export function describeNeedsPosixShell(name, fn) {
  if (hasPosixShell()) return describe(name, fn);
  announceOnce();
  return describe.skip(`${name} ${SKIP_SUFFIX}`, fn);
}

/** `it` for a single case that needs `sh`, in a suite where others do not. */
export function itNeedsPosixShell(name, fn, timeout) {
  if (hasPosixShell()) return it(name, fn, timeout);
  announceOnce();
  return it.skip(`${name} ${SKIP_SUFFIX}`, fn, timeout);
}

/**
 * Explain a startup failure in terms of the shell when that is the cause.
 *
 * For the case where the shell resolved but the spawn still failed — a broken
 * Git install, a PATH entry pointing at a deleted file — the recorded error is
 * the only evidence, so it goes in the message rather than being discarded.
 */
export function describeShellStartupFailure({ what, recordedError }) {
  const lines = [`${what} never started.`];
  if (recordedError) {
    // The error names the binary it tried to launch, so the message does not
    // second-guess it with `sh` — the two differ when a test sabotages the name.
    lines.push(`The spawn reported: ${recordedError}.`);
    lines.push("That is a failure to launch the shell, not a failure of the behaviour under test.");
  } else {
    lines.push(
      `\`${POSIX_SHELL}\` resolved on PATH and the child recorded no spawn error, ` +
        "so this looks like a genuine failure of the behaviour under test.",
    );
  }
  return lines.join(" ");
}
