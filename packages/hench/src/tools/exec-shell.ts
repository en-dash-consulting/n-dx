import { execShellCmd } from "../process/exec.js";
import { isVerbose, verbose } from "../types/output.js";

export interface ExecShellOptions {
  /** Shell command string to execute. */
  command: string;
  /** Working directory. */
  cwd: string;
  /** Timeout in milliseconds. */
  timeout: number;
  /** Maximum output buffer in bytes. Defaults to 1 MiB. */
  maxBuffer?: number;
  /** Spread into the child process env. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Line-buffer live stdout/stderr chunks and print each complete line via
 * verbose() as it arrives, so a long-running command's output is visible
 * while it runs rather than only after it exits. No-op unless verbose mode
 * is active. Returns a flush() to print any trailing partial line once the
 * process closes.
 */
function createLiveTail(): { onData: (stream: "stdout" | "stderr", chunk: string) => void; flush: () => void } {
  if (!isVerbose()) {
    return { onData: () => {}, flush: () => {} };
  }
  const buffers = { stdout: "", stderr: "" };
  const onData = (stream: "stdout" | "stderr", chunk: string) => {
    buffers[stream] += chunk;
    const lines = buffers[stream].split("\n");
    buffers[stream] = lines.pop() ?? "";
    for (const line of lines) {
      verbose(`  ${line}`);
    }
  };
  const flush = () => {
    for (const stream of ["stdout", "stderr"] as const) {
      if (buffers[stream]) verbose(`  ${buffers[stream]}`);
    }
  };
  return { onData, flush };
}

/**
 * Execute a shell command and return a formatted result string.
 *
 * Shared by `toolRunCommand` (run_command tool) and `toolGit` (git tool)
 * to avoid duplicating the exec / output-formatting / timeout-guard
 * boilerplate.
 *
 * Uses the foundation exec abstraction from @n-dx/llm-client under
 * the hood, adding hench-specific output formatting on top.
 */
export async function execShell(opts: ExecShellOptions): Promise<string> {
  const {
    command,
    cwd,
    timeout,
    maxBuffer = 1024 * 1024,
    env = { ...process.env },
  } = opts;

  const liveTail = createLiveTail();
  // execShellCmd, not exec("sh", ...) — `sh` does not resolve on Windows
  // outside a POSIX environment, and the resulting ENOENT reported as
  // exitCode 1 with no output looked exactly like a failing command.
  const result = await execShellCmd(command, { cwd, timeout, maxBuffer, env, onData: liveTail.onData });
  liveTail.flush();

  // Timeout — exitCode is null when the process was killed
  if (result.exitCode === null) {
    return `Command timed out after ${timeout}ms`;
  }

  // Never started: the shell itself could not be spawned. Say so, rather than
  // reporting the exitCode 1 that a command which ran and failed would give.
  if (!result.launched) {
    return `Command could not be launched: ${result.error?.message ?? "shell not available"}`;
  }

  const output: string[] = [];
  if (result.stdout) output.push(result.stdout);
  if (result.stderr) output.push(`[stderr]\n${result.stderr}`);
  if (result.error && !result.stdout && !result.stderr) {
    output.push(`Exit code: ${result.exitCode ?? 1}`);
  }

  return output.join("\n").trim() || "(no output)";
}
