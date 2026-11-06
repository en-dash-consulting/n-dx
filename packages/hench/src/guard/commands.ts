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

/** An executable token reduced to what names the program: base name, no `.exe`, lower case. */
function programName(token: string): string {
  const base = token.split(/[\\/]/).pop() ?? token;
  return base.replace(/\.(exe|cmd|bat|com)$/i, "").toLowerCase();
}

/** Whether `run` appears in `words` as consecutive entries; an empty run always does. */
function containsRun(words: readonly string[], run: readonly string[]): boolean {
  for (let start = 0; start + run.length <= words.length; start++) {
    if (run.every((token, i) => words[start + i] === token)) return true;
  }
  return false;
}

/** Characters a backslash escapes inside POSIX double quotes. */
const DOUBLE_QUOTE_ESCAPABLE = new Set(["$", "`", '"', "\\", "\n"]);

/**
 * A word as sh passes it, plus what it may expand to. `pattern` is set when an
 * unquoted `{ * ? [` appeared: sh brace-expands and globs after removing
 * quotes, so the program may receive other words than `text`.
 */
interface CommandWord {
  text: string;
  /**
   * Over-approximates every string the word could expand to: `*` and a brace
   * group match anything, `?` and a bracket expression one character. Too
   * wide on purpose — it only ever refuses a denied program's arguments.
   */
  pattern: RegExp | null;
}

/** Characters that start brace expansion or a glob when unquoted. */
const EXPANSION_STARTS = new Set(["{", "*", "?", "["]);

/**
 * Whitespace-separated words as POSIX `sh` would pass them: quotes removed, an
 * unquoted backslash dropped before the character it escapes, and inside
 * double quotes a backslash dropped only before a character sh lets it escape
 * there. So `find\-generic-password` reads as the word sh hands the program.
 * Under cmd.exe a backslash is a path separator, not an escape, so it is kept,
 * and nothing expands.
 */
function commandWords(command: string, shellKind: ShellKind): CommandWord[] {
  const words: CommandWord[] = [];
  let word: string | null = null;
  // Regex source for the word; `expands` says whether it differs from a literal.
  let source = "";
  let expands = false;
  // Inside an unquoted brace group (depth) or bracket expression: already `.*` / `.`.
  let braceDepth = 0;
  let inBracket = false;
  let quote: string | null = null;
  let escaped = false;
  const posix = shellKind !== "cmd";

  const literal = (ch: string): void => {
    word = (word ?? "") + ch;
    if (braceDepth === 0 && !inBracket) source += ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  };
  const flush = (): void => {
    if (word !== null) {
      words.push({ text: word, pattern: expands ? new RegExp(`^${source}$`, "is") : null });
    }
    word = null;
    source = "";
    expands = false;
    braceDepth = 0;
    inBracket = false;
  };

  for (const ch of command) {
    if (escaped) {
      escaped = false;
      // Inside double quotes sh keeps the backslash unless it escapes one of these.
      if (quote === '"' && !DOUBLE_QUOTE_ESCAPABLE.has(ch)) literal("\\");
      literal(ch);
    } else if (quote === "'") {
      if (ch === quote) quote = null;
      else literal(ch);
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && posix) escaped = true;
      else literal(ch);
    } else if (ch === "\\" && posix) {
      word ??= "";
      escaped = true;
    } else if (/\s/.test(ch)) {
      flush();
    } else if (ch === "'" || ch === '"') {
      word ??= "";
      quote = ch;
    } else if (posix && inBracket) {
      word += ch;
      if (ch === "]") inBracket = false;
    } else if (posix && braceDepth > 0) {
      word += ch;
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
    } else if (posix && EXPANSION_STARTS.has(ch)) {
      word = (word ?? "") + ch;
      expands = true;
      if (ch === "{") { source += ".*"; braceDepth = 1; }
      else if (ch === "*") source += ".*";
      else if (ch === "?") source += ".";
      else { source += "."; inBracket = true; }
    } else {
      literal(ch);
    }
  }
  flush();
  return words;
}

/**
 * macOS `security`'s command table, in its order (as the strings appear in
 * `/usr/bin/security` on macOS 14). `security` runs the first entry its
 * subcommand word is a prefix of: SecurityTool's `match_command` is
 * `strncmp(command, name, strlen(name))` with no ambiguity check. So every
 * non-empty prefix of `find-generic-password` (`f`, `find`, `find-generic`, …)
 * runs it, because no earlier entry starts with `f`; `find-c` runs
 * `find-certificate`. The comparison is case-sensitive, so
 * `FIND-GENERIC-PASSWORD` is an unknown command; the guard folds case anyway,
 * which refuses only spellings `security` would reject. Not run on the host
 * (it needs approval): read from the binary's strings and Apple's source.
 */
const SECURITY_COMMANDS = [
  "help", "list-keychains", "default-keychain", "login-keychain", "create-keychain",
  "delete-keychain", "lock-keychain", "unlock-keychain", "set-keychain-settings",
  "set-keychain-password", "show-keychain-info", "dump-keychain", "create-keypair",
  "add-generic-password", "add-internet-password", "add-certificates", "find-generic-password",
  "delete-generic-password", "set-generic-password-partition-list", "find-internet-password",
  "delete-internet-password", "set-internet-password-partition-list", "find-key",
  "set-key-partition-list", "find-certificate", "find-identity", "delete-certificate",
  "delete-identity", "set-identity-preference", "create-db", "export", "import", "cms",
  "install-mds", "add-trusted-cert", "remove-trusted-cert", "dump-trust-settings",
  "user-trust-settings-enable", "trust-settings-export", "trust-settings-import", "verify-cert",
  "authorize", "authorizationdb", "execute-with-privileges", "leaks", "error",
  "create-filevaultmaster-keychain", "smartcards", "translocate-create",
  "translocate-policy-check", "translocate-status-check", "translocate-original-path",
  "requirement-evaluate", "filevault",
];

