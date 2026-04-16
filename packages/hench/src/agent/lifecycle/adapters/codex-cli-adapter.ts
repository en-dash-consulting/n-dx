/**
 * Codex CLI adapter — VendorAdapter implementation for the Codex CLI.
 *
 * Encapsulates all Codex CLI-specific logic:
 * - `buildSpawnConfig()` — compiles a PromptEnvelope + ExecutionPolicy into
 *   the `codex` binary's CLI args, environment, and stdin content.
 * - `parseEvent()` — parses a single JSONL line from Codex's `--json` output
 *   into a normalized RuntimeEvent, with heuristic fallback for unstructured output.
 * - `classifyError()` — delegates to the shared `classifyVendorError` taxonomy.
 *
 * ## Extraction provenance
 *
 * The core functions were extracted from `cli-loop.ts`:
 * - `buildSpawnConfig` ← `spawnCodex` spawn config + `compileCodexPolicyFlags`
 * - `parseEvent` ← `processCodexJsonLine` (adapted from CliRunResult mutation to RuntimeEvent return)
 * - Heuristic helpers ← `normalizeCodexResponse`, `parseMaybeJson`, `collectCodexBlocks`,
 *   `extractText`, `getBlockType` (used as fallback parse path)
 * - `classifyError` ← direct delegation to `classifyVendorError`
 *
 * The original functions remain in `cli-loop.ts` for backward compatibility until
 * the "Refactor cli-loop.ts to use adapter-based dispatch" task replaces them.
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
  compileCodexPolicyFlags,
  classifyVendorError,
} from "../../../prd/llm-gateway.js";

// ── Constants ────────────────────────────────────────────────────────────

const MAX_SUMMARY_LENGTH = 500;

// ── Heuristic helpers (for fallback parsing of unstructured output) ──────

/**
 * Safely parse a string that might be JSON. Returns the parsed value on
 * success or the original value on failure.
 */
/** @internal Exported for backward compat in event-accumulator.ts */
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (
    !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
    !(trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/**
 * Detect the type/kind of a Codex content block.
 * Codex uses several different field names for the block type.
 */
function getBlockType(block: Record<string, unknown>): string | undefined {
  const type = block.type ?? block.kind ?? block.event ?? block.block_type ?? block.role;
  return typeof type === "string" ? type : undefined;
}

/**
 * Collect content blocks from a Codex response payload.
 * Handles the many different shapes Codex responses can take.
 */
function collectCodexBlocks(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
  }
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const obj = payload as Record<string, unknown>;
  const candidates = [
    obj.content,
    obj.blocks,
    obj.events,
    obj.output,
    obj.items,
    obj.response,
    obj.data,
    obj.message && typeof obj.message === "object" ? (obj.message as Record<string, unknown>).content : undefined,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
    }
  }
  return [];
}

/**
 * Extract text content from a Codex block, checking multiple field names.
 */
function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const obj = value as Record<string, unknown>;
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.delta === "string") return obj.delta;
  if (typeof obj.output_text === "string") return obj.output_text;
  return "";
}

// ── Normalized Codex response types ──────────────────────────────────────

/** A single tool event extracted from a Codex response. */
export interface NormalizedCodexToolEvent {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  status?: string;
  eventType: string;
}

/** The result of normalizing an unstructured Codex response. */
export interface NormalizedCodexResponse {
  status: "completed" | "error" | "in_progress" | "unknown";
  assistantText: string;
  toolEvents: NormalizedCodexToolEvent[];
  warnings: string[];
  error?: string;
}

// ── normalizeCodexResponse ───────────────────────────────────────────────

/**
 * Heuristic parser for unstructured Codex output.
 *
 * Used as a fallback when Codex does not emit structured JSONL events
 * (e.g. older Codex versions that don't support `--json`). Attempts to
 * extract text, tool events, and status from a variety of response shapes.
 *
 * @internal Exported for testing.
 */
