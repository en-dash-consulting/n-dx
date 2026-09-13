/**
 * The cleanup gate is terminal: work unblocked by killing an in-flight child
 * can spawn its replacement after cleanup's snapshot, so that replacement must
 * die immediately instead of being adopted into a set no future sweep drains.
 *
 * These use real processes. The unit tests verify the selected signals with
 * fakes; this suite proves those signals actually remove an OS process.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
  createChildProcessTracker,
  treeKillSpawnOptions,
} from "../../packages/core/child-lifecycle.js";

const EXIT_TIMEOUT_MS = 3_000;

/** @type {number[]} */
let pidsToReap = [];

function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid, label) {
  const deadline = Date.now() + EXIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`${label} (pid ${pid}) remained alive after the cleanup gate.`);
}

function waitForGrandchildPid(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      finish(reject, new Error("Timed out waiting for the detached child to spawn its grandchild."));
    }, EXIT_TIMEOUT_MS);

    const onData = (chunk) => {
      output += chunk;
      const pid = Number.parseInt(output, 10);
      if (Number.isInteger(pid)) finish(resolve, pid);
    };
    const onError = (error) => finish(reject, error);
    const onExit = () => finish(reject, new Error(`Detached child exited before reporting its grandchild PID: ${output}`));

    function finish(settle, value) {
      clearTimeout(timeout);
      child.stdout.removeListener("data", onData);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      settle(value);
    }

    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

afterEach(() => {
  for (const pid of pidsToReap) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The assertion already proved this child exited.
    }
  }
  pidsToReap = [];
});

describe("late child registration after the cleanup gate", () => {
  it("kills a real late child rather than only recording SIGKILL", async () => {
    const tracker = createChildProcessTracker();
    await tracker.cleanup();

    const child = tracker.register(
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }),
    );
    pidsToReap = [child.pid];

    await waitForPidExit(child.pid, "Late child");
  });
});

const describePosix = process.platform === "win32" ? describe.skip : describe;

describePosix("late detached child registration after the cleanup gate", () => {
  it("group-kills the real child and grandchild", async () => {
    const tracker = createChildProcessTracker({ treeKill: true });
    await tracker.cleanup();

    const child = spawn(
      process.execPath,
      [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          "process.stdout.write(String(grandchild.pid));",
          "setInterval(() => {}, 1000);",
        ].join(" "),
      ],
      { stdio: ["ignore", "pipe", "ignore"], ...treeKillSpawnOptions() },
    );
    const grandchildPid = await waitForGrandchildPid(child);
    pidsToReap = [child.pid, grandchildPid];

    tracker.register(child);

    await Promise.all([
      waitForPidExit(child.pid, "Late detached child"),
      waitForPidExit(grandchildPid, "Late detached grandchild"),
    ]);
  });
});
