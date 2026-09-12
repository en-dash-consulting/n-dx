/**
 * `snapshotPRDTree`'s tolerance for a tree that changes under it.
 *
 * The snapshot is taken before the PRD lock, so a concurrent writer can mutate
 * `.rex/prd_tree/` while `cp` is walking it. Two ways that surfaces:
 *
 *   - an atomic writer's `<file>.<pid>.<uuid>.tmp` renamed away between readdir
 *     and lstat — filtered out of the walk, covered in the integration suite;
 *   - a real entry removed by `serializeToFolderTree`'s stale-directory sweep —
 *     re-walked, covered here.
 *
 * `cp` is stubbed because the second case cannot be provoked deterministically
 * from the filesystem: the window is microseconds wide and a test that races
 * for it would be a flake, not coverage. Everything else in the module runs for
 * real against a temp directory.
 *
 * @module rex/tests/unit/core/backup-snapshot-copy-retry.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

/** Set per test; `undefined` means "fall through to the real `cp`". */
let cpBehaviour: ((attempt: number) => Promise<void> | void) | undefined;
let cpCalls = 0;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    cp: async (...args: Parameters<typeof actual.cp>) => {
      cpCalls += 1;
      if (cpBehaviour) {
        const outcome = await cpBehaviour(cpCalls);
        if (outcome !== undefined) return outcome;
      }
      return actual.cp(...args);
    },
  };
});

const { snapshotPRDTree } = await import("../../../src/core/backup-snapshots.js");

/** The error node raises when an entry vanishes between readdir and lstat. */
function enoent(path: string): NodeJS.ErrnoException {
  const err = new Error(`ENOENT: no such file or directory, lstat '${path}'`) as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

describe("snapshotPRDTree — entry vanishing mid-copy", () => {
  let tmpDir: string;
  let rexDir: string;
  let treeRoot: string;

  beforeEach(async () => {
    cpBehaviour = undefined;
    cpCalls = 0;
    tmpDir = join(tmpdir(), `rex-snapshot-retry-${randomBytes(8).toString("hex")}`);
    rexDir = join(tmpDir, ".rex");
    treeRoot = join(rexDir, "prd_tree");
    await mkdir(join(treeRoot, "epic_test"), { recursive: true });
    await writeFile(join(treeRoot, "epic_test", "index.md"), "Test");
  });

  afterEach(async () => {
    cpBehaviour = undefined;
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("re-walks the tree and still produces a complete snapshot", async () => {
    // First walk loses a race with a concurrent save's stale-directory sweep.
    cpBehaviour = (attempt) => {
      if (attempt === 1) throw enoent(join(treeRoot, "epic_gone"));
    };

    const snapshot = await snapshotPRDTree(rexDir);

    expect(snapshot).not.toBeNull();
    expect(cpCalls).toBe(2);
    // The retry copied everything — a snapshot missing content would be worse
    // than no snapshot, because restore cannot tell the difference.
    expect(await readdir(join(snapshot!.backupPath, "epic_test"))).toEqual(["index.md"]);
  });

  it("fails loudly when the entry never comes back", async () => {
    cpBehaviour = () => {
      throw enoent(join(treeRoot, "epic_gone"));
    };

    await expect(snapshotPRDTree(rexDir)).rejects.toThrow(/Failed to snapshot PRD tree/);
    // Bounded: it does not spin.
    expect(cpCalls).toBe(3);
  });

  it("does not retry an error that is not a vanished entry", async () => {
    cpBehaviour = () => {
      const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
      err.code = "EACCES";
      throw err;
    };

    await expect(snapshotPRDTree(rexDir)).rejects.toThrow(/EACCES/);
    expect(cpCalls).toBe(1);
  });
});
