import { execShell } from "./exec-shell.js";
import type { ToolGuard } from "./contracts.js";

const GIT_TIMEOUT = 15000;

export async function toolGit(
  guard: ToolGuard,
  projectDir: string,
  params: { subcommand: string; args?: string },
): Promise<string> {
  guard.checkGitSubcommand(params.subcommand);

  const args = ["git", params.subcommand];
  if (params.args) {
    // Split args respecting quotes
    args.push(...splitArgs(params.args));
  }

  return execShell({
    command: args.join(" "),
    cwd: projectDir,
    timeout: GIT_TIMEOUT,
  });
}

function splitArgs(argsStr: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const ch of argsStr) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}
