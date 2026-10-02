import { execShell } from "./exec-shell.js";
import type { ToolGuard } from "./contracts.js";

export async function toolRunCommand(
  guard: ToolGuard,
  projectDir: string,
  params: { command: string; cwd?: string; timeout?: number },
): Promise<string> {
  guard.checkCommand(params.command);

  const timeout = params.timeout ?? guard.commandTimeout;
  const cwd = params.cwd
    ? guard.checkPath(params.cwd)
    : projectDir;

  // The guard's env has credential-shaped variables stripped (guard/env.ts);
  // a guard without one (lightweight test doubles) falls back to process.env.
  return execShell({ command: params.command, cwd, timeout, env: guard.childEnv });
}
