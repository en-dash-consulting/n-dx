import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The configured timeout must reach the commands validateCompletion runs.
 *
 * These live apart from completion.test.ts because that file mocks
 * node:child_process, and the timeout is no longer visible there: exec stopped
 * forwarding `timeout` to execFile so it can own the timer and kill the whole
 * process tree when it fires. The propagation is still worth pinning — a dropped
 * or hardcoded timeout is a silent regression — so it is asserted one level up,
 * at the exec boundary validateCompletion actually calls.
 */

vi.mock("../../../src/process/exec.js", () => ({
  exec: vi.fn(),
  execShellCmd: vi.fn(),
}));

import { exec, execShellCmd } from "../../../src/process/exec.js";

const mockExec = vi.mocked(exec);
const mockExecShellCmd = vi.mocked(execShellCmd);

/** A diff stat with real changes, so validation proceeds to the test command. */
const DIFF_WITH_CHANGES = " src/foo.ts | 5 +++--\n";

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockResolvedValue({
    stdout: DIFF_WITH_CHANGES,
    stderr: "",
    exitCode: 0,
    error: null,
  });
  mockExecShellCmd.mockResolvedValue({
    stdout: "ok",
    stderr: "",
    exitCode: 0,
    error: null,
  });
});

describe("validateCompletion timeout propagation", () => {
  it("forwards a custom timeout to both git and the test command", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    await validateCompletion("/project", { testCommand: "npm test", timeout: 60_000 });

    expect(mockExec).toHaveBeenCalledWith(
      "git",
      expect.any(Array),
      expect.objectContaining({ cwd: "/project", timeout: 60_000 }),
    );
    expect(mockExecShellCmd).toHaveBeenCalledWith(
      "npm test",
      expect.objectContaining({ cwd: "/project", timeout: 60_000 }),
    );
  });

  it("uses the default timeout when none is specified", async () => {
    const { validateCompletion } = await import("../../../src/agent/completion.js");

    await validateCompletion("/project");

    expect(mockExec).toHaveBeenCalledWith(
      "git",
      expect.any(Array),
      expect.objectContaining({ timeout: 30_000 }),
    );
  });
});
