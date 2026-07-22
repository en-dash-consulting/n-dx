import Anthropic from "@anthropic-ai/sdk";
import type { PRDStore } from "../../prd/rex-gateway.js";
import type { HenchConfig, RunRecord, TurnTokenUsage } from "../../schema/index.js";
import { GuardRails } from "../../guard/index.js";
import { TOOL_DEFINITIONS, TOOL_DEFINITIONS_GEMINI, dispatchTool } from "../../tools/dispatch.js";
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
import { resolveModel, defaultRegistry, DEFAULT_EXECUTION_POLICY, classifyLLMError, getNextFailoverAttempt } from "../../prd/llm-gateway.js";
import type {
  LLMProvider,
  GeminiToolProvider,
  GeminiContent,
  GeminiPart,
} from "../../prd/llm-gateway.js";
import type { TokenUsage } from "../../schema/index.js";
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
  captureBaselineUntracked,
  runReviewGate,
  finalizeRun,
  handleRunFailure,
  handleBudgetExceeded,
  formatModelLabel,
} from "./shared.js";
import type { SharedLoopOptions } from "./shared.js";
import {
  detectPlanOnlyIteration,
  createExecutionReminder,
} from "../analysis/plan-only-detection.js";

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

/**
 * Failover-aware LLM invocation wrapper.
 *
 * When llm.autoFailover is enabled and a retryable error occurs (rate-limit,
 * server, network, timeout), walks the vendor/model failover chain before
 * surfacing the error. Preserves the original error verbatim for rethrow
 * after exhaustion to maintain byte-identical error messaging.
 *
 * Non-retryable errors (auth, budget, parse, unknown) bypass failover and
 * surface immediately. When autoFailover is disabled, this is a no-op
 * (calls callWithRetry directly).
 */
async function callWithFailover(
  currentClient: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  config: HenchConfig,
  originalVendor: string,
  originalModel: string,
  henchDir: string,
  llmConfig: Awaited<ReturnType<typeof loadLLMConfig>>,
  projectDir: string,
  store: PRDStore,
  taskId: string,
  testCommand: string | undefined,
  startingHead: string | undefined,
): Promise<Anthropic.Message> {
  let client = currentClient;
  let currentVendor = originalVendor;
  let currentModel = originalModel;

  try {
    return await callWithRetry(client, params);
  } catch (originalError) {
    // If failover is disabled, rethrow immediately (no-op path)
    if (!llmConfig.autoFailover) {
    throw originalError;
    }

    const err = originalError as Error;
    const classification = classifyLLMError(err, originalVendor as any);

    // Non-retryable errors: auth, budget, parse, unknown
    // These bypass failover and surface immediately
    const nonRetryableCategories: Set<string> = new Set(["auth", "budget", "parse", "unknown"]);
    if (nonRetryableCategories.has(classification.category)) {
      throw originalError;
    }

    // Retryable errors: rate-limit, server, network, timeout
    // Walk the failover chain and try each vendor/model combination
    let attemptNumber = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const failoverResult = getNextFailoverAttempt(attemptNumber, originalVendor as any, llmConfig);

      if (failoverResult.isExhausted) {
        // Chain exhausted: restore original and rethrow the original error verbatim
        throw originalError;
      }

      // Get next vendor/model from failover chain
      const nextVendor = failoverResult.vendor;
      const nextModel = failoverResult.model;

      if (!nextVendor || !nextModel) {
        // Safeguard: shouldn't happen if isExhausted is checked above
        throw originalError;
      }

      // Emit failover log line with colored output
      const shortModel = (str: string) => str.split("/").pop() || str;
      const logMsg = `[failover] ${currentVendor}/${shortModel(currentModel)} → ${nextVendor}/${shortModel(nextModel)}: ${classification.category}`;
      stream("Failover", logMsg);

      try {
        // Recreate client for the new vendor
        const provider = defaultRegistry.create(nextVendor as any, llmConfig);
        const apiResources = await initApiResources(
          provider, config, henchDir, projectDir, store, taskId,
          testCommand, startingHead,
        );
        client = apiResources.client;
        currentVendor = apiResources.vendor;
        currentModel = nextModel;

        // Update params with new model
        const updatedParams = { ...params, model: nextModel };

        // Try the call with the new client/model
        return await callWithRetry(client, updatedParams);
      } catch (failoverError) {
        // This failover attempt failed; continue to next in chain
        attemptNumber++;
      }
    }
  }
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
// Gemini tool-loop helpers — Gemini speaks `contents`/`functionCall` rather
// than Anthropic content blocks, so the Anthropic-typed helpers above cannot
// be reused. These mirror them for the Gemini agentic loop.
// ---------------------------------------------------------------------------

