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

import { execShellCmd } from "../process/exec.js";

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

// ---------------------------------------------------------------------------
// Test suite gate (mandatory full test suite validation for self-heal mode)
// ---------------------------------------------------------------------------

import type { TestGateResult, TestPackageResult } from "../schema/index.js";

export interface TestGateOptions {
  /** Project root directory. */
  projectDir: string;
  /** Files changed during the task. */
  filesChanged: string[];
  /** Timeout for the test command in ms. Default: 300_000. */
  timeout?: number;
}

const TEST_GATE_TIMEOUT = 300_000; // 5 minutes

/**
 * Vitest JSON reporter output structure.
 */
interface VitestJsonReport {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: Array<{
    filepath: string;
    numFailingTests: number;
    failureMessage?: string;
  }>;
}

/**
 * Extract package name from a filepath.
 * e.g., "packages/hench/tests/..." → "hench"
 *       "packages/sourcevision/src/..." → "sourcevision"
 */
function extractPackageName(filepath: string): string {
  const match = filepath.match(/packages\/([^/]+)\//);
  if (match) return match[1];

  // Fallback: take the first directory component
  const parts = filepath.split(/[/\\]/);
  if (parts.length > 0) return parts[0];

  return filepath;
}

/**
 * Parse vitest JSON output and aggregate results by package.
 *
 * Handles both successful JSON parsing and fallback to stderr parsing
 * when JSON is malformed.
 */
function parseVitestOutput(stdout: string, stderr: string): TestPackageResult[] {
  // Try to parse JSON output from stdout
  if (stdout.trim()) {
    try {
      const report = JSON.parse(stdout) as VitestJsonReport;

      // Group test results by package
      const packages = new Map<string, TestPackageResult>();

      // Initialize packages from test results
      for (const testResult of report.testResults) {
        const pkgName = extractPackageName(testResult.filepath);

        if (!packages.has(pkgName)) {
          packages.set(pkgName, {
            name: pkgName,
            passed: true,
            testCount: 0,
            failureCount: 0,
          });
        }

        const pkg = packages.get(pkgName)!;
        pkg.testCount = (pkg.testCount ?? 0) + 1;

        if (testResult.numFailingTests > 0) {
          pkg.passed = false;
          pkg.failureCount = (pkg.failureCount ?? 0) + testResult.numFailingTests;

          // Capture first failure message for this package
          if (!pkg.failureOutput && testResult.failureMessage) {
            pkg.failureOutput = truncateOutput(testResult.failureMessage, "", 500);
          }
        }
      }

      // If no test results, use overall counts to infer pass/fail
      if (packages.size === 0) {
        const pkgName = "workspace";
        packages.set(pkgName, {
          name: pkgName,
          passed: report.numFailedTests === 0,
          testCount: report.numTotalTests,
          failureCount: report.numFailedTests,
        });
      }

      return Array.from(packages.values());
    } catch {
      // JSON parse failed — fall through to stderr parsing
    }
  }

  // Fallback: parse stderr for error messages
  if (stderr.trim()) {
    // Extract package names from error patterns like "packages/xyz/..."
    const pkgMatches = stderr.match(/packages\/([^/\s]+)/g) ?? [];
    const pkgNames = new Set(
      pkgMatches.map((m) => m.split("/")[1]).filter(Boolean),
    );

    if (pkgNames.size > 0) {
      return Array.from(pkgNames).map((name) => ({
        name,
        passed: false,
        failureOutput: truncateOutput(stderr, "", 500),
      }));
    }

    // Generic failure with no package info
    return [{
      name: "workspace",
      passed: false,
      failureOutput: truncateOutput(stderr, "", 500),
    }];
  }

  return [];
}

/**
 * Run the full test suite as a mandatory gate in self-heal mode.
 *
 * Behavior:
 * - Skips if filesChanged is empty (no modifications to test)
 * - Runs `pnpm test --reporter=json` to capture structured output
 * - Aggregates results by package (packages/xyz/...)
 * - Returns per-package pass/fail status and failure counts
 * - Never throws — always returns a structured result
 */
export async function runTestGate(
  options: TestGateOptions,
): Promise<TestGateResult> {
  const { projectDir, filesChanged, timeout = TEST_GATE_TIMEOUT } = options;

  // Skip if no files were modified
  if (filesChanged.length === 0) {
    return {
      ran: false,
      passed: true,
      packages: [],
      skipReason: "No files modified in prior phases",
    };
  }

  const command = "pnpm test --reporter=json";
  const startMs = Date.now();

  const { stdout, stderr, exitCode } = await execShellCmd(command, {
    cwd: projectDir,
    timeout,
    maxBuffer: 5 * 1024 * 1024, // 5MB for larger test output
  });

  const totalDurationMs = Date.now() - startMs;

  // Handle timeout
  if (exitCode === null) {
    return {
      ran: true,
      passed: false,
      packages: [],
      command,
      totalDurationMs,
      error: "Test command timed out",
    };
  }

  // Parse output to extract per-package results
  const packages = parseVitestOutput(stdout, stderr);
  const overallPassed = exitCode === 0;

  return {
    ran: true,
    passed: overallPassed,
    packages,
    command,
    totalDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Dependency audit (pre-loop validation for self-heal mode)
// ---------------------------------------------------------------------------

import type {
  DependencyAuditResult,
  DependencyVulnerability,
  DependencyOutdated,
  DependencyAuditPackageResult,
} from "../schema/index.js";

export interface DependencyAuditOptions {
  /** Project root directory. */
  projectDir: string;
  /** Timeout for pnpm commands in ms. Default: 60_000. */
  timeout?: number;
}

const DEPENDENCY_AUDIT_TIMEOUT = 60_000; // 1 minute per command

/**
 * Parse pnpm audit JSON output and extract vulnerability data.
 * Returns both aggregated counts and detailed vulnerability list.
 */
function parsePnpmAuditOutput(stdout: string): {
  vulnerabilities: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    packages: DependencyVulnerability[];
  };
  perPackageVulnerabilityCount: Map<string, number>;
} {
  const vulnerabilities = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    packages: [] as DependencyVulnerability[],
  };
  const perPackageVulnerabilityCount = new Map<string, number>();

  if (!stdout.trim()) {
    return { vulnerabilities, perPackageVulnerabilityCount };
  }

  try {
    const auditData = JSON.parse(stdout) as any;

    // Handle pnpm audit JSON output format
    if (auditData.metadata?.vulnerabilities) {
      const counts = auditData.metadata.vulnerabilities;
      vulnerabilities.critical = counts.critical ?? 0;
      vulnerabilities.high = counts.high ?? 0;
      vulnerabilities.moderate = counts.moderate ?? 0;
      vulnerabilities.low = counts.low ?? 0;
    }

    // Extract detailed vulnerability info from vulnerabilities object
    if (auditData.vulnerabilities) {
      for (const pkgName of Object.keys(auditData.vulnerabilities)) {
        const pkgVulns = auditData.vulnerabilities[pkgName];
        if (Array.isArray(pkgVulns.via)) {
          for (const vuln of pkgVulns.via) {
            if (typeof vuln === "object" && vuln.severity) {
              vulnerabilities.packages.push({
                name: pkgName,
                version: pkgVulns.version ?? "unknown",
                severity: vuln.severity,
              });

              // Track per-package counts
              perPackageVulnerabilityCount.set(
                pkgName,
                (perPackageVulnerabilityCount.get(pkgName) ?? 0) + 1,
              );
            }
          }
        }
      }
    }
  } catch {
    // JSON parse failed, return empty results
  }

  return { vulnerabilities, perPackageVulnerabilityCount };
}

/**
 * Parse pnpm outdated JSON output and categorize by update type.
 */
function parsePnpmOutdatedOutput(stdout: string): {
  outdated: {
    major: string[];
    minor: string[];
    patch: string[];
  };
  perPackageOutdatedCount: Map<string, number>;
} {
  const outdated = {
    major: [] as string[],
    minor: [] as string[],
    patch: [] as string[],
  };
  const perPackageOutdatedCount = new Map<string, number>();

  if (!stdout.trim()) {
    return { outdated, perPackageOutdatedCount };
  }

  try {
    const outdatedData = JSON.parse(stdout) as Record<string, any>;

    for (const pkgName of Object.keys(outdatedData)) {
      const pkg = outdatedData[pkgName];
      if (!pkg.current || !pkg.latest) continue;

      // Simple version comparison: split by dots and compare numeric parts
      const currentParts = pkg.current.split(".").map((x: string) => parseInt(x) || 0);
      const latestParts = pkg.latest.split(".").map((x: string) => parseInt(x) || 0);

      if (currentParts[0] < latestParts[0]) {
        outdated.major.push(pkgName);
      } else if (currentParts[1] < latestParts[1]) {
        outdated.minor.push(pkgName);
      } else if (currentParts[2] < latestParts[2]) {
        outdated.patch.push(pkgName);
      }

      perPackageOutdatedCount.set(
        pkgName,
        (perPackageOutdatedCount.get(pkgName) ?? 0) + 1,
      );
    }
  } catch {
    // JSON parse failed, return empty results
  }

  return { outdated, perPackageOutdatedCount };
}

/**
 * Run a comprehensive dependency audit: vulnerabilities, outdated versions.
 *
 * Behavior:
 * - Runs `pnpm audit --json` to detect known vulnerabilities
 * - Runs `pnpm outdated --json` to detect outdated versions
 * - Aggregates results by severity and update type
 * - Merges per-package counts to provide monorepo-wide summary
 * - Never throws — always returns a structured result
 * - Timeout: 60 seconds per command
 */
export async function runDependencyAudit(
  options: DependencyAuditOptions,
): Promise<DependencyAuditResult> {
  const { projectDir, timeout = DEPENDENCY_AUDIT_TIMEOUT } = options;

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  let vulnerabilities = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    packages: [] as DependencyVulnerability[],
  };
  let outdated = {
    major: [] as string[],
    minor: [] as string[],
    patch: [] as string[],
  };
  const perPackageMetrics = new Map<string, DependencyAuditPackageResult>();

  // Step 1: Run pnpm audit
  let auditCommand = "pnpm audit --json";
  let auditExitCode: number | null = 1;

  try {
    const auditResult = await execShellCmd(auditCommand, {
      cwd: projectDir,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });

    auditExitCode = auditResult.exitCode;

    if (auditResult.exitCode !== null && auditResult.stdout) {
      const { vulnerabilities: parsed, perPackageVulnerabilityCount } =
        parsePnpmAuditOutput(auditResult.stdout);
      vulnerabilities = parsed;

      // Populate per-package metrics from audit
      for (const [pkgName, count] of perPackageVulnerabilityCount) {
        if (!perPackageMetrics.has(pkgName)) {
          perPackageMetrics.set(pkgName, {
            name: pkgName,
            vulnerabilityCount: 0,
            outdatedCount: 0,
          });
        }
        const metrics = perPackageMetrics.get(pkgName)!;
        metrics.vulnerabilityCount = count;
      }
    }
  } catch {
    // pnpm audit failed, continue with outdated check
  }

  // Step 2: Run pnpm outdated
  let outdatedCommand = "pnpm outdated --json";
  let outdatedExitCode: number | null = 1;

  try {
    const outdatedResult = await execShellCmd(outdatedCommand, {
      cwd: projectDir,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
    });

    outdatedExitCode = outdatedResult.exitCode;

    if (outdatedResult.exitCode !== null && outdatedResult.stdout) {
      const { outdated: parsed, perPackageOutdatedCount } =
        parsePnpmOutdatedOutput(outdatedResult.stdout);
      outdated = parsed;

      // Populate per-package metrics from outdated
      for (const [pkgName, count] of perPackageOutdatedCount) {
        if (!perPackageMetrics.has(pkgName)) {
          perPackageMetrics.set(pkgName, {
            name: pkgName,
            vulnerabilityCount: 0,
            outdatedCount: 0,
          });
        }
        const metrics = perPackageMetrics.get(pkgName)!;
        metrics.outdatedCount = count;
      }
    }
  } catch {
    // pnpm outdated failed, continue
  }

  const finishedAt = new Date().toISOString();
  const totalDurationMs = Date.now() - startMs;

  // Determine overall pass/fail: pass only if no vulnerabilities or outdated packages
  const hasIssues =
    vulnerabilities.critical > 0 ||
    vulnerabilities.high > 0 ||
    outdated.major.length > 0;

  return {
    ran: true,
    skipped: false,
    startedAt,
    finishedAt,
    totalDurationMs,
    vulnerabilities,
    outdated,
    perPackage: Array.from(perPackageMetrics.values()),
    commands: {
      audit: { command: auditCommand, exitCode: auditExitCode ?? 1 },
      outdated: { command: outdatedCommand, exitCode: outdatedExitCode ?? 1 },
    },
  };
}
