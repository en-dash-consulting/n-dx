import { join } from "node:path";
import { listRuns } from "../../store/runs.js";
import { HENCH_DIR, safeParseInt } from "./constants.js";
import { info, result } from "../output.js";
import { colorStatus } from "../../prd/llm-gateway.js";
import { batchLookupTasksInRex, formatTaskLine } from "./task-lookup.js";

export async function cmdStatus(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);
  const limit = flags.last ? safeParseInt(flags.last, "last") : 10;
  const runs = await listRuns(henchDir, limit);

  if (runs.length === 0) {
    result("No runs found. Use 'hench run' to execute a task.");
    return;
  }

  if (flags.format === "json") {
    result(JSON.stringify(runs, null, 2));
    return;
  }

  // Batch-check which tasks still exist in rex
  const taskIds = runs.map((r) => r.taskId);
  const existingIds = await batchLookupTasksInRex(dir, taskIds);

  info(`Recent runs (${runs.length}):\n`);

  for (const run of runs) {
    const icon = statusIcon(run.status);
    const duration = run.finishedAt
      ? formatDuration(
          new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime(),
        )
      : "running";

    const taskExists = existingIds !== null ? existingIds.has(run.taskId) : null;
    const taskLine = formatTaskLine(run.taskTitle, run.taskId, taskExists);

    result(`${icon} ${run.id.slice(0, 8)}  ${taskLine}`);
    info(`  ${colorStatus(run.status)} | ${run.turns} turns | ${duration} | ${run.model}`);
    const totalTokens = run.tokenUsage.input + run.tokenUsage.output;
    info(`  tokens: ${run.tokenUsage.input} in / ${run.tokenUsage.output} out (${totalTokens} total)`);
    if (run.error) {
      result(`  error: ${run.error}`);
    }
    info();
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "completed":
      return "[ok]";
    case "failed":
      return "[!!]";
    case "timeout":
      return "[to]";
    case "budget_exceeded":
      return "[$!]";
    case "running":
      return "[..]";
    default:
      return "[??]";
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}
