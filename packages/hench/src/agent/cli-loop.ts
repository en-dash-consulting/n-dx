import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { PRDStore } from "rex/dist/store/types.js";
import type { HenchConfig, RunRecord, ToolCallRecord } from "../schema/index.js";
import { assembleTaskBrief, formatTaskBrief } from "./brief.js";
import { buildSystemPrompt } from "./prompt.js";
import { saveRun } from "../store/index.js";
import { toolRexUpdateStatus, toolRexAppendLog } from "../tools/rex.js";

export interface CliLoopOptions {
  config: HenchConfig;
  store: PRDStore;
  projectDir: string;
  henchDir: string;
  taskId?: string;
  dryRun?: boolean;
  model?: string;
}

export interface CliLoopResult {
  run: RunRecord;
}

const MAX_SUMMARY_LENGTH = 500;

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
    console.log(line);
    return;
  }

  const type = event.type as string | undefined;

  switch (type) {
    case "assistant": {
      turnCounter.value++;

      // Extract text from message — may be a string, object with content blocks, or absent
      const message = event.message;
      if (typeof message === "string") {
        console.log(`[Agent] ${message}`);
        result.summary = message.slice(0, MAX_SUMMARY_LENGTH);
      } else if (message && typeof message === "object") {
        const msg = message as Record<string, unknown>;
        const blocks = msg.content as Array<{ type: string; text?: string }> | undefined;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (block.type === "text" && block.text) {
              console.log(`[Agent] ${block.text}`);
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
            console.log(`[Agent] ${block.text}`);
            result.summary = block.text.slice(0, MAX_SUMMARY_LENGTH);
          }
        }
      }
      break;
    }

    case "tool_use": {
      const toolName = (event.tool as string) || (event.name as string) || "unknown";
      const toolInput = (event.input as Record<string, unknown>) || {};
      console.log(`  [Tool] ${toolName}(${JSON.stringify(toolInput).slice(0, 100)})`);
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
      console.log(`  [Result] ${preview}${output.length > 200 ? "..." : ""}`);
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
          "claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code",
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

  const { brief, taskId } = await assembleTaskBrief(store, opts.taskId);
  const briefText = formatTaskBrief(brief);
  const systemPrompt = buildSystemPrompt(brief.project, config);

  if (dryRun) {
    console.log("=== DRY RUN (CLI) ===");
    console.log("\n--- System Prompt ---");
    console.log(systemPrompt);
    console.log("\n--- Task Brief ---");
    console.log(briefText);
    console.log("\n--- Provider ---");
    console.log("cli (claude binary)");

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

  try {
    const args = [
      "-p", briefText,
      "--output-format", "stream-json",
      "--verbose",
      "--system-prompt", systemPrompt,
      "--dangerously-skip-permissions",
    ];

    // Only pass --model if explicitly overridden; otherwise let claude CLI use its default
    if (opts.model) {
      args.push("--model", opts.model);
    }

    console.log(`[CLI] Spawning claude${opts.model ? ` (model: ${opts.model})` : ""}...`);

    const result = await spawnClaude(args, projectDir);

    run.turns = result.turns;
    run.toolCalls = result.toolCalls;
    run.tokenUsage = result.tokenUsage;
    run.status = result.error ? "failed" : "completed";
    run.summary = result.summary;
    run.error = result.error;

    // Update rex status based on outcome
    const newStatus = run.status === "completed" ? "completed" : "deferred";
    await toolRexUpdateStatus(store, taskId, { status: newStatus });
    await toolRexAppendLog(store, taskId, {
      event: run.status === "completed" ? "task_completed" : "task_failed",
      detail: run.summary || run.error,
    });
  } catch (err) {
    run.status = "failed";
    run.error = (err as Error).message;
    console.error(`[Error] ${run.error}`);

    await toolRexAppendLog(store, taskId, {
      event: "task_failed",
      detail: run.error,
    });
  }

  run.finishedAt = new Date().toISOString();
  await saveRun(henchDir, run);

  return { run };
}
