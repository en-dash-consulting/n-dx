/**
 * Windows-safe CLI spawn helpers for the orchestration tier.
 *
 * This module centralises the cmd.exe verbatim recipe so it can be shared by
 * config.js, pair-programming.js, and any future orchestration-tier script that
 * needs to spawn vendor CLIs on Windows. The orchestration tier must NOT import
 * @n-dx/llm-client (spawn-only rule enforced by domain-isolation.test.js), so
 * the quoteWindowsToken / buildWindowsCliCommandLine twin lives here instead.
 *
 * TWIN: quoteWindowsToken and buildWindowsCliCommandLine are intentionally
 * duplicated from packages/llm-client/src/exec.ts. Any change here MUST be
 * mirrored there — the cross-package parity test
 * tests/unit/windows-quoting-parity.test.js fails if the two diverge.
 */

import { execFileSync, spawn } from "node:child_process";
import { logCliInvocation } from "./cli-log.js";

/**
 * Quote a single token for a Windows cmd.exe verbatim command line.
 *
 * TWIN: same logic as quoteWindowsToken in packages/llm-client/src/exec.ts.
 * See that file for the full rule rationale. Summary:
 * - Every token is quoted unconditionally.
 * - Embedded double quotes are doubled (`"` → `""`).
 * - Backslash runs immediately before a quote are doubled (ArgvQuote rule).
 * - Empty token becomes `""`.
 *
 * LIMITATION: %VAR% expansion is performed by cmd.exe inside quotes and cannot
 * be prevented at the quoting layer.
 *
 * Exported for the cross-package parity test.
 */
export function quoteWindowsToken(token) {
  let result = '"';
  let i = 0;
  const n = token.length;
  while (i < n) {
    let slashes = 0;
    while (i < n && token[i] === "\\") {
      slashes++;
      i++;
    }
    if (i === n) {
      result += "\\".repeat(slashes * 2);
    } else if (token[i] === '"') {
      result += "\\".repeat(slashes * 2) + '""';
      i++;
    } else {
      result += "\\".repeat(slashes) + token[i];
      i++;
    }
  }
  return result + '"';
}

/**
 * A binary token that is a plain bare command name — no spaces, quotes, path
 * separators, or cmd.exe metacharacters, so it needs no quoting.
 *
 * TWIN: same logic as WINDOWS_BARE_BINARY_RE in packages/llm-client/src/exec.ts.
 */
const WINDOWS_BARE_BINARY_RE = /^[A-Za-z0-9_.+-]+$/;

/**
 * Build a Windows cmd.exe verbatim command line from a binary path and args.
 * TWIN: same logic as buildWindowsCliCommandLine in packages/llm-client/src/exec.ts.
 * Exported for the cross-package parity test.
 *
 * Args are always quoted; a bare command name is left UNQUOTED so cmd.exe still
 * applies PATHEXT resolution. Quoting the command name makes cmd match an exact
 * filename on PATH, which picks the extensionless POSIX script that pnpm/npm
 * global installs place beside the `.CMD` shim and fails with
 * `The system cannot find the path specified.` See the canonical copy in
 * exec.ts for the full rationale.
 *
 * LIMITATION: an unquoted bare name that collides with a cmd.exe internal
 * command (`echo`, `dir`, `set`, …) resolves to the builtin, not a file on PATH.
 * No CLI spawned here collides; pass an absolute path if one ever does.
 */
export function buildWindowsCliCommandLine(binary, args) {
  const head = WINDOWS_BARE_BINARY_RE.test(binary) ? binary : quoteWindowsToken(binary);
  return [head, ...args.map(quoteWindowsToken)].join(" ");
}

/**
 * A cmd.exe variable reference: `%NAME%`, or `%NAME:~start,len%` and
 * `%NAME:old=new%` with a modifier after the first `:`. The name is what
 * precedes that colon; a modifier never changes which variable is read.
 * TWIN: same as WINDOWS_VAR_REF in packages/llm-client/src/exec.ts.
 */
const WINDOWS_VAR_REF = /%([^%\r\n]+)%/g;

/**
 * Names cmd.exe computes on the spot rather than reads from the environment,
 * so no `env` lists them and an environment lookup alone never refuses them.
 * Lower-case here; the lookup is case-insensitive, as cmd.exe's is.
 * `%CMDCMDLINE%` is the dangerous one: its last character is the closing
 * quote of the command line cmd.exe is running, so `%CMDCMDLINE:~-1%`
 * smuggles a `"` past quoting and ends the argument.
 * TWIN: same as CMD_DYNAMIC_VARIABLES in packages/llm-client/src/exec.ts.
 */
const CMD_DYNAMIC_VARIABLES = new Set([
  "cd",
  "date",
  "time",
  "random",
  "errorlevel",
  "cmdextversion",
  "cmdcmdline",
  "highestnumanodenumber",
]);

/** Windows environment names are case-insensitive; `process.env` is not. */
function envHasName(env, name) {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === wanted) return env[key] !== undefined;
  }
  return false;
}

