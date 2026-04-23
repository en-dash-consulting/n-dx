/**
 * CLI agent loop — spawns a vendor CLI subprocess and processes its output.
 *
 * This module orchestrates the full lifecycle of a single CLI agent run:
 * brief assembly → vendor CLI spawn → output parsing → result processing →
 * retry management → finalization.
 *
 * ## Adapter-based dispatch
 *
 * Vendor-specific logic (Claude vs Codex) is encapsulated in VendorAdapter
 * modules. The generic `spawnWithAdapter` function drives the spawn–parse–
 * accumulate cycle using three adapter methods:
 *
 * 1. `adapter.buildSpawnConfig()` → SpawnConfig (binary, args, env, stdin)
 * 2. `adapter.parseEvent()` → RuntimeEvent per output line
 * 3. `adapter.classifyError()` → FailureCategory for error classification
 *
 * The `resolveVendorAdapter(vendor)` factory selects the correct adapter.
 *
 * @see packages/hench/src/agent/lifecycle/vendor-adapter.ts — VendorAdapter interface
 * @see packages/hench/src/agent/lifecycle/adapters/ — adapter implementations
 * @see packages/hench/src/agent/lifecycle/event-accumulator.ts — legacy mutation-based parsers
 */

import { spawn } from "node:child_process";
import type { PRDStore } from "../../prd/rex-gateway.js";
import type { HenchConfig, RetryConfig, RunRecord, ToolCallRecord, TurnTokenUsage } from "../../schema/index.js";
import { validateCompletion, formatValidationResult } from "../../validation/completion.js";
import { toolRexUpdateStatus, toolRexAppendLog } from "../../tools/rex.js";
import { checkTokenBudget } from "./token-budget.js";
import { mapCodexUsageToTokenUsage, parseTokenUsageWithDiagnostic, parseStreamTokenUsage } from "./token-usage.js";
import { parseCodexCliTokenUsage } from "./codex-cli-token-parser.js";
import { startHeartbeat } from "./heartbeat.js";
import { section, subsection, stream, info } from "../../types/output.js";
import { isSpinningRun } from "../analysis/spin.js";
import {
  loadLLMConfig,
  type LLMVendor,
  resolveLLMVendor,
  resolveVendorCliPath,
  resolveVendorCliEnv,
} from "../../store/project-config.js";
import { resolveVendorModel, VENDOR_CONTEXT_CHAR_LIMITS } from "../../prd/llm-gateway.js";
import {
  createPromptEnvelope,
  DEFAULT_EXECUTION_POLICY,
  type ExecutionPolicy,
  type RuntimeEvent,
  type PromptSection,
  type PromptSectionName,
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
  formatModelLabel,
} from "./shared.js";
import type { SharedLoopOptions } from "./shared.js";
import type { VendorAdapter, SpawnConfig } from "./vendor-adapter.js";
import { resolveVendorAdapter } from "./adapters/index.js";
import { EventAccumulator } from "./event-accumulator.js";
import { extractPromptSectionDiagnostics, logPromptSections } from "./prompt-diagnostics.js";
import type { PromptSectionDiagnostic, PersistedRuntimeEvent } from "../../schema/index.js";

// ── normalizeCodexResponse ────────────────────────────────────────────────

/**
 * Normalize Codex CLI stdout into a structured response object.
 *
 * Codex verbose stdout is a human-readable session log, not a structured
 * event stream. parseMaybeJson() returns it as a plain string, so
 * toolEvents is always empty regardless of what Codex executed internally.
 * This is the IC-4 documented limitation — the IC-2 git-diff fallback in
 * shared.ts compensates at the test-gate level.
 *
 * @internal Exported for testing.
 */
export function normalizeCodexResponse(output: string): {
  toolEvents: unknown[];
  assistantText: string;
  status: string;
} {
  return {
    toolEvents: [],
    assistantText: output,
    status: "completed",
  };
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface CliLoopOptions extends SharedLoopOptions {
  spawnModel?: string;
}

export interface CliLoopResult {
  run: RunRecord;
}

// ── Internal types (used by spawnWithAdapter + main loop) ────────────────

/**
 * Intermediate result shape used during the spawn–parse–accumulate cycle.
 * Equivalent to the deprecated CliRunResult but kept as a private type
 * since the production path uses it internally.
 */
interface SpawnResult {
  turns: number;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number };
  turnTokenUsage: TurnTokenUsage[];
  summary?: string;
  error?: string;
  costUsd?: number;
}

interface SpawnTokenMetadata {
  vendor: LLMVendor;
  model: string;
}

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_SUMMARY_LENGTH = 500;

// ── Transient error detection & retry helpers ─────────────────────────────

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
  // Generic CLI non-zero exits: stderr is often empty when the subprocess is
  // killed or times out, so the error text is synthesised as
  // "<vendor> exited with code N". Treat these as transient — permanent
  // failures (bad auth, missing binary) surface via different error messages.
  /codex exited with code \d+/i,
  /claude exited with code \d+/i,
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

