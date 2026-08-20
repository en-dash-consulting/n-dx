/**
 * Cross-package parity guard for process-tree termination.
 *
 * Tree-kill logic is intentionally duplicated between two packages, because the
 * orchestration tier must not import from packages (spawn-only rule):
 *   - packages/llm-client/src/process-tree.ts   (foundation — used by `exec`, so
 *                                                every hench/rex/web child gets it)
 *   - packages/core/child-lifecycle.js          (orchestration twin — used by
 *                                                cli.js's child tracker)
 *
 * This is the same constraint that forces the `quoteWindowsToken` twin; see
 * windows-quoting-parity.test.js for the established pattern.
 *
 * A divergence means one tier stops killing descendants that the other kills —
 * silently, and only on one OS. These assertions pin the two decisions that must
 * agree: the argv used to kill a tree on Windows, and whether a child is spawned
 * as a process-group leader.
 *
 * BOTH twins are imported from SOURCE, for the reason documented at length in
 * windows-quoting-parity.test.js: comparing a source twin against a compiled one
 * makes an unbuilt change look like a divergence.
 */
import { describe, it, expect } from "vitest";
import {
  treeKillCommand as treeKillCommandLlm,
  treeKillSpawnOptions as spawnOptionsLlm,
} from "../../packages/llm-client/src/process-tree.ts";
import {
  treeKillCommand as treeKillCommandCore,
  treeKillSpawnOptions as spawnOptionsCore,
} from "../../packages/core/child-lifecycle.js";

/** Pids worth checking: ordinary, single-digit, and large. */
const PIDS = [1234, 7, 999999];

/** Every platform either twin might see. */
const PLATFORMS = ["win32", "linux", "darwin", "freebsd"];

describe("tree-kill parity across the orchestration/foundation twins", () => {
  it("emits identical Windows kill argv", () => {
    for (const pid of PIDS) {
      expect(treeKillCommandLlm(pid)).toEqual(treeKillCommandCore(pid));
    }
  });

  it("agrees on which platforms need a process-group leader", () => {
    for (const platform of PLATFORMS) {
      expect(spawnOptionsLlm(platform)).toEqual(spawnOptionsCore(platform));
    }
  });

  it("still kills the tree forcibly, not just politely", () => {
    // Pinned rather than merely compared: two twins could agree while both
    // drifting to a WM_CLOSE-only `taskkill /T`, which node children ignore.
    for (const twin of [treeKillCommandLlm, treeKillCommandCore]) {
      const { command, args } = twin(1234);
      expect(command).toBe("taskkill");
      expect(args).toContain("/T");
      expect(args).toContain("/F");
    }
  });

  it("only asks for a process group where process groups exist", () => {
    for (const twin of [spawnOptionsLlm, spawnOptionsCore]) {
      expect(twin("win32")).toEqual({});
      expect(twin("linux")).toEqual({ detached: true });
    }
  });
});
