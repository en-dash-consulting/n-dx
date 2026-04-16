/**
 * Event accumulation — RuntimeEvent-based and legacy mutation-based parsers.
 *
 * ## EventAccumulator (primary)
 *
 * The `EventAccumulator` class collects `RuntimeEvent[]` and derives
 * aggregated run metrics: total token usage (with diagnostic status),
 * tool call count and list, assistant message text, completion summary,
 * and failure details. The `toCliRunResult()` method produces a
 * backward-compatible `CliRunResult` for the migration period.
 *
 * ## Legacy functions (deprecated)
 *
 * The mutation-based functions (`processStreamLine`, `processCodexJsonLine`)
 * parse vendor CLI output lines and mutate a shared `CliRunResult` in place.
 * They remain for backward compatibility with existing tests.
 *
 * @see packages/hench/src/agent/lifecycle/adapters/ — adapter implementations
 * @see packages/hench/src/agent/lifecycle/cli-loop.ts — generic spawn function
 */

import type { ToolCallRecord, TurnTokenUsage, TokenUsage } from "../../schema/index.js";
import { parseTokenUsageWithDiagnostic, parseStreamTokenUsage } from "./token-usage.js";
import type { TokenDiagnosticStatus } from "./token-usage.js";
import { stream, info } from "../../types/output.js";
import type { LLMVendor, RuntimeEvent, FailureCategory } from "../../prd/llm-gateway.js";
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

// ── EventAccumulator ──────────────────────────────────────────────────────

/**
 * Accumulated token usage with per-turn granularity and diagnostic status.
 *
 * `overallDiagnostic` reflects the worst diagnostic across all turns:
 * - `complete` — every turn reported complete usage
 * - `partial` — at least one turn had partial data
 * - `unavailable` — at least one turn had no usage data, OR no token events at all
 */
export interface AccumulatedTokenUsage {
  readonly total: TokenUsage;
  readonly perTurn: ReadonlyArray<TurnTokenUsage>;
  readonly overallDiagnostic: TokenDiagnosticStatus;
}

/**
 * Derived tool call summary.
 */
export interface AccumulatedToolCalls {
  readonly count: number;
  readonly calls: ReadonlyArray<ToolCallRecord>;
}

/**
 * Derived failure information from failure events.
 */
export interface AccumulatedFailure {
  readonly category: FailureCategory;
  readonly message: string;
  readonly vendorDetail?: string;
}

/**
 * Collects `RuntimeEvent[]` and derives aggregated run metrics.
 *
 * This class is the primary event-pipeline accumulator. It replaces the
 * mutation-based `applyRuntimeEvent` bridge in `cli-loop.ts` with a
 * clean, functional derivation from the event stream.
 *
 * ## Usage
 *
 * ```ts
 * const acc = new EventAccumulator();
 * for (const event of events) acc.push(event);
 *
 * acc.tokenUsage;     // AccumulatedTokenUsage
 * acc.toolCalls;      // AccumulatedToolCalls
 * acc.assistantText;  // string[]
 * acc.completionSummary;  // string | undefined
 * acc.failures;       // AccumulatedFailure[]
 * acc.toCliRunResult();   // CliRunResult (backward compat)
 * ```
 *
 * All derivations are computed lazily on first access and cached until
 * the next `push()` call invalidates the cache.
 */
export class EventAccumulator {
  private readonly _events: RuntimeEvent[] = [];

  // ── Lazy caches ──
  private _tokenUsageCache: AccumulatedTokenUsage | null = null;
  private _toolCallsCache: AccumulatedToolCalls | null = null;
  private _assistantTextCache: string[] | null = null;
  private _completionSummaryCache: string | undefined | null = null;
  private _failuresCache: AccumulatedFailure[] | null = null;
  // Sentinel: null means "not computed", undefined means "computed, no summary"
  private _completionSummaryComputed = false;

  /** Number of events accumulated so far. */
  get eventCount(): number {
    return this._events.length;
  }

  /** Snapshot of accumulated events (defensive copy). */
  get events(): ReadonlyArray<RuntimeEvent> {
    return this._events;
  }

  /**
   * Add one or more events to the accumulator.
   * Invalidates all cached derivations.
   */
  push(...events: RuntimeEvent[]): void {
    for (const event of events) {
      this._events.push(event);
    }
    this._invalidate();
  }

  // ── Derived properties ──────────────────────────────────────────────

  /** Aggregated token usage across all `token_usage` events. */
  get tokenUsage(): AccumulatedTokenUsage {
    if (this._tokenUsageCache === null) {
      this._tokenUsageCache = this._deriveTokenUsage();
    }
    return this._tokenUsageCache;
  }