/**
 * Build the tool context for a Gemini run (GuardRails + memory monitor).
 *
 * Sibling of {@link initApiResources} that omits the Anthropic client — the
 * Gemini loop drives the provider's `generateContentWithTools` directly, so it
 * needs only the shared {@link ToolContext} for guarded tool dispatch.
 */
function initGoogleApiResources(
  config: HenchConfig,
  projectDir: string,
  store: PRDStore,
  taskId: string,
  testCommand: string | undefined,
  startingHead: string | undefined,
): ToolContext {
  const guard = new GuardRails(projectDir, config.guard);
  const memoryMonitor = new SystemMemoryMonitor(config.guard.memoryMonitor);

  return {
    guard,
    projectDir,
    store,
    taskId,
    testCommand,
    startingHead,
    memoryMonitor,
    selfHeal: config.selfHeal,
  };
}

/**
 * Accumulate a pre-parsed {@link TokenUsage} into run totals and the per-turn
 * breakdown.
 *
 * Gemini reports `promptTokenCount`/`candidatesTokenCount` (already normalized
 * to `input`/`output` by `parseGeminiTokenUsage` inside the provider), so —
 * unlike {@link recordTurnTokenUsage} — this variant takes the normalized
 * usage directly rather than re-parsing Anthropic-shaped `input_tokens` keys.
 */
function recordTurnTokenUsageNormalized(
  run: RunRecord,
  usage: TokenUsage | undefined,
  turn: number,
  vendor: string,
  model: string,
): void {
  if (!usage) return;

  run.tokenUsage.input += usage.input;
  run.tokenUsage.output += usage.output;
  if (usage.cacheCreationInput) {
    run.tokenUsage.cacheCreationInput = (run.tokenUsage.cacheCreationInput ?? 0) + usage.cacheCreationInput;
  }
  if (usage.cacheReadInput) {
    run.tokenUsage.cacheReadInput = (run.tokenUsage.cacheReadInput ?? 0) + usage.cacheReadInput;
  }

  const turnUsage: TurnTokenUsage = {
    turn,
    input: usage.input,
    output: usage.output,
    vendor,
    model,
  };
  if (usage.cacheCreationInput) turnUsage.cacheCreationInput = usage.cacheCreationInput;
  if (usage.cacheReadInput) turnUsage.cacheReadInput = usage.cacheReadInput;
  run.turnTokenUsage!.push(turnUsage);
}

/**
 * Dispatch each Gemini functionCall through the shared tool dispatcher, record
 * results in the run, and return one `functionResponse` part per call to feed
 * back as the next `"user"` turn.
 *
 * Gemini equivalent of {@link executeToolCalls} — same dispatch/recording, but
 * returns {@link GeminiPart} function responses instead of Anthropic tool_result
 * blocks.
 */
async function executeGeminiFunctionCalls(
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>,
  toolCtx: ToolContext,
  turn: number,
  run: RunRecord,
): Promise<GeminiPart[]> {
  const responses: GeminiPart[] = [];

  for (const fc of functionCalls) {
    const startMs = Date.now();
    stream("Tool", `${fc.name}(${JSON.stringify(fc.args).slice(0, 100)})`);

    const output = await dispatchTool(toolCtx, fc.name, fc.args, rexToolHandlers);

    const durationMs = Date.now() - startMs;

    run.toolCalls.push({
      turn,
      tool: fc.name,
      input: fc.args,
      output: output.slice(0, MAX_TOOL_OUTPUT_STORED),
      durationMs,
    });

    responses.push({ functionResponse: { name: fc.name, response: { result: output } } });

    stream("Result", `${output.slice(0, 200)}${output.length > 200 ? "..." : ""}`);
    detail(`${durationMs}ms`);
  }

  return responses;
}

