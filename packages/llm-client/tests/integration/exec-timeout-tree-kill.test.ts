import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exec } from "../../src/exec.js";

/**
 * A timeout must actually stop the command.
 *
 * `exec` used to delegate to Node's execFile timeout, which signals only the
 * direct child. Anything that child had itself started survived — kept running,
 * kept writing to the workspace — while the caller had already been told the
 * command stopped. For an autonomous agent that report is the cue to read files
 * and move on, so a process still writing underneath it can corrupt the state
 * the agent then reads.
 *
 * These cases use a real process tree rather than injected seams: the whole point
 * is what the OS does with descendants, which a mock cannot tell us. The
 * platform-branch selection is covered separately in
 * tests/unit/process-tree.test.ts, which runs both branches on any host.
 *
 * THE INTERMEDIATE MUST NOT BE NODE. libuv assigns every non-detached child it
 * spawns on Windows to a global job object with KILL_ON_JOB_CLOSE, so a tree of
 * node processes reaps itself when the middle one dies — measured: a node
 * intermediate left 4 tick files and a dead grandchild, while `sh` in the same
 * position left a live grandchild that went on to write 15. Using node here would
 * make this suite pass on Windows for a reason that has nothing to do with the
 * fix. `sh -c` is also the real production path (hench's execShell), and the same
 * exposure applies to any non-libuv intermediate: cmd, make, pnpm shims.
 */
/**
 * Both termination policies, run against the same real process tree.
 *
 * `freeze: undefined` takes the default — the flag is off unless
 * NDX_POSIX_FREEZE_KILL is set, so this is the sweep. `freeze: true` opts into the
 * BETA freeze-verify-kill path explicitly, which is the only way it gets
 * real-process coverage: its unit tests inject every seam, and shipping it behind a
 * default-off flag means an ordinary CI run would never enter it. That combination
 * — a path exercised only through injected seams — is exactly what let the
 * execFile `detached` defect reach main.
 *
 * `freeze` is passed per call rather than via the environment so the two runs stay
 * independent inside one file, with no process-level state to leak between them.
 *
 * On Windows the freeze parameter is inert (no SIGSTOP exists there), so the second
 * pass asserts that asking for it does not break the Windows path rather than
 * exercising the freeze itself.
 */
const POLICIES = [
  { name: "default sweep", freeze: undefined },
  { name: "freeze-verify-kill (BETA)", freeze: true },
] as const;

describe.each(POLICIES)("exec timeout terminates the whole process tree — $name", ({ freeze }) => {
  let dir: string;

  /** Wall-clock room for the grandchild to prove it is still writing. */
  const OBSERVE_MS = 2000;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "exec-treekill-"));

    // The grandchild announces its pid, then keeps writing a file per tick. Tick
    // files (rather than one appended file) make "did anything happen after the
    // timeout?" a directory listing rather than a parse.
    await writeFile(
      join(dir, "grandchild.js"),
      [
        "const fs = require('fs');",
        "const path = require('path');",
        "fs.writeFileSync(path.join(__dirname, 'pid.txt'), String(process.pid));",
        "let n = 0;",
        "setInterval(() => {",
        "  n++;",
        "  fs.writeFileSync(path.join(__dirname, `tick-${n}.txt`), 'x');",
        "}, 150);",
      ].join("\n"),
      "utf-8",
    );

  });

  /**
   * Run the tree: `sh` is the direct child, node the grandchild. The command is
   * relative because cwd is the temp dir — an absolute Windows path inside a
   * `sh -c` string would have its backslashes eaten as escapes.
   */
  function runTimingOut(timeout = 700) {
    return exec("sh", ["-c", "node grandchild.js"], { cwd: dir, timeout, freeze });
  }

  afterEach(async () => {
    // Reap anything the test itself leaked, so a failure here cannot wedge later
    // runs (and, on Windows, cannot hold the temp dir).
    const pid = readPid();
    if (pid !== null && isAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function readPid(): number | null {
    try {
      const raw = readFileSync(join(dir, "pid.txt"), "utf-8").trim();
      const pid = Number.parseInt(raw, 10);
      return Number.isInteger(pid) ? pid : null;
    } catch {
      return null;
    }
  }

  /** Signal 0 delivers nothing; it just runs the kernel's existence check. */
  function isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async function tickCount(): Promise<number> {
    const entries = await readdir(dir);
    return entries.filter((e) => e.startsWith("tick-")).length;
  }

  it("reports the timeout, and the command really was still running", async () => {
    const result = await runTimingOut();

    // exitCode null is this module's timeout signal — unchanged contract.
    expect(result.exitCode).toBe(null);

    // Guards against the whole suite passing vacuously: if the grandchild never
    // started, "nothing was written after the timeout" would prove nothing. At
    // 150ms per tick under a 700ms timeout it should manage several.
    expect(await tickCount()).toBeGreaterThan(0);
    expect(readPid()).not.toBe(null);
  });

  it("leaves no descendant process running", async () => {
    await runTimingOut();

    const pid = readPid();
    expect(pid).not.toBe(null);

    // Give the kill a moment to be reaped, then require it to be gone. Polling
    // rather than a fixed sleep so a fast machine does not wait needlessly and a
    // slow one does not fail spuriously.
    const deadline = Date.now() + 3000;
    while (isAlive(pid!) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(isAlive(pid!)).toBe(false);
  });

  it("stops writing to the workspace once the timeout is reported", async () => {
    await runTimingOut();

    const atTimeout = await tickCount();
    await new Promise((r) => setTimeout(r, OBSERVE_MS));
    const afterObserving = await tickCount();

    // The grandchild writes every 150ms, so a survivor would add ~13 files here.
    expect(afterObserving).toBe(atTimeout);
  });
});
