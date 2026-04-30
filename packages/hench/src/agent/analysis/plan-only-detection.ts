/**
 * Plan-only completion detection.
 *
 * Detects when the agent has produced a plan/intent message but no code-modifying
 * tool calls. This prevents runs from completing with intent-only outputs.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolCallRecord } from "../../schema/index.js";

/**
 * Tool calls that directly modify the codebase or task state.
 * If none of these are present in a turn, it's a plan-only iteration.
 */
const CODE_MODIFYING_TOOLS = new Set([
  "write_file",        // Direct file modification
  "git",               // Commit, stage changes
  "run_command",       // May run build/test/script that modifies state
  "rex_update_status", // Task status changes (completion claim)
]);

export interface PlanOnlyDetectionResult {
  /** True if this iteration is plan-only (no code-modifying tool calls). */
  isPlanOnly: boolean;
  /** Tool calls that were made. */
  toolCalls: string[];
  /** Which of the calls are code-modifying. */
  codeModifyingCalls: string[];
}

/**
 * Classify an iteration based on its tool calls.
 *
 * Returns true if the assistant produced only text/intent without
 * code-modifying tool calls.
 */
export function detectPlanOnlyIteration(
  assistantContent: Anthropic.ContentBlock[],
): PlanOnlyDetectionResult {
  const toolCalls: string[] = [];
  const codeModifyingCalls: string[] = [];

  for (const block of assistantContent) {
    if (block.type === "tool_use") {
      const toolName = block.name;
      toolCalls.push(toolName);
      if (CODE_MODIFYING_TOOLS.has(toolName)) {
        codeModifyingCalls.push(toolName);
      }
    }
  }

  return {
    isPlanOnly: codeModifyingCalls.length === 0,
    toolCalls,
    codeModifyingCalls,
  };
}

/**
 * Check if tool calls recorded in the run (from previous turns) include
 * code-modifying operations. Used when checking if the entire run made changes.
 */
export function runHasCodeModifications(toolCalls: ToolCallRecord[]): boolean {
  return toolCalls.some((call) => CODE_MODIFYING_TOOLS.has(call.tool));
}

/**
 * Create a re-prompt message to force execution of a previously-stated plan.
 */
export function createExecutionReminder(
  planSummary?: string,
  attempt?: number,
): string {
  const attemptText = attempt && attempt > 1 ? ` (attempt ${attempt})` : "";

  let reminder = `You provided a plan${attemptText}, but did not execute it. `;
  if (planSummary) {
    reminder += `Your plan was: "${planSummary.slice(0, 200)}..."\n\n`;
  }

  return (
    reminder +
    "Please now EXECUTE the plan. Use write_file, git, or run_command to make the actual changes. " +
    "Do not just repeat the plan — take concrete action."
  );
}
