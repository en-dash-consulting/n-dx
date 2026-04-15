/**
 * Claude CLI adapter — VendorAdapter implementation for the Claude CLI.
 *
 * Encapsulates all Claude CLI-specific logic:
 * - `buildSpawnConfig()` — compiles a PromptEnvelope + ExecutionPolicy into
 *   the `claude` binary's CLI args, environment, and stdin content.
 * - `parseEvent()` — parses a single line from Claude's `--output-format stream-json`
 *   output into a normalized RuntimeEvent.
 * - `classifyError()` — delegates to the shared `classifyVendorError` taxonomy.
 *
 * ## Extraction provenance
 *
 * The three core functions were extracted from `cli-loop.ts`:
 * - `buildSpawnConfig` ← `buildClaudeCliArgs` + `spawnClaude` spawn config
 * - `parseEvent` ← `processStreamLine` (adapted from CliRunResult mutation to RuntimeEvent return)
 * - `classifyError` ← direct delegation to `classifyVendorError`
 *
 * The original functions remain in `cli-loop.ts` as thin wrappers for
 * backward compatibility until the "Refactor cli-loop.ts to use adapter-based
 * dispatch" task replaces them.
 *
 * @see packages/hench/src/agent/lifecycle/vendor-adapter.ts — VendorAdapter interface
 * @see packages/llm-client/src/runtime-contract.ts — RuntimeEvent, FailureCategory
 * @see docs/architecture/phase2-vendor-normalization.md — design rationale
 */

import type { VendorAdapter, SpawnConfig } from "../vendor-adapter.js";
import type {
  PromptEnvelope,
  ExecutionPolicy,
  RuntimeEvent,
  RuntimeEventType,
  FailureCategory,
  LLMVendor,
} from "../../../prd/llm-gateway.js";
import {
  assemblePrompt,
  classifyVendorError,
} from "../../../prd/llm-gateway.js";

// ── Constants ────────────────────────────────────────────────────────────

/** File tools that Claude CLI should auto-approve (scoped to cwd). */
const CLI_FILE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"];

const MAX_SUMMARY_LENGTH = 500;

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build the `--allowed-tools` list for the Claude CLI.
 *
 * Maps the policy's `allowedCommands` (e.g. `["npm", "git"]`) to Claude CLI's
 * tool pattern format (e.g. `["Bash(npm:*)", "Bash(git:*)"]`), and includes
 * file tools that are inherently scoped to `cwd` by Claude CLI.
 */
export function buildAllowedTools(allowedCommands: ReadonlyArray<string>): string[] {
  const bashTools = allowedCommands.map((cmd) => `Bash(${cmd}:*)`);
  return [...bashTools, ...CLI_FILE_TOOLS];
}

/**
 * Build the Claude CLI args and stdin content from envelope + policy.
 *
 * Handles Windows cmd.exe escaping quirks. Extracted from cli-loop.ts's
 * `buildClaudeCliArgs` with identical output.
 *
 * @internal Exported for snapshot testing — not part of the adapter's public API.
 */
export interface ClaudeCliInput {
  systemPrompt: string;
  promptText: string;
  allowedTools: string[];
  modelOverride?: string;
}

export function buildClaudeCliArgs(input: ClaudeCliInput): { args: string[]; stdinContent: string } {
  const isWindows = process.platform === "win32";

  // On Windows, cmd.exe can't handle multi-line strings or special chars
  // like ( ) & | in CLI args. Embed system prompt in stdin instead.
  const stdinContent = isWindows
    ? `${input.systemPrompt}\n\n---\n\n${input.promptText}`
    : input.promptText;

  const args = [
    "-p",  // print mode; prompt is read from stdin
    "--output-format", "stream-json",
    "--verbose",
    ...(isWindows ? [] : ["--system-prompt", input.systemPrompt]),
    "--allowed-tools",
    // On Windows: join as a single comma-separated arg wrapped in cmd.exe quotes.
    // Bash(cmd:*) patterns contain ( ) which are special to cmd.exe without quoting.
    ...(isWindows ? [`"${input.allowedTools.join(",")}"`] : input.allowedTools),
    ...(input.modelOverride ? ["--model", input.modelOverride] : []),
  ];

  return { args, stdinContent };
}

// ── parseStreamLine (RuntimeEvent adapter) ───────────────────────────────

/**
 * Parse a single line of Claude stream-json output into a RuntimeEvent.
 *
 * Adapted from `processStreamLine` in cli-loop.ts. The original mutates
 * a CliRunResult; this version returns a normalized RuntimeEvent or null.
 *
 * Lines that don't represent a meaningful event (empty, non-JSON, unknown
 * types) return `null`.
 */
