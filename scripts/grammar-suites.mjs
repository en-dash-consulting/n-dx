/**
 * Which test suites need the tree-sitter grammars built.
 *
 * A suite needs them when its package is @n-dx/lang-runtime or declares a
 * dependency on it: the runtime's own tests and every pack's, plus
 * sourcevision, which runs the workspace packs. Their skipUnlessGrammar tests
 * skip without a grammar, so CI must build the grammars and set
 * SV_REQUIRE_GRAMMARS=1 on every leg that runs one of these suites.
 * ci.yml asks this script rather than keeping its own list, and
 * tests/e2e/ci-grammar-steps.test.js holds it to that.
 *
 * Usage: node scripts/grammar-suites.mjs <comma-separated suite labels>
 * Prints `true` when any label needs grammars, `false` otherwise.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUNTIME = "@n-dx/lang-runtime";

/** Package directory names (suite labels) whose tests need built grammars. */
export function grammarSuites(root = ROOT) {
  const suites = [];
  for (const dir of readdirSync(join(root, "packages")).sort()) {
    const manifestPath = join(root, "packages", dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const pkg = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    if (pkg.name === RUNTIME || RUNTIME in deps) suites.push(dir);
  }
  return suites;
}

/** Whether a comma-separated list of suite labels includes one that needs grammars. */
export function needsGrammars(labels, root = ROOT) {
  const wanted = new Set(grammarSuites(root));
  return labels.split(",").some((label) => wanted.has(label.trim()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const labels = process.argv[2];
  if (!labels) {
    console.error("usage: node scripts/grammar-suites.mjs <suite,suite,...>");
    process.exit(2);
  }
  console.log(String(needsGrammars(labels)));
}
