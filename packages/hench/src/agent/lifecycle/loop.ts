import Anthropic from "@anthropic-ai/sdk";
import type { PRDStore } from "../../prd/rex-gateway.js";
import type { HenchConfig, RunRecord, TurnTokenUsage } from "../../schema/index.js";
import { GuardRails } from "../../guard/index.js";
import { TOOL_DEFINITIONS, dispatchTool } from "../../tools/dispatch.js";
import type { ToolContext } from "../../tools/contracts.js";
import { rexToolHandlers } from "../../tools/rex.js";
import { saveRun } from "../../store/runs.js";
import { section, subsection, stream, detail } from "../../types/output.js";
import { SystemMemoryMonitor } from "../../process/memory-monitor.js";
import {
  loadClaudeConfig,
  loadLLMConfig,
  resolveApiKey,
  resolveLLMVendor,
} from "../../store/project-config.js";
import { resolveModel, defaultRegistry, DEFAULT_EXECUTION_POLICY } from "../../prd/llm-gateway.js";
import type { LLMProvider } from "../../prd/llm-gateway.js";
import { checkTokenBudget } from "./token-budget.js";
import { parseTokenUsage } from "./token-usage.js";
import { startHeartbeat } from "./heartbeat.js";
import { updateEmptyTurnCount, DEFAULT_SPIN_THRESHOLD } from "../analysis/spin.js";
import {
  prepareBrief,
  executeDryRun,
  transitionToInProgress,
  initRunRecord,
  captureStartingHead,
  runReviewGate,
  finalizeRun,
  handleRunFailure,
  handleBudgetExceeded,
  formatModelLabel,
} from "./shared.js";
import type { SharedLoopOptions } from "./shared.js";

export interface AgentLoopOptions extends SharedLoopOptions {
  maxTurns?: number;
  /** Total token budget per run (input + output). Overrides config. */
  tokenBudget?: number;
}

export interface AgentLoopResult {
  run: RunRecord;
}

const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 529]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_CONTEXT_PAIRS = 20;
const MAX_SUMMARY_LENGTH = 500;
const MAX_TOOL_OUTPUT_STORED = 2000;

// ---------------------------------------------------------------------------
// Extracted helpers — each handles one focused concern within the turn loop
// ---------------------------------------------------------------------------

