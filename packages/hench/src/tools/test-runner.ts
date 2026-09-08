import { stat } from "node:fs/promises";
import { dirname, join, basename, extname, normalize, sep } from "node:path";

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
 * Convert a filesystem path into a form safe to embed in a shell command string.
 *
 * findRelevantTests correctly returns OS-native paths — it stat()s them, and
 * Windows accepts backslashes. But those values then become part of a COMMAND
 * STRING, and runPostTaskTests runs that through execShellCmd, which is
 * `exec("sh", ["-c", cmd])` on every platform. A POSIX shell reads each
 * backslash as an escape, so "src\agent\loop.test.ts" arrives as
 * "srcagentloop.test.ts", the runner's filter matches nothing, and vitest exits
 * 1 — making every scoped post-task run on Windows report failure regardless of
 * the code.
 *
 * Forward slashes survive sh untouched and are accepted as filters by vitest,
 * jest and mocha, and are the required form for Go package patterns.
 *
 * Uses `sep` rather than replacing all backslashes: on POSIX `sep` is "/", so
 * this is the identity there and a literal backslash in a (legal, if unusual)
 * POSIX filename is left intact.
 */
function toCommandPath(filePath: string): string {
  return filePath.split(sep).join("/");
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
  // Normalized once here — the boundary where these stop being filesystem paths
  // and become shell-command text. Deliberately NOT done in findRelevantTests,
  // whose callers stat() the values and need them OS-native.
  const commandFiles = testFiles.map(toCommandPath);

  // Go uses package-path scoping (replaces targets, doesn't append file paths)
  if (runner === GO_TEST_RUNNER) {
    return buildGoScopedCommand(testCommand, commandFiles);
  }

  const scopeFn = SCOPEABLE_RUNNERS[runner];
  if (!scopeFn) return undefined;

  const scopeArgs = scopeFn(commandFiles);

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
  return `${testCommand} -- ${commandFiles.join(" ")}`;
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
  const { stdout, stderr, exitCode, launched, error } = await execShellCmd(
    command,
    { cwd: projectDir, timeout, maxBuffer: 2 * 1024 * 1024 },
  );
  const durationMs = Date.now() - startMs;

  // Same hazard as runTestGate: a command that could not be spawned comes back
  // as exitCode 1 with empty output, so inferring from exitCode alone records a
  // test failure for tests that never ran. Reported as `ran: false` instead.
  if (!launched) {
    return {
      ran: false,
      passed: false,
      command,
      output: "",
      durationMs,
      targetedFiles,
      error:
        `Tests could not be executed — the command was never launched ` +
        `(${error?.message ?? "spawn failed"})`,
    };
  }

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
  /** Test command to execute. If not provided, defaults to "pnpm test --reporter=json". */
  testCommand?: string;
  /** Timeout for the test command in ms. Default: 300_000. */
  timeout?: number;
}

/**
 * Budget for the whole-suite gate.
 *
 * RAISED 5m → 15m, from measurement. This repo's `npm run test` was timed at
 * **248s** on an idle machine (2026-09-03, Windows 11, Node v22) — 83% of the
 * old 300_000 ceiling. The gate runs at the end of an `ndx work` task, when the
 * agent's own subprocesses are still competing for cores, so the suite is
 * reliably slower there than when measured by hand. A budget the happy path
 * already nearly exhausts is a flake generator, not a guardrail.
 *
 * This is a HANG guardrail, not a latency SLA — nothing about the project is
 * asserted by the number, so the cost of setting it generously is only a slower
 * failure when something is genuinely stuck. 3x the measured duration leaves
 * room for a suite that grows and for a loaded machine, and still bounds a hang.
 *
 * Re-measure before tightening: `npm run test` at the repo root, and compare
 * against the timeout the gate actually used (it is reported in the timeout
 * message, which now names both durations).
 */
const TEST_GATE_TIMEOUT = 900_000; // 15 minutes — see above; measured 248s idle

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

/** How much raw runner output to keep when there is nothing structured to show. */
const RAW_OUTPUT_CHARS = 2000;