  /** Tool call count and detail list. */
  get toolCalls(): AccumulatedToolCalls {
    if (this._toolCallsCache === null) {
      this._toolCallsCache = this._deriveToolCalls();
    }
    return this._toolCallsCache;
  }

  /** All assistant message texts, in order. */
  get assistantText(): ReadonlyArray<string> {
    if (this._assistantTextCache === null) {
      this._assistantTextCache = this._deriveAssistantText();
    }
    return this._assistantTextCache;
  }

  /** Completion summary from the last `completion` event, if any. */
  get completionSummary(): string | undefined {
    if (!this._completionSummaryComputed) {
      this._completionSummaryCache = this._deriveCompletionSummary();
      this._completionSummaryComputed = true;
    }
    return this._completionSummaryCache ?? undefined;
  }

  /** All failure events accumulated during the run. */
  get failures(): ReadonlyArray<AccumulatedFailure> {
    if (this._failuresCache === null) {
      this._failuresCache = this._deriveFailures();
    }
    return this._failuresCache;
  }

  /**
   * Highest turn number seen across all events.
   * Returns 0 if no events have been accumulated.
   */
  get maxTurn(): number {
    let max = 0;
    for (const e of this._events) {
      if (e.turn > max) max = e.turn;
    }
    return max;
  }

  // ── Backward compatibility ──────────────────────────────────────────

  /**
   * Produce a `CliRunResult` from accumulated events.
   *
   * This bridges the event-pipeline accumulator to the legacy shape
   * consumed by `cli-loop.ts`, `finalizeRun`, spin detection, and
   * budget checks. It will be removed once all consumers migrate to
   * reading from the accumulator directly.
   */
  toCliRunResult(): CliRunResult {
    const tokenUsage = this.tokenUsage;
    const toolCalls = this.toolCalls;
    const failures = this.failures;

    // Summary: prefer completionSummary, then last assistant text
    let summary: string | undefined = this.completionSummary;
    if (!summary && this.assistantText.length > 0) {
      summary = this.assistantText[this.assistantText.length - 1].slice(0, MAX_SUMMARY_LENGTH);
    }

    // Error: first failure message, if any
    const error = failures.length > 0 ? failures[0].message : undefined;

    return {
      turns: this.maxTurn,
      toolCalls: toolCalls.calls as ToolCallRecord[],
      tokenUsage: { ...tokenUsage.total },
      turnTokenUsage: tokenUsage.perTurn as TurnTokenUsage[],
      summary,
      error,
    };
  }

  // ── Private derivation methods ──────────────────────────────────────

  private _invalidate(): void {
    this._tokenUsageCache = null;
    this._toolCallsCache = null;
    this._assistantTextCache = null;
    this._completionSummaryCache = null;
    this._completionSummaryComputed = false;
    this._failuresCache = null;
  }

  private _deriveTokenUsage(): AccumulatedTokenUsage {
    const total: TokenUsage = { input: 0, output: 0 };
    const perTurn: TurnTokenUsage[] = [];
    let worstDiagnostic: TokenDiagnosticStatus = "complete";

    const tokenEvents = this._events.filter((e) => e.type === "token_usage");

    if (tokenEvents.length === 0) {
      return { total, perTurn, overallDiagnostic: "unavailable" };
    }

    for (const event of tokenEvents) {
      const usage = event.tokenUsage;
      if (!usage) continue;

      total.input += usage.input;
      total.output += usage.output;

      if (usage.cacheCreationInput) {
        total.cacheCreationInput = (total.cacheCreationInput ?? 0) + usage.cacheCreationInput;
      }
      if (usage.cacheReadInput) {
        total.cacheReadInput = (total.cacheReadInput ?? 0) + usage.cacheReadInput;
      }

      // Determine diagnostic status for this turn based on data quality
      let turnDiagnostic: TokenDiagnosticStatus = "complete";
      if (usage.input === 0 && usage.output === 0) {
        turnDiagnostic = "unavailable";
      } else if (usage.input === 0 || usage.output === 0) {
        turnDiagnostic = "partial";
      }

      perTurn.push({
        turn: event.turn,
        input: usage.input,
        output: usage.output,
        diagnosticStatus: turnDiagnostic,
        vendor: event.vendor,
        ...(usage.cacheCreationInput ? { cacheCreationInput: usage.cacheCreationInput } : {}),
        ...(usage.cacheReadInput ? { cacheReadInput: usage.cacheReadInput } : {}),
      });

      // Worst-case diagnostic: unavailable > partial > complete
      worstDiagnostic = worstDiagnosticStatus(worstDiagnostic, turnDiagnostic);
    }

    return { total, perTurn, overallDiagnostic: worstDiagnostic };
  }

