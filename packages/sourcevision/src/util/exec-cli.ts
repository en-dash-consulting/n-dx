/**
 * Windows-safe synchronous CLI helper for sourcevision.
 *
 * Sourcevision depends on @n-dx/llm-client (see package.json), so we can use
 * `buildWindowsCliCommandLine` from there instead of duplicating the quoting
 * logic. On Windows, routes through cmd.exe with windowsVerbatimArguments to
 * avoid EINVAL on .cmd shims (GH #37) and the DEP0190 deprecation (GH #69).
 *
 * Used by branch-work-collector and prd-epic-resolver to spawn `rex` safely.
 */

import { execFileSync } from "node:child_process";
import { buildWindowsCliCommandLine } from "@n-dx/llm-client";

/**
 * Windows-safe synchronous CLI invocation.
 *
 * @param binary    Binary name or absolute path.
 * @param args      Argument list.
 * @param options   execFileSync options (input, encoding, stdio, timeout, …).
 */
export function execFileSyncCli(
  binary: string,
  args: string[],
  options: Parameters<typeof execFileSync>[2],
): ReturnType<typeof execFileSync> {
  if (process.platform === "win32") {
    const cmdLine = buildWindowsCliCommandLine(binary, args);
    return execFileSync("cmd.exe", ["/d", "/s", "/c", `"${cmdLine}"`], {
      ...options,
      windowsVerbatimArguments: true,
    } as Parameters<typeof execFileSync>[2]);
  }
  return execFileSync(binary, args, options);
}
