import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for completion validation.
 *
 * Before a task is marked "completed", we validate that meaningful work
 * actually happened — primarily by checking that `git diff` is non-empty.
 * Optionally, a test command can be run for additional verification.
 */

// Mock child_process.execFile before importing the module
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

const mockExecFile = vi.mocked(execFile);

function mockExecFileResult(stdout: string, stderr = "", error: Error | null = null) {
  mockExecFile.mockImplementation(
    ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(error, stdout, stderr);
    }) as typeof execFile,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("validateCompletion", () => {
  it("passes when git diff shows changes", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(
      " src/foo.ts | 10 ++++---\n 1 file changed, 7 insertions(+), 3 deletions(-)\n",
    );

    const result = await validateCompletion("/project");

    expect(result.valid).toBe(true);
    expect(result.hasChanges).toBe(true);
  });

  it("fails when git diff is empty", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult("");

    const result = await validateCompletion("/project");

    expect(result.valid).toBe(false);
    expect(result.hasChanges).toBe(false);
    expect(result.reason).toContain("No changes detected");
  });

  it("fails when git diff is whitespace only", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult("  \n  \n");

    const result = await validateCompletion("/project");

    expect(result.valid).toBe(false);
    expect(result.hasChanges).toBe(false);
  });

  it("includes diff summary in result", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    const diffOutput =
      " src/foo.ts | 10 ++++---\n 1 file changed, 7 insertions(+), 3 deletions(-)\n";
    mockExecFileResult(diffOutput);

    const result = await validateCompletion("/project");

    expect(result.diffSummary).toBe(diffOutput.trim());
  });

  it("passes with test command when tests succeed", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    // First call: git diff (has changes)
    // Second call: test command (succeeds)
    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        callCount++;
        if (callCount === 1) {
          cb(null, " src/foo.ts | 5 +++--\n 1 file changed\n", "");
        } else {
          cb(null, "All tests passed", "");
        }
      }) as typeof execFile,
    );

    const result = await validateCompletion("/project", {
      testCommand: "npm test",
    });

    expect(result.valid).toBe(true);
    expect(result.hasChanges).toBe(true);
    expect(result.testsRan).toBe(true);
    expect(result.testsPassed).toBe(true);
  });

  it("fails when test command fails", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        callCount++;
        if (callCount === 1) {
          cb(null, " src/foo.ts | 5 +++--\n 1 file changed\n", "");
        } else {
          const err = new Error("test failed");
          (err as NodeJS.ErrnoException).code = "1";
          cb(err, "", "FAIL: 2 tests failed");
        }
      }) as typeof execFile,
    );

    const result = await validateCompletion("/project", {
      testCommand: "npm test",
    });

    expect(result.valid).toBe(false);
    expect(result.hasChanges).toBe(true);
    expect(result.testsRan).toBe(true);
    expect(result.testsPassed).toBe(false);
    expect(result.reason).toContain("Tests failed");
  });

  it("still validates changes even without test command", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(" src/foo.ts | 5 +++--\n");

    const result = await validateCompletion("/project");

    expect(result.valid).toBe(true);
    expect(result.testsRan).toBeUndefined();
    expect(result.testsPassed).toBeUndefined();
  });

  it("handles git errors gracefully", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult("", "", new Error("not a git repository"));

    const result = await validateCompletion("/project");

    // Git errors should not crash — treat as "no changes detected"
    expect(result.valid).toBe(false);
    expect(result.hasChanges).toBe(false);
    expect(result.reason).toContain("No changes detected");
  });

  it("checks both staged and unstaged changes", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(" src/foo.ts | 5 +++--\n");

    await validateCompletion("/project");

    // Should use git diff HEAD to catch both staged and unstaged changes
    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[0]).toBe("git");
    expect(callArgs[1]).toContain("--stat");
    expect(callArgs[1]).toContain("HEAD");
  });

  it("diffs against startingHead when provided", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(" src/foo.ts | 5 +++--\n");

    await validateCompletion("/project", { startingHead: "abc123" });

    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[0]).toBe("git");
    expect(callArgs[1]).toContain("--stat");
    expect(callArgs[1]).toContain("abc123");
    expect(callArgs[1]).not.toContain("HEAD");
  });

  it("passes when changes are committed (startingHead differs from current HEAD)", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    // Agent committed its changes, so diff against the starting HEAD still shows changes
    mockExecFileResult(
      " src/foo.ts | 10 ++++---\n 1 file changed, 7 insertions(+), 3 deletions(-)\n",
    );

    const result = await validateCompletion("/project", {
      startingHead: "abc123",
    });

    expect(result.valid).toBe(true);
    expect(result.hasChanges).toBe(true);

    // Verify it diffed against the starting commit, not HEAD
    const callArgs = mockExecFile.mock.calls[0];
    expect(callArgs[1]).toContain("abc123");
  });

  it("uses error message as reason when test command fails with empty stderr", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        callCount++;
        if (callCount === 1) {
          cb(null, " src/foo.ts | 5 +++--\n 1 file changed\n", "");
        } else {
          cb(new Error("Command failed with exit code 1"), "", "");
        }
      }) as typeof execFile,
    );

    const result = await validateCompletion("/project", {
      testCommand: "npm test",
    });

    expect(result.valid).toBe(false);
    expect(result.testsRan).toBe(true);
    expect(result.testsPassed).toBe(false);
    expect(result.reason).toBe("Tests failed: Command failed with exit code 1");
  });

  it("forwards custom timeout to git and test commands", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        callCount++;
        if (callCount === 1) {
          cb(null, " src/foo.ts | 5 +++--\n", "");
        } else {
          cb(null, "ok", "");
        }
      }) as typeof execFile,
    );

    await validateCompletion("/project", {
      testCommand: "npm test",
      timeout: 60_000,
    });

    // Both git diff and test command should receive the custom timeout
    expect(mockExecFile.mock.calls).toHaveLength(2);
    const gitOpts = mockExecFile.mock.calls[0][2] as { timeout: number };
    const testOpts = mockExecFile.mock.calls[1][2] as { timeout: number };
    expect(gitOpts.timeout).toBe(60_000);
    expect(testOpts.timeout).toBe(60_000);
  });

  it("uses default timeout when none specified", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(" src/foo.ts | 5 +++--\n");

    await validateCompletion("/project");

    const opts = mockExecFile.mock.calls[0][2] as { timeout: number };
    expect(opts.timeout).toBe(30_000);
  });

  it("passes projectDir as cwd to git diff", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(" src/foo.ts | 5 +++--\n");

    await validateCompletion("/my/project/dir");

    const opts = mockExecFile.mock.calls[0][2] as { cwd: string };
    expect(opts.cwd).toBe("/my/project/dir");
  });

  it("skips test command when no changes detected", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult("");

    const result = await validateCompletion("/project", {
      testCommand: "npm test",
    });

    // Should only call git diff, not the test command
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(result.valid).toBe(false);
    expect(result.hasChanges).toBe(false);
    expect(result.testsRan).toBeUndefined();
  });

  it("validates with startingHead and test command combined", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    let callCount = 0;
    mockExecFile.mockImplementation(
      ((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        callCount++;
        if (callCount === 1) {
          cb(null, " src/foo.ts | 10 ++++---\n 1 file changed\n", "");
        } else {
          cb(null, "All tests passed", "");
        }
      }) as typeof execFile,
    );

    const result = await validateCompletion("/project", {
      startingHead: "def456",
      testCommand: "pnpm test",
    });

    // Git diff should use startingHead
    const gitArgs = mockExecFile.mock.calls[0][1] as string[];
    expect(gitArgs).toContain("def456");
    expect(gitArgs).not.toContain("HEAD");

    // Test command should have run via sh -c
    const testArgs = mockExecFile.mock.calls[1];
    expect(testArgs[0]).toBe("sh");
    expect(testArgs[1]).toContain("-c");
    expect(testArgs[1]).toContain("pnpm test");

    expect(result.valid).toBe(true);
    expect(result.hasChanges).toBe(true);
    expect(result.testsRan).toBe(true);
    expect(result.testsPassed).toBe(true);
  });

  it("sets diffSummary to undefined when no changes", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult("");

    const result = await validateCompletion("/project");

    expect(result.diffSummary).toBeUndefined();
  });
});

