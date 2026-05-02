/**
 * Task completion criteria gate.
 *
 * Validates that code-classified tasks (those that invoke code-modifying tools)
 * have at least one staged or committed code file change before marking complete.
 * Tasks classified as docs-only (no code-modifying tool calls) are always allowed
 * to complete.
 *
 * This prevents false completions where the agent claims to have completed code
 * work but only produced documentation or configuration changes.
 *
 * @module hench/agent/lifecycle/task-completion-gate
 */

import type { RunRecord, ToolCallRecord } from "../../schema/index.js";
import { classifyChangedFiles, getCodeFiles } from "../../store/file-classifier.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Tools that directly modify the codebase or task state. */
const CODE_MODIFYING_TOOLS = new Set([
  "write_file",        // Direct file modification
  "git",               // Commit, stage changes
  "run_command",       // May run build/test/script that modifies state
  "rex_update_status", // Task status changes
]);

export interface TaskCompletionGateResult {
  /** Whether the task is allowed to transition to "completed". */
  valid: boolean;
  /** How the task is classified based on tool calls and changes. */
  taskClassification: "code" | "docs-only" | "unknown";
  /** Files that were classified as "code" by the gate. */
  codeFiles: string[];
  /** Rejection reason if valid is false. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Gate implementation
// ---------------------------------------------------------------------------

/**
 * Determine if the run made any code-modifying tool calls.
 *
 * Code-modifying tools are those that directly change the codebase or
 * task state, as opposed to planning-only tools like read_file or search.
 *
 * @param toolCalls All tool calls made during the run
 * @returns true if any code-modifying tools were called
 */
function runMadeCodeModifyingCalls(toolCalls: ToolCallRecord[]): boolean {
  return toolCalls.some((call) => CODE_MODIFYING_TOOLS.has(call.tool));
}

/**
 * Validate task completion based on file changes and tool calls.
 *
 * A task is "code-classified" if it invoked code-modifying tools. Such tasks
 * must have at least one code file change to be considered valid for completion.
 *
 * A task is "docs-only" if it did not invoke code-modifying tools. Such tasks
 * are always allowed to complete regardless of file changes.
 *
 * Validation result:
 * - `{ valid: true, ... }` — Task may complete
 * - `{ valid: false, reason: "..." }` — Task must not complete; includes error message
 *
 * @param run The completed run record
 * @returns Gate validation result
 */
export function validateTaskCompletion(run: RunRecord): TaskCompletionGateResult {
  // Check if run made any code-modifying tool calls
  const madeCodeCalls = runMadeCodeModifyingCalls(run.toolCalls);

  // If no code-modifying calls, task is docs-only — always allow completion
  if (!madeCodeCalls) {
    return {
      valid: true,
      taskClassification: "docs-only",
      codeFiles: [],
    };
  }

  // Task is code-classified (made code-modifying calls).
  // Extract and classify files from tool calls.
  const classified = classifyChangedFiles(run.toolCalls);
  const codeFiles = getCodeFiles(classified);

  // Require at least one code file for code-classified tasks
  if (codeFiles.length === 0) {
    return {
      valid: false,
      taskClassification: "code",
      codeFiles: [],
      reason:
        "Code-modifying tool calls were made (write_file, git, or run_command), " +
        "but zero code files were changed. Tasks that invoke code tools must produce " +
        "at least one staged or committed code file change. " +
        "To mark complete without code changes, ensure all changes are documentation " +
        "(*.md/*.txt) or configuration (*.json/*.yaml) only.",
    };
  }

  return {
    valid: true,
    taskClassification: "code",
    codeFiles,
  };
}
