/**
 * Architecture policy tests — automated detection for direct process
 * execution imports that bypass the foundation layer abstraction.
 *
 * The foundation layer (@n-dx/llm-client/exec.ts) provides exec(),
 * spawnTool(), and spawnManaged() so domain packages never need to
 * import from node:child_process directly.
 *
 * Allowed exceptions:
 *   1. @n-dx/llm-client/src/exec.ts — the abstraction itself
 *   2. @n-dx/llm-client/src/cli-provider.ts — Claude CLI streaming (needs raw spawn for event parsing)
 *   3. @n-dx/llm-client/src/codex-cli-provider.ts — Codex CLI streaming (same reason)
 *   4. packages/hench/src/agent/lifecycle/cli-loop.ts — Claude CLI streaming (same reason)
 *   5. Orchestration-layer files (cli.js, ci.js, web.js) — spawn CLIs directly per four-tier architecture
 *   6. Test files — may use execFileSync/spawnSync for test harness
 *   7. Build scripts, config files, dist/ output
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

/** Files that are allowed to import from node:child_process directly. */
const ALLOWED = new Set([
  // Foundation abstraction itself (llm-client is the canonical foundation)
  "packages/llm-client/src/exec.ts",
  // CLI streaming providers — need raw spawn for event-by-event parsing
  "packages/llm-client/src/cli-provider.ts",
  "packages/llm-client/src/codex-cli-provider.ts",
  "packages/hench/src/agent/lifecycle/cli-loop.ts",
  // Orchestration layer — spawns CLIs directly (no library imports)
  "cli.js",
  "ci.js",
  "web.js",
  "config.js",
  "pr-check.js",
  // Development scripts
  "packages/web/dev.js",
  // Process monitoring — needs raw execFile for system commands (vm_stat, sysctl)
  "packages/hench/src/process/memory-monitor.ts",
  // Git operations — need execFileSync for git CLI calls
  "packages/sourcevision/src/analyzers/branch-work-collector.ts",
  "packages/sourcevision/src/analyzers/branch-work-filter.ts",
  "packages/sourcevision/src/cli/commands/git-credential-helper.ts",
  "packages/sourcevision/src/cli/commands/prd-epic-resolver.ts",
  // Web server routes — spawn CLI subprocesses for domain tool execution
  "packages/web/src/server/routes-hench.ts",
  "packages/web/src/server/routes-sourcevision.ts",
  // Claude Code integration — runs `claude mcp add` via execSync
  "claude-integration.js",
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

/**
 * Intra-package layer-direction rules.
 *
 * Domain-layer files (src/core/, src/analyze/, src/schema/, etc.) must not
 * import from CLI-layer files (src/cli/). This prevents tight coupling
 * between business logic and CLI presentation concerns.
 *
 * Known violations are listed in KNOWN_VIOLATIONS and tracked for
 * resolution — the test ensures no NEW violations are introduced.
 */
const INTRA_PACKAGE_RULES = [
  {
    name: "rex",
    packageDir: "packages/rex/src",
    domainDirs: ["core", "analyze", "schema", "store"],
    cliDir: "cli",
  },
  {
    name: "sourcevision",
    packageDir: "packages/sourcevision/src",
    domainDirs: ["analyzers", "schema", "util"],
    cliDir: "cli",
  },
  {
    name: "hench",
    packageDir: "packages/hench/src",
    domainDirs: ["agent", "prd", "tools", "process"],
    cliDir: "cli",
  },
];

/**
 * Known pre-existing violations that are tracked for future resolution.
 * These are grandfathered in to avoid blocking other work, but new
 * violations of the same pattern will fail the test.
 */
const KNOWN_VIOLATIONS = new Set([
  // rex domain → cli imports (tracked for resolution)
  "packages/rex/src/analyze/guided.ts",
  "packages/rex/src/core/move.ts",
  // sourcevision domain → cli imports (tracked for resolution)
  "packages/sourcevision/src/analyzers/classify.ts",
  "packages/sourcevision/src/analyzers/enrich-batch.ts",
  "packages/sourcevision/src/analyzers/enrich-per-zone.ts",
]);

describe("architecture policy: intra-package layering", () => {
  for (const rule of INTRA_PACKAGE_RULES) {
    it(`${rule.name}: domain files must not import from cli/ (except known violations)`, () => {
      const violations = [];

      for (const domainDir of rule.domainDirs) {
        const fullDir = join(ROOT, rule.packageDir, domainDir);
        if (!existsSync(fullDir)) continue;

        const files = walk(fullDir);
        for (const file of files) {
          const rel = relative(ROOT, file).replace(/\\/g, "/");
          const content = readFileSync(file, "utf-8");

          // Check for imports from the cli/ directory (relative paths)
          const cliImportPattern = /from\s+["']\.\.\/cli\//;
          if (cliImportPattern.test(content) && !KNOWN_VIOLATIONS.has(rel)) {
            violations.push(rel);
          }
        }
      }

      if (violations.length > 0) {
        expect.fail(
          [
            `Domain-layer files in ${rule.name} import from cli/ subdirectories.`,
            "Domain logic should not depend on CLI presentation concerns.",
            "",
            "Violations:",
            ...violations.map((v) => `  - ${v}`),
            "",
            "To fix: move the shared utility out of cli/ into core/ or a shared module,",
            "or restructure the import to avoid the dependency.",
          ].join("\n"),
        );
      }
    });
  }
});

describe("architecture policy: process execution", () => {
  it("ALLOWED list contains no stale entries (all files exist on disk)", () => {
    const stale = [];
    for (const rel of ALLOWED) {
      const full = join(ROOT, rel);
      if (!existsSync(full)) {
        stale.push(rel);
      }
    }

    if (stale.length > 0) {
      const msg = [
        "ALLOWED list contains files that no longer exist on disk.",
        "Remove stale entries or update paths after renames/moves:",
        "",
        ...stale.map((s) => `  - ${s}`),
      ].join("\n");

      expect.fail(msg);
    }
  });

  it("no direct child_process imports outside allowed files", () => {
    const files = walk(ROOT);
    const violations = [];

    for (const file of files) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");

      // Skip allowed files
      if (ALLOWED.has(rel)) continue;
      // Skip test files
      if (/\.test\.(ts|js|mjs)$/.test(rel) || /(?:^|[\/\\])tests?[\/\\]/.test(rel)) continue;

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
        "Use @n-dx/llm-client exec(), spawnTool(), or spawnManaged() instead.",
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
