/**
 * Command validation — allowlist-based filtering with hazard detection.
 *
 * Commands pass through three checks in order:
 *
 * 1. **Shell operator blocking** — rejects metacharacters that enable
 *    command chaining (`; && ||`), subshells (`` ` ``), or variable
 *    expansion (`$`). Since commands run through a shell, these would allow
 *    arbitrary code execution. Which metacharacters, and which quotes protect
 *    them, depends on the shell that will run the command — POSIX `sh`, or
 *    cmd.exe on a Windows host with no `sh` — so the check is shell-aware
 *    (see {@link ShellKind}).
 *
 * 2. **Executable allowlist** — only the base command name must appear in
 *    the configured `allowedCommands` list. Paths like `/usr/bin/node`
 *    are resolved to `node` before checking.
 *
 * 3. **Dangerous pattern detection** — even allowed commands are screened
 *    for hazardous argument patterns (e.g., `rm -rf /`, `sudo`, `eval`).
 *
 * @module
 */

import { GuardError } from "./paths.js";
import { resolveShellKind } from "../prd/llm-gateway.js";

/**
 * The shell semantics `run_command` will be interpreted under. Resolved by
 * the same function `execShellCmd` uses, so the guard never models one shell
 * while another runs the command. Re-exported from the gateway rather than
 * duplicated here for exactly that reason.
 */
export type ShellKind = ReturnType<typeof resolveShellKind>;

export { resolveShellKind };

/**
 * Shell metacharacters that are dangerous when the shell would treat them as
 * active — command separators/background (`; & |`), substitution (`` ` `` `$`),
 * redirection (`< >`), and subshells (`( )`). A run_command string is executed
 * through `sh -c`, so any *unquoted* occurrence can chain a second command or
 * redirect to a file. Most are permitted inside quotes because a legitimate
 * single command routinely carries them there — e.g. `node -e "console.log('x')"`.
 *
 * `$` and `` ` `` are the exception: sh performs command substitution and
 * parameter expansion inside *double* quotes, so they are active there too and
 * only a single-quoted occurrence is literal. See {@link findActiveShellOperator}.
 */
const ACTIVE_SHELL_OPERATORS = new Set([";", "&", "|", "`", "$", "<", ">", "(", ")"]);

/**
 * cmd.exe metacharacters active outside double quotes: separators and pipes
 * (`& |`), redirection (`< >`), grouping (`( )`), and `^`, cmd's escape
 * character — which could otherwise neutralise a quote this scanner counts
 * on (`^"`). `%` is deliberately absent: `%VAR%` expansion is cmd's first
 * parsing phase and happens *before* quotes are read, so it is handled as
 * active everywhere in {@link findActiveCmdOperator}.
 *
 * `;` is not here: to cmd.exe it is an argument delimiter like a space, not a
 * command separator. `$` and backtick have no meaning to cmd.exe at all.
 */
const CMD_SHELL_OPERATORS = new Set(["&", "|", "<", ">", "(", ")", "^"]);

/**
 * cmd.exe counterpart of the POSIX scan below.
 *
 * cmd.exe's quoting differs from `sh` in the two ways that matter here: a
 * single quote is an ordinary character (`'x & y'` does NOT protect the `&`),
 * and there is no escape inside double quotes (`\"` closes the string; only
 * the quote character itself toggles state, and `^` escapes only outside
 * quotes). So this tracks double quotes alone, with no escape handling, and
 * treats `%` as active everywhere because expansion precedes quote parsing.
 *
 * Deliberately not modelled: `!` delayed expansion, which is off unless the
 * host enabled it in the registry — hench runs `cmd.exe /d`, but `/d` skips
 * AutoRun, not that setting. Rejecting `!` would refuse ordinary arguments
 * for a configuration nothing here can detect.
 */
function findActiveCmdOperator(command: string): string | null {
  let quoted = false;

  for (const ch of command) {
    if (ch === "\n" || ch === "\r") return "newline";
    if (ch === "%") return ch;
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (CMD_SHELL_OPERATORS.has(ch)) return ch;
  }

  return null;
}