/** Where `security`'s subcommand word sits in `args`, after its global options. */
function securitySubcommandIndex(args: readonly string[]): number {
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--") return i + 1;
    if (!arg.startsWith("-") || arg === "-") break;
    const takesValue = arg.indexOf("p", 1);
    i += takesValue !== -1 && takesValue === arg.length - 1 ? 2 : 1;
  }
  return i;
}

/**
 * The subcommand `security <args>` runs, as `security` resolves it: global
 * options parsed as its `getopt("hilp:qvR")` does (BSD getopt stops at the
 * first operand or `--`; `-p` takes a value, attached or next), then the first
 * table entry the word is a prefix of. `null` when no subcommand is named.
 */
function securitySubcommand(args: readonly string[]): string | null {
  const word = args[securitySubcommandIndex(args)];
  if (word === undefined) return null;
  const folded = word.toLowerCase();
  return SECURITY_COMMANDS.find((name) => name.startsWith(folded)) ?? word;
}

/**
 * Whether `words` (program first) runs a command `prefix` names. The program
 * is compared by name; the rest of `prefix` must appear as a run anywhere among
 * the later words, so a global option cannot slip one past. For `security`,
 * the subcommand it would actually run (an abbreviation resolved) is matched
 * too.
 */
function runsDeniedPrefix(words: readonly CommandWord[], prefix: readonly string[]): boolean {
  if (prefix.length === 0 || words.length === 0) return false;
  const program = programName(prefix[0]!);
  if (programName(words[0]!.text) !== program) return false;
  const args = words.slice(1);
  if (args.some((arg) => arg.pattern && mayExpandToDenied(arg.pattern, program, prefix.slice(1)))) {
    return true;
  }
  const texts = args.map((arg) => arg.text);
  // An expansion among security's global options, or as the subcommand, can
  // add or drop an option word (a file named `-q`, `-qp`), which moves the
  // subcommand: `security [-]q f list-keychains` runs `f`.
  if (program === "security" && prefix.length > 1 &&
      args.slice(0, securitySubcommandIndex(texts) + 1).some((arg) => arg.pattern)) {
    return true;
  }
  if (words.length < prefix.length) return false;
  if (containsRun(texts, prefix.slice(1))) return true;
  return program === "security" && prefix.length > 1 && securitySubcommand(texts) === prefix[1];
}

/**
 * Whether a word sh expands could become one of a denied prefix's later
 * tokens — or, for `security`, an abbreviation that runs one. Which words the
 * expansion yields depends on the filesystem at run time, so any possible
 * match is refused.
 */
function mayExpandToDenied(pattern: RegExp, program: string, rest: readonly string[]): boolean {
  return rest.some((token) => {
    if (pattern.test(token)) return true;
    if (program !== "security") return false;
    for (let end = 1; end < token.length; end++) {
      const abbreviation = token.slice(0, end);
      if (pattern.test(abbreviation) && securitySubcommand([abbreviation]) === token) return true;
    }
    return false;
  });
}

/**
 * Refuse a command that reads a credential: one matching any of
 * `deniedPrefixes` (token lists). The first token is compared by program name,
 * so a path or `.exe` spelling still matches. The rest must appear as a run
 * anywhere among the later words, not only right after the program, so a
 * global option (`security -q find-generic-password`) cannot slip one past.
 * A `security` subcommand is also resolved as `security` resolves it, so an
 * abbreviation (`security find-generic`) is refused too; see
 * {@link SECURITY_COMMANDS}.
 * Words are unescaped as sh would (`find\-generic-password`). A later word
 * with an unquoted brace or glob (`{find-generic-password,-s}`, `fin[d]-…`) is
 * refused when its expansion could name the denied token. Checked before
 * the allowlist, so it holds even when a user widens `guard.allowedCommands`
 * to include `op` or `security`.
 *
 * Not a complete barrier: an allowed interpreter (`node -e`, `python -c`) can
 * still read the credential store or run a helper from inside it. Only the OS
 * keystore backends close that.
 *
 * @param shellKind - Which shell will interpret the command; decides whether a
 *   backslash escapes. Defaults to POSIX, like {@link validateCommand}.
 * @throws {GuardError} when the command matches a denied prefix.
 */
export function assertNotCredentialCommand(
  command: string,
  deniedPrefixes: readonly (readonly string[])[],
  shellKind: ShellKind = "posix",
): void {
  const words = commandWords(command.trim(), shellKind);
  if (words.length === 0) return;
  for (const prefix of deniedPrefixes) {
    if (runsDeniedPrefix(words, prefix)) {
      throw new GuardError(
        `Command "${prefix.join(" ")}" reads a stored credential; the agent may not run it, ` +
          `whatever guard.allowedCommands lists.`,
      );
    }
  }
}

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
