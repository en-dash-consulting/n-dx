import { join } from "node:path";
import { createInterface } from "node:readline";
import { resolveStore } from "rex/dist/store/index.js";
import { loadConfig } from "../../store/index.js";
import { agentLoop } from "../../agent/loop.js";
import { cliLoop } from "../../agent/cli-loop.js";
import { getActionableTasks } from "../../agent/brief.js";
import { HENCH_DIR, safeParseInt } from "./constants.js";
import { CLIError, requireClaudeCLI } from "../errors.js";
import { info, result as output } from "../output.js";

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function selectTask(
  dir: string,
  rexDir: string,
): Promise<string> {
  const store = await resolveStore(rexDir);
  const tasks = await getActionableTasks(store);

  if (tasks.length === 0) {
    output("No actionable tasks found in PRD.");
    process.exit(0);
  }

  info("\nActionable tasks (by priority):\n");
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const pri = `[${t.priority}]`.padEnd(10);
    const chain = t.parentChain ? ` (${t.parentChain})` : "";
    info(`  ${String(i + 1).padStart(2)}. ${pri} ${t.title}${chain}`);
  }
  info("");

  const answer = await promptUser(`Select task [1]: `);
  const idx = answer === "" ? 0 : parseInt(answer, 10) - 1;

  if (isNaN(idx) || idx < 0 || idx >= tasks.length) {
    throw new CLIError(
      "Invalid selection.",
      `Enter a number between 1 and ${tasks.length}.`,
    );
  }

  return tasks[idx].id;
}

async function runOne(
  dir: string,
  henchDir: string,
  rexDir: string,
  provider: "cli" | "api",
  taskId: string | undefined,
  dryRun: boolean,
  model: string | undefined,
  maxTurns: number | undefined,
): Promise<{ status: string }> {
  const config = await loadConfig(henchDir);
  const store = await resolveStore(rexDir);

  const result = provider === "cli"
    ? await cliLoop({
        config: { ...config, provider },
        store,
        projectDir: dir,
        henchDir,
        taskId,
        dryRun,
        model,
      })
    : await agentLoop({
        config: { ...config, provider },
        store,
        projectDir: dir,
        henchDir,
        taskId,
        dryRun,
        maxTurns,
        model,
      });

  const { run } = result;

  info("\n=== Run Complete ===");
  output(`Run ID: ${run.id}`);
  output(`Task: ${run.taskTitle}`);
  output(`Status: ${run.status}`);
  info(`Turns: ${run.turns}`);
  info(`Tokens: ${run.tokenUsage.input} in / ${run.tokenUsage.output} out`);
  info(`Tool calls: ${run.toolCalls.length}`);

  if (run.summary) {
    info(`\nSummary: ${run.summary}`);
  }
  if (run.error) {
    output(`\nError: ${run.error}`);
  }

  return { status: run.status };
}

export async function cmdRun(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);
  const config = await loadConfig(henchDir);
  const rexDir = join(dir, config.rexDir);

  const provider = (flags.provider as "cli" | "api") ?? config.provider;
  const dryRun = flags["dry-run"] === "true";
  const model = flags.model;
  const auto = flags.auto === "true";

  // Fail fast if CLI provider selected but claude binary not available
  if (provider === "cli" && !dryRun) {
    requireClaudeCLI();
  }
  const iterations = flags.iterations ? safeParseInt(flags.iterations, "iterations") : 1;
  const maxTurns = flags["max-turns"] ? safeParseInt(flags["max-turns"], "max-turns") : undefined;

  let taskId = flags.task;

  // Task selection: --task > interactive (TTY) > autoselect
  if (!taskId && !auto && process.stdin.isTTY && !dryRun) {
    taskId = await selectTask(dir, rexDir);
  }
  // If --auto or non-TTY, taskId stays undefined → assembleTaskBrief autoselects

  for (let i = 0; i < iterations; i++) {
    if (iterations > 1) {
      info(`\n=== Iteration ${i + 1}/${iterations} ===`);
    }

    const { status } = await runOne(
      dir, henchDir, rexDir, provider,
      // Only use the explicit taskId for the first iteration;
      // subsequent iterations autoselect the next task
      i === 0 ? taskId : undefined,
      dryRun, model, maxTurns,
    );

    if (status === "failed" || status === "timeout") {
      info(`\nStopping after ${i + 1} iteration(s) due to ${status} status.`);
      break;
    }

    if (dryRun) break;
  }
}
