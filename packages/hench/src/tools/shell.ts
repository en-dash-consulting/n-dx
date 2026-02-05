import type { GuardRails } from "../guard/index.js";
import { execShell } from "./exec-shell.js";

export async function toolRunCommand(
  guard: GuardRails,
  projectDir: string,
  params: { command: string; cwd?: string; timeout?: number },
): Promise<string> {
  guard.checkCommand(params.command);

  const timeout = params.timeout ?? guard.commandTimeout;
  const cwd = params.cwd
    ? guard.checkPath(params.cwd)
    : projectDir;

  return execShell({ command: params.command, cwd, timeout });
}
