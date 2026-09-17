/**
 * The cleanup gate is terminal: work unblocked by killing an in-flight child
 * can spawn its replacement after cleanup's snapshot, so that replacement must
 * die immediately instead of being adopted into a set no future sweep drains.
 *
 * These use real processes. The unit tests verify the selected signals with
 * fakes; this suite proves those signals actually remove an OS process. The
 * terminators those paths share are proved the same way in
 * `terminate-tree-liveness.test.js`; the fixtures are common to both.
 */
import { afterEach, describe, it } from "vitest";
import { createChildProcessTracker } from "../../packages/core/child-lifecycle.js";
import {
  reapPids,
  spawnIdleChild,
  spawnProcessTree,
  waitForPidExit,
} from "../helpers/real-process-tree.js";

/** @type {number[]} */
let pidsToReap = [];

afterEach(() => {
  reapPids(pidsToReap);
  pidsToReap = [];
});

describe("late child registration after the cleanup gate", () => {
  it("kills a real late child rather than only recording SIGKILL", async () => {
    const tracker = createChildProcessTracker();
    await tracker.cleanup();

    const child = tracker.register(spawnIdleChild());
    pidsToReap = [child.pid];

    await waitForPidExit(child.pid, "Late child");
  });
});

const describePosix = process.platform === "win32" ? describe.skip : describe;

describePosix("late detached child registration after the cleanup gate", () => {
  it("group-kills the real child and grandchild", async () => {
    const tracker = createChildProcessTracker({ treeKill: true });
    await tracker.cleanup();

    const { child, grandchildPid } = await spawnProcessTree();
    pidsToReap = [child.pid, grandchildPid];

    tracker.register(child);

    await Promise.all([
      waitForPidExit(child.pid, "Late detached child"),
      waitForPidExit(grandchildPid, "Late detached grandchild"),
    ]);
  });
});

const describeWindows = process.platform === "win32" ? describe : describe.skip;

describeWindows("late Windows child registration after the cleanup gate", () => {
  it("tree-kills the real late child and grandchild within the deadline", async () => {
    const tracker = createChildProcessTracker({ treeKill: true });
    await tracker.cleanup();

    const { child, grandchildPid } = await spawnProcessTree();
    pidsToReap = [child.pid, grandchildPid];

    tracker.register(child);

    await Promise.all([
      waitForPidExit(child.pid, "Late Windows child"),
      waitForPidExit(grandchildPid, "Late Windows grandchild"),
    ]);
  });
});
