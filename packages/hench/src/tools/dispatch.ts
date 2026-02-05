import type Anthropic from "@anthropic-ai/sdk";
import { GuardError } from "../guard/index.js";
import { toolReadFile, toolWriteFile, toolListDirectory, toolSearchFiles } from "./files.js";
import { toolRunCommand } from "./shell.js";
import { toolGit } from "./git.js";
import { toolRexUpdateStatus, toolRexAppendLog, toolRexAddSubtask } from "./rex.js";
import type { ToolContext } from "../types/index.js";

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

export async function dispatchTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
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
          ctx.projectDir,
          input as { subcommand: string; args?: string },
        );

      case "rex_update_status":
        return await toolRexUpdateStatus(
          ctx.store,
          ctx.taskId,
          input as { status: string },
          { projectDir: ctx.projectDir, testCommand: ctx.testCommand, startingHead: ctx.startingHead },
        );

      case "rex_append_log":
        return await toolRexAppendLog(
          ctx.store,
          ctx.taskId,
          input as { event: string; detail?: string },
        );

      case "rex_add_subtask":
        return await toolRexAddSubtask(
          ctx.store,
          ctx.taskId,
          input as { title: string; description?: string; priority?: string },
        );

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    if (err instanceof GuardError) {
      return `[GUARD] ${err.message}`;
    }
    return `[ERROR] ${(err as Error).message}`;
  }
}
