import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for completion validation.
 *
 * Before a task is marked "completed", we validate that meaningful work
 * actually happened — primarily by checking that `git diff` is non-empty.
 * Optionally, a test command can be run for additional verification.
 */

// Mock child_process before importing the module.
//
// validateCompletion runs git and the test command through exec, which SPAWNS
// rather than calling execFile: execFile drops the `detached` option and so
// cannot make a child a process-group leader.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

import { EventEmitter } from "node:events";
import { execFile, spawn } from "node:child_process";

const mockSpawn = vi.mocked(spawn);

/** A child that emits the given output then exits. No pid, so the tree kill
 *  short-circuits to a direct kill instead of signalling a real process group. */
function childEmitting(stdout: string, stderr: string, code: number) {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const out = new EventEmitter();
  const err = new EventEmitter();
  Object.assign(child, {
    pid: undefined,
    exitCode: null,
    signalCode: null,
    stdout: out,
    stderr: err,
    stdin: { end: () => {} },
    kill: () => true,
  });
  setImmediate(() => {
    if (stdout) out.emit("data", Buffer.from(stdout));
    if (stderr) err.emit("data", Buffer.from(stderr));
    child.emit("close", code, null);
  });
  return child as unknown as ReturnType<typeof spawn>;
}

/** Every spawned command answers the same way. */
function mockExecFileResult(stdout: string, stderr = "", error: Error | null = null) {
  mockSpawn.mockImplementation((() => childEmitting(stdout, stderr, error ? 1 : 0)) as unknown as typeof spawn);
}

/** Answer each spawned command in turn: git diff first, then the test command. */
function mockExecFileSequence(...results: { stdout?: string; stderr?: string; code?: number }[]) {
  let call = 0;
  mockSpawn.mockImplementation((() => {
    const r = results[Math.min(call, results.length - 1)]!;
    call += 1;
    return childEmitting(r.stdout ?? "", r.stderr ?? "", r.code ?? 0);
  }) as unknown as typeof spawn);
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
    mockExecFileSequence(
      { stdout: " src/foo.ts | 5 +++--\n 1 file changed\n", stderr: "", code: 0 },
      { stdout: "All tests passed", stderr: "", code: 0 },
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

    mockExecFileSequence(
      { stdout: " src/foo.ts | 5 +++--\n 1 file changed\n", stderr: "", code: 0 },
      { stdout: "", stderr: "FAIL: 2 tests failed", code: 1 },
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
    const callArgs = mockSpawn.mock.calls[0]!;
    expect(callArgs[0]).toBe("git");
    expect(callArgs[1]).toContain("--stat");
    expect(callArgs[1]).toContain("HEAD");
  });

  it("diffs against startingHead when provided", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(" src/foo.ts | 5 +++--\n");

    await validateCompletion("/project", { startingHead: "abc123" });

    const callArgs = mockSpawn.mock.calls[0]!;
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
    const callArgs = mockSpawn.mock.calls[0]!;
    expect(callArgs[1]).toContain("abc123");
  });

  it("uses error message as reason when test command fails with empty stderr", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    // Empty stderr on failure: the reason has to come from the error's message,
    // which exec synthesizes as "Command failed: <command>\n<stderr>".
    mockExecFileSequence(
      { stdout: " src/foo.ts | 5 +++--\n 1 file changed\n", stderr: "", code: 0 },
      { stdout: "", stderr: "", code: 1 },
    );

    const result = await validateCompletion("/project", {
      testCommand: "npm test",
    });

    expect(result.valid).toBe(false);
    expect(result.testsRan).toBe(true);
    expect(result.testsPassed).toBe(false);
    // stderr was empty, so the reason can only have come from the error's message.
    // Not pinned to execFile's exact wording ("Command failed with exit code 1"):
    // exec synthesizes its own now, as "Command failed: <command>\n<stderr>".
    expect(result.reason).toMatch(/^Tests failed: /);
    expect(result.reason).toContain("npm test");
  });

  it("runs both git diff and the test command", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileSequence(
      { stdout: " src/foo.ts | 5 +++--\n", stderr: "", code: 0 },
      { stdout: "ok", stderr: "", code: 0 },
    );

    await validateCompletion("/project", {
      testCommand: "npm test",
      timeout: 60_000,
    });

    expect(mockSpawn.mock.calls).toHaveLength(2);
    // The timeout is no longer observable at this boundary: exec keeps the timer
    // itself so a timeout can kill the command's whole tree. Propagation is
    // asserted in tests/unit/validation/completion-timeout.test.ts, which mocks
    // the exec module rather than node:child_process.
  });

  it("passes projectDir as cwd to git diff", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult(" src/foo.ts | 5 +++--\n");

    await validateCompletion("/my/project/dir");

    const opts = mockSpawn.mock.calls[0][2] as { cwd: string };
    expect(opts.cwd).toBe("/my/project/dir");
  });

  it("skips test command when no changes detected", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileResult("");

    const result = await validateCompletion("/project", {
      testCommand: "npm test",
    });

    // Should only call git diff, not the test command
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(result.valid).toBe(false);
    expect(result.hasChanges).toBe(false);
    expect(result.testsRan).toBeUndefined();
  });

  it("validates with startingHead and test command combined", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    mockExecFileSequence(
      { stdout: " src/foo.ts | 10 ++++---\n 1 file changed\n", stderr: "", code: 0 },
      { stdout: "All tests passed", stderr: "", code: 0 },
    );

    const result = await validateCompletion("/project", {
      startingHead: "def456",
      testCommand: "pnpm test",
    });

    // Git diff should use startingHead
    const gitArgs = mockSpawn.mock.calls[0][1] as string[];
    expect(gitArgs).toContain("def456");
    expect(gitArgs).not.toContain("HEAD");

    // Test command should have run through a shell, carrying the command
    // string. WHICH shell is a platform decision (`sh -c` where a POSIX shell
    // exists, cmd.exe on a Windows box without one — see buildShellInvocation),
    // so asserting the binary by name made this pass from Git Bash and fail
    // from PowerShell. The invariant worth pinning is that the command reached
    // a shell at all.
    const [testCmd, testArgv] = mockSpawn.mock.calls[1] as [string, string[]];
    expect(["sh", "cmd.exe"]).toContain(testCmd);
    expect(testArgv.join(" ")).toContain("pnpm test");

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
