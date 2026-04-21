/**
 * Verify — maps PRD acceptance criteria to test files and runs them.
 *
 * Strategy:
 * 1. Collect tasks with acceptance criteria (optionally filtered by ID).
 * 2. For each criterion, extract keywords and search for matching test files.
 * 3. Run the project test command scoped to discovered test files.
 * 4. Report results per-task, per-criterion.
 */

import { readdir, stat } from "node:fs/promises";
import { join, basename, extname, relative } from "node:path";
import { PROJECT_DIRS, exec as foundationExec } from "@n-dx/llm-client";
import type { ExecResult } from "@n-dx/llm-client";
import { walkTree } from "./tree.js";
import { extractKeywords, scoreMatch, STOP_WORDS } from "./keywords.js";
import type { PRDItem } from "../schema/index.js";

// Re-export for backward compatibility
export { extractKeywords, scoreMatch };

// Re-export schema type used in this module's public API so consumers can
// import it from a single location without reaching into schema directly.
export type { PRDItem };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CriterionResult {
  /** The acceptance criterion text. */
  criterion: string;
  /** Test files that matched this criterion. */
  testFiles: string[];
  /** Whether the criterion has test coverage (at least one test file found). */
  covered: boolean;
}

export interface TaskVerification {
  /** Task ID. */
  id: string;
  /** Task title. */
  title: string;
  /** Task level. */
  level: string;
  /** Per-criterion results. */
  criteria: CriterionResult[];
  /** Total acceptance criteria count. */
  totalCriteria: number;
  /** How many criteria have test coverage. */
  coveredCriteria: number;
}

export interface TestRunResult {
  /** Whether tests were executed. */
  ran: boolean;
  /** Whether all tests passed. */
  passed: boolean;
  /** The command that was executed. */
  command?: string;
  /** Stdout/stderr output. */
  output?: string;
  /** Duration in ms. */
  durationMs?: number;
  /** Test files that were targeted. */
  testFiles: string[];
  /** Error message if tests couldn't run. */
  error?: string;
}

export interface VerifyResult {
  /** Per-task verification results. */
  tasks: TaskVerification[];
  /** Test execution result (if tests were run). */
  testRun?: TestRunResult;
  /** Summary stats. */
  summary: {
    totalTasks: number;
    totalCriteria: number;
    coveredCriteria: number;
    uncoveredCriteria: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 120_000;

/** Common test file patterns — matches *.test.ts, *.spec.js, *_test.ts, etc. */
const TEST_FILE_RE = /[._](test|spec)\.[jt]sx?$/;

// ---------------------------------------------------------------------------
// Test file discovery
// ---------------------------------------------------------------------------

/**
 * Recursively find all test files under a directory.
 * Skips node_modules, dist, .git, and hidden directories.
 */
export async function findTestFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const SKIP_DIRS = new Set(["node_modules", "dist", ".git", PROJECT_DIRS.HENCH, PROJECT_DIRS.REX, PROJECT_DIRS.SOURCEVISION, "coverage"]);

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
        results.push(relative(dir, fullPath).replace(/\\/g, "/"));
      }
    }
  }

  await walk(dir);
  return results.sort();
}

/**
 * Map acceptance criteria to test files using keyword matching.
 */
