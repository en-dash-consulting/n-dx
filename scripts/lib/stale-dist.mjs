/**
 * Stale-build detection, shared by the e2e globalSetup (tests/e2e/verify-build.js)
 * and the affected-suite gate (scripts/run-all-tests.mjs).
 *
 * Several root tests read a package through `dist/`, so against a stale build
 * they check the OLD code and pass on a change they should fail.
 *
 * Freshness is content-based, not mtime-based. A full build of a package writes
 * `dist/.build-stamp.json` as its LAST step, holding a hash of the source it
 * compiled (scripts/write-build-stamp.mjs). A package is stale when the stamp is
 * missing or its hash differs from the current source. This handles both cases
 * an mtime comparison gets wrong:
 *  - a partial build (web `build:landing`) refreshes files in dist/ but never
 *    writes the stamp, so the compiled server is still judged stale;
 *  - an incremental `tsc` that emits nothing (source rewritten with identical
 *    content) leaves dist/ untouched, but the content hash is unchanged, so the
 *    stamp from the earlier full build still matches.
 */

import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { BUILD_STAMP_FILE, isBuildCurrent, sourceHash } from "../../packages/core/build-identity.mjs";

// The hash and the stamp format are defined once, in core, because `ndx start`
// reads them at run time too (a source-linked install warns when the web
// package's dist/ lags its source). Re-exported so the gates keep one import.
export { BUILD_STAMP_FILE, SOURCE_EXTENSIONS, isBuildCurrent, sourceHash } from "../../packages/core/build-identity.mjs";

/** Record that `distDir` was fully built from the current content of `srcDir`. */
export function writeBuildStamp(srcDir, distDir) {
  writeFileSync(join(distDir, BUILD_STAMP_FILE), JSON.stringify({ sourceHash: sourceHash(srcDir) }) + "\n");
}

/**
 * Packages the change edited under `src/` whose `dist/` is not a full build of
 * the current source. Packages with no `src/` or no `dist/` directory (core) are
 * not built and never reported.
 *
 * @param {string} root repository root
 * @param {string[]} changedFiles repo-relative paths
 * @param {{ dir: string, name: string }[]} manifests
 * @returns {{ dir: string, name: string }[]}
 */
export function staleChangedPackages(root, changedFiles, manifests) {
  const stale = [];
  for (const { dir, name } of manifests) {
    const srcDir = join(root, "packages", dir, "src");
    const distDir = join(root, "packages", dir, "dist");
    if (!existsSync(srcDir) || !existsSync(distDir)) continue;
    if (!changedFiles.some((f) => f.startsWith(`packages/${dir}/src/`))) continue;
    if (!isBuildCurrent(srcDir, distDir)) stale.push({ dir, name });
  }
  return stale;
}

/** The gate's failure message: names each package and the command that fixes it. */
export function staleDistMessage(stale) {
  const lines = stale.map(
    (s) => `  - ${s.name}: dist/ is not a full build of the current src — run \`pnpm --filter ${s.name} build\``,
  );
  return (
    `Stale dist/ — the change edited package sources that were not rebuilt:\n${lines.join("\n")}\n\n` +
    `Root tests read these packages through dist/, so they would check the old build and pass ` +
    `on a change they should fail. Build, then re-run the gate.`
  );
}
