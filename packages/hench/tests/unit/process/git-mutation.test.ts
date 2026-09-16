/**
 * Unit tests for the checked Git mutation helpers.
 *
 * These helpers exist because `execStdout` resolves with whatever reached
 * stdout even when Git exited non-zero, which let a refused `git add` / `git
 * commit` be reported as a completed one. The contract under test is narrow:
 * a non-zero (or never-launched) Git invocation must reject, and the rejection
 * must carry the reason Git gave — including when the reason arrived on stdout,
 * which is where hook runners (husky, lint-staged) and signing helpers usually
 * print it.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import type { ExecResult } from "../../../src/process/exec.js";

function execResult(overrides: Partial<ExecResult>): ExecResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    error: null,
    launched: true,
    ...overrides,
  };
}

/** Load git-mutation with `exec` stubbed to return `result` for every call. */
async function loadWithExec(result: ExecResult): Promise<typeof import("../../../src/process/git-mutation.js")> {
  vi.resetModules();
  vi.doMock("../../../src/process/exec.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../src/process/exec.js")>()),
    exec: vi.fn(async () => result),
  }));
  return import("../../../src/process/git-mutation.js");
}

afterEach(() => {
  vi.doUnmock("../../../src/process/exec.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("execCheckedGit / execGitMutation", () => {
  it("resolves the result when Git succeeds", async () => {
    const { execCheckedGit } = await loadWithExec(execResult({ stdout: "src.ts\n" }));

    await expect(execCheckedGit("/project", ["diff", "--cached"], 1000)).resolves.toMatchObject({
      stdout: "src.ts\n",
      exitCode: 0,
    });
  });

  it("rejects with Git's stderr reason on a non-zero exit", async () => {
    const stderr = "fatal: unable to auto-detect email address";
    const { execGitMutation } = await loadWithExec(
      execResult({
        stderr,
        exitCode: 128,
        error: Object.assign(new Error(`Command failed: git commit\n${stderr}`), { code: 128 }),
      }),
    );

    await expect(execGitMutation("/project", ["commit", "-m", "x"], 1000)).rejects.toThrow(
      /unable to auto-detect email address/,
    );
  });

  it("names a stdout-only refusal reason, which exec's own message drops", async () => {
    // A pre-commit hook runner that reports on stdout and exits non-zero. exec
    // synthesizes "Command failed: <cmd>\n<stderr>" — with stderr empty that is
    // a refusal with no cause, so the operator is told the commit failed and
    // nothing about why.
    const stdout = "husky > pre-commit hook failed: 3 lint errors";
    const { execGitMutation } = await loadWithExec(
      execResult({
        stdout,
        exitCode: 1,
        error: Object.assign(new Error("Command failed: git commit\n"), { code: 1 }),
      }),
    );

    await expect(execGitMutation("/project", ["commit", "-m", "x"], 1000)).rejects.toThrow(
      /3 lint errors/,
    );
  });

  it("preserves the exit code on the rejection", async () => {
    const { execGitMutation } = await loadWithExec(
      execResult({
        stdout: "gpg: signing request rejected",
        exitCode: 1,
        error: Object.assign(new Error("Command failed: git commit\n"), { code: 1 }),
      }),
    );

    await expect(execGitMutation("/project", ["commit", "-m", "x"], 1000)).rejects.toMatchObject({
      code: 1,
    });
  });

  it("rejects when Git never launched", async () => {
    const { execGitMutation } = await loadWithExec(
      execResult({
        exitCode: 1,
        launched: false,
        error: new Error("spawn git ENOENT"),
      }),
    );

    await expect(execGitMutation("/project", ["add", "-A"], 1000)).rejects.toThrow(/ENOENT/);
  });

  it("rejects with a generic message when Git reported nothing at all", async () => {
    const { execGitMutation } = await loadWithExec(execResult({ exitCode: 1 }));

    await expect(execGitMutation("/project", ["add", "-A"], 1000)).rejects.toThrow(
      /Git command failed/,
    );
  });
});
