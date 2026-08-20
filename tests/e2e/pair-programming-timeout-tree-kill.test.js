/**
 * pair-programming's timeout paths must not orphan the command's children.
 *
 * `runShellTestCommand` spawns with `shell: true`, so the child it holds is the
 * SHELL, not the test command. A bare `child.kill("SIGTERM")` therefore signalled
 * the shell and left the command it launched running — with its stdout pipe
 * already abandoned by the resolved promise. A timed-out `npm test` kept compiling
 * in the background, holding the workspace and the ports it had bound.
 *
 * Tested against REAL processes, not injected seams. tests/unit/child-lifecycle.test.js
 * drives both platform branches with injected signals, which proves the branching
 * but not that a group signal or taskkill actually reaches a grandchild — the same
 * gap that let an earlier POSIX termination defect ship green.
 *
 * WHY THE COMMANDS BELOW CONTAIN `&& echo`, which looks like noise but is the
 * difference between this test being real and being vacuous: `sh -c 'node x.js'`
 * is a single simple command, and POSIX shells optimise that by *exec-replacing*
 * themselves with node. The shell pid then IS the node pid, so killing "the shell"
 * kills the command and the orphan cannot reproduce. Adding a shell operator
 * forces the shell to fork and stay resident as a real parent, which is the shape
 * every actual test command has (`npm test` spawns workers beneath itself).
 * cmd.exe never exec-replaces, so Windows reproduces it either way.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runShellTestCommand } from "../../packages/core/pair-programming.js";

describe("a timed-out shell test command takes its children with it", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ndx-pair-timeout-"));

    // Records its pid, then writes a file per tick. Tick files make "is it still
    // working?" a directory listing rather than a signal probe, which matters
    // because a process can be unsignallable and still be doing damage.
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

    // Same, but refuses SIGTERM. On POSIX this can only be killed by escalating to
    // SIGKILL; on Windows SIGTERM is TerminateProcess and cannot be trapped at all,
    // so the handler is inert there and the assertion holds for a different reason.
    // Asserting the OUTCOME rather than the signal is what makes one test cover both.
    await writeFile(
      join(dir, "stubborn.js"),
      [
        "const fs = require('fs');",
        "const path = require('path');",
        "process.on('SIGTERM', () => { /* deliberately ignored */ });",
        "fs.writeFileSync(path.join(__dirname, 'child.pid'), String(process.pid));",
        "let n = 0;",
        "setInterval(() => {",
        "  n++;",
        "  fs.writeFileSync(path.join(__dirname, `tick-${n}.txt`), 'x');",
        "}, 100);",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(async () => {
    // Reap whatever the test itself leaked, so one failure cannot wedge later runs
    // or (on Windows) hold the temp directory open.
    const pid = readChildPid();
    if (typeof pid === "number") {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
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

  /**
   * Wait (bounded) for a pid to disappear.
   *
   * WHY THIS POLLS, having deliberately not polled at first. The strict form —
   * asserting the child is already gone the instant the promise settles — reads
   * like the stronger test, and it passed on Windows, where taskkill /T /F removes
   * the tree synchronously. It FAILED on macOS CI, because on POSIX pid-absence is
   * not synchronous with "the kill completed": SIGKILL delivery and reaping are
   * asynchronous, and `kill(pid, 0)` still succeeds for a process that has been
   * killed but not yet reaped. The escalation case exposes that window because the
   * SIGKILL lands at the very end of the awaited termination rather than at the
   * start.
   *
   * So pid-liveness cannot carry the "settled only after termination" claim on
   * POSIX. The frozen tick count below carries it instead — a process that is gone
   * writes nothing — and this bounded wait covers the reap window. Matching
   * packages/llm-client/tests/integration/exec-timeout-tree-kill.test.ts, which
   * polls for the same reason.
   */
  async function waitForDeath(pid, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (isAlive(pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return !isAlive(pid);
  }

  it("kills the command beneath the shell, not just the shell", async () => {
    const result = await runShellTestCommand("node child.js && echo done", dir, 1_500);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("timed out");

    // The command genuinely ran and was genuinely working, so a pass cannot mean
    // "nothing was ever there to orphan".
    const childPid = readChildPid();
    expect(childPid, "the test command never started — the test would be vacuous").not.toBe(null);
    const atResolve = await tickCount();
    expect(atResolve, "the test command never did any work").toBeGreaterThan(0);

    expect(await waitForDeath(childPid), "child survived the timeout").toBe(true);

    // The load-bearing assertion, and the reap-independent one: the tree stopped
    // WORKING by the time the timeout was reported. atResolve was sampled the
    // instant the promise settled, so a tree still running then would add ~6 files
    // over this window. This is what pins "does not settle until termination",
    // which pid-liveness cannot do on POSIX — see waitForDeath.
    await new Promise((r) => setTimeout(r, 600));
    expect(await tickCount()).toBe(atResolve);
  });

  it("escalates to SIGKILL when the command ignores SIGTERM", async () => {
    const result = await runShellTestCommand("node stubborn.js && echo done", dir, 1_500);

    expect(result.output).toContain("timed out");

    const childPid = readChildPid();
    expect(childPid, "the stubborn command never started").not.toBe(null);
    const atResolve = await tickCount();
    expect(atResolve, "the stubborn command never did any work").toBeGreaterThan(0);

    // A SIGTERM-ignoring child is the whole point: without escalation it survives
    // its own timeout indefinitely. Bounded wait rather than an instant check —
    // this is the case that exposed the POSIX reap window, see waitForDeath.
    expect(await waitForDeath(childPid), "SIGTERM-ignoring child survived the timeout").toBe(true);

    await new Promise((r) => setTimeout(r, 600));
    expect(await tickCount()).toBe(atResolve);
  });

  it("hands the spawned child to the caller's tracker", async () => {
    // The other half of spawning detached. A detached child is no longer in this
    // process's foreground group, so Ctrl-C stops reaching it and only the tracker
    // can clean it up — dropping this wrapping would trade a timeout orphan for an
    // interrupt orphan, silently, because registerChild defaults to a no-op.
    const seen = [];
    const result = await runShellTestCommand(
      "node -e \"console.log('ok')\"",
      dir,
      30_000,
      (child) => {
        seen.push(child);
        return child;
      },
    );

    expect(result.exitCode).toBe(0);
    expect(seen).toHaveLength(1);
    expect(typeof seen[0].pid).toBe("number");
  });

  it("still reports a normal exit when the command finishes in time", async () => {
    // The timeout path is the one being changed, so pin that the ordinary path is
    // untouched — a tree kill wired into the wrong place would show up here.
    const result = await runShellTestCommand("node -e \"console.log('quick')\"", dir, 30_000);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("quick");
    expect(result.output).not.toContain("timed out");
  });
});
