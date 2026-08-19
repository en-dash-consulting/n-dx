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

    // No polling, deliberately. The promise must not settle until termination has
    // completed, so the child is required to be dead ALREADY — a caller that sees
    // "timed out" must never be able to observe the tree still running. A waitFor
    // here would hide exactly the defect this line exists to catch.
    expect(isAlive(childPid), "child still alive when the timeout was reported").toBe(false);

    // And it stopped working, rather than merely becoming unsignallable: a survivor
    // ticking every 100ms would add ~6 files over this window.
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
    // its own timeout indefinitely.
    expect(isAlive(childPid), "SIGTERM-ignoring child survived the timeout").toBe(false);

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