export function normalizeCodexResponse(raw: unknown): NormalizedCodexResponse {
  const warnings: string[] = [];
  const textParts: string[] = [];
  const toolEvents: NormalizedCodexToolEvent[] = [];

  const parsedRaw = parseMaybeJson(raw);
  const parsed = typeof parsedRaw === "string" ? parseMaybeJson(parsedRaw.trim()) : parsedRaw;

  if (typeof parsed === "string") {
    return {
      status: "completed",
      assistantText: parsed,
      toolEvents,
      warnings,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      status: "unknown",
      assistantText: "",
      toolEvents,
      warnings,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const topLevelText = [obj.text, obj.output_text, obj.result, obj.summary, obj.message]
    .map(extractText)
    .find((text) => text.trim().length > 0);
  if (topLevelText) {
    textParts.push(topLevelText);
  }

  const blocks = collectCodexBlocks(obj);
  for (const block of blocks) {
    const type = getBlockType(block);
    const normalizedType = type?.toLowerCase();

    if (!normalizedType) {
      warnings.push("Codex block missing type; ignoring block.");
      continue;
    }

    if (normalizedType === "text" || normalizedType === "output_text" || normalizedType === "assistant_text" || normalizedType === "text_delta") {
      const text = extractText(block);
      if (text) {
        textParts.push(text);
      }
      continue;
    }

    if (normalizedType === "tool_use" || normalizedType === "tool_call" || normalizedType === "function_call") {
      const toolName = typeof block.name === "string"
        ? block.name
        : typeof block.tool === "string"
          ? block.tool
          : "unknown";
      const inputCandidate = parseMaybeJson(block.input ?? block.arguments);
      toolEvents.push({
        tool: toolName,
        input: inputCandidate && typeof inputCandidate === "object"
          ? inputCandidate as Record<string, unknown>
          : { value: inputCandidate },
        status: typeof block.status === "string" ? block.status : "started",
        eventType: normalizedType,
      });
      continue;
    }

    if (normalizedType === "tool_result" || normalizedType === "function_result") {
      const outputText = extractText(block.output ?? block.content ?? block.result ?? block);
      const toolName = typeof block.name === "string"
        ? block.name
        : typeof block.tool === "string"
          ? block.tool
          : "unknown";
      toolEvents.push({
        tool: toolName,
        input: {},
        output: outputText,
        status: typeof block.status === "string" ? block.status : "completed",
        eventType: normalizedType,
      });
      continue;
    }

    if (
      normalizedType === "completion" ||
      normalizedType === "completed" ||
      normalizedType === "result" ||
      normalizedType === "final"
    ) {
      const text = extractText(block.result ?? block.message ?? block);
      if (text) {
        textParts.push(text);
      }
      continue;
    }

    warnings.push(`Unknown Codex block type "${type}" ignored.`);
  }

  let status: NormalizedCodexResponse["status"] = "unknown";
  if (obj.is_error === true || typeof obj.error === "string") {
    status = "error";
  } else if (typeof obj.status === "string") {
    const s = obj.status.toLowerCase();
    if (s.includes("error") || s.includes("failed")) status = "error";
    else if (s.includes("complete") || s === "ok") status = "completed";
    else if (s.includes("progress") || s.includes("running")) status = "in_progress";
  } else if (typeof obj.stop_reason === "string") {
    status = obj.stop_reason === "end_turn" ? "completed" : "in_progress";
  } else if (textParts.length > 0 || toolEvents.length > 0) {
    status = "completed";
  }

  const assistantText = textParts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n");

  const error = typeof obj.error === "string"
    ? obj.error
    : obj.is_error
      ? extractText(obj.result) || "Codex response indicated an error"
      : undefined;

  return {
    status,
    assistantText,
    toolEvents,
    warnings,
    error,
  };
}

// ── parseCodexJsonLine (RuntimeEvent adapter) ────────────────────────────

/**
 * Parse a single JSONL line from `codex exec --json` structured output
 * into a normalized RuntimeEvent.
 *
 * Adapted from `processCodexJsonLine` in cli-loop.ts. The original mutates
 * a CliRunResult and returns a boolean; this version returns a normalized
 * RuntimeEvent or null.
 *
 * Supported event types (Codex JSONL format):
 * - `message` — assistant text + optional content blocks
 * - `function_call` — tool invocation
 * - `function_call_output` — tool result
 * - `error` — execution error
 * - `summary` / `response.completed` / `done` / `complete` — completion
 *
 * Returns `null` for lines that don't represent a meaningful event
 * (empty lines, non-JSON, unknown types).
 */
function parseCodexJsonLine(
  line: string,
  turn: number,
  _metadata: Record<string, unknown>,
): RuntimeEvent | null {
  if (!line.trim()) return null;

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  const type = event.type as string | undefined;
  if (!type) return null;

  const timestamp = new Date().toISOString();
  const vendor: LLMVendor = "codex";

  switch (type) {
    case "item.started": {
      const item = event.item as Record<string, unknown> | undefined;
      if (!item) return null;

      const itemType = typeof item.type === "string" ? item.type : undefined;
      const timestamp = new Date().toISOString();

      if (itemType === "command_execution" && typeof item.command === "string") {
        return {
          type: "tool_use" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          toolCall: {
            tool: "shell",
            input: { command: item.command },
          },
        };
      }

      return null;
    }

    case "item.completed": {
      const item = event.item as Record<string, unknown> | undefined;
      if (!item) return null;

      const itemType = typeof item.type === "string" ? item.type : undefined;
      const timestamp = new Date().toISOString();

      if (itemType === "agent_message" && typeof item.text === "string") {
        return {
          type: "assistant" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          text: item.text.slice(0, MAX_SUMMARY_LENGTH),
        };
      }

      if (itemType === "command_execution") {
        const outputCandidate =
          (typeof item.output === "string" && item.output) ||
          (typeof item.stdout === "string" && item.stdout) ||
          (typeof item.result === "string" && item.result) ||
          (typeof item.text === "string" && item.text) ||
          "";

        return {
          type: "tool_result" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          toolResult: {
            tool: "shell",
            output: outputCandidate.slice(0, 2000),
            durationMs: 0,
          },
        };
      }

      return null;
    }

    case "message": {
      // Extract text from content blocks (array of { type, text } objects)
      const content = event.content as Array<{
        type: string;
        text?: string;
        name?: string;
        input?: Record<string, unknown>;
        arguments?: string;
      }> | undefined;

      let text: string | undefined;
      let firstToolCall: { tool: string; input: Record<string, unknown> } | undefined;

      if (Array.isArray(content)) {
        for (const block of content) {
          if ((block.type === "text" || block.type === "output_text") && block.text) {
            text = block.text.slice(0, MAX_SUMMARY_LENGTH);
          } else if (block.type === "tool_use" || block.type === "function_call") {
            if (!firstToolCall) {
              const toolName = block.name || "unknown";
              const rawInput = block.input ?? parseMaybeJson(block.arguments);
              const toolInput = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
                ? rawInput as Record<string, unknown>
                : {};
              firstToolCall = { tool: toolName, input: toolInput };
            }
          }
        }
      }

      // Direct text on the event (some Codex output shapes)
      if (typeof event.text === "string" && !content) {
        text = (event.text as string).slice(0, MAX_SUMMARY_LENGTH);
      }

      // If there's a tool call in the message, return it as a tool_use event
      if (firstToolCall) {
        return {
          type: "tool_use" as RuntimeEventType,
          vendor,
          turn,
          timestamp,
          text,
          toolCall: firstToolCall,
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

      // Message event with no extractable text or tools
      return null;
    }

    case "function_call": {
      const toolName = (event.name as string) || "unknown";
      const rawArgs = parseMaybeJson(event.arguments);
      const toolInput = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? rawArgs as Record<string, unknown>
        : {};
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

    case "function_call_output": {
      const output = (event.output as string) || (event.content as string) || "";
      return {
        type: "tool_result" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        toolResult: {
          tool: "unknown", // Codex function_call_output doesn't include tool name
          output: output.slice(0, 2000),
          durationMs: 0,
        },
      };
    }

    case "error": {
      const message = (event.message as string) || (event.error as string) || "Unknown error";
      return {
        type: "failure" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        failure: {
          category: "unknown" as FailureCategory,
          message,
        },
      };
    }

    case "turn.failed": {
      const error = event.error as Record<string, unknown> | undefined;
      const message =
        (error && typeof error.message === "string" ? error.message : undefined) ||
        (typeof event.message === "string" ? event.message : undefined) ||
        "Unknown error";
      return {
        type: "failure" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        failure: {
          category: "unknown" as FailureCategory,
          message,
        },
      };
    }

    case "summary":
    case "response.completed":
    case "done":
    case "complete": {
      if (event.is_error === true) {
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

      let summaryText: string | undefined;
      if (typeof event.result === "string") {
        summaryText = event.result.slice(0, MAX_SUMMARY_LENGTH);
      } else if (typeof event.text === "string") {
        summaryText = event.text.slice(0, MAX_SUMMARY_LENGTH);
      }

      return {
        type: "completion" as RuntimeEventType,
        vendor,
        turn,
        timestamp,
        completionSummary: summaryText,
      };
    }

    default:
      return null;
  }
}

// ── Heuristic fallback parseEvent ────────────────────────────────────────

/**
 * Attempt to parse an unstructured line using the heuristic normalizer.
 *
 * This is the fallback path when the structured JSONL parser returns null.
 * It handles older Codex versions or non-standard output formats by running
 * the full normalizeCodexResponse heuristic on the line.
 */
function parseHeuristicFallback(
  line: string,
  turn: number,
): RuntimeEvent | null {
  const normalized = normalizeCodexResponse(line);

  const timestamp = new Date().toISOString();
  const vendor: LLMVendor = "codex";

  // If the heuristic found tool events, return the first as a tool_use
  if (normalized.toolEvents.length > 0) {
    const first = normalized.toolEvents[0];
    return {
      type: "tool_use" as RuntimeEventType,
      vendor,
      turn,
      timestamp,
      text: normalized.assistantText || undefined,
      toolCall: {
        tool: first.tool,
        input: first.input,
      },
    };
  }

  // If it found assistant text, return it
  if (normalized.assistantText) {
    return {
      type: "assistant" as RuntimeEventType,
      vendor,
      turn,
      timestamp,
      text: normalized.assistantText.slice(0, MAX_SUMMARY_LENGTH),
    };
  }

  // If it detected an error, return a failure
  if (normalized.status === "error" && normalized.error) {
    return {
      type: "failure" as RuntimeEventType,
      vendor,
      turn,
      timestamp,
      failure: {
        category: "unknown" as FailureCategory,
        message: normalized.error,
      },
    };
  }

  return null;
}

// ── CodexCliAdapter ─────────────────────────────────────────────────────

/**
 * VendorAdapter implementation for the Codex CLI.
 *
 * Stateless — all method inputs are passed as parameters.
 * Thread-safe — no mutable state.
 */
export const codexCliAdapter: VendorAdapter = {
  vendor: "codex" as LLMVendor,
  parseMode: "json",

  buildSpawnConfig(
    envelope: PromptEnvelope,
    policy: ExecutionPolicy,
    model: string | undefined,
  ): SpawnConfig {
    const { systemPrompt, taskPrompt } = assemblePrompt(envelope);

    // Codex takes the prompt as a positional argument (not stdin).
    // Combine system and task prompts into a single prompt string,
    // matching the format used by dispatchVendorSpawn in cli-loop.ts.
    const prompt = `SYSTEM:\n${systemPrompt}\n\nTASK:\n${taskPrompt}`;

    // Compile explicit sandbox and approval flags from the n-dx policy.
    // Replaces --full-auto so preset aliases cannot override intent.
    const policyFlags = compileCodexPolicyFlags(policy);

    const args = [
      "exec",
      ...policyFlags,
      "--json",
      "--skip-git-repo-check",
      ...(model ? ["-m", model] : []),
      prompt,
    ];

    return {
      binary: "codex",
      args,
      env: {},
      stdinContent: null, // Codex: prompt in args, not stdin
      cwd: ".",
    };
  },

  parseEvent(
    line: string,
    turn: number,
    metadata: Record<string, unknown>,
  ): RuntimeEvent | null {
    // Primary path: structured JSONL parsing
    const structured = parseCodexJsonLine(line, turn, metadata);
    if (structured) return structured;

    // Fallback: heuristic parsing for unstructured output
    if (line.trim()) {
      return parseHeuristicFallback(line, turn);
    }

    return null;
  },

  classifyError(err: unknown): FailureCategory {
    return classifyVendorError(err);
  },
};
