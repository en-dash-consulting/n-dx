/**
 * Which n-dx produced a run.
 *
 * Several checkouts of this repository are usually live at once — a worktree
 * per in-flight PR, plus a linked global install. Their run records are
 * otherwise indistinguishable, so a token or outcome report cannot say which
 * build the numbers came from. These two values close that gap: the version of
 * the hench package that executed the run, and the path of the CLI that
 * launched it.
 *
 * Both are best-effort. Neither is ever allowed to fail a run, so both fall
 * back to `undefined` rather than throwing, and a {@link RunRecord} records
 * them as optional fields.
 *
 * @module hench/process/toolchain-identity
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Cached package version. Holds only a successful read: a failed read is not
 * memoized, so a transient fs error does not pin every later run to
 * `undefined` for the life of the process.
 */
let cachedVersion: string | undefined;

/**
 * Version of the `@n-dx/hench` build that executed this run.
 *
 * `NDX_VERSION` wins when set — the seam for an orchestrator that wants every
 * package in one invocation stamped with the same release number. Nothing sets
 * it today; `packages/core/cli.js` exports only the CLI path.
 *
 * Falls back to this package's own `package.json`. This file lives at
 * `<pkg>/src/process/` in dev and `<pkg>/dist/process/` when built, so two
 * levels up reaches `packages/hench/package.json` either way — the same
 * resolution `packages/web/src/server/routes-status.ts` uses.
 *
 * @returns The version string, or `undefined` when it cannot be read.
 */
export function resolveNdxVersion(): string | undefined {
  const fromEnv = process.env["NDX_VERSION"];
  if (fromEnv) return fromEnv;

  if (cachedVersion) return cachedVersion;
  try {
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = resolve(thisDir, "../..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.length > 0) {
      cachedVersion = pkg.version;
      return cachedVersion;
    }
  } catch {
    // Unreadable or malformed package.json — the run is still valid, it just
    // carries no version. Deliberately not cached; see cachedVersion.
  }
  return undefined;
}

/**
 * Path of the CLI that launched this run.
 *
 * `packages/core/cli.js` exports its own path as both `NDX_CLI_PATH` and
 * `N_DX_CLI_PATH`, so a run spawned through `ndx work` records the
 * orchestrator rather than hench's own entry point. Both names are read in the
 * same order as `resolveNdxBin` in `packages/web/src/server/routes-commands.ts`.
 * A direct `hench run` sets neither, and `process.argv[1]` names hench's CLI.
 *
 * @returns The path, or `undefined` when argv carries no script path.
 */
export function resolveCliPath(): string | undefined {
  return (
    process.env["NDX_CLI_PATH"] ||
    process.env["N_DX_CLI_PATH"] ||
    process.argv[1] ||
    undefined
  );
}

/**
 * Clear the cached version so the next {@link resolveNdxVersion} call re-reads.
 * Test-only — production code reads once per process by design.
 */
export function _resetVersionCacheForTests(): void {
  cachedVersion = undefined;
}
