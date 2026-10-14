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
 * Staleness is content-based, not mtime-based: it is the same check the root
 * gates use (`isBuildCurrent` in `scripts/lib/stale-dist.mjs`, shared with
 * `tests/e2e/verify-build.js` and the affected-suite gate). A full build writes
 * `dist/.build-stamp.json` as its last step, holding a hash of the source it
 * compiled; `dist/` is current when that hash still matches `src/`.
 *
 * Mtimes cannot express either case this package actually produces:
 *  - **a partial build** (`build:landing`) refreshes files in `dist/` without
 *    recompiling the server, so comparing against the newest file anywhere in
 *    `dist/` passes while the compiled server is still the old one;
 *  - **an identical rewrite** (a `git restore` of a built source) leaves the
 *    content unchanged but the mtime newer than every output, and incremental
 *    tsc emits nothing — so the comparison reports a fresh build as stale
 *    forever, with no rebuild able to clear it.
 *
 * Framework-free on purpose: it throws plain Errors, so it works from a
 * `beforeAll` in any runner and the message is the whole diagnosis.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isBuildCurrent } from "../../../../scripts/lib/stale-dist.mjs";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");

/** Overrides for tests of the guard itself; production callers use defaults. */
export interface FreshBuildPaths {
  srcDir?: string;
  distDir?: string;
  /** The artifact whose absence means "never built". */
  entry?: string;
}

/**
 * Fail fast — with the fix in the message — when the compiled server is
 * missing or was not built from the current sources. Call from `beforeAll`
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

  if (!isBuildCurrent(srcDir, distDir)) {
    throw new Error(
      [
        "Stale build output: dist/ is not a full build of the current src.",
        "This test asserts on compiled server behaviour, so a stale build presents",
        "as the behaviour under test failing instead of as a build problem.",
        "A partial build ('build:landing') does not clear this — it never writes",
        "the stamp. Run 'pnpm --filter @n-dx/web build' first.",
      ].join("\n"),
    );
  }
}