/** Prune Gemini conversation history (keep brief + last MAX_CONTEXT_PAIRS pairs). */
function pruneGeminiContents(contents: GeminiContent[]): void {
  const maxKeep = 1 + MAX_CONTEXT_PAIRS * 2;
  if (contents.length <= maxKeep) return;

  const removed = contents.length - maxKeep;
  contents.splice(1, removed);
  detail(`Pruned ${removed} turns to stay within token budget`);
}

/** Parameters for the Gemini agentic tool-use loop. */
interface GeminiToolLoopParams {
  provider: GeminiToolProvider;
  config: HenchConfig;
  model: string;
  systemPrompt: string | undefined;
  briefText: string;
  taskTitle: string;
  testCommand: string | undefined;
  taskId: string;
  henchDir: string;
  projectDir: string;
  store: PRDStore;
  maxTurns: number;
  tokenBudget: number | undefined;
  startingHead: string | undefined;
  /** Untracked files present before the run, for scoped rollback (#303). */
  baselineUntracked: string[];
  opts: AgentLoopOptions;
}

/**
 * Gemini agentic tool-use loop.
 *
 * Mirrors the Claude API loop's lifecycle (run record, heartbeat, SIGINT
 * cancellation, budget checks, review gate, finalization) but speaks Gemini's
 * `contents`/`functionCall` protocol. Each turn sends the full conversation
 * plus tool declarations; functionCalls are dispatched through the shared
 * {@link dispatchTool} and their results fed back as the next user turn. The
 * loop terminates when the model returns no functionCalls (treated as
 * completion), the turn cap is hit, the token budget is exceeded, or the run
 * is cancelled.
 *
 * No cross-vendor failover happens inside this loop in v1 — the Claude
 * failover path (`callWithFailover`) is bound to the Anthropic message format
 * and would require translating `contents` → `MessageParam`. The provider's
 * own retry/backoff (RETRY_STATUS_CODES) covers transient rate-limit/server
 * errors. TODO: wire google→claude failover via getNextFailoverAttempt.
 */
