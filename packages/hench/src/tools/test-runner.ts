import { stat } from "node:fs/promises";
import { dirname, join, basename, extname, normalize } from "node:path";

/**
 * Automatic test runner — identifies and runs relevant tests after task completion.
 *
 * Strategy:
 * 1. From the list of changed files, find co-located test files
 * 2. Run the project test command scoped to those files (if the runner supports it)
 * 3. Fall back to the full test command if scoping isn't possible
 * 4. Report results for inclusion in the run summary
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PostRunTestResult {
  /** Whether tests were executed at all. */
  ran: boolean;
  /** Whether all tests passed. */
  passed: boolean;
  /** The command that was executed. */
  command?: string;
  /** Human-readable summary of test output. */
  output?: string;
  /** How long the test run took in ms. */
  durationMs?: number;
  /** Test files that were targeted. Empty if full suite was run. */
  targetedFiles: string[];
  /** Error message if tests couldn't be run. */
  error?: string;
}

export interface TestRunnerOptions {
  /** Project root directory. */
  projectDir: string;
  /** Files changed during the task (relative paths). */
  filesChanged: string[];
  /** Configured test command (e.g. "pnpm test"). */
  testCommand?: string;
  /** Timeout for the test command in ms. Default: 120_000. */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 120_000;

/** Common test file patterns — matches *.test.ts, *.spec.js, *_test.go, etc. */
const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.[jt]sx?$/,
  /_spec\.[jt]sx?$/,
  /_test\.go$/,
];

/** Test runners that support file-path arguments for scoped runs. */
const SCOPEABLE_RUNNERS: Record<string, (files: string[]) => string[]> = {
  vitest: (files) => ["run", ...files],
  jest: (files) => ["--", ...files],
  mocha: (files) => files,
};

/**
 * Adjacent directories to search for tests relative to a source file.
 * Ordered by convention prevalence.
 */
const TEST_DIR_CANDIDATES = [
  "__tests__",
  "tests",
  "test",
];

/** Runner name used for Go test detection and scoping. */
const GO_TEST_RUNNER = "go";

// ---------------------------------------------------------------------------
// Test file discovery
// ---------------------------------------------------------------------------

/** Check if a path looks like a test file. */
export function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERNS.some((p) => p.test(filePath));
}

/**
 * Given a source file path, generate candidate test file paths.
 *
 * For `src/agent/loop.ts`, generates:
 * - `src/agent/loop.test.ts`
 * - `src/agent/loop.spec.ts`
 * - `src/agent/__tests__/loop.test.ts`
 * - `tests/agent/loop.test.ts`  (mirrors src → tests)
 * - etc.
 */
export function candidateTestPaths(filePath: string): string[] {
  if (isTestFile(filePath)) return [filePath];

  const dir = dirname(filePath);
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const candidates: string[] = [];

  // Go source files: _test.go in the same directory (Go convention)
  if (ext === ".go") {
    candidates.push(join(dir, `${base}_test.go`));
    return candidates;
  }

  // JS/TS: Co-located with .test/.spec suffix
  for (const suffix of [".test", ".spec"]) {
    candidates.push(join(dir, `${base}${suffix}${ext}`));
  }

  // Adjacent test directories
  for (const testDir of TEST_DIR_CANDIDATES) {
    for (const suffix of [".test", ".spec"]) {
      candidates.push(join(dir, testDir, `${base}${suffix}${ext}`));
    }
  }

  // Mirror src → tests: src/foo/bar.ts → tests/foo/bar.test.ts
  const srcDirMatch = dir.match(/^(.*?)src[/\\](.*)/);
  if (srcDirMatch) {
    const [, prefix, rest] = srcDirMatch;
    for (const testDir of TEST_DIR_CANDIDATES) {
      for (const suffix of [".test", ".spec"]) {
        candidates.push(join(prefix, testDir, rest, `${base}${suffix}${ext}`));
      }
    }
  }

  return candidates;
}

