import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PRDStore } from "../../prd/rex-gateway.js";
import type { HenchConfig, RetryConfig, RunRecord, ToolCallRecord, TurnTokenUsage } from "../../schema/index.js";
import { validateCompletion, formatValidationResult } from "../../validation/completion.js";
import { toolRexUpdateStatus, toolRexAppendLog } from "../../tools/rex.js";
import { checkTokenBudget } from "./token-budget.js";
import { mapCodexUsageToTokenUsage, parseTokenUsage, parseStreamTokenUsage } from "./token-usage.js";
import { startHeartbeat } from "./heartbeat.js";
import { section, stream, info } from "../../types/output.js";
import { isSpinningRun } from "../analysis/spin.js";
import {
  loadLLMConfig,
  type LLMVendor,
  resolveLLMVendor,
  resolveVendorCliPath,
  resolveVendorCliEnv,
} from "../../store/project-config.js";
import {
  compileCodexPolicyFlags,
  DEFAULT_EXECUTION_POLICY,
  type ExecutionPolicy,
} from "../../prd/llm-gateway.js";
import {
  prepareBrief,
  executeDryRun,
  transitionToInProgress,
  initRunRecord,
  captureStartingHead,
  runReviewGate,
  finalizeRun,
  handleRunFailure,
} from "./shared.js";
import type { SharedLoopOptions } from "./shared.js";

export interface CliLoopOptions extends SharedLoopOptions {}

export interface CliLoopResult {
  run: RunRecord;
}

const MAX_SUMMARY_LENGTH = 500;
const DEFAULT_CODEX_MODEL = "gpt-5-codex";

const TRANSIENT_PATTERNS = [
  /\b500\b/,
  /\b502\b/,
  /\b503\b/,
  /\b529\b/,
  /\b429\b/,
  /overloaded/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /socket hang up/i,
  /network error/i,
];

export function isTransientError(errorText: string): boolean {
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(errorText));
}

export function computeDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  const delay = baseMs * Math.pow(2, attempt);
  return Math.min(delay, maxMs);
}

export function buildRetryNotice(
  attempt: number,
  maxRetries: number,
  priorTurns: number,
): string {
  return (
    `\n\n---\nRETRY NOTICE (attempt ${attempt + 1}/${maxRetries + 1}): ` +
    `A previous attempt completed ${priorTurns} turn(s) before a transient error. ` +
    `Files written to disk by the prior attempt still exist. ` +
    `Check the current state of files before re-doing any work.\n---`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** File tools that Claude CLI should auto-approve (scoped to cwd). */
const CLI_FILE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep"];

/**
 * Build the `--allowed-tools` list for the Claude CLI.
 *
 * Maps the guard's `allowedCommands` (e.g. `["npm", "git"]`) to Claude CLI's
 * tool pattern format (e.g. `["Bash(npm:*)", "Bash(git:*)"]`), and includes
 * file tools that are inherently scoped to `cwd` by Claude CLI.
 *
 * This replaces `--dangerously-skip-permissions` so that:
 * - Listed tools are auto-approved (no interactive prompts → autonomous execution)
 * - Claude CLI's directory scoping stays active (file access restricted to cwd)
 * - Bash is restricted to the same commands the API provider's guard allows
 */
export function buildAllowedTools(allowedCommands: string[]): string[] {
  const bashTools = allowedCommands.map((cmd) => `Bash(${cmd}:*)`);
  return [...bashTools, ...CLI_FILE_TOOLS];
}

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

interface TokenEventMetadata {
  vendor: LLMVendor;
  model: string;
}

function resolveCliEventModel(
  vendor: LLMVendor,
  llmConfig: Awaited<ReturnType<typeof loadLLMConfig>>,
  configuredModel: string,
  modelOverride?: string,
): string {
  if (modelOverride) return modelOverride;
  if (vendor === "codex") return llmConfig.codex?.model ?? DEFAULT_CODEX_MODEL;
  return llmConfig.claude?.model ?? configuredModel;
}

function addTokenUsage(
  total: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number },
  increment: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number },
): { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number } {
  const next: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number } = {
    input: total.input + increment.input,
    output: total.output + increment.output,
  };

  if (increment.cacheCreationInput) {
    next.cacheCreationInput = (total.cacheCreationInput ?? 0) + increment.cacheCreationInput;
  } else if (total.cacheCreationInput != null) {
    next.cacheCreationInput = total.cacheCreationInput;
  }

  if (increment.cacheReadInput) {
    next.cacheReadInput = (total.cacheReadInput ?? 0) + increment.cacheReadInput;
  } else if (total.cacheReadInput != null) {
    next.cacheReadInput = total.cacheReadInput;
  }

  return next;
}

