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
 * It also detects STALE artifacts (dist/ not a full build of the current src/). A stale dist passes
 * an existence-only check silently, and any test that compares a src-side twin
 * against a dist-side twin — e.g. tests/unit/windows-quoting-parity.test.js —
 * then fails with a confusing "expected X to be Y" divergence diff rather than
 * "your build is out of date". Stale artifacts are a hard error in CI and a
 * loud warning locally (a warning keeps iterative src editing unblocked for the
 * many tests that never touch dist/).
 *
 * @see https://vitest.dev/config/#globalsetup
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { isBuildCurrent } from "../../scripts/lib/stale-dist.mjs";

const ROOT = join(import.meta.dirname, "../..");

/**
 * Critical dist/ artifacts that must exist for E2E tests to be meaningful.
 * Each entry is [nominated artifact, package name, src dir, dist dir]. The
 * nominated artifact drives the existence check; the dist DIRECTORY's build
 * stamp drives the staleness check.
 */
const REQUIRED_ARTIFACTS = [
  ["packages/rex/dist/cli/index.js", "rex", "packages/rex/src", "packages/rex/dist"],
  ["packages/sourcevision/dist/cli/index.js", "sourcevision", "packages/sourcevision/src", "packages/sourcevision/dist"],
  ["packages/hench/dist/cli/index.js", "hench", "packages/hench/src", "packages/hench/dist"],
  ["packages/web/dist/server/start.js", "@n-dx/web", "packages/web/src", "packages/web/dist"],
  ["packages/llm-client/dist/public.js", "@n-dx/llm-client", "packages/llm-client/src", "packages/llm-client/dist"],
];

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

  // Content-based: the build stamp must match the current src/ (see
  // scripts/lib/stale-dist.mjs). Not mtimes — incremental tsc rewrites only
  // changed outputs and a partial build refreshes only some of dist/.
  const stale = [];
  for (const [, name, srcDir, distDir] of REQUIRED_ARTIFACTS) {
    if (!isBuildCurrent(join(ROOT, srcDir), join(ROOT, distDir))) stale.push(name);
  }

  if (stale.length > 0) {
    const names = stale.map((name) => `  - ${name}`).join("\n");
    const message =
      `Stale dist/ artifacts — dist/ is not a full build of the current src/:\n${names}\n\n` +
      `Tests that compare a src-side twin against a dist-side twin (e.g.\n` +
      `tests/unit/windows-quoting-parity.test.js) will report a false divergence.\n` +
      `Run \`pnpm build\` to refresh.`;

    if (process.env.CI) {
      throw new Error(message);
    }
    process.stderr.write(`\n[verify-build] WARNING: ${message}\n\n`);
  }
}