async function runGeminiToolLoop(params: GeminiToolLoopParams): Promise<AgentLoopResult> {
  const {
    provider, config, model, systemPrompt, briefText, taskTitle, testCommand,
    taskId, henchDir, projectDir, store, maxTurns, tokenBudget, startingHead,
    baselineUntracked, opts,
  } = params;

  const hasToolCalling =
    provider.info.capabilities.includes("function-calling") &&
    typeof provider.generateContentWithTools === "function";

  const { run, memoryCtx } = await initRunRecord({
    taskId,
    taskTitle,
    model,
    henchDir,
    vendor: "google",
    sandbox: DEFAULT_EXECUTION_POLICY.sandbox,
    approvals: DEFAULT_EXECUTION_POLICY.approvals,
    parseMode: hasToolCalling ? "gemini-tools" : "provider-api",
    invocationContext: "api",
  });

  section(
    opts.runNumber !== undefined
      ? `Agent Run #${opts.runNumber} (${model}) start`
      : `Agent Run (${model})`,
  );

  const heartbeat = startHeartbeat(henchDir, run);

  // Register SIGINT handler for graceful cancellation (mirrors Claude loop).
  let cancelled = false;
  const handleSignal = () => {
    if (cancelled) process.exit(1);
    cancelled = true;
  };
  process.on("SIGINT", handleSignal);

  try {
    if (!hasToolCalling) {
      // Graceful degradation: single-turn completion when the provider does
      // not support function-calling.
      const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${briefText}` : briefText;
      stream("Gemini", "Sending prompt to Gemini API...");
      const completionResult = await provider.complete({ prompt: fullPrompt, model });
      run.status = "completed";
      run.turns = 1;
      run.summary = completionResult.text?.slice(0, MAX_SUMMARY_LENGTH);
      recordTurnTokenUsageNormalized(run, completionResult.tokenUsage, 1, "google", model);
      stream(formatModelLabel(model), completionResult.text ?? "");
    } else {
      const toolCtx = initGoogleApiResources(
        config, projectDir, store, taskId, testCommand, startingHead,
      );
      const tools = [{ functionDeclarations: TOOL_DEFINITIONS_GEMINI }];
      const contents: GeminiContent[] = [
        { role: "user", parts: [{ text: briefText }] },
      ];

      for (let turn = 0; turn < maxTurns; turn++) {
        if (cancelled) {
          run.status = "cancelled";
          stream("Cancelled", "Run interrupted by user");
          break;
        }

        run.turns = turn + 1;
        subsection(`Turn ${turn + 1}/${maxTurns}`);

        pruneGeminiContents(contents);

        const result = await provider.generateContentWithTools({
          model,
          contents,
          tools,
          systemInstruction: systemPrompt,
          maxOutputTokens: config.maxTokens,
        });

        recordTurnTokenUsageNormalized(run, result.usage, turn + 1, "google", model);

        const budgetCheck = checkTokenBudget(run.tokenUsage, tokenBudget);
        if (budgetCheck.exceeded) {
          await handleBudgetExceeded(store, taskId, run, budgetCheck.totalUsed, budgetCheck.budget);
          break;
        }

        // Record the model turn in history.
        contents.push({ role: "model", parts: result.parts });

        if (result.text) {
          stream(formatModelLabel(model), result.text);
        }

        // No function calls → the model is done.
        if (result.functionCalls.length === 0) {
          run.status = "completed";
          run.summary = result.text ? result.text.slice(0, MAX_SUMMARY_LENGTH) : undefined;
          break;
        }

        // Dispatch tools and feed the responses back as the next user turn.
        const responses = await executeGeminiFunctionCalls(
          result.functionCalls, toolCtx, turn + 1, run,
        );
        contents.push({ role: "user", parts: responses });

        run.lastActivityAt = new Date().toISOString();
        await saveRun(henchDir, run);
      }

      if (run.status === "running") {
        run.status = "timeout";
        run.error = `Exceeded max turns (${maxTurns})`;
        await handleRunFailure(store, taskId, "deferred", "task_failed", run.error);
      }
    }
  } catch (err) {
    run.status = "failed";
    run.error = (err as Error).message;
    console.error(`[Error] ${run.error}`);
    await handleRunFailure(store, taskId, "deferred", "task_failed", run.error);
  } finally {
    process.removeListener("SIGINT", handleSignal);
  }

  heartbeat.stop();

  if (opts.review && run.status === "completed") {
    await runReviewGate(projectDir, store, taskId, run, {
      rollbackOnFailure: opts.rollbackOnFailure,
      yes: opts.yes,
      baselineUntracked,
    });
  }

  await finalizeRun({
    run,
    henchDir,
    projectDir,
    config,
    testCommand,
    heartbeat,
    memoryCtx,
    selfHeal: config.selfHeal,
    rollbackOnFailure: opts.rollbackOnFailure,
    yes: opts.yes,
    autonomous: opts.autonomous,
    store,
    autoCommit: config.autoCommit === true,
    skipFullTestGate: config.skipFullTestGate,
    baselineUntracked,
  });

  return { run };
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
    { excludeTaskIds: opts.excludeTaskIds, epicId: opts.epicId, tags: opts.tags },
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
  // Snapshot untracked files before the agent runs, so a rollback removes only
  // the files the agent creates — never the user's pre-existing work (#303).
  const baselineUntracked = await captureBaselineUntracked(projectDir);

  // Resolve provider — registry or legacy path based on config flag
  const llmConfig = await loadLLMConfig(henchDir);
  const effectiveVendor = resolveLLMVendor(llmConfig);
  let provider: LLMProvider;

  if (config.useRegistryProvider || effectiveVendor === "google") {
    // New path: ProviderRegistry resolution.
    // Google always uses the registry (it has no legacy API path).
    provider = defaultRegistry.getActiveProvider(llmConfig);
  } else {
    // Legacy path: manual vendor check with original error message
    if (effectiveVendor !== "claude") {
      throw new Error(
        `Hench API mode requires llm.vendor=claude. Current vendor: ${effectiveVendor}. ` +
        "Use provider=cli for Codex.",
      );
    }
    provider = defaultRegistry.create("claude", llmConfig);
  }

  // Google (Gemini) drives a dedicated agentic tool-use loop. The Gemini REST
  // API supports function-calling, so we run a multi-turn loop that mirrors the
  // Claude path below: send `contents` + tool declarations, dispatch any
  // requested functionCalls through the shared dispatcher, feed results back,
  // and loop until the model stops calling tools (or limits are hit). If the
  // provider does not advertise function-calling, it degrades to single-turn.
  if (effectiveVendor === "google") {
    return await runGeminiToolLoop({
      provider: provider as GeminiToolProvider,
      config,
      model,
      systemPrompt,
      briefText,
      taskTitle: brief.task.title,
      testCommand: brief.project.testCommand,
      taskId,
      henchDir,
      projectDir,
      store,
      maxTurns,
      tokenBudget,
      startingHead,
      baselineUntracked,
      opts,
    });
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

  section(
    opts.runNumber !== undefined
      ? `Agent Run #${opts.runNumber} (${model}) start`
      : `Agent Run (${model})`,
  );

  // Start heartbeat — writes lastActivityAt to disk periodically so long-running
  // tool calls don't make the run appear stale to the web dashboard.
  const heartbeat = startHeartbeat(henchDir, run);

  // API-specific: turn-based execution loop
  let consecutiveEmptyTurns = 0;
  let planOnlyRetryCount = 0;
  const planOnlyMaxRetries = config.planOnlyMaxRetries ?? 2;

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

      const response = await callWithFailover(
        client,
        {
          model,
          max_tokens: config.maxTokens,
          system: systemPrompt,
          tools: TOOL_DEFINITIONS,
          messages,
        },
        config,
        vendor,
        model,
        henchDir,
        llmConfig,
        projectDir,
        store,
        taskId,
        brief.project.testCommand,
        startingHead,
      );

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

      // Detect plan-only iterations before handling completion
      const planDetection = detectPlanOnlyIteration(assistantContent);

      // Handle stop reasons
      if (response.stop_reason === "end_turn") {
        // Check for plan-only completion at end_turn
        if (planDetection.isPlanOnly && planOnlyMaxRetries > 0) {
          if (planOnlyRetryCount < planOnlyMaxRetries) {
            planOnlyRetryCount++;
            const summary = extractEndTurnSummary(assistantContent);
            const reminder = createExecutionReminder(summary, planOnlyRetryCount);
            stream("Warning", `Plan without execution detected. Re-prompting to execute (attempt ${planOnlyRetryCount}/${planOnlyMaxRetries})...`);
            messages.push({
              role: "user",
              content: reminder,
            });
            continue;
          } else {
            run.status = "failed";
            run.error = `Plan-only completion: Agent produced a plan but did not execute it after ${planOnlyMaxRetries} re-prompts.`;
            stream("Warning", run.error);
            await handleRunFailure(store, taskId, "deferred", "plan_only_completion", run.error);
            break;
          }
        }

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
        // Check for plan-only completion at non-tool_use stop reasons
        if (planDetection.isPlanOnly && planOnlyMaxRetries > 0) {
          if (planOnlyRetryCount < planOnlyMaxRetries) {
            planOnlyRetryCount++;
            const summary = extractEndTurnSummary(assistantContent);
            const reminder = createExecutionReminder(summary, planOnlyRetryCount);
            stream("Warning", `Plan without execution detected. Re-prompting to execute (attempt ${planOnlyRetryCount}/${planOnlyMaxRetries})...`);
            messages.push({
              role: "user",
              content: reminder,
            });
            continue;
          } else {
            run.status = "failed";
            run.error = `Plan-only completion: Agent produced a plan but did not execute it after ${planOnlyMaxRetries} re-prompts.`;
            stream("Warning", run.error);
            await handleRunFailure(store, taskId, "deferred", "plan_only_completion", run.error);
            break;
          }
        }

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
    await runReviewGate(projectDir, store, taskId, run, {
      rollbackOnFailure: opts.rollbackOnFailure,
      yes: opts.yes,
      baselineUntracked,
    });
  }

  // Shared: finalize run (build summary, memory stats, post-task tests, save)
  await finalizeRun({
    run,
    henchDir,
    projectDir,
    config,
    testCommand: brief.project.testCommand,
    heartbeat,
    memoryCtx,
    selfHeal: config.selfHeal,
    rollbackOnFailure: opts.rollbackOnFailure,
    yes: opts.yes,
    autonomous: opts.autonomous,
    store,
    autoCommit: config.autoCommit === true,
    skipFullTestGate: config.skipFullTestGate,
    baselineUntracked,
  });

  return { run };
}