export interface NormalizedCodexToolEvent {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  status?: string;
  eventType: string;
}

export interface NormalizedCodexResponse {
  status: "completed" | "error" | "in_progress" | "unknown";
  assistantText: string;
  toolEvents: NormalizedCodexToolEvent[];
  warnings: string[];
  error?: string;
}

function parseMaybeJson(value: unknown): unknown {
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

function getBlockType(block: Record<string, unknown>): string | undefined {
  const type = block.type ?? block.kind ?? block.event ?? block.block_type ?? block.role;
  return typeof type === "string" ? type : undefined;
}

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

/** @internal Exported for testing. */
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

// ---------------------------------------------------------------------------
// Codex structured JSONL event parser
// ---------------------------------------------------------------------------

/**
 * Parse a single JSONL line from `codex exec --json` structured output.
 *
 * Maps Codex event types into the same {@link CliRunResult} shape that
 * Claude's `processStreamLine()` produces. This allows both vendors to
 * populate identical lifecycle state after execution.
 *
 * Returns `true` if the line was recognized as a structured event,
 * `false` if it wasn't (caller should fall back to heuristic handling).
 *
 * Supported event types (Codex JSONL format):
 * - `message` — assistant text + optional content blocks + optional usage
 * - `function_call` — tool invocation
 * - `function_call_output` — tool result
 * - `error` — execution error
 * - `summary` / `response.completed` / `done` / `complete` — completion
 *
 * @see processStreamLine — Claude equivalent
 * @see normalizeCodexResponse — heuristic fallback when structured output unavailable
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
        const parsed = parseTokenUsage(event.usage as Record<string, unknown>);
        result.tokenUsage.input += parsed.input;
        result.tokenUsage.output += parsed.output;

        const turnUsage: TurnTokenUsage = {
          turn: turnCounter.value,
          input: parsed.input,
          output: parsed.output,
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

/** @internal Exported for testing. */
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
          const parsed = parseTokenUsage(msg.usage as Record<string, unknown>);

          result.tokenUsage.input += parsed.input;
          result.tokenUsage.output += parsed.output;

          const turnUsage: TurnTokenUsage = {
            turn: turnCounter.value,
            input: parsed.input,
            output: parsed.output,
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

function spawnClaude(
  args: string[],
  stdinContent: string,
  cwd: string,
  tokenMetadata: TokenEventMetadata,
  cliBinary = "claude",
  env?: NodeJS.ProcessEnv,
): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cliBinary, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: env ?? process.env,
    });

    // Write prompt (and optionally system prompt) to stdin and close.
    // This avoids passing long/complex text as CLI args, which breaks on
    // Windows where shell:true routes through cmd.exe without arg quoting.
    proc.stdin.write(stdinContent, "utf-8");
    proc.stdin.end();

    const result: CliRunResult = {
      turns: 0,
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      turnTokenUsage: [],
    };

    const turnCounter = { value: 0 };
    let lineBuffer = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop()!; // Keep incomplete last line in buffer

      for (const line of lines) {
        processStreamLine(line, result, turnCounter, tokenMetadata);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(
          "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code\n" +
            "Or switch to the API provider: n-dx config hench.provider api",
        ));
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      // Process any remaining buffered output
      if (lineBuffer.trim()) {
        processStreamLine(lineBuffer, result, turnCounter, tokenMetadata);
      }

      if (result.turns === 0) {
        result.turns = turnCounter.value;
      }

      if (code !== 0 && !result.error) {
        result.error = stderr.trim() || `claude exited with code ${code}`;
      }

      resolve(result);
    });
  });
}