/**
 * Scan a command line for a shell metacharacter the shell would act on.
 *
 * Tracks POSIX single/double-quote state so an operator inside quotes is
 * ignored (it is a literal to the shell) while an unquoted one is reported.
 * Double quotes are not a blanket pass: sh still expands `$(…)`, `${…}` and
 * `` `…` `` there, so `$` and `` ` `` are reported inside double quotes unless
 * backslash-escaped — `node -e "$(curl … | sh)"` would otherwise run the pipe
 * before `node` started. Only single quotes are wholly literal.
 * A raw newline or carriage return is always reported: `sh -c` treats it as a
 * command separator, and a single-line tool invocation has no need for one —
 * this is what closed the `"npm --version\nrm -rf ~"` bypass, which the old
 * `/[;&|` + "`" + `$]/` test missed entirely.
 *
 * Conservative by construction: the quote model mirrors POSIX `sh` (single
 * quotes are literal; double quotes allow `\` to escape; an unquoted `\`
 * escapes the next char), so a character this scanner judges "active" is one
 * the shell would also treat as active.
 *
 * When `shellKind` is `"cmd"` the command will run under cmd.exe, whose
 * quoting rules are different enough that the POSIX model is unsafe there —
 * `npm test 'x & del /q y'` is one quoted argument to `sh` and two commands to
 * cmd.exe. That case is handled by {@link findActiveCmdOperator}.
 *
 * @returns the offending character (or "newline"), or null if the line is clean.
 */
export function findActiveShellOperator(
  command: string,
  shellKind: ShellKind = "posix",
): string | null {
  if (shellKind === "cmd") return findActiveCmdOperator(command);

  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const ch of command) {
    if (ch === "\n" || ch === "\r") return "newline";

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (ch === "\\") escaped = true;
      else if (ch === '"') quote = null;
      // sh expands `$(…)`, `${…}` and `` `…` `` *inside* double quotes, so these
      // stay active here; only `; & | < > ( )` are literal between "".
      else if (ch === "$" || ch === "`") return ch;
      continue;
    }

    // Unquoted.
    if (ch === "\\") { escaped = true; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ACTIVE_SHELL_OPERATORS.has(ch)) return ch;
  }

  return null;
}

/**
 * Patterns matching dangerous command invocations.
 * These are checked even when the base executable is in the allowlist.
 */
const DANGEROUS_PATTERNS = [
  /\brm\s+(-\w+\s+)*\//,          // rm with absolute path
  /\bsudo\b/,                      // privilege escalation
  /\bchmod\s+[0-7]*7[0-7]*\b/,    // world-writable permissions
  />\s*\/dev\//,                   // writes to device files
  /\beval\b/,                      // dynamic code execution
  /\bexec\b/,                      // process replacement
  /\bsource\b/,                    // script sourcing
  /\b\.\s+\//,                     // dot-sourcing
];

/**
 * Validate a command against the guard's security policies.
 *
 * @param command - The raw command string to validate.
 * @param allowedCommands - List of permitted executable names.
 * @param shellKind - Which shell will interpret the command; see {@link ShellKind}.
 *   Defaults to POSIX. {@link GuardRails} resolves the real value once per run.
 * @throws {GuardError} if the command fails any security check.
 */
export function validateCommand(
  command: string,
  allowedCommands: string[],
  shellKind: ShellKind = "posix",
): void {
  const trimmed = command.trim();

  if (!trimmed) {
    throw new GuardError("Empty command");
  }

  // Block shell operators the shell would act on (outside quotes, plus `$` and
  // backtick inside double quotes, plus any raw newline). Commands run via
  // sh -c, so an unquoted `;`, `|`, `>` or newline could chain a second command
  // or redirect to a file, and a double-quoted `$(…)` would substitute —
  // bypassing the executable allowlist below.
  const operator = findActiveShellOperator(trimmed, shellKind);
  if (operator) {
    const shown = operator === "newline" ? "a newline" : `"${operator}"`;
    throw new GuardError(
      shellKind === "cmd"
        ? `Command contains cmd.exe shell operator ${shown}. Commands must be a single ` +
          `invocation with no chaining, redirection, grouping, or %VAR% expansion. Under ` +
          `cmd.exe only double quotes protect metacharacters — single quotes and ` +
          `backslashes do not: ${trimmed}`
        : `Command contains shell operator ${shown}. Commands must be a single invocation ` +
          `with no chaining, redirection, substitution, or subshells. Metacharacters are ` +
          `allowed inside quotes, except "$" and "\`", which the shell still expands inside ` +
          `double quotes — single-quote them instead: ${trimmed}`,
    );
  }

  // Extract the executable name
  const parts = trimmed.split(/\s+/);
  const executable = parts[0];

  // Handle paths like /usr/bin/node → node
  const baseName = executable.split("/").pop()!;

  if (!allowedCommands.includes(baseName)) {
    throw new GuardError(
      `Command "${baseName}" not in allowlist. Allowed: ${allowedCommands.join(", ")}`,
    );
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new GuardError(
        `Command matches dangerous pattern: ${trimmed}`,
      );
    }
  }
}
