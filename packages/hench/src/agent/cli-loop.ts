import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { PRDStore } from "rex/dist/store/types.js";
import type { HenchConfig, RetryConfig, RunRecord, ToolCallRecord } from "../schema/index.js";
import { assembleTaskBrief, formatTaskBrief } from "./brief.js";
import { buildSystemPrompt } from "./prompt.js";
import { saveRun } from "../store/index.js";
import { buildRunSummary } from "./summary.js";
import { toolRexUpdateStatus, toolRexAppendLog } from "../tools/rex.js";
import { validateCompletion, formatValidationResult } from "./completion.js";
import { collectReviewDiff, promptReview, revertChanges } from "./review.js";
import { section, subsection, stream, info } from "../cli/output.js";

export interface CliLoopOptions {
  config: HenchConfig;
  store: PRDStore;
  projectDir: string;
  henchDir: string;
  taskId?: string;
  dryRun?: boolean;
  model?: string;
  /** Show diff and prompt for approval before finalizing. */
  review?: boolean;
  /** Task IDs to skip during autoselection (e.g. stuck tasks). */
  excludeTaskIds?: Set<string>;
}

export interface CliLoopResult {
  run: RunRecord;
}

const MAX_SUMMARY_LENGTH = 500;

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

interface CliRunResult {
  turns: number;
  toolCalls: ToolCallRecord[];
  tokenUsage: { input: number; output: number };
  summary?: string;
  error?: string;
  costUsd?: number;
}

function processStreamLine(
  line: string,
  result: CliRunResult,
  turnCounter: { value: number },
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
            }
          }
        }
      }

      // Also check top-level content (some event shapes put it here)
      const content = event.content as Array<{ type: string; text?: string }> | undefined;
      if (Array.isArray(content) && !event.message) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            stream("Agent", block.text);
            result.summary = block.text.slice(0, MAX_SUMMARY_LENGTH);
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
      break;
    }

    default:
      // Unknown event type — ignore silently
      break;
  }
}