async function spawnCodex(
  prompt: string,
  cwd: string,
  model: string | undefined,
  tokenMetadata: TokenEventMetadata,
  policy: ExecutionPolicy = DEFAULT_EXECUTION_POLICY,
  cliBinary = "codex",
  env?: NodeJS.ProcessEnv,
): Promise<CliRunResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), "hench-codex-"));
  const outputPath = join(tmpDir, "last-message.txt");

  try {
    return await new Promise<CliRunResult>((resolve, reject) => {
      // Compile explicit sandbox and approval flags from the n-dx policy.
      // Replaces --full-auto so preset aliases cannot override intent.
      const policyFlags = compileCodexPolicyFlags(policy);
      const args = [
        "exec",
        ...policyFlags,
        "--json",
        "--skip-git-repo-check",
        "-o",
        outputPath,
      ];
      if (model) {
        args.push("-m", model);
      }
      args.push(prompt);

      const proc = spawn(cliBinary, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: env ?? process.env,
      });

      let stderr = "";
      let stdout = "";
      let stdoutLineBuffer = "";
      let stderrBuffer = "";

      // Track whether structured JSONL events were successfully parsed.
      // When structured events are present, they take precedence.
      // Heuristic normalization only kicks in as a compatibility fallback
      // when no structured events are received (e.g. older Codex versions
      // that don't support --json).
      let structuredEventCount = 0;

      const result: CliRunResult = {
        turns: 0,
        toolCalls: [],
        tokenUsage: { input: 0, output: 0 },
        turnTokenUsage: [],
      };
      const turnCounter = { value: 0 };

      const flushStderrLines = (buffer: string): { lines: string[]; rest: string } => {
        const parts = buffer.split("\n");
        const rest = parts.pop() ?? "";
        return { lines: parts, rest };
      };

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        stdoutLineBuffer += text;

        const lines = stdoutLineBuffer.split("\n");
        stdoutLineBuffer = lines.pop()!;

        for (const line of lines) {
          if (processCodexJsonLine(line, result, turnCounter, tokenMetadata)) {
            structuredEventCount++;
          } else if (line.trim()) {
            // Not a structured event — stream raw for visibility
            stream("Codex", line.trim());
          }
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        stderrBuffer += text;
        const { lines, rest } = flushStderrLines(stderrBuffer);
        stderrBuffer = rest;
        for (const raw of lines) {
          const line = raw.trim();
          if (line) stream("Codex", line);
        }
      });

      proc.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error("Codex CLI not found. Configure with: n-dx config llm.codex.cli_path /path/to/codex"));
          return;
        }
        reject(err);
      });

      proc.on("close", async (code) => {
        // Flush remaining buffered output
        if (stdoutLineBuffer.trim()) {
          if (processCodexJsonLine(stdoutLineBuffer, result, turnCounter, tokenMetadata)) {
            structuredEventCount++;
          } else {
            stream("Codex", stdoutLineBuffer.trim());
          }
        }
        if (stderrBuffer.trim()) {
          stream("Codex", stderrBuffer.trim());
        }

        // If structured JSONL parsing produced events, those take
        // precedence — the result is already populated by processCodexJsonLine.
        // Apply heuristic normalization only as a compatibility fallback.
        if (structuredEventCount === 0 && stdout.trim()) {
          // ── Heuristic fallback (compatibility) ──
          // Codex did not emit structured --json events. This happens when:
          // - Codex version doesn't support --json
          // - Output was plain text or an ad hoc JSON shape
          // Apply the defensive heuristic parser that was previously the
          // primary path. This ensures backward compatibility.
          const normalized = normalizeCodexResponse(stdout);
          const codexTokenMapping = mapCodexUsageToTokenUsage(parseMaybeJson(stdout));

          result.tokenUsage = codexTokenMapping.usage;
          result.turnTokenUsage.push({
            turn: 1,
            input: codexTokenMapping.usage.input,
            output: codexTokenMapping.usage.output,
            vendor: tokenMetadata.vendor,
            model: tokenMetadata.model,
          });

          for (const warning of normalized.warnings) {
            stream("Warn", warning);
          }
          if (codexTokenMapping.diagnosticStatus === "unavailable") {
            stream("Warn", "Codex response omitted usage; token accounting defaulted to zero (heuristic fallback).");
          }

          if (normalized.toolEvents.length > 0) {
            result.toolCalls = normalized.toolEvents.map((event) => ({
              turn: 1,
              tool: event.tool,
              input: {
                ...event.input,
                _codexEventType: event.eventType,
                ...(event.status ? { _codexStatus: event.status } : {}),
              },
              output: event.output?.slice(0, 2000) ?? "",
              durationMs: 0,
            }));
          }

          if (normalized.assistantText) {
            result.summary = normalized.assistantText.slice(0, MAX_SUMMARY_LENGTH);
          }

          if (normalized.status === "error" && !result.error) {
            result.error = normalized.error ?? "Codex response indicated an error";
          }

          // Ensure at least 1 turn for heuristic fallback
          if (result.turns === 0) result.turns = 1;
        }

        // Summary fallback: read from -o output file
        try {
          const fileSummary = await readFile(outputPath, "utf-8");
          if (fileSummary.trim() && !result.summary) {
            result.summary = fileSummary.trim().slice(0, MAX_SUMMARY_LENGTH);
          }
        } catch {
          // Ignore missing summary file
        }

        // Last-resort summary from raw stdout
        if (!result.summary && stdout.trim()) {
          result.summary = stdout.trim().slice(0, MAX_SUMMARY_LENGTH);
        }

        // Ensure turns is at least the turn counter
        if (result.turns === 0) {
          result.turns = turnCounter.value || 1;
        }

        // Token usage fallback: if structured events didn't provide usage,
        // try to extract from the raw stdout (heuristic).
        if (structuredEventCount > 0 && result.tokenUsage.input === 0 && result.tokenUsage.output === 0) {
          const codexTokenMapping = mapCodexUsageToTokenUsage(parseMaybeJson(stdout));
          if (codexTokenMapping.diagnosticStatus !== "unavailable") {
            result.tokenUsage = codexTokenMapping.usage;
          }
          if (codexTokenMapping.diagnosticStatus === "unavailable") {
            stream("Warn", "Codex structured output omitted usage; token accounting defaulted to zero.");
          }
        }

        if (code !== 0 && !result.error) {
          result.error = stderr.trim() || `codex exited with code ${code}`;
        }
        resolve(result);
      });
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Accumulated retry state — bundles mutable counters across retry attempts
// ---------------------------------------------------------------------------