/**
 * True when cmd.exe would rewrite the `%…%` reference whose inside is
 * `reference`; false when it would leave it literal. The name is read up to
 * the first `:`, so a modifier cannot hide it. A name starting with `=` is one
 * of cmd.exe's hidden per-drive (`%=C:%`) or exit-code (`%=ExitCode%`)
 * variables, resolvable without being in `env`.
 * TWIN: same as cmdWouldExpand in packages/llm-client/src/exec.ts.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} reference
 */
function cmdWouldExpand(env, reference) {
  const name = reference.split(":")[0];
  if (name === "") return false;
  return name.startsWith("=") || CMD_DYNAMIC_VARIABLES.has(name.toLowerCase()) || envHasName(env, name);
}

/**
 * Refuse a command line whose tokens cmd.exe would rewrite before running it.
 *
 * TWIN: same logic as assertNoWindowsEnvExpansion in
 * packages/llm-client/src/exec.ts — see that copy for the full rationale.
 * Exported for the cross-package parity test.
 *
 * Quoting neutralises every cmd.exe metacharacter except `%VAR%`, which is
 * expanded *inside* double quotes; a value holding a quote then ends the
 * argument and an `&` after it starts a second command. cmd.exe has no escape
 * for `%` outside a batch file, so the only sound answer is to refuse. The
 * check is narrow: cmd.exe expands only a name it can resolve, so a path that
 * merely contains `%` still spawns. A line break is refused too: cmd.exe reads
 * a command line only up to the first one and silently drops the rest.
 *
 * @param {readonly string[]} tokens
 * @param {NodeJS.ProcessEnv} env
 */
export function assertNoWindowsEnvExpansion(tokens, env) {
  for (const token of tokens) {
    if (/[\r\n]/.test(token)) {
      throw new Error(
        `Refusing to spawn: ${JSON.stringify(token)} contains a line break. cmd.exe reads a command line ` +
          `only up to the first line break, so the rest of this command would be silently dropped.`,
      );
    }
    for (const match of token.matchAll(WINDOWS_VAR_REF)) {
      const reference = match[1];
      if (!cmdWouldExpand(env, reference)) continue;
      throw new Error(
        `Refusing to spawn: ${JSON.stringify(token)} contains %${reference}%, which cmd.exe would expand ` +
          `into the command line before running it. An expanded value containing a quote can end the ` +
          `argument and start another command, and quoting cannot prevent it.`,
      );
    }
  }
}

/**
 * Windows-safe synchronous CLI invocation (GH #37/#68/#69).
 *
 * On Windows, routes .cmd shims through cmd.exe with a self-quoted verbatim
 * command line (windowsVerbatimArguments) to avoid EINVAL (#37) and the
 * DEP0190 shell:true+args deprecation (#69), self-quoting each token so
 * embedded spaces survive (#68). On other platforms, plain execFileSync.
 *
 * @param {string} binary    Binary name or absolute path.
 * @param {string[]} args    Argument list.
 * @param {object} options   execFileSync options (encoding, timeout, stdio, …).
 */
export function execFileSyncCli(binary, args, options) {
  if (process.platform === "win32") {
    assertNoWindowsEnvExpansion([binary, ...args], options?.env ?? process.env);
    const cmdLine = buildWindowsCliCommandLine(binary, args);
    logCliInvocation({ binary, args, cwd: options?.cwd, via: "execFileSyncCli", commandLine: cmdLine });
    // Outer quote pair: cmd.exe /s strips only the outermost quotes, keeping
    // per-token inner quotes (spaced paths) intact.
    return execFileSync("cmd.exe", ["/d", "/v:off", "/s", "/c", `"${cmdLine}"`], {
      windowsHide: true,
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  logCliInvocation({ binary, args, cwd: options?.cwd, via: "execFileSyncCli" });
  return execFileSync(binary, args, { ...options, windowsHide: true });
}

/**
 * Windows-safe async CLI spawn (GH #37/#68/#69).
 *
 * Returns a ChildProcess. On Windows, routes through cmd.exe with a
 * self-quoted verbatim command line instead of shell:true+args, eliminating
 * EINVAL on .cmd shims (#37) and the DEP0190 deprecation (#69).
 *
 * @param {string} binary    Binary name or absolute path.
 * @param {string[]} args    Argument list.
 * @param {object} [options] spawn options (cwd, env, stdio, …). Do NOT pass
 *                           shell — this function handles Windows safely.
 */
export function spawnCli(binary, args, options = {}) {
  if (process.platform === "win32") {
    assertNoWindowsEnvExpansion([binary, ...args], options.env ?? process.env);
    const cmdLine = buildWindowsCliCommandLine(binary, args);
    logCliInvocation({ binary, args, cwd: options.cwd, via: "spawnCli", commandLine: cmdLine });
    return spawn("cmd.exe", ["/d", "/v:off", "/s", "/c", `"${cmdLine}"`], {
      windowsHide: true,
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  logCliInvocation({ binary, args, cwd: options.cwd, via: "spawnCli" });
  return spawn(binary, args, { ...options, windowsHide: true });
}