// ── RuntimeEvent → SpawnResult bridge ─────────────────────────────────────

/**
 * Apply a single RuntimeEvent to a mutable SpawnResult.
 *
 * This bridge converts the adapter's normalized RuntimeEvent into the
 * mutation-based accumulation that the rest of cli-loop expects. It also
 * emits stream output for the dashboard/CLI UI.
 */
function applyRuntimeEvent(
  event: RuntimeEvent,
  result: SpawnResult,
  turnCounter: { value: number },
  assistantLabel: string,
): void {
  switch (event.type) {
    case "assistant": {
      turnCounter.value++;
      if (event.text) {
        stream(assistantLabel, event.text);
        result.summary = event.text.slice(0, MAX_SUMMARY_LENGTH);
      }
      break;
    }

    case "tool_use": {
      const toolName = event.toolCall?.tool ?? "unknown";
      const toolInput = event.toolCall?.input ?? {};
      stream("Tool", `${toolName}(${JSON.stringify(toolInput).slice(0, 100)})`);
      result.toolCalls.push({
        turn: turnCounter.value || 1,
        tool: toolName,
        input: toolInput,
        output: "",
        durationMs: 0,
      });
      // If the event also carried assistant text, update summary
      if (event.text) {
        result.summary = event.text.slice(0, MAX_SUMMARY_LENGTH);
      }
      break;
    }

    case "tool_result": {
      const output = event.toolResult?.output ?? "";
      if (result.toolCalls.length > 0) {
        result.toolCalls[result.toolCalls.length - 1].output = output.slice(0, 2000);
      }
      const preview = output.slice(0, 200);
      stream("Result", `${preview}${output.length > 200 ? "..." : ""}`);
      break;
    }

    case "completion": {
      if (event.completionSummary) {
        result.summary = event.completionSummary;
      }
      break;
    }

    case "failure": {
      result.error = event.failure?.message ?? "Unknown error";
      break;
    }

    default:
      break;
  }
}

// ── Event pipeline helpers ─────────────────────────────────────────────────

/**
 * Emit UI stream output for a RuntimeEvent.
 *
 * Pure side-effect function: writes to the dashboard/CLI output stream.
 * Used by the event pipeline path where `applyRuntimeEvent` is replaced
 * by `EventAccumulator.push()` (which doesn't emit UI output).
 *
 * @internal Exported for testing.
 */
export function emitStreamOutput(event: RuntimeEvent, assistantLabel = "Agent"): void {
  switch (event.type) {
    case "assistant": {
      if (event.text) stream(assistantLabel, event.text);
      break;
    }
    case "tool_use": {
      const toolName = event.toolCall?.tool ?? "unknown";
      const toolInput = event.toolCall?.input ?? {};
      stream("Tool", `${toolName}(${JSON.stringify(toolInput).slice(0, 100)})`);
      break;
    }
    case "tool_result": {
      const output = event.toolResult?.output ?? "";
      const preview = output.slice(0, 200);
      stream("Result", `${preview}${output.length > 200 ? "..." : ""}`);
      break;
    }
    case "failure": {
      // Failures are logged elsewhere; no stream emission needed
      break;
    }
    default:
      break;
  }
}

/**
 * Convert a `RuntimeEvent` (readonly, from `@n-dx/llm-client`) into
 * a `PersistedRuntimeEvent` (plain, JSON-serializable) for storage
 * on the run record.
 *
 * @internal Exported for testing.
 */
export function toPersistedEvent(event: RuntimeEvent): PersistedRuntimeEvent {
  const persisted: PersistedRuntimeEvent = {
    type: event.type,
    vendor: event.vendor,
    turn: event.turn,
    timestamp: event.timestamp,
  };
  if (event.text !== undefined) persisted.text = event.text;
  if (event.toolCall) persisted.toolCall = { tool: event.toolCall.tool, input: { ...event.toolCall.input } };
  if (event.toolResult) persisted.toolResult = { tool: event.toolResult.tool, output: event.toolResult.output, durationMs: event.toolResult.durationMs };
  if (event.tokenUsage) persisted.tokenUsage = { ...event.tokenUsage };
  if (event.failure) {
    persisted.failure = { category: event.failure.category, message: event.failure.message };
    if (event.failure.vendorDetail !== undefined) persisted.failure.vendorDetail = event.failure.vendorDetail;
  }
  if (event.completionSummary !== undefined) persisted.completionSummary = event.completionSummary;
  return persisted;
}

/**
 * Convert raw JSON token usage into a `token_usage` RuntimeEvent.
 *
 * Checks the standard locations where vendors embed usage data
 * (`event.usage`, `event.message.usage`) and returns a RuntimeEvent
 * for accumulation, or `null` if no usage was found.
 *
 * @internal Exported for testing.
 */
