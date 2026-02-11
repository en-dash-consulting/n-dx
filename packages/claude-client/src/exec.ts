/**
 * Centralized process execution abstraction.
 *
 * Generic child-process helpers that any n-dx package can use instead of
 * importing `execFile` / `execFileSync` directly from `node:child_process`.
 *
 * By centralizing execution here — in the foundation layer — domain packages
 * (rex, sourcevision) and execution packages (hench, web) get consistent
 * timeout, buffer, and error-handling behaviour without duplicating the
 * same `execFile` callback boilerplate.
 *
 * ## Scope
 *
 * These helpers cover the **fire-and-collect** pattern: run a command, wait
 * for it to finish, return structured output. They do **not** cover the
 * **streaming** pattern (e.g. spawning Claude CLI and parsing events as they
 * arrive). Streaming use-cases should continue to use `spawn` directly.
 *
 * @module @n-dx/claude-client/exec
 */

import { execFile, execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result from a command execution with full output details. */
export interface ExecResult {
  stdout: string;
  stderr: string;
  /** null when the process was killed (e.g. timeout). */
  exitCode: number | null;
  error: Error | null;
}

/** Options shared by all exec helpers. */
export interface ExecOptions {
  /** Working directory for the child process. */
  cwd: string;
  /** Timeout in milliseconds. */
  timeout: number;
  /** Maximum output buffer in bytes. Defaults to 1 MiB. */
  maxBuffer?: number;
}

// ---------------------------------------------------------------------------
// Default
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BUFFER = 1024 * 1024; // 1 MiB

// ---------------------------------------------------------------------------
// Core exec
// ---------------------------------------------------------------------------

/**
 * Execute a command and return structured output.
 *
 * This is the primary abstraction — all other helpers build on it.
 * Resolves (never rejects) so callers can inspect exitCode/error directly.
 */
export function exec(
  cmd: string,
  args: string[],
  opts: ExecOptions,
): Promise<ExecResult> {
  const { cwd, timeout, maxBuffer = DEFAULT_MAX_BUFFER } = opts;

  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer }, (error, stdout, stderr) => {
      resolve({
        stdout: (stdout ?? "").toString(),
        stderr: (stderr ?? "").toString(),
        exitCode:
          error
            ? ((error as NodeJS.ErrnoException & { code?: number | string }).code === "ETIMEDOUT"
              ? null
              : typeof (error as { code?: number }).code === "number"
                ? ((error as { code?: number }).code ?? 1)
                : 1)
            : 0,
        error: error as Error | null,
      });
    });
  });
}

/**
 * Execute a command and return stdout only (stderr and errors are silently ignored).
 *
 * Useful for git commands where you only care about the output text.
 */
export function execStdout(
  cmd: string,
  args: string[],
  opts: ExecOptions,
): Promise<string> {
  const { cwd, timeout, maxBuffer = DEFAULT_MAX_BUFFER } = opts;

  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer }, (_error, stdout) => {
      resolve((stdout ?? "").toString());
    });
  });
}

/**
 * Execute a shell command string (via `sh -c`).
 *
 * Wraps the command in a shell for glob expansion, pipes, etc.
 */
export function execShellCmd(
  command: string,
  opts: ExecOptions,
): Promise<ExecResult> {
  return exec("sh", ["-c", command], opts);
}

/**
 * Synchronous git helper — get the current HEAD commit hash.
 *
 * Returns undefined if git fails (e.g. not a git repo).
 */
export function getCurrentHead(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    return undefined;
  }
}
