import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runResult, createTmpDir, removeTmpDir, setupRexDir } from "./e2e-helpers.js";

describe("ndx add CLI delegation", { timeout: 30_000 }, () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTmpDir("ndx-add-e2e-");
    await setupRexDir(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  it("delegates manual add to rex without missing-.rex error", () => {
    const { stdout, stderr, code } = runResult(
      ["add", "task", "--title=Regression test item", "--parent=epic-1"],
      { cwd: tmpDir },
    );
    expect(code).toBe(0);
    expect(stderr).not.toContain("Missing");
    expect(stderr).not.toMatch(/stack trace|at \w+/i);
    expect(stdout).toContain("Regression test item");
  });

  it("exits 1 with user-friendly error when .rex is missing", async () => {
    const emptyDir = await createTmpDir("ndx-add-norex-");
    try {
      const { stderr, code } = runResult(["add", "task", "--title=Nope"], {
        cwd: emptyDir,
      });
      expect(code).toBe(1);
      expect(stderr).toContain("Missing");
      expect(stderr).toContain("ndx init");
      expect(stderr).not.toMatch(/at \w+\s*\(/);
    } finally {
      await removeTmpDir(emptyDir);
    }
  });

  it("propagates rex exit code on failure", () => {
    const { code } = runResult(
      ["add", "task", "--title=Orphan", "--parent=nonexistent-id"],
      { cwd: tmpDir },
    );
    expect(code).not.toBe(0);
  });
});
