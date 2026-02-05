import { execFile } from "node:child_process";

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
 * to avoid duplicating the execFile / output-formatting / timeout-guard
 * boilerplate.
 */
export function execShell(opts: ExecShellOptions): Promise<string> {
  const {
    command,
    cwd,
    timeout,
    maxBuffer = 1024 * 1024,
    env = { ...process.env },
  } = opts;

  return new Promise((resolve) => {
    const child = execFile(
      "sh",
      ["-c", command],
      { cwd, timeout, maxBuffer, env },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          resolve(`Command timed out after ${timeout}ms`);
          return;
        }

        const output: string[] = [];
        if (stdout) output.push(stdout);
        if (stderr) output.push(`[stderr]\n${stderr}`);
        if (error && !stdout && !stderr) {
          output.push(`Exit code: ${error.code ?? 1}`);
        }

        resolve(output.join("\n").trim() || "(no output)");
      },
    );

    // Safety: kill on timeout if execFile doesn't
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    }, timeout + 1000);
  });
}
