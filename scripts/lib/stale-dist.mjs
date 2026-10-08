/**
 * Stale-build detection, shared by the e2e globalSetup (tests/e2e/verify-build.js)
 * and the affected-suite gate (scripts/run-all-tests.mjs).
 *
 * A package's `dist/` is stale when a source file under its `src/` is newer than
 * everything in `dist/`. Several root tests read a package through `dist/`, so
 * against a stale build they check the OLD code and pass on a change they should
 * fail.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Source extensions that a build turns into dist/ output. */
export const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mts|cts)$/;

/**
 * Newest mtime (ms) among files under `dir` matching `matches`, or 0 if the
 * directory is absent. Skips nested node_modules (and, when walking a source
 * tree, nested dist) so vendored or generated files never masquerade as edited
 * sources.
 */
export function newestMtime(dir, matches, skipDist) {
  let newest = 0;

  const walk = (current) => {
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
 * Seconds by which `srcDir` is newer than `distDir`, or 0 when the build is
 * current. Compares against the newest file anywhere in dist/, not one nominated
 * artifact: incremental tsc rewrites only the outputs whose sources changed.
 */
export function staleSeconds(srcDir, distDir) {
  const builtAt = newestMtime(distDir, () => true, false);
  const editedAt = newestMtime(srcDir, (f) => SOURCE_EXTENSIONS.test(f), true);
  return editedAt > builtAt ? Math.max(1, Math.round((editedAt - builtAt) / 1000)) : 0;
}

/**
 * Packages the change edited under `src/` whose `dist/` is older than that
 * source. Packages with no `src/` or no `dist/` directory (core) are not built
 * and never reported.
 *
 * @param {string} root repository root
 * @param {string[]} changedFiles repo-relative paths
 * @param {{ dir: string, name: string }[]} manifests
 * @returns {{ dir: string, name: string, ageSeconds: number }[]}
 */
export function staleChangedPackages(root, changedFiles, manifests) {
  const stale = [];
  for (const { dir, name } of manifests) {
    const srcDir = join(root, "packages", dir, "src");
    const distDir = join(root, "packages", dir, "dist");
    if (!existsSync(srcDir) || !existsSync(distDir)) continue;
    if (!changedFiles.some((f) => f.startsWith(`packages/${dir}/src/`))) continue;
    const ageSeconds = staleSeconds(srcDir, distDir);
    if (ageSeconds > 0) stale.push({ dir, name, ageSeconds });
  }
  return stale;
}

/** The gate's failure message: names each package and the command that fixes it. */
export function staleDistMessage(stale) {
  const lines = stale.map(
    (s) => `  - ${s.name}: src edited ${s.ageSeconds}s after last build — run \`pnpm --filter ${s.name} build\``,
  );
  return (
    `Stale dist/ — the change edited package sources that were not rebuilt:\n${lines.join("\n")}\n\n` +
    `Root tests read these packages through dist/, so they would check the old build and pass ` +
    `on a change they should fail. Build, then re-run the gate.`
  );
}
