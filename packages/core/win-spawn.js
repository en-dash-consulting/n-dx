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
 * TWIN: exact copy of quoteWindowsToken in packages/llm-client/src/exec.ts.
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
 * TWIN: exact copy of WINDOWS_BARE_BINARY_RE in packages/llm-client/src/exec.ts.
 */
const WINDOWS_BARE_BINARY_RE = /^[A-Za-z0-9_.+-]+$/;

/**
 * Build a Windows cmd.exe verbatim command line from a binary path and args.
 * TWIN: exact copy of buildWindowsCliCommandLine in packages/llm-client/src/exec.ts.
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
    const cmdLine = buildWindowsCliCommandLine(binary, args);
    logCliInvocation({ binary, args, cwd: options?.cwd, via: "execFileSyncCli", commandLine: cmdLine });
    // Outer quote pair: cmd.exe /s strips only the outermost quotes, keeping
    // per-token inner quotes (spaced paths) intact.
    return execFileSync("cmd.exe", ["/d", "/s", "/c", `"${cmdLine}"`], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  logCliInvocation({ binary, args, cwd: options?.cwd, via: "execFileSyncCli" });
  return execFileSync(binary, args, options);
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
    const cmdLine = buildWindowsCliCommandLine(binary, args);
    logCliInvocation({ binary, args, cwd: options.cwd, via: "spawnCli", commandLine: cmdLine });
    return spawn("cmd.exe", ["/d", "/s", "/c", `"${cmdLine}"`], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  logCliInvocation({ binary, args, cwd: options.cwd, via: "spawnCli" });
  return spawn(binary, args, options);
}
