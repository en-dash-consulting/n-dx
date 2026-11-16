/**
 * The workspace package manifests suite selection works from
 * (scripts/lib/select-suites.mjs keeps no fs access, so it reads them here).
 * Used by scripts/run-all-tests.mjs and scripts/bench/validation-bench.mjs.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every workspace package manifest under `<root>/packages`, in a stable order,
 * with its directory name. A directory without a readable named manifest is skipped.
 *
 * @param {string} root the repository root
 * @returns {import("./select-suites.mjs").Manifest[]}
 */
export function readWorkspaceManifests(root) {
  const packagesDir = join(root, "packages");
  if (!existsSync(packagesDir)) return [];

  const manifests = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      continue;
    }
    if (!manifest?.name) continue;
    manifests.push({
      dir: entry.name,
      name: manifest.name,
      hasTest: Boolean(manifest.scripts?.test),
      dependencies: manifest.dependencies,
      devDependencies: manifest.devDependencies,
    });
  }
  return manifests;
}