function spawnClaude(
  args: string[],
  cwd: string,
): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const result: CliRunResult = {
      turns: 0,
      toolCalls: [],
      tokenUsage: { input: 0, output: 0 },
    };

    const turnCounter = { value: 0 };
    let lineBuffer = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop()!; // Keep incomplete last line in buffer

      for (const line of lines) {
        processStreamLine(line, result, turnCounter);
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
        processStreamLine(lineBuffer, result, turnCounter);
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

export async function cliLoop(opts: CliLoopOptions): Promise<CliLoopResult> {
  const { config, store, projectDir, henchDir, dryRun } = opts;
  const model = opts.model ?? config.model;

  const { brief, taskId } = await assembleTaskBrief(store, opts.taskId, {
    excludeTaskIds: opts.excludeTaskIds,
  });
  const briefText = formatTaskBrief(brief);
  const systemPrompt = buildSystemPrompt(brief.project, config);

  if (dryRun) {
    section("Dry Run (CLI)");
    subsection("System Prompt");
    info(systemPrompt);
    subsection("Task Brief");
    info(briefText);
    subsection("Provider");
    info("cli (claude binary)");

    const run: RunRecord = {
      id: randomUUID(),
      taskId,
      taskTitle: brief.task.title,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      turns: 0,
      summary: "Dry run — no CLI invocation",
      tokenUsage: { input: 0, output: 0 },
      toolCalls: [],
      model,
    };

    return { run };
  }

  // Mark task in_progress before handing off to CLI
  await toolRexUpdateStatus(store, taskId, { status: "in_progress" });

  const run: RunRecord = {
    id: randomUUID(),
    taskId,
    taskTitle: brief.task.title,
    startedAt: new Date().toISOString(),
    status: "running",
    turns: 0,
    tokenUsage: { input: 0, output: 0 },
    toolCalls: [],
    model,
  };

  await saveRun(henchDir, run);

  const retryConfig: RetryConfig = config.retry ?? {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30000,
  };

  let accumulatedTurns = 0;
  let accumulatedToolCalls: ToolCallRecord[] = [];
  let lastError: string | undefined;

  try {
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      const prompt = attempt === 0
        ? briefText
        : briefText + buildRetryNotice(attempt, retryConfig.maxRetries, accumulatedTurns);

      const args = [
        "-p", prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--system-prompt", systemPrompt,
        "--dangerously-skip-permissions",
      ];

      // Only pass --model if explicitly overridden; otherwise let claude CLI use its default
      if (opts.model) {
        args.push("--model", opts.model);
      }

      section(`Agent Run${opts.model ? ` (${opts.model})` : ""}${attempt > 0 ? ` (retry ${attempt}/${retryConfig.maxRetries})` : ""}`);
      stream("CLI", `Spawning claude${opts.model ? ` (model: ${opts.model})` : ""}...`);

      const result = await spawnClaude(args, projectDir);

      accumulatedTurns += result.turns;
      accumulatedToolCalls = accumulatedToolCalls.concat(result.toolCalls);

      if (!result.error) {
        // Validate completion: require meaningful changes
        const validation = await validateCompletion(projectDir, {
          testCommand: brief.project.testCommand,
        });

        run.turns = accumulatedTurns;
        run.toolCalls = accumulatedToolCalls;
        run.tokenUsage = result.tokenUsage;
        run.retryAttempts = attempt > 0 ? attempt : undefined;

        if (validation.valid) {
          // Review gate — prompt user before finalizing
          if (opts.review) {
            const reviewDiff = await collectReviewDiff(projectDir);
            const reviewResult = await promptReview(reviewDiff);

            if (!reviewResult.approved) {
              run.status = "failed";
              run.summary = result.summary;
              run.error = reviewResult.reason;

              info(`\nChanges rejected — reverting...`);
              await revertChanges(projectDir);

              await toolRexUpdateStatus(store, taskId, { status: "pending" });
              await toolRexAppendLog(store, taskId, {
                event: "review_rejected",
                detail: reviewResult.reason ?? "Changes rejected by reviewer",
              });
              break;
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

          await toolRexUpdateStatus(store, taskId, { status: "pending" });
          await toolRexAppendLog(store, taskId, {
            event: "completion_rejected",
            detail: formatValidationResult(validation),
          });
        }
        break;
      }

      // Error path — check if transient
      lastError = result.error;

      if (!isTransientError(result.error)) {
        // Non-transient error: fail immediately
        run.turns = accumulatedTurns;
        run.toolCalls = accumulatedToolCalls;
        run.tokenUsage = result.tokenUsage;
        run.status = "failed";
        run.summary = result.summary;
        run.error = result.error;
        run.retryAttempts = attempt > 0 ? attempt : undefined;

        await toolRexUpdateStatus(store, taskId, { status: "deferred" });
        await toolRexAppendLog(store, taskId, {
          event: "task_failed",
          detail: run.error,
        });
        break;
      }

      // Transient error
      await toolRexAppendLog(store, taskId, {
        event: "transient_error",
        detail: `Attempt ${attempt + 1}: ${result.error}`,
      });

      if (attempt < retryConfig.maxRetries) {
        const delay = computeDelay(attempt, retryConfig.baseDelayMs, retryConfig.maxDelayMs);
        info(`Transient error on attempt ${attempt + 1}, retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        // Retries exhausted
        run.turns = accumulatedTurns;
        run.toolCalls = accumulatedToolCalls;
        run.tokenUsage = result.tokenUsage;
        run.status = "error_transient";
        run.summary = result.summary;
        run.error = result.error;
        run.retryAttempts = attempt;

        // Revert to pending so it gets auto-picked next run
        await toolRexUpdateStatus(store, taskId, { status: "pending" });
        await toolRexAppendLog(store, taskId, {
          event: "task_transient_exhausted",
          detail: `All ${retryConfig.maxRetries + 1} attempts failed with transient errors. Last: ${result.error}`,
        });
      }
    }
  } catch (err) {
    run.status = "failed";
    run.error = (err as Error).message;
    run.turns = accumulatedTurns;
    run.toolCalls = accumulatedToolCalls;
    console.error(`[Error] ${run.error}`);

    await toolRexAppendLog(store, taskId, {
      event: "task_failed",
      detail: run.error,
    });
  }

  run.structuredSummary = buildRunSummary(run.toolCalls);
  run.finishedAt = new Date().toISOString();
  await saveRun(henchDir, run);

  return { run };
}