describe("formatValidationResult", () => {
  it("formats passing result", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: true,
      hasChanges: true,
      diffSummary: "1 file changed, 5 insertions(+)",
    });

    expect(text).toContain("Changes detected");
    expect(text).toContain("1 file changed");
  });

  it("formats failing result with reason", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: false,
      hasChanges: false,
      reason: "No changes detected in git diff",
    });

    expect(text).toContain("No changes detected");
  });

  it("formats result with test info", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: false,
      hasChanges: true,
      testsRan: true,
      testsPassed: false,
      reason: "Tests failed",
    });

    expect(text).toContain("Tests failed");
  });

  it("falls back to 'yes' when hasChanges is true but diffSummary is undefined", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: true,
      hasChanges: true,
    });

    expect(text).toBe("Changes detected: yes");
  });

  it("falls back to 'No changes detected' when hasChanges is false and reason is undefined", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: false,
      hasChanges: false,
    });

    expect(text).toBe("No changes detected");
  });

  it("includes passing test line when testsRan and testsPassed are true", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: true,
      hasChanges: true,
      diffSummary: "2 files changed",
      testsRan: true,
      testsPassed: true,
    });

    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Changes detected: 2 files changed");
    expect(lines[1]).toBe("Tests: passed");
  });

  it("falls back to 'unknown error' when tests fail with no reason", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: false,
      hasChanges: true,
      diffSummary: "1 file changed",
      testsRan: true,
      testsPassed: false,
    });

    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Changes detected: 1 file changed");
    expect(lines[1]).toBe("Tests failed: unknown error");
  });

  it("omits test line when testsRan is falsy", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: true,
      hasChanges: true,
      diffSummary: "3 files changed",
    });

    expect(text).not.toContain("Tests");
    expect(text.split("\n")).toHaveLength(1);
  });

  it("formats full invalid result: changes present, tests failed, reason set", async () => {
    const { formatValidationResult } = await import("../../../src/agent/completion.js");

    const text = formatValidationResult({
      valid: false,
      hasChanges: true,
      diffSummary: "src/app.ts | 4 ++--",
      testsRan: true,
      testsPassed: false,
      reason: "Tests failed: FAIL src/app.test.ts",
    });

    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Changes detected: src/app.ts | 4 ++--");
    expect(lines[1]).toBe("Tests failed: Tests failed: FAIL src/app.test.ts");
  });
});
