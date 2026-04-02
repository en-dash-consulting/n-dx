/**
 * Legacy event accumulation functions — mutation-based CLI event parsers.
 *
 * These functions parse vendor CLI output lines and **mutate** a shared
 * `CliRunResult` object in place. They are the original parsing
 * implementation from `cli-loop.ts`, preserved here for backward
 * compatibility with existing tests.
 *
 * ## Deprecation notice
 *
 * Production code now uses the adapter-based dispatch path:
 *   `adapter.parseEvent(line) → RuntimeEvent → applyRuntimeEvent()`
 *
 * The mutation-based functions here remain only because several test suites
 * import them to verify the legacy parsing contract. New tests should use
 * the adapter API (`claudeCliAdapter.parseEvent`, `codexCliAdapter.parseEvent`)
 * and the `applyRuntimeEvent` bridge in `cli-loop.ts`.
 *
 * @deprecated Use VendorAdapter.parseEvent() + applyRuntimeEvent() instead.
 * @see packages/hench/src/agent/lifecycle/adapters/ — adapter implementations
 * @see packages/hench/src/agent/lifecycle/cli-loop.ts — generic spawn function
 */

import type { ToolCallRecord, TurnTokenUsage } from "../../schema/index.js";
import { parseTokenUsageWithDiagnostic, parseStreamTokenUsage } from "./token-usage.js";
import { stream, info } from "../../types/output.js";
import type { LLMVendor } from "../../prd/llm-gateway.js";
import { parseMaybeJson } from "./adapters/codex-cli-adapter.js";

// ── Shared types ──────────────────────────────────────────────────────────

const MAX_SUMMARY_LENGTH = 500;

/** @internal Exported for testing. */
export interface CliRunResult {
  turns: number;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number };
  turnTokenUsage: TurnTokenUsage[];
  summary?: string;
  error?: string;
  costUsd?: number;
}

export interface TokenEventMetadata {
  vendor: LLMVendor;
  model: string;
}

// ── Claude stream-json parser (mutation-based) ────────────────────────────

/**
 * Parse a single line of Claude `--output-format stream-json` output
 * and accumulate the result into a mutable `CliRunResult`.
 *
 * @deprecated Use `claudeCliAdapter.parseEvent()` + `applyRuntimeEvent()` instead.
 * @internal Exported for testing.
 */
