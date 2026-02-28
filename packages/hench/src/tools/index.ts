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
export { TOOL_DEFINITIONS, dispatchTool } from "./dispatch.js";

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
  findRelevantTests,
  isTestFile,
  candidateTestPaths,
  detectRunner,
  buildScopedCommand,
} from "./test-runner.js";
export type { PostRunTestResult, TestRunnerOptions } from "./test-runner.js";