/**
 * Find test files that exist on disk for the given changed files.
 *
 * Deduplicates at two levels:
 * 1. Candidate paths — avoids redundant stat() calls when multiple source
 *    files generate the same candidate.
 * 2. Result paths — prevents the same test file appearing twice in the output,
 *    even if reached through differently-formatted candidate paths.
 */
export async function findRelevantTests(
  projectDir: string,
  filesChanged: string[],
): Promise<string[]> {
  const seenCandidates = new Set<string>();
  const seenResults = new Set<string>();
  const results: string[] = [];

  for (const file of filesChanged) {
    const candidates = candidateTestPaths(file);

    for (const candidate of candidates) {
      const normalized = normalize(candidate);
      if (seenCandidates.has(normalized)) continue;
      seenCandidates.add(normalized);

      try {
        const fullPath = join(projectDir, normalized);
        const s = await stat(fullPath);
        if (s.isFile() && !seenResults.has(normalized)) {
          seenResults.add(normalized);
          results.push(normalized);
        }
      } catch {
        // File doesn't exist — skip
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Runner detection and scoping
// ---------------------------------------------------------------------------

/**
 * Extract the test runner name from a test command string.
 * e.g. "pnpm test" → "pnpm", "npx vitest" → "vitest", "vitest run" → "vitest"
 */
export function detectRunner(testCommand: string): string | undefined {
  const parts = testCommand.trim().split(/\s+/);

  // Skip package manager wrappers to find the actual runner
  for (const part of parts) {
    const name = basename(part);
    if (name in SCOPEABLE_RUNNERS) return name;
  }

  // Detect Go test runner: requires "go test" pattern (not just "go")
  if (
    parts.length >= 2 &&
    basename(parts[0]) === GO_TEST_RUNNER &&
    parts[1] === "test"
  ) {
    return GO_TEST_RUNNER;
  }

  return undefined;
}

/**
 * Build a scoped test command targeting specific files.
 * Returns undefined if the runner doesn't support file scoping.
 *
 * Preserves existing flags (e.g. `jest --ci` → `jest --ci -- file.test.ts`).
 * Deduplicates the vitest `run` subcommand when already present.
 */
export function buildScopedCommand(
  testCommand: string,
  runner: string,
  testFiles: string[],
): string | undefined {
  // Go uses package-path scoping (replaces targets, doesn't append file paths)
  if (runner === GO_TEST_RUNNER) {
    return buildGoScopedCommand(testCommand, testFiles);
  }

  const scopeFn = SCOPEABLE_RUNNERS[runner];
  if (!scopeFn) return undefined;

  const scopeArgs = scopeFn(testFiles);

  const parts = testCommand.trim().split(/\s+/);
  const runnerIdx = parts.findIndex((p) => basename(p) === runner);

  if (runnerIdx >= 0) {
    // Runner is explicitly in the command.
    // Keep everything before AND after the runner, then append scope args.
    const before = parts.slice(0, runnerIdx + 1);
    const after = parts.slice(runnerIdx + 1);

    // Deduplicate: if scope args start with a subcommand (e.g. "run")
    // that is already present in the trailing args, strip it.
    let mergedScope = scopeArgs;
    if (after.length > 0 && scopeArgs.length > 0 && after[0] === scopeArgs[0]) {
      mergedScope = scopeArgs.slice(1);
    }

    return [...before, ...after, ...mergedScope].join(" ");
  }

  // Package manager wrapper (e.g. "pnpm test") — append with --
  return `${testCommand} -- ${testFiles.join(" ")}`;
}

/**
 * Build a Go-specific scoped test command.
 *
 * Go tests target package paths, not individual files. Extracts unique
 * directories from test file paths and converts them to Go package patterns:
 *   `internal/handler/user_test.go` → `go test ./internal/handler/...`
 *
 * Preserves flags (e.g. `-v`, `-count=1`) and drops existing package targets
 * (e.g. `./...`) since they are replaced by the scoped paths.
 */
function buildGoScopedCommand(
  testCommand: string,
  testFiles: string[],
): string {
  const pkgPaths = goPackagePaths(testFiles);
  const parts = testCommand.trim().split(/\s+/);
  const goIdx = parts.findIndex((p) => basename(p) === GO_TEST_RUNNER);

  if (goIdx < 0) {
    return `go test ${pkgPaths.join(" ")}`;
  }

  const testIdx = parts.indexOf("test", goIdx + 1);
  if (testIdx < 0) {
    // "go" found but no "test" subcommand — add it
    return [...parts, "test", ...pkgPaths].join(" ");
  }

  // Keep "go test", preserve flags (start with -), replace package targets
  const prefix = parts.slice(0, testIdx + 1);
  const afterTest = parts.slice(testIdx + 1);
  const flags = afterTest.filter((p) => p.startsWith("-"));

  return [...prefix, ...flags, ...pkgPaths].join(" ");
}

/**
 * Convert test file paths to Go package path patterns.
 *   `internal/handler/user_test.go` → `./internal/handler/...`
 *   `main_test.go` (root)           → `.`
 */
function goPackagePaths(testFiles: string[]): string[] {
  const dirs = new Set<string>();
  for (const f of testFiles) {
    const d = dirname(f);
    dirs.add(d === "." ? "." : `./${d}/...`);
  }
  return [...dirs];
}

// ---------------------------------------------------------------------------
// Shell execution (via centralized process module)
// ---------------------------------------------------------------------------

import { execShellCmd } from "../process/index.js";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run relevant tests after task completion.
 *
 * 1. Skip if no test command is configured.
 * 2. Discover test files related to changed source files.
 * 3. If relevant tests found and runner supports scoping, run scoped.
 * 4. Otherwise, run the full test command.
 * 5. Return structured results.
 */
export async function runPostTaskTests(
  options: TestRunnerOptions,
): Promise<PostRunTestResult> {
  const { projectDir, filesChanged, testCommand, timeout = DEFAULT_TIMEOUT } = options;

  if (!testCommand) {
    return { ran: false, passed: false, targetedFiles: [], error: "No test command configured" };
  }

  if (filesChanged.length === 0) {
    return { ran: false, passed: false, targetedFiles: [], error: "No files changed" };
  }

  // Discover relevant test files
  const testFiles = await findRelevantTests(projectDir, filesChanged);

  // Determine if we can scope the run
  const runner = detectRunner(testCommand);
  let command: string;
  let targetedFiles: string[];

  if (testFiles.length > 0 && runner) {
    const scoped = buildScopedCommand(testCommand, runner, testFiles);
    if (scoped) {
      command = scoped;
      targetedFiles = testFiles;
    } else {
      command = testCommand;
      targetedFiles = [];
    }
  } else {
    // Can't scope — run the full suite
    command = testCommand;
    targetedFiles = [];
  }

  const startMs = Date.now();
  const { stdout, stderr, exitCode } = await execShellCmd(
    command,
    { cwd: projectDir, timeout, maxBuffer: 2 * 1024 * 1024 },
  );
  const durationMs = Date.now() - startMs;

  const passed = exitCode === 0;
  const output = truncateOutput(stdout, stderr, 2000);

  return {
    ran: true,
    passed,
    command,
    output,
    durationMs,
    targetedFiles,
    error: exitCode === null ? "Test command timed out" : undefined,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateOutput(stdout: string, stderr: string, maxLen: number): string {
  // Prefer stdout (test results), fall back to stderr
  const combined = stdout.trim() || stderr.trim();
  if (combined.length <= maxLen) return combined;

  // Keep the last N characters (usually the summary is at the end)
  return "…" + combined.slice(-(maxLen - 1));
}