export function processStreamLine(
  line: string,
  result: CliRunResult,
  turnCounter: { value: number },
  tokenMetadata?: TokenEventMetadata,
): void {
  if (!line.trim()) return;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    // Not JSON — print raw output for visibility
    info(line);
    return;
  }

  const type = event.type as string | undefined;

  switch (type) {
    case "assistant": {
      turnCounter.value++;

      // Extract text from message — may be a string, object with content blocks, or absent
      const message = event.message;
      if (typeof message === "string") {
        stream("Agent", message);
        result.summary = message.slice(0, MAX_SUMMARY_LENGTH);
      } else if (message && typeof message === "object") {
        const msg = message as Record<string, unknown>;
        const blocks = msg.content as Array<{ type: string; text?: string }> | undefined;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (block.type === "text" && block.text) {
              stream("Agent", block.text);
              result.summary = block.text.slice(0, MAX_SUMMARY_LENGTH);
            } else if (block.type === "tool_use") {
              const b = block as { name?: string; input?: Record<string, unknown> };
              const toolName = b.name || "unknown";
              const toolInput = b.input || {};
              stream("Tool", `${toolName}(${JSON.stringify(toolInput).slice(0, 100)})`);
              result.toolCalls.push({
                turn: turnCounter.value,
                tool: toolName,
                input: toolInput,
                output: "",
                durationMs: 0,
              });
            }
          }
        }

        // Extract per-turn token usage from message.usage
        if (msg.usage && typeof msg.usage === "object") {
          const { usage: parsed, diagnosticStatus } = parseTokenUsageWithDiagnostic(msg.usage as Record<string, unknown>);

          result.tokenUsage.input += parsed.input;
          result.tokenUsage.output += parsed.output;

          const turnUsage: TurnTokenUsage = {
            turn: turnCounter.value,
            input: parsed.input,
            output: parsed.output,
            diagnosticStatus,
            ...(tokenMetadata ? { vendor: tokenMetadata.vendor, model: tokenMetadata.model } : {}),
          };

          if (parsed.cacheCreationInput) {
            result.tokenUsage.cacheCreationInput = (result.tokenUsage.cacheCreationInput ?? 0) + parsed.cacheCreationInput;
            turnUsage.cacheCreationInput = parsed.cacheCreationInput;
          }
          if (parsed.cacheReadInput) {
            result.tokenUsage.cacheReadInput = (result.tokenUsage.cacheReadInput ?? 0) + parsed.cacheReadInput;
            turnUsage.cacheReadInput = parsed.cacheReadInput;
          }

          result.turnTokenUsage.push(turnUsage);
        }
      }

      // Also check top-level content (some event shapes put it here)
      const content = event.content as Array<{ type: string; text?: string }> | undefined;
      if (Array.isArray(content) && !event.message) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            stream("Agent", block.text);
            result.summary = block.text.slice(0, MAX_SUMMARY_LENGTH);
          } else if (block.type === "tool_use") {
            const b = block as { name?: string; input?: Record<string, unknown> };
            const toolName = b.name || "unknown";
            const toolInput = b.input || {};
            stream("Tool", `${toolName}(${JSON.stringify(toolInput).slice(0, 100)})`);
            result.toolCalls.push({
              turn: turnCounter.value,
              tool: toolName,
              input: toolInput,
              output: "",
              durationMs: 0,
            });
          }
        }
      }
      break;
    }

    case "tool_use": {
      const toolName = (event.tool as string) || (event.name as string) || "unknown";
      const toolInput = (event.input as Record<string, unknown>) || {};
      stream("Tool", `${toolName}(${JSON.stringify(toolInput).slice(0, 100)})`);
      result.toolCalls.push({
        turn: turnCounter.value,
        tool: toolName,
        input: toolInput,
        output: "",
        durationMs: 0,
      });
      break;
    }

    case "tool_result": {
      const output = (event.output as string) || (event.content as string) || "";
      // Attach output to the last tool call if available
      if (result.toolCalls.length > 0) {
        result.toolCalls[result.toolCalls.length - 1].output = output.slice(0, 2000);
      }
      const preview = output.slice(0, 200);
      stream("Result", `${preview}${output.length > 200 ? "..." : ""}`);
      break;
    }

    case "result": {
      if (event.is_error) {
        result.error = (event.result as string) || "Unknown error";
      } else if (event.result) {
        result.summary = (event.result as string).slice(0, MAX_SUMMARY_LENGTH);
      }
      if (typeof event.num_turns === "number") {
        result.turns = event.num_turns;
      }
      if (typeof event.cost_usd === "number") {
        result.costUsd = event.cost_usd;
      }
      // Extract total token usage from result event (fallback if per-turn not available)
      if (result.tokenUsage.input === 0 && result.tokenUsage.output === 0) {
        const fallback = parseStreamTokenUsage(event);
        if (fallback) {
          result.tokenUsage.input = fallback.input;
          result.tokenUsage.output = fallback.output;
        }
      }
      break;
    }

    default:
      // Unknown event type — ignore silently
      break;
  }
}

// ── Codex structured JSONL event parser (mutation-based) ──────────────────

/**
 * Parse a single JSONL line from `codex exec --json` structured output
 * and accumulate the result into a mutable `CliRunResult`.
 *
 * Returns `true` if the line was recognized as a structured event,
 * `false` otherwise (caller should fall back to heuristic handling).
 *
 * @deprecated Use `codexCliAdapter.parseEvent()` + `applyRuntimeEvent()` instead.
 * @internal Exported for testing.
 */
