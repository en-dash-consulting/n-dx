/**
 * `ndx start stop` must not orphan the server's children.
 *
 * The background server is spawned `detached: true`, which on Windows puts it
 * OUTSIDE libuv's job object — so nothing reaps its children automatically — and
 * the stop path used to signal only the PID recorded in `.n-dx-web.pid`. On Windows
 * SIGTERM is TerminateProcess, so the server never ran cleanup handlers either.
 * Result: `rex analyze` / `hench run` children survived a stop, holding the port or
 * the workspace.
 *
 * Tested against REAL processes rather than injected seams. The unit tests in
 * tests/unit/child-lifecycle.test.js drive both platform branches with injected
 * signals, which proves the branching but not that taskkill or a group signal
 * actually reaches a grandchild — the same gap that let an earlier POSIX
 * termination defect ship green.
 *
 * The tree here stands in for the server: a detached parent that spawns a child
 * which keeps writing. Driving the full `ndx start stop` command instead would
 * require a bound port AND a dashboard that happens to have spawned work, so the
 * command path is covered separately in cli-start.test.js; the orphan property
 * belongs to the primitive that command now calls.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { terminateTreeByPid } from "../../packages/core/child-lifecycle.js";
import {
  itNeedsPosixShell,
  describeShellStartupFailure,
} from "../helpers/posix-shell.js";

describe("stopping a detached server takes its children with it", () => {
  let dir;
  /** @type {import("node:child_process").ChildProcess | null} */
  let server = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ndx-stop-orphan-"));

    // The grandchild records its pid, then writes a file per tick. Tick files make
    // "is it still working?" a directory listing rather than a parse.
    await writeFile(
      join(dir, "child.js"),
      [
        "const fs = require('fs');",
        "const path = require('path');",
        "fs.writeFileSync(path.join(__dirname, 'child.pid'), String(process.pid));",
        "fs.writeFileSync(path.join(__dirname, 'child.ready'), JSON.stringify({ pid: process.pid }));",
        "let n = 0;",
        "setInterval(() => {",
        "  n++;",
        "  fs.writeFileSync(path.join(__dirname, `tick-${n}.txt`), 'x');",
        "}, 100);",
      ].join("\n"),
      "utf-8",
    );

    // Stands in for the server: spawns work through a SHELL, then stays up.
    //
    // The shell is essential, not incidental. libuv assigns every non-detached
    // child it spawns on Windows to a global job object, so a node process
    // spawning node directly is already reaped when its parent dies — a stand-in
    // built that way passes even with the old pid-only kill, which is exactly how
    // the first version of this test managed to be vacuous. The real server reaches
    // its CLIs through cmd.exe (spawnCli) or `sh -c`, and neither is libuv-managed,
    // so their children escape the job and survive. That is the tree worth testing.
    // Use the exact Node executable that is running this test. On Windows, `sh`
    // can be available through Git for Windows while its PATH does not contain
    // Node; a bare `node child.js` then exits in the shell without ever reaching
    // the fixture. Keep `& wait` so sh remains a real intermediary rather than
    // exec-replacing itself with Node on POSIX.
    //
    // Capture shell stderr and its exit status as well as spawn's error event.
    // The server is a separate process, so writing that information to the temp
    // directory makes a missing executable actionable instead of a five-second
    // readiness timeout with no diagnosis.
    await writeFile(
      join(dir, "server.js"),
      [
        "const fs = require('fs');",
        "const path = require('path');",
        "const { spawn } = require('child_process');",
        "fs.writeFileSync(path.join(__dirname, 'server.ready'), JSON.stringify({ pid: process.pid }));",
        `const shellCommand = ${JSON.stringify(`${JSON.stringify(process.execPath)} child.js & wait`)};`,
        "const child = spawn('sh', ['-c', shellCommand], { cwd: __dirname, stdio: ['ignore', 'ignore', 'pipe'] });",
        "const launchErrorPath = path.join(__dirname, 'launch-error.txt');",
        "if (child.pid !== undefined) fs.writeFileSync(path.join(__dirname, 'shell.pid'), String(child.pid));",
        "let stderr = '';",
        "child.stderr.setEncoding('utf8');",
        "child.stderr.on('data', (chunk) => { stderr += chunk; });",
        "child.on('error', (err) => {",
        "  fs.appendFileSync(launchErrorPath, `Could not launch sh: ${String(err && err.message || err)}\\n`);",
        "});",
        "child.on('close', (code, signal) => {",
        "  if (code === 0 && signal === null) return;",
        "  fs.appendFileSync(launchErrorPath, `sh exited with code ${code} and signal ${signal}.\\n${stderr}`);",
        "});",
        "setTimeout(() => {}, 60000);",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(async () => {
    // Reap every known member individually as a backstop. The assertion itself
    // exercises tree termination from the server PID; teardown must also handle a
    // failure before child.ready exists, when only the shell PID was recorded.
    // Waiting for disappearance before rm is necessary on Windows, where a process
    // with cwd or an open file in this directory prevents its removal.
    const pids = [...new Set([server?.pid, readShellPid(), readChildPid()])]
      .filter((pid) => typeof pid === "number");
    await Promise.allSettled(
      pids.map((pid) => terminateTreeByPid(pid, { forceKillTimeoutMs: 500 })),
    );
    for (const pid of pids) {
      if (!isAlive(pid)) continue;
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (isAlive(pid)) throw error;
      }
    }
    expect(await waitFor(() => pids.every((pid) => !isAlive(pid)))).toBe(true);
    server = null;
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  /** Shell spawn or child-executable failure recorded by the stand-in server. */
  function readLaunchError() {
    try {
      return readFileSync(join(dir, "launch-error.txt"), "utf-8").trim() || null;
    } catch {
      return null;
    }
  }

  function readRecordedPid(name) {
    try {
      const pid = Number.parseInt(readFileSync(join(dir, name), "utf-8").trim(), 10);
      return Number.isInteger(pid) ? pid : null;
    } catch {
      return null;
    }
  }

  function readChildPid() {
    return readRecordedPid("child.pid");
  }

  function readShellPid() {
    return readRecordedPid("shell.pid");
  }

  /** The detached server owns this record; it separates its startup from its child's. */
  function readReadyServerPid() {
    try {
      const ready = JSON.parse(readFileSync(join(dir, "server.ready"), "utf-8"));
      return Number.isInteger(ready?.pid) ? ready.pid : null;
    } catch {
      return null;
    }
  }

  /** The child owns this record; it is the startup handshake, not a timer guess. */
  function readReadyChildPid() {
    try {
      const ready = JSON.parse(readFileSync(join(dir, "child.ready"), "utf-8"));
      return Number.isInteger(ready?.pid) ? ready.pid : null;
    } catch {
      return null;
    }
  }

  /** Signal 0 delivers nothing; it just runs the kernel's existence check. */
  function isAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async function tickCount() {
    return (await readdir(dir)).filter((f) => f.startsWith("tick-")).length;
  }

  async function waitFor(predicate, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  }

  itNeedsPosixShell("kills the child, not just the recorded server pid", async () => {
    // `detached: true` mirrors how web.js starts the background server — which is
    // precisely what makes the children unreachable by default on Windows.
    server = spawn(process.execPath, [join(dir, "server.js")], {
      cwd: dir,
      stdio: "ignore",
      detached: true,
    });
    let serverLaunchError = null;
    server.once("error", (error) => {
      serverLaunchError = `Could not launch the detached stand-in server: ${error.message}`;
    });

    // The server's record must arrive before we attribute any delay to the shell
    // or its Node grandchild. Windows CI can defer a detached process long enough
    // to make an otherwise healthy child readiness timeout misleading.
    if (!(await waitFor(() => serverLaunchError !== null || readReadyServerPid() !== null))) {
      throw new Error(
        serverLaunchError ?? "The detached stand-in server never announced startup.",
      );
    }
    if (serverLaunchError) throw new Error(serverLaunchError);
    expect(readReadyServerPid()).toBe(server.pid);

    // The ready record establishes that the grandchild started; a tick then proves
    // it is doing the work whose absence we assert below. On expiry, include the
    // shell's exact diagnostic so a missing executable is not mistaken for an
    // orphan-cleanup regression.
    if (!(await waitFor(async () => readReadyChildPid() !== null && (await tickCount()) > 0))) {
      throw new Error(
        describeShellStartupFailure({
          what: "The stand-in server's grandchild",
          recordedError: readLaunchError(),
        }),
      );
    }
    const childPid = readReadyChildPid();
    expect(childPid).not.toBe(null);
    expect(isAlive(childPid)).toBe(true);

    // The stop path has only a pid, read from a file written by another process.
    await terminateTreeByPid(server.pid, { forceKillTimeoutMs: 2000 });

    expect(await waitFor(async () => !isAlive(server.pid))).toBe(true);
    expect(await waitFor(async () => !isAlive(childPid))).toBe(true);

    // And it stopped working, not merely became unsignallable: a survivor writing
    // every 100ms would add ~10 files over this window.
    const atStop = await tickCount();
    await new Promise((r) => setTimeout(r, 1000));
    expect(await tickCount()).toBe(atStop);
  });

  it("reports success for a pid that is already gone", async () => {
    // Stale pid files are the common case — the server crashed and nobody cleaned
    // up. The primitive must not treat that as a failure to stop.
    const shortLived = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    const pid = shortLived.pid;
    await new Promise((resolve) => shortLived.once("exit", resolve));

    expect(await terminateTreeByPid(pid, { forceKillTimeoutMs: 500 })).toBe(true);
  });
});
