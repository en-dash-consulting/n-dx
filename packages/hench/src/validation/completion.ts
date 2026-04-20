import { exec, execShellCmd } from "../process/exec.js";

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
  /** When true, reject completions that only modify documentation files. */
  selfHeal?: boolean;
}

const DEFAULT_TIMEOUT = 30_000;

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
    { cwd: projectDir, timeout },
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

  // In self-heal mode, reject completions that only modify documentation files
  if (options?.selfHeal && diffOutput) {
    const changedFiles = diffOutput
      .split("\n")
      .map((line) => line.trim().split("|")[0]?.trim())
      .filter((f) => f && !f.includes("changed") && !f.includes("insertion") && !f.includes("deletion"));
    const allDocs = changedFiles.length > 0 && changedFiles.every(
      (f) => /\.(md|adr\.\w+|txt)$/i.test(f) || f.startsWith("docs/"),
    );
    if (allDocs) {
      return {
        valid: false,
        hasChanges: true,
        diffSummary,
        reason: "Self-heal mode requires source code changes. Only documentation files were modified.",
      };
    }
  }

  // Run tests if configured
  if (options?.testCommand) {
    const { error: testError, stderr: testStderr } = await execShellCmd(
      options.testCommand,
      { cwd: projectDir, timeout },
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
