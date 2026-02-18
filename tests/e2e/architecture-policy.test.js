/**
 * Architecture policy tests — automated detection for direct process
 * execution imports that bypass the foundation layer abstraction.
 *
 * The foundation layer (@n-dx/claude-client/exec.ts) provides exec(),
 * spawnTool(), and spawnManaged() so domain packages never need to
 * import from node:child_process directly.
 *
 * Allowed exceptions:
 *   1. @n-dx/claude-client/src/exec.ts — the abstraction itself
 *   2. @n-dx/claude-client/src/cli-provider.ts — Claude CLI streaming (needs raw spawn for event parsing)
 *   3. packages/hench/src/agent/lifecycle/cli-loop.ts — Claude CLI streaming (same reason)
 *   4. Orchestration-layer files (cli.js, ci.js, web.js) — spawn CLIs directly per four-tier architecture
 *   5. Test files — may use execFileSync/spawnSync for test harness
 *   6. Build scripts, config files, dist/ output
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/** Files that are allowed to import from node:child_process directly. */
const ALLOWED = new Set([
  // Foundation abstraction itself
  "packages/claude-client/src/exec.ts",
  // Claude CLI streaming providers — need raw spawn for event-by-event parsing
  "packages/claude-client/src/cli-provider.ts",
  "packages/hench/src/agent/lifecycle/cli-loop.ts",
  // Orchestration layer — spawns CLIs directly (no library imports)
  "cli.js",
  "ci.js",
  "web.js",
  "config.js",
  // Development scripts
  "packages/web/dev.js",
]);

/** Directories to skip entirely. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".hench",
  ".rex",
  ".sourcevision",
]);

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|js|mjs)$/.test(entry) && !entry.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("architecture policy: process execution", () => {
  it("no direct child_process imports outside allowed files", () => {
    const files = walk(ROOT);
    const violations = [];

    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");

      // Skip allowed files
      if (ALLOWED.has(rel)) continue;
      // Skip test files
      if (/\.test\.(ts|js|mjs)$/.test(rel) || /[\/\\]tests?[\/\\]/.test(rel)) continue;

      const content = readFileSync(file, "utf-8");

      // Check for import/require of child_process
      const hasImport =
        /from\s+["'](?:node:)?child_process["']/.test(content) ||
        /require\(["'](?:node:)?child_process["']\)/.test(content);

      if (hasImport) {
        violations.push(rel);
      }
    }

    if (violations.length > 0) {
      const msg = [
        "Direct child_process imports found outside allowed files.",
        "Use @n-dx/claude-client exec(), spawnTool(), or spawnManaged() instead.",
        "",
        "Violations:",
        ...violations.map((v) => `  - ${v}`),
        "",
        "If this is a legitimate exception, add the file to ALLOWED in",
        "tests/e2e/architecture-policy.test.js",
      ].join("\n");

      expect.fail(msg);
    }
  });
});