  private _deriveToolCalls(): AccumulatedToolCalls {
    const calls: ToolCallRecord[] = [];

    // Collect tool_use events, and pair with following tool_result events
    for (let i = 0; i < this._events.length; i++) {
      const event = this._events[i];
      if (event.type === "tool_use" && event.toolCall) {
        const record: ToolCallRecord = {
          turn: event.turn,
          tool: event.toolCall.tool,
          input: event.toolCall.input,
          output: "",
          durationMs: 0,
        };

        // Look ahead for a matching tool_result
        for (let j = i + 1; j < this._events.length; j++) {
          const next = this._events[j];
          if (next.type === "tool_result" && next.toolResult) {
            // Match by tool name or assume sequential pairing
            if (next.toolResult.tool === event.toolCall.tool || next.toolResult.tool === "") {
              record.output = next.toolResult.output.slice(0, 2000);
              record.durationMs = next.toolResult.durationMs;
              break;
            }
          }
          // Stop looking if we hit another tool_use (next invocation)
          if (next.type === "tool_use") break;
        }

        calls.push(record);
      }
    }

    return { count: calls.length, calls };
  }

  private _deriveAssistantText(): string[] {
    const texts: string[] = [];
    for (const event of this._events) {
      if (event.type === "assistant" && event.text) {
        texts.push(event.text);
      }
    }
    return texts;
  }

  private _deriveCompletionSummary(): string | undefined {
    // Use the last completion event's summary
    for (let i = this._events.length - 1; i >= 0; i--) {
      const event = this._events[i];
      if (event.type === "completion" && event.completionSummary) {
        return event.completionSummary;
      }
    }
    return undefined;
  }

  private _deriveFailures(): AccumulatedFailure[] {
    const failures: AccumulatedFailure[] = [];
    for (const event of this._events) {
      if (event.type === "failure" && event.failure) {
        failures.push({
          category: event.failure.category,
          message: event.failure.message,
          ...(event.failure.vendorDetail ? { vendorDetail: event.failure.vendorDetail } : {}),
        });
      }
    }
    return failures;
  }
}

/**
 * Return the worse of two diagnostic statuses.
 * Ordering: unavailable > partial > complete
 */
function worstDiagnosticStatus(
  a: TokenDiagnosticStatus,
  b: TokenDiagnosticStatus,
): TokenDiagnosticStatus {
  const order: Record<TokenDiagnosticStatus, number> = {
    complete: 0,
    partial: 1,
    unavailable: 2,
  };
  return order[a] >= order[b] ? a : b;
}

// ── Legacy types & parsers (deprecated) ───────────────────────────────────

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
    case "item.started": {
      const item = event.item as Record<string, unknown> | undefined;
      if (!item) return false;

      const itemType = typeof item.type === "string" ? item.type : undefined;
      if (itemType === "command_execution" && typeof item.command === "string") {
        stream("Tool", `shell(${JSON.stringify({ command: item.command }).slice(0, 100)})`);
        result.toolCalls.push({
          turn: turnCounter.value || 1,
          tool: "shell",
          input: { command: item.command },
          output: "",
          durationMs: 0,
        });
        return true;
      }

      return false;
    }

    case "item.completed": {
      const item = event.item as Record<string, unknown> | undefined;
      if (!item) return false;

      const itemType = typeof item.type === "string" ? item.type : undefined;
      if (itemType === "agent_message" && typeof item.text === "string") {
        turnCounter.value++;
        stream("Agent", item.text);
        result.summary = item.text.slice(0, MAX_SUMMARY_LENGTH);
        return true;
      }

      if (itemType === "command_execution") {
        const output =
          (typeof item.output === "string" && item.output) ||
          (typeof item.stdout === "string" && item.stdout) ||
          (typeof item.result === "string" && item.result) ||
          (typeof item.text === "string" && item.text) ||
          "";
        if (result.toolCalls.length > 0) {
          result.toolCalls[result.toolCalls.length - 1].output = output.slice(0, 2000);
        }
        const preview = output.slice(0, 200);
        if (preview) {
          stream("Result", `${preview}${output.length > 200 ? "..." : ""}`);
        }
        return true;
      }

      return false;
    }

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

    case "turn.failed": {
      const error = event.error as Record<string, unknown> | undefined;
      result.error =
        (error && typeof error.message === "string" ? error.message : undefined) ||
        (event.message as string) ||
        "Unknown error";
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