interface AccumulatedState {
  turns: number;
  toolCalls: ToolCallRecord[];
  turnTokenUsage: TurnTokenUsage[];
  tokenUsage: CliRunResult["tokenUsage"];
}

function createAccumulatedState(): AccumulatedState {
  return {
    turns: 0,
    toolCalls: [],
    turnTokenUsage: [],
    tokenUsage: { input: 0, output: 0 },
  };
}

function accumulateResult(state: AccumulatedState, result: CliRunResult): void {
  state.turns += result.turns;
  state.toolCalls = state.toolCalls.concat(result.toolCalls);
  state.turnTokenUsage = state.turnTokenUsage.concat(result.turnTokenUsage);
  state.tokenUsage = addTokenUsage(state.tokenUsage, result.tokenUsage);
}

/** Copy accumulated state into the run record. */
function syncRunFromAccumulated(
  run: RunRecord,
  state: AccumulatedState,
  attempt: number,
): void {
  run.turns = state.turns;
  run.toolCalls = state.toolCalls;
  run.tokenUsage = state.tokenUsage;
  run.turnTokenUsage = state.turnTokenUsage;
  run.retryAttempts = attempt > 0 ? attempt : undefined;
}

// ---------------------------------------------------------------------------
// CLI arg construction (platform-aware)
// ---------------------------------------------------------------------------