async function callWithRetry(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      lastError = err as Error;
      const status = (err as { status?: number }).status;

      if (status && RETRY_STATUS_CODES.has(status) && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        stream("Retry", `API returned ${status}, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

function pruneMessages(messages: Anthropic.MessageParam[]): void {
  // Keep first message (the task brief) and last MAX_CONTEXT_PAIRS turn-pairs.
  // Turn-pairs are (assistant, user) so each pair = 2 messages.
  const maxKeep = 1 + MAX_CONTEXT_PAIRS * 2;

  if (messages.length <= maxKeep) return;

  const removed = messages.length - maxKeep;
  messages.splice(1, removed);
  detail(`Pruned ${removed} messages to stay within token budget`);
}

/** Resolved API resources needed for the agent turn loop. */
interface ApiResources {
  client: Anthropic;
  /** Resolved LLM provider from the registry. */
  provider: LLMProvider;
  vendor: string;
  toolCtx: ToolContext;
}

/**
 * Initialize API resources from a resolved LLM provider.
 *
 * Accepts any {@link LLMProvider} from the registry. Currently the API loop
 * requires the raw Anthropic SDK for its multi-turn tool-use pattern, so
 * only Claude-compatible providers are supported. Non-Claude providers will
 * be supported when the loop is refactored to use the generic LLMProvider
 * completion interface with tool schemas.
 */
async function initApiResources(
  provider: LLMProvider,
  config: HenchConfig,
  henchDir: string,
  projectDir: string,
  store: PRDStore,
  taskId: string,
  testCommand: string | undefined,
  startingHead: string | undefined,
): Promise<ApiResources> {
  const vendor = provider.info.vendor;

  // The API loop currently requires the raw Anthropic SDK for multi-turn
  // tool-use. Non-Claude providers will be supported when the loop is
  // refactored to use LLMProvider.complete() with tool schemas.
  if (vendor !== "claude") {
    throw new Error(
      `Hench API loop requires a Claude-compatible provider (got "${vendor}"). ` +
      "Non-Claude API providers are not yet supported. Use provider=cli for non-Claude vendors.",
    );
  }

  const claudeConfig = await loadClaudeConfig(henchDir);
  const apiKey = resolveApiKey(claudeConfig, config.apiKeyEnv);
  if (!apiKey) {
    throw new Error(
      `API key not found. Set it via 'n-dx config claude.api_key <key>' or the ${config.apiKeyEnv} environment variable.`,
    );
  }

  const anthropicOpts: Record<string, unknown> = { apiKey };
  if (claudeConfig.api_endpoint) {
    anthropicOpts.baseURL = claudeConfig.api_endpoint;
  }
  const client = new Anthropic(anthropicOpts as ConstructorParameters<typeof Anthropic>[0]);

  const guard = new GuardRails(projectDir, config.guard);
  const memoryMonitor = new SystemMemoryMonitor(config.guard.memoryMonitor);

  const toolCtx: ToolContext = {
    guard,
    projectDir,
    store,
    taskId,
    testCommand,
    startingHead,
    memoryMonitor,
    selfHeal: config.selfHeal,
  };

  return { client, provider, vendor, toolCtx };
}

/**
 * Parse the API response usage and accumulate into both the run-level
 * totals and the per-turn breakdown array.
 */
function recordTurnTokenUsage(
  run: RunRecord,
  rawUsage: Record<string, unknown>,
  turn: number,
  vendor: string,
  model: string,
): void {
  const parsed = parseTokenUsage(rawUsage);

  // Accumulate into run totals
  run.tokenUsage.input += parsed.input;
  run.tokenUsage.output += parsed.output;
  if (parsed.cacheCreationInput) {
    run.tokenUsage.cacheCreationInput = (run.tokenUsage.cacheCreationInput ?? 0) + parsed.cacheCreationInput;
  }
  if (parsed.cacheReadInput) {
    run.tokenUsage.cacheReadInput = (run.tokenUsage.cacheReadInput ?? 0) + parsed.cacheReadInput;
  }

  // Per-turn breakdown
  const turnUsage: TurnTokenUsage = {
    turn,
    input: parsed.input,
    output: parsed.output,
    vendor,
    model,
  };
  if (parsed.cacheCreationInput) turnUsage.cacheCreationInput = parsed.cacheCreationInput;
  if (parsed.cacheReadInput) turnUsage.cacheReadInput = parsed.cacheReadInput;
  run.turnTokenUsage!.push(turnUsage);
}

/**
 * Dispatch all tool_use blocks in the assistant response, record results
 * in the run, and return the tool result messages for the next turn.
 */
async function executeToolCalls(
  assistantContent: Anthropic.ContentBlock[],
  toolCtx: ToolContext,
  turn: number,
  run: RunRecord,
): Promise<Anthropic.ToolResultBlockParam[]> {
  const toolResults: Anthropic.ToolResultBlockParam[] = [];

  for (const block of assistantContent) {
    if (block.type !== "tool_use") continue;

    const startMs = Date.now();
    stream("Tool", `${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);

    const output = await dispatchTool(
      toolCtx,
      block.name,
      block.input as Record<string, unknown>,
      rexToolHandlers,
    );

    const durationMs = Date.now() - startMs;

    run.toolCalls.push({
      turn,
      tool: block.name,
      input: block.input as Record<string, unknown>,
      output: output.slice(0, MAX_TOOL_OUTPUT_STORED),
      durationMs,
    });

    toolResults.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: output,
    });

    stream("Result", `${output.slice(0, 200)}${output.length > 200 ? "..." : ""}`);
    detail(`${durationMs}ms`);
  }

  return toolResults;
}

/**
 * Extract a summary from the last text block of the assistant response
 * (used when stop_reason is "end_turn").
 */
function extractEndTurnSummary(assistantContent: Anthropic.ContentBlock[]): string | undefined {
  for (const block of [...assistantContent].reverse()) {
    if (block.type === "text") {
      return block.text.slice(0, MAX_SUMMARY_LENGTH);
    }
  }
  return undefined;
}

/** Print text blocks from the assistant response. */
function streamAssistantText(assistantContent: Anthropic.ContentBlock[], label: string): void {
  for (const block of assistantContent) {
    if (block.type === "text" && block.text) {
      stream(label, block.text);
    }
  }
}

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