export function rawJsonToTokenUsageEvent(
  rawJson: Record<string, unknown>,
  turn: number,
  metadata: SpawnTokenMetadata,
): RuntimeEvent | null {
  let usage: Record<string, unknown> | undefined;

  if (rawJson.usage && typeof rawJson.usage === "object") {
    usage = rawJson.usage as Record<string, unknown>;
  } else if (rawJson.message && typeof rawJson.message === "object") {
    const msg = rawJson.message as Record<string, unknown>;
    if (msg.usage && typeof msg.usage === "object") {
      usage = msg.usage as Record<string, unknown>;
    }
  }

  if (!usage) return null;

  const { usage: parsed } = parseTokenUsageWithDiagnostic(usage);

  return {
    type: "token_usage",
    vendor: metadata.vendor,
    turn: turn || 1,
    timestamp: new Date().toISOString(),
    tokenUsage: parsed,
  };
}

// ── Token usage extraction from raw JSON ──────────────────────────────────

/**
 * Extract token usage from a raw JSON event object.
 *
 * Both Claude and Codex embed token usage in event payloads at predictable
 * locations (`event.usage`, `event.message.usage`). This function checks
 * those locations and accumulates usage into the SpawnResult.
 */
function extractTokenUsage(
  rawJson: Record<string, unknown>,
  result: SpawnResult,
  turnCounter: { value: number },
  tokenMetadata: SpawnTokenMetadata,
): void {
  let usage: Record<string, unknown> | undefined;

  // Direct usage field (both vendors)
  if (rawJson.usage && typeof rawJson.usage === "object") {
    usage = rawJson.usage as Record<string, unknown>;
  }
  // Nested message.usage (Claude "assistant" events)
  else if (rawJson.message && typeof rawJson.message === "object") {
    const msg = rawJson.message as Record<string, unknown>;
    if (msg.usage && typeof msg.usage === "object") {
      usage = msg.usage as Record<string, unknown>;
    }
  }

  if (!usage) return;

  const { usage: parsed, diagnosticStatus } = parseTokenUsageWithDiagnostic(usage);

  result.tokenUsage.input += parsed.input;
  result.tokenUsage.output += parsed.output;

  const turnUsage: TurnTokenUsage = {
    turn: turnCounter.value || 1,
    input: parsed.input,
    output: parsed.output,
    diagnosticStatus,
    vendor: tokenMetadata.vendor,
    model: tokenMetadata.model,
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

/**
 * Handle metadata from "result" / completion events that RuntimeEvent
 * does not carry (num_turns, cost_usd, fallback token usage).
 */
function extractCompletionMetadata(
  rawJson: Record<string, unknown>,
  result: SpawnResult,
): void {
  if (typeof rawJson.num_turns === "number") {
    result.turns = rawJson.num_turns;
  }
  if (typeof rawJson.cost_usd === "number") {
    result.costUsd = rawJson.cost_usd;
  }
  // Fallback token usage from completion event (if per-turn not available)
  if (rawJson.usage && typeof rawJson.usage === "object") {
    if (result.tokenUsage.input === 0 && result.tokenUsage.output === 0) {
      const fallback = parseStreamTokenUsage(rawJson);
      if (fallback) {
        result.tokenUsage.input = fallback.input;
        result.tokenUsage.output = fallback.output;
      }
    }
  }
}

// ── Token usage arithmetic ────────────────────────────────────────────────

function addTokenUsage(
  total: SpawnResult["tokenUsage"],
  increment: SpawnResult["tokenUsage"],
): SpawnResult["tokenUsage"] {
  const next: SpawnResult["tokenUsage"] = {
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

// ── Generic adapter-based spawn ───────────────────────────────────────────

interface SpawnWithAdapterOptions {
  adapter: VendorAdapter;
  spawnConfig: SpawnConfig;
  cliBinary: string;
  cliEnv?: NodeJS.ProcessEnv;
  cwd: string;
  tokenMetadata: SpawnTokenMetadata;
  /** When true, use EventAccumulator instead of inline SpawnResult mutation. */
  useEventPipeline?: boolean;
  /** Caller-provided accumulator — events are pushed here when useEventPipeline is true. */
  accumulator?: EventAccumulator;
}

/**
 * Spawn a vendor CLI process using the adapter pattern.
 *
 * This replaces the old `spawnClaude` and `spawnCodex` functions with a
 * single generic implementation that delegates all vendor-specific logic
 * to the adapter:
 *
 * 1. SpawnConfig determines the process args, env, and stdin behavior
 * 2. adapter.parseEvent() normalizes each output line into a RuntimeEvent
 * 3. applyRuntimeEvent() bridges RuntimeEvents into SpawnResult mutations
 *    (legacy path), OR events are pushed into an EventAccumulator (event
 *    pipeline path, gated by `useEventPipeline`)
 * 4. Token usage is extracted from raw JSON in parallel
 *
 * The function also handles:
 * - Whole-output heuristic fallback (when no structured events are parsed)
 * - Summary fallback from raw stdout
 * - ENOENT error messages with vendor-appropriate help text
 * - Non-zero exit code error reporting
 *
 * ## Event pipeline mode (`useEventPipeline: true`)
 *
 * When enabled, `adapter.parseEvent()` output and raw JSON token usage are
 * converted to RuntimeEvents and pushed into the caller-provided
 * `EventAccumulator`. On process close, `SpawnResult` is derived from
 * `accumulator.toCliRunResult()` instead of inline mutation. This produces
 * equivalent run records while operating entirely on the RuntimeEvent stream.
 */
function spawnWithAdapter(opts: SpawnWithAdapterOptions): Promise<SpawnResult> {
  const {
    adapter, spawnConfig, cliBinary, cliEnv, cwd, tokenMetadata,
    useEventPipeline, accumulator,
  } = opts;

  return new Promise((resolve, reject) => {
    const stdinMode = spawnConfig.stdinContent !== null ? "pipe" : "ignore";
    const proc = spawn(cliBinary, [...spawnConfig.args], {
      cwd,
      stdio: [stdinMode as "pipe" | "ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: cliEnv ?? process.env,
    });

    // Write stdin content if the adapter requires it (Claude: pipe-based prompt)
    if (spawnConfig.stdinContent !== null && proc.stdin) {
      proc.stdin.write(spawnConfig.stdinContent, "utf-8");
      proc.stdin.end();
    }

    const result: SpawnResult = {
      turns: 0,
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
      turnTokenUsage: [],
    };

    const turnCounter = { value: 0 };
    let lineBuffer = "";
    let stderr = "";
    let fullStdout = "";
    let eventCount = 0;

    // Event pipeline: track completion metadata from raw JSON since
    // RuntimeEvent doesn't carry num_turns or cost_usd.
    let completionTurns: number | undefined;
    let completionCostUsd: number | undefined;

    const vendorLabel = formatModelLabel(
      tokenMetadata.model,
      adapter.vendor === "codex" ? "Codex" : "Agent",
    );

    proc.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      fullStdout += text;
      lineBuffer += text;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop()!; // Keep incomplete last line in buffer

      for (const line of lines) {
        processLine(line);
      }
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // Stream stderr lines for visibility
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.trim()) stream(vendorLabel, line.trim());
      }
    });

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        const message = adapter.vendor === "codex"
          ? "Codex CLI not found. Configure with: n-dx config llm.codex.cli_path /path/to/codex"
          : "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code\n" +
            "Or switch to the API provider: n-dx config hench.provider api";
        reject(new Error(message));
        return;
      }
      reject(err);
    });

    proc.on("close", (code) => {
      // Flush remaining buffered output
      if (lineBuffer.trim()) {
        processLine(lineBuffer);
      }

      if (useEventPipeline && accumulator) {
        // ── Event pipeline close path ──────────────────────────────────

        // Whole-output heuristic fallback
        if (eventCount === 0 && fullStdout.trim()) {
          const fallbackEvent = adapter.parseEvent(fullStdout, 1, {});
          if (fallbackEvent) {
            accumulator.push(fallbackEvent);
            emitStreamOutput(fallbackEvent, vendorLabel);
          }

          // Codex-specific: extract token usage from raw stdout
          if (adapter.vendor === "codex") {
            try {
              const raw = JSON.parse(fullStdout);
              const codexMapping = mapCodexUsageToTokenUsage(raw);
              if (codexMapping.diagnosticStatus !== "unavailable") {
                accumulator.push({
                  type: "token_usage",
                  vendor: tokenMetadata.vendor,
                  turn: 1,
                  timestamp: new Date().toISOString(),
                  tokenUsage: codexMapping.usage,
                });
              }
            } catch {
              // Non-JSON stdout — no token usage to extract
            }
          }
        }

        // Codex token usage fallback: structured events parsed but no usage
        if (eventCount > 0 && accumulator.tokenUsage.total.input === 0 && accumulator.tokenUsage.total.output === 0) {
          if (adapter.vendor === "codex") {
            try {
              const raw = JSON.parse(fullStdout);
              const codexMapping = mapCodexUsageToTokenUsage(raw);
              if (codexMapping.diagnosticStatus !== "unavailable") {
                accumulator.push({
                  type: "token_usage",
                  vendor: tokenMetadata.vendor,
                  turn: 1,
                  timestamp: new Date().toISOString(),
                  tokenUsage: codexMapping.usage,
                });
              }
            } catch {
              // Non-JSON stdout
            }
          }
        }

        // Derive SpawnResult from accumulator
        const derived = accumulator.toCliRunResult();
        result.turns = completionTurns ?? derived.turns;
        result.toolCalls = derived.toolCalls;
        result.tokenUsage = derived.tokenUsage;
        result.turnTokenUsage = derived.turnTokenUsage;
        result.summary = derived.summary;
        result.error = derived.error;
        result.costUsd = completionCostUsd;

        // Ensure turns is at least 1 for heuristic fallback
        if (result.turns === 0 && eventCount === 0 && fullStdout.trim()) {
          result.turns = 1;
        }
        // Ensure turns is at least the turn counter
        if (result.turns === 0) {
          result.turns = turnCounter.value || (eventCount > 0 ? 1 : 0);
        }

        // Summary fallback from raw stdout
        if (!result.summary && fullStdout.trim()) {
          result.summary = fullStdout.trim().slice(0, MAX_SUMMARY_LENGTH);
        }

        // Enrich per-turn usage with model (not carried by RuntimeEvent)
        for (const tu of result.turnTokenUsage) {
          if (!tu.model) tu.model = tokenMetadata.model;
        }
      } else {
        // ── Legacy close path (inline mutation) ────────────────────────

        // Whole-output heuristic fallback: if no structured events were parsed
        // line-by-line, try the entire stdout as a single input to the adapter.
        // This handles older Codex versions that output non-JSONL responses.
        if (eventCount === 0 && fullStdout.trim()) {
          const fallbackEvent = adapter.parseEvent(fullStdout, 1, {});
          if (fallbackEvent) {
            applyRuntimeEvent(fallbackEvent, result, turnCounter, vendorLabel);
          }

          // Codex-specific: extract token usage from raw stdout via heuristic mapping
          if (adapter.vendor === "codex") {
            try {
              const raw = JSON.parse(fullStdout);
              const codexMapping = mapCodexUsageToTokenUsage(raw);
              if (codexMapping.diagnosticStatus !== "unavailable") {
                result.tokenUsage = codexMapping.usage;
                result.turnTokenUsage.push({
                  turn: 1,
                  input: codexMapping.usage.input,
                  output: codexMapping.usage.output,
                  vendor: tokenMetadata.vendor,
                  model: tokenMetadata.model,
                });
              }
            } catch {
              // Non-JSON stdout — try text-format token extraction
              const textTokens = parseCodexCliTokenUsage(fullStdout);
              if (textTokens) {
                result.tokenUsage = { input: textTokens.input, output: textTokens.output };
              }
              result.turnTokenUsage.push({
                turn: 1,
                input: result.tokenUsage.input,
                output: result.tokenUsage.output,
                vendor: tokenMetadata.vendor,
                model: tokenMetadata.model,
              });
            }
          }

          // Ensure at least 1 turn for heuristic fallback
          if (result.turns === 0) result.turns = 1;
        }

        // Ensure turns is at least the turn counter
        if (result.turns === 0) {
          result.turns = turnCounter.value || (eventCount > 0 ? 1 : 0);
        }

        // Summary fallback from raw stdout
        if (!result.summary && fullStdout.trim()) {
          result.summary = fullStdout.trim().slice(0, MAX_SUMMARY_LENGTH);
        }

        // Codex text-format token extraction and guaranteed turn entry.
        // When heuristic fallback events were produced per-line (eventCount > 0),
        // per-line extractTokenUsage never fires (no JSON lines). Scan fullStdout
        // here as a post-run pass.  Also runs when eventCount === 0 but the
        // eventCount === 0 block didn't push an entry (e.g. JSON extraction
        // returned "unavailable").  Always emits one turnTokenUsage entry per
        // attempt — zeros when no usage data is available — so callers can
        // account for every attempt regardless of stdout output.
        if (adapter.vendor === "codex" && result.turnTokenUsage.length === 0) {
          if (fullStdout.trim()) {
            try {
              const raw = JSON.parse(fullStdout);
              const codexMapping = mapCodexUsageToTokenUsage(raw);
              if (codexMapping.diagnosticStatus !== "unavailable") {
                result.tokenUsage = codexMapping.usage;
              }
            } catch {
              // Non-JSON stdout — try text-format token extraction
              const textTokens = parseCodexCliTokenUsage(fullStdout);
              if (textTokens) {
                result.tokenUsage = { input: textTokens.input, output: textTokens.output };
              }
            }
          }
          result.turnTokenUsage.push({
            turn: 1,
            input: result.tokenUsage.input,
            output: result.tokenUsage.output,
            vendor: tokenMetadata.vendor,
            model: tokenMetadata.model,
            diagnosticStatus: result.tokenUsage.input === 0 && result.tokenUsage.output === 0
              ? "unavailable"
              : undefined,
          });
        }
      }

      if (code !== 0 && !result.error) {
        result.error = stderr.trim() || `${adapter.vendor} exited with code ${code}`;
      }

      resolve(result);
    });

    // ── Line processing helper ──────────────────────────────────────────

    function processLine(line: string): void {
      // Step 1: Parse the line through the adapter for event classification
      const event = adapter.parseEvent(line, turnCounter.value + 1, {});

      if (useEventPipeline && accumulator) {
        // ── Event pipeline: push to accumulator + emit UI ──
        if (event) {
          eventCount++;
          accumulator.push(event);
          emitStreamOutput(event, vendorLabel);
          if (event.type === "assistant") turnCounter.value++;
        }

        // Step 2: Extract token usage → RuntimeEvent → accumulator
        if (line.trim()) {
          try {
            const rawJson = JSON.parse(line);
            const tokenEvent = rawJsonToTokenUsageEvent(rawJson, turnCounter.value || 1, tokenMetadata);
            if (tokenEvent) accumulator.push(tokenEvent);

            // Extract completion metadata (num_turns, cost_usd) from raw JSON
            const type = rawJson.type as string | undefined;
            if (type === "result" || type === "summary" || type === "response.completed" || type === "done" || type === "complete") {
              if (typeof rawJson.num_turns === "number") completionTurns = rawJson.num_turns;
              if (typeof rawJson.cost_usd === "number") completionCostUsd = rawJson.cost_usd;

              // Fallback token usage from completion event
              if (rawJson.usage && typeof rawJson.usage === "object") {
                if (accumulator.tokenUsage.total.input === 0 && accumulator.tokenUsage.total.output === 0) {
                  const fallback = parseStreamTokenUsage(rawJson);
                  if (fallback) {
                    accumulator.push({
                      type: "token_usage",
                      vendor: tokenMetadata.vendor,
                      turn: turnCounter.value || 1,
                      timestamp: new Date().toISOString(),
                      tokenUsage: fallback,
                    });
                  }
                }
              }
            }
          } catch {
            if (!event && line.trim()) {
              info(line);
            }
          }
        }
      } else {
        // ── Legacy: inline mutation ──
        if (event) {
          eventCount++;
          applyRuntimeEvent(event, result, turnCounter, vendorLabel);
        }

        // Step 2: Extract token usage from raw JSON (parallel to event parsing)
        // Token usage lives in the raw JSON payload, not in RuntimeEvent.
        if (line.trim()) {
          try {
            const rawJson = JSON.parse(line);
            extractTokenUsage(rawJson, result, turnCounter, tokenMetadata);

            // Extract completion metadata (num_turns, cost_usd, fallback usage)
            const type = rawJson.type as string | undefined;
            if (type === "result" || type === "summary" || type === "response.completed" || type === "done" || type === "complete") {
              extractCompletionMetadata(rawJson, result);
            }
          } catch {
            // Not JSON — stream raw output for visibility if adapter didn't handle it
            if (!event && line.trim()) {
              info(line);
            }
          }
        }
      }
    }
  });
}

