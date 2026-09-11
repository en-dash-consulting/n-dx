/**
 * Build-freshness guard for integration tests that boot the compiled server.
 *
 * Tests like `port-zero-reporting.test.ts` and `scoped-route-dispatch.test.ts`
 * spawn `dist/server/start.js` in a child process, which makes them depend on
 * build state the import graph cannot see. Two failure modes must present as
 * "you need to build", not as the behaviour under test failing:
 *
 * - **Never built** — the child dies with module-not-found noise.
 * - **Stale build** — the sneaky one, observed live: a test asserting a
 *   behaviour change made in the same commit as the test itself, run against a
 *   dist built from the previous head, reports "the fix doesn't work". That
 *   costs a rebuild cycle to rule out every time, and the next person doesn't
 *   have a known-good baseline to compare against.
 *
 * Staleness compares the newest source mtime against the newest file anywhere
 * in `dist/` — NOT against the nominated entry file. packages/web sets
 * `"incremental": true`, so tsc rewrites only the outputs whose sources
 * changed; editing one source leaves `dist/server/start.js` untouched, and an
 * entry-file comparison would report a perfectly fresh build as stale forever.
 * Same rationale as the repo-wide guard in `tests/e2e/verify-build.js`, which
 * covers the root e2e suite but not this package's own integration tests.
 *
 * Framework-free on purpose: it throws plain Errors, so it works from a
 * `beforeAll` in any runner and the message is the whole diagnosis.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");

/** Source extensions a build turns into dist/ output. */
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mts|cts)$/;

/** Overrides for tests of the guard itself; production callers use defaults. */
export interface FreshBuildPaths {
  srcDir?: string;
  distDir?: string;
  /** The artifact whose absence means "never built". */
  entry?: string;
}

/**
 * Newest mtime (ms) among files under `dir` matching `matches`, or 0 when the
 * directory is absent. Skips nested node_modules (and, when walking a source
 * tree, nested dist) so vendored or generated files never masquerade as
 * edited sources.
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
          // Race with a concurrent edit/delete — ignore this file.
        }
      }
    }
  };

  if (existsSync(dir)) walk(dir);
  return newest;
}

/**
 * Fail fast — with the fix in the message — when the compiled server is
 * missing or older than the sources it was built from. Call from `beforeAll`
 * in any test that boots `dist/server/start.js`.
 */
export function assertFreshServerBuild(paths: FreshBuildPaths = {}): void {
  const srcDir = paths.srcDir ?? join(WEB_PKG, "src");
  const distDir = paths.distDir ?? join(WEB_PKG, "dist");
  const entry = paths.entry ?? join(distDir, "server", "start.js");

  if (!existsSync(entry)) {
    throw new Error(
      [
        `Missing build output: ${entry}`,
        "This test boots the real server in a child process, so it needs the",
        "compiled server. Run 'pnpm --filter @n-dx/web build' first.",
      ].join("\n"),
    );
  }

  const editedAt = newestMtime(srcDir, (name) => SOURCE_EXTENSIONS.test(name), true);
  const builtAt = newestMtime(distDir, () => true, false);
  if (editedAt > builtAt) {
    const ageSeconds = Math.round((editedAt - builtAt) / 1000);
    throw new Error(
      [
        `Stale build output: dist/ is older than src/ (src edited ${ageSeconds}s after last build).`,
        "This test asserts on compiled server behaviour, so a stale build presents",
        "as the behaviour under test failing instead of as a build problem.",
        "Run 'pnpm --filter @n-dx/web build' first.",
      ].join("\n"),
    );
  }
}
