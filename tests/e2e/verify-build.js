/**
 * Vitest globalSetup — verifies all packages are built before E2E tests run.
 *
 * E2E tests spawn real CLI processes against compiled dist/ artifacts.
 * This creates a hidden build-time dependency that is invisible to the
 * import graph: if any package fails to compile, E2E tests silently
 * produce false-negatives (they fail with confusing "module not found"
 * errors rather than a clear "please build first" message).
 *
 * This script runs once before the E2E suite and fails fast with a
 * clear message if any required dist/ artifact is missing.
 *
 * It also detects STALE artifacts (src/ newer than dist/). A stale dist passes
 * an existence-only check silently, and any test that compares a src-side twin
 * against a dist-side twin — e.g. tests/unit/windows-quoting-parity.test.js —
 * then fails with a confusing "expected X to be Y" divergence diff rather than
 * "your build is out of date". Stale artifacts are a hard error in CI and a
 * loud warning locally (a warning keeps iterative src editing unblocked for the
 * many tests that never touch dist/).
 *
 * @see https://vitest.dev/config/#globalsetup
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/**
 * Critical dist/ artifacts that must exist for E2E tests to be meaningful.
 * Each entry is [nominated artifact, package name, src dir, dist dir]. The
 * nominated artifact drives the existence check; the dist DIRECTORY drives the
 * staleness check — see `setup` for why the two differ.
 */
const REQUIRED_ARTIFACTS = [
  ["packages/rex/dist/cli/index.js", "rex", "packages/rex/src", "packages/rex/dist"],
  ["packages/sourcevision/dist/cli/index.js", "sourcevision", "packages/sourcevision/src", "packages/sourcevision/dist"],
  ["packages/hench/dist/cli/index.js", "hench", "packages/hench/src", "packages/hench/dist"],
  ["packages/web/dist/server/start.js", "@n-dx/web", "packages/web/src", "packages/web/dist"],
  ["packages/llm-client/dist/public.js", "@n-dx/llm-client", "packages/llm-client/src", "packages/llm-client/dist"],
];

/** Source extensions that a build turns into dist/ output. */
const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mts|cts)$/;

/**
 * Newest mtime (ms) among files under `dir` matching `matches`, or 0 if the
 * directory is absent. Skips nested node_modules (and, when walking a source
 * tree, nested dist) so vendored or generated files never masquerade as edited
 * sources.
 */
function newestMtime(dir, matches, skipDist) {
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

export function setup() {
  const missing = REQUIRED_ARTIFACTS.filter(
    ([path]) => !existsSync(join(ROOT, path)),
  );

  if (missing.length > 0) {
    const names = missing.map(([, name]) => `  - ${name}`).join("\n");
    throw new Error(
      `E2E tests require all packages to be built first.\n\n` +
      `Missing dist/ artifacts for:\n${names}\n\n` +
      `Run \`pnpm build\` before running E2E tests.`,
    );
  }

  // Compare against the newest file anywhere in dist/, NOT the nominated
  // artifact above: packages/web and packages/sourcevision set
  // "incremental": true, so tsc rewrites only the outputs whose sources
  // changed. Editing packages/web/src/cli/index.ts refreshes
  // dist/cli/index.js and leaves dist/server/start.js untouched — comparing
  // against that one file reports a fresh build as stale forever.
  const stale = [];
  for (const [, name, srcDir, distDir] of REQUIRED_ARTIFACTS) {
    const builtAt = newestMtime(join(ROOT, distDir), () => true, false);
    const editedAt = newestMtime(join(ROOT, srcDir), (f) => SOURCE_EXTENSIONS.test(f), true);
    if (editedAt > builtAt) {
      stale.push([name, Math.round((editedAt - builtAt) / 1000)]);
    }
  }

  if (stale.length > 0) {
    const names = stale
      .map(([name, ageSeconds]) => `  - ${name} (src edited ${ageSeconds}s after last build)`)
      .join("\n");
    const message =
      `Stale dist/ artifacts — src/ is newer than the compiled output:\n${names}\n\n` +
      `Tests that compare a src-side twin against a dist-side twin (e.g.\n` +
      `tests/unit/windows-quoting-parity.test.js) will report a false divergence.\n` +
      `Run \`pnpm build\` to refresh.`;

    if (process.env.CI) {
      throw new Error(message);
    }
    process.stderr.write(`\n[verify-build] WARNING: ${message}\n\n`);
  }
}
