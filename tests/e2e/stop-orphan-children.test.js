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
    await writeFile(
      join(dir, "server.js"),
      [
        "const { spawn } = require('child_process');",
        "spawn('sh', ['-c', 'node child.js'], { cwd: __dirname, stdio: 'ignore' });",
        "setTimeout(() => {}, 60000);",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(async () => {
    // Reap whatever the test itself leaked, so one failure cannot wedge later runs
    // or (on Windows) hold the temp directory open.
    for (const pid of [server?.pid, readChildPid()].filter((p) => typeof p === "number")) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
    server = null;
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  function readChildPid() {
    try {
      const pid = Number.parseInt(readFileSync(join(dir, "child.pid"), "utf-8").trim(), 10);
      return Number.isInteger(pid) ? pid : null;
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

  it("kills the child, not just the recorded server pid", async () => {
    // `detached: true` mirrors how web.js starts the background server — which is
    // precisely what makes the children unreachable by default on Windows.
    server = spawn(process.execPath, [join(dir, "server.js")], {
      cwd: dir,
      stdio: "ignore",
      detached: true,
    });

    // Wait until the child is genuinely up and working, so a pass cannot mean
    // "nothing was ever running".
    expect(await waitFor(async () => readChildPid() !== null && (await tickCount()) > 0)).toBe(true);
    const childPid = readChildPid();
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
