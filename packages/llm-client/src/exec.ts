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
 * Two complementary patterns:
 *
 * 1. **Fire-and-collect** (`exec`, `execStdout`, `execShellCmd`) — run a
 *    command, wait for it to finish, return structured output.
 * 2. **Spawn-and-delegate** (`spawnTool`) — spawn a Node script with
 *    inherited stdio (or piped output), wait for its exit code.
 *
 * Both patterns return structured results and never reject unexpectedly.
 * For fully **streaming** use-cases (e.g. spawning Claude CLI and parsing
 * events as they arrive), use `spawn` directly.
 *
 * @module @n-dx/llm-client/exec
 */

import { execFile, execFileSync, spawn } from "node:child_process";

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
  /** Environment variables for the child process. Defaults to inheriting parent env. */
  env?: NodeJS.ProcessEnv;
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
  const { cwd, timeout, maxBuffer = DEFAULT_MAX_BUFFER, env } = opts;

  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer, env }, (error, stdout, stderr) => {
      const isTimeout = error
        ? (error as NodeJS.ErrnoException & { code?: number | string }).code === "ETIMEDOUT" ||
          (error as { killed?: boolean }).killed === true
        : false;

      resolve({
        stdout: (stdout ?? "").toString(),
        stderr: (stderr ?? "").toString(),
        exitCode:
          error
            ? (isTimeout
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
  const { cwd, timeout, maxBuffer = DEFAULT_MAX_BUFFER, env } = opts;

  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer, env }, (_error, stdout) => {
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

/**
 * Synchronous git helper — get the current branch name.
 *
 * Returns undefined if git fails (e.g. not a git repo or detached HEAD).
 */
export function getCurrentBranch(cwd: string): string | undefined {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    return branch || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Synchronous helper — check whether an executable is on PATH.
 *
 * Uses `which` to locate the binary. Returns true if found, false otherwise.
 */
export function isExecutableOnPath(name: string): boolean {
  try {
    execFileSync("which", [name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Spawn-and-delegate
// ---------------------------------------------------------------------------

/** Grace period before escalating SIGTERM → SIGKILL on timeout. */
const KILL_ESCALATION_MS = 5_000;

/** Options for {@link spawnTool}. */
export interface SpawnToolOptions {
  /** Working directory for the child process. */
  cwd?: string;
  /** Environment variables. Defaults to inheriting parent env. */
  env?: NodeJS.ProcessEnv;
  /**
   * How to wire stdio.
   *
   * - `"inherit"` — child shares the parent's stdin/stdout/stderr (default).
   * - `"pipe"` — capture stdout and stderr; return them in the result.
   */
  stdio?: "inherit" | "pipe";
  /**
   * When true, spawn the process detached and un-ref it so the parent
   * can exit without waiting. Implies `stdio: "ignore"` (overrides
   * the `stdio` option). Returns immediately with `exitCode: 0`.
   */
  detached?: boolean;
  /**
   * Timeout in milliseconds. When elapsed, the child is killed (SIGTERM,
   * then SIGKILL after 5 s) and the result resolves with `exitCode: null`.
   *
   * 0 or undefined = no timeout (wait indefinitely).
   */
  timeout?: number;
}

/** Result from {@link spawnTool}. */
export interface SpawnToolResult {
  exitCode: number | null;
  /** Populated only when `stdio: "pipe"`. */
  stdout: string;
  /** Populated only when `stdio: "pipe"`. */
  stderr: string;
}

/**
 * Handle returned by {@link spawnManaged}.
 *
 * Unlike {@link spawnTool} (which returns a bare `Promise`), this gives
 * callers a reference to the underlying process so they can send signals
 * (e.g. `handle.kill("SIGINT")`) while still awaiting the completion
 * promise.
 */
export interface ManagedChild {
  /** Resolves when the child exits. */
  readonly done: Promise<SpawnToolResult>;
  /** Send a signal to the child process. Returns `true` if the signal was sent. */
  kill(signal?: NodeJS.Signals): boolean;
  /** The child's PID (undefined if the process failed to spawn). */
  readonly pid: number | undefined;
}

/**
 * Spawn a Node script (or other executable) as a child process.
 *
 * Covers the **spawn-and-delegate** pattern used by orchestration and
 * delegation code: start a tool, optionally inherit stdio, wait for it
 * to finish.
 *
 * Unlike {@link exec}, this uses `spawn` (not `execFile`) so it supports
 * long-running processes without buffer limits when stdio is inherited.
 *
 * @param cmd  The executable to run (e.g. `process.execPath` for Node).
 * @param args Command-line arguments.
 * @param opts Options controlling cwd, env, and stdio wiring.
 */
export function spawnTool(
  cmd: string,
  args: string[],
  opts: SpawnToolOptions = {},
): Promise<SpawnToolResult> {
  const { cwd, env, detached = false, timeout } = opts;

  // Detached mode: fire and forget
  if (detached) {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return Promise.resolve({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  }

  const stdio = opts.stdio ?? "inherit";

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "inherit",
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (exitCode: number | null) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ exitCode, stdout, stderr });
    };

    if (timeout && timeout > 0) {
      timer = setTimeout(() => {
        timer = undefined;
        child.kill("SIGTERM");
        // Escalate to SIGKILL after grace period if still alive
        killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_ESCALATION_MS);
        // Resolve immediately — caller sees timeout (exitCode: null).
        // killTimer stays active as a cleanup safety net until the child
        // actually exits (handled by the "close" listener clearing it).
        resolved = true;
        resolve({ exitCode: null, stdout, stderr });
      }, timeout);
    }

    if (stdio === "pipe") {
      child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", () => {
      finish(1);
    });

    child.on("close", (code) => {
      finish(code ?? 1);
    });
  });
}

/**
 * Spawn a long-running child process and return a managed handle.
 *
 * Like {@link spawnTool}, but returns a {@link ManagedChild} handle that
 * exposes both a completion promise (`done`) **and** the ability to send
 * signals to the child (via `kill()`).  This is the correct abstraction
 * when the caller needs to cancel or pause the child — e.g. the web
 * dashboard pausing a hench execution.
 *
 * Never use raw `spawn` from `node:child_process` for this pattern.
 *
 * @param cmd  The executable to run.
 * @param args Command-line arguments.
 * @param opts Options controlling cwd, env, and stdio wiring.
 */
export function spawnManaged(
  cmd: string,
  args: string[],
  opts: SpawnToolOptions = {},
): ManagedChild {
  const { cwd, env, timeout } = opts;
  const stdio = opts.stdio ?? "inherit";

  const child = spawn(cmd, args, {
    cwd,
    env,
    stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  const done = new Promise<SpawnToolResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (exitCode: number | null) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({ exitCode, stdout, stderr });
    };

    if (timeout && timeout > 0) {
      timer = setTimeout(() => {
        timer = undefined;
        child.kill("SIGTERM");
        // Escalate to SIGKILL after grace period if still alive
        killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_ESCALATION_MS);
        // Resolve immediately — caller sees timeout (exitCode: null).
        // killTimer stays active as a cleanup safety net until the child
        // actually exits (handled by the "close" listener clearing it).
        resolved = true;
        resolve({ exitCode: null, stdout, stderr });
      }, timeout);
    }

    if (stdio === "pipe") {
      child.stdout!.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", () => {
      finish(1);
    });

    child.on("close", (code) => {
      finish(code);
    });
  });

  return {
    done,
    kill(signal?: NodeJS.Signals): boolean {
      try {
        return child.kill(signal);
      } catch {
        return false;
      }
    },
    get pid() {
      return child.pid;
    },
  };
}

// ---------------------------------------------------------------------------
// Graceful termination with force-kill fallback
// ---------------------------------------------------------------------------

/** Grace period before escalating SIGTERM → SIGKILL during graceful shutdown. */
const SHUTDOWN_KILL_ESCALATION_MS = 1_000;

/**
 * Gracefully terminate a managed child process, escalating to SIGKILL if needed.
 *
 * 1. Sends `SIGTERM` to the child.
 * 2. Waits up to `gracePeriodMs` for the child to exit naturally.
 * 3. If the child is still alive after the grace period, sends `SIGKILL`.
 * 4. Waits up to {@link SHUTDOWN_KILL_ESCALATION_MS} for SIGKILL to take effect.
 *
 * Resolves once the child has exited or all signals have been delivered.
 * Never rejects — errors during kill are silently swallowed.
 *
 * @param handle       Managed child handle returned by {@link spawnManaged}.
 * @param gracePeriodMs  How long to wait for graceful exit before SIGKILL.
 *                       Defaults to 5 seconds.
 */
export async function killWithFallback(
  handle: ManagedChild,
  gracePeriodMs: number = 5_000,
): Promise<void> {
  if (handle.pid === undefined) return;

  // Send graceful signal — catch in case the process has already exited and
  // the underlying `child.kill()` throws ESRCH.
  try {
    handle.kill("SIGTERM");
  } catch {
    return; // already gone
  }

  let timedOut = false;
  await Promise.race([
    handle.done.then(() => {}),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, gracePeriodMs);
    }),
  ]);

  if (timedOut) {
    // Force-kill the unresponsive process
    try {
      handle.kill("SIGKILL");
    } catch {
      // Ignore — process may have exited between the timeout check and the kill
    }
    // Give SIGKILL a moment to take effect before returning
    await Promise.race([
      handle.done.then(() => {}),
      new Promise<void>((resolve) =>
        setTimeout(resolve, SHUTDOWN_KILL_ESCALATION_MS),
      ),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Concurrent process limiting
// ---------------------------------------------------------------------------

/**
 * Error thrown when a {@link ProcessPool} rejects a spawn because the
 * concurrency limit has been reached.
 */
export class ProcessLimitError extends Error {
  constructor(limit: number) {
    super(`Concurrent process limit reached (max ${limit})`);
    this.name = "ProcessLimitError";
  }
}

/**
 * Bounded pool that limits how many child processes can run concurrently.
 *
 * Wraps {@link spawnTool} and {@link spawnManaged} so callers keep their
 * familiar API while the pool enforces a ceiling on parallel processes.
 * When the limit is reached, new spawns are rejected immediately with a
 * {@link ProcessLimitError} (fail-fast, no queuing — an autonomous agent
 * should not silently block).
 *
 * @example
 * ```ts
 * const pool = new ProcessPool(4);
 *
 * // Each spawn counts against the limit and auto-releases on exit.
 * const result = await pool.spawn("node", ["script.js"], { cwd: "/tmp" });
 *
 * // For managed processes, the handle still exposes kill/pid/done.
 * const handle = pool.spawnManaged("node", ["server.js"], { stdio: "pipe" });
 * // ... handle.kill("SIGTERM") when done
 * ```
 */
export class ProcessPool {
  private readonly _limit: number;
  private _active = 0;

  constructor(limit: number) {
    if (limit < 1) throw new RangeError("ProcessPool limit must be ≥ 1");
    this._limit = limit;
  }

  /** Maximum concurrent processes allowed. */
  get limit(): number {
    return this._limit;
  }

  /** Number of processes currently tracked by the pool. */
  get active(): number {
    return this._active;
  }

  /**
   * Spawn a child process through the pool.
   *
   * Same signature as {@link spawnTool}. Throws {@link ProcessLimitError}
   * if the pool is full.
   */
  spawn(
    cmd: string,
    args: string[],
    opts: SpawnToolOptions = {},
  ): Promise<SpawnToolResult> {
    if (this._active >= this._limit) {
      throw new ProcessLimitError(this._limit);
    }
    this._active++;
    return spawnTool(cmd, args, opts).finally(() => {
      this._active--;
    });
  }

  /**
   * Spawn a managed child process through the pool.
   *
   * Same signature as {@link spawnManaged}. Throws {@link ProcessLimitError}
   * if the pool is full. The slot is released when the child exits.
   */
  spawnManaged(
    cmd: string,
    args: string[],
    opts: SpawnToolOptions = {},
  ): ManagedChild {
    if (this._active >= this._limit) {
      throw new ProcessLimitError(this._limit);
    }
    this._active++;
    const handle = spawnManaged(cmd, args, opts);

    // Release slot on completion (regardless of outcome)
    handle.done.then(
      () => { this._active--; },
      () => { this._active--; },
    );

    return handle;
  }
}