export async function agentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const { config, store, projectDir, henchDir, dryRun } = opts;
  const maxTurns = opts.maxTurns ?? config.maxTurns;
  const tokenBudget = opts.tokenBudget ?? config.tokenBudget;
  const model = resolveModel(opts.model ?? config.model);

  // Shared: assemble brief, format, build system prompt, display task info
  const { brief, taskId, briefText, systemPrompt } = await prepareBrief(
    store, config, opts.taskId,
    { excludeTaskIds: opts.excludeTaskIds, epicId: opts.epicId },
    { priorAttempts: opts.priorAttempts, runHistory: opts.runHistory },
    opts.extraContext,
  );

  // Shared: dry run path
  if (dryRun) {
    const run = executeDryRun({
      label: "",
      briefText,
      systemPrompt,
      taskId,
      taskTitle: brief.task.title,
      model,
      extraInfo: [{ heading: "Tools", content: TOOL_DEFINITIONS.map((t) => t.name).join(", ") }],
      invocationContext: "api",
    });
    return { run };
  }

  // Shared: transition task to in_progress
  await transitionToInProgress(store, taskId, brief.task.status);

  // API-specific: resolve provider, API key, build client and tool context
  const startingHead = captureStartingHead(projectDir);

  // Resolve provider — registry or legacy path based on config flag
  const llmConfig = await loadLLMConfig(henchDir);
  let provider: LLMProvider;

  if (config.useRegistryProvider) {
    // New path: ProviderRegistry resolution
    provider = defaultRegistry.getActiveProvider(llmConfig);
  } else {
    // Legacy path: manual vendor check with original error message
    const legacyVendor = resolveLLMVendor(llmConfig);
    if (legacyVendor !== "claude") {
      throw new Error(
        `Hench API mode requires llm.vendor=claude. Current vendor: ${legacyVendor}. ` +
        "Use provider=cli for Codex.",
      );
    }
    provider = defaultRegistry.create("claude", llmConfig);
  }

  const { client, vendor, toolCtx } = await initApiResources(
    provider, config, henchDir, projectDir, store, taskId,
    brief.project.testCommand, startingHead,
  );

  // Shared: initialize run record + capture start memory snapshot
  const { run, memoryCtx } = await initRunRecord({
    taskId,
    taskTitle: brief.task.title,
    model,
    henchDir,
    vendor,
    sandbox: DEFAULT_EXECUTION_POLICY.sandbox,
    approvals: DEFAULT_EXECUTION_POLICY.approvals,
    parseMode: "api-sdk",
    invocationContext: "api",
  });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: briefText },
  ];

  section(`Agent Run (${model})`);

  // Start heartbeat — writes lastActivityAt to disk periodically so long-running
  // tool calls don't make the run appear stale to the web dashboard.
  const heartbeat = startHeartbeat(henchDir, run);

  // API-specific: turn-based execution loop
  let consecutiveEmptyTurns = 0;

  // Register SIGINT handler for graceful cancellation
  let cancelled = false;
  const handleSignal = () => {
    if (cancelled) {
      // Second Ctrl+C: force exit
      process.exit(1);
    }
    cancelled = true;
  };
  process.on("SIGINT", handleSignal);

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      // Check if cancellation was requested
      if (cancelled) {
        run.status = "cancelled";
        stream("Cancelled", "Run interrupted by user");
        break;
      }

      run.turns = turn + 1;

      subsection(`Turn ${turn + 1}/${maxTurns}`);

      pruneMessages(messages);

      const response = await callWithRetry(client, {
        model,
        max_tokens: config.maxTokens,
        system: systemPrompt,
        tools: TOOL_DEFINITIONS,
        messages,
      });

      // Track token usage for this turn
      recordTurnTokenUsage(run, response.usage as unknown as Record<string, unknown>, turn + 1, vendor, model);

      // Shared: check token budget
      const budgetCheck = checkTokenBudget(run.tokenUsage, tokenBudget);
      if (budgetCheck.exceeded) {
        await handleBudgetExceeded(store, taskId, run, budgetCheck.totalUsed, budgetCheck.budget);
        break;
      }

      // Process response content
      const assistantContent = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      streamAssistantText(assistantContent, formatModelLabel(model));

      // Handle stop reasons
      if (response.stop_reason === "end_turn") {
        run.status = "completed";
        run.summary = extractEndTurnSummary(assistantContent);
        break;
      }

      // Spin detection: abort if too many consecutive turns without tool calls
      const hasToolUse = assistantContent.some((b) => b.type === "tool_use");
      consecutiveEmptyTurns = updateEmptyTurnCount(consecutiveEmptyTurns, hasToolUse);

      if (consecutiveEmptyTurns >= DEFAULT_SPIN_THRESHOLD) {
        run.status = "failed";
        run.error = `Agent spin detected: ${consecutiveEmptyTurns} consecutive turns without tool calls.`;
        stream("Warning", run.error);
        await handleRunFailure(store, taskId, "deferred", "spin_detected", run.error);
        break;
      }

      if (response.stop_reason === "max_tokens") {
        stream("Warning", "Response truncated (max_tokens). Continuing...");
        messages.push({
          role: "user",
          content: "Your response was truncated due to length. Please continue where you left off. If you were in the middle of a tool call, please retry it.",
        });
        continue;
      }

      if (response.stop_reason !== "tool_use") {
        run.status = "completed";
        break;
      }

      // Process tool calls
      const toolResults = await executeToolCalls(assistantContent, toolCtx, turn + 1, run);
      messages.push({ role: "user", content: toolResults });

      // Save progress periodically
      run.lastActivityAt = new Date().toISOString();
      await saveRun(henchDir, run);
    }

    if (run.status === "running") {
      run.status = "timeout";
      run.error = `Exceeded max turns (${maxTurns})`;

      await handleRunFailure(store, taskId, "deferred", "task_failed", run.error);
    }
  } catch (err) {
    run.status = "failed";
    run.error = (err as Error).message;
    console.error(`[Error] ${run.error}`);

    await handleRunFailure(store, taskId, "deferred", "task_failed", run.error);
  } finally {
    // Remove SIGINT handler to restore default behavior
    process.removeListener("SIGINT", handleSignal);
  }

  // Stop heartbeat before finalization
  heartbeat.stop();

  // Shared: review gate
  if (opts.review && run.status === "completed") {
    await runReviewGate(projectDir, store, taskId, run);
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
