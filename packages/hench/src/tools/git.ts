import { execArgv } from "./exec-shell.js";
import type { ToolGuard } from "./contracts.js";
import { GuardError } from "../guard/paths.js";

const GIT_TIMEOUT = 15000;

/**
 * Options that make an allowlisted, read-only-looking git subcommand write
 * somewhere else or run something. `git log --output=<path>` writes outside
 * the project and bypasses `blockedPaths`, which guards only the file tools;
 * `--exec-path`, `--upload-pack`, `--receive-pack` and `--config-env` make
 * git run a chosen program or read a chosen variable. Matched on the option
 * name, so both `--output x` and `--output=x` are caught.
 *
 * Only options that follow the subcommand are seen here, because that is
 * where `args` are placed; git's global options (`-C`, `-c`, `--git-dir`)
 * are not global in that position, so `git log -c` (combined diff) and
 * `git rev-parse --git-dir` stay usable.
 */
const BLOCKED_GIT_OPTIONS: readonly string[] = [
  "--output", "--output-directory",
  "--exec-path", "--exec", "--upload-pack", "--receive-pack", "--config-env",
];

/** `-o` is `--output` for these; for `commit` it is `--only`, which is harmless. */
const OUTPUT_SHORT_FLAG_SUBCOMMANDS = new Set(["log", "show", "diff"]);

/**
 * Refuse argument tokens that defeat the subcommand allowlist.
 *
 * @throws {GuardError} naming the offending option.
 */
export function assertSafeGitArgs(subcommand: string, args: readonly string[]): void {
  for (const token of args) {
    if (!token.startsWith("-")) continue;
    const name = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
    const blocked = BLOCKED_GIT_OPTIONS.includes(name)
      || (name === "-o" && OUTPUT_SHORT_FLAG_SUBCOMMANDS.has(subcommand));
    if (blocked) {
      throw new GuardError(`Git option "${name}" is not allowed: it redirects output or execution outside the guarded project.`);
    }
  }
}

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
  assertSafeGitArgs(params.subcommand, args);
  return execArgv({
    file: "git",
    args: [params.subcommand, ...args],
    cwd: projectDir,
    timeout: GIT_TIMEOUT,
    env: guard.childEnv,
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
