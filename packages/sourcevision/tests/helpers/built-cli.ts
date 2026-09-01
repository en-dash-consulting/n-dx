/**
 * Guard for tests that spawn the built CLI from `dist/`.
 *
 * Some behaviour can only be tested through a real process — CLI hint output
 * and `analyze`/`serve` side-effects are only meaningful from a real argv.
 * Those tests depend on a build step that the import graph cannot see, so
 * when the build is missing or out of date they fail somewhere unrelated to
 * the cause.
 *
 * Existence alone is not enough. A dist that predates the source fails with
 * whatever the old code did — the assertion about hint text reports a wrong
 * command name, which names the typo and the hint but never the build.
 * Diagnosing that costs a full validation cycle; the fix was `pnpm build`
 * with no source change at all.
 *
 * This runs the same comparison as the repo-level `tests/e2e/verify-build.js`
 * global setup, but per test file and as a hard failure: that setup warns
 * locally (so iterating on src/ stays unblocked for the many tests that never
 * touch dist/), which is right for the suite as a whole and wrong for a test
 * that cannot produce a meaningful result without a current build.
 *
 * Deliberate copy of packages/rex/tests/helpers/built-cli.ts: each package's
 * tests/helpers/ is the established per-package convention, and the only
 * meaningful difference is the `pnpm --filter` name in the error message.
 * A shared location would require either a new dev-only package or cross-
 * package test imports, neither of which is warranted for a single utility.
 *
 * @see packages/rex/tests/helpers/built-cli.ts — canonical implementation
 * @see tests/e2e/verify-build.js — repo-level equivalent for the E2E suite
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** Package root, derived from this file's location (tests/helpers → ../..). */
const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");

/** Source extensions a build turns into `dist/` output. */
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mts|cts)$/;

/** Locations the guard inspects. Overridable so the guard itself is testable. */
export interface BuiltCliPaths {
  /** The built entry point a test spawns. */
  cliPath: string;
  /** Source tree whose newest edit is compared against the build. */
  srcDir: string;
  /** Build output tree; its newest file stands for "when the build ran". */
  distDir: string;
}

function defaultPaths(): BuiltCliPaths {
  return {
    cliPath: join(PACKAGE_ROOT, "dist", "cli", "index.js"),
    srcDir: join(PACKAGE_ROOT, "src"),
    distDir: join(PACKAGE_ROOT, "dist"),
  };
}

/**
 * Newest mtime (ms) under `dir` among files matching `matches`, or 0 when the
 * directory is absent. Skips `node_modules`, and — when walking a source tree —
 * any nested `dist`, so vendored or generated files cannot masquerade as an
 * edited source and demand a rebuild that would change nothing.
 */
function newestMtime(dir: string, matches: (name: string) => boolean, skipDist: boolean): number {
  let newest = 0;

  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules") continue;
      if (skipDist && entry.name === "dist") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (matches(entry.name)) {
        try {
          const { mtimeMs } = statSync(full);
          if (mtimeMs > newest) newest = mtimeMs;
        } catch {
          // Raced with a concurrent edit or delete — ignore this file.
        }
      }
    }
  };

  if (existsSync(dir)) walk(dir);
  return newest;
}

/**
 * Assert the built CLI exists and is not older than the sources it was built
 * from, and return its path.
 *
 * Throws with the rebuild instruction, distinguishing a missing build from a
 * stale one — they read identically at the failure site but only one of them
 * is what a developer expects after editing `src/`.
 *
 * Compares against the newest file anywhere in `distDir` rather than the
 * nominated artifact: an incremental `tsc` rewrites only the outputs whose
 * sources changed, so a single file can lag a genuinely current build forever.
 */
export function requireFreshBuiltCli(overrides?: Partial<BuiltCliPaths>): string {
  const { cliPath, srcDir, distDir } = { ...defaultPaths(), ...overrides };

  if (!existsSync(cliPath)) {
    throw new Error(
      `Built CLI not found at ${cliPath}.\n` +
      `This test spawns the compiled CLI as a real process, so it cannot run against source.\n` +
      `Run \`pnpm build\` (or \`pnpm --filter @n-dx/sourcevision run build\`) first.`,
    );
  }

  const builtAt = newestMtime(distDir, () => true, false);
  const editedAt = newestMtime(srcDir, (f) => SOURCE_EXTENSIONS.test(f), true);

  if (editedAt > builtAt) {
    const behindSeconds = Math.round((editedAt - builtAt) / 1000);
    throw new Error(
      `Built CLI at ${cliPath} is stale — src/ was edited ${behindSeconds}s after the last build.\n` +
      `This test spawns the compiled CLI, so it would exercise the previous build and fail\n` +
      `somewhere unrelated to the cause.\n` +
      `Run \`pnpm build\` (or \`pnpm --filter @n-dx/sourcevision run build\`) first.`,
    );
  }

  return cliPath;
}
