/**
 * `execShellCmd` must run a command on Windows with no POSIX shell in reach.
 *
 * The defect this pins: `execShellCmd` was `exec("sh", ["-c", command])` on
 * every platform. On Windows `sh` ships with Git for Windows and is on PATH
 * only inside Git Bash — from PowerShell or cmd.exe, the default shells, it
 * does not resolve. The spawn failed with ENOENT, `exec` reported that as
 * exitCode 1 with empty stdout/stderr, and every caller read it as "the
 * command ran and failed". hench's test gate concluded the suite was broken
 * after essentially every task.
 *
 * WHY A REAL PROCESS. The unit tests in tests/unit/exec.test.ts mock
 * child_process, so they assert which argv we would hand to spawn — they
 * cannot tell us cmd.exe accepts it. That gap is the whole bug: the old code
 * also "correctly" passed `sh -c` to a mocked spawn. These cases run the
 * command for real and read its output back.
 *
 * WHY IT SKIPS. Only Windows has the failure mode, and only Windows has
 * cmd.exe. Skipping rather than faking keeps the suite honest on Linux CI,
 * where the platform branch is covered instead by `buildShellInvocation`,
 * which is pure and asserted on every host.
 *
 * @see tests/shell-spawn-inventory.md — every shell-spawning test and its guard
 */

import { describe, it, expect } from "vitest";
import { delimiter } from "node:path";
import { execShellCmd, buildShellInvocation, isExecutableOnPath } from "../../src/exec.js";

const IS_WINDOWS = process.platform === "win32";
const describeWindows = IS_WINDOWS
  ? describe
  : describe.skip;

/**
 * The parent PATH with every directory that could supply a POSIX shell
 * removed, so nothing the command line touches can fall back to Git Bash.
 *
 * `_posixShellAvailable: false` already forces the cmd.exe branch; this makes
 * the CHILD's environment match the claim, which is what "launched from
 * PowerShell with no Git Bash on PATH" actually means.
 *
 * System32 stays. It holds no `sh`, and libuv resolves the spawned executable
 * against the env it is handed — dropping it took cmd.exe itself off PATH and
 * the suite failed with `launched: false` for the wrong reason.
 */
function pathWithoutPosixShell(): string {
  const entries = (process.env["PATH"] ?? "").split(delimiter);
  const posixish = /git[\\/](usr[\\/])?bin|mingw|msys|cygwin/i;
  return entries.filter((e) => e.length > 0 && !posixish.test(e)).join(delimiter);
}

describeWindows("execShellCmd on Windows without a POSIX shell", () => {
  const envWithoutPosixShell = { ...process.env, PATH: pathWithoutPosixShell() };

  it("runs a command and returns its output", async () => {
    const result = await execShellCmd("echo hardened", {
      cwd: process.cwd(),
      timeout: 30_000,
      env: envWithoutPosixShell,
      _posixShellAvailable: false,
    });

    expect(result.launched).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hardened");
  });

  it("supports && chaining, which callers rely on", async () => {
    const result = await execShellCmd("echo first && echo second", {
      cwd: process.cwd(),
      timeout: 30_000,
      env: envWithoutPosixShell,
      _posixShellAvailable: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("first");
    expect(result.stdout).toContain("second");
  });

  it("reports a non-zero exit as a command that RAN and failed", async () => {
    // The pair that matters: this must be distinguishable from the launch
    // failure below, because a real failing test suite has to stay reportable
    // as a real failing test suite.
    const result = await execShellCmd("exit 3", {
      cwd: process.cwd(),
      timeout: 30_000,
      env: envWithoutPosixShell,
      _posixShellAvailable: false,
    });

    expect(result.launched).toBe(true);
    expect(result.exitCode).toBe(3);
  });

  it("distinguishes a shell that could not be spawned at all", async () => {
    // The pre-fix Windows behaviour, reproduced deliberately by forcing the
    // POSIX branch on a box where `sh` may be absent. Before the fix this same
    // state reported exitCode 1 / launched-unknowable; now `launched` names it.
    if (isExecutableOnPath("sh")) {
      // Git Bash IS installed here, so `sh` spawns and this case cannot be
      // produced without inventing a fake shell name — which would test the
      // wrong thing. buildShellInvocation still proves the branch selection.
      expect(buildShellInvocation("echo hi", "win32", false).cmd).toBe("cmd.exe");
      return;
    }

    const result = await execShellCmd("echo hi", {
      cwd: process.cwd(),
      timeout: 30_000,
      env: envWithoutPosixShell,
      _posixShellAvailable: true, // force the old, broken path
    });

    expect(result.launched).toBe(false);
    expect(result.error).not.toBeNull();
  });

  it("routes through cmd.exe by default when no POSIX shell is on PATH", async () => {
    // No _posixShellAvailable override: this is the production decision, made
    // by the real `where sh` probe on this machine. Whichever way it goes, the
    // command must run — that is the acceptance criterion, not the shell.
    const result = await execShellCmd("echo default-path", {
      cwd: process.cwd(),
      timeout: 30_000,
    });

    expect(result.launched).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("default-path");
  });
});