/**
 * Parse test-runner output and aggregate results by package.
 *
 * Two shapes are handled, and the second is not a degraded case — it is the
 * normal one for most projects:
 *
 * 1. **vitest JSON** (`--reporter=json`), the gate's own default command.
 * 2. **Anything else.** `autoDetectTestCommand` returns `npm run test` whenever
 *    package.json has a `test` script, which is most repos and this one — where
 *    it runs `scripts/run-all-tests.mjs` and prints a human-readable summary.
 *
 * NEVER RETURNS AN EMPTY ARRAY for a run that produced output. It used to, and
 * that was the defect: JSON.parse threw, the fallback looked only at stderr
 * while this runner writes its summary to stdout, and `[]` came back. The
 * lifecycle rendered that as `✗ 0/0 package(s) failed` and found no
 * `failureOutput` to print, so a genuine failure was indistinguishable from a
 * suite that never launched — and neither told the operator anything. An
 * unparseable failing run must still hand back the raw output.
 *
 * @param passed Whether the command exited zero. Needed because an unparseable
 *   run still has a known outcome, and a fabricated package entry must not
 *   claim the opposite of it.
 */
function parseVitestOutput(
  stdout: string,
  stderr: string,
  passed: boolean,
): TestPackageResult[] {
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
      // Not vitest JSON — fall through to the human-readable path below.
    }
  }

  // BOTH streams, not just stderr. Test runners disagree about which one carries
  // the summary: vitest writes it to stderr, `scripts/run-all-tests.mjs` writes
  // it to stdout. Reading only stderr meant a failing run through the latter
  // produced no packages and no output at all.
  const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");

  if (!combined) {
    // A command that ran, said nothing, and exited. Still reported rather than
    // dropped: "no output" is itself the diagnosis when a gate goes red.
    return [{
      name: "workspace",
      passed,
      failureOutput: passed ? undefined : "The test command produced no output.",
    }];
  }

  // Truncates the COMBINED text, not `truncateOutput(stdout, stderr, …)` — that
  // helper takes `stdout || stderr`, so a non-empty stdout discards stderr
  // entirely. Vitest splits its output across both: the progress lines and the
  // `×` markers go to stdout, the AssertionError block to stderr. Preferring one
  // stream showed the operator which test failed but not why.
  const rawOutput = truncateOutput(combined, "", RAW_OUTPUT_CHARS);

  // A passing run needs no post-mortem — attaching output to a green gate is
  // noise, and the package list exists only so the count is honest.
  if (passed) {
    return [{ name: "workspace", passed: true }];
  }

  // Name the failing packages when the output identifies them, so the summary
  // line is useful on its own.
  //
  // Scanned per-LINE, and only lines carrying a failure marker. Matching package
  // names across the whole output would collect every package the run mentions —
  // a summary listing `PASS @n-dx/hench` through `FAIL @n-dx/rex` would report
  // all six as failed. Confidently wrong is worse than unspecific: when nothing
  // matches, this falls back to one `workspace` entry carrying the raw output,
  // which still shows the operator exactly what happened.
  const failureLines = combined
    .split(/\r?\n/)
    .filter((line) => /(\bFAIL(ED)?\b|✗|×|\bfailed:)/i.test(line));

  const pkgNames = new Set(
    failureLines.flatMap((line) => [
      ...(line.match(/packages\/([^/\s]+)/g) ?? []).map((m) => m.split("/")[1]),
      ...(line.match(/@[a-z0-9-]+\/[a-z0-9-]+/gi) ?? []).map((m) => m.split("/")[1]),
    ]).filter(Boolean),
  );

  if (pkgNames.size > 0) {
    // Raw output goes on the FIRST entry only. Repeating a 2 KB dump per package
    // buries the one copy the operator needs to read.
    return Array.from(pkgNames).map((name, i) => ({
      name,
      passed: false,
      failureOutput: i === 0 ? rawOutput : undefined,
    }));
  }

  return [{ name: "workspace", passed: false, failureOutput: rawOutput }];
}

/**
 * Run the full test suite as a mandatory gate in self-heal mode.
 *
 * Behavior:
 * - Skips if filesChanged is empty (no modifications to test)
 * - Runs the configured test command (or "pnpm test --reporter=json" by default)
 * - Aggregates results by package (packages/xyz/...)
 * - Returns per-package pass/fail status and failure counts
 * - Never throws — always returns a structured result
 */
