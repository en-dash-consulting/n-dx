/**
 * Shared E2E test helpers for n-dx CLI tests.
 *
 * Centralizes common patterns across 14+ test files:
 * - CLI path resolution
 * - Process spawn wrappers (run, runFail, runResult)
 * - Temp directory lifecycle management
 * - Project setup fixtures (.rex, .hench, .sourcevision)
 *
 * @module tests/e2e/e2e-helpers
 */

import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path to the main n-dx CLI entry point. */
export const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

/** Default timeout for CLI commands (ms). */
export const DEFAULT_TIMEOUT = 10000;

// ---------------------------------------------------------------------------
// CLI execution helpers
// ---------------------------------------------------------------------------

/**
 * Run an ndx CLI command synchronously.
 *
 * @param {string[]} args - CLI arguments
 * @param {object} [opts] - Additional execFileSync options
 * @returns {string} stdout
 */
export function run(args, opts = {}) {
  return execFileSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: DEFAULT_TIMEOUT,
    stdio: "pipe",
    ...opts,
  });
}

/**
 * Run an ndx CLI command expecting it to fail.
 *
 * @param {string[]} args - CLI arguments
 * @param {object} [opts] - Additional execFileSync options (e.g. cwd)
 * @returns {{ stdout: string, stderr: string, status: number }}
 * @throws If the command succeeds unexpectedly
 */
export function runFail(args, opts = {}) {
  try {
    execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: DEFAULT_TIMEOUT,
      stdio: "pipe",
      ...opts,
    });
    throw new Error("Expected command to fail");
  } catch (err) {
    if (err.message === "Expected command to fail") throw err;
    return { stdout: err.stdout || "", stderr: err.stderr || "", status: err.status };
  }
}

/**
 * Run an ndx CLI command and capture result without throwing.
 *
 * @param {string[]} args - CLI arguments
 * @param {object} [opts] - Additional execFileSync options
 * @returns {{ stdout: string, stderr: string, code: number }}
 */
export function runResult(args, opts = {}) {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: DEFAULT_TIMEOUT,
      stdio: "pipe",
      ...opts,
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", code: err.status };
  }
}

// ---------------------------------------------------------------------------
// Temp directory lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory with a descriptive prefix.
 *
 * @param {string} [prefix="ndx-e2e-"] - Temp dir prefix
 * @returns {Promise<string>} Absolute path to temp directory
 */
export async function createTmpDir(prefix = "ndx-e2e-") {
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Remove a temporary directory recursively.
 *
 * @param {string} dir - Directory to remove
 */
export async function removeTmpDir(dir) {
  await rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Project fixtures
// ---------------------------------------------------------------------------

/**
 * Set up a minimal .rex directory with valid config and PRD.
 *
 * @param {string} dir - Project root directory
 * @param {object} [overrides] - Override default PRD/config values
 * @param {string} [overrides.project] - Project name (default: "test-project")
 * @param {object[]} [overrides.items] - PRD items (default: one epic with 2 tasks)
 */
export async function setupRexDir(dir, overrides = {}) {
  await mkdir(join(dir, ".rex"), { recursive: true });

  await writeFile(
    join(dir, ".rex", "config.json"),
    JSON.stringify(
      {
        schema: "rex/v1",
        project: overrides.project ?? "test-project",
        adapter: "file",
        sourcevision: "auto",
      },
      null,
      2,
    ) + "\n",
  );

  const items = overrides.items ?? [
    {
      id: "epic-1",
      level: "epic",
      title: "Test Epic",
      status: "pending",
      priority: "medium",
      children: [
        {
          id: "task-1",
          level: "task",
          title: "Test Task",
          status: "completed",
          priority: "medium",
        },
        {
          id: "task-2",
          level: "task",
          title: "Another Task",
          status: "pending",
          priority: "low",
        },
      ],
    },
  ];

  await writeFile(
    join(dir, ".rex", "prd.json"),
    JSON.stringify(
      {
        schema: "rex/v1",
        title: overrides.project ?? "Test Project",
        items,
      },
      null,
      2,
    ) + "\n",
  );
}

/**
 * Set up a minimal .hench directory with valid config.
 *
 * @param {string} dir - Project root directory
 */
export async function setupHenchDir(dir) {
  await mkdir(join(dir, ".hench", "runs"), { recursive: true });

  await writeFile(
    join(dir, ".hench", "config.json"),
    JSON.stringify(
      {
        schema: "hench/v1",
        provider: "cli",
        model: "sonnet",
        maxTurns: 50,
        maxTokens: 8192,
        rexDir: ".rex",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        guard: {
          blockedPaths: [".hench/**", ".rex/**", ".git/**", "node_modules/**"],
          allowedCommands: ["npm", "npx", "node", "git", "tsc", "vitest"],
          commandTimeout: 30000,
          maxFileSize: 1048576,
        },
      },
      null,
      2,
    ) + "\n",
  );
}

/**
 * Set up a minimal .sourcevision directory with valid data files.
 *
 * @param {string} dir - Project root directory
 */
export async function setupSourcevisionDir(dir) {
  await mkdir(join(dir, ".sourcevision"), { recursive: true });

  await writeFile(
    join(dir, ".sourcevision", "manifest.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: new Date().toISOString(),
      targetPath: dir,
      modules: {
        inventory: { status: "complete", lastRun: new Date().toISOString() },
        imports: { status: "complete", lastRun: new Date().toISOString() },
        zones: { status: "complete", lastRun: new Date().toISOString() },
        components: { status: "complete", lastRun: new Date().toISOString() },
      },
    }),
  );

  await writeFile(
    join(dir, ".sourcevision", "inventory.json"),
    JSON.stringify({ files: [], summary: { totalFiles: 0, totalBytes: 0, languages: {} } }),
  );
  await writeFile(
    join(dir, ".sourcevision", "imports.json"),
    JSON.stringify({
      edges: [],
      external: {},
      summary: { totalEdges: 0, totalExternal: 0 },
    }),
  );
  await writeFile(
    join(dir, ".sourcevision", "zones.json"),
    JSON.stringify({
      zones: [],
      crossings: [],
      unzoned: [],
      summary: { totalZones: 0, totalFiles: 0 },
    }),
  );
  await writeFile(
    join(dir, ".sourcevision", "components.json"),
    JSON.stringify({
      components: [],
      routeModules: [],
      usageEdges: [],
      summary: { totalComponents: 0, totalRouteModules: 0, totalUsageEdges: 0 },
    }),
  );
}

/**
 * Set up a complete project with all three package directories.
 *
 * @param {string} dir - Project root directory
 */
export async function setupFullProject(dir) {
  await Promise.all([
    setupRexDir(dir),
    setupHenchDir(dir),
    setupSourcevisionDir(dir),
  ]);
}
