/**
 * Tool dispatch — boundary between the agent core and the guard/tools layer.
 *
 * This module sits at the interface of two architectural zones within the hench
 * package:
 *
 *   **agent-core (hench zone)** — agent lifecycle, schema, process execution
 *   **guard+tools (hench-2 zone)** — GuardRails, filesystem/shell/git tool impls
 *
 * The coupling between these zones is intentional and managed:
 *
 * - **Agent core → guard+tools**: `loop.ts` instantiates GuardRails from the
 *   guard module and creates a `ToolContext`; `tools/index.ts` re-exports the
 *   concrete tool functions for use outside this directory.
 * - **Guard+tools → agent core**: `tools/contracts.ts` exports `ToolGuard` (a
 *   minimal interface satisfied by GuardRails) and `ToolContext`, so tool
 *   implementations never import from agent-core directly.  `tools/git.ts` and
 *   `tools/shell.ts` call `process/exec-shell.ts` for subprocess execution.
 *
 * The `ToolGuard` interface in `./contracts.ts` is the explicit shared boundary
 * that decouples tool implementations from concrete GuardRails internals,
 * following the same gateway pattern used elsewhere in the monorepo.
 *
 * @module
 */

import type Anthropic from "@anthropic-ai/sdk";
import { toolReadFile, toolWriteFile, toolListDirectory, toolSearchFiles } from "./files.js";
import { toolRunCommand } from "./shell.js";
import { toolGit } from "./git.js";
import type {
  ToolContext,
  RexToolHandlers,
  RexUpdateStatusParams,
  RexAppendLogParams,
  RexAddSubtaskParams,
} from "./contracts.js";

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read the contents of a file at the given path.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path relative to project root" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file. Creates parent directories if needed.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories at the given path.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Directory path relative to project root" },
        recursive: { type: "boolean", description: "List recursively (default: false)" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description: "Search for a regex pattern across files in a directory.",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Directory path to search in" },
        glob: { type: "string", description: "Glob pattern to filter files (e.g. '*.ts')" },
      },
      required: ["pattern", "path"],
    },
  },
  {
    name: "run_command",
    description: "Run a shell command. Only allowlisted executables are permitted.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        cwd: { type: "string", description: "Working directory (default: project root)" },
        timeout: { type: "number", description: "Timeout in milliseconds" },
      },
      required: ["command"],
    },
  },
  {
    name: "git",
    description: "Run a git subcommand. Allowed: status, add, commit, diff, log, branch, checkout, stash, show, rev-parse.",
    input_schema: {
      type: "object" as const,
      properties: {
        subcommand: { type: "string", description: "Git subcommand to run" },
        args: { type: "string", description: "Additional arguments" },
      },
      required: ["subcommand"],
    },
  },
  {
    name: "rex_update_status",
    description: "Update the current task's status in Rex (pending, in_progress, completed, deferred).",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          description: "New status",
          enum: ["pending", "in_progress", "completed", "deferred"],
        },
        resolutionType: {
          type: "string",
          description: "How the task was resolved (required when status=completed)",
          enum: ["code-change", "config-override", "acknowledgment"],
        },
      },
      required: ["status"],
    },
  },
  {
    name: "rex_append_log",
    description: "Append an entry to the Rex execution log for the current task.",
    input_schema: {
      type: "object" as const,
      properties: {
        event: { type: "string", description: "Event type (e.g. 'implementation_started')" },
        detail: { type: "string", description: "Optional detail text" },
      },
      required: ["event"],
    },
  },
  {
    name: "rex_add_subtask",
    description: "Add a subtask under the current task in Rex.",
    input_schema: {
      type: "object" as const,
      properties: {
        title: { type: "string", description: "Subtask title" },
        description: { type: "string", description: "Subtask description" },
        priority: {
          type: "string",
          description: "Priority level",
          enum: ["critical", "high", "medium", "low"],
        },
      },
      required: ["title"],
    },
  },
];

/** Tools that spawn child processes and should be memory-checked. */
const PROCESS_SPAWNING_TOOLS = new Set(["run_command", "git"]);

/**
 * Check system memory before spawning a child process.
 * Returns an error message if memory is too high, or undefined if OK.
 */
async function checkSpawnMemory(
  ctx: ToolContext,
  toolName: string,
): Promise<string | undefined> {
  if (!ctx.memoryMonitor || !PROCESS_SPAWNING_TOOLS.has(toolName)) return undefined;

  const check = await ctx.memoryMonitor.checkBeforeSpawn();
  if (!check.allowed) {
    return `[MEMORY] ${check.reason}`;
  }
  return undefined;
}

export async function dispatchTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>,
  rexHandlers?: RexToolHandlers,
): Promise<string> {
  try {
    // Pre-spawn memory check for process-spawning tools
    const memoryBlock = await checkSpawnMemory(ctx, name);
    if (memoryBlock) return memoryBlock;

    switch (name) {
      case "read_file":
        return await toolReadFile(ctx.guard, input as { path: string });

      case "write_file":
        return await toolWriteFile(
          ctx.guard,
          input as { path: string; content: string },
        );

      case "list_directory":
        return await toolListDirectory(
          ctx.guard,
          input as { path: string; recursive?: boolean },
        );

      case "search_files":
        return await toolSearchFiles(
          ctx.guard,
          input as { pattern: string; path: string; glob?: string },
        );

      case "run_command":
        return await toolRunCommand(
          ctx.guard,
          ctx.projectDir,
          input as { command: string; cwd?: string; timeout?: number },
        );

      case "git":
        return await toolGit(
          ctx.guard,
          ctx.projectDir,
          input as { subcommand: string; args?: string },
        );

      case "rex_update_status":
        if (!rexHandlers) {
          return "[ERROR] rex_update_status unavailable: no Rex handlers configured";
        }
        return await rexHandlers.updateStatus(
          ctx,
          input as unknown as RexUpdateStatusParams,
        );

      case "rex_append_log":
        if (!rexHandlers) {
          return "[ERROR] rex_append_log unavailable: no Rex handlers configured";
        }
        return await rexHandlers.appendLog(
          ctx,
          input as unknown as RexAppendLogParams,
        );

      case "rex_add_subtask":
        if (!rexHandlers) {
          return "[ERROR] rex_add_subtask unavailable: no Rex handlers configured";
        }
        return await rexHandlers.addSubtask(
          ctx,
          input as unknown as RexAddSubtaskParams,
        );

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    if (err instanceof Error && err.name === "GuardError") {
      return `[GUARD] ${err.message}`;
    }
    return `[ERROR] ${(err as Error).message}`;
  }
}
