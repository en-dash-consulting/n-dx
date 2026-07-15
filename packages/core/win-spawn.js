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
 * Build a Windows cmd.exe verbatim command line from a binary path and args.
 * TWIN: exact copy of buildWindowsCliCommandLine in packages/llm-client/src/exec.ts.
 * Exported for the cross-package parity test.
 */
export function buildWindowsCliCommandLine(binary, args) {
  return [binary, ...args].map(quoteWindowsToken).join(" ");
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
    // Outer quote pair: cmd.exe /s strips only the outermost quotes, keeping
    // per-token inner quotes (spaced paths) intact.
    return execFileSync("cmd.exe", ["/d", "/s", "/c", `"${cmdLine}"`], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
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
    return spawn("cmd.exe", ["/d", "/s", "/c", `"${cmdLine}"`], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(binary, args, options);
}
