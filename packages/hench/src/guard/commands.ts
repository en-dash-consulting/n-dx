/**
 * Command validation — allowlist-based filtering with hazard detection.
 *
 * Commands pass through three checks in order:
 *
 * 1. **Shell operator blocking** — rejects metacharacters that enable
 *    command chaining (`; && ||`), subshells (`` ` ``), or variable
 *    expansion (`$`). Since commands run via `sh -c`, these would allow
 *    arbitrary code execution.
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

/**
 * Shell metacharacters that are dangerous when the shell would treat them as
 * active — command separators/background (`; & |`), substitution (`` ` `` `$`),
 * redirection (`< >`), and subshells (`( )`). A run_command string is executed
 * through `sh -c`, so any *unquoted* occurrence can chain a second command or
 * redirect to a file. They are permitted inside quotes because a legitimate
 * single command routinely carries them there — e.g. `node -e "console.log('x')"`.
 */
const ACTIVE_SHELL_OPERATORS = new Set([";", "&", "|", "`", "$", "<", ">", "(", ")"]);

/**
 * Scan a command line for a shell metacharacter the shell would act on.
 *
 * Tracks POSIX single/double-quote state so an operator inside quotes is
 * ignored (it is a literal to the shell) while an unquoted one is reported.
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
 * @returns the offending character (or "newline"), or null if the line is clean.
 */
export function findActiveShellOperator(command: string): string | null {
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
 * @throws {GuardError} if the command fails any security check.
 */
export function validateCommand(
  command: string,
  allowedCommands: string[],
): void {
  const trimmed = command.trim();

  if (!trimmed) {
    throw new GuardError("Empty command");
  }

  // Block shell operators the shell would act on (outside quotes, plus any raw
  // newline). Commands run via sh -c, so an unquoted `;`, `|`, `>` or newline
  // could chain a second command or redirect to a file — bypassing the
  // executable allowlist below.
  const operator = findActiveShellOperator(trimmed);
  if (operator) {
    const shown = operator === "newline" ? "a newline" : `"${operator}"`;
    throw new GuardError(
      `Command contains shell operator ${shown}. Commands must be a single invocation ` +
      `with no chaining, redirection, substitution, or subshells (metacharacters inside ` +
      `quotes are allowed): ${trimmed}`,
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
