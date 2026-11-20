import { resolve } from "node:path";

/**
 * Resolve project directory from the last positional argument or cwd.
 *
 * This is the cwd-relative contract every stdio MCP registration relies on:
 * `.mcp.json` and `.codex/config.toml` both invoke `rex mcp .` (see
 * packages/core/claude-integration.js writeMcpJson and
 * packages/core/codex-integration.js renderCodexConfigToml), and Claude
 * Code / Codex launch project-scope stdio servers with `cwd` set to the
 * checkout root. `resolve(".")` — and, by extension, `resolveDir([".",])`
 * — resolves against `process.cwd()`, so the server always targets whatever
 * directory the client spawned it from, not a path baked in at registration
 * time. Extracted into its own module so it can be unit-tested without
 * executing the CLI's top-level `main()`.
 *
 * @param positional - Positional args after the command, e.g. `["."]` for
 *   `rex mcp .`, or `[]` when no directory was given.
 * @returns The resolved absolute directory: the last positional argument
 *   resolved against `process.cwd()` (so `.` becomes cwd itself), or
 *   `process.cwd()` directly when the last positional looks like a flag or
 *   is absent.
 */
export function resolveDir(positional: string[]): string {
  const last = positional[positional.length - 1];
  if (last && !last.startsWith("-")) {
    return resolve(last);
  }
  return process.cwd();
}

/**
 * Resolve the project directory for a command whose first `operands`
 * positionals are its own arguments (an item id, a level): the last
 * positional when there is one beyond them, else `process.cwd()`.
 *
 * Unlike {@link resolveDir}, a flag-shaped last argument is not skipped.
 */
export function resolveDirAfter(positional: string[], operands: number): string {
  return positional.length > operands
    ? resolve(positional[positional.length - 1])
    : process.cwd();
}
