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

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Source extensions that a build turns into dist/ output. */
export const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mts|cts)$/;

/** File name of the stamp inside a package's dist/. */
export const BUILD_STAMP_FILE = ".build-stamp.json";

/**
 * Source files under `dir` that a build compiles, as sorted absolute paths.
 * Skips node_modules and nested dist so vendored or generated files never
 * masquerade as sources.
 */
function sourceFiles(dir) {
  const out = [];
  const walk = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE_EXTENSIONS.test(entry.name)) out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/** Hash of every compiled source file's path and content under `srcDir`. */
export function sourceHash(srcDir) {
  const hash = createHash("sha256");
  for (const file of sourceFiles(srcDir)) {
    hash.update(relative(srcDir, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Record that `distDir` was fully built from the current content of `srcDir`. */
export function writeBuildStamp(srcDir, distDir) {
  writeFileSync(join(distDir, BUILD_STAMP_FILE), JSON.stringify({ sourceHash: sourceHash(srcDir) }) + "\n");
}

/**
 * Whether `distDir` is a build of the current `srcDir`: false when the stamp is
 * missing, unreadable, or records different source content.
 */
export function isBuildCurrent(srcDir, distDir) {
  try {
    const stamp = JSON.parse(readFileSync(join(distDir, BUILD_STAMP_FILE), "utf8"));
    return stamp.sourceHash === sourceHash(srcDir);
  } catch {
    return false;
  }
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
