import { execFile } from "node:child_process";

/**
 * Result of completion validation.
 *
 * The agent must produce meaningful changes before a task can be
 * marked complete. This prevents false completion claims where
 * the agent says it's done but didn't actually change anything.
 */
export interface CompletionValidationResult {
  valid: boolean;
  hasChanges: boolean;
  diffSummary?: string;
  reason?: string;
  testsRan?: boolean;
  testsPassed?: boolean;
}

export interface CompletionValidationOptions {
  /** Shell command to run tests (e.g. "npm test"). */
  testCommand?: string;
  /** Timeout for git/test commands in ms. Default: 30_000. */
  timeout?: number;
  /** Commit hash captured before the agent started. Diff against this instead of HEAD. */
  startingHead?: string;
}

const DEFAULT_TIMEOUT = 30_000;

/**
 * Run a shell command and return stdout/stderr.
 */
function exec(
  cmd: string,
  args: string[],
  cwd: string,
  timeout: number,
): Promise<{ stdout: string; stderr: string; error: Error | null }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: (stdout ?? "").toString(),
        stderr: (stderr ?? "").toString(),
        error: error as Error | null,
      });
    });
  });
}

/**
 * Validate that a task produced meaningful changes before completion.
 *
 * Checks:
 * 1. `git diff --stat HEAD` must be non-empty (staged + unstaged changes)
 * 2. If a test command is provided, it must exit successfully
 */
export async function validateCompletion(
  projectDir: string,
  options?: CompletionValidationOptions,
): Promise<CompletionValidationResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

  // Check git diff (staged + unstaged vs starting HEAD or current HEAD)
  const diffRef = options?.startingHead ?? "HEAD";
  const { stdout: diffOutput } = await exec(
    "git",
    ["diff", "--stat", diffRef],
    projectDir,
    timeout,
  );

  const hasChanges = diffOutput.trim().length > 0;
  const diffSummary = hasChanges ? diffOutput.trim() : undefined;

  if (!hasChanges) {
    return {
      valid: false,
      hasChanges: false,
      reason: "No changes detected in git diff. Task must produce meaningful changes to be marked complete.",
    };
  }

  // Run tests if configured
  if (options?.testCommand) {
    const { error: testError, stderr: testStderr } = await exec(
      "sh",
      ["-c", options.testCommand],
      projectDir,
      timeout,
    );

    if (testError) {
      return {
        valid: false,
        hasChanges: true,
        diffSummary,
        testsRan: true,
        testsPassed: false,
        reason: `Tests failed: ${testStderr.trim() || testError.message}`,
      };
    }

    return {
      valid: true,
      hasChanges: true,
      diffSummary,
      testsRan: true,
      testsPassed: true,
    };
  }

  return {
    valid: true,
    hasChanges: true,
    diffSummary,
  };
}

/**
 * Format a validation result as a human-readable string.
 */
export function formatValidationResult(result: CompletionValidationResult): string {
  const lines: string[] = [];

  if (result.hasChanges) {
    lines.push(`Changes detected: ${result.diffSummary ?? "yes"}`);
  } else {
    lines.push(result.reason ?? "No changes detected");
  }

  if (result.testsRan) {
    lines.push(result.testsPassed ? "Tests: passed" : `Tests failed: ${result.reason ?? "unknown error"}`);
  }

  return lines.join("\n");
}
