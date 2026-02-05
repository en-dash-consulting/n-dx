import { execShell } from "./exec-shell.js";

const ALLOWED_SUBCOMMANDS = [
  "status",
  "add",
  "commit",
  "diff",
  "log",
  "branch",
  "checkout",
  "stash",
  "show",
  "rev-parse",
];

const GIT_TIMEOUT = 15000;

export async function toolGit(
  projectDir: string,
  params: { subcommand: string; args?: string },
): Promise<string> {
  if (!ALLOWED_SUBCOMMANDS.includes(params.subcommand)) {
    throw new Error(
      `Git subcommand "${params.subcommand}" not allowed. Allowed: ${ALLOWED_SUBCOMMANDS.join(", ")}`,
    );
  }

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