export function processCodexJsonLine(
  line: string,
  result: CliRunResult,
  turnCounter: { value: number },
  tokenMetadata?: TokenEventMetadata,
): boolean {
  if (!line.trim()) return false;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return false;
  }

  const type = event.type as string | undefined;
  if (!type) return false;

  switch (type) {
    case "message": {
      turnCounter.value++;

      // Extract text from content blocks (array of { type, text } objects)
      const content = event.content as Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown>; arguments?: string }> | undefined;
      if (Array.isArray(content)) {
        for (const block of content) {
          if ((block.type === "text" || block.type === "output_text") && block.text) {
            stream("Agent", block.text);
            result.summary = block.text.slice(0, MAX_SUMMARY_LENGTH);
          } else if (block.type === "tool_use" || block.type === "function_call") {
            const toolName = block.name || "unknown";
            const rawInput = block.input ?? parseMaybeJson(block.arguments);
            const toolInput = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
              ? rawInput as Record<string, unknown>
              : {};
            stream("Tool", `${toolName}(${JSON.stringify(toolInput).slice(0, 100)})`);
            result.toolCalls.push({
              turn: turnCounter.value,
              tool: toolName,
              input: toolInput,
              output: "",
              durationMs: 0,
            });
          }
        }
      }

      // Direct text on the event (some Codex output shapes)
      if (typeof event.text === "string" && !content) {
        stream("Agent", event.text);
        result.summary = event.text.slice(0, MAX_SUMMARY_LENGTH);
      }

      // Token usage embedded in the message event
      if (event.usage && typeof event.usage === "object") {
        const { usage: parsed, diagnosticStatus } = parseTokenUsageWithDiagnostic(event.usage as Record<string, unknown>);
        result.tokenUsage.input += parsed.input;
        result.tokenUsage.output += parsed.output;

        const turnUsage: TurnTokenUsage = {
          turn: turnCounter.value,
          input: parsed.input,
          output: parsed.output,
          diagnosticStatus,
          ...(tokenMetadata ? { vendor: tokenMetadata.vendor, model: tokenMetadata.model } : {}),
        };
        result.turnTokenUsage.push(turnUsage);
      }

      return true;
    }

    case "function_call": {
      const toolName = (event.name as string) || "unknown";
      const rawArgs = parseMaybeJson(event.arguments);
      const toolInput = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? rawArgs as Record<string, unknown>
        : {};
      stream("Tool", `${toolName}(${JSON.stringify(toolInput).slice(0, 100)})`);
      result.toolCalls.push({
        turn: turnCounter.value || 1,
        tool: toolName,
        input: toolInput,
        output: "",
        durationMs: 0,
      });
      return true;
    }

    case "function_call_output": {
      const output = (event.output as string) || (event.content as string) || "";
      // Attach output to the last tool call if available
      if (result.toolCalls.length > 0) {
        result.toolCalls[result.toolCalls.length - 1].output = output.slice(0, 2000);
      }
      const preview = output.slice(0, 200);
      stream("Result", `${preview}${output.length > 200 ? "..." : ""}`);
      return true;
    }

    case "error": {
      result.error = (event.message as string) || (event.error as string) || "Unknown error";
      return true;
    }

    case "summary":
    case "response.completed":
    case "done":
    case "complete": {
      // Extract summary text
      if (typeof event.result === "string") {
        result.summary = event.result.slice(0, MAX_SUMMARY_LENGTH);
      } else if (typeof event.text === "string") {
        result.summary = event.text.slice(0, MAX_SUMMARY_LENGTH);
      }

      // Turn count from completion event
      if (typeof event.num_turns === "number") {
        result.turns = event.num_turns;
      }

      // Cost from completion event
      if (typeof event.cost_usd === "number") {
        result.costUsd = event.cost_usd;
      }

      // Error in completion
      if (event.is_error === true) {
        result.error = (event.result as string) || "Unknown error";
      }

      // Token usage from completion event (fallback if per-turn not available)
      if (event.usage && typeof event.usage === "object") {
        const fallback = parseStreamTokenUsage(event);
        if (fallback && result.tokenUsage.input === 0 && result.tokenUsage.output === 0) {
          result.tokenUsage.input = fallback.input;
          result.tokenUsage.output = fallback.output;
        }
      }

      return true;
    }

    default:
      return false;
  }
}
