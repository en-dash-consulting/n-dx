/**
 * hench-tooling — Tool definitions, dispatch, and implementations.
 *
 * This module owns everything related to the tools the agent can invoke:
 * - Tool schema definitions (TOOL_DEFINITIONS)
 * - Central dispatch router (dispatchTool)
 * - Individual tool implementations (files, shell, git, test-runner)
 *
 * The agent core (run loop, brief assembly, prompts) imports from this
 * module but never the reverse — tools do not depend on the agent loop.
 */

// Dispatch layer — tool definitions and routing
export { TOOL_DEFINITIONS, TOOL_DEFINITIONS_NEUTRAL, dispatchTool } from "./dispatch.js";

// Tool implementations
export {
  toolReadFile,
  toolWriteFile,
  toolListDirectory,
  toolSearchFiles,
} from "./files.js";
export { toolRunCommand } from "./shell.js";
export { toolGit } from "./git.js";
export {
  runPostTaskTests,
  runTestGate,
  runDependencyAudit,
  findRelevantTests,
  isTestFile,
  candidateTestPaths,
  detectRunner,
  buildScopedCommand,
} from "./test-runner.js";
export type { PostRunTestResult, TestRunnerOptions, TestGateOptions, DependencyAuditOptions } from "./test-runner.js";
// DependencyAuditResult is a schema type — import from schema/index.js instead
export {
  runCleanupTransformations,
  formatCleanupResults,
  isTestFilePath,
  assertNotTestFile,
  TestFileGuardError,
} from "./cleanup-transformations.js";
export type {
  CleanupTransformation,
  CleanupBatch,
  CleanupResult,
  CleanupOptions,
  AnalyzerOutput,
  DeadExport,
  UnusedImport,
  DuplicateUtility,
} from "./cleanup-transformations.js";
export {
  analyzeDeadCode,
  toAnalyzerOutput,
  formatDeadCodeResults,
} from "./dead-code-analyzer.js";
export type {
  DeadCodeAnalyzerOptions,
  DeadCodeAnalysisResult,
  CleanupCandidate,
  DeadExportCandidate,
  UnusedImportCandidate,
  DuplicateUtilityCandidate,
  ConfidenceLevel,
} from "./dead-code-analyzer.js";
