import { exec } from "../process/exec.js";

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

  const result = await exec("sh", ["-c", command], { cwd, timeout, maxBuffer, env });

  // Timeout — exitCode is null when the process was killed
  if (result.exitCode === null) {
    return `Command timed out after ${timeout}ms`;
  }

  const output: string[] = [];
  if (result.stdout) output.push(result.stdout);
  if (result.stderr) output.push(`[stderr]\n${result.stderr}`);
  if (result.error && !result.stdout && !result.stderr) {
    output.push(`Exit code: ${result.exitCode ?? 1}`);
  }

  return output.join("\n").trim() || "(no output)";
}