// ── LLM config helpers ────────────────────────────────────────────────────

function resolveCliEventModel(
  vendor: LLMVendor,
  llmConfig: Awaited<ReturnType<typeof loadLLMConfig>>,
  configuredModel: string,
  modelOverride?: string,
): string {
  if (modelOverride) return modelOverride;
  return configuredModel || resolveVendorModel(vendor, llmConfig);
}

// ── Accumulated retry state ───────────────────────────────────────────────

interface AccumulatedState {
  turns: number;
  toolCalls: ToolCallRecord[];
  turnTokenUsage: TurnTokenUsage[];
  tokenUsage: SpawnResult["tokenUsage"];
}

function createAccumulatedState(): AccumulatedState {
  return {
    turns: 0,
    toolCalls: [],
    turnTokenUsage: [],
    tokenUsage: { input: 0, output: 0 },
  };
}

function accumulateResult(state: AccumulatedState, result: SpawnResult): void {
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

// ── Successful result processing ──────────────────────────────────────────

/** Return value from processSuccessfulResult indicating whether the loop should break. */
type SuccessAction = "break" | "continue";

interface SuccessContext {
  run: RunRecord;
  result: SpawnResult;
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
  /** Per-attempt EventAccumulator (event pipeline path). */
  attemptAccumulator?: EventAccumulator;
  /** Cross-retry EventAccumulator (event pipeline path). */
  runAccumulator?: EventAccumulator;
}

/**
 * Process a CLI result that completed without a process-level error.
 * Handles spin detection, completion validation, budget checks, and review gating.
 *
 * When `attemptAccumulator` and `runAccumulator` are provided (event pipeline
 * path), spin detection and budget checking operate directly on the
 * RuntimeEvent stream via the accumulators instead of the legacy SpawnResult.
 */
async function processSuccessfulResult(ctx: SuccessContext): Promise<SuccessAction> {
  const { run, result, accumulated, attempt, store, taskId, projectDir } = ctx;

  // Post-run spin detection: many turns with zero tool calls
  // Event pipeline: use accumulator-derived counts directly
  const spinTurns = ctx.attemptAccumulator
    ? ctx.attemptAccumulator.maxTurn
    : result.turns;
  const spinToolCount = ctx.attemptAccumulator
    ? ctx.attemptAccumulator.toolCalls.count
    : result.toolCalls.length;

  if (isSpinningRun(spinTurns, spinToolCount)) {
    syncRunFromAccumulated(run, accumulated, attempt);
    run.status = "failed";
    run.error = `Agent spin detected: ${spinTurns} turns with 0 tool calls.`;
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
  // Event pipeline: use cross-retry accumulator totals directly
  const budgetUsage = ctx.runAccumulator
    ? ctx.runAccumulator.tokenUsage.total
    : run.tokenUsage;
  const budgetCheck = checkTokenBudget(budgetUsage, ctx.tokenBudget);
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

// ── Error result processing ───────────────────────────────────────────────

/** Return value from processErrorResult indicating whether the loop should break. */
type ErrorAction = "break" | "retry";

interface ErrorContext {
  run: RunRecord;
  result: SpawnResult;
  accumulated: AccumulatedState;
  attempt: number;
  store: PRDStore;
  taskId: string;
  retryConfig: RetryConfig;
  vendor: string;
}

/**
 * Process a CLI result that completed with a process-level error.
 * Classifies as transient (retry with backoff) or permanent (fail immediately).
 */
async function processErrorResult(ctx: ErrorContext): Promise<ErrorAction> {
  const { run, result, accumulated, attempt, store, taskId, retryConfig, vendor } = ctx;

  if (!isTransientError(result.error!)) {
    // Non-transient error: fail immediately
    syncRunFromAccumulated(run, accumulated, attempt);
    run.status = "failed";
    run.summary = result.summary;
    run.error = result.error;
    await handleRunFailure(store, taskId, "deferred", "task_failed", run.error!);
    return "break";
  }

  // Transient error — log with vendor, batch identifier, and attempt number
  // so operators can correlate retries across multi-task self-heal runs.
  await toolRexAppendLog(store, taskId, {
    event: "transient_error",
    detail: `[${vendor}] batch "${taskId}" attempt ${attempt + 1}/${retryConfig.maxRetries + 1}: ${result.error}`,
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

// ── Main CLI loop ─────────────────────────────────────────────────────────

export async function cliLoop(opts: CliLoopOptions): Promise<CliLoopResult> {
  const { config, store, projectDir, henchDir, dryRun } = opts;
  const model = opts.model ?? config.model;
  const llmConfig = await loadLLMConfig(henchDir);
  const vendor = resolveLLMVendor(llmConfig);
  const eventModel = resolveCliEventModel(vendor, llmConfig, model, opts.spawnModel);

  // Resolve the vendor adapter — replaces the old dispatchVendorSpawn switch
  const adapter = resolveVendorAdapter(vendor);

  // Shared: assemble brief, format, build system prompt + envelope, display task info
  const { brief, taskId, briefText, systemPrompt, envelope: baseEnvelope } = await prepareBrief(
    store, config, opts.taskId,
    { excludeTaskIds: opts.excludeTaskIds, epicId: opts.epicId },
    { priorAttempts: opts.priorAttempts, runHistory: opts.runHistory },
    opts.extraContext,
  );

  // Bound the brief text to the vendor's effective context character limit.
  // This prevents the combined prompt (system + brief) from exceeding the
  // vendor's context window.  Use the vendor/model resolver from llm-gateway
  // to select the appropriate limit rather than a Claude-specific constant.
  const contextCharLimit = VENDOR_CONTEXT_CHAR_LIMITS[vendor];
  const boundedBriefText = briefText.length > contextCharLimit
    ? briefText.slice(0, contextCharLimit)
    : briefText;

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
      invocationContext: "cli",
    });
    return { run };
  }

  // Shared: transition task to in_progress
  await transitionToInProgress(store, taskId, brief.task.status);

  // Build the execution policy from guard config (needed for diagnostics at init)
  const policy: ExecutionPolicy = {
    ...DEFAULT_EXECUTION_POLICY,
    allowedCommands: config.guard.allowedCommands,
  };

  // Shared: initialize run record + capture start memory snapshot
  const { run, memoryCtx } = await initRunRecord({
    taskId,
    taskTitle: brief.task.title,
    model,
    henchDir,
    vendor,
    sandbox: policy.sandbox,
    approvals: policy.approvals,
    parseMode: adapter.parseMode,
    invocationContext: "cli",
  });

  // CLI-specific: load config for CLI path and env resolution
  const cliBinary = resolveVendorCliPath(llmConfig, config);
  const cliEnv = resolveVendorCliEnv(llmConfig);

  // Shared: capture HEAD before agent runs
  const startingHead = captureStartingHead(projectDir);

  const retryConfig: RetryConfig = config.retry ?? {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
  };

  const accumulated = createAccumulatedState();
  const tokenMetadata: SpawnTokenMetadata = { vendor, model: eventModel };
  const useEventPipeline = config.useEventPipeline ?? false;

  // Event pipeline: cross-retry accumulator that collects events from all attempts.
  // Spin detection uses the per-attempt accumulator; budget checking uses this
  // cross-retry accumulator so it sees total token usage across all retries.
  const runAccumulator = useEventPipeline ? new EventAccumulator() : undefined;

  // Start heartbeat — writes lastActivityAt to disk periodically so the CLI
  // subprocess doesn't appear stale to the web dashboard during long tool calls.
  const heartbeat = startHeartbeat(henchDir, run);

  // Prompt section diagnostics — captured on first attempt, stored on run record.
  let promptSectionDiagnostics: PromptSectionDiagnostic[] | undefined;

  // Emit the Agent Run banner exactly once per run, before the retry loop.
  // Retries are surfaced as lighter subsection lines inside the loop so a
  // single run renders as one start banner, N attempt markers, one end.
  section(
    opts.runNumber !== undefined
      ? `Agent Run #${opts.runNumber}${opts.spawnModel ? ` (${opts.spawnModel})` : ""} start`
      : `Agent Run${opts.spawnModel ? ` (${opts.spawnModel})` : ""}`,
  );

  try {
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      const promptText = attempt === 0
        ? boundedBriefText
        : boundedBriefText + buildRetryNotice(attempt, retryConfig.maxRetries, accumulated.turns);

      // Build the per-attempt PromptEnvelope. On the first attempt we use
      // the base envelope from prepareBrief directly. On retries we replace
      // the "brief" section with the retry-augmented prompt text.
      const envelope = attempt === 0
        ? baseEnvelope
        : createPromptEnvelope([
            { name: "system" as PromptSectionName, content: systemPrompt } as PromptSection,
            { name: "brief" as PromptSectionName, content: promptText } as PromptSection,
          ]);

      // Use the adapter to build the vendor-specific spawn configuration
      const spawnConfig = adapter.buildSpawnConfig(envelope, policy, opts.spawnModel);

      // Capture prompt section diagnostics on the first attempt for run-level storage.
      // Log section names and byte sizes on every attempt for CLI observability.
      const sectionDiags = extractPromptSectionDiagnostics(envelope);
      if (attempt === 0) {
        promptSectionDiagnostics = sectionDiags;
      }

      if (attempt > 0) {
        subsection(`Retry ${attempt}/${retryConfig.maxRetries}`);
      }
      stream("CLI", `Spawning ${vendor}${opts.spawnModel ? ` (model: ${opts.spawnModel})` : ""}...`);
      logPromptSections(sectionDiags);

      // Event pipeline: create a per-attempt accumulator. Events from this
      // attempt are pushed here, then merged into runAccumulator after spawn.
      const attemptAccumulator = useEventPipeline ? new EventAccumulator() : undefined;

      // Generic adapter-based spawn — replaces dispatchVendorSpawn
      const result = await spawnWithAdapter({
        adapter,
        spawnConfig,
        cliBinary,
        cliEnv,
        cwd: projectDir,
        tokenMetadata,
        useEventPipeline,
        accumulator: attemptAccumulator,
      });

      // Merge per-attempt events into the cross-retry accumulator
      if (useEventPipeline && attemptAccumulator && runAccumulator) {
        runAccumulator.push(...attemptAccumulator.events);
      }

      accumulateResult(accumulated, result);

      if (!result.error) {
        const action = await processSuccessfulResult({
          run, result, accumulated, attempt,
          store, taskId, projectDir, startingHead,
          testCommand: brief.project.testCommand,
          tokenBudget: config.tokenBudget,
          review: opts.review,
          selfHeal: config.selfHeal,
          attemptAccumulator,
          runAccumulator,
        });
        if (action === "break") break;
      } else {
        const action = await processErrorResult({
          run, result, accumulated, attempt,
          store, taskId, retryConfig, vendor,
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

  // Attach accumulated events to the run record when the event pipeline is active.
  // This enables post-hoc debugging via `hench show --events <run-id>`.
  if (useEventPipeline && runAccumulator && runAccumulator.eventCount > 0) {
    run.events = runAccumulator.events.map(toPersistedEvent);
  }

  // Attach prompt section diagnostics to the run record.
  // Initialize diagnostics if not already present, then populate promptSections.
  if (promptSectionDiagnostics) {
    if (!run.diagnostics) {
      run.diagnostics = {
        tokenDiagnosticStatus: "unavailable",
        parseMode: adapter.parseMode,
        notes: [],
      };
    }
    run.diagnostics.promptSections = promptSectionDiagnostics;
  }

  // Shared: finalize run (build summary, memory stats, post-task tests, save)
  await finalizeRun({
    run,
    henchDir,
    projectDir,
    testCommand: brief.project.testCommand,
    heartbeat,
    memoryCtx,
    selfHeal: config.selfHeal,
    rollbackOnFailure: opts.rollbackOnFailure,
    yes: opts.yes,
    autonomous: opts.autonomous,
    store,
    autoCommit: config.autoCommit === true,
  });

  return { run };
}