function parseStreamLine(
  line: string,
  turn: number,
  metadata: Record<string, unknown>,
): RuntimeEvent | null {
  if (!line.trim()) return null;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    // Not JSON — no RuntimeEvent
    return null;
  }

  const type = event.type as string | undefined;
  const timestamp = new Date().toISOString();
  const vendor: LLMVendor = "claude";

  switch (type) {
    case "assistant": {
      // Extract text from message content blocks
      const message = event.message;
      let text: string | undefined;

      if (typeof message === "string") {
        text = message.slice(0, MAX_SUMMARY_LENGTH);
      } else if (message && typeof message === "object") {
        const msg = message as Record<string, unknown>;
        const blocks = msg.content as Array<{ type: string; text?: string }> | undefined;
        if (Array.isArray(blocks)) {
          const textBlock = blocks.find((b) => b.type === "text" && b.text);
          if (textBlock?.text) {
            text = textBlock.text;
          }
        }

        // Check for token usage
        if (msg.usage && typeof msg.usage === "object") {
          const usage = msg.usage as Record<string, unknown>;
          const input = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
          const output = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;

          // If we have token usage, emit it alongside the text
          if (input > 0 || output > 0) {
            // Return assistant event with token info in metadata
            // (The caller can emit a separate token_usage event if needed)
          }
        }
      }

      // Also check top-level content (some event shapes put it here)
      if (!text) {
        const content = event.content as Array<{ type: string; text?: string }> | undefined;
        if (Array.isArray(content) && !event.message) {
          const textBlock = content.find((b) => b.type === "text" && b.text);
          if (textBlock?.text) {
            text = textBlock.text;
          }
        }
      }

      // Check for tool_use blocks embedded in the assistant message
      const toolBlocks = extractToolUseBlocks(event);
      if (toolBlocks.length > 0) {
        // Return the first tool_use as a tool_use event
        // (Multi-tool-use is handled by the caller iterating)
        const firstTool = toolBlocks[0];
        return {
          type: "tool_use" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          text,
          toolCall: {
            tool: firstTool.name,
            input: firstTool.input,
          },
        };
      }

      if (text) {
        return {
          type: "assistant" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          text,
        };
      }

      // Assistant event with no extractable text (e.g. only usage)
      return null;
    }

    case "tool_use": {
      const toolName = (event.tool as string) || (event.name as string) || "unknown";
      const toolInput = (event.input as Record<string, unknown>) || {};
      return {
        type: "tool_use" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        toolCall: {
          tool: toolName,
          input: toolInput,
        },
      };
    }

    case "tool_result": {
      const output = (event.output as string) || (event.content as string) || "";
      return {
        type: "tool_result" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        toolResult: {
          tool: "unknown", // Claude stream doesn't include tool name in result events
          output: output.slice(0, 2000),
          durationMs: 0,
        },
      };
    }

    case "result": {
      if (event.is_error) {
        return {
          type: "failure" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          failure: {
            category: "unknown" as FailureCategory,
            message: (event.result as string) || "Unknown error",
          },
        };
      }

      return {
        type: "completion" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        completionSummary: event.result
          ? (event.result as string).slice(0, MAX_SUMMARY_LENGTH)
          : undefined,
      };
    }

    default:
      return null;
  }
}

/**
 * Extract tool_use blocks from an assistant event's content/message.
 */
function extractToolUseBlocks(
  event: Record<string, unknown>,
): Array<{ name: string; input: Record<string, unknown> }> {
  const results: Array<{ name: string; input: Record<string, unknown> }> = [];

  const message = event.message;
  if (message && typeof message === "object") {
    const msg = message as Record<string, unknown>;
    const blocks = msg.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        if (block.type === "tool_use") {
          results.push({
            name: (block.name as string) || "unknown",
            input: (block.input as Record<string, unknown>) || {},
          });
        }
      }
    }
  }

  // Also check top-level content
  const content = event.content as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(content) && !event.message) {
    for (const block of content) {
      if (block.type === "tool_use") {
        results.push({
          name: (block.name as string) || "unknown",
          input: (block.input as Record<string, unknown>) || {},
        });
      }
    }
  }

  return results;
}

// ── ClaudeCliAdapter ─────────────────────────────────────────────────────

/**
 * VendorAdapter implementation for the Claude CLI.
 *
 * Stateless — all method inputs are passed as parameters.
 * Thread-safe — no mutable state.
 */
export const claudeCliAdapter: VendorAdapter = {
  vendor: "claude" as LLMVendor,
  parseMode: "stream-json",

  buildSpawnConfig(
    envelope: PromptEnvelope,
    policy: ExecutionPolicy,
    model: string | undefined,
  ): SpawnConfig {
    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);
    const allowedTools = buildAllowedTools(policy.allowedCommands);

    const { args, stdinContent } = buildClaudeCliArgs({
      systemPrompt,
      promptText: taskPrompt,
      allowedTools,
      modelOverride: model,
    });

    return {
      binary: "claude",
      args,
      env: {},
      stdinContent,
      cwd: ".",
    };
  },

  parseEvent(
    line: string,
    turn: number,
    metadata: Record<string, unknown>,
  ): RuntimeEvent | null {
    return parseStreamLine(line, turn, metadata);
  },

  classifyError(err: unknown): FailureCategory {
    return classifyVendorError(err);
  },
};
