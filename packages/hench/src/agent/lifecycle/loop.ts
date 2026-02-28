import Anthropic from "@anthropic-ai/sdk";
import type { PRDStore } from "rex";
import type { HenchConfig, RunRecord, TurnTokenUsage } from "../../schema/index.js";
import { GuardRails } from "../../guard/index.js";
import { TOOL_DEFINITIONS, dispatchTool } from "../../tools/dispatch.js";
import type { ToolContext } from "../../tools/contracts.js";
import { rexToolHandlers } from "../../tools/rex.js";
import { saveRun } from "../../store/index.js";
import { section, subsection, stream, detail } from "../../types/output.js";
import { SystemMemoryMonitor } from "../../process/memory-monitor.js";
import {
  loadClaudeConfig,
  loadLLMConfig,
  resolveApiKey,
  resolveLLMVendor,
} from "../../store/project-config.js";
import { resolveModel } from "@n-dx/llm-client";
import { checkTokenBudget } from "./token-budget.js";
import { parseTokenUsage } from "./token-usage.js";
import { startHeartbeat } from "./heartbeat.js";
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

export async function agentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const { config, store, projectDir, henchDir, dryRun } = opts;
  const maxTurns = opts.maxTurns ?? config.maxTurns;
  const tokenBudget = opts.tokenBudget ?? config.tokenBudget;
  const model = resolveModel(opts.model ?? config.model);

  // Shared: assemble brief, format, build system prompt, display task info
  const { brief, taskId, briefText, systemPrompt } = await prepareBrief(
    store, config, opts.taskId,
    { excludeTaskIds: opts.excludeTaskIds, epicId: opts.epicId },
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
    });
    return { run };
  }

  // Shared: transition task to in_progress
  await transitionToInProgress(store, taskId, brief.task.status);

  // API-specific: resolve API key
  const llmConfig = await loadLLMConfig(henchDir);
  const vendor = resolveLLMVendor(llmConfig);
  if (vendor !== "claude") {
    throw new Error(
      `Hench API mode requires llm.vendor=claude. Current vendor: ${vendor}. ` +
      "Use provider=cli for Codex.",
    );
  }

  const claudeConfig = await loadClaudeConfig(henchDir);
  const apiKey = resolveApiKey(claudeConfig, config.apiKeyEnv);
  if (!apiKey) {
    throw new Error(
      `API key not found. Set it via 'n-dx config claude.api_key <key>' or the ${config.apiKeyEnv} environment variable.`,
    );
  }

  // Shared: capture starting HEAD
  const startingHead = captureStartingHead(projectDir);

  // API-specific: build Anthropic client
  const anthropicOpts: Record<string, unknown> = { apiKey };
  if (claudeConfig.api_endpoint) {
    anthropicOpts.baseURL = claudeConfig.api_endpoint;
  }
  const client = new Anthropic(anthropicOpts as ConstructorParameters<typeof Anthropic>[0]);
  const guard = new GuardRails(projectDir, config.guard);

  // Memory monitor for pre-spawn checks during tool dispatch.
  // Uses platform-specific memory detection (Linux /proc/meminfo, macOS/Windows os module).
  const memoryMonitor = new SystemMemoryMonitor(config.guard.memoryMonitor);

  const toolCtx: ToolContext = {
    guard,
    projectDir,
    store,
    taskId,
    testCommand: brief.project.testCommand,
    startingHead,
    memoryMonitor,
  };

  // Shared: initialize run record + capture start memory snapshot
  const { run, memoryCtx } = await initRunRecord({
    taskId,
    taskTitle: brief.task.title,
    model,
    henchDir,
  });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: briefText },
  ];

  section(`Agent Run (${model})`);

  // Start heartbeat — writes lastActivityAt to disk periodically so long-running
  // tool calls don't make the run appear stale to the web dashboard.
  const heartbeat = startHeartbeat(henchDir, run);

  // API-specific: turn-based execution loop
  try {
    for (let turn = 0; turn < maxTurns; turn++) {
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

      // Track token usage
      const parsed = parseTokenUsage(response.usage as unknown as Record<string, unknown>);
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
        turn: turn + 1,
        input: parsed.input,
        output: parsed.output,
        vendor,
        model,
      };
      if (parsed.cacheCreationInput) turnUsage.cacheCreationInput = parsed.cacheCreationInput;
      if (parsed.cacheReadInput) turnUsage.cacheReadInput = parsed.cacheReadInput;
      run.turnTokenUsage!.push(turnUsage);

      // Shared: check token budget
      const budgetCheck = checkTokenBudget(run.tokenUsage, tokenBudget);
      if (budgetCheck.exceeded) {
        await handleBudgetExceeded(store, taskId, run, budgetCheck.totalUsed, budgetCheck.budget);
        break;
      }

      // Process response content
      const assistantContent = response.content;
      messages.push({ role: "assistant", content: assistantContent });

      // Print text output
      for (const block of assistantContent) {
        if (block.type === "text" && block.text) {
          stream("Agent", block.text);
        }
      }

      // Handle stop reasons
      if (response.stop_reason === "end_turn") {
        run.status = "completed";
        for (const block of [...assistantContent].reverse()) {
          if (block.type === "text") {
            run.summary = block.text.slice(0, MAX_SUMMARY_LENGTH);
            break;
          }
        }
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
          turn: turn + 1,
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
  });

  return { run };
}
