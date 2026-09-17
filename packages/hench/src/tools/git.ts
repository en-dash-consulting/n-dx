import { execArgv } from "./exec-shell.js";
import type { ToolGuard } from "./contracts.js";

const GIT_TIMEOUT = 15000;

export async function toolGit(
  guard: ToolGuard,
  projectDir: string,
  params: { subcommand: string; args?: string },
): Promise<string> {
  guard.checkGitSubcommand(params.subcommand);

  // Spawn `git` with an explicit argv and no shell. The subcommand is
  // allowlisted above; the free-form `args` are tokenized (honouring quotes)
  // and passed to git verbatim. Because there is no `sh -c`, a crafted arg like
  // `"--short; echo pwned > f"` reaches git as literal argument bytes — git
  // rejects the unknown flag and nothing else runs. The previous
  // implementation joined the tokens back into a string and handed it to
  // `execShell` (a shell), which re-parsed the `;` and `>` and executed the
  // injected command, bypassing the whole command guard.
  const args = params.args ? tokenizeArgs(params.args) : [];
  return execArgv({
    file: "git",
    args: [params.subcommand, ...args],
    cwd: projectDir,
    timeout: GIT_TIMEOUT,
  });
}

/**
 * Split a free-form argument string into tokens, honouring single and double
 * quotes so a quoted value with spaces stays one argument (e.g. a commit
 * message). Quotes are consumed, not preserved. The result is passed as argv
 * to a shell-free spawn, so no further quoting or escaping is applied.
 */
export function tokenizeArgs(argsStr: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  let sawToken = false;

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
      sawToken = true;
    } else if (ch === " ") {
      if (sawToken) {
        args.push(current);
        current = "";
        sawToken = false;
      }
    } else {
      current += ch;
      sawToken = true;
    }
  }
  if (sawToken) args.push(current);
  return args;
}
