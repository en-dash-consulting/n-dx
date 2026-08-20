import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { cleanupProjectDir } from "../../helpers/index.js";

/**
 * cleanupProjectDir is the shared teardown for every suite that builds a temp
 * project, so its contract is worth asserting directly rather than inferring
 * from whichever suite happens to fail.
 *
 * The Windows-specific hazard: a directory cannot be removed while any process
 * holds a handle inside it, and a handle belonging to a just-terminated child is
 * not necessarily released by the time teardown runs. POSIX allows unlinking an
 * open file, so on Linux/macOS these cases pass either way — they only have
 * teeth on Windows.
 */
describe("cleanupProjectDir", () => {
  it("removes the directory and its contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hench-cleanup-plain-"));
    await writeFile(join(dir, "file.txt"), "content", "utf-8");

    await cleanupProjectDir(dir);

    expect(existsSync(dir)).toBe(false);
  });

  it("is a no-op for a directory that is already gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hench-cleanup-missing-"));
    await cleanupProjectDir(dir);

    await expect(cleanupProjectDir(dir)).resolves.toBeUndefined();
  });

  it("waits out a child process still holding the directory as its cwd", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hench-cleanup-locked-"));

    // A process's current working directory is the handle that actually blocks
    // rmdir on Windows. A plain open file handle does not: Node opens files with
    // FILE_SHARE_DELETE, so the file can be unlinked while open. Reproducing the
    // real failure therefore means holding the directory as a cwd, which is what
    // every spawned child in these suites does.
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 700)"], {
      cwd: dir,
      stdio: "ignore",
    });
    await new Promise<void>((resolve) => child.once("spawn", () => resolve()));

    // Teardown starts while the child is alive, so the first rmdir attempt fails
    // with EBUSY. This passes only if cleanup retries; a helper that gave up (or
    // swallowed the error) would leave the directory behind.
    await cleanupProjectDir(dir);

    expect(existsSync(dir)).toBe(false);
  });

  it("surfaces a lock it cannot wait out instead of swallowing it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hench-cleanup-fail-"));

    // The lock is this process's own cwd, not a child's. A child is the realistic
    // case but not a deterministic one — whether it has the directory locked at
    // the instant rmdir runs is a race, and that made this assertion flake about
    // one run in ten. Windows never lets a process delete its own cwd, so this
    // holds the lock for exactly as long as the assertion needs it.
    const origin = process.cwd();
    process.chdir(dir);

    try {
      if (process.platform === "win32") {
        // Teardown that cannot succeed must say so, and must give up in bounded
        // time: swallowing the error is what turned a leaked temp directory into
        // an invisible problem, and an unbounded wait would hang the suite.
        await expect(cleanupProjectDir(dir)).rejects.toThrow(/EBUSY|EPERM|ENOTEMPTY/);
      } else {
        // POSIX can unlink a directory that is still a process's cwd, so there is
        // nothing to wait out and removal simply succeeds. Asserting the platform
        // contract rather than pretending both behave the same.
        await expect(cleanupProjectDir(dir)).resolves.toBeUndefined();
      }
    } finally {
      process.chdir(origin);
      await cleanupProjectDir(dir);
    }
  });
});
