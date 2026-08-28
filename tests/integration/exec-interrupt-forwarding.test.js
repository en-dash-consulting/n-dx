/**
 * Ctrl-C must still reach a command that `exec` detached.
 *
 * `treeKill` (on by default) makes the POSIX child a process-group leader so a
 * timeout can reach grandchildren. The side effect is that the terminal's
 * interrupt — delivered to the foreground GROUP, not to a process — stops
 * arriving, so a long-running `run_command` could not be stopped from the
 * keyboard. `exec` forwards it across that gap while the child is alive.
 *
 * ## Why this lives in the ROOT suite
 *
 * This is real-process, platform-divergent behaviour, and the root suite is
 * the only suite every CI job runs: the ubuntu `validate` job runs BOTH the
 * per-package suites (`run-all-tests.mjs packages`) and the root suite, while
 * `smoke-macos` deliberately runs the root suite only and `smoke-windows`
 * runs both (see the SCOPE comments in .github/workflows/ci.yml). Under
 * `packages/llm-client/tests/` this file would run on ubuntu and Windows but
 * never on macOS; here it runs on all three families. The injected-seam unit
 * coverage lives next to the module, in
 * packages/llm-client/tests/unit/interrupt-forwarding.test.ts.
 *
 * ## Why the signal source is injected
 *
 * Emitting SIGINT on the real process would run vitest's own handlers and take
 * the suite down. So the forwarder's production kill path runs against a real
 * group, while only the delivery of the signal TO the parent is faked.
 *
 * `sh` is the intermediate rather than node for the reason spelled out in
 * packages/llm-client/tests/integration/exec-timeout-tree-kill.test.ts: libuv's
 * job object makes a node-only tree reap itself on Windows, which would pass for
 * reasons unrelated to the behaviour under test.
 *
 * @see packages/llm-client/src/interrupt-forwarding.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { describeNeedsPosixShell } from "../helpers/posix-shell.js";

const isWindows = process.platform === "win32";

// ── Listener registration: every host, no shell required ─────────────────────
//
// The registration is observable without raising anything, and it is the
// assertion that differs by platform — so it must genuinely run on every host,
// including a Windows shell with no `sh` on PATH. It therefore spawns node
// directly (no shell intermediate) and lives OUTSIDE the `sh`-gated suite
// below; the cases that follow the signal into a real process GROUP are the
// ones that need the non-libuv intermediate.

describe("exec's interrupt listener registration (all hosts)", () => {
  it("registers a listener only while a detached child runs — and never on Windows", async () => {
    const { exec } = await import("../../packages/llm-client/dist/exec.js");
    const before = process.listenerCount("SIGINT");

    const pending = exec(process.execPath, ["-e", "setTimeout(() => {}, 1500)"], {
      timeout: 10000,
    });

    if (isWindows) {
      // Windows never detaches for tree-kill (taskkill walks by pid), so there
      // is no group gap to bridge and exec must not touch the signal at all.
      // Proving a negative needs a settle window: give any (wrong) registration
      // time to happen before asserting it did not.
      await new Promise((r) => setTimeout(r, 300));
      expect(process.listenerCount("SIGINT")).toBe(before);
    } else {
      // The listener appears once the child is spawned; poll rather than sleep
      // so a slow host cannot turn this into a race.
      const deadline = Date.now() + 5000;
      while (process.listenerCount("SIGINT") !== before + 1 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(process.listenerCount("SIGINT")).toBe(before + 1);
    }

    await pending;

    // Either way nothing is left behind: a listener outliving its child would
    // go on suppressing this process's default SIGINT action for good.
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});

describeNeedsPosixShell("exec forwards interrupts to detached children", () => {
  let dir;
  let exec;
  let InterruptForwarder;

  beforeEach(async () => {
    ({ exec } = await import("../../packages/llm-client/dist/exec.js"));
    ({ InterruptForwarder } = await import(
      "../../packages/llm-client/dist/interrupt-forwarding.js"
    ));

    dir = await mkdtemp(join(tmpdir(), "exec-interrupt-"));

    // Announces its pid, then writes a file per tick, so "did it stop?" is a
    // directory listing rather than a parse.
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

  afterEach(async () => {
    // Reap anything the test leaked, so a failure cannot wedge later runs (or,
    // on Windows, hold the temp dir).
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

  function readPid() {
    try {
      const pid = Number.parseInt(readFileSync(join(dir, "pid.txt"), "utf-8").trim(), 10);
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

  /** A process's group id, or null if it is already gone. POSIX only. */
  function groupOf(pid) {
    try {
      const out = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf-8" });
      const pgid = Number.parseInt(out.trim(), 10);
      return Number.isInteger(pgid) ? pgid : null;
    } catch {
      return null;
    }
  }

  async function tickCount() {
    const entries = await readdir(dir);
    return entries.filter((e) => e.startsWith("tick-")).length;
  }

  /** Wait for the grandchild to announce itself, so nothing asserts vacuously. */
  async function waitForGrandchild() {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const pid = readPid();
      if (pid !== null) return pid;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("grandchild never started");
  }

  function runTree(timeout) {
    return exec("sh", ["-c", "node grandchild.js"], { cwd: dir, timeout });
  }

  it.skipIf(isWindows)("puts the child in a group the terminal would miss", async () => {
    const pending = runTree(3000);
    const grandchildPid = await waitForGrandchild();

    // Sharing the grandchild's group proves the detach took the whole tree with
    // it; differing from ours is precisely why Ctrl-C needs forwarding.
    const group = groupOf(grandchildPid);
    expect(group).not.toBe(null);
    expect(group).not.toBe(groupOf(process.pid));

    await pending;
  });

  it.skipIf(isWindows)("a forwarded interrupt stops the child and its descendants", async () => {
    // Long enough that the interrupt, not the deadline, is what ends it.
    const pending = runTree(30000);
    const grandchildPid = await waitForGrandchild();
    const group = groupOf(grandchildPid);
    expect(group).not.toBe(null);

    // Real kill, faked delivery: the forwarder runs its production path against
    // a live group without vitest's own SIGINT handlers being involved.
    const listeners = new Set();
    const foreign = () => {};
    const host = {
      pid: process.pid,
      on: (_signal, listener) => void listeners.add(listener),
      removeListener: (_signal, listener) => void listeners.delete(listener),
      // Includes a stand-in for a caller that owns shutdown, so the forwarder
      // signals the group and then leaves THIS process alone — re-raising here
      // would kill the test runner.
      listeners: () => [...listeners, foreign],
      kill: (pid, signal) => process.kill(pid, signal),
    };
    new InterruptForwarder({ host }).register(group);
    for (const listener of [...listeners]) listener();

    // Killed by a signal, which is this module's `exitCode: null`.
    const result = await pending;
    expect(result.exitCode).toBe(null);

    const deadline = Date.now() + 5000;
    while (isAlive(grandchildPid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(isAlive(grandchildPid)).toBe(false);

    // And it really stopped working, not just stopped being waited on: at 150ms
    // a tick, a survivor would add several files here.
    const atInterrupt = await tickCount();
    await new Promise((r) => setTimeout(r, 1000));
    expect(await tickCount()).toBe(atInterrupt);
  });
});