export async function runTestGate(
  options: TestGateOptions,
): Promise<TestGateResult> {
  const { projectDir, filesChanged, testCommand, timeout = TEST_GATE_TIMEOUT } = options;

  // Skip if no files were modified
  if (filesChanged.length === 0) {
    return {
      ran: false,
      passed: true,
      packages: [],
      skipReason: "No files modified in prior phases",
    };
  }

  // Use provided command or default to pnpm test with JSON reporter
  const command = testCommand || "pnpm test --reporter=json";
  const startMs = Date.now();

  const { stdout, stderr, exitCode, launched, error } = await execShellCmd(command, {
    cwd: projectDir,
    timeout,
    maxBuffer: 5 * 1024 * 1024, // 5MB for larger test output
  });

  const totalDurationMs = Date.now() - startMs;

  // The suite never started: the shell or the command could not be spawned.
  //
  // `exec` reports a spawn failure as exitCode 1 with empty stdout/stderr, which
  // is byte-for-byte indistinguishable from a real failing exit unless `launched`
  // is consulted — see ExecResult.launched. Inferring from exitCode alone told the
  // operator their tests had failed for a suite that never ran, and in autonomous
  // mode that aborted the run, which suppressed the PRD completion write and the
  // commit for work that was already finished. On Windows without a POSIX shell
  // this fired on essentially every task until b5a3a3e0 fixed shell resolution.
  //
  // Reported as `ran: false` so callers treat it as INCONCLUSIVE. It is not a
  // verdict on the code: nothing was tested, so nothing can be said to have failed.
  if (!launched) {
    return {
      ran: false,
      passed: false,
      packages: [],
      command,
      totalDurationMs,
      error:
        `Test gate could not be executed — the command was never launched ` +
        `(${error?.message ?? "spawn failed"})`,
    };
  }

  // Timed out.
  //
  // Still FAILS the run, deliberately — unlike a suite that never launched. A
  // gate that cannot finish inside its budget, on code the agent has just
  // changed, is a reason to stop and have someone look; a hang is often the
  // change. Only the reporting changes here.
  //
  // What changes: it no longer returns an empty package list, which printed as
  // `✗ 0/0 package(s) failed` — the same output as every other unreportable
  // outcome. And whatever arrived before the kill is kept, because a suite that
  // hangs usually hangs somewhere specific and that place is in the partial
  // output.
  if (exitCode === null) {
    // Combined for the same reason as the parse path below: a runner splits its
    // output across both streams, and preferring one drops half the evidence.
    const partial = truncateOutput(
      [stdout.trim(), stderr.trim()].filter(Boolean).join("\n"),
      "",
      RAW_OUTPUT_CHARS,
    );
    return {
      ran: true,
      passed: false,
      packages: [
        {
          name: "workspace",
          passed: false,
          failureOutput: partial || "No output was produced before the timeout.",
        },
      ],
      command,
      totalDurationMs,
      error:
        `Test command timed out after ${formatMs(timeout)} ` +
        `(ran for ${formatMs(totalDurationMs)})`,
    };
  }

  const overallPassed = exitCode === 0;
  const packages = parseVitestOutput(stdout, stderr, overallPassed);

  return {
    ran: true,
    passed: overallPassed,
    packages,
    command,
    totalDurationMs,
  };
}

