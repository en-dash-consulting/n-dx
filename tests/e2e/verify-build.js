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
 * @see https://vitest.dev/config/#globalsetup
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/**
 * Critical dist/ artifacts that must exist for E2E tests to be meaningful.
 * Each entry is a [relative path, human-readable package name] pair.
 */
const REQUIRED_ARTIFACTS = [
  ["packages/rex/dist/cli/index.js", "rex"],
  ["packages/sourcevision/dist/cli/index.js", "sourcevision"],
  ["packages/hench/dist/cli/index.js", "hench"],
  ["packages/web/dist/server/start.js", "@n-dx/web"],
  ["packages/llm-client/dist/public.js", "@n-dx/llm-client"],
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
}