interface ClaudeCliInput {
  systemPrompt: string;
  promptText: string;
  allowedTools: string[];
  modelOverride?: string;
}

/**
 * Build the Claude CLI args and stdin content.
 * Handles Windows cmd.exe escaping quirks.
 */
function buildClaudeCliArgs(input: ClaudeCliInput): { args: string[]; stdinContent: string } {
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

// ---------------------------------------------------------------------------
// Vendor dispatch — choose between Claude and Codex CLI
// ---------------------------------------------------------------------------

interface VendorDispatchOptions {
  vendor: LLMVendor;
  systemPrompt: string;
  promptText: string;
  allowedTools: string[];
  projectDir: string;
  tokenMetadata: TokenEventMetadata;
  cliBinary: string;
  cliEnv?: NodeJS.ProcessEnv;
  modelOverride?: string;
  /** Execution policy compiled to vendor-specific flags. */
  policy?: ExecutionPolicy;
}

async function dispatchVendorSpawn(opts: VendorDispatchOptions): Promise<CliRunResult> {
  if (opts.vendor === "codex") {
    return spawnCodex(
      `SYSTEM:\n${opts.systemPrompt}\n\nTASK:\n${opts.promptText}`,
      opts.projectDir,
      opts.modelOverride,
      opts.tokenMetadata,
      opts.policy ?? DEFAULT_EXECUTION_POLICY,
      opts.cliBinary,
      opts.cliEnv,
    );
  }

  const { args, stdinContent } = buildClaudeCliArgs({
    systemPrompt: opts.systemPrompt,
    promptText: opts.promptText,
    allowedTools: opts.allowedTools,
    modelOverride: opts.modelOverride,
  });

  return spawnClaude(
    args,
    stdinContent,
    opts.projectDir,
    opts.tokenMetadata,
    opts.cliBinary,
    opts.cliEnv,
  );
}

// ---------------------------------------------------------------------------
// Successful result processing — spin detection, validation, budget, review
// ---------------------------------------------------------------------------

/** Return value from processSuccessfulResult indicating whether the loop should break. */
type SuccessAction = "break" | "continue";

interface SuccessContext {
  run: RunRecord;
  result: CliRunResult;
  accumulated: AccumulatedState;
  attempt: number;
  store: PRDStore;
  taskId: string;
  projectDir: string;
  startingHead: string | undefined;
  testCommand?: string;
  tokenBudget?: number;
  review?: boolean;
  selfHeal?: boolean;
}

/**
 * Process a CLI result that completed without a process-level error.
 * Handles spin detection, completion validation, budget checks, and review gating.
 */
async function processSuccessfulResult(ctx: SuccessContext): Promise<SuccessAction> {
  const { run, result, accumulated, attempt, store, taskId, projectDir } = ctx;

  // Post-run spin detection: many turns with zero tool calls
  if (isSpinningRun(result.turns, result.toolCalls.length)) {
    syncRunFromAccumulated(run, accumulated, attempt);
    run.status = "failed";
    run.error = `Agent spin detected: ${result.turns} turns with 0 tool calls.`;
    info(`\n${run.error}`);
    await handleRunFailure(store, taskId, "deferred", "spin_detected", run.error);
    return "break";
  }

  // Validate completion: require meaningful changes
  const validation = await validateCompletion(projectDir, {
    testCommand: ctx.testCommand,
    startingHead: ctx.startingHead,
    selfHeal: ctx.selfHeal,
  });

  syncRunFromAccumulated(run, accumulated, attempt);

  // Post-run token budget check (CLI provider can only check after run)
  const budgetCheck = checkTokenBudget(run.tokenUsage, ctx.tokenBudget);
  if (budgetCheck.exceeded) {
    run.status = "budget_exceeded";
    run.summary = result.summary;
    run.error = `Token budget exceeded: ${budgetCheck.totalUsed} used of ${budgetCheck.budget} budget`;
    info(`\n${run.error}`);
    await handleRunFailure(store, taskId, "pending", "budget_exceeded", run.error);
    return "break";
  }

  if (validation.valid) {
    // Review gate
    if (ctx.review) {
      const reviewGate = await runReviewGate(projectDir, store, taskId, run);
      if (reviewGate.rejected) {
        run.summary = result.summary;
        return "break";
      }
    }

    // Success
    run.status = "completed";
    run.summary = result.summary;
    await toolRexUpdateStatus(store, taskId, { status: "completed" });
    await toolRexAppendLog(store, taskId, {
      event: "task_completed",
      detail: run.summary,
    });
  } else {
    // Completion rejected — no meaningful changes
    run.status = "failed";
    run.summary = result.summary;
    run.error = validation.reason;
    info(`\nCompletion rejected: ${validation.reason}`);
    info(formatValidationResult(validation));
    await handleRunFailure(store, taskId, "pending", "completion_rejected", formatValidationResult(validation));
  }

  return "break";
}

// ---------------------------------------------------------------------------
// Error result processing — transient vs non-transient
// ---------------------------------------------------------------------------

/** Return value from processErrorResult indicating whether the loop should break. */
type ErrorAction = "break" | "retry";

interface ErrorContext {
  run: RunRecord;
  result: CliRunResult;
  accumulated: AccumulatedState;
  attempt: number;
  store: PRDStore;
  taskId: string;
  retryConfig: RetryConfig;
}

/**
 * Process a CLI result that completed with a process-level error.
 * Classifies as transient (retry with backoff) or permanent (fail immediately).
 */
async function processErrorResult(ctx: ErrorContext): Promise<ErrorAction> {
  const { run, result, accumulated, attempt, store, taskId, retryConfig } = ctx;

  if (!isTransientError(result.error!)) {
    // Non-transient error: fail immediately
    syncRunFromAccumulated(run, accumulated, attempt);
    run.status = "failed";
    run.summary = result.summary;
    run.error = result.error;
    await handleRunFailure(store, taskId, "deferred", "task_failed", run.error!);
    return "break";
  }

  // Transient error — log and decide whether to retry or give up
  await toolRexAppendLog(store, taskId, {
    event: "transient_error",
    detail: `Attempt ${attempt + 1}: ${result.error}`,
  });

  if (attempt < retryConfig.maxRetries) {
    const delay = computeDelay(attempt, retryConfig.baseDelayMs, retryConfig.maxDelayMs);
    info(`Transient error on attempt ${attempt + 1}, retrying in ${delay}ms...`);
    await sleep(delay);
    return "retry";
  }

  // Retries exhausted
  syncRunFromAccumulated(run, accumulated, attempt);
  run.status = "error_transient";
  run.summary = result.summary;
  run.error = result.error;

  await handleRunFailure(
    store, taskId, "pending", "task_transient_exhausted",
    `All ${retryConfig.maxRetries + 1} attempts failed with transient errors. Last: ${result.error}`,
  );
  return "break";
}

// ---------------------------------------------------------------------------
// Main CLI loop — orchestrates brief → spawn → result processing
// ---------------------------------------------------------------------------

export async function cliLoop(opts: CliLoopOptions): Promise<CliLoopResult> {
  const { config, store, projectDir, henchDir, dryRun } = opts;
  const model = opts.model ?? config.model;
  const llmConfig = await loadLLMConfig(henchDir);
  const vendor = resolveLLMVendor(llmConfig);
  const eventModel = resolveCliEventModel(vendor, llmConfig, model, opts.model);

  // Shared: assemble brief, format, build system prompt, display task info
  const { brief, taskId, briefText, systemPrompt } = await prepareBrief(
    store, config, opts.taskId,
    { excludeTaskIds: opts.excludeTaskIds, epicId: opts.epicId },
    { priorAttempts: opts.priorAttempts, runHistory: opts.runHistory },
  );

  // Shared: dry run path
  if (dryRun) {
    const run = executeDryRun({
      label: "CLI",
      briefText,
      systemPrompt,
      taskId,
      taskTitle: brief.task.title,
      model,
      extraInfo: [{ heading: "Provider", content: `cli (${vendor} binary)` }],
    });
    return { run };
  }

  // Shared: transition task to in_progress
  await transitionToInProgress(store, taskId, brief.task.status);

  // Shared: initialize run record + capture start memory snapshot
  const { run, memoryCtx } = await initRunRecord({
    taskId,
    taskTitle: brief.task.title,
    model,
    henchDir,
  });

  // CLI-specific: load config for CLI path and env resolution
  const cliBinary = resolveVendorCliPath(llmConfig);
  const cliEnv = resolveVendorCliEnv(llmConfig);

  // Shared: capture HEAD before agent runs
  const startingHead = captureStartingHead(projectDir);

  const retryConfig: RetryConfig = config.retry ?? {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
  };

  // CLI-specific: build --allowed-tools from guard config
  const allowedTools = buildAllowedTools(config.guard.allowedCommands);
  const accumulated = createAccumulatedState();
  const tokenMetadata: TokenEventMetadata = { vendor, model: eventModel };

  // Start heartbeat — writes lastActivityAt to disk periodically so the CLI
  // subprocess doesn't appear stale to the web dashboard during long tool calls.
  const heartbeat = startHeartbeat(henchDir, run);

  try {
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      const promptText = attempt === 0
        ? briefText
        : briefText + buildRetryNotice(attempt, retryConfig.maxRetries, accumulated.turns);

      section(`Agent Run${opts.model ? ` (${opts.model})` : ""}${attempt > 0 ? ` (retry ${attempt}/${retryConfig.maxRetries})` : ""}`);
      stream("CLI", `Spawning ${vendor}${opts.model ? ` (model: ${opts.model})` : ""}...`);

      const result = await dispatchVendorSpawn({
        vendor,
        systemPrompt,
        promptText,
        allowedTools,
        projectDir,
        tokenMetadata,
        cliBinary,
        cliEnv,
        modelOverride: opts.model,
        policy: {
          ...DEFAULT_EXECUTION_POLICY,
          allowedCommands: config.guard.allowedCommands,
        },
      });

      accumulateResult(accumulated, result);

      if (!result.error) {
        const action = await processSuccessfulResult({
          run, result, accumulated, attempt,
          store, taskId, projectDir, startingHead,
          testCommand: brief.project.testCommand,
          tokenBudget: config.tokenBudget,
          review: opts.review,
          selfHeal: config.selfHeal,
        });
        if (action === "break") break;
      } else {
        const action = await processErrorResult({
          run, result, accumulated, attempt,
          store, taskId, retryConfig,
        });
        if (action === "break") break;
        // action === "retry" → continue loop
      }
    }
  } catch (err) {
    run.status = "failed";
    run.error = (err as Error).message;
    run.turns = accumulated.turns;
    run.toolCalls = accumulated.toolCalls;
    console.error(`[Error] ${run.error}`);

    await toolRexAppendLog(store, taskId, {
      event: "task_failed",
      detail: run.error,
    });
  }

  // Stop heartbeat before finalization
  heartbeat.stop();

  // Shared: finalize run (build summary, memory stats, post-task tests, save)
  await finalizeRun({
    run,
    henchDir,
    projectDir,
    testCommand: brief.project.testCommand,
    heartbeat,
    memoryCtx,
  });

  return { run };
}