/** Whole seconds for short spans, minutes and seconds beyond one minute. */
function formatMs(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ---------------------------------------------------------------------------
// Dependency audit (pre-loop validation for self-heal mode)
// ---------------------------------------------------------------------------

import type { ExecResult } from "../process/exec.js";
import type {
  DependencyAuditResult,
  DependencyAuditCommandRecord,
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
 * Outcome of parsing one audit step's stdout.
 *
 * `parsed` is load-bearing, not decoration. Both parsers return all-zero counts
 * when they cannot read their input, and zeros are indistinguishable from a
 * clean result — so the caller has to be told whether the numbers came from the
 * output or from the initializer.
 */
type AuditParse<T> = { parsed: true; value: T } | { parsed: false; parseError: string };

/**
 * Parse pnpm audit JSON output and extract vulnerability data.
 * Returns both aggregated counts and detailed vulnerability list.
 *
 * Unparseable or unrecognized output is reported as `parsed: false` rather than
 * as zero vulnerabilities — see {@link AuditParse}.
 */
function parsePnpmAuditOutput(stdout: string): AuditParse<{
  vulnerabilities: {
    critical: number;
    high: number;
    moderate: number;
    low: number;
    packages: DependencyVulnerability[];
  };
  perPackageVulnerabilityCount: Map<string, number>;
}> {
  const vulnerabilities = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    packages: [] as DependencyVulnerability[],
  };
  const perPackageVulnerabilityCount = new Map<string, number>();

  let auditData: any;
  try {
    auditData = JSON.parse(stdout);
  } catch (err) {
    return { parsed: false, parseError: `invalid JSON — ${errorText(err)}` };
  }

  // A payload that parses but carries neither shape is not an empty audit: pnpm
  // reports its own errors as JSON too, and reading that as zero vulnerabilities
  // is the fail-open case this whole path exists to prevent.
  if (!isRecord(auditData.metadata?.vulnerabilities) && !isRecord(auditData.vulnerabilities)) {
    return {
      parsed: false,
      parseError: "no `metadata.vulnerabilities` or `vulnerabilities` in the payload",
    };
  }

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

  return { parsed: true, value: { vulnerabilities, perPackageVulnerabilityCount } };
}

/**
 * Parse pnpm outdated JSON output and categorize by update type.
 *
 * `{}` is a legitimate empty report — every dependency is current — and comes
 * back as `parsed: true` with empty lists. Output that is not a JSON object at
 * all comes back as `parsed: false`, because empty lists derived from garbage
 * would read as "nothing outdated".
 */
function parsePnpmOutdatedOutput(stdout: string): AuditParse<{
  outdated: {
    major: string[];
    minor: string[];
    patch: string[];
  };
  perPackageOutdatedCount: Map<string, number>;
}> {
  const outdated = {
    major: [] as string[],
    minor: [] as string[],
    patch: [] as string[],
  };
  const perPackageOutdatedCount = new Map<string, number>();

  let outdatedData: Record<string, unknown>;
  try {
    outdatedData = JSON.parse(stdout);
  } catch (err) {
    return { parsed: false, parseError: `invalid JSON — ${errorText(err)}` };
  }

  if (!isRecord(outdatedData)) {
    return { parsed: false, parseError: "payload is not a JSON object" };
  }

  for (const pkgName of Object.keys(outdatedData)) {
    const pkg = outdatedData[pkgName] as { current?: string; latest?: string };
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

  return { parsed: true, value: { outdated, perPackageOutdatedCount } };
}

/** Message text of an unknown throw, without assuming it is an Error. */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Last line of stderr, capped, as a dash-prefixed suffix. Empty when stderr is.
 *
 * pnpm puts the reason a command refused to run here (`ERR_PNPM_NO_LOCKFILE`),
 * and it is the only part of the failure an operator can act on.
 */
function stderrHint(stderr: string): string {
  const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
  const last = lines[lines.length - 1];
  return last ? ` — ${last.slice(0, 200)}` : "";
}

/**
 * Run one audit step and classify what came back.
 *
 * Every way a step can fail to produce counts is reported as `ran: false` with a
 * reason, because every one of them leaves the counts at zero — and a zero that
 * came from "could not look" must never be readable as "nothing to find". That
 * was the defect: a command that could not be spawned returns exitCode 1 with
 * empty stdout, the parse was skipped, and the all-zero initializer was returned
 * as a clean audit.
 *
 * `value` is present exactly when `record.ran` is true AND the step reported
 * something to parse. A launched, zero-exit step with no output at all is `ran:
 * true` with no `value`: `pnpm outdated --json` prints nothing when every
 * dependency is current, so that case is a real empty report, and the caller's
 * zero-initialized counts are the correct answer for it.
 */
async function runAuditStep<T>(
  command: string,
  exec: () => Promise<ExecResult>,
  parse: (stdout: string) => AuditParse<T>,
  timeout: number,
): Promise<{ record: DependencyAuditCommandRecord; value?: T }> {
  let result: ExecResult;
  try {
    result = await exec();
  } catch (err) {
    // execShellCmd is documented not to throw. The previous `catch {}` here
    // trusted that AND discarded the error, so a broken contract would have
    // surfaced as a clean audit rather than as a bug.
    return {
      record: {
        command,
        exitCode: null,
        ran: false,
        error: `\`${command}\` threw instead of returning a result: ${errorText(err)}`,
      },
    };
  }

  if (!result.launched) {
    return {
      record: {
        command,
        exitCode: null,
        ran: false,
        error: `\`${command}\` could not be launched (${result.error?.message ?? "spawn failed"})`,
      },
    };
  }

  if (result.exitCode === null) {
    return {
      record: {
        command,
        exitCode: null,
        ran: false,
        error: `\`${command}\` did not finish — killed after ${timeout}ms`,
      },
    };
  }

  if (!result.stdout.trim()) {
    // Exit 0 with no output is an empty report (see the docblock). A NON-ZERO
    // exit with no output is the tool erroring out — a missing lockfile, an
    // unreachable registry — and its silence is not a clean bill of health.
    if (result.exitCode === 0) {
      return { record: { command, exitCode: 0, ran: true } };
    }
    return {
      record: {
        command,
        exitCode: result.exitCode,
        ran: false,
        error: `\`${command}\` exited ${result.exitCode} with no output${stderrHint(result.stderr)}`,
      },
    };
  }

  const parsed = parse(result.stdout);
  if (!parsed.parsed) {
    return {
      record: {
        command,
        exitCode: result.exitCode,
        ran: false,
        error: `\`${command}\` output could not be parsed (${parsed.parseError})`,
      },
    };
  }

  return { record: { command, exitCode: result.exitCode, ran: true }, value: parsed.value };
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
 *
 * An audit that could not run reports `ran: false` with a reason; one where only
 * one of the two steps reported is `ran: true` WITH a reason — see
 * {@link DependencyAuditResult} for the full contract and for the recorded
 * decision on what a caller should do about it (warn and proceed).
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

  const metricsFor = (pkgName: string): DependencyAuditPackageResult => {
    let metrics = perPackageMetrics.get(pkgName);
    if (!metrics) {
      metrics = { name: pkgName, vulnerabilityCount: 0, outdatedCount: 0 };
      perPackageMetrics.set(pkgName, metrics);
    }
    return metrics;
  };

  const execOptions = { cwd: projectDir, timeout, maxBuffer: 10 * 1024 * 1024 };

  // Step 1: Run pnpm audit
  const auditCommand = "pnpm audit --json";
  const auditStep = await runAuditStep(
    auditCommand,
    () => execShellCmd(auditCommand, execOptions),
    parsePnpmAuditOutput,
    timeout,
  );
  if (auditStep.value) {
    vulnerabilities = auditStep.value.vulnerabilities;
    for (const [pkgName, count] of auditStep.value.perPackageVulnerabilityCount) {
      metricsFor(pkgName).vulnerabilityCount = count;
    }
  }

  // Step 2: Run pnpm outdated
  const outdatedCommand = "pnpm outdated --json";
  const outdatedStep = await runAuditStep(
    outdatedCommand,
    () => execShellCmd(outdatedCommand, execOptions),
    parsePnpmOutdatedOutput,
    timeout,
  );
  if (outdatedStep.value) {
    outdated = outdatedStep.value.outdated;
    for (const [pkgName, count] of outdatedStep.value.perPackageOutdatedCount) {
      metricsFor(pkgName).outdatedCount = count;
    }
  }

  const finishedAt = new Date().toISOString();
  const totalDurationMs = Date.now() - startMs;

  // No aggregate "hasIssues" verdict is computed here, and the one that used to
  // be was this defect in miniature: it OR'd `critical > 0 || high > 0 ||
  // outdated.major.length > 0` over counts that a step which never launched had
  // left at zero, so an audit that could not run computed "no issues". It was
  // dead besides — nothing read it. Callers derive their own counts (see
  // cli/commands/run.ts) and MUST check `ran` and `error` first: a zero from a
  // step with `ran: false` is a missing measurement, not a missing finding.
  const failures = [auditStep.record, outdatedStep.record].filter((r) => !r.ran);
  const ran = auditStep.record.ran || outdatedStep.record.ran;
  const reasons = failures.map((r) => r.error).join("; ");

  return {
    ran,
    skipped: false,
    startedAt,
    finishedAt,
    totalDurationMs,
    vulnerabilities,
    outdated,
    perPackage: Array.from(perPackageMetrics.values()),
    commands: { audit: auditStep.record, outdated: outdatedStep.record },
    ...(failures.length === 0
      ? {}
      : {
          error: ran
            ? `Dependency audit is partial — ${reasons}`
            : `Dependency audit could not be executed — ${reasons}`,
        }),
  };
}