export function mapCriteriaToTests(
  criteria: string[],
  testFiles: string[],
  minScore = 1,
): CriterionResult[] {
  return criteria.map((criterion) => {
    const keywords = extractKeywords(criterion);
    if (keywords.length === 0) {
      return { criterion, testFiles: [], covered: false };
    }

    const matches: string[] = [];
    for (const file of testFiles) {
      if (scoreMatch(file, keywords) >= minScore) {
        matches.push(file);
      }
    }

    return {
      criterion,
      testFiles: matches,
      covered: matches.length > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Task collection
// ---------------------------------------------------------------------------

/**
 * Collect tasks that have acceptance criteria.
 * If taskId is provided, only return that task.
 */
export function collectVerifiableTasks(
  items: PRDItem[],
  taskId?: string,
): TaskVerification[] {
  const results: TaskVerification[] = [];

  for (const { item } of walkTree(items)) {
    if (taskId && item.id !== taskId) continue;
    if (!item.acceptanceCriteria || item.acceptanceCriteria.length === 0) continue;

    results.push({
      id: item.id,
      title: item.title,
      level: item.level,
      criteria: [],
      totalCriteria: item.acceptanceCriteria.length,
      coveredCriteria: 0,
    });

    if (taskId) break;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Shell execution (delegates to foundation layer)
// ---------------------------------------------------------------------------

function exec(
  cmd: string,
  args: string[],
  cwd: string,
  timeout: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return foundationExec(cmd, args, { cwd, timeout, maxBuffer: 2 * 1024 * 1024 });
}

// ---------------------------------------------------------------------------
// Main verify pipeline
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  /** Project root directory. */
  projectDir: string;
  /** PRD items tree. */
  items: PRDItem[];
  /** Optional task ID to verify a single task. */
  taskId?: string;
  /** Test command (e.g. "pnpm test"). */
  testCommand?: string;
  /** Timeout for test execution in ms. */
  timeout?: number;
  /** Whether to actually run tests (false = mapping only). */
  runTests?: boolean;
}

export async function verify(options: VerifyOptions): Promise<VerifyResult> {
  const {
    projectDir,
    items,
    taskId,
    testCommand,
    timeout = DEFAULT_TIMEOUT,
    runTests = true,
  } = options;

  // 1. Collect tasks with acceptance criteria
  const tasks = collectVerifiableTasks(items, taskId);

  if (tasks.length === 0) {
    return {
      tasks: [],
      summary: {
        totalTasks: 0,
        totalCriteria: 0,
        coveredCriteria: 0,
        uncoveredCriteria: 0,
      },
    };
  }

  // 2. Discover all test files in the project
  const testFiles = await findTestFiles(projectDir);

  // 3. Map criteria to test files for each task
  const allTestFiles = new Set<string>();

  for (const task of tasks) {
    // Find the original item to get criteria text
    const original = findItemById(items, task.id);
    if (!original?.acceptanceCriteria) continue;

    task.criteria = mapCriteriaToTests(original.acceptanceCriteria, testFiles);
    task.coveredCriteria = task.criteria.filter((c) => c.covered).length;

    for (const cr of task.criteria) {
      for (const tf of cr.testFiles) {
        allTestFiles.add(tf);
      }
    }
  }

  // 4. Compute summary
  const totalCriteria = tasks.reduce((sum, t) => sum + t.totalCriteria, 0);
  const coveredCriteria = tasks.reduce((sum, t) => sum + t.coveredCriteria, 0);
  const summary = {
    totalTasks: tasks.length,
    totalCriteria,
    coveredCriteria,
    uncoveredCriteria: totalCriteria - coveredCriteria,
  };

  // 5. Optionally run tests
  let testRun: TestRunResult | undefined;
  if (runTests && testCommand && allTestFiles.size > 0) {
    const files = [...allTestFiles];
    const command = `${testCommand} ${files.join(" ")}`;

    const startMs = Date.now();
    const { stdout, stderr, exitCode } = await exec(
      "sh", ["-c", command], projectDir, timeout,
    );
    const durationMs = Date.now() - startMs;

    const output = (stdout.trim() || stderr.trim()).slice(-2000);
    testRun = {
      ran: true,
      passed: exitCode === 0,
      command,
      output: output || undefined,
      durationMs,
      testFiles: files,
      error: exitCode === null ? "Test command timed out" : undefined,
    };
  } else if (runTests && testCommand && allTestFiles.size === 0) {
    testRun = {
      ran: false,
      passed: false,
      testFiles: [],
      error: "No test files matched any acceptance criteria",
    };
  } else if (runTests && !testCommand) {
    testRun = {
      ran: false,
      passed: false,
      testFiles: [],
      error: "No test command configured. Set 'test' in .rex/config.json.",
    };
  }

  return { tasks, testRun, summary };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findItemById(items: PRDItem[], id: string): PRDItem | undefined {
  for (const { item } of walkTree(items)) {
    if (item.id === id) return item;
  }
  return undefined;
}
